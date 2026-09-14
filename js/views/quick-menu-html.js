/* views/quick-menu-html.js — Long-press quick-action menu for a row */
(function (global) {
  function quickMenuHtml(ctx) {
    const { it, i, escapeHtml, relativeDueLabel, unit } = ctx;
    const actions = [];
    if (!it.completed && it.total > 1) actions.push(`<button type="button" class="tp-qm-action" id="tp-qm-log" data-i="${i}">Log 1 ${escapeHtml(unit)}</button>`);
    actions.push(`<button type="button" class="tp-qm-action tp-qm-accent" id="tp-qm-complete" data-i="${i}">${it.completed ? 'Reopen' : 'Mark complete'}</button>`);
    actions.push(`<button type="button" class="tp-qm-action" id="tp-qm-push" data-i="${i}">Push out a day</button>`);
    actions.push(`<button type="button" class="tp-qm-action" id="tp-qm-edit" data-i="${i}">Edit details</button>`);
    actions.push(`<button type="button" class="tp-qm-action tp-qm-danger" id="tp-qm-delete" data-i="${i}">Delete</button>`);
    return `<div class="tp-backdrop tp-qmenu-backdrop" id="tp-qmenu-backdrop">
      <div class="tp-qmenu" role="dialog" aria-modal="true">
        <div class="tp-qmenu-header">
          <div class="tp-t-title">${escapeHtml(it.title)}</div>
          <div class="tp-t-meta">${[it.course, relativeDueLabel(it.due)].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        </div>
        ${actions.join('')}
      </div>
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.quickMenuHtml = quickMenuHtml;
})(typeof window !== 'undefined' ? window : globalThis);
