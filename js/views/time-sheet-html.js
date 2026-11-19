/* views/time-sheet-html.js - "How long did it take?" bottom sheet shown right after finishing an assignment.
   One tap on a time records it; Skip (or tapping outside) closes it. It never blocks anything. */
(function (global) {
  const CHOICES = [15, 30, 45, 60, 90, 120, 180, 240];

  function chipLabel(m) {
    if (m < 60) return m + 'm';
    const h = m / 60;
    return (Number.isInteger(h) ? h : Math.round(h * 10) / 10) + 'h';
  }

  function timeSheetHtml(ctx) {
    const { it, escapeHtml, estimateText } = ctx;
    const chips = CHOICES.map((m) => `<button type="button" class="tp-time-chip" data-minutes="${m}">${chipLabel(m)}</button>`).join('');
    return `<div class="tp-backdrop" id="tp-time-backdrop">
      <div class="tp-sheet tp-qsheet${ctx.justOpened ? ' tp-sheet-enter' : ''}" role="dialog" aria-modal="true" aria-label="How long did it take?">
        <div class="tp-sheet-handle"></div>
        <div class="tp-qs-head">
          <div class="tp-i-course"><span class="tp-i-dot" style="background:${ctx.color || 'var(--text-faint)'}"></span>${escapeHtml(it.course || 'No course')}</div>
          <div class="tp-qs-title">How long did it take?</div>
          <div class="tp-qs-meta">${escapeHtml(it.title)}${estimateText ? ' · estimated ' + escapeHtml(estimateText) : ''}</div>
        </div>
        <div class="tp-time-chips">${chips}</div>
        <div class="tp-time-other">
          <input type="number" inputmode="numeric" min="1" max="1440" step="1" id="tp-time-input" class="tp-time-input" placeholder="Other, in minutes" aria-label="Other time in minutes">
          <button type="button" class="tp-i-secondary tp-time-save" id="tp-time-save">Save</button>
        </div>
        <button type="button" class="tp-qs-delete tp-time-skip" id="tp-time-skip">Skip</button>
      </div>
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.timeSheetHtml = timeSheetHtml;
})(typeof window !== 'undefined' ? window : globalThis);
