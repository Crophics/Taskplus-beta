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

  // The time THIS device last imported (st.lastImportAt), not the server's clock: the server's own
  // 30-minute check also sets that one, so it could say "just now" when this device had nothing new.
  function lastSyncedLabel(ts) {
    if (!ts) return 'Not synced on this device yet';
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
        : 'Sign in to Taskplus first (Account, above), then connect Moodle.';
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
    const notes = window.TPMoodle.explainWarnings(st.warnings);
    const noteRows = notes.map(n => `<div class="tp-s-row"><div class="tp-s-row-sub tp-s-warn">${escapeHtml(n)}</div></div>`).join('');
    const busy = moodle.busy;
    return groupHtml('Moodle',
      `<div class="tp-s-row"><div class="tp-s-row-main"><span class="tp-s-row-label">${escapeHtml(st.site || 'Connected')}</span>
        <button type="button" class="tp-s-link" id="tp-moodle-sync"${busy ? ' disabled' : ''}>${busy ? 'Syncing…' : 'Sync now'}</button></div>
        <div class="tp-s-row-sub">${escapeHtml(lastSyncedLabel(st.lastImportAt))}</div>
        ${st.syncError ? `<div class="tp-s-row-sub tp-s-warn">Last sync failed: ${escapeHtml(st.syncError)}</div>` : ''}</div>` +
      courseRows +
      noteRows +
      `<div class="tp-s-row"><div class="tp-s-row-sub">Course changes apply on the next sync.</div></div>
       <div class="tp-s-row"><div class="tp-s-row-main"><button type="button" class="tp-s-danger" id="tp-moodle-disconnect">Disconnect Moodle</button></div>
        <div class="tp-s-row-sub">Assignments already imported stay, but stop updating.</div></div>`
    );
  }

  // Alert rows for imported Moodle work. Only once Moodle is connected: they have nothing to say before that.
  // (Returns rows for the Notifications group, not a group of its own.)
  function alertRowsHtml(ctx, granted) {
    const a = ctx.alerts;
    if (!a || !ctx.moodle || !ctx.moodle.state || !ctx.moodle.state.connected) return '';
    const p = a.prefs;
    const quietSel = (id, v) => {
      let o = '';
      for (let h = 0; h < 24; h++) o += `<option value="${h}" ${h === v ? 'selected' : ''}>${hourLabel(h)}</option>`;
      return `<select class="tp-s-hour-select" id="${id}">${o}</select>`;
    };
    let status;
    if (!granted) status = 'Turn on notification permission to get alerts when the app is closed.';
    else if (a.loaded && !a.configured) status = 'The server cannot send notifications yet (see docs/SETUP-moodle-worker.md). Changes still appear in What\'s new.';
    else if (a.loaded && !a.devices) status = 'This device is not registered yet. Reopen the app and try again.';
    else status = '';
    const failing = a.lastError && a.lastError.code;
    const failText = failing
      ? 'Background checks have been failing' + (a.lastError.at ? ' since ' + new Date(a.lastError.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '') +
        (a.lastError.code === 'moodle_unreachable' ? ' (your school\'s Moodle did not answer).' : '. Open the app and tap Sync now; if it keeps failing, disconnect and reconnect Moodle.')
      : '';
    return (failText ? `<div class="tp-s-row"><div class="tp-s-row-sub tp-s-warn">${failText}</div></div>` : '') +
      rowHtml('New assignments', pillToggleHtml('tp-al-new', p.new)) +
      rowHtml('Due date changes', pillToggleHtml('tp-al-moved', p.moved)) +
      rowHtml('Due soon', pillToggleHtml('tp-al-due', p.due), 'A day before and an hour before something is due.') +
      rowHtml('Quiet hours', pillToggleHtml('tp-al-quiet', p.quiet.on), 'Alerts wait and arrive together afterwards.') +
      (p.quiet.on ? rowHtml('From', quietSel('tp-al-qstart', p.quiet.start)) + rowHtml('Until', quietSel('tp-al-qend', p.quiet.end)) : '') +
      (granted && a.configured && a.devices ? rowHtml('Test', `<button type="button" class="tp-s-link" id="tp-al-test">Send a test</button>`) : '') +
      (status ? `<div class="tp-s-row"><div class="tp-s-row-sub">${status}</div></div>` : '');
  }

  // Order: who you are, where the work comes from, how you hear about it, how it is estimated, how it looks,
  // what you can do with your data, about, and last (and alone) the destructive action.
  function settingsScreenHtml(ctx) {
    const { theme, notifyHour, notifyDigest, courses, escapeHtml, completedCount, syncLabel } = ctx;

    const account = groupHtml('Account',
      rowHtml('Taskplus account', `<button type="button" class="tp-s-link" id="tp-sync-btn">${escapeHtml(syncLabel)}</button>`,
        'Signing in keeps your assignments, notes and settings in step across your devices.')
    );

    const granted = ('Notification' in window) && Notification.permission === 'granted';
    const notifPermRow = ('Notification' in window)
      ? (granted
        ? `<span class="tp-s-status-ok">On${(window.tpSync && window.tpSync.hasVapidKey && window.tpSync.hasVapidKey()) ? ' (incl. background)' : ''}</span>`
        : Notification.permission === 'denied'
          ? `<span class="tp-s-status-dim">Blocked in browser settings</span>`
          : `<button type="button" class="tp-s-link" id="tp-enable-notify">Enable</button>`)
      : '';
    const homeNote = (window.TP && window.TP.needsHomeScreen && window.TP.needsHomeScreen())
      ? `<div class="tp-s-row"><div class="tp-s-row-sub tp-s-warn">On iPhone, alerts only work from the Home Screen app. Tap Share in Safari, then Add to Home Screen, and open Taskplus from there.</div></div>` : '';
    const notifications = groupHtml('Notifications',
      homeNote +
      rowHtml('Permission', notifPermRow) +
      alertRowsHtml(ctx, granted) +
      rowHtml('Daily digest', pillToggleHtml('tp-notify-digest', notifyDigest !== false)) +
      rowHtml('Digest arrives at', hourSelectHtml(notifyHour))
    );

    const estimates = groupHtml('Time estimates',
      rowHtml('Use AI to estimate', pillToggleHtml('tp-llm-toggle', ctx.llmOn !== false),
        'Sends an assignment\'s title, points and description to an AI service (Anthropic\'s Claude or Google\'s Gemini, whichever the server uses) so it can estimate the time and suggest steps. It also gets the titles and times you entered for your finished assignments, so it can judge similar work. Never your notes, grades or login. If the server uses Google\'s free Gemini tier, Google may use what is sent to improve its products.') +
      rowHtml('Also read attached PDFs', pillToggleHtml('tp-files-toggle', ctx.filesOn !== false && ctx.llmOn !== false),
        'Sends the PDF handouts attached to an assignment (up to 2, 5 MB each) so the AI can split the real questions into steps. Only files attached to the assignment itself, never your submissions.')
    );

    const appearance = groupHtml('Appearance', rowHtml('Theme', segmentedThemeHtml(theme)));

    const courseDots = courses.slice(0, 5).map(c => `<span class="tp-s-course-dot" style="background:${c.color}"></span>`).join('');
    const data = groupHtml('Your data',
      rowHtml('Courses and colors', `<span class="tp-s-course-dots">${courseDots}</span><button type="button" class="tp-s-chevron" id="tp-manage-courses" aria-label="Open Courses">${window.TPIcons.svg('chevron_right')}</button>`) +
      rowHtml('Add an assignment by hand', `<button type="button" class="tp-s-link" data-add-manual>Add</button>`, 'For work that is not in Moodle. Everything from Moodle arrives on its own.') +
      rowHtml('Export', `<span class="tp-s-io-buttons"><button type="button" class="tp-s-link" id="tp-export">Backup</button><button type="button" class="tp-s-link" id="tp-export-ics">Calendar</button></span>`) +
      rowHtml('Import backup', `<label class="tp-s-link" style="cursor:pointer;">Choose file<input type="file" id="tp-import" accept="application/json" style="display:none;"></label>`) +
      `<div class="tp-s-row"><div class="tp-s-row-main"><button type="button" class="tp-s-danger" id="tp-clear-completed">Clear completed (${completedCount})</button></div>
        <div class="tp-s-row-sub">Completed items archive themselves after 14 days.</div></div>`
    );

    const about = groupHtml('About',
      rowHtml('Privacy', `<a class="tp-s-link" href="privacy.html" target="_blank" rel="noopener">What is stored and sent</a>`) +
      rowHtml('Intro', `<button type="button" class="tp-s-link" id="tp-replay-intro">Show again</button>`)
    );

    const danger = groupHtml('Danger zone',
      `<div class="tp-s-row"><div class="tp-s-row-main"><button type="button" class="tp-s-danger" id="tp-delete-data">Delete my data</button></div>
        <div class="tp-s-row-sub">Removes your Moodle connection, alerts, AI estimates and synced data from the server and this device. Your Moodle account is not touched.</div></div>`
    );

    return `<div class="tp-screen tp-screen-settings">
      <div class="tp-a-header-top"><span class="tp-a-title-heading">Settings</span></div>
      ${account}${moodleGroupHtml(ctx)}${notifications}${estimates}${appearance}${data}${about}${danger}
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.settingsScreenHtml = settingsScreenHtml;
})(typeof window !== 'undefined' ? window : globalThis);
