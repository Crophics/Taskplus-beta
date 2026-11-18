// Due TIME: the due-day morning counts as work time when something is due at or after 12:00.
const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
global.localStorage = { setItem: () => {} };
require('../js/due-time.js');
require('../js/today-logic.js');
require('../js/plan-logic.js');
require('../js/moodle-client.js');
const D = global.TPDue, T = global.TPTodayLogic, P = global.TPPlan, M = global.TPMoodle;

const TODAY = '2026-11-17';
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const item = (o = {}) => ({ id: 'x', title: 'T', course: 'MATH', due: addDays(TODAY, 1), total: 1, done: 0, today: 0, completed: false, archived: false, estimate: { minutes: 60 }, ...o });
const panel = (items) => T.computeTodayPanel({ items, storageKey: 'k', isLocked: () => false, unlockedToday: () => false, today: () => TODAY, daysBetween });
const required = (p) => [...p.requiredTight, ...p.requiredPace].map((t) => t.it.id);

test('only a due time at or after 12:00 makes the due-day morning usable', () => {
  assert.strictEqual(D.morningUsable({ dueTime: '09:00' }), false);
  assert.strictEqual(D.morningUsable({ dueTime: '11:59' }), false);
  assert.strictEqual(D.morningUsable({ dueTime: '12:00' }), true);
  assert.strictEqual(D.morningUsable({ dueTime: '23:59' }), true);
  assert.strictEqual(D.morningUsable({ dueTime: '00:00' }), false); // midnight = the end of the day before
  assert.strictEqual(D.morningUsable({}), false); // no time (manual item): the old rule
});

test('work days: the old count, plus half a day when the morning is usable; due today is one day', () => {
  assert.strictEqual(D.workDays({ dueTime: '17:00' }, 1), 1.5);
  assert.strictEqual(D.workDays({ dueTime: '09:00' }, 1), 1);
  assert.strictEqual(D.workDays({ dueTime: '17:00' }, 3), 3.5);
  assert.strictEqual(D.workDays({ dueTime: '17:00' }, 0), 1);
  assert.strictEqual(D.workDays({ dueTime: '17:00' }, -2), 1);
  assert.strictEqual(D.workDays({}, 3), 3);
});

test('times read the way Moodle shows them', () => {
  assert.strictEqual(D.fmtTime('09:00'), '9:00 AM');
  assert.strictEqual(D.fmtTime('12:00'), '12:00 PM');
  assert.strictEqual(D.fmtTime('23:59'), '11:59 PM');
  assert.strictEqual(D.fmtTime('00:00'), '12:00 AM');
  assert.strictEqual(D.fmtTime(''), '');
  assert.strictEqual(D.label({ due: 'x', dueTime: '09:00' }, () => 'Tomorrow'), 'Tomorrow · 9:00 AM');
  assert.strictEqual(D.label({ due: 'x' }, () => 'Tomorrow'), 'Tomorrow');
  assert.strictEqual(D.label({ due: '' }, () => ''), '');
});

test('a multi-part item due tomorrow BEFORE noon is all today; after noon it splits between today and tomorrow morning', () => {
  const early = item({ id: 'e', total: 6, dueTime: '09:00' });
  const late = item({ id: 'l', total: 6, dueTime: '17:00' });
  const none = item({ id: 'n', total: 6 });
  panel([early]); panel([late]); panel([none]);
  assert.strictEqual(early.dailyTarget.amt, 6);
  assert.strictEqual(late.dailyTarget.amt, 4); // ceil(6 / 1.5)
  assert.strictEqual(none.dailyTarget.amt, 6);
});

test('a dueTime change re-plans the day (the cached daily target is not reused)', () => {
  const x = item({ total: 6, dueTime: '09:00' });
  panel([x]);
  assert.strictEqual(x.dailyTarget.amt, 6);
  x.dueTime = '17:00';
  panel([x]);
  assert.strictEqual(x.dailyTarget.amt, 4);
});

test('a single-part item due tomorrow: required today before noon, can wait for the morning after noon', () => {
  const early = item({ id: 'early', dueTime: '09:00' });
  const late = item({ id: 'late', dueTime: '17:00' });
  const none = item({ id: 'none' });
  assert.deepStrictEqual(required(panel([early])), ['early']);
  assert.deepStrictEqual(required(panel([late])), []);
  assert.deepStrictEqual(required(panel([none])), ['none']);
  // still listed under Get ahead so it is not forgotten
  const screen = T.computeTodayScreen(panel([late]));
  assert.deepStrictEqual(screen.getAhead.map((e) => e.it.id), ['late']);
});

test('due today at any time is still required today, and two single items due tomorrow afternoon can be split across the two days', () => {
  assert.deepStrictEqual(required(panel([item({ id: 'd', due: TODAY, dueTime: '23:59' })])), ['d']);
  const a = item({ id: 'a', dueTime: '17:00' }), b = item({ id: 'b', dueTime: '17:00' });
  const p = panel([a, b]);
  assert.deepStrictEqual(required(p), []); // neither is forced today
  assert.strictEqual(p.pickBuckets.length, 1);
  assert.strictEqual(p.pickBuckets[0].pickCount, 1); // do 1 of the 2 today, the other tomorrow morning
});

test('the minutes plan puts the same units on each day as Today does', () => {
  const alloc = (x) => P.allocateItem(x, TODAY, daysBetween).map((a) => [a.dayIndex, a.units]);
  assert.deepStrictEqual(alloc(item({ total: 6, dueTime: '17:00' })), [[0, 4], [1, 2]]);
  assert.deepStrictEqual(alloc(item({ total: 6, dueTime: '09:00' })), [[0, 6]]);
  assert.deepStrictEqual(alloc(item({ total: 6 })), [[0, 6]]);
  // 7 parts, due in 3 days after noon: 3.5 work days -> 2 today, then 2, 2, 1 on the later days by weight
  assert.deepStrictEqual(alloc(item({ total: 7, due: addDays(TODAY, 3), dueTime: '17:00' })), [[0, 2], [1, 2], [2, 2], [3, 1]]);
  // single part: due-day morning when due after noon, else the day before
  assert.deepStrictEqual(alloc(item({ due: addDays(TODAY, 3), dueTime: '17:00' })), [[3, 1]]);
  assert.deepStrictEqual(alloc(item({ due: addDays(TODAY, 3), dueTime: '09:00' })), [[2, 1]]);
  // today's share agrees with Today's target for a range of sizes
  for (let total = 2; total <= 12; total++) for (const dueIn of [1, 2, 3, 5]) for (const t of ['09:00', '17:00']) {
    const x = item({ total, due: addDays(TODAY, dueIn), dueTime: t });
    panel([x]);
    const mine = P.allocateItem(x, TODAY, daysBetween).find((a) => a.dayIndex === 0);
    assert.strictEqual(mine ? mine.units : 0, x.dailyTarget.amt, `total=${total} dueIn=${dueIn} ${t}`);
    const sum = P.allocateItem(x, TODAY, daysBetween).reduce((s, a) => s + a.units, 0);
    assert.strictEqual(sum, total, `all parts placed: total=${total} dueIn=${dueIn} ${t}`);
  }
});

test('a Moodle import keeps the due time, and a time-only change updates it without a "moved" notice', () => {
  const ts = Math.floor(new Date(2026, 10, 19, 9, 0).getTime() / 1000);
  const rec = (dueTs) => ({ id: 'moodle:1', cmid: 1, courseId: 1, course: 'PHIL', kind: 'assign', title: 'Essay', dueTs, state: 'none', link: 'x' });
  const first = M.mergeImported([], [rec(ts)], { today: '2026-11-17', now: 1 });
  assert.strictEqual(first.items[0].due, '2026-11-19');
  assert.strictEqual(first.items[0].dueTime, '09:00');
  const later = M.mergeImported(first.items, [rec(ts + 8 * 3600)], { today: '2026-11-17', now: 2 });
  assert.strictEqual(later.items[0].dueTime, '17:00');
  assert.strictEqual(later.stats.moved, 0);
  assert.deepStrictEqual(later.events, []);
  const undated = M.mergeImported([], [rec(null)], { today: '2026-11-17', now: 3 });
  assert.strictEqual(undated.items[0].dueTime, '');
});
