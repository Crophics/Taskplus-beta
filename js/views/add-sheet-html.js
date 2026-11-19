/* views/add-sheet-html.js — Bottom sheet for adding/editing an assignment. */
(function (global) {
  // Returns just the hint text - js/bind-events.js patches #tp-add-hint's innerHTML directly when the due
  // date or time changes, and the wrapper div lives in the template below so patching can't nest a div in itself.
  // The wording follows js/due-time.js: due before 12:00 = finish the day before; at or after 12:00 = the
  // due-day morning counts as half a work day.
  function pacingHintHtml(draft, todayFn, daysBetween) {
    if (!draft.due) return '';
    const daysOut = daysBetween(todayFn(), draft.due);
    if (daysOut < 0) return `That date has passed — it lands overdue.`;
    const t = draft.dueTime || '';
    const usable = !!(global.TPDue && global.TPDue.morningUsable({ dueTime: t }));
    if (!t) return 'No time set, so Taskplus plans to finish it the day before.';
    return usable
      ? 'Due at or after noon, so the morning of the due day counts as half a work day.'
      : 'Due before noon, so Taskplus plans to finish it the day before.';
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

  function moreSectionHtml(ctx, draft, escapeHtml) {
    const hasExtras = !!(draft.notes || (draft.subtasksText || '').trim());
    const moreOpen = ctx.moreOpen || (ctx.isEdit && hasExtras);
    const subCount = (draft.subtasksText || '').split('\n').map(s => s.trim()).filter(Boolean).length;

    const moreBody = moreOpen ? `
      <div class="tp-sheet-label" id="tp-lbl-notes">Notes</div>
      <textarea class="tp-add-textarea" id="tp-add-notes" rows="2"
        aria-labelledby="tp-lbl-notes"
        placeholder="Anything to remember">${escapeHtml(draft.notes || '')}</textarea>

      <div class="tp-sheet-label" id="tp-lbl-subtasks">Subtasks</div>
      <textarea class="tp-add-textarea" id="tp-add-subtasks" rows="3"
        aria-labelledby="tp-lbl-subtasks"
        placeholder="One per line">${escapeHtml(draft.subtasksText || '')}</textarea>
      <div class="tp-add-sublabel" id="tp-add-subcount">${subCount ? subCount + (subCount === 1 ? ' subtask' : ' subtasks') : 'Each line becomes its own checkbox.'}</div>
    ` : '';

    return `<button type="button" class="tp-sheet-more" id="tp-add-more" aria-expanded="${moreOpen}">
      ${window.TPIcons.svg('chevron_down')}
      ${moreOpen ? 'Fewer options' : 'Notes, subtasks'}
    </button>
    ${moreBody}`;
  }

  function addSheetHtml(ctx) {
    const { draft, courses, pickerOpen, escapeHtml, today, daysBetween, isEdit } = ctx;
    const selectedCourse = window.TPCourses.byId(courses, draft.courseId);
    return `<div class="tp-backdrop" id="tp-sheet-backdrop">
      <div class="tp-sheet${ctx.sheetJustOpened ? ' tp-sheet-enter' : ''}" id="tp-sheet" role="dialog" aria-modal="true" aria-label="${isEdit ? 'Edit assignment' : 'New assignment'}">
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
        <div class="tp-add-due-row">
          <input class="tp-add-input" id="tp-add-due" type="date" value="${draft.due || ''}" aria-labelledby="tp-lbl-due">
          <input class="tp-add-input" id="tp-add-due-time" type="time" value="${draft.dueTime || ''}" aria-label="Due time (optional)">
        </div>
        <div class="tp-add-hint" id="tp-add-hint">${pacingHintHtml(draft, today, daysBetween)}</div>

        <div class="tp-sheet-label" id="tp-lbl-desc">Description</div>
        <textarea class="tp-add-textarea" id="tp-add-desc" rows="4" aria-labelledby="tp-lbl-desc"
          placeholder="What is it? Paste the instructions, length, what to hand in">${escapeHtml(draft.description || '')}</textarea>

        <div class="tp-sheet-label" id="tp-lbl-minutes">Time estimate</div>
        <input class="tp-add-input" id="tp-add-minutes" type="number" inputmode="numeric" min="5" step="5"
          aria-labelledby="tp-lbl-minutes" placeholder="Minutes in total, e.g. 90" value="${draft.minutes || ''}">
        <div class="tp-add-sublabel">Optional. Your own guess; it counts toward Today's time and the Week chart.</div>
        ${moreSectionHtml(ctx, draft, escapeHtml)}
        <button type="button" class="tp-add-submit" id="tp-add-submit">${isEdit ? 'Save changes' : 'Add assignment'}</button>
      </div>
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.addSheetHtml = addSheetHtml;
  global.TPViews.pacingHintHtml = pacingHintHtml;
})(typeof window !== 'undefined' ? window : globalThis);
