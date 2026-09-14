/* views/courses-html.js — Courses screen: CRUD over the courses collection */
(function (global) {
  function paletteSwatchesHtml(courseId, activeColor, swatchClass) {
    const PALETTE = window.TPCourses.PALETTE;
    return PALETTE.map(color => `<button type="button" class="${swatchClass}${color === activeColor ? ' tp-c-swatch-active' : ''}" style="background:${color}" data-course-id="${courseId || ''}" data-color="${color}" aria-label="Choose color ${color}"></button>`).join('');
  }

  function courseRowHtml(course, openCount, escapeHtml) {
    return `<div class="tp-c-row">
      <span class="tp-c-bar" style="background:${course.color}"></span>
      <div class="tp-c-body">
        <input class="tp-c-name" type="text" value="${escapeHtml(course.name)}" data-course-id="${course.id}">
        <div class="tp-c-sub">${openCount} open assignment${openCount === 1 ? '' : 's'}</div>
      </div>
      <button type="button" class="tp-c-delete" data-delete-course="${course.id}" aria-label="Delete ${escapeHtml(course.name)}"><i class="nf nf-md-trash_can_outline" aria-hidden="true"></i></button>
    </div>
    <div class="tp-c-palette">${paletteSwatchesHtml(course.id, course.color, 'tp-c-swatch')}</div>`;
  }

  function coursesScreenHtml(ctx) {
    const { escapeHtml, courses, openCountFor, draftName, draftColor } = ctx;
    const rows = courses.map(c => courseRowHtml(c, openCountFor(c.name), escapeHtml)).join('');
    const addDisabled = !draftName || !draftName.trim();
    return `<div class="tp-screen tp-screen-courses">
      <button type="button" class="tp-c-back" id="tp-c-back"><i class="nf nf-md-chevron_left" aria-hidden="true"></i> Settings</button>
      <div class="tp-a-header-top"><span class="tp-a-title-heading">Courses</span></div>
      <div class="tp-c-subhead">${courses.length} course${courses.length === 1 ? '' : 's'} · the assignment form offers these</div>
      ${rows}
      <div class="tp-section-heading"><span>Add a course</span><span class="tp-section-rule"></span></div>
      <input class="tp-c-new-name" id="tp-c-new-name" placeholder="Course code, e.g. PSY 101" value="${escapeHtml(draftName || '')}">
      <div class="tp-c-palette">${paletteSwatchesHtml('', draftColor, 'tp-c-new-swatch')}</div>
      <button type="button" class="tp-c-add-btn" id="tp-c-add" ${addDisabled ? 'disabled' : ''}>Add course</button>
      <div class="tp-c-footnote">These are the only courses the assignment form offers, so the free-text field is gone. A course's color drives its week-chart segments and the mark on every one of its cards.</div>
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.coursesScreenHtml = coursesScreenHtml;
})(typeof window !== 'undefined' ? window : globalThis);
