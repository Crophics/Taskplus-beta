/* item-logic.js — Prerequisite lock/unlock logic */
(function (global) {
  function isLocked(items, it) {
    if (!it.dependsOn) return false;
    const prereq = items.find((x) => x.title === it.dependsOn);
    return prereq ? !prereq.completed : false;
  }

  function unlockedToday(items, it, today) {
    if (!it.dependsOn) return false;
    const prereq = items.find((x) => x.title === it.dependsOn);
    return !!(prereq && prereq.completed && prereq.completedAt === today());
  }

  /**
   * Work the daily plan paces: it has a due date and the user has not chosen to ignore it. Work with no
   * due date (Moodle assignments without one) is listed but never paced; ignored work is overdue work the
   * user wrote off. Both stay out of Today, Week, the plan and the overdue counts.
   * (today-logic, week-logic and plan-logic keep a one-line copy of this, as they load without this file.)
   */
  function isPlanned(it) {
    return !!(it && it.due) && !it.ignored;
  }

  /* ---- "Ignored" that syncs ----
     Imported (Moodle) items never go to the shared cloud document, so the flag could not follow you to
     another device. The flag is kept as a small map {itemId: {on, at}} that does sync; the newest change
     wins (an "un-ignore" is a record too, or it could never override an old "ignore"). */
  const IGNORED_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

  function setIgnoredEntry(map, id, on, now) {
    return { ...(map || {}), [id]: { on: !!on, at: now } };
  }

  function mergeIgnored(a, b, now) {
    const out = {};
    [a || {}, b || {}].forEach((m) => {
      Object.entries(m).forEach(([id, e]) => {
        if (!e || typeof e.at !== 'number' || now - e.at > IGNORED_MAX_AGE_MS) return;
        if (!out[id] || e.at > out[id].at) out[id] = { on: !!e.on, at: e.at };
      });
    });
    return out;
  }

  /**
   * Sets or clears `ignored` on items from the map. Only overdue, unfinished work can be ignored, so an
   * "on" entry is applied only while the item is still overdue (a due date Moodle moved into the future
   * ends it, on every device, without any record). Mutates items; returns true if anything changed.
   */
  function applyIgnored(items, map, today, daysBetween) {
    let changed = false;
    (items || []).forEach((it) => {
      const e = map && it && it.id ? map[it.id] : null;
      if (!e) return;
      const overdue = !!it.due && !it.completed && daysBetween(today, it.due) < 0;
      const want = e.on && overdue;
      if (want && !it.ignored) { it.ignored = true; changed = true; }
      else if (!want && it.ignored) { delete it.ignored; changed = true; }
    });
    return changed;
  }

  global.TPItemLogic = { isLocked, unlockedToday, isPlanned, setIgnoredEntry, mergeIgnored, applyIgnored };
})(typeof window !== 'undefined' ? window : globalThis);