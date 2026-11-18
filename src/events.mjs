// events.mjs — what changed in Moodle since last time, and what to tell the user about it.
//
// Pure functions (no network, no storage), tested in test/events.test.js. A SNAPSHOT is a compact
// picture of everything the user's Moodle reported at one sync; comparing two snapshots gives the
// events (new assignment, due date moved). Comparing against nothing is the
// BASELINE: the first snapshot never produces events, so connecting does not announce every
// assignment you already have.

const HOUR = 3600 * 1000;
const SNAP_KEEP_DAYS = 150;
const MOVED_MIN_SEC = 3600; // a due date nudge under an hour is noise

/**
 * records: sync records ({id, kind, title, course, dueTs, state}). `prev` is only used to keep what a budget-limited sync
 * could not re-check (a null submission state) and to avoid forgetting items that dropped out of
 * the response.
 */
export function buildSnapshot(records, prev, nowMs) {
  const items = {};
  const before = (prev && prev.items) || {};
  Object.keys(before).forEach((id) => { items[id] = { ...before[id] }; });

  (records || []).forEach((r) => {
    const old = before[r.id] || {};
    items[r.id] = {
      ...old,
      t: r.title, c: r.course, k: r.kind === 'quiz' ? 'q' : 'a', d: r.dueTs || null,
      // a sync that ran out of call budget reports null; keep what we knew
      s: r.state == null ? (old.s || null) : r.state,
    };
  });
  // Don't grow forever: drop long-finished entries.
  const cutoff = nowMs / 1000 - SNAP_KEEP_DAYS * 86400;
  Object.keys(items).forEach((id) => {
    const it = items[id];
    // (k === 'g' entries were grade-book-only items from before grades were dropped.)
    if (it.k === 'g' || (it.d && it.d < cutoff && it.s === 'submitted')) delete items[id];
  });
  return { v: 1, at: nowMs, items };
}

/** Events between two snapshots. Returns [] when there is no previous snapshot (the baseline). */
export function diffSnapshots(prev, next, nowMs) {
  if (!prev || !prev.items) return [];
  const events = [];
  const nowSec = nowMs / 1000;
  Object.entries(next.items).forEach(([id, n]) => {
    const p = prev.items[id];
    if (!p) {
      // A new, unfinished assignment or quiz that is not ancient.
      if (n.s !== 'submitted' && (n.d == null || n.d >= nowSec - 7 * 86400)) {
        events.push({ id: `new:${id}`, kind: 'new', itemId: id, title: n.t, course: n.c, dueTs: n.d, quiz: n.k === 'q' });
      }
    } else {
      if (n.d && p.d && Math.abs(n.d - p.d) >= MOVED_MIN_SEC && n.s !== 'submitted') {
        events.push({ id: `moved:${id}:${n.d}`, kind: 'moved', itemId: id, title: n.t, course: n.c, fromTs: p.d, toTs: n.d, quiz: n.k === 'q' });
      }
    }
  });
  return events;
}

/* ---------------- wording ---------------- */

function fmt(ts, tz, withTime) {
  const opts = { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz || 'UTC' };
  if (withTime) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
  try { return new Intl.DateTimeFormat('en-US', opts).format(new Date(ts * 1000)); } catch (e) { return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(ts * 1000)); }
}

/** One event as notification text. */
export function describeEvent(e, tz) {
  const verb = e.quiz ? 'closes' : 'due';
  switch (e.kind) {
    case 'new': return { title: `New: ${e.title}`, body: [e.course, e.dueTs ? `${verb} ${fmt(e.dueTs, tz, true)}` : null].filter(Boolean).join(' · ') };
    case 'moved': return { title: `Date moved: ${e.title}`, body: `Now ${fmt(e.toTs, tz, true)} (was ${fmt(e.fromTs, tz, false)})` };
    default: return { title: e.title || 'Taskplus', body: '' };
  }
}

/** One push for a batch of events: the event itself if there is one, otherwise a short summary. */
export function composePush(events, tz) {
  if (events.length === 1) return { ...describeEvent(events[0], tz), tag: 'taskplus-updates' };
  const names = events.slice(0, 3).map((e) => describeEvent(e, tz).title.replace(/^(New|Date moved): ?/, ''));
  const more = events.length > 3 ? ` and ${events.length - 3} more` : '';
  return { title: `${events.length} updates in Taskplus`, body: names.join('; ') + more, tag: 'taskplus-updates' };
}

/* ---------------- due-soon reminders ---------------- */

/**
 * Reminders that are due now. A reminder fires once per (item, due date): about a day before and
 * about an hour before. Items already submitted are never reminded; a moved due date starts fresh
 * (the key includes the due timestamp). `done` is the set of reminder keys already sent.
 */
export function dueSoon(snapshot, nowMs, done) {
  const sent = new Set(done || []);
  const out = [];
  const nowSec = nowMs / 1000;
  Object.entries((snapshot && snapshot.items) || {}).forEach(([id, it]) => {
    if (it.k === 'g' || !it.d || it.s === 'submitted') return;
    const left = it.d - nowSec;
    if (left <= 0) return;
    const k1 = `due1:${id}:${it.d}`;
    const k24 = `due24:${id}:${it.d}`;
    if (left <= 3600 && !sent.has(k1)) {
      out.push({ key: k1, urgent: true, id, title: it.t, course: it.c, dueTs: it.d, quiz: it.k === 'q', skip: [k24] });
    } else if (left <= 24 * 3600 && left > 3600 && !sent.has(k24)) {
      out.push({ key: k24, urgent: false, id, title: it.t, course: it.c, dueTs: it.d, quiz: it.k === 'q', skip: [] });
    }
  });
  return out.sort((a, b) => a.dueTs - b.dueTs);
}

export function describeReminder(r, tz) {
  const verb = r.quiz ? 'Closes' : 'Due';
  return r.urgent
    ? { title: `${verb} within the hour: ${r.title}`, body: [r.course, fmt(r.dueTs, tz, true)].filter(Boolean).join(' · '), tag: `taskplus-due-${r.id}` }
    : { title: `${verb} tomorrow: ${r.title}`, body: [r.course, fmt(r.dueTs, tz, true)].filter(Boolean).join(' · '), tag: `taskplus-due-${r.id}` };
}

/** Reminder keys worth remembering: drop ones whose due date is long past. */
export function pruneReminders(keys, nowMs) {
  const cutoff = nowMs / 1000 - 2 * 86400;
  return (keys || []).filter((k) => Number(String(k).split(':').pop()) > cutoff);
}

/* ---------------- quiet hours ---------------- */

export function localHour(nowMs, tz) {
  try {
    const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz || 'UTC' }).format(new Date(nowMs));
    return Number(h);
  } catch (e) {
    return new Date(nowMs).getUTCHours();
  }
}

/** quiet: {on, start, end} in local hours, e.g. 22 to 8 (wraps midnight). */
export function isQuiet(nowMs, tz, quiet) {
  if (!quiet || !quiet.on) return false;
  const h = localHour(nowMs, tz);
  const { start, end } = quiet;
  if (start === end) return false;
  return start < end ? h >= start && h < end : h >= start || h < end;
}

export const HOURS = { HOUR };
