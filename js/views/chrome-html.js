/* views/chrome-html.js — Dev toolbar (the only piece of the old desktop
   chrome the mobile rebuild keeps; everything else — topbar, banners,
   IO controls, course manager, the add/edit modal, the FAB — is superseded
   by the tab screens in js/views/*.
*/
(function (global) {
  function devToolbarHtml({ devMode, devPanelOpen }) {
    if (!devMode) return '';
    return `<button id="tp-dev-toolbar-btn" type="button">🛠️ Dev Menu</button>
      <div id="tp-dev-toolbar-panel" style="display:${devPanelOpen ? 'block' : 'none'};">
        <h4>Dev Testing Controls</h4>
        <button type="button" id="tp-dev-trigger-notify">🔔 Trigger Test Notification</button>
        <button type="button" id="tp-dev-advance-1">⏩ Advance Time +1 Day</button>
        <button type="button" id="tp-dev-advance-7">⏩ Advance Time +7 Days</button>
        <button type="button" id="tp-dev-reset">⚠️ Hard Reset Everything</button>
        <div id="tp-dev-reset-confirm" style="display:none;font-size:12px;margin-top:4px;">
          <span>This clears all data. </span>
          <button type="button" id="tp-dev-reset-confirm-yes">Confirm reset</button>
          <button type="button" id="tp-dev-reset-confirm-no">Cancel</button>
        </div>
        <button type="button" id="tp-dev-exit">🚪 Exit Dev Mode</button>
      </div>`;
  }

  global.TPViews = global.TPViews || {};
  Object.assign(global.TPViews, { devToolbarHtml });
})(typeof window !== 'undefined' ? window : globalThis);
