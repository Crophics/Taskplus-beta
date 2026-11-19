// The intro tour's preview (index.html?demo=1) must be isolated: its storage is in memory, seeded with samples,
// and if the browser refuses the swap nothing is seeded and the app is told not to start.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const src = fs.readFileSync(__dirname + '/../js/demo-data.js', 'utf8');

function run(search, { lockStorage = false } = {}) {
  const writes = [];
  const real = { getItem: () => null, setItem: (k, v) => writes.push([k, v]), removeItem() {}, clear() {} };
  const ctx = { location: { search }, Date, JSON, Object, String, Array, RegExp };
  ctx.window = ctx;
  if (lockStorage) Object.defineProperty(ctx, 'localStorage', { get: () => real, configurable: false });
  else ctx.localStorage = real;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, real, writes };
}

test('without ?demo=1 the script does nothing', () => {
  const { ctx, real, writes } = run('?x=1');
  assert.strictEqual(ctx.TP_DEMO, undefined);
  assert.strictEqual(ctx.localStorage, real);
  assert.strictEqual(writes.length, 0);
});

test('with ?demo=1 storage is swapped for an in-memory copy seeded with sample assignments, and real storage is never written', () => {
  const { ctx, real, writes } = run('?demo=1&theme=light');
  assert.strictEqual(ctx.TP_DEMO, true);
  assert.notStrictEqual(ctx.localStorage, real);
  assert.strictEqual(writes.length, 0);
  const items = JSON.parse(ctx.localStorage.getItem('tp-moodle-items'));
  assert.strictEqual(items.length, 4);
  items.forEach((it) => { assert.ok(it.source && it.source.type === 'moodle'); assert.ok(it.estimate && it.estimate.steps.length === it.total); assert.match(it.due, /^\d{4}-\d{2}-\d{2}$/); });
  assert.strictEqual(JSON.parse(ctx.localStorage.getItem('tp-prefs')).theme, 'light');
  assert.strictEqual(ctx.localStorage.getItem('tp-onboarded'), '1', 'the preview never starts onboarding');
  assert.strictEqual(ctx.localStorage.getItem('tp-sw-reset-v4'), '1', 'and never resets the service worker');
  ctx.localStorage.setItem('x', '1'); assert.deepStrictEqual(Object.keys(ctx.localStorage).includes('x'), true);
  ctx.localStorage.clear(); assert.strictEqual(ctx.localStorage.getItem('x'), null);
  assert.strictEqual(writes.length, 0);
});

test('if the browser refuses the swap, nothing is seeded and the app is told not to start', () => {
  const { ctx, real, writes } = run('?demo=1', { lockStorage: true });
  assert.strictEqual(ctx.TP_DEMO_BROKEN, true);
  assert.strictEqual(ctx.localStorage, real);
  assert.strictEqual(writes.length, 0, 'no sample data is written into the real storage');
});

test('the tour steps all have text, and every step that points at something also says how to get there', () => {
  global.window = global;
  delete require.cache[require.resolve('../js/tour.js')];
  require('../js/tour.js');
  const steps = global.TPTour.STEPS;
  assert.ok(steps.length >= 8 && steps.length <= 12);
  steps.forEach((s) => { assert.ok(s.title && s.text, s.id); if (s.target) assert.strictEqual(typeof s.enter, 'function', s.id + ' needs an enter step'); });
  assert.strictEqual(global.TPTour.active(), false);
});
