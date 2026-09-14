/* views/all-html.js — All screen: search, sort/filter chips, grouped row cards */
(function (global) {
  function chip(label, active, attrs) {
    return `<button type="button" class="tp-a-chip${active ? ' tp-a-chip-active' : ''}" ${attrs}>${label}</button>`;
  }

  function courseFilterChipsHtml(courses, filterCourse) {
    const escapeHtml = window.TPHtml.escapeHtml;
    let html = chip('All courses', !filterCourse, `data-course-filter=""`);
    courses.forEach(c => {
      const active = filterCourse && filterCourse.toLowerCase() === c.name.toLowerCase();
      html += `<button type="button" class="tp-a-chip tp-a-course-chip${active ? ' tp-a-chip-active' : ''}" data-course-filter="${escapeHtml(c.name)}">
        <span class="tp-a-course-swatch" style="background:${c.color}"></span>${escapeHtml(c.name)}
      </button>`;
    });
    return html;
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
    const daysLeft = daysBetween(today(), it.due);
    const overdue = !it.completed && !locked && daysLeft < 0;
    const dt = it.dailyTarget;
    const cls = locked ? 'tp-locked' : urgencyClass(daysLeft, it.completed);
    const color = it.course ? courseColorFor(it.course) : 'var(--text-faint)';
    const unit = it.unit || 'units';
    const pct = it.total > 0 ? Math.min(100, Math.round((it.done / it.total) * 100)) : 0;
    let statusText, statusClass;
    if (it.completed) { statusText = 'Done'; statusClass = 'tp-a-status-dim'; }
    else if (locked) { statusText = 'Blocked'; statusClass = 'tp-a-status-dim'; }
    else if (overdue) { statusText = 'Overdue'; statusClass = 'tp-a-status-danger'; }
    else if (dt && dt.amt > 0) { statusText = `${dt.amt}/day`; statusClass = 'tp-a-status-accent'; }
    else { statusText = 'Open'; statusClass = 'tp-a-status-dim'; }
    return `<div class="tp-a-card ${cls} ${it.completed ? 'tp-a-done' : ''} ${locked ? 'tp-a-blocked-row' : ''}" id="tp-card-${i}" data-i="${i}">
      <span class="tp-a-drag" draggable="true" data-i="${i}" aria-hidden="true"><i class="nf nf-md-drag_horizontal_variant"></i></span>
      <span class="tp-a-bar" style="background:${color}"></span>
      <div class="tp-a-body">
        <div class="tp-a-title-line">
          <span class="tp-a-title${it.completed ? ' tp-a-title-done' : ''}">${escapeHtml(it.title)}</span>
          ${it.recurring ? `<i class="nf nf-md-repeat tp-a-icon" aria-hidden="true" title="Recurring"></i>` : ''}
          ${locked ? `<i class="nf nf-md-lock_outline tp-a-icon" aria-hidden="true" title="Blocked"></i>` : ''}
        </div>
        <div class="tp-a-meta">${[it.course, relativeDueLabel(it.due), `${fmt(it.done)}/${fmt(it.total)} ${unit}`].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        ${it.total > 1 ? `<div class="tp-a-progress"><div class="tp-a-progress-fill" data-fill-key="${i}" style="width:${pct}%;background:${color}"></div></div>` : ''}
      </div>
      <div class="tp-a-status ${statusClass}">${escapeHtml(statusText)}</div>
    </div>`;
  }

  function groupHtml(group, ctx) {
    const heading = group.label ? `<div class="tp-section-heading${group.key === 'overdue' ? ' tp-a-heading-danger' : ''}${group.key === 'completed' ? ' tp-a-heading-dim' : ''}">
      <span>${group.label}</span><span class="tp-section-rule"></span>
    </div>` : '';
    return heading + group.rows.map(r => rowHtml(r, ctx)).join('');
  }

  function allScreenHtml(ctx) {
    const { escapeHtml, searchTerm, sortMode, filterCourse, courses, groups, itemsLength } = ctx;
    const activeCount = groups.reduce((s, g) => s + g.rows.filter(r => !r.it.completed).length, 0);
    const totalShown = groups.reduce((s, g) => s + g.rows.length, 0);

    const header = `<div class="tp-a-header">
      <div class="tp-a-header-top"><span class="tp-a-title-heading">All</span><span class="tp-a-count">${activeCount} of ${itemsLength}</span></div>
      <div class="tp-a-search-wrap">
        <i class="nf nf-md-magnify tp-a-search-icon" aria-hidden="true"></i>
        <input id="tp-a-search" placeholder="Search title, course, unit..." value="${escapeHtml(searchTerm)}">
        ${searchTerm ? `<button type="button" id="tp-a-search-clear" class="tp-a-search-clear" aria-label="Clear search"><i class="nf nf-md-close_circle" aria-hidden="true"></i></button>` : ''}
      </div>
      <div class="tp-a-chips">
        ${chip('Urgency', sortMode === 'urgency', `data-sort="urgency"`)}
        ${chip('Due date', sortMode === 'due', `data-sort="due"`)}
        ${chip('Course', sortMode === 'course', `data-sort="course"`)}
      </div>
      <div class="tp-a-chips tp-a-chips-wrap">
        ${courseFilterChipsHtml(courses, filterCourse)}
      </div>
    </div>`;

    const body = totalShown === 0
      ? `<div class="tp-a-empty"><i class="nf nf-md-file_search_outline" aria-hidden="true"></i>
          <div>${itemsLength === 0 ? 'No assignments yet.' : `Nothing matches “${escapeHtml(searchTerm)}”`}</div>
        </div>`
      : groups.map(g => groupHtml(g, ctx)).join('');

    const footer = `<div class="tp-t-footer">Long-press a card for quick actions · drag the handle to reorder</div>`;

    return `<div class="tp-screen tp-screen-all">${header}${body}${footer}</div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.allScreenHtml = allScreenHtml;
})(typeof window !== 'undefined' ? window : globalThis);
