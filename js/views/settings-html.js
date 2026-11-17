/* views/settings-html.js — Settings screen */
(function (global) {
  function hourLabel(h) {
    return h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`;
  }

  function hourSelectHtml(selected) {
    let options = '';
    for (let h = 0; h < 24; h++) options += `<option value="${h}" ${h === selected ? 'selected' : ''}>${hourLabel(h)}</option>`;
    return `<select class="tp-s-hour-select" id="tp-notify-hour">${options}</select>`;
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

  function lastSyncedLabel(ts) {
    if (!ts) return 'Not synced yet';
    return 'Last synced ' + new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // Moodle connection. Not connected -> one Connect row. Connected -> account
  // line, one switch per enrolled course, Sync now and Disconnect. This is the
  // only place the last-sync time is shown on purpose.
  function moodleGroupHtml(ctx) {
    const { moodle, escapeHtml } = ctx;
    const st = (moodle && moodle.state) || { connected: false };
    if (!st.connected) {
      const sub = moodle && moodle.signedIn
        ? 'Import assignments and quizzes automatically.'
        : 'Sign in to Taskplus first (Sync, below), then connect Moodle.';
      return groupHtml('Moodle', `<div class="tp-s-row">
        <div class="tp-s-row-main"><span class="tp-s-row-label">Moodle</span>
          <button type="button" class="tp-s-link" id="tp-moodle-connect"${moodle && moodle.signedIn ? '' : ' disabled'}>Connect</button></div>
        <div class="tp-s-row-sub">${sub}</div>
      </div>`);
    }
    const courseRows = (st.courses || []).map(c => `<div class="tp-s-row"><div class="tp-s-row-main">
        <span class="tp-s-row-label">${escapeHtml(c.code || c.name)}</span>
        <button type="button" class="tp-s-toggle${c.selected ? ' tp-s-toggle-on' : ''}" data-moodle-course="${c.id}" role="switch" aria-checked="${!!c.selected}" aria-label="Sync ${escapeHtml(c.code || c.name)}"><span class="tp-s-toggle-knob"></span></button>
      </div></div>`).join('');
    const busy = moodle.busy;
    return groupHtml('Moodle',
      `<div class="tp-s-row"><div class="tp-s-row-main"><span class="tp-s-row-label">${escapeHtml(st.site || 'Connected')}</span>
        <button type="button" class="tp-s-link" id="tp-moodle-sync"${busy ? ' disabled' : ''}>${busy ? 'Syncing…' : 'Sync now'}</button></div>
        <div class="tp-s-row-sub">${escapeHtml(lastSyncedLabel(st.lastSyncAt))}</div></div>` +
      courseRows +
      `<div class="tp-s-row"><div class="tp-s-row-sub">Course changes apply on the next sync.</div></div>
       <div class="tp-s-row"><div class="tp-s-row-main"><button type="button" class="tp-s-danger" id="tp-moodle-disconnect">Disconnect Moodle</button></div>
        <div class="tp-s-row-sub">Assignments already imported stay, but stop updating.</div></div>`
    );
  }

  // Alerts about imported Moodle work. Only shown once Moodle is connected: they have nothing to say before that.
  function alertsGroupHtml(ctx) {
    const a = ctx.alerts;
    if (!a || !ctx.moodle || !ctx.moodle.state || !ctx.moodle.state.connected) return '';
    const p = a.prefs;
    const granted = 'Notification' in window && Notification.permission === 'granted';
    const quietSel = (id, v) => {
      let o = '';
      for (let h = 0; h < 24; h++) o += `<option value="${h}" ${h === v ? 'selected' : ''}>${hourLabel(h)}</option>`;
      return `<select class="tp-s-hour-select" id="${id}">${o}</select>`;
    };
    let status;
    if (!granted) status = 'Turn on notification permission above to get alerts when the app is closed.';
    else if (a.loaded && !a.configured) status = 'The server cannot send notifications yet (see docs/SETUP-moodle-worker.md). Changes still appear in What\'s new.';
    else if (a.loaded && !a.devices) status = 'This device is not registered yet. Reopen the app and try again.';
    else status = '';
    const rows =
      rowHtml('New assignments', pillToggleHtml('tp-al-new', p.new)) +
      rowHtml('Due date changes', pillToggleHtml('tp-al-moved', p.moved)) +
      rowHtml('Grades posted', pillToggleHtml('tp-al-grade', p.grade)) +
      rowHtml('Feedback', pillToggleHtml('tp-al-feedback', p.feedback)) +
      rowHtml('Due soon', pillToggleHtml('tp-al-due', p.due), 'A day before and an hour before something is due.') +
      rowHtml('Quiet hours', pillToggleHtml('tp-al-quiet', p.quiet.on), 'Alerts wait and arrive together afterwards.') +
      (p.quiet.on ? rowHtml('From', quietSel('tp-al-qstart', p.quiet.start)) + rowHtml('Until', quietSel('tp-al-qend', p.quiet.end)) : '') +
      (granted && a.configured && a.devices ? rowHtml('Test', `<button type="button" class="tp-s-link" id="tp-al-test">Send a test</button>`) : '') +
      (status ? `<div class="tp-s-row"><div class="tp-s-row-sub">${status}</div></div>` : '');
    return groupHtml('Moodle alerts', rows);
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
      rowHtml('Digest arrives at', hourSelectHtml(notifyHour)) +
      rowHtml('Notification permission', notifPermRow)
    );

    const alerts = alertsGroupHtml(ctx);
    const courseDots = courses.slice(0, 5).map(c => `<span class="tp-s-course-dot" style="background:${c.color}"></span>`).join('');
    const estimates = groupHtml('Time estimates',
      rowHtml('Use Claude to estimate', pillToggleHtml('tp-llm-toggle', ctx.llmOn !== false),
        'Sends an assignment\'s title, points and description to Anthropic so Claude can estimate it and suggest steps. Never your grades, notes or login.') +
      rowHtml('Also read attached PDFs', pillToggleHtml('tp-files-toggle', ctx.filesOn !== false && ctx.llmOn !== false),
        'Sends the PDF handouts attached to an assignment (up to 2, 5 MB each) so Claude can split the real questions into steps. Only files attached to the assignment itself, never your submissions.')
    );

    const account = groupHtml('Account & data',
      rowHtml('Sync', `<button type="button" class="tp-s-link" id="tp-sync-btn">${escapeHtml(syncLabel)}</button>`) +
      rowHtml('Manage courses', `<span class="tp-s-course-dots">${courseDots}</span><button type="button" class="tp-s-chevron" id="tp-manage-courses" aria-label="Open Courses">${window.TPIcons.svg('chevron_right')}</button>`) +
      rowHtml('Export', `<span class="tp-s-io-buttons"><button type="button" class="tp-s-link" id="tp-export">Backup</button><button type="button" class="tp-s-link" id="tp-export-ics">Calendar</button></span>`) +
      rowHtml('Import grade settings', `<label class="tp-s-link" style="cursor:pointer;">Choose file<input type="file" id="tp-import-grades" accept="application/json" style="display:none;"></label>`, 'Weights, targets and credits from tools/import-vault-grades.mjs') +
      rowHtml('Import backup', `<label class="tp-s-link" style="cursor:pointer;">Choose file<input type="file" id="tp-import" accept="application/json" style="display:none;"></label>`)
    );

    const clear = `<div class="tp-s-row">
      <div class="tp-s-row-main"><button type="button" class="tp-s-danger" id="tp-clear-completed">Clear completed (${completedCount})</button></div>
      <div class="tp-s-row-sub">Completed items archive themselves after 14 days.</div>
    </div>`;

    return `<div class="tp-screen tp-screen-settings">
      <div class="tp-a-header-top"><span class="tp-a-title-heading">Settings</span></div>
      ${appearance}${reminders}${alerts}${moodleGroupHtml(ctx)}${estimates}${account}${clear}
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.settingsScreenHtml = settingsScreenHtml;
})(typeof window !== 'undefined' ? window : globalThis);
