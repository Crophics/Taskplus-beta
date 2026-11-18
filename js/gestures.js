/* gestures.js - touch gestures for the mobile app.
   - Swipe left/right on a main screen: next/previous tab (Today, Week, All).
   - Swipe right from the left edge: back (clicks the screen's own back button).
   - Pull down from the top of a main screen: sync with Moodle.
   classifySwipe is pure and tested (test/gestures.test.js); init wires it to the page. All listeners are
   passive, so scrolling is never blocked. */
(function (global) {
  const TAB_ORDER = ['today', 'week', 'all'];
  const EDGE = 24;      // px from the left edge that counts as a back swipe
  const MIN_X = 70;     // px of horizontal travel for a swipe
  const MIN_PULL = 80;  // px of downward travel for pull-to-sync
  const MAX_MS = 700;

  /**
   * @param {{dx:number, dy:number, dt:number, startX:number, startScrollTop:number}} g
   * @returns {'next'|'prev'|'back'|'pull'|null}
   */
  function classifySwipe(g) {
    const ax = Math.abs(g.dx), ay = Math.abs(g.dy);
    if (g.dy >= MIN_PULL && ax < g.dy * 0.6 && g.startScrollTop <= 0) return 'pull';
    if (g.dt > MAX_MS || ax < MIN_X || ay > ax * 0.6) return null;
    if (g.dx > 0) return g.startX <= EDGE ? 'back' : 'prev';
    return 'next';
  }

  /** The tab to move to for a 'next'/'prev' swipe, or null at either end. */
  function neighbourTab(tab, kind) {
    const i = TAB_ORDER.indexOf(tab);
    if (i < 0) return null;
    const j = kind === 'next' ? i + 1 : i - 1;
    return j >= 0 && j < TAB_ORDER.length ? TAB_ORDER[j] : null;
  }

  // Never start a gesture on things that scroll or drag by themselves.
  const SKIP = 'input, textarea, select, .tp-a-drag, .tp-sheet, .tp-backdrop, .tp-qmenu, [data-no-swipe]';
  function scrollsSideways(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = global.getComputedStyle(n);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth) return true;
    }
    return false;
  }

  /**
   * @param {{state:()=>{tab:string, blocked:boolean}, goTab:(t:string)=>void, back:()=>void, refresh:()=>(Promise<any>|void)}} api
   */
  function init(api) {
    let t0 = null;
    let ptr = null;
    function indicator() {
      if (!ptr) {
        ptr = document.createElement('div');
        ptr.id = 'tp-ptr';
        ptr.setAttribute('aria-live', 'polite');
        document.body.appendChild(ptr);
      }
      return ptr;
    }
    function hideIndicator() { if (ptr) { ptr.classList.remove('tp-ptr-show', 'tp-ptr-ready'); ptr.style.transform = ''; } }

    document.addEventListener('touchstart', (e) => {
      t0 = null;
      if (e.touches.length !== 1) return;
      const st = api.state();
      if (st.blocked) return;
      const target = e.target;
      if (target.closest && (target.closest(SKIP) || scrollsSideways(target))) return;
      const t = e.touches[0];
      t0 = { x: t.clientX, y: t.clientY, at: Date.now(), scrollTop: global.scrollY || document.documentElement.scrollTop || 0 };
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!t0 || e.touches.length !== 1) return;
      const st = api.state();
      if (TAB_ORDER.indexOf(st.tab) < 0 || t0.scrollTop > 0) return;
      const t = e.touches[0];
      const dx = t.clientX - t0.x, dy = t.clientY - t0.y;
      if (dy > 20 && Math.abs(dx) < dy * 0.6) {
        const el = indicator();
        el.textContent = dy >= MIN_PULL ? 'Release to sync with Moodle' : 'Pull to sync with Moodle';
        el.classList.add('tp-ptr-show');
        el.classList.toggle('tp-ptr-ready', dy >= MIN_PULL);
        el.style.transform = `translate(-50%, ${Math.min(dy, 120) * 0.5}px)`;
      } else hideIndicator();
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      const start = t0; t0 = null;
      if (!start) { hideIndicator(); return; }
      const t = e.changedTouches[0];
      const kind = classifySwipe({ dx: t.clientX - start.x, dy: t.clientY - start.y, dt: Date.now() - start.at, startX: start.x, startScrollTop: start.scrollTop });
      const st = api.state();
      if (st.blocked || !kind) { hideIndicator(); return; }
      const main = TAB_ORDER.indexOf(st.tab) >= 0;
      if (kind === 'pull') {
        if (!main) { hideIndicator(); return; }
        const el = indicator();
        el.textContent = 'Syncing with Moodle…';
        el.classList.add('tp-ptr-show');
        el.style.transform = 'translate(-50%, 36px)';
        Promise.resolve(api.refresh()).catch(() => {}).then(hideIndicator);
        return;
      }
      hideIndicator();
      if (main) {
        const to = neighbourTab(st.tab, kind === 'back' ? 'prev' : kind);
        if (to) api.goTab(to);
      } else if (kind === 'back' || kind === 'prev') {
        api.back();
      }
    }, { passive: true });
    document.addEventListener('touchcancel', () => { t0 = null; hideIndicator(); }, { passive: true });
  }

  global.TPGestures = { classifySwipe, neighbourTab, init, TAB_ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
