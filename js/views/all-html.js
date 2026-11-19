/* views/all-html.js — All screen: search, sort/filter chips, grouped row cards */
(function (global) {
  function chip(label, active, attrs) {
    return `<button type="button" class="tp-a-chip${active ? ' tp-a-chip-active' : ''}" ${attrs}>${label}</button>`;
  }

  function rowHtml(row, ctx) {
    const {
      it, i,
    } = row;
    const {
      escapeHtml, isLocked, daysBetween, today, urgencyClass, relativeDueLabel,
      fmt, courseColorFor,
    } = ctx;
    const locked = isLocked(it);
    const daysLeft = it.due ? daysBetween(today(), it.due) : NaN;
    const overdue = !it.completed && !locked && !it.ignored && daysLeft < 0;
    const dt = it.dailyTarget;
    const cls = locked ? 'tp-locked' : (it.ignored || !it.due) ? '' : urgencyClass(daysLeft, it.completed);
    const color = it.course ? courseColorFor(it.course) : 'var(--text-faint)';
    const unit = it.unit || 'units';
    const pct = it.total > 0 ? Math.min(100, Math.round((it.done / it.total) * 100)) : 0;
    let statusText, statusClass;
    if (it.completed) { statusText = 'Done'; statusClass = 'tp-a-status-dim'; }
    else if (it.ignored) { statusText = 'Ignored'; statusClass = 'tp-a-status-dim'; }
    else if (locked) { statusText = 'Blocked'; statusClass = 'tp-a-status-dim'; }
    else if (overdue) { statusText = 'Overdue'; statusClass = 'tp-a-status-danger'; }
    else if (dt && dt.amt > 0) { statusText = `${dt.amt}/day`; statusClass = 'tp-a-status-accent'; }
    else { statusText = 'Open'; statusClass = 'tp-a-status-dim'; }
    return `<div class="tp-a-card ${cls} ${it.completed ? 'tp-a-done' : ''} ${locked ? 'tp-a-blocked-row' : ''}" id="tp-card-${i}" data-i="${i}">
      ${ctx.sortMode === 'custom' ? `<span class="tp-a-drag" data-i="${i}" aria-hidden="true">${window.TPIcons.svg('drag_indicator')}</span>` : ''}
      <span class="tp-a-bar" style="background:${color}"></span>
      <div class="tp-a-body">
        <div class="tp-a-title-line">
          <span class="tp-a-title${it.completed ? ' tp-a-title-done' : ''}">${escapeHtml(it.title)}</span>
          ${it.recurring ? window.TPIcons.svg('repeat', { className: 'tp-a-icon', title: 'Recurring' }) : ''}
          ${locked ? window.TPIcons.svg('lock_outline', { className: 'tp-a-icon', title: 'Blocked' }) : ''}
        </div>
        <div class="tp-a-meta">${[it.course, window.TPDue.label(it, relativeDueLabel), `${fmt(it.done)}/${fmt(it.total)} ${unit}`].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        ${it.total > 1 ? `<div class="tp-a-progress"><div class="tp-a-progress-fill" data-fill-key="${i}" style="width:${pct}%;background:${color}"></div></div>` : ''}
      </div>
      <div class="tp-a-status ${statusClass}">${escapeHtml(statusText)}</div>
    </div>`;
  }

  function groupHtml(group, ctx) {
    const esc = ctx.escapeHtml;
    let heading = '';
    if (group.course) {
      // Course sort: a section per course with a colour dot and how much is open.
      const count = group.empty ? '' : group.open ? `${group.open} open` : 'all done';
      heading = `<div class="tp-section-heading">
        <span class="tp-a-course-title"><span class="tp-g-dot" style="background:${ctx.courseColorFor(group.label)}"></span>${esc(group.label)}</span><span class="tp-section-rule"></span>${count ? `<span class="tp-section-count">${count}</span>` : ''}
      </div>`;
    } else if (group.label) {
      heading = `<div class="tp-section-heading${group.key === 'overdue' ? ' tp-a-heading-danger' : ''}${(group.key === 'completed' || group.key === 'ignored') ? ' tp-a-heading-dim' : ''}">
        <span>${esc(group.label)}</span><span class="tp-section-rule"></span>
      </div>`;
    }
    const empty = group.empty ? '<div class="tp-a-course-empty">No assignments yet</div>' : '';
    return heading + empty + group.rows.map(r => rowHtml(r, ctx)).join('');
  }

  // Everything that depends on the search text: the grouped rows (or the
  // empty state) and the footer hint below them. Rebuilt on every keystroke
  // in the search box, patched into #tp-a-results - the header above it
  // (title, search input, sort/course chips) is untouched, so the input
  // never loses focus.
  function resultsHtml(ctx) {
    const { escapeHtml, searchTerm, groups, itemsLength } = ctx;
    const totalShown = groups.reduce((s, g) => s + g.rows.length, 0) + groups.filter(g => g.empty).length;

    const body = totalShown === 0
      ? `<div class="tp-a-empty">${window.TPIcons.svg('file_search_outline')}
          <div>${itemsLength === 0 ? 'No assignments yet.' : `Nothing matches “${escapeHtml(searchTerm)}”`}</div>
        </div>`
      : groups.map(g => groupHtml(g, ctx)).join('');

    const footer = `<div class="tp-a-foot">
      <div class="tp-t-footer">Tap an assignment for actions</div>
      <button type="button" class="tp-s-link tp-a-add-manual" data-add-manual>Add an assignment by hand</button>
    </div>`;

    return body + footer;
  }

  function allScreenHtml(ctx) {
    const { escapeHtml, searchTerm, sortMode, filterCourse, courses } = ctx;

    const courseOptions = ['<option value="">All courses</option>'].concat(courses.map(c => {
      const sel = filterCourse && filterCourse.toLowerCase() === c.name.toLowerCase() ? ' selected' : '';
      return `<option value="${escapeHtml(c.name)}"${sel}>${escapeHtml(c.name)}</option>`;
    })).join('');

    const header = `<div class="tp-a-header">
      ${window.TPViews.screenHeaderHtml('All', ctx.hdr)}
      <div class="tp-a-search-wrap">
        ${window.TPIcons.svg('magnify', { className: 'tp-a-search-icon' })}
        <input id="tp-a-search" placeholder="Search title, course, unit..." value="${escapeHtml(searchTerm)}">
        <button type="button" id="tp-a-search-clear" class="tp-a-search-clear" aria-label="Clear search" ${searchTerm ? '' : 'hidden'}>${window.TPIcons.svg('close_circle')}</button>
      </div>
      <div class="tp-a-controls">
        <div class="tp-a-seg" role="group" aria-label="Sort">
          ${chip('Urgency', sortMode === 'urgency', `data-sort="urgency"`)}
          ${chip('Due', sortMode === 'due', `data-sort="due"`)}
          ${chip('Course', sortMode === 'course', `data-sort="course"`)}
        </div>
        <select id="tp-a-course" class="tp-a-select" aria-label="Filter by course">${courseOptions}</select>
      </div>
    </div>`;

    return `<div class="tp-screen tp-screen-all">${header}<div id="tp-a-results">${resultsHtml(ctx)}</div></div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.allScreenHtml = allScreenHtml;
  global.TPViews.allResultsHtml = resultsHtml;
})(typeof window !== 'undefined' ? window : globalThis);
