/* tour.js — the intro tour. Shows the REAL app (the same page, opened as index.html?demo=1 in an iframe, with in-memory
   sample data: js/demo-data.js) and walks through it one highlight at a time, driving the preview by clicking its own
   buttons. Everything in the preview is sandboxed, so the visitor can tap around freely. If the preview cannot load or
   cannot isolate itself, the same steps are shown as plain cards. Pure DOM; the app only calls TPTour.start / stop. */
(function (global) {
  const STEPS = [
    { id: 'intro', title: 'Take a quick look', text: 'This is Taskplus with some sample assignments. Tap around if you like: nothing here is saved.' },
    { id: 'today', title: 'Your day, sorted', text: 'Today lists only what needs doing today, so you are never guessing what to work on.',
      enter: (d) => tab(d, 'today'), target: (d) => d.querySelector('.tp-t-row') },
    { id: 'log', title: 'Log your progress', text: 'Tap + after you work on something, or the check to finish it. Try it on the sample.',
      enter: (d) => tab(d, 'today'), target: (d) => d.querySelector('.tp-t-row .tp-log') || d.querySelector('.tp-t-row .tp-t-btn') },
    { id: 'ahead', title: 'Get ahead, optional', text: 'Work you could start early waits here. Doing some now means less to do later.',
      enter: (d) => tab(d, 'today'), target: (d) => headingNamed(d, 'Get ahead') },
    { id: 'plan', title: 'Big work, split into days', text: 'Taskplus estimates the time and splits big assignments into parts, one per day. Tap Edit to change the plan. When you finish one, say how long it really took and later estimates get better.',
      enter: (d, w) => openAssignment(d, w, 'Problem set 5'), target: (d) => d.querySelector('.tp-i-parts') },
    { id: 'week', title: 'See the week ahead', text: 'Each bar is one day of work, so a heavy day shows up early. Tap a day to see what is in it.',
      enter: (d) => { leaveAssignment(d); return tab(d, 'week'); }, target: (d) => d.querySelector('.tp-w-chart-block') },
    { id: 'all', title: 'Everything in one place', text: 'All lists every assignment. Group by due date or by course, search, or show just one course.',
      enter: (d) => { leaveAssignment(d); return tab(d, 'all'); }, target: (d) => d.querySelector('.tp-a-controls') },
    { id: 'swipe', title: 'Swipe to move around', text: 'Swipe left or right to change screens. Pull down on a screen to sync with Moodle. Swipe from the left edge to go back.',
      enter: (d) => tab(d, 'today'), swipe: true },
    { id: 'alerts', title: 'Turn on alerts', text: 'In Settings, turn on notifications to hear about new assignments, moved due dates and things due soon, even with the app closed. On iPhone, add Taskplus to your Home Screen first (Share, then Add to Home Screen).',
      enter: (d) => openSettings(d), target: (d) => { const h = headingNamed(d, 'Notifications'); return h && h.nextElementSibling; } },
    { id: 'done', title: 'That is it', text: 'Your own assignments replace the samples. Connect Moodle in Settings, or add one by hand whenever you like.',
      enter: (d) => tab(d, 'today') },
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms) {
    const end = Date.now() + (ms || 2500);
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(60);
    }
  }
  const click = (el) => { if (el) el.dispatchEvent(new (el.ownerDocument.defaultView.MouseEvent)('click', { bubbles: true, cancelable: true })); return !!el; };
  // Whatever the visitor opened in the preview (a time sheet, the add sheet, a menu) is closed before the tour moves on.
  function closeOverlays(d) {
    ['#tp-time-skip', '#tp-sheet-cancel', '#tp-connect-cancel', '#tp-pe-cancel', '#tp-qmenu-backdrop'].forEach((s) => click(d.querySelector(s)));
  }
  async function tab(d, name) {
    closeOverlays(d);
    const b = await until(() => d.querySelector('.tp-tab[data-tab="' + name + '"]'));
    if (b && b.getAttribute('aria-current') !== 'page') click(b);
    await sleep(120);
  }
  function headingNamed(d, text) {
    return [...d.querySelectorAll('.tp-section-heading')].find((h) => h.textContent.replace(/\s+/g, ' ').trim().toLowerCase().indexOf(text.toLowerCase()) === 0) || null;
  }
  function leaveAssignment(d) { click(d.querySelector('#tp-i-back')); }
  async function openAssignment(d, w, title) {
    if (d.querySelector('.tp-i-parts')) return;
    await tab(d, 'today');
    const row = await until(() => [...d.querySelectorAll('.tp-t-row, .tp-t-ahead-row')].find((r) => r.textContent.indexOf(title) >= 0));
    if (!row) return;
    click(row);
    click(await until(() => d.querySelector('#tp-qm-open')));
    await until(() => d.querySelector('.tp-i-parts'));
    await sleep(150);
  }
  async function openSettings(d) {
    closeOverlays(d);
    leaveAssignment(d);
    if (!d.querySelector('.tp-screen-settings')) click(await until(() => d.querySelector('#tp-open-settings')));
    await until(() => d.querySelector('.tp-screen-settings'));
    await sleep(120);
  }

  let layer = null;
  let st = null;

  function build(opts) {
    layer = document.createElement('div');
    layer.id = 'tp-tour';
    layer.innerHTML = '<div class="tp-tour-stage"><iframe class="tp-tour-frame" title="Taskplus preview"></iframe></div>' +
      '<div class="tp-tour-dim"></div><div class="tp-tour-spot"></div><div class="tp-tour-swipe"><span></span></div>' +
      '<div class="tp-tour-card" role="dialog" aria-live="polite"><div class="tp-tour-kicker"></div><div class="tp-tour-title"></div><div class="tp-tour-text"></div>' +
      '<div class="tp-tour-actions"><button type="button" class="tp-tour-skip">Skip tour</button><span class="tp-tour-grow"></span>' +
      '<button type="button" class="tp-tour-back">Back</button><button type="button" class="tp-tour-next">Next</button></div></div>';
    document.body.appendChild(layer);
    document.body.classList.add('tp-tour-on');
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const frame = layer.querySelector('.tp-tour-frame');
    st = { index: 0, live: false, busy: false, opts, frame, timer: null, token: 0 };
    layer.querySelector('.tp-tour-next').onclick = () => next();
    layer.querySelector('.tp-tour-back').onclick = () => go(st.index - 1);
    layer.querySelector('.tp-tour-skip').onclick = () => finish();
    frame.src = 'index.html?demo=1&theme=' + encodeURIComponent(theme === 'auto' ? 'dark' : theme);
    st.timer = global.setInterval(place, 250);
    global.addEventListener('resize', place);
    boot();
  }

  async function boot() {
    const mine = st;
    const ready = await until(() => {
      const w = mine.frame.contentWindow;
      if (!w || w.TP_DEMO_BROKEN) return false;
      const d = w.document;
      return w.TP_DEMO && d.querySelector('.tp-tabbar') && d.querySelector('.tp-t-row, .tp-t-ahead-row') ? true : null;
    }, 9000);
    if (st !== mine) return;
    mine.live = !!ready;
    if (!mine.live) { // no preview: plain cards over a dim background
      mine.frame.remove();
      layer.classList.add('tp-tour-plain');
    }
    go(0);
  }

  async function go(i) {
    if (!st) return;
    const index = Math.min(Math.max(i, 0), STEPS.length - 1);
    const mine = st;
    const token = ++mine.token;
    mine.index = index;
    mine.busy = true;
    const step = STEPS[index];
    const last = index === STEPS.length - 1;
    layer.querySelector('.tp-tour-kicker').textContent = (mine.opts.replay ? 'Intro' : 'How it works') + ' · ' + (index + 1) + ' of ' + STEPS.length;
    layer.querySelector('.tp-tour-title').textContent = step.title;
    layer.querySelector('.tp-tour-text').textContent = step.text;
    layer.querySelector('.tp-tour-next').textContent = last ? (mine.opts.replay ? 'Done' : 'Start using Taskplus') : 'Next';
    layer.querySelector('.tp-tour-back').style.visibility = index === 0 ? 'hidden' : 'visible';
    layer.querySelector('.tp-tour-skip').style.visibility = last ? 'hidden' : 'visible';
    layer.classList.toggle('tp-tour-swiping', !!step.swipe);
    mine.target = null;
    place();
    if (mine.live && step.enter) {
      try { await step.enter(mine.frame.contentDocument, mine.frame.contentWindow); } catch (e) { /* the card still shows */ }
    }
    if (st !== mine || mine.token !== token) return;
    if (mine.live && step.target) {
      const el = await until(() => step.target(mine.frame.contentDocument), 1500);
      if (st !== mine || mine.token !== token) return;
      if (el) { try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } await sleep(160); }
      mine.target = el || null;
    }
    mine.busy = false;
    place();
  }

  function next() {
    if (!st) return;
    if (st.index >= STEPS.length - 1) finish(); else go(st.index + 1);
  }

  // Keep the highlight on its element (the preview scrolls, re-renders and resizes) and the card out of its way.
  function place() {
    if (!st || !layer) return;
    const spot = layer.querySelector('.tp-tour-spot');
    const dim = layer.querySelector('.tp-tour-dim');
    const card = layer.querySelector('.tp-tour-card');
    const el = st.target;
    let r = null;
    if (el && st.live) {
      try {
        if (!el.isConnected) { const step = STEPS[st.index]; st.target = step.target ? step.target(st.frame.contentDocument) : null; }
        const t = st.target;
        if (t) { const a = t.getBoundingClientRect(); const f = st.frame.getBoundingClientRect(); r = { left: f.left + a.left, top: f.top + a.top, width: a.width, height: a.height }; }
      } catch (e) { r = null; }
    }
    if (r && r.width > 0 && r.height > 0) {
      const pad = 6;
      spot.style.cssText = 'display:block;left:' + (r.left - pad) + 'px;top:' + (r.top - pad) + 'px;width:' + (r.width + pad * 2) + 'px;height:' + (r.height + pad * 2) + 'px';
      dim.style.display = 'none';
      const mid = r.top + r.height / 2;
      card.classList.toggle('tp-tour-card-top', mid > global.innerHeight * 0.5);
    } else {
      spot.style.display = 'none';
      dim.style.display = 'block';
      card.classList.remove('tp-tour-card-top');
    }
  }

  function finish() {
    const cb = st && st.opts && st.opts.onDone;
    stop();
    if (cb) cb();
  }

  function stop() {
    if (st && st.timer) global.clearInterval(st.timer);
    global.removeEventListener('resize', place);
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    document.body.classList.remove('tp-tour-on');
    layer = null; st = null;
  }

  global.TPTour = {
    STEPS,
    start(opts) { if (global.TP_DEMO || layer) return; build(opts || {}); },
    stop,
    active: () => !!layer,
  };
})(typeof window !== 'undefined' ? window : globalThis);
