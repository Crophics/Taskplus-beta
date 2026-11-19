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
      // Every course gets its section, even one with no assignments yet (unless a search or course filter narrows the list).
      if (!query && !filterCourse) {
        const have = new Set([...byCourse.keys()].map(k => k.toLowerCase()));
        (ctx.courses || []).forEach(c => {
          const name = String(c.name || '').trim();
          if (name && !have.has(name.toLowerCase())) { byCourse.set(name, []); have.add(name.toLowerCase()); }
        });
      }
      return [...byCourse.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, groupRows]) => ({
          key, label: key, course: true, empty: groupRows.length === 0,
          open: groupRows.filter(r => !r.it.completed && !r.it.ignored).length,
          rows: groupRows.sort(byStatusThenDue),
        }));
    }

    // Urgency / Due date: group into Overdue / This week / Later / Blocked / Completed.
    const groups = { overdue: [], thisWeek: [], later: [], noDue: [], blocked: [], ignored: [], completed: [] };
    rows.forEach(r => {
      const it = r.it;
      if (it.completed) { groups.completed.push(r); return; }
      if (it.ignored) { groups.ignored.push(r); return; }
      if (isLocked(it)) { groups.blocked.push(r); return; }
      if (!it.due) { groups.noDue.push(r); return; }
      const d = daysBetween(today(), it.due);
      if (d < 0 || (global.TPDue && global.TPDue.isOverdue(it, today()))) groups.overdue.push(r);
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
      ['noDue', 'No due date'],
      ['blocked', 'Blocked'],
      ['ignored', 'Ignored'],
      ['completed', 'Completed'],
    ];
    // Undated and ignored work has no date to order by: alphabetical.
    const byTitle = (a, b) => (a.it.title || '').localeCompare(b.it.title || '');
    return order
      .filter(([key]) => groups[key].length)
      .map(([key, label]) => ({ key, label, rows: groups[key].sort(key === 'noDue' || key === 'ignored' ? byTitle : sortWithin) }));
  }

  global.TPAllLogic = { buildGroups, matchesQuery, statusPriority };
})(typeof window !== 'undefined' ? window : globalThis);
