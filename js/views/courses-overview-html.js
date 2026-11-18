/* views/courses-overview-html.js — Courses tab (one card per course) and Course detail
   (open work + class times). Plain layout only; the numbers come from TPCourses.overview /
   TPCourses.openItemsForCourse. There are no grades in the app: Moodle stays the place for those. */
(function (global) {
  /* ---------------- Courses tab ---------------- */

  function courseCardHtml(r, ctx) {
    const { escapeHtml, relativeDueLabel } = ctx;
    const next = r.next ? `Next: ${escapeHtml(r.next.title)} · ${escapeHtml(relativeDueLabel(r.next.due))}` : (r.open ? 'Nothing due soon' : r.total ? 'All caught up' : 'No assignments yet');
    const status = r.open
      ? `<span class="tp-g-pct">${r.open}</span><span class="tp-g-nograde">${r.overdue ? r.overdue + ' overdue' : 'open'}</span>`
      : (r.total ? '<span class="tp-g-nograde">Done</span>' : '');
    return `<button type="button" class="tp-g-card" data-course="${escapeHtml(r.name)}">
      <div class="tp-g-card-top">
        <div class="tp-g-card-main">
          <div class="tp-g-card-name"><span class="tp-g-dot" style="background:${r.color || 'var(--text-faint)'}"></span>${escapeHtml(r.name)}</div>
          <div class="tp-g-card-sub">${next}</div>
        </div>
        <div class="tp-g-card-grade">${status}</div>
      </div>
    </button>`;
  }

  function coursesOverviewHtml(ctx) {
    const { rows, connected } = ctx;
    const subtitle = rows.length ? `${rows.length} course${rows.length === 1 ? '' : 's'}` : '';
    const header = window.TPViews.screenHeaderHtml('Courses', ctx.hdr, subtitle);
    if (!rows.length) {
      return `<div class="tp-screen tp-screen-courses-overview">${header}
        <div class="tp-g-empty">
          <div class="tp-g-empty-title">No courses yet</div>
          <div>${connected
            ? 'Your courses appear here after the next sync. Tap Sync now in Settings to check.'
            : 'Connect Moodle and your courses and assignments appear here.'}</div>
          <button type="button" class="tp-g-link" id="tp-g-to-settings">Open Settings</button>
        </div>
      </div>`;
    }
    return `<div class="tp-screen tp-screen-courses-overview">${header}
      <div class="tp-g-list">${rows.map((r) => courseCardHtml(r, ctx)).join('')}</div>
    </div>`;
  }

  /* ---------------- Course detail ---------------- */

  function openRowHtml(it, ctx) {
    const { escapeHtml, relativeDueLabel } = ctx;
    const due = it.due ? `<span>${escapeHtml(relativeDueLabel(it.due))}</span>` : '<span>No due date</span>';
    return `<div class="tp-g-row"><div class="tp-g-row-main"><div class="tp-g-row-name">${escapeHtml(it.title)}</div><div class="tp-g-row-meta">${due}</div></div></div>`;
  }

  function courseDetailHtml(ctx) {
    const { escapeHtml, name, color, upcoming, ignored = [] } = ctx;
    const header = `<button type="button" class="tp-c-back" id="tp-g-back">${window.TPIcons.svg('chevron_left')} Courses</button>
      <div class="tp-g-detail-title"><span class="tp-g-dot tp-g-dot-lg" style="background:${color || 'var(--text-faint)'}"></span>${escapeHtml(name)}</div>`;
    const open = upcoming.length
      ? `<div class="tp-section-heading"><span>Open work</span><span class="tp-section-rule"></span><span class="tp-section-count">${upcoming.length}</span></div>
      ${upcoming.map((it) => openRowHtml(it, ctx)).join('')}`
      : '<div class="tp-g-empty-inline">Nothing open for this course.</div>';
    return `<div class="tp-screen tp-screen-course">${header}
      <div class="tp-cls-edit"><label class="tp-cls-edit-label" for="tp-cls-input">Class times</label>
        <input type="text" id="tp-cls-input" class="tp-cls-input" data-course="${escapeHtml(name)}" value="${escapeHtml(ctx.meets || '')}" placeholder="MWF 10:00-10:50 Room 101" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <div class="tp-cls-hint">Days: M T W R(Thu) F S U. Separate several with ;</div></div>
      ${open}
      ${ignored.length ? `<div class="tp-section-heading tp-a-heading-dim"><span>Ignored</span><span class="tp-section-rule"></span><span class="tp-section-count">${ignored.length}</span></div>
      ${ignored.map((it) => openRowHtml(it, ctx)).join('')}
      <div class="tp-cls-hint">Ignored work no longer shows as overdue. Restore it from the All screen.</div>` : ''}
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  Object.assign(global.TPViews, { coursesOverviewHtml, courseDetailHtml });
})(typeof window !== 'undefined' ? window : globalThis);
