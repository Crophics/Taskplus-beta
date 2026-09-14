/* views/add-sheet-html.js — Bottom sheet for adding/editing an assignment.
   Deliberately matches the design's fields only (title/course/due/amount+unit) -
   the mobile rebuild drops notes/subtasks/recurring/"do this after" from the
   create flow; existing items with that data keep working elsewhere (locking,
   etc), they're just not editable from this sheet.
*/
(function (global) {
  function pacingHintHtml(draft, todayFn, daysBetween) {
    if (!draft.due) return '';
    const amount = Number(draft.amount) || 1;
    const daysOut = daysBetween(todayFn(), draft.due);
    if (daysOut < 0) return `<div class="tp-add-hint">That date has passed — it lands overdue.</div>`;
    if (amount <= 1) {
      return daysOut <= 1
        ? `<div class="tp-add-hint">Due ${daysOut === 0 ? 'today' : 'tomorrow'}. One sitting, so it surfaces the day before.</div>`
        : `<div class="tp-add-hint">Due in ${daysOut} days. One sitting, so it surfaces the day before.</div>`;
    }
    const target = Math.ceil(amount / Math.max(daysOut, 1));
    const unit = draft.unit || 'units';
    return `<div class="tp-add-hint">Due in ${daysOut} day${daysOut === 1 ? '' : 's'}. Paces to ${target} ${unit} a day to finish on time.</div>`;
  }

  function coursePickerTriggerHtml(course, pickerOpen) {
    const swatch = course ? `<span class="tp-add-course-swatch" style="background:${course.color}"></span>` : `<span class="tp-add-course-swatch tp-add-course-swatch-empty"></span>`;
    return `<button type="button" class="tp-add-course-trigger" id="tp-add-course-trigger" aria-expanded="${pickerOpen}">
      ${swatch}<span class="tp-add-course-name">${course ? course.name : 'Choose a course'}</span>
      <i class="nf nf-md-chevron_down" aria-hidden="true"></i>
    </button>`;
  }

  function coursePickerListHtml(courses, selectedId, escapeHtml) {
    const rows = courses.map(c => `<div class="tp-add-course-option" data-course-id="${c.id}">
      <span class="tp-add-course-swatch" style="background:${c.color}"></span>${escapeHtml(c.name)}
      ${c.id === selectedId ? `<i class="nf nf-md-check" aria-hidden="true"></i>` : ''}
    </div>`).join('');
    return `<div class="tp-add-course-list" id="tp-add-course-list">
      ${rows}
      <div class="tp-add-course-manage" id="tp-add-manage-courses">Manage courses…</div>
    </div>`;
  }

  function addSheetHtml(ctx) {
    const { draft, courses, pickerOpen, escapeHtml, today, daysBetween, isEdit } = ctx;
    const selectedCourse = window.TPCourses.byId(courses, draft.courseId);
    return `<div class="tp-backdrop" id="tp-sheet-backdrop">
      <div class="tp-sheet" id="tp-sheet" role="dialog" aria-modal="true" aria-label="${isEdit ? 'Edit assignment' : 'New assignment'}">
        <div class="tp-sheet-handle"></div>
        <div class="tp-sheet-header">
          <span class="tp-sheet-title">${isEdit ? 'Edit assignment' : 'New assignment'}</span>
          <button type="button" class="tp-sheet-cancel" id="tp-sheet-cancel">Cancel</button>
        </div>
        <input class="tp-add-input" id="tp-add-title" placeholder="Title" value="${escapeHtml(draft.title || '')}">
        <div class="tp-add-course-field">
          ${coursePickerTriggerHtml(selectedCourse, pickerOpen)}
          ${pickerOpen ? coursePickerListHtml(courses, draft.courseId, escapeHtml) : ''}
        </div>
        <input class="tp-add-input" id="tp-add-due" type="date" value="${draft.due || ''}" aria-label="Due date">
        <div class="tp-add-amount-row">
          <button type="button" class="tp-add-stepper" id="tp-add-minus" aria-label="Decrease amount">−</button>
          <input class="tp-add-amount" id="tp-add-amount" type="number" inputmode="numeric" pattern="[0-9]*" min="1" value="${draft.amount || 1}">
          <button type="button" class="tp-add-stepper" id="tp-add-plus" aria-label="Increase amount">+</button>
          <input class="tp-add-unit" id="tp-add-unit" placeholder="unit (pages, problems...)" value="${escapeHtml(draft.unit || '')}">
        </div>
        ${pacingHintHtml(draft, today, daysBetween)}
        <button type="button" class="tp-add-submit" id="tp-add-submit">${isEdit ? 'Save changes' : 'Add assignment'}</button>
      </div>
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.addSheetHtml = addSheetHtml;
})(typeof window !== 'undefined' ? window : globalThis);
