/* views/week-html.js — Week screen: stat tiles, paced-load chart, day detail, by-course, advice */
(function (global) {
  function statTilesHtml(stats, heaviestLabel) {
    return `<div class="tp-w-tiles">
      <div class="tp-w-tile"><div class="tp-w-tile-label">Due this week</div><div class="tp-w-tile-value">${stats.dueThisWeek}</div></div>
      <div class="tp-w-tile"><div class="tp-w-tile-label">Units left to log</div><div class="tp-w-tile-value tp-w-tile-accent">${stats.unitsLeft}</div></div>
      <div class="tp-w-tile"><div class="tp-w-tile-label">Heaviest day</div><div class="tp-w-tile-value">${heaviestLabel}</div></div>
    </div>`;
  }

  function chartHtml(days, dayLabels, selDay, courseColorFor) {
    const scale = Math.max(3, ...days.map(d => d.total));
    const cols = days.map(d => {
      const isEmpty = d.total <= 0;
      const h = isEmpty ? 4 : Math.round((d.total / scale) * 128) + 6;
      const courseEntries = Object.entries(d.byCourse);
      let barHtml;
      if (isEmpty) {
        barHtml = `<div class="tp-w-bar-stub" style="height:${h}px"></div>`;
      } else {
        barHtml = `<div class="tp-w-bar" style="height:${h}px">` + courseEntries.map(([course, load]) => {
          const segH = Math.max(2, Math.round((load / d.total) * h));
          return `<div class="tp-w-seg" style="height:${segH}px;background:${courseColorFor(course)}" title="${course}: ${Math.round(load * 10) / 10}"></div>`;
        }).join('') + `</div>`;
      }
      const selected = d.dayIndex === selDay;
      const isToday = d.dayIndex === 0;
      return `<div class="tp-w-col${selected ? ' tp-w-col-selected' : ''}" data-day="${d.dayIndex}">
        <div class="tp-w-col-count">${d.total > 0 ? Math.round(d.total * 10) / 10 : ''}</div>
        ${barHtml}
        <div class="tp-w-col-label${selected ? ' tp-w-label-selected' : (isToday ? ' tp-w-label-today' : '')}">${dayLabels[d.dayIndex][0]}</div>
      </div>`;
    }).join('');
    return `<div class="tp-w-chart-block">
      <div class="tp-section-heading"><span>Paced load by day</span><span class="tp-section-rule"></span><span class="tp-section-count">tap a day</span></div>
      <div class="tp-w-chart">${cols}</div>
    </div>`;
  }

  function dayDetailHtml(ctx, selDay) {
    const { escapeHtml, dayLabels, courseColorFor, TPWeekLogic } = ctx;
    const contribs = TPWeekLogic.contributionsForDay(ctx, selDay);
    const total = contribs.reduce((s, c) => s + c.load, 0);
    const header = `<div class="tp-w-detail-header">
      <span>${dayLabels[selDay]}${selDay === 0 ? ' · today' : ''}</span>
      <span class="tp-text-dim">${total > 0 ? `${Math.round(total * 10) / 10} units across ${contribs.length}` : 'clear'}</span>
    </div>`;
    const rows = contribs.length ? contribs.map(({ it, load }) => {
      const color = it.course ? courseColorFor(it.course) : 'var(--text-faint)';
      const isFinish = Math.max((it.total || 0) - (it.done || 0), 0) <= Math.ceil(load);
      const shareText = it.total > 1 ? `${Math.round(load * 10) / 10} ${it.unit || 'units'}` : (isFinish ? 'finish' : `${Math.round(load * 10) / 10}`);
      return `<div class="tp-w-detail-row">
        <span class="tp-a-bar" style="background:${color}"></span>
        <div class="tp-w-detail-body"><div class="tp-t-title">${escapeHtml(it.title)}</div><div class="tp-t-meta">${[it.course, ctx.relativeDueLabel(it.due)].filter(Boolean).map(escapeHtml).join(' · ')}</div></div>
        <div class="tp-w-detail-status">${escapeHtml(shareText)}</div>
      </div>`;
    }).join('') : `<div class="tp-w-detail-empty">Nothing due. A good day to pull work forward from ${escapeHtml(ctx.heaviestLabel)}.</div>`;
    return `<div class="tp-w-detail-card">${header}${rows}</div>`;
  }

  function byCourseHtml(courseStats, escapeHtml) {
    if (!courseStats.length) return '';
    const rows = courseStats.map(c => `<div class="tp-w-course-row">
      <span class="tp-w-course-swatch" style="background:${c.color}"></span>
      <span class="tp-w-course-name">${escapeHtml(c.name)}</span>
      <span class="tp-w-course-stat">${c.total} assignment${c.total === 1 ? '' : 's'} · ${c.pct}%</span>
      <div class="tp-w-course-bar"><div class="tp-w-course-bar-fill" style="width:${c.pct}%;background:${c.color}"></div></div>
    </div>`).join('');
    return `<div class="tp-section-heading"><span>By course</span><span class="tp-section-rule"></span></div>${rows}`;
  }

  function adviceHtml(text) {
    return `<div class="tp-w-advice"><i class="nf nf-md-lightbulb_on_outline tp-w-advice-icon" aria-hidden="true"></i><div>${text}</div></div>`;
  }

  function weekScreenHtml(ctx) {
    const { escapeHtml, days, dayLabels, selDay, stats, heaviestLabel, courseColorFor, courseStats, advice } = ctx;
    const header = `<div class="tp-a-header-top"><span class="tp-a-title-heading">Week</span></div>`;
    return `<div class="tp-screen tp-screen-week">${header}
      ${statTilesHtml(stats, heaviestLabel)}
      ${chartHtml(days, dayLabels, selDay, courseColorFor)}
      ${dayDetailHtml(ctx, selDay)}
      ${byCourseHtml(courseStats, escapeHtml)}
      ${adviceHtml(advice)}
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.weekScreenHtml = weekScreenHtml;
})(typeof window !== 'undefined' ? window : globalThis);
