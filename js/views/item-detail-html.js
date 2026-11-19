/* views/item-detail-html.js — Assignment detail, plan first.
   Opens from a Today row for imported (Moodle) work. Leads with the time
   estimate and the parts it is split into, then the Moodle description, notes
   and actions. Typing in Notes is model-only (see AGENTS.md: render loop). */
(function (global) {
  const P = () => global.TPPlan;
  const fmt = (m) => P().fmtMinutes(P().roundDisplay(m));

  const SURE = { low: 'not very sure', medium: 'fairly sure', high: 'quite sure' };

  const PROVIDER_NAME = { claude: 'Claude', gemini: 'Gemini' };

  function basisCaption(est) {
    if (est.basis === 'user') return 'You set this';
    if (est.basis === 'quiz-limit') return 'From the quiz time limit';
    if (est.basis === 'model') return `${PROVIDER_NAME[est.provider] || 'AI'} estimate · ${SURE[est.confidence] || 'not very sure'}`;
    return 'A rough guess';
  }

  const SKIP_WHY = {
    too_large: 'is too large to read', not_pdf: 'is not a PDF', too_many: 'was beyond the first 2 files', bad_url: 'could not be fetched',
    unavailable: 'could not be downloaded right now', redirected: 'could not be downloaded right now', not_a_pdf: 'did not turn out to be a PDF',
    file_limit: 'was left for tomorrow (daily limit)',
  };

  // "Claude also read: Assignment 6.pdf" or why it could not. Server-reported, not the model's claim.
  function readLineHtml(est, escapeHtml) {
    const read = est.filesRead || [];
    const skipped = (est.filesSkipped || []).filter((s) => s.reason !== 'not_pdf');
    const parts = [];
    if (read.length) parts.push(`${PROVIDER_NAME[est.provider] || 'The AI'} also read ${read.map(escapeHtml).join(' and ')}.`);
    skipped.slice(0, 2).forEach((s) => parts.push(`${escapeHtml(s.name)} ${SKIP_WHY[s.reason] || 'was not read'}.`));
    return parts.length ? `<div class="tp-i-est-why tp-i-read">${parts.join(' ')}</div>` : '';
  }

  function estimateCardHtml(ctx) {
    const { item, escapeHtml } = ctx;
    const est = item.estimate;
    const minus = `<button type="button" class="tp-i-step" data-delta="-15" aria-label="15 minutes less">−15m</button>`;
    const plus = `<button type="button" class="tp-i-step" data-delta="15" aria-label="15 minutes more">+15m</button>`;
    const reset = est.basis === 'user' ? `<button type="button" class="tp-i-reset" id="tp-i-reset">Use the automatic estimate</button>` : '';
    const range = est.basis === 'user' || est.low === est.high ? ''
      : `<div class="tp-i-est-range">Likely ${escapeHtml(fmt(est.low))} to ${escapeHtml(fmt(est.high))}</div>`;
    const why = est.basis === 'user'
      ? ''
      : est.basis === 'model'
        ? `<div class="tp-i-est-why">${escapeHtml((est.factors || [])[0] || 'The AI read the assignment description.')} Change it if you know better.</div>${readLineHtml(est, escapeHtml)}`
        : `<div class="tp-i-est-why">Based on: ${escapeHtml((est.factors || []).join(', ') || 'the details from Moodle')}. ${est.basis === 'heuristic' ? 'It is a rule of thumb, so change it if you know better.' : 'Study time is a guess; change it if you know better.'}</div>`;
    const learned = est.learned && est.basis !== 'user'
      ? `<div class="tp-i-est-why">Adjusted using ${est.learned.n} similar finished ${escapeHtml(est.learned.label || 'assignments')} (you took about ${Math.round(est.learned.factor * 100)}% of the estimate).</div>` : '';
    const ask = ctx.llm && ctx.llm.available
      ? `<button type="button" class="tp-i-ask" id="tp-i-ask"${ctx.llm.busy ? ' disabled' : ''}>${ctx.llm.busy ? 'Asking…' : (est.basis === 'model' ? 'Ask again' : 'Ask AI to estimate')}</button>`
      : '';
    return `<section class="tp-i-card" id="tp-i-estimate">
      <div class="tp-i-card-label"><span>Time estimate</span><span class="tp-i-basis">${escapeHtml(basisCaption(est))}</span></div>
      <div class="tp-i-est-main">About ${escapeHtml(fmt(est.minutes))}</div>
      ${range}${why}${learned}
      <div class="tp-i-stepper">${minus}${plus}</div>
      ${ask}${reset}
    </section>`;
  }

  /** The plan editor: finished parts are locked; the rest can be renamed, retimed, removed, and parts added. */
  function planEditorHtml(ctx) {
    const { escapeHtml } = ctx;
    const d = ctx.planDraft;
    const max = global.TPEstimate.MAX_PARTS;
    const rows = d.rows.map((r, i) => {
      if (i < d.locked) {
        return `<div class="tp-pe-row tp-pe-locked"><span class="tp-i-part-circle tp-pe-check">${global.TPIcons.svg('check')}</span><span class="tp-pe-fixed">${escapeHtml(r.name)}</span><span class="tp-i-part-min">${escapeHtml(fmt(r.minutes))}</span></div>`;
      }
      const only = d.rows.length - d.locked <= 1;
      return `<div class="tp-pe-row">
        <input type="text" class="tp-pe-name" data-r="${i}" maxlength="60" value="${escapeHtml(r.name)}" placeholder="Part ${i + 1}" aria-label="Name of part ${i + 1}">
        <div class="tp-pe-sub">
          <input type="number" class="tp-pe-min" data-r="${i}" inputmode="numeric" min="5" max="600" step="5" value="${Number(r.minutes) || ''}" aria-label="Minutes for part ${i + 1}">
          <span class="tp-pe-unit">min</span>
          <button type="button" class="tp-pe-del" data-r="${i}" aria-label="Remove part ${i + 1}"${only ? ' disabled' : ''}>×</button>
        </div>
      </div>`;
    }).join('');
    const total = d.rows.reduce((s, r) => s + (Number(r.minutes) || 0), 0);
    return `<div class="tp-section-heading"><span>Edit plan</span><span class="tp-section-rule"></span><span class="tp-section-count" id="tp-pe-count">${d.rows.length} of ${max} parts</span></div>
      <div class="tp-pe">${rows}</div>
      <div class="tp-pe-total">Total <span id="tp-pe-total">${escapeHtml(fmt(total))}</span></div>
      <div class="tp-pe-error" id="tp-pe-error">${escapeHtml(d.error || '')}</div>
      <div class="tp-pe-actions">
        <button type="button" class="tp-i-secondary" id="tp-pe-add"${d.rows.length >= max ? ' disabled' : ''}>Add part</button>
        <button type="button" class="tp-i-secondary" id="tp-pe-cancel">Cancel</button>
        <button type="button" class="tp-i-primary" id="tp-pe-save">Save plan</button>
      </div>`;
  }

  /** Finished work: what you said it took, or a way to say it now (the sheet only appears on finishing otherwise). */
  function timeTakenHtml(ctx) {
    const { item, escapeHtml } = ctx;
    if (!item.completed || !ctx.canTime) return '';
    const a = item.actual;
    return `<div class="tp-section-heading"><span>Time taken</span><span class="tp-section-rule"></span><button type="button" class="tp-pe-edit" id="tp-i-time">${a ? 'Change' : 'Add'}</button></div>
      <div class="tp-i-hint">${a ? `You took ${escapeHtml(fmt(a.minutes))}. Taskplus uses it for similar work.` : 'Tell Taskplus how long it really took so similar work gets better estimates.'}</div>`;
  }

  function partsHtml(ctx) {
    const { item, idx, escapeHtml } = ctx;
    if (ctx.planDraft) return planEditorHtml(ctx);
    const editBtn = ctx.canEditPlan ? `<button type="button" class="tp-pe-edit" id="tp-i-plan-edit">${item.total > 1 ? 'Edit' : 'Split into parts'}</button>` : '';
    if (!(item.total > 1)) {
      return ctx.canEditPlan ? `<div class="tp-section-heading"><span>Plan</span><span class="tp-section-rule"></span>${editBtn}</div>
        <div class="tp-i-hint">One piece of work. Split it into parts to plan it over several days.</div>` : '';
    }
    const per = P().minutesPerUnit(item);
    let rows = '';
    for (let i = 0; i < item.total; i++) {
      const done = i < (item.done || 0);
      const current = i === (item.done || 0) && !item.completed;
      const tappable = current || i === (item.done || 0) - 1;
      const named = global.TPEstimate ? global.TPEstimate.stepName(item, i) : null;
      const label = named || `Part ${i + 1} of ${item.total}`;
      const minutes = P().stepsUsable(item) ? P().unitMinutes(item, i, 1) : per;
      rows += `<button type="button" class="tp-i-part${done ? ' tp-i-part-done' : ''}${current ? ' tp-i-part-current' : ''}" data-i="${idx}" data-part="${i}" ${tappable ? '' : 'disabled'} aria-label="${escapeHtml(`${label}${done ? ', done' : current ? ', next' : ''}`)}">
        <span class="tp-i-part-circle">${done ? global.TPIcons.svg('check') : ''}</span>
        <span class="tp-i-part-name">${escapeHtml(label)}${current ? '<span class="tp-i-part-next">next up</span>' : ''}</span>
        <span class="tp-i-part-min">~${minutes === null ? '' : escapeHtml(fmt(minutes))}</span>
      </button>`;
    }
    return `<div class="tp-section-heading"><span>Plan</span><span class="tp-section-rule"></span><span class="tp-section-count">${item.total} ${P().stepsUsable(item) ? 'steps' : 'parts'}</span>${editBtn}</div>
      <div class="tp-i-parts">${rows}</div>`;
  }

  function descriptionHtml(ctx) {
    const { item, descOpen, escapeHtml } = ctx;
    const src = item.source || {};
    const text = (src.description || '').trim();
    const files = (src.files || []).map((f) => `<div class="tp-i-file">${global.TPIcons.svg('file_search_outline')}<span>${escapeHtml(f.name)}</span></div>`).join('');
    const facts = [];
    if (src.points) facts.push(`${src.points} points`);
    if (src.kind === 'quiz' && src.timeLimitMin) facts.push(`${src.timeLimitMin} min time limit`);
    if ((src.submissionTypes || []).length) facts.push(src.submissionTypes.map((t) => t === 'onlinetext' ? 'online text' : t === 'file' ? 'file upload' : t).join(' + '));
    if (src.wordLimit) facts.push(`${src.wordLimit}-word limit`);
    if (!text && !files && !facts.length) return '';
    const long = text.length > 220 || text.split('\n').length > 4;
    return `<div class="tp-section-heading"><span>From Moodle</span><span class="tp-section-rule"></span></div>
      <section class="tp-i-card">
        ${facts.length ? `<div class="tp-i-facts">${facts.map((f) => `<span>${escapeHtml(f)}</span>`).join('')}</div>` : ''}
        ${text ? `<div class="tp-i-desc${descOpen ? '' : ' tp-i-desc-clamp'}">${escapeHtml(text)}</div>` : ''}
        ${text && long ? `<button type="button" class="tp-i-more-link" id="tp-i-desc-toggle">${descOpen ? 'Show less' : 'Show more'}</button>` : ''}
        ${files}
      </section>`;
  }

  function itemDetailHtml(ctx) {
    const { item, idx, color, escapeHtml, relativeDueLabel, fromLabel, daysToDue } = ctx;
    const src = item.source || {};
    const pastDue = daysToDue !== null && (daysToDue < 0 || window.TPDue.isOverdue(item, window.TP.today()));
    const dueTone = item.completed || item.ignored || daysToDue === null ? '' : pastDue ? ' tp-i-chip-bad' : daysToDue <= 1 ? ' tp-i-chip-warn' : '';
    const chips = [
      daysToDue === null
        ? '<span class="tp-i-chip">No due date</span>'
        : `<span class="tp-i-chip${dueTone}">${pastDue && !item.completed && !item.ignored ? 'Overdue · ' : 'Due '}${escapeHtml(window.TPDue.label(item, relativeDueLabel))}</span>`,
      item.ignored ? '<span class="tp-i-chip">Ignored</span>' : '',
      item.completed ? '<span class="tp-i-chip tp-i-chip-ok">Done</span>' : '',
      src.kind === 'quiz' ? `<span class="tp-i-chip">Quiz${src.timeLimitMin ? ' · ' + src.timeLimitMin + ' min' : ''}</span>` : '',
      '<span class="tp-i-chip">From Moodle</span>',
    ].join('');
    const parts = item.total > 1;
    const primary = item.completed
      ? `<button type="button" class="tp-i-primary tp-complete" data-i="${idx}">Mark not done</button>`
      : `<button type="button" class="tp-i-primary ${parts ? 'tp-log' : 'tp-complete'}" data-i="${idx}">${global.TPIcons.svg('check')}${parts ? 'Done with this part' : 'Mark done'}</button>`;
    const ignore = ctx.canIgnore
      ? `<button type="button" class="tp-i-more" id="tp-i-ignore" data-i="${idx}" title="Stop showing it as overdue">Ignore</button>`
      : item.ignored ? `<button type="button" class="tp-i-more" id="tp-i-unignore" data-i="${idx}">Stop ignoring</button>` : '';
    const open = src.link ? `<a class="tp-i-secondary" href="${escapeHtml(src.link)}" target="_blank" rel="noopener noreferrer">Open in Moodle to submit</a>` : '';
    return `<div class="tp-screen tp-screen-item">
      <button type="button" class="tp-c-back" id="tp-i-back">${global.TPIcons.svg('chevron_left')} ${escapeHtml(fromLabel)}</button>
      <div class="tp-i-course"><span class="tp-i-dot" style="background:${color}"></span>${escapeHtml(item.course || 'No course')}</div>
      <h1 class="tp-i-title">${escapeHtml(item.title)}</h1>
      <div class="tp-i-chips">${chips}</div>
      ${estimateCardHtml(ctx)}
      ${timeTakenHtml(ctx)}
      ${partsHtml(ctx)}
      ${descriptionHtml(ctx)}
      <div class="tp-section-heading"><span>My notes</span><span class="tp-section-rule"></span></div>
      <textarea class="tp-i-notes" id="tp-i-notes" rows="3" placeholder="Add notes. They stay yours and are never overwritten by a sync." aria-label="Notes">${escapeHtml(item.notes || '')}</textarea>
      <div class="tp-i-actions">${primary}${open}<div class="tp-i-quiet">${ignore}<button type="button" class="tp-i-more" id="tp-i-more" data-i="${idx}">Edit or delete…</button></div></div>
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.itemDetailHtml = itemDetailHtml;
})(typeof window !== 'undefined' ? window : globalThis);
