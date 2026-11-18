/* plan-logic.js — Minutes, per day. Pure functions; tested in test/plan-logic.test.js.

   An item's estimate (js/estimate-logic.js) divided by its number of parts is
   minutes per part. This module turns that into:
     - what is left TODAY, in minutes (header total, per-row estimates);
     - how the remaining work spreads across the next 7 days (the Week chart);
     - which day, if any, is "heavy" (well above the rest of the week).

   It follows the SAME pacing rules as js/today-logic.js so the numbers agree:
     - work days run from today up to the day BEFORE the due date (D = max(days
       until due, 1)); overdue or due-today work is all today;
     - a multi-part item's parts are spread evenly, front-loaded (3 parts over 2
       days = 2 today, 1 tomorrow = ceil(left / days left), as Today's targets);
     - a single-part item is done on its LAST work day (the day before it's due),
       which is when Today starts requiring it;
     - today's share is fixed from the state at the START of the day (done minus
       what was logged today), so logging work makes "left" shrink instead of the
       plan re-spreading.
   When Claude named the steps (item.estimate.steps), each step is a part with its own minutes and
   a day's units are the NEXT steps in order, so the 25-minute "read" and the 100-minute "solve" are
   not averaged together.

   Items with no estimate are not in any minutes figure; they are counted so the
   UI can say so rather than silently ignoring them.
*/
(function (global) {
  const planned = (it) => !!it.due && !it.ignored; // same rule as TPItemLogic.isPlanned
  const HORIZON = 7;

  /** 50 -> "50m", 90 -> "1h 30m", 120 -> "2h", 0 -> "0m". Rounds to whole minutes. */
  function fmtMinutes(m) {
    const n = Math.max(0, Math.round(Number(m) || 0));
    if (n < 60) return n + 'm';
    const h = Math.floor(n / 60);
    const r = n % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  /** For display: nearest 5 minutes (never 0 for real work). */
  function roundDisplay(m) {
    if (!(m > 0)) return 0;
    return m < 10 ? Math.max(5, Math.round(m)) : Math.round(m / 5) * 5;
  }

  /** Minutes of one part (or one unit, for manual items with a set estimate), or null. */
  function minutesPerUnit(it) {
    const est = it && it.estimate && it.estimate.minutes;
    if (!(est > 0)) return null;
    return est / Math.max(it.total || 1, 1);
  }

  // Claude names the steps with their own minutes ([25, 100, 25]); they are trusted only while there
  // is exactly one per part. Then "the next 2 parts" means those two steps' minutes, not 2 x the average.
  function stepsUsable(it) {
    const st = it && it.estimate && it.estimate.steps;
    return Array.isArray(st) && st.length > 0 && st.length === Math.max((it && it.total) || 1, 1);
  }

  /** Minutes of `count` units starting at unit index `from` (the units are done in order). */
  function unitMinutes(it, from, count) {
    if (!(count > 0)) return 0;
    if (stepsUsable(it)) {
      let m = 0;
      for (let i = from; i < from + count && i < it.estimate.steps.length; i++) m += it.estimate.steps[i].minutes;
      return m;
    }
    const mpu = minutesPerUnit(it);
    return mpu === null ? 0 : count * mpu;
  }

  function leftMinutes(it) {
    if (minutesPerUnit(it) === null) return null;
    const total = Math.max(it.total || 1, 1);
    return unitMinutes(it, it.done || 0, Math.max(total - (it.done || 0), 0));
  }

  /** Minutes still to do TODAY for an entry of computeTodayScreen's `targets`. */
  function entryMinutes(entry) {
    if (minutesPerUnit(entry.it) === null) return null;
    return unitMinutes(entry.it, entry.it.done || 0, entry.amt > 0 ? entry.amt : 1);
  }

  /**
   * Header numbers for Today. leftMin = minutes still to do on today's targets;
   * doneMin = minutes logged today on anything with an estimate; aheadMin = the extra,
   * optional minutes the plan also puts on today (Get ahead rows).
   */
  function todaySummary(targets, items, getAhead) {
    let leftMin = 0;
    let unestimated = 0;
    targets.forEach((t) => {
      const m = entryMinutes(t);
      if (m === null) unestimated++;
      else leftMin += m;
    });
    let doneMin = 0;
    items.forEach((it) => {
      if (it.archived || !planned(it)) return;
      if (minutesPerUnit(it) !== null && it.today > 0) doneMin += unitMinutes(it, Math.max((it.done || 0) - it.today, 0), it.today);
    });
    // Optional work the plan ALSO puts on today: a multi-part item with slack still has a share
    // today (it shows in Get ahead, and in Week's bar for today). Single-part get-ahead items are
    // planned for the day before they are due, so they are not part of today's plan.
    let aheadMin = 0;
    (getAhead || []).forEach((e) => {
      if (e.kind !== 'multi' || e.met) return;
      const m = entryMinutes(e);
      if (m !== null) aheadMin += m;
    });
    const total = leftMin + doneMin;
    return { leftMin, doneMin, aheadMin, plannedMin: total, pct: total > 0 ? doneMin / total : 0, tasks: targets.length, unestimated };
  }

  /** `units` whole units over `days` days, evenly, extra units on the earliest days. */
  function spread(units, days) {
    const out = new Array(days).fill(Math.floor(units / days));
    for (let i = 0; i < units % days; i++) out[i] += 1;
    return out;
  }

  /** One item's remaining work as [{dayIndex, units}], dayIndex 0..HORIZON-1 only. */
  function allocateItem(it, today, daysBetween) {
    if (it.completed || it.archived || !planned(it)) return [];
    const total = Math.max(it.total || 1, 1);
    const done = it.done || 0;
    const loggedToday = it.today || 0;
    if (done >= total) return [];
    const dueIn = daysBetween(today, it.due);
    if (!Number.isFinite(dueIn)) return []; // no usable due date: nothing to place on a day
    const out = [];
    const push = (dayIndex, units) => { if (units > 0 && dayIndex < HORIZON) out.push({ dayIndex, units }); };

    if (total <= 1) {
      push(Math.max(dueIn - 1, 0), 1); // the day before it is due, or today if that has passed
      return out;
    }
    const days = Math.max(dueIn, 1);
    const startLeft = Math.max(total - Math.max(done - loggedToday, 0), 0); // units left at the start of today
    const shares = spread(startLeft, days);
    push(0, Math.max(shares[0] - loggedToday, 0));
    // Whatever is left after today (or after today's extra effort, if you got ahead) spreads over the rest.
    const later = Math.max(startLeft - Math.max(shares[0], loggedToday), 0);
    if (days > 1) spread(later, days - 1).forEach((u, i) => push(i + 1, u));
    return out;
  }

  /**
   * The next 7 days of planned minutes.
   * ctx: {items, today (string), daysBetween, isLocked?}
   * -> { days: [{dayIndex, minutes, byCourse:{name: minutes}, entries:[{it, minutes}]}], unestimated }
   */
  function computeDays(ctx) {
    const { items, today, daysBetween, isLocked } = ctx;
    const days = Array.from({ length: HORIZON }, (_, i) => ({ dayIndex: i, minutes: 0, byCourse: {}, entries: [] }));
    let unestimated = 0;
    items.forEach((it) => {
      if (it.completed || it.archived || !planned(it)) return;
      if (isLocked && isLocked(it)) return;
      const mpu = minutesPerUnit(it);
      if (mpu === null) { unestimated++; return; }
      const course = (it.course || '').trim() || 'Other';
      let next = it.done || 0; // the units are done in order, so each day's units start where the last day's ended
      allocateItem(it, today, daysBetween).forEach(({ dayIndex, units }) => {
        const m = unitMinutes(it, next, units);
        next += units;
        const d = days[dayIndex];
        d.minutes += m;
        d.byCourse[course] = (d.byCourse[course] || 0) + m;
        d.entries.push({ it, minutes: m });
      });
    });
    return { days, unestimated };
  }

  /**
   * The one day that stands well above the rest, or null. "Heavy" is relative: at least
   * `minMinutes` AND at least `ratio` times the average of the 7 days. Ties go to the
   * earliest day.
   */
  function heavyDay(days, opts) {
    const { minMinutes = 90, ratio = 1.5 } = opts || {};
    const total = days.reduce((s, d) => s + d.minutes, 0);
    if (total <= 0) return null;
    const mean = total / days.length;
    let best = days[0];
    days.forEach((d) => { if (d.minutes > best.minutes) best = d; });
    return best.minutes >= minMinutes && best.minutes >= ratio * mean ? { dayIndex: best.dayIndex, minutes: best.minutes } : null;
  }

  global.TPPlan = { HORIZON, fmtMinutes, roundDisplay, minutesPerUnit, stepsUsable, unitMinutes, leftMinutes, entryMinutes, todaySummary, spread, allocateItem, computeDays, heavyDay };
})(typeof window !== 'undefined' ? window : globalThis);
