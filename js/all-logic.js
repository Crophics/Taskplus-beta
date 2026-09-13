/* all-logic.js — All screen: search, sort, filter, grouping (pure, testable) */
(function (global) {
  function matchesQuery(it, q) {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (it.title || '').toLowerCase().includes(needle)
      || (it.course || '').toLowerCase().includes(needle)
      || (it.unit || '').toLowerCase().includes(needle);
  }

  /** completed sinks below blocked, which sinks below open, within any group */
  function statusPriority(it, isLocked) {
    if (it.completed) return 2;
    if (isLocked(it)) return 1;
    return 0;
  }

  /**
   * @returns {Array<{key,label,rows:Array<{it,i}>}>}
   */
  function buildGroups(ctx) {
    const { items, query, sortMode, filterCourse, isLocked, today, daysBetween } = ctx;
    let rows = items
      .map((it, i) => ({ it, i }))
      .filter(x => !x.it.archived)
      .filter(x => matchesQuery(x.it, query))
      .filter(x => !filterCourse || (x.it.course || '').trim().toLowerCase() === filterCourse.toLowerCase());

    const byStatusThenDue = (a, b) => {
      const pa = statusPriority(a.it, isLocked), pb = statusPriority(b.it, isLocked);
      if (pa !== pb) return pa - pb;
      return (a.it.due || '').localeCompare(b.it.due || '');
    };

    if (sortMode === 'custom') {
      rows.sort((a, b) => {
        const pa = statusPriority(a.it, isLocked), pb = statusPriority(b.it, isLocked);
        if (pa !== pb) return pa - pb;
        return (a.it.order ?? a.i) - (b.it.order ?? b.i);
      });
      return [{ key: 'custom', label: null, rows }];
    }

    if (sortMode === 'course') {
      const byCourse = new Map();
      rows.forEach(r => {
        const key = (r.it.course || '').trim() || 'No course';
        if (!byCourse.has(key)) byCourse.set(key, []);
        byCourse.get(key).push(r);
      });
      return [...byCourse.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, groupRows]) => ({ key, label: key, rows: groupRows.sort(byStatusThenDue) }));
    }

    // Urgency / Due date: group into Overdue / This week / Later / Blocked / Completed.
    const groups = { overdue: [], thisWeek: [], later: [], blocked: [], completed: [] };
    rows.forEach(r => {
      const it = r.it;
      if (it.completed) { groups.completed.push(r); return; }
      if (isLocked(it)) { groups.blocked.push(r); return; }
      const d = daysBetween(today(), it.due);
      if (d < 0) groups.overdue.push(r);
      else if (d <= 6) groups.thisWeek.push(r);
      else groups.later.push(r);
    });
    const sortWithin = sortMode === 'due'
      ? (a, b) => (a.it.due || '').localeCompare(b.it.due || '')
      : (a, b) => daysBetween(today(), a.it.due) - daysBetween(today(), b.it.due);
    const order = [
      ['overdue', 'Overdue'],
      ['thisWeek', 'This week'],
      ['later', 'Later'],
      ['blocked', 'Blocked'],
      ['completed', 'Completed'],
    ];
    return order
      .filter(([key]) => groups[key].length)
      .map(([key, label]) => ({ key, label, rows: groups[key].sort(sortWithin) }));
  }

  global.TPAllLogic = { buildGroups, matchesQuery, statusPriority };
})(typeof window !== 'undefined' ? window : globalThis);
