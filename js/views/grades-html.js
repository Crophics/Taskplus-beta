/* views/grades-html.js — Courses tab (grades overview) and Course detail.
   Numbers come from js/grades-logic.js; this file only lays them out.

   Render-loop rule (see AGENTS.md): typing a weight changes the grade summary
   and nothing else, so the weight inputs update the model and patch ONLY
   #tp-g-summary (summaryHtml) - the inputs themselves are never rebuilt. */
(function (global) {
  const fmtPct = (n) => (n === null || n === undefined ? '—' : (Math.round(n * 10) / 10) + '%');

  /* ---------------- Courses tab ---------------- */

  function courseCardHtml(r, ctx) {
    const { escapeHtml, relativeDueLabel } = ctx;
    const pct = r.pct === null ? '' : Math.max(0, Math.min(100, r.pct));
    const bar = r.pct === null ? '' : `<div class="tp-g-bar"><div class="tp-g-bar-fill" style="width:${pct}%;background:${r.color || 'var(--accent)'}"></div><span class="tp-g-bar-target" style="left:${Math.max(0, Math.min(100, r.target))}%"></span></div>`;
    const status = r.pct === null
      ? '<span class="tp-g-nograde">No grades yet</span>'
      : `<span class="tp-g-pct">${fmtPct(r.pct)}</span><span class="tp-g-letter${r.pct >= r.target ? ' tp-g-letter-ok' : ''}">${escapeHtml(r.letter || '')}</span>`;
    const next = r.next ? `Next: ${escapeHtml(r.next.name)} · ${escapeHtml(relativeDueLabel(r.next.due))}` : 'Nothing due soon';
    return `<button type="button" class="tp-g-card" data-course="${escapeHtml(r.name)}">
      <div class="tp-g-card-top">
        <div class="tp-g-card-main">
          <div class="tp-g-card-name"><span class="tp-g-dot" style="background:${r.color || 'var(--text-faint)'}"></span>${escapeHtml(r.name)}</div>
          <div class="tp-g-card-sub">${next}</div>
        </div>
        <div class="tp-g-card-grade">${status}</div>
      </div>
      ${bar}
    </button>`;
  }

  function coursesOverviewHtml(ctx) {
    const { rows, gpa, connected } = ctx;
    const subtitle = rows.length ? `${rows.length} course${rows.length === 1 ? '' : 's'}` : '';
    const header = `<div class="tp-a-header-top"><span class="tp-a-title-heading">Courses</span><span class="tp-a-count">${subtitle}</span></div>`;
    if (!rows.length) {
      return `<div class="tp-screen tp-screen-courses-overview">${header}
        <div class="tp-g-empty">
          <div class="tp-g-empty-title">${connected ? 'No grades yet' : 'Grades come from Moodle'}</div>
          <div>${connected
            ? 'Once Moodle reports grades for your courses they show up here. Tap Sync now in Settings to check.'
            : 'Connect Moodle and your courses, grades and targets appear here.'}</div>
          <button type="button" class="tp-g-link" id="tp-g-to-settings">Open Settings</button>
        </div>
      </div>`;
    }
    const gpaCard = gpa.gpa === null ? '' : `<div class="tp-g-gpa">
        <div><div class="tp-g-gpa-label">Projected GPA</div><div class="tp-g-gpa-value">${gpa.gpa.toFixed(2)}</div></div>
        <div class="tp-g-gpa-note">${gpa.courses} course${gpa.courses === 1 ? '' : 's'}, weighted by credits, using current grades</div>
      </div>`;
    return `<div class="tp-screen tp-screen-courses-overview">${header}${gpaCard}
      <div class="tp-g-list">${rows.map((r) => courseCardHtml(r, ctx)).join('')}</div>
      <div class="tp-g-footnote">The white tick marks each course's target grade.</div>
    </div>`;
  }

  /* ---------------- Course detail ---------------- */

  // The part that depends on the weights: patched on every keystroke.
  function summaryHtml(ctx) {
    const { calc, target, letter, escapeHtml } = ctx;
    const pct = calc.currentPct;
    let outlook = '';
    if (calc.source === 'weights') {
      if (calc.outlook === 'reachable') outlook = `To reach <b>${fmtPct(target)}</b>, average at least <b>${fmtPct(calc.needed)}</b> on the ${fmtPct(calc.remainingWeight)} of the course still to come.`;
      else if (calc.outlook === 'secured') outlook = `<b>${fmtPct(target)}</b> is already secured: even a 0 on the rest would finish at ${fmtPct(calc.earned)}.`;
      else if (calc.outlook === 'out-of-reach') outlook = `<b>${fmtPct(target)}</b> is out of reach. The most you can finish with is ${fmtPct(calc.maxPossible)}.`;
      else outlook = `All the weighted work is graded. The course stands at ${fmtPct(calc.earned)}.`;
    } else if (calc.source === 'moodle') {
      outlook = 'This is Moodle\'s own course total. Enter weights below to see what you need on the rest.';
    } else {
      outlook = 'No grades yet.';
    }
    const warns = [];
    if (calc.unweightedGraded > 0) warns.push(`${calc.unweightedGraded} graded item${calc.unweightedGraded === 1 ? ' has' : 's have'} no weight yet, so ${calc.unweightedGraded === 1 ? 'it is' : 'they are'} not counted.`);
    if (calc.overweight) warns.push('The weights add up to more than 100%.');
    else if (calc.source === 'weights' && calc.totalWeight < 99.5) warns.push(`Weights entered cover ${fmtPct(calc.totalWeight)} of the course. Add the rest for accurate numbers.`);
    return `<div class="tp-g-summary-top">
        <div><div class="tp-g-summary-label">Current grade</div><div class="tp-g-summary-pct">${fmtPct(pct)}</div></div>
        <div class="tp-g-summary-letter">${letter ? escapeHtml(letter) : ''}</div>
      </div>
      <div class="tp-g-outlook">${outlook}</div>
      ${warns.map((w) => `<div class="tp-g-warn">${escapeHtml(w)}</div>`).join('')}`;
  }

  function weightInputHtml(e, weights, escapeHtml) {
    const w = weights[e.id];
    const hasVal = w !== undefined && w !== null;
    return `<span class="tp-g-weight-wrap"><input class="tp-g-weight" inputmode="decimal" data-weight-id="${escapeHtml(e.id)}" value="${hasVal ? w : ''}" placeholder="${e.weightSuggested ? e.weightSuggested : '—'}" aria-label="Weight of ${escapeHtml(e.name)}, percent of course grade"><span class="tp-g-weight-pct">%</span></span>`;
  }

  function entryRowHtml(e, ctx) {
    const { escapeHtml, relativeDueLabel, weights } = ctx;
    const meta = [];
    if (e.pct !== null) meta.push(`<span class="tp-g-score">${fmtPct(e.pct)}</span>`);
    else if (e.due) meta.push(`<span>${escapeHtml(relativeDueLabel(e.due))}</span>`);
    if (e.pct === null && e.submitted) meta.push('<span class="tp-g-chip">Submitted</span>');
    return `<div class="tp-g-row">
      <div class="tp-g-row-main"><div class="tp-g-row-name">${escapeHtml(e.name)}</div><div class="tp-g-row-meta">${meta.join('')}</div></div>
      ${weightInputHtml(e, weights, escapeHtml)}
    </div>`;
  }

  function stepperHtml(label, id, value, suffix) {
    return `<div class="tp-g-stepper-row"><span class="tp-g-stepper-label">${label}</span>
      <span class="tp-g-stepper">
        <button type="button" class="tp-g-step" data-g-step="${id}" data-dir="-1" aria-label="Decrease ${label.toLowerCase()}">−</button>
        <span class="tp-g-step-val">${value}${suffix || ''}</span>
        <button type="button" class="tp-g-step" data-g-step="${id}" data-dir="1" aria-label="Increase ${label.toLowerCase()}">+</button>
      </span></div>`;
  }

  function courseDetailHtml(ctx) {
    const { escapeHtml, name, color, settingsForCourse, entries, weights, summary } = ctx;
    const header = `<button type="button" class="tp-c-back" id="tp-g-back">${window.TPIcons.svg('chevron_left')} Courses</button>
      <div class="tp-g-detail-title"><span class="tp-g-dot tp-g-dot-lg" style="background:${color || 'var(--text-faint)'}"></span>${escapeHtml(name)}</div>`;
    const anySuggestion = entries.coming.concat(entries.graded).some((e) => e.weightSuggested);
    const noneSet = !entries.coming.concat(entries.graded).some((e) => weights[e.id] > 0);
    const useSuggested = anySuggestion && noneSet
      ? `<button type="button" class="tp-g-link" id="tp-g-use-suggested">Use Moodle's weights</button>` : '';
    const coming = entries.coming.length ? `<div class="tp-section-heading"><span>Coming up</span><span class="tp-section-rule"></span><span class="tp-section-count">weight %</span></div>
      ${entries.coming.map((e) => entryRowHtml(e, ctx)).join('')}` : '';
    const graded = entries.graded.length ? `<div class="tp-section-heading"><span>Graded</span><span class="tp-section-rule"></span><span class="tp-section-count">weight %</span></div>
      ${entries.graded.map((e) => entryRowHtml(e, ctx)).join('')}` : '';
    const feedback = entries.graded.filter((e) => e.feedback).slice(0, 2);
    const feedbackHtml = feedback.length ? `<div class="tp-section-heading"><span>Teacher feedback</span><span class="tp-section-rule"></span></div>
      ${feedback.map((e) => `<div class="tp-g-feedback"><div class="tp-g-feedback-title">${escapeHtml(e.name)}</div>${escapeHtml(e.feedback)}</div>`).join('')}` : '';
    const empty = !entries.coming.length && !entries.graded.length ? '<div class="tp-g-empty-inline">Nothing from Moodle for this course yet.</div>' : '';
    return `<div class="tp-screen tp-screen-course">${header}
      <div class="tp-g-summary" id="tp-g-summary">${summary}</div>
      <div class="tp-g-settings">
        ${stepperHtml('Target', 'target', settingsForCourse.target, '%')}
        ${stepperHtml('Credits', 'credits', settingsForCourse.credits, '')}
      </div>
      <div class="tp-cls-edit"><label class="tp-cls-edit-label" for="tp-cls-input">Class times</label>
        <input type="text" id="tp-cls-input" class="tp-cls-input" data-course="${escapeHtml(name)}" value="${escapeHtml(ctx.meets || '')}" placeholder="MWF 10:00-10:50 Room 101" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <div class="tp-cls-hint">Days: M T W R(Thu) F S U. Separate several with ;</div></div>
      <div class="tp-g-weights-note">Weight is each item's share of the whole course grade, from your syllabus.</div>
      ${useSuggested}
      ${coming}${graded}${feedbackHtml}${empty}
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  Object.assign(global.TPViews, { coursesOverviewHtml, courseDetailHtml, gradeSummaryHtml: summaryHtml });
})(typeof window !== 'undefined' ? window : globalThis);
