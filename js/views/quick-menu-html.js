/* views/quick-menu-html.js - The assignment menu on All: a bottom sheet (same family as the Add sheet).
   Opens on a tap. One clear primary action, a grouped list of the rest, Delete kept quiet at the bottom. */
(function (global) {
  function quickMenuHtml(ctx) {
    const { it, i, escapeHtml, relativeDueLabel, unit } = ctx;
    const chevron = global.TPIcons.svg('chevron_right');
    const row = (id, label) => `<button type="button" class="tp-qs-row" id="${id}" data-i="${i}"><span>${label}</span>${chevron}</button>`;

    const primary = [];
    if (!it.completed && it.total > 1) primary.push(`<button type="button" class="tp-i-primary" id="tp-qm-log" data-i="${i}">${global.TPIcons.svg('plus')}Log 1 ${escapeHtml(String(unit).replace(/s$/, ''))}</button>`);
    primary.push(it.completed
      ? `<button type="button" class="tp-i-secondary" id="tp-qm-complete" data-i="${i}">Reopen</button>`
      : `<button type="button" class="${it.total > 1 ? 'tp-i-secondary' : 'tp-i-primary'}" id="tp-qm-complete" data-i="${i}">${global.TPIcons.svg('check')}Mark complete</button>`);

    const rows = [];
    // Moodle work has its own page (time plan, parts, description, notes) that also holds Edit or delete,
    // so it gets that row and no Edit row; Moodle owns title, course and due date and would overwrite an edit.
    if (ctx.canOpen) rows.push(row('tp-qm-open', 'Plan and notes'));
    if (it.due && !ctx.imported) rows.push(row('tp-qm-push', 'Push out a day')); // Moodle owns the due date
    if (ctx.canIgnore) rows.push(row('tp-qm-ignore', 'Ignore (stop showing as overdue)'));
    else if (it.ignored) rows.push(row('tp-qm-unignore', 'Stop ignoring'));
    if (!ctx.canOpen || !ctx.imported) rows.push(row('tp-qm-edit', 'Edit assignment')); // your own work is always editable

    const meta = [window.TPDue.label(it, relativeDueLabel), it.ignored ? 'Ignored' : ''].filter(Boolean).map(escapeHtml).join(' · ');
    return `<div class="tp-backdrop" id="tp-qmenu-backdrop">
      <div class="tp-sheet tp-qsheet${ctx.menuJustOpened ? ' tp-sheet-enter' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(it.title)}">
        <div class="tp-sheet-handle"></div>
        <div class="tp-qs-head">
          <div class="tp-i-course"><span class="tp-i-dot" style="background:${ctx.color || 'var(--text-faint)'}"></span>${escapeHtml(it.course || 'No course')}</div>
          <div class="tp-qs-title">${escapeHtml(it.title)}</div>
          ${meta ? `<div class="tp-qs-meta">${meta}</div>` : ''}
        </div>
        <div class="tp-qs-primary">${primary.join('')}</div>
        <div class="tp-qs-list">${rows.join('')}</div>
        <button type="button" class="tp-qs-delete" id="tp-qm-delete" data-i="${i}">Delete</button>
      </div>
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.quickMenuHtml = quickMenuHtml;
})(typeof window !== 'undefined' ? window : globalThis);
