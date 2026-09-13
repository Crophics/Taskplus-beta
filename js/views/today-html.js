/* views/today-html.js — Today screen: header, target rows/pips, Get ahead, footer */
(function (global) {
  function urgencyDotClass(t) {
    if (t.overdue) return 'tp-t-dot-danger tp-t-pulse';
    if (t.dueToday || t.tight) return 'tp-t-dot-warn';
    return 'tp-t-dot-ok';
  }

  function pipRowHtml(target, todayCount) {
    let pips = '';
    for (let i = 0; i < target; i++) {
      pips += `<span class="tp-t-pip${i < todayCount ? ' tp-t-pip-filled' : ''}"></span>`;
    }
    return `<div class="tp-t-pips">${pips}</div>`;
  }

  function targetRowHtml(entry, ctx) {
    const { escapeHtml, courseColorFor, relativeDueLabel, unitLabel, capUnit, TPTodayLogic, itemIndexMap } = ctx;
    const it = entry.it;
    const idx = itemIndexMap.get(it);
    const target = TPTodayLogic.dayTarget(it);
    const todayCount = it.today || 0;
    const remaining = Math.max(target - todayCount, 0);
    const isMulti = it.total > 1;
    const color = it.course ? courseColorFor(it.course) : 'var(--text-faint)';
    const metaBits = [it.course, relativeDueLabel(it.due)];
    if (isMulti) metaBits.push(`${todayCount} of ${target} today`);
    return `<div class="tp-t-row" data-item-i="${idx}">
      <div class="tp-t-bar" style="background:${color}"></div>
      <div class="tp-t-body">
        <div class="tp-t-title-line">
          <span class="tp-t-dot ${urgencyDotClass(entry)}"></span>
          <span class="tp-t-title">${escapeHtml(it.title)}</span>
        </div>
        <div class="tp-t-meta">${metaBits.filter(Boolean).map(escapeHtml).join(' · ')}</div>
        ${isMulti ? pipRowHtml(target, todayCount) : ''}
      </div>
      <div class="tp-t-action">
        <button type="button" class="tp-t-btn ${isMulti ? 'tp-log' : 'tp-complete'}" data-i="${idx}" aria-label="${isMulti ? 'Log 1' : 'Mark complete'}">${isMulti ? '+1' : '<i class="nf nf-md-check" aria-hidden="true"></i>'}</button>
        ${isMulti ? `<div class="tp-t-remainder">${remaining} left</div>` : ''}
      </div>
    </div>`;
  }

  function getAheadDoneRowHtml(entry, ctx) {
    const { escapeHtml, unitLabel, itemIndexMap } = ctx;
    const it = entry.it;
    const idx = itemIndexMap.get(it);
    const left = Math.max((it.total || 0) - (it.done || 0), 0);
    const today = it.today || 0;
    const unit = it.unit || 'units';
    return `<div class="tp-t-ahead-row tp-t-ahead-done" data-item-i="${idx}">
      <i class="nf nf-md-check_circle_outline tp-t-ahead-check" aria-hidden="true"></i>
      <div class="tp-t-ahead-body">
        <div class="tp-t-title">${escapeHtml(it.title)}</div>
        <div class="tp-t-meta">${today} ${escapeHtml(unitLabel(today, unit))} logged today · ${left} left before tomorrow</div>
      </div>
      <button type="button" class="tp-t-ahead-more tp-log" data-i="${idx}" aria-label="Log 1 more">+1</button>
    </div>`;
  }

  function getAheadOpenRowHtml(entry, ctx) {
    const { escapeHtml, capUnit, itemIndexMap } = ctx;
    const it = entry.it;
    const idx = itemIndexMap.get(it);
    return `<div class="tp-t-ahead-row" data-item-i="${idx}">
      <span class="tp-t-ahead-pill">${escapeHtml(capUnit(entry.unit || it.unit || 'units'))}</span>
      <div class="tp-t-ahead-body"><div class="tp-t-title">${escapeHtml(entry.title || it.title)}</div></div>
    </div>`;
  }

  function todayScreenHtml(ctx) {
    const {
      streak, dateLabel, weekdayLabel, screen, escapeHtml, itemIndexMap,
      totalLoggedToday,
    } = ctx;
    const targets = screen.targets;
    const getAhead = screen.getAhead;
    const leftCount = targets.length;

    const header = `<div class="tp-t-header">
      <div class="tp-t-header-date">
        <div class="tp-t-weekday">${escapeHtml(weekdayLabel)}</div>
        <div class="tp-t-date">${escapeHtml(dateLabel)}</div>
      </div>
      ${streak > 0 ? `<div class="tp-t-streak">${streak}-day streak</div>` : ''}
    </div>`;

    const targetsHeading = `<div class="tp-section-heading">
      <span>Today's targets</span>
      <span class="tp-section-rule"></span>
      <span class="tp-section-count">${leftCount > 0 ? leftCount + ' left' : 'all met'}</span>
    </div>`;

    const targetsBody = leftCount > 0
      ? targets.map(t => targetRowHtml(t, ctx)).join('')
      : `<div class="tp-t-all-met">
          <div class="tp-t-all-met-title">Today's targets are met.</div>
          <div class="tp-t-all-met-sub">Every assignment has had its daily share. Anything below is you getting ahead of the pace.</div>
        </div>`;

    const getAheadSection = getAhead.length ? `<div class="tp-section-heading">
        <span>Get ahead</span>
        <span class="tp-section-rule"></span>
      </div>
      <div class="tp-t-ahead-list">
        ${getAhead.map(e => (e.met ? getAheadDoneRowHtml(e, ctx) : getAheadOpenRowHtml(e, ctx))).join('')}
      </div>` : '';

    const footer = `<div class="tp-t-footer">${totalLoggedToday > 0
      ? `Logged ${totalLoggedToday} unit${totalLoggedToday === 1 ? '' : 's'} today · anything below the targets is you getting ahead`
      : 'Nothing logged yet today'}</div>`;

    return `<div class="tp-screen tp-screen-today">${header}${targetsHeading}${targetsBody}${getAheadSection}${footer}</div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.todayScreenHtml = todayScreenHtml;
})(typeof window !== 'undefined' ? window : globalThis);
