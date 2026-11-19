/* views/connect-sheet-html.js — Bottom sheet for connecting a Moodle account.
   Reuses the Add sheet's backdrop/sheet/input classes. The id "tp-sheet" is
   deliberate: js/boot.js lifts #tp-sheet above the iOS keyboard. */
(function (global) {
  function connectSheetHtml(ctx) {
    const { draft, error, busy, escapeHtml, sheetJustOpened, needsInvite } = ctx;
    const dis = busy ? ' disabled' : '';
    return `<div class="tp-backdrop" id="tp-connect-backdrop">
      <div class="tp-sheet${sheetJustOpened ? ' tp-sheet-enter' : ''}" id="tp-sheet" role="dialog" aria-modal="true" aria-label="Connect Moodle">
        <div class="tp-sheet-handle"></div>
        <div class="tp-sheet-header">
          <span class="tp-sheet-title">Connect Moodle</span>
          <button type="button" class="tp-sheet-cancel" id="tp-connect-cancel"${dis}>Cancel</button>
        </div>
        <div class="tp-add-sublabel">Taskplus imports your assignments and quizzes.</div>

        <label class="tp-sheet-label" for="tp-connect-site" style="display:block">Moodle address</label>
        <input class="tp-add-input" id="tp-connect-site" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" placeholder="moodle.yourschool.edu" value="${escapeHtml(draft.site || '')}"${dis}>

        <label class="tp-sheet-label" for="tp-connect-user" style="display:block">Username</label>
        <input class="tp-add-input" id="tp-connect-user" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="username" placeholder="Your school username" value="${escapeHtml(draft.username || '')}"${dis}>

        <label class="tp-sheet-label" for="tp-connect-pass" style="display:block">Password</label>
        <input class="tp-add-input" id="tp-connect-pass" type="password" autocomplete="current-password" placeholder="Your school password" value=""${dis}>

        ${needsInvite ? `<label class="tp-sheet-label" for="tp-connect-invite" style="display:block">Invite code</label>
        <input class="tp-add-input" id="tp-connect-invite" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" placeholder="From the person who invited you" value="${escapeHtml(draft.invite || '')}"${dis}>` : ''}

        <div class="tp-connect-error" id="tp-connect-error" role="alert">${error ? escapeHtml(error) : ''}</div>
        <div class="tp-add-sublabel">Your password is used once to get an access token, then thrown away. Only the token is kept, encrypted, on the Taskplus server. It never stays on this phone.</div>

        <button type="button" class="tp-add-submit" id="tp-connect-submit"${dis}>${busy ? 'Connecting…' : 'Connect'}</button>
      </div>
    </div>`;
  }

  global.TPViews = global.TPViews || {};
  global.TPViews.connectSheetHtml = connectSheetHtml;
})(typeof window !== 'undefined' ? window : globalThis);
