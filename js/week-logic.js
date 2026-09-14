/* week-logic.js — Paced-load week chart: pure computation (see views/week-html.js)

   "Paced load": each open item spreads its remaining units evenly across
   the days it has left (day 0 through its due day, clamped to 0-6);
   overdue work lands on today. Items with no daily target (single-part)
   contribute 1 unit on their due day.
*/
(function (global) {
  function paceItemAcrossDays(it, today, daysBetween) {
    // Returns an array of {dayIndex, load, course} contributions, dayIndex in 0-6.
    const left = Math.max((it.total || 0) - (it.done || 0), 0);
    if (left <= 0) return [];
    const dueOffset = daysBetween(today, it.due);
    const course = (it.course || '').trim() || 'Other';
    if (!(it.total > 1)) {
      // Single-part: 1 unit on its due day (or today, if overdue).
      const dayIndex = Math.min(Math.max(dueOffset, 0), 6);
      return [{ dayIndex, load: 1, course }];
    }
    if (dueOffset <= 0) {
      // Overdue (or due today): all remaining work lands on today.
      return [{ dayIndex: 0, load: left, course }];
    }
    const daysSpan = Math.min(dueOffset, 6) + 1; // day 0 .. due day inclusive, clamped
    const perDay = left / daysSpan;
    const contributions = [];
    for (let d = 0; d < daysSpan; d++) {
      contributions.push({ dayIndex: d, load: perDay, course });
    }
    return contributions;
  }

  /**
   * @returns {Array<{dayIndex, total, byCourse: Map<string,number>}>} length 7
   */
  function computePacedLoad(ctx) {
    const { items, today, daysBetween } = ctx;
    const days = Array.from({ length: 7 }, (_, i) => ({ dayIndex: i, total: 0, byCourse: {} }));
    items.filter(it => !it.completed && !it.archived).forEach(it => {
      paceItemAcrossDays(it, today(), daysBetween).forEach(({ dayIndex, load, course }) => {
        const day = days[dayIndex];
        day.total += load;
        day.byCourse[course] = (day.byCourse[course] || 0) + load;
      });
    });
    return days;
  }

  /** "N tied" when multiple days share the max load, "none" when nothing's loaded. */
  function heaviestDayLabel(days, dayLabels) {
    const max = Math.max(...days.map(d => d.total));
    if (max <= 0) return 'none';
    const tied = days.filter(d => Math.round(d.total * 1000) === Math.round(max * 1000));
    if (tied.length > 1) return `${tied.length} tied`;
    return dayLabels[tied[0].dayIndex];
  }

  function statTiles(ctx) {
    const { items, today, daysBetween } = ctx;
    const dueThisWeek = items.filter(it => !it.completed && !it.archived && daysBetween(today(), it.due) >= 0 && daysBetween(today(), it.due) <= 6).length;
    const unitsLeft = items.reduce((sum, it) => {
      if (it.completed || it.archived) return sum;
      return sum + Math.max((it.total || 0) - (it.done || 0), 0);
    }, 0);
    return { dueThisWeek, unitsLeft: Math.round(unitsLeft * 10) / 10 };
  }

  /** Items (with their load share) contributing to one day, for the day-detail card. */
  function contributionsForDay(ctx, dayIndex) {
    const { items, today, daysBetween } = ctx;
    const out = [];
    items.filter(it => !it.completed && !it.archived).forEach(it => {
      const contribs = paceItemAcrossDays(it, today(), daysBetween);
      const forDay = contribs.find(c => c.dayIndex === dayIndex);
      if (forDay) out.push({ it, load: forDay.load });
    });
    return out;
  }

  function byCourseBreakdown(items, colorFor) {
    const byCourse = new Map();
    items.filter(it => !it.archived).forEach(it => {
      const key = (it.course || '').trim() || 'No course';
      if (!byCourse.has(key)) byCourse.set(key, { name: key, total: 0, completed: 0 });
      const c = byCourse.get(key);
      c.total++;
      if (it.completed) c.completed++;
    });
    return [...byCourse.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => ({ ...c, pct: c.total ? Math.round((c.completed / c.total) * 100) : 0, color: colorFor(c.name) }));
  }

  global.TPWeekLogic = { paceItemAcrossDays, computePacedLoad, heaviestDayLabel, statTiles, contributionsForDay, byCourseBreakdown };
})(typeof window !== 'undefined' ? window : globalThis);
