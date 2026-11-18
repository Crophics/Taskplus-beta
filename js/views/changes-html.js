/* views/changes-html.js — "What's new": the feed of changes found in Moodle
   (new work, moved dates). Opened from the bell in any main screen's header. */
(function (global) {
  // Hand-drawn (the Nerd Font extraction recipe in AGENTS.md was not needed for one stroke icon).
  const BELL = '<svg class="tp-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';

  function bellButtonHtml(unread) {
    return `<button type="button" class="tp-icon-btn tp-bell" id="tp-open-changes" aria-label="What's new${unread ? ` (${unread} unread)` : ''}">${BELL}${unread ? '<span class="tp-bell-dot"></span>' : ''}</button>`;
  }

  /** The same two buttons on every main screen: What's new (when Moodle is connected) and Settings. */
  function headerActionsHtml(ctx) {
    const c = ctx || {};
    return `<div class="tp-t-header-right">
      ${c.showBell ? bellButtonHtml(c.unread || 0) : ''}
      <button type="button" class="tp-icon-btn" id="tp-open-settings" aria-label="Settings">${global.TPIcons.svg('cog_outline')}</button>
    </div>`;
  }

  /** Title row for a main screen: big title, an optional quiet count, then the shared actions. */
  function screenHeaderHtml(title, ctx, sub) {
    return `<div class="tp-screen-head"><div class="tp-screen-head-main"><span class="tp-a-title-heading">${title}</span>${sub ? `<span class="tp-a-count">${sub}</span>` : ''}</div>${headerActionsHtml(ctx)}</div>`;
  }

  function when(at, now) {
    const mins = Math.max(0, Math.round((now - at) / 60000));
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const h = Math.round(mins / 60);
    if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }

  function detail(e, fmtDate) {
    if (e.kind === 'moved') return `${fmtDate(e.fromTs)} → ${fmtDate(e.toTs)}`;
    if (e.kind === 'new' && e.dueTs) return (e.quiz ? 'Closes ' : 'Due ') + fmtDate(e.dueTs);
    return '';
  }

  function changesScreenHtml(ctx) {
    const { feed, escapeHtml, now, fromLabel } = ctx;
    const seenAt = feed.seenAt || 0;
    const fmtDate = (ts) => new Date(ts * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const rows = feed.events.map((e) => {
      const l = global.TPMoodle.feedLine(e);
      const d = detail(e, fmtDate);
      const color = ctx.colorFor ? ctx.colorFor(e.course) : 'var(--text-dim)';
      return `<div class="tp-ch-row${e.at > seenAt ? ' tp-ch-new' : ''}">
        <span class="tp-i-dot" style="background:${color}"></span>
        <div class="tp-ch-main">
          <div class="tp-ch-head">${escapeHtml(l.head)}<span class="tp-ch-when">${when(e.at, now)}</span></div>
          <div class="tp-ch-title">${escapeHtml(l.text)}</div>
          <div class="tp-ch-sub">${escapeHtml([e.course, d].filter(Boolean).join(' · '))}</div>
        </div>
      </div>`;
    }).join('');
    const empty = `<div class="tp-ch-empty">Nothing new yet. New assignments, and changed due dates show up here after each sync.</div>`;
    return `<div class="tp-screen tp-screen-changes">
      <button type="button" class="tp-c-back" id="tp-ch-back">${global.TPIcons.svg('chevron_left')} ${escapeHtml(fromLabel)}</button>
      <div class="tp-a-header-top"><span class="tp-a-title-heading">What's new</span></div>
      ${feed.events.length ? rows : empty}
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.changesScreenHtml = changesScreenHtml;
  global.TPViews.bellButtonHtml = bellButtonHtml;
  global.TPViews.headerActionsHtml = headerActionsHtml;
  global.TPViews.screenHeaderHtml = screenHeaderHtml;
})(typeof window !== 'undefined' ? window : globalThis);
