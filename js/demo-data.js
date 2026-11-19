/* demo-data.js — loaded first, acts ONLY when the page is opened as index.html?demo=1 (the intro tour shows the real
   app in an iframe). It swaps localStorage for an in-memory copy BEFORE any app script runs, so nothing the visitor
   taps in the preview can touch their real data, and seeds a few sample assignments. If the swap is refused by the
   browser, nothing is seeded and TP_DEMO_BROKEN stops the app from starting (app.js checks it first), so the preview
   can never run on real data. */
(function () {
  if (!/[?&]demo=1(&|$)/.test(location.search)) return;
  window.TP_DEMO = true;

  const mem = {};
  const method = (name, fn) => Object.defineProperty(mem, name, { value: fn, enumerable: false });
  method('getItem', function (k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null; });
  method('setItem', function (k, v) { this[k] = String(v); });
  method('removeItem', function (k) { delete this[k]; });
  method('clear', function () { Object.keys(this).forEach((k) => delete this[k]); });
  method('key', function (i) { return Object.keys(this)[i] || null; });
  try { Object.defineProperty(window, 'localStorage', { value: mem, configurable: true }); } catch (e) { /* checked below */ }
  if (window.localStorage !== mem) { window.TP_DEMO_BROKEN = true; return; }

  const pad = (n) => String(n).padStart(2, '0');
  const day = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const theme = (/[?&]theme=(dark|light|blue)(&|$)/.exec(location.search) || [])[1] || 'dark';

  const course = (name, color) => ({ id: 'demo-' + name.replace(/\W+/g, ''), name, color });
  const courses = [course('ENGL 1100', '#4361ee'), course('MATH 2400', '#1fae8e'), course('BIOL 1010', '#f0a824'), course('PHIL 2202', '#b83fd1')];

  const make = (n, title, courseName, due, dueTime, steps, over) => ({
    id: 'moodle:demo' + n, title, course: courseName, due, dueTime, total: steps.length, unit: 'part', done: 0, today: 0,
    completed: false, order: n, subtasks: [], source: { type: 'moodle', kind: 'assign', cmid: 9000 + n },
    estimate: {
      minutes: steps.reduce((s, x) => s + x.minutes, 0), low: 0, high: 0, basis: 'model', provider: 'gemini', usedHistory: false, confidence: 'medium',
      factors: ['Sample estimate for the preview.'], steps, key: 'demo' + n, filesRead: [], filesSkipped: [], filesAsked: false,
    },
    ...over,
  });
  const fix = (it) => { it.estimate.low = Math.round(it.estimate.minutes * 0.75); it.estimate.high = Math.round(it.estimate.minutes * 1.3); return it; };
  const items = [
    fix(make(1, 'Reading response 3', 'ENGL 1100', day(0), '23:59', [{ name: 'Read and write the response', minutes: 50 }])),
    fix(make(2, 'Problem set 5', 'MATH 2400', day(2), '23:59', [{ name: 'Sections 5.1 and 5.2', minutes: 40 }, { name: 'Sections 5.3 and 5.4', minutes: 40 }, { name: 'Review and submit', minutes: 25 }])),
    fix(make(3, 'Lab report: osmosis', 'BIOL 1010', day(8), '17:00', [{ name: 'Data and graphs', minutes: 60 }, { name: 'Write the discussion', minutes: 60 }])),
    fix(make(4, 'Discussion post', 'PHIL 2202', day(5), '23:59', [{ name: 'Write the post', minutes: 35 }])),
  ];

  mem.setItem('tp-moodle-items', JSON.stringify(items));
  mem.setItem('tp-assignments', '[]');
  mem.setItem('tp-courses', JSON.stringify(courses));
  mem.setItem('tp-prefs', JSON.stringify({ theme, tab: 'today' }));
  mem.setItem('tp-onboarded', '1');
  mem.setItem('tp-sw-reset-v4', '1');
  mem.setItem('tp-last-active-date', day(0));
})();
