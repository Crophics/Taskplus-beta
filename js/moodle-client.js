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
  // How stale this device's own copy may get before opening the app imports again. The server limits
  // calls itself (30 s), so this can be short: the server's alerts arrive within about half an hour.
  const AUTO_SYNC_MIN_MS = 2 * 60 * 1000;
  // Bump this whenever an import starts storing something new on items (2 = due times). A device whose last
  // import used an older shape syncs again on its next open, however recent that import was, so the new data
  // does not wait for a manual sync.
  const IMPORT_SHAPE = 2;
  // A sync that fails to reach the server on its own (the phone's network is often not ready for the first
  // moment after the app opens or resumes) is retried after these delays, in ms, before it counts as failed.
  const RETRY_MS = [4000, 15000, 45000];

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Epoch seconds -> the user's local calendar date, 'YYYY-MM-DD'. */
  function localDate(ts) {
    const d = new Date(ts * 1000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** Local 'HH:MM' of a unix timestamp in seconds (the due time Moodle sent; '' when there is none). */
  function localTime(ts) {
    const d = new Date(ts * 1000);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
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
      submissionTypes: rec.submissionTypes || [],
      wordLimit: rec.wordLimit == null ? null : rec.wordLimit,
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
      const due = rec.dueTs ? localDate(rec.dueTs) : ''; // '' = Moodle gave no due date
      const dueTime = rec.dueTs ? localTime(rec.dueTs) : ''; // the planners use it (js/due-time.js)
      const idx = byId.get(rec.id);

      if (idx === undefined) {
        const submitted = rec.state === 'submitted';
        if (submitted && due && daysBetween(due, today) > RECENT_SUBMITTED_DAYS) { stats.skippedOld++; return; }
        let item = {
          id: rec.id, title: rec.title, course: rec.course, due, dueTime,
          // `unit` is what Today's pill shows for one-sitting work; empty would read "Reading".
          total: 1, unit: rec.kind === 'quiz' ? 'quiz' : 'assignment', notes: '', done: submitted ? 1 : 0, today: 0,
          completed: submitted, dependsOn: '', recurring: '', subtasks: [],
          completedAt: submitted ? today : null, createdAt: today, archived: false,
          order: nextOrder++, updatedAt: now, source: sourceOf(rec, null),
        };
        // Every imported item starts with a rule-of-thumb time estimate (js/estimate-logic.js).
        // Unfinished work is split into ~50-minute parts so the daily pacing is in real time.
        if (global.TPEstimate) item = submitted ? { ...item, estimate: global.TPEstimate.estimateForItem(item) } : global.TPEstimate.withEstimate(item, global.TPEstimate.estimateForItem(item));
        // Done on another device before this one ever imported it: start from that state.
        const known = ctx.progress && ctx.progress[rec.id];
        if (known && known.c && !item.completed) { item.completed = true; item.done = item.total || 1; item.completedAt = known.ca || today; item.updatedAt = known.at; }
        out.push(item);
        byId.set(item.id, out.length - 1);
        stats.added++;
        events.push({ kind: 'new', id: item.id, title: item.title, course: item.course, due });
        if (submitted) stats.completed++;
        return;
      }

      const prev = out[idx];
      let next = { ...prev };
      let changed = false;

      if (prev.title !== rec.title) { next.title = rec.title; changed = true; }
      if (prev.course !== rec.course) { next.course = rec.course; changed = true; }
      if (prev.due !== due) {
        // A date appearing or disappearing is not a "moved" notice; only a real change of date is.
        if (prev.due && due) {
          events.push({ kind: 'moved', id: prev.id, title: rec.title, course: rec.course, from: prev.due, to: due });
          stats.moved++;
        }
        next.due = due;
        // "Ignore" only makes sense for work that is overdue: a new date that is not in the past ends it.
        if (next.ignored && (!due || due >= today)) delete next.ignored;
        changed = true;
      }
      // A new time on the same day is not a "moved" notice, but the plan changes with it.
      if ((prev.dueTime || '') !== dueTime) { next.dueTime = dueTime; changed = true; }
      const src = sourceOf(rec, prev.source);
      if (JSON.stringify(src) !== JSON.stringify(prev.source)) { next.source = src; changed = true; }
      // Re-estimate when Moodle's details changed, or if the item predates estimates. A number the
      // user set is never overwritten, and neither is Claude's answer while the assignment is
      // unchanged (when it HAS changed the old answer no longer applies, so the rule-of-thumb
      // estimate takes over until Claude is asked again).
      if (global.TPEstimate && !(prev.estimate && prev.estimate.basis === 'user')) {
        const keepClaude = prev.estimate && prev.estimate.basis === 'model' && prev.estimate.key === global.TPEstimate.inputsKey(next);
        if (!keepClaude) {
          const est = global.TPEstimate.estimateForItem(next);
          if (!global.TPEstimate.sameEstimate(prev.estimate, est)) { next = global.TPEstimate.withEstimate(next, est); changed = true; }
        }
      }
      // Moodle completes an item once, when it first reports it submitted. After that the user's own
      // choice stands: reopening it must not be undone by the next sync.
      if (rec.state === 'submitted' && !prev.completed && !(prev.source && prev.source.state === 'submitted')) {
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
  function ensureCourses(courses, records, TPCourses, deleted) {
    return ensureCourseNames(courses, (records || []).map((rec) => rec.course), TPCourses, deleted);
  }

  /** Adds an entry for every name that has none yet. Returns how many were added. */
  function ensureCourseNames(courses, names, TPCourses, deleted) {
    const lib = TPCourses || global.TPCourses;
    let added = 0;
    (names || []).forEach((name) => {
      // A course the user deleted stays deleted: a sync must not bring it back (only adding it by hand does).
      if (name && lib.applyTombstones([{ name }], deleted).length && !lib.byName(courses, name) && lib.addCourse(courses, name)) added++;
    });
    return added;
  }

  /**
   * Should Claude be asked about this item? Only unfinished imported work that still has the
   * rule-of-thumb estimate (a quiz with a known time limit, your own number, and a Claude answer
   * for the current text all stay as they are), and not one we already asked about today
   * without success. `force` is the "ask Claude" button on the detail screen.
   */
  function hasPdf(item) {
    return ((item.source && item.source.files) || []).some((f) => /\.pdf$/i.test(f.name || '') || f.mime === 'application/pdf');
  }

  // A Claude answer that never got to read the handout (the switch was off, or the files had no download
  // address yet) is worth one more try; one that was asked to read it and could not, for a lasting reason, is not.
  function wantsHandoutUpgrade(item, filesOn) {
    const est = item.estimate;
    if (!filesOn || est.basis !== 'model' || !hasPdf(item)) return false;
    if (!est.filesAsked) return true;
    return (est.filesSkipped || []).some((s) => s.reason === 'bad_url' && ((item.source.files || []).find((f) => f.name === s.name) || {}).url);
  }

  function needsModel(item, today, force, filesOn) {
    if (!isImported(item) || item.completed || item.archived || item.ignored || !item.estimate || !global.TPEstimate) return false;
    if (force) return true;
    if (item.estimate.basis !== 'heuristic' && !wantsHandoutUpgrade(item, filesOn)) return false;
    const tried = item.modelTry;
    return !(tried && tried.key === global.TPEstimate.inputsKey(item) && tried.day === today);
  }

  /** What is sent to /api/estimate: the assignment's own details, never grades, notes or identity. */
  function modelInput(item, dueInDays, withFiles) {
    const s = item.source || {};
    // Download addresses are only sent when handout reading is on: with it off the server never needs them.
    const files = (s.files || []).slice(0, 6).map((f) => (withFiles
      ? { name: f.name, size: f.size || 0, url: f.url || null, mime: f.mime || null, modified: f.modified || null }
      : { name: f.name, size: f.size || 0 }));
    return {
      id: item.id, course: item.course, title: item.title, kind: s.kind === 'quiz' ? 'quiz' : 'assign',
      points: s.points == null ? null : s.points, description: s.description || '', files,
      timeLimitMin: s.timeLimitMin == null ? null : s.timeLimitMin, wordLimit: s.wordLimit == null ? null : s.wordLimit,
      submissionTypes: s.submissionTypes || [], dueInDays,
    };
  }

  /**
   * Applies /api/estimate results to the item list. Returns a NEW list plus stats; nothing is mutated.
   * ctx: {today, keys: {id: inputsKey at request time}, force, readFiles}. An answer for text that changed
   * while the request was in flight is dropped (stale), and your own number is only replaced when
   * you asked for it (`force`). A failed item is remembered for the day so each sync does not retry it.
   */
  function applyModelResults(items, results, ctx) {
    const E = global.TPEstimate;
    const out = items.map((it) => it);
    const index = new Map(out.map((it, i) => [it && it.id, i]));
    const stats = { applied: 0, failed: 0, stale: 0, limited: false, unavailable: false };
    (results || []).forEach((r) => {
      const i = index.get(r.id);
      if (i === undefined) return;
      const item = out[i];
      const key = E.inputsKey(item);
      if (ctx.keys && ctx.keys[r.id] !== undefined && ctx.keys[r.id] !== key) { stats.stale++; return; }
      if (r.ok && r.estimate) {
        if (item.estimate && item.estimate.basis === 'user' && !ctx.force) return;
        const next = E.withEstimate(item, E.fromModel(r.estimate, key, item.source && item.source.kind, { readFiles: ctx.readFiles }));
        delete next.modelTry;
        // A handout that could not be fetched just now (a temporary failure) is retried, but not before tomorrow.
        if (r.estimate.files && r.estimate.files.retry) next.modelTry = { key, day: ctx.today };
        out[i] = next;
        stats.applied++;
        return;
      }
      stats.failed++;
      if (r.error === 'daily_limit') stats.limited = true;
      if (r.error === 'server_misconfigured' || r.error === 'not_configured') stats.unavailable = true;
      if (r.error !== 'busy' && r.error !== 'daily_limit') out[i] = { ...item, modelTry: { key, day: ctx.today } };
    });
    return { items: out, stats };
  }

  /** Whether the app should quietly sync on load / when it comes back to the foreground. */
  function shouldAutoSync(state, nowMs) {
    if (!state || !state.connected) return false;
    // lastImportAt is when THIS device last imported. (lastSyncAt is the server's own clock: its 30-minute
    // check also sets it, so trusting it made the app think it was current while the server had news.)
    if (!state.lastImportAt || (state.importShape || 0) < IMPORT_SHAPE) return true;
    return nowMs - state.lastImportAt >= AUTO_SYNC_MIN_MS;
  }

  /* ---- Done / progress of imported items that syncs ----
     Imported items stay off the cloud document, so completion could not follow you to another device.
     It travels as a map {itemId: {c: completed, d: done, ca: completedAt, at}}; the newest change wins. */
  const PROGRESS_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

  /** Brings the map up to date with the items (an entry is written when completed/done differ from it). */
  function progressMap(items, prev, now) {
    const out = { ...(prev || {}) };
    (items || []).forEach((it) => {
      if (!it || !it.id || !isImported(it)) return;
      const c = !!it.completed;
      const d = Number(it.done) || 0;
      const e = out[it.id];
      if (e && e.c === c && e.d === d) return;
      if (!e && !c && d === 0) return;
      out[it.id] = { c, d, ca: it.completedAt || null, at: it.updatedAt || now || Date.now() };
    });
    return out;
  }

  function mergeProgress(a, b, now) {
    const out = {};
    [a || {}, b || {}].forEach((m) => {
      Object.entries(m).forEach(([id, e]) => {
        if (!e || typeof e.at !== 'number' || now - e.at > PROGRESS_MAX_AGE_MS) return;
        if (!out[id] || e.at > out[id].at) out[id] = { c: !!e.c, d: Number(e.d) || 0, ca: e.ca || null, at: e.at };
      });
    });
    return out;
  }

  /**
   * Copies the map's state onto an item when they differ. The map is kept current with local changes
   * (progressMap runs on every save) and merged newest-wins, so what it says is the winner. An item's own
   * updatedAt is no guide: a re-estimate bumps it without any change in progress.
   */
  function applyProgressTo(it, e) {
    if (!e) return false;
    const total = it.total || 1;
    const d = e.c ? total : Math.min(e.d, total);
    if (!!it.completed === e.c && (Number(it.done) || 0) === d) return false;
    it.completed = e.c;
    it.done = d;
    it.completedAt = e.c ? (e.ca || it.completedAt || null) : null;
    it.updatedAt = e.at;
    return true;
  }

  function applyProgress(items, map) {
    let changed = false;
    (items || []).forEach((it) => {
      if (it && it.id && isImported(it) && map && map[it.id] && applyProgressTo(it, map[it.id])) changed = true;
    });
    return changed;
  }

  /** Plain-language lines for the Worker's sync warnings (codes like 'state_failed:7'). */
  function explainWarnings(warnings) {
    const list = Array.isArray(warnings) ? warnings : [];
    const ids = (code) => list.filter((w) => w.startsWith(code + ':')).map((w) => w.split(':')[1]);
    const num = (code) => ids(code).reduce((n, v) => n + (Number(v) || 0), 0);
    const out = [];
    const later = num('state_skipped');
    if (later) out.push(`${later} item${later === 1 ? '' : 's'} will have submission status checked on the next sync (call limit).`);
    const stateFailed = ids('state_failed').length;
    if (stateFailed) out.push(`Could not check submission status for ${stateFailed} item${stateFailed === 1 ? '' : 's'}.`);
    if (list.includes('no_courses_selected')) out.push('No courses are selected to sync.');
    return out;
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
    estimate: (items, fresh, readFiles) => call('/api/estimate', 'POST', { items, fresh: !!fresh, readFiles: !!readFiles }),
    disconnect: () => call('/api/moodle/disconnect', 'POST', {}),
    pushStatus: () => call('/api/push/status', 'GET'),
    registerPush: (token) => call('/api/push/register', 'POST', { token, timeZone: tz(), userAgent: (global.navigator && global.navigator.userAgent) || '' }),
    unregisterPush: (token) => call('/api/push/unregister', 'POST', { token }),
    pushPrefs: (prefs) => call('/api/push/prefs', 'POST', { ...prefs, timeZone: tz() }),
    testPush: () => call('/api/push/test', 'POST', {}),
    feed: () => call('/api/push/events', 'GET'),
  };

  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }

  /* ---- What's new feed (events come from the Worker; this only merges and words them) ---- */
  const FEED_MAX = 50;
  // feed = {events:[{id, kind, title, course, at, ...}], seenAt}. Merge by id, newest first.
  function mergeFeed(feed, incoming, now) {
    const base = feed && Array.isArray(feed.events) ? feed : { events: [], seenAt: now };
    const have = new Set(base.events.map((e) => e.id));
    const add = (incoming || []).filter((e) => e && e.id && !have.has(e.id)).map((e) => ({ ...e, at: e.at || now }));
    const events = add.concat(base.events).sort((a, b) => b.at - a.at).slice(0, FEED_MAX);
    return { events, seenAt: base.seenAt || 0 };
  }
  function unreadCount(feed) {
    if (!feed || !Array.isArray(feed.events)) return 0;
    return feed.events.filter((e) => e.at > (feed.seenAt || 0)).length;
  }
  function markFeedSeen(feed, now) { return { events: (feed && feed.events) || [], seenAt: now }; }
  function feedLine(e) {
    switch (e.kind) {
      case 'new': return { head: 'New ' + (e.quiz ? 'quiz' : 'assignment'), text: e.title };
      case 'moved': return { head: 'Date moved', text: e.title };
      default: return { head: 'Update', text: e.title || '' };
    }
  }

  global.TPMoodle = { localDate, isImported, mergeImported, needsModel, modelInput, applyModelResults, ensureCourses, ensureCourseNames, shouldAutoSync, progressMap, mergeProgress, applyProgress, summarize, explainWarnings, MoodleClientError, api, AUTO_SYNC_MIN_MS, IMPORT_SHAPE, RETRY_MS, mergeFeed, unreadCount, markFeedSeen, feedLine };
})(typeof window !== 'undefined' ? window : globalThis);
