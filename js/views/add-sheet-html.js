/* views/add-sheet-html.js — Bottom sheet for adding/editing an assignment. */
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
      ${window.TPIcons.svg('chevron_down')}
    </button>`;
  }

  function coursePickerListHtml(courses, selectedId, escapeHtml) {
    const rows = courses.map(c => `<div class="tp-add-course-option" data-course-id="${c.id}">
      <span class="tp-add-course-swatch" style="background:${c.color}"></span>${escapeHtml(c.name)}
      ${c.id === selectedId ? window.TPIcons.svg('check') : ''}
    </div>`).join('');
    return `<div class="tp-add-course-list" id="tp-add-course-list">
      ${rows}
      <div class="tp-add-course-manage" id="tp-add-manage-courses">Manage courses…</div>
    </div>`;
  }

  function moreSectionHtml(ctx, draft, selectedCourse, escapeHtml) {
    const hasExtras = !!(draft.notes || (draft.subtasksText || '').trim() || draft.recurring || draft.dependsOn);
    const moreOpen = ctx.moreOpen || (ctx.isEdit && hasExtras);
    const subCount = (draft.subtasksText || '').split('\n').map(s => s.trim()).filter(Boolean).length;

    // Dependencies match on title and are same-course only, per js/item-logic.js.
    const prereqs = ctx.items.filter(it =>
      it.course === (selectedCourse ? selectedCourse.name : '') &&
      !it.completed &&
      it.title !== draft.title);

    const repeatOpt = (label, val) =>
      `<button type="button" class="tp-add-seg-opt" data-repeat="${val}" aria-pressed="${(draft.recurring || '') === val}">${label}</button>`;

    const moreBody = moreOpen ? `
      <div class="tp-sheet-label" id="tp-lbl-notes">Notes</div>
      <textarea class="tp-add-textarea" id="tp-add-notes" rows="2"
        aria-labelledby="tp-lbl-notes"
        placeholder="Anything to remember">${escapeHtml(draft.notes || '')}</textarea>

      <div class="tp-sheet-label" id="tp-lbl-subtasks">Subtasks</div>
      <textarea class="tp-add-textarea" id="tp-add-subtasks" rows="3"
        aria-labelledby="tp-lbl-subtasks"
        placeholder="One per line">${escapeHtml(draft.subtasksText || '')}</textarea>
      <div class="tp-add-sublabel">${subCount ? subCount + (subCount === 1 ? ' subtask' : ' subtasks') : 'Each line becomes its own checkbox.'}</div>

      <div class="tp-sheet-label">Repeat</div>
      <div class="tp-add-seg" role="group" aria-label="Repeat">
        ${repeatOpt('Never', '')}${repeatOpt('Weekly', 'weekly')}${repeatOpt('Monthly', 'monthly')}
      </div>
      <div class="tp-add-sublabel">${draft.recurring
        ? `Completing it creates the next one automatically, due a ${draft.recurring === 'weekly' ? 'week' : 'month'} later.`
        : 'Completing it closes it out for good.'}</div>

      <div class="tp-sheet-label">Do this after</div>
      ${prereqs.length ? `
        <div class="tp-add-course-field">
          <button type="button" class="tp-add-course-trigger" id="tp-add-prereq-trigger" aria-expanded="${ctx.prereqOpen}">
            <span class="tp-add-course-name">${draft.dependsOn ? escapeHtml(draft.dependsOn) : 'No prerequisite'}</span>
            ${window.TPIcons.svg('chevron_down')}
          </button>
          ${ctx.prereqOpen ? `<div class="tp-add-course-list" id="tp-add-prereq-list">
            <div class="tp-add-course-option" data-prereq="">No prerequisite${!draft.dependsOn ? ` ${window.TPIcons.svg('check')}` : ''}</div>
            ${prereqs.map(p => `<div class="tp-add-course-option" data-prereq="${escapeHtml(p.title)}">${escapeHtml(p.title)}${draft.dependsOn === p.title ? ` ${window.TPIcons.svg('check')}` : ''}</div>`).join('')}
          </div>` : ''}
        </div>
        <div class="tp-add-sublabel">Stays locked until that one is done. Same course only.</div>
      ` : `<div class="tp-add-sublabel">Nothing else open in ${selectedCourse ? escapeHtml(selectedCourse.name) : 'this course'} yet — add a second assignment to that course and you can chain them.</div>`}
    ` : '';

    return `<button type="button" class="tp-sheet-more" id="tp-add-more" aria-expanded="${moreOpen}">
      ${window.TPIcons.svg('chevron_down')}
      ${moreOpen ? 'Fewer options' : 'Notes, subtasks, repeat, dependency'}
    </button>
    ${moreBody}`;
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

        <div class="tp-sheet-label" id="tp-lbl-course">Course</div>
        <div class="tp-add-course-field">
          ${coursePickerTriggerHtml(selectedCourse, pickerOpen)}
          ${pickerOpen ? coursePickerListHtml(courses, draft.courseId, escapeHtml) : ''}
        </div>

        <div class="tp-sheet-label" id="tp-lbl-due">Due</div>
        <input class="tp-add-input" id="tp-add-due" type="date" value="${draft.due || ''}" aria-labelledby="tp-lbl-due">

        <div class="tp-sheet-label">How much</div>
        <div class="tp-add-amount-row">
          <button type="button" class="tp-add-stepper" id="tp-add-minus" aria-label="Decrease amount">−</button>
          <input class="tp-add-amount" id="tp-add-amount" type="number" inputmode="numeric" pattern="[0-9]*" min="1" value="${draft.amount || 1}">
          <button type="button" class="tp-add-stepper" id="tp-add-plus" aria-label="Increase amount">+</button>
          <input class="tp-add-unit" id="tp-add-unit" placeholder="unit (pages, problems...)" value="${escapeHtml(draft.unit || '')}">
        </div>
        ${pacingHintHtml(draft, today, daysBetween)}
        ${moreSectionHtml(ctx, draft, selectedCourse, escapeHtml)}
        <button type="button" class="tp-add-submit" id="tp-add-submit">${isEdit ? 'Save changes' : 'Add assignment'}</button>
      </div>
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.addSheetHtml = addSheetHtml;
})(typeof window !== 'undefined' ? window : globalThis);
