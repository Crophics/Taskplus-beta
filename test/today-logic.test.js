const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
global.localStorage = { setItem: () => {} }; // stub, not testing storage here
require('../js/today-logic.js');

function baseCtx(overrides = {}) {
  return {
    items: [],
    storageKey: 'test-key',
    isLocked: () => false,
    unlockedToday: () => false,
    today: () => '2026-09-02',
    daysBetween: (a, b) => {
      const d1 = new Date(a), d2 = new Date(b);
      return Math.round((d2 - d1) / 86400000);
    },
    addDays: (d, n) => {
      const dt = new Date(d);
      dt.setDate(dt.getDate() + n);
      return dt.toISOString().slice(0, 10);
    },
    ...overrides,
  };
}

test('a single-part item due today is required', () => {
  const item = { title: 'Reading', total: 1, done: 0, due: '2026-09-02', completed: false, archived: false };
  const ctx = baseCtx({ items: [item] });
  const result = TPTodayLogic.computeTodayPanel(ctx);
  assert.ok(result.hasRequired, 'expected hasRequired to be truthy');
  assert.strictEqual(result.requiredTight.length, 1);
});

test('completing your only assignment today counts as all done today', () => {
  const item = {
    title: 'Reading',
    total: 1,
    done: 1,
    due: '2026-09-02',
    completed: true,
    completedAt: '2026-09-02',
    archived: false,
  };
  const ctx = baseCtx({ items: [item] });
  const result = TPTodayLogic.computeTodayPanel(ctx);
  assert.strictEqual(result.allDoneToday, true);
});

test('finishing today\'s daily target on a multi-part book counts as all done, even if the book itself is not complete', () => {
  const item = {
    title: 'Big Book',
    total: 20,          // 20 chapters total
    done: 8,             // finished 8 so far, 12 left
    due: '2026-09-14',   // exactly 12 days out -> no slack, 1 chapter/day required
    completed: false,    // NOT fully done
    archived: false,
    createdAt: '2026-08-01', // existed before "today"
  };
  const ctx = baseCtx({ items: [item] });

  // Simulate having already made today's target progress: bump `done` up
  // by the item's dailyTarget amount, same as completing today's chapters would.
  const panelBefore = TPTodayLogic.computeTodayPanel(ctx);
  assert.ok(panelBefore.hasRequired, 'should require some chapters today before finishing them');

  // Real logging increments both done and today in tandem (see bind-events.js).
  item.done += item.dailyTarget.amt;
  item.today = (item.today || 0) + item.dailyTarget.amt;
  const panelAfter = TPTodayLogic.computeTodayPanel(ctx);

  assert.strictEqual(panelAfter.hasRequired, false, 'no more required once daily target is hit');
  assert.strictEqual(panelAfter.allDoneToday, true, 'should count as all done today');
});

test('dayTarget/met: a single-part item is binary (1 until logged, then 0/met)', () => {
  const item = { total: 1, done: 0, today: 0 };
  assert.strictEqual(TPTodayLogic.dayTarget(item), 1);
  assert.strictEqual(TPTodayLogic.met(item), false);
  item.done = 1; item.today = 1;
  assert.strictEqual(TPTodayLogic.dayTarget(item), 0);
  assert.strictEqual(TPTodayLogic.met(item), true);
});

test('dayTarget stays constant across logging within the same day (left + today is invariant)', () => {
  const item = { total: 12, done: 0, today: 0, dailyTarget: { amt: 3 } };
  assert.strictEqual(TPTodayLogic.dayTarget(item), 3);
  item.done = 1; item.today = 1;
  assert.strictEqual(TPTodayLogic.dayTarget(item), 3);
  item.done = 3; item.today = 3;
  assert.strictEqual(TPTodayLogic.dayTarget(item), 3);
  assert.strictEqual(TPTodayLogic.met(item), true);
});

test('met() does not re-trigger once you log past today\'s target (get-ahead territory)', () => {
  const item = { total: 12, done: 3, today: 3, dailyTarget: { amt: 3 } };
  assert.strictEqual(TPTodayLogic.met(item), true);
  item.done = 4; item.today = 4;
  assert.strictEqual(TPTodayLogic.met(item), true);
});

test('computeTodayScreen: a met required item moves from Targets to Get ahead', () => {
  const item = {
    title: 'Big Book', total: 20, done: 8, due: '2026-09-14',
    completed: false, archived: false, createdAt: '2026-08-01',
  };
  const ctx = baseCtx({ items: [item] });
  const panelBefore = TPTodayLogic.computeTodayPanel(ctx);
  let screen = TPTodayLogic.computeTodayScreen(panelBefore);
  assert.strictEqual(screen.targets.length, 1);
  assert.strictEqual(screen.getAhead.length, 0);

  item.done += item.dailyTarget.amt;
  item.today = item.dailyTarget.amt;
  const panelAfter = TPTodayLogic.computeTodayPanel(ctx);
  screen = TPTodayLogic.computeTodayScreen(panelAfter);
  assert.strictEqual(screen.targets.length, 0);
  assert.strictEqual(screen.getAhead.length, 1);
  assert.strictEqual(screen.getAhead[0].met, true);
});

test('computeTodayScreen: non-required open items land in Get ahead', () => {
  const item = { title: 'Optional reading', total: 1, done: 0, due: '2026-09-10', completed: false, archived: false };
  const ctx = baseCtx({ items: [item] });
  const panel = TPTodayLogic.computeTodayPanel(ctx);
  const screen = TPTodayLogic.computeTodayScreen(panel);
  assert.strictEqual(screen.targets.length, 0);
  assert.strictEqual(screen.getAhead.length, 1);
  assert.strictEqual(screen.getAhead[0].met, false);
});

test('resetTodayCounters zeroes every item\'s today counter on a new day, leaves it alone same-day', () => {
  const items = [{ today: 3 }, { today: 0 }, {}];
  assert.strictEqual(TPTodayLogic.resetTodayCounters(items, '2026-09-01', '2026-09-01'), false);
  assert.strictEqual(items[0].today, 3);
  assert.strictEqual(TPTodayLogic.resetTodayCounters(items, '2026-09-01', '2026-09-02'), true);
  assert.strictEqual(items[0].today, 0);
});