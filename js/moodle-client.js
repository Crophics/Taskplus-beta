/* moodle-client.js — Moodle import, browser side.
   Two halves:
   - Pure functions (mergeImported, ensureCourses, shouldAutoSync): no DOM, no
     network; unit-tested in test/moodle-import.test.js.
   - A thin fetch wrapper around the Worker's /api/moodle/* endpoints
     (src/worker.mjs). The Moodle token never reaches the browser; every call is
     authenticated with the user's Firebase ID token.

   Imported items live under their own storage key (see js/app.js) and are NOT
   pushed to the shared Firestore doc: Moodle is their source of truth and each
   device syncs from it directly (see docs/PLAN-moodle-import.md, section 3.4).
*/
(function (global) {
  const RECENT_SUBMITTED_DAYS = 14;
  const AUTO_SYNC_MIN_HOURS = 3;

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Epoch seconds -> the user's local calendar date, 'YYYY-MM-DD'. */
  function localDate(ts) {
    const d = new Date(ts * 1000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  function isImported(it) {
    return !!(it && it.source && it.source.type === 'moodle');
  }

  /** The sync-owned details object stored on an imported item. */
  function sourceOf(rec, prev) {
    return {
      type: 'moodle',
      cmid: rec.cmid,
      instanceId: rec.instanceId,
      courseId: rec.courseId,
      kind: rec.kind,
      link: rec.link,
      points: rec.points,
      opens: rec.opensTs ? localDate(rec.opensTs) : null,
      description: rec.description || '',
      files: rec.files || [],
      timeLimitMin: rec.timeLimitMin == null ? null : rec.timeLimitMin,
      // A sync that ran out of call budget reports state: null for some items;
      // keep what we knew rather than forgetting it.
      state: rec.state == null ? (prev && prev.state) || null : rec.state,
    };
  }

  /**
   * Merges a sync's records into the item list. Returns a NEW array plus stats
   * and events; the input array and its items are not mutated.
   *
   * Ownership: title, course, due and `source` belong to Moodle and are
   * overwritten. Everything else (notes, subtasks, progress counters,
   * dependsOn, recurring, order) belongs to the user and is never touched.
   * Rules carried over from the Obsidian sync: never delete, never un-complete,
   * and a deleted (tombstoned) item is not re-added.
   */
  function mergeImported(items, records, ctx) {
    const { today, deletedLog = [], now = Date.now() } = ctx;
    const out = items.map((it) => it);
    const byId = new Map();
    out.forEach((it, i) => { if (it && it.id) byId.set(it.id, i); });
    const tombstoned = new Set((deletedLog || []).map((t) => t.id));
    let nextOrder = out.reduce((m, it) => Math.max(m, it.order == null ? -1 : it.order), -1) + 1;
    const stats = { added: 0, updated: 0, moved: 0, completed: 0, skippedDeleted: 0, skippedOld: 0 };
    const events = [];

    (records || []).forEach((rec) => {
      if (tombstoned.has(rec.id)) { stats.skippedDeleted++; return; }
      const due = localDate(rec.dueTs);
      const idx = byId.get(rec.id);

      if (idx === undefined) {
        const submitted = rec.state === 'submitted';
        if (submitted && daysBetween(due, today) > RECENT_SUBMITTED_DAYS) { stats.skippedOld++; return; }
        const item = {
          id: rec.id, title: rec.title, course: rec.course, due,
          // `unit` is what Today's pill shows for one-sitting work; empty would read "Reading".
          total: 1, unit: rec.kind === 'quiz' ? 'quiz' : 'assignment', notes: '', done: submitted ? 1 : 0, today: 0,
          completed: submitted, dependsOn: '', recurring: '', subtasks: [],
          completedAt: submitted ? today : null, createdAt: today, archived: false,
          order: nextOrder++, updatedAt: now, source: sourceOf(rec, null),
        };
        out.push(item);
        byId.set(item.id, out.length - 1);
        stats.added++;
        events.push({ kind: 'new', id: item.id, title: item.title, course: item.course, due });
        if (submitted) stats.completed++;
        return;
      }

      const prev = out[idx];
      const next = { ...prev };
      let changed = false;

      if (prev.title !== rec.title) { next.title = rec.title; changed = true; }
      if (prev.course !== rec.course) { next.course = rec.course; changed = true; }
      if (prev.due !== due) {
        events.push({ kind: 'moved', id: prev.id, title: rec.title, course: rec.course, from: prev.due, to: due });
        next.due = due;
        stats.moved++;
        changed = true;
      }
      const src = sourceOf(rec, prev.source);
      if (JSON.stringify(src) !== JSON.stringify(prev.source)) { next.source = src; changed = true; }
      if (rec.state === 'submitted' && !prev.completed) {
        next.completed = true;
        next.done = next.total || 1;
        next.completedAt = today;
        stats.completed++;
        changed = true;
      }
      if (changed) {
        next.updatedAt = now;
        out[idx] = next;
        stats.updated++;
      }
    });

    return { items: out, stats, events };
  }

  /** Makes sure every imported course code exists in the courses collection (so it gets a colour). */
  function ensureCourses(courses, records, TPCourses) {
    const lib = TPCourses || global.TPCourses;
    let added = 0;
    (records || []).forEach((rec) => {
      if (rec.course && !lib.byName(courses, rec.course) && lib.addCourse(courses, rec.course)) added++;
    });
    return added;
  }

  /** Whether the app should quietly sync on load / when it comes back to the foreground. */
  function shouldAutoSync(state, nowMs) {
    if (!state || !state.connected) return false;
    if (!state.lastSyncAt) return true;
    return nowMs - state.lastSyncAt >= AUTO_SYNC_MIN_HOURS * 3600 * 1000;
  }

  /** A short, human summary of a sync result for a toast. */
  function summarize(stats) {
    const parts = [];
    if (stats.added) parts.push(stats.added + ' new');
    if (stats.moved) parts.push(stats.moved + ' date' + (stats.moved === 1 ? '' : 's') + ' changed');
    if (stats.completed) parts.push(stats.completed + ' submitted');
    return parts.length ? 'Moodle: ' + parts.join(', ') : 'Moodle is up to date';
  }

  /* ---------------- network (browser only) ---------------- */

  class MoodleClientError extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status || 0;
    }
  }

  async function call(path, method, body) {
    const sync = global.tpSync;
    const token = sync && sync.getIdToken ? await sync.getIdToken() : null;
    if (!token) throw new MoodleClientError('signed_out', 'Sign in to Taskplus first (Settings > Sync)', 401);
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new MoodleClientError('offline', 'Could not reach Taskplus. Check your connection.', 0);
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) {
      throw new MoodleClientError((json && json.error) || 'http_' + res.status, (json && json.message) || 'Request failed', res.status);
    }
    return json;
  }

  const api = {
    status: () => call('/api/moodle/status', 'GET'),
    connect: (site, username, password) => call('/api/moodle/connect', 'POST', { site, username, password }),
    saveCourses: (selected) => call('/api/moodle/courses', 'POST', { selected }),
    sync: () => call('/api/moodle/sync', 'POST', {}),
    disconnect: () => call('/api/moodle/disconnect', 'POST', {}),
  };

  global.TPMoodle = { localDate, isImported, mergeImported, ensureCourses, shouldAutoSync, summarize, MoodleClientError, api, AUTO_SYNC_MIN_HOURS };
})(typeof window !== 'undefined' ? window : globalThis);
