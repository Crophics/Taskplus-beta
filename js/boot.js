/* boot.js — Auth UI listeners + service worker registration */
// iOS Safari only applies :active styles when a touch listener exists.
document.addEventListener('touchstart', function(){}, {passive:true});

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
  const SW_RESET_FLAG = 'tp-sw-reset-v3'; // bumped: force a hard reset past the broken icon-font deploy
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
