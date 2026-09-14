/* boot.js — Auth UI listeners + service worker registration */
// iOS Safari only applies :active styles when a touch listener exists.
document.addEventListener('touchstart', function(){}, {passive:true});

// Single persistent visualViewport listener, registered once here rather
// than inside js/bind-events.js's bindEvents() (which runs after every
// render - logging, completing, switching tabs, all of it - so wiring this
// there meant a brand new listener got added on every single one of those,
// none of them ever cleaned up).
//
// Two jobs:
// 1. Keep the Add sheet's own bottom (the pacing hint + submit button)
//    above the iOS keyboard - fixed elements don't resize when the
//    keyboard opens, so the visual viewport shrinking is the only signal
//    available for this. #tp-sheet is looked up fresh on every call
//    instead of captured once, so this stays correct across sheet
//    close/reopen without needing its own cleanup.
// 2. General safety net for the same stuck-tab-bar bug js/app.js's
//    closeAddSheet() fixes for the Add sheet specifically - this catches
//    it for every OTHER focusable input in the app (search, course
//    rename, settings...). window.TP.forceFixedResync is the real fix
//    (see js/utils.js for why); a bare scroll nudge and a display:none
//    toggle on the tab bar were both tried here first and did nothing.
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', function () {
    const sheet = document.getElementById('tp-sheet');
    if (sheet) {
      sheet.style.paddingBottom =
        Math.max(24, window.innerHeight - window.visualViewport.height + 24) + 'px';
    }
    const keyboardClosed = Math.abs(window.visualViewport.height - window.innerHeight) < 2;
    if (keyboardClosed && window.TP && window.TP.forceFixedResync) {
      [0, 150, 400].forEach(delay => setTimeout(() => window.TP.forceFixedResync(0), delay));
    }
  });
}

(function(){
  document.addEventListener('click', function(e){
    var btn = e.target.closest('#tp-sync-btn');
    if(!btn) return;
    if(window.tpSync && window.tpSync.getUser()) window.tpSync.signOut();
    else if(window.tpSync) window.tpSync.signIn();
  });
  document.addEventListener('tp-auth-changed', function(e){
    var user = e.detail.user;
    window.tpSyncLabel = user ? ('Synced: ' + (user.email || user.displayName || 'account') + ' (sign out)') : 'Sign in to sync';
    var btn = document.getElementById('tp-sync-btn');
    if(btn) btn.textContent = window.tpSyncLabel;
  });
})();

if ('serviceWorker' in navigator) {
  const SW_RESET_FLAG = 'tp-sw-reset-v4'; // bumped: force past a stale v21 cache that survived 3 icon fixes
  if (!localStorage.getItem(SW_RESET_FLAG)) {
    // One-time: wipe out whatever service worker is currently stuck registered
    // (common on iOS home-screen apps), then register fresh and reload.
    navigator.serviceWorker.getRegistrations().then(regs => {
      Promise.all(regs.map(r => r.unregister())).then(() => {
        localStorage.setItem(SW_RESET_FLAG, '1');
        navigator.serviceWorker.register('sw.js').then(() => window.location.reload());
      });
    });
  } else {
    // Normal path: explicitly ask for an update check every time the app loads,
    // instead of waiting on Safari's own (unreliable) background check.
    navigator.serviceWorker.register('sw.js').then(reg => reg.update());
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
  }
}
