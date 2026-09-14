/* views/settings-html.js — Settings screen */
(function (global) {
  function hourLabel(h) {
    return h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`;
  }

  function segmentedThemeHtml(theme) {
    const options = [['dark', 'Dark'], ['light', 'Light'], ['blue', 'Blue'], ['auto', 'Auto']];
    return `<div class="tp-s-segmented" role="group" aria-label="Theme">
      ${options.map(([v, label]) => `<button type="button" class="tp-s-segment${theme === v ? ' tp-s-segment-active' : ''}" data-theme-choice="${v}">${label}</button>`).join('')}
    </div>`;
  }

  function pillToggleHtml(id, checked) {
    return `<button type="button" class="tp-s-toggle${checked ? ' tp-s-toggle-on' : ''}" id="${id}" role="switch" aria-checked="${checked}"><span class="tp-s-toggle-knob"></span></button>`;
  }

  function rowHtml(label, control, sub) {
    return `<div class="tp-s-row"><div class="tp-s-row-main"><span class="tp-s-row-label">${label}</span>${control}</div>${sub ? `<div class="tp-s-row-sub">${sub}</div>` : ''}</div>`;
  }

  function groupHtml(title, rows) {
    return `<div class="tp-section-heading"><span>${title}</span><span class="tp-section-rule"></span></div><div class="tp-s-group">${rows}</div>`;
  }

  function settingsScreenHtml(ctx) {
    const { theme, notifyHour, notifyDigest, courses, escapeHtml, completedCount, syncLabel } = ctx;

    const appearance = groupHtml('Appearance', rowHtml('Theme', segmentedThemeHtml(theme)));

    const notifPermRow = ('Notification' in window)
      ? (Notification.permission === 'granted'
        ? `<span class="tp-s-status-ok">On${(window.tpSync && window.tpSync.hasVapidKey && window.tpSync.hasVapidKey()) ? ' (incl. background)' : ''}</span>`
        : Notification.permission === 'denied'
          ? `<span class="tp-s-status-dim">Blocked in browser settings</span>`
          : `<button type="button" class="tp-s-link" id="tp-enable-notify">Enable</button>`)
      : '';
    const reminders = groupHtml('Reminders',
      rowHtml('Daily digest', pillToggleHtml('tp-notify-digest', notifyDigest !== false)) +
      rowHtml('Digest arrives at', `<button type="button" class="tp-s-link" id="tp-cycle-hour" data-hour="${notifyHour}">${hourLabel(notifyHour)}</button>`) +
      rowHtml('Notification permission', notifPermRow)
    );

    const courseDots = courses.slice(0, 5).map(c => `<span class="tp-s-course-dot" style="background:${c.color}"></span>`).join('');
    const account = groupHtml('Account & data',
      rowHtml('Sync', `<button type="button" class="tp-s-link" id="tp-sync-btn">${escapeHtml(syncLabel)}</button>`) +
      rowHtml('Manage courses', `<span class="tp-s-course-dots">${courseDots}</span><button type="button" class="tp-s-chevron" id="tp-manage-courses" aria-label="Open Courses">${window.TPIcons.svg('chevron_right')}</button>`) +
      rowHtml('Export', `<span class="tp-s-io-buttons"><button type="button" class="tp-s-link" id="tp-export">Backup</button><button type="button" class="tp-s-link" id="tp-export-ics">Calendar</button></span>`) +
      rowHtml('Import backup', `<label class="tp-s-link" style="cursor:pointer;">Choose file<input type="file" id="tp-import" accept="application/json" style="display:none;"></label>`)
    );

    const clear = `<div class="tp-s-row">
      <div class="tp-s-row-main"><button type="button" class="tp-s-danger" id="tp-clear-completed">Clear completed (${completedCount})</button></div>
      <div class="tp-s-row-sub">Completed items archive themselves after 14 days.</div>
    </div>`;

    return `<div class="tp-screen tp-screen-settings">
      <div class="tp-a-header-top"><span class="tp-a-title-heading">Settings</span></div>
      ${appearance}${reminders}${account}${clear}
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.settingsScreenHtml = settingsScreenHtml;
})(typeof window !== 'undefined' ? window : globalThis);
