// Moodle assignments with no due date, and "ignore" for overdue work.
const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
global.localStorage = { setItem: () => {} };
require('../js/utils.js');
require('../js/item-logic.js');
require('../js/courses.js');
require('../js/estimate-logic.js');
require('../js/plan-logic.js');
require('../js/all-logic.js');
require('../js/week-logic.js');
require('../js/today-logic.js');
require('../js/moodle-client.js');

const M = global.TPMoodle;
const TODAY = '2026-11-17';
const NOW = 1_800_000_000_000;
const ts = (y, mo, d, h = 9) => Math.floor(new Date(y, mo - 1, d, h, 0, 0).getTime() / 1000);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const today = () => TODAY;

function rec(over = {}) {
  return {
    id: 'moodle:1', cmid: 1, instanceId: 1, courseId: 7, course: 'MATH 2400', kind: 'assign', title: 'Essay', dueTs: ts(2026, 11, 19),
    opensTs: null, cutoffTs: null, points: 100, description: 'Write.', files: [], timeLimitMin: null, link: 'https://m.example.edu/x', state: 'none', ...over,
  };
}
const mctx = (extra = {}) => ({ today: TODAY, now: NOW, deletedLog: [], ...extra });
const item = (over = {}) => ({ id: 'a', title: 'A', course: 'MATH 2400', due: '2026-11-10', total: 1, done: 0, today: 0, completed: false, archived: false, ...over });

test('isPlanned: needs a due date and not ignored', () => {
  const P = global.TPItemLogic.isPlanned;
  assert.strictEqual(P(item()), true);
  assert.strictEqual(P(item({ due: '' })), false);
  assert.strictEqual(P(item({ due: null })), false);
  assert.strictEqual(P(item({ ignored: true })), false);
});

test('relativeDueLabel says "No due date" instead of showing an invalid date', () => {
  assert.strictEqual(global.TP.relativeDueLabel(''), 'No due date');
  assert.strictEqual(global.TP.relativeDueLabel(undefined), 'No due date');
});

test('an undated Moodle assignment is imported with an empty due date, one piece, and no "new date" notice', () => {
  const { items, stats, events } = M.mergeImported([], [rec({ dueTs: null })], mctx());
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].due, '');
  assert.strictEqual(items[0].total, 1, 'nothing to spread parts over');
  assert.strictEqual(stats.added, 1);
  assert.strictEqual(events[0].kind, 'new');
});

test('an undated item that gets a date (or loses it) is updated without a "moved" notice', () => {
  const first = M.mergeImported([], [rec({ dueTs: null })], mctx()).items;
  const dated = M.mergeImported(first, [rec({ dueTs: ts(2026, 11, 25) })], mctx({ now: NOW + 1 }));
  assert.strictEqual(dated.items[0].due, '2026-11-25');
  assert.strictEqual(dated.stats.moved, 0);
  assert.strictEqual(dated.events.filter((e) => e.kind === 'moved').length, 0);
  const undated = M.mergeImported(dated.items, [rec({ dueTs: null })], mctx({ now: NOW + 2 }));
  assert.strictEqual(undated.items[0].due, '');
});

test('a sync keeps an ignored item ignored while it is still overdue, and un-ignores it if Moodle gives a future date', () => {
  const first = M.mergeImported([], [rec({ dueTs: ts(2026, 11, 10) })], mctx()).items;
  const ignored = [{ ...first[0], ignored: true }];
  const same = M.mergeImported(ignored, [rec({ dueTs: ts(2026, 11, 10), title: 'Essay' })], mctx({ now: NOW + 1 }));
  assert.strictEqual((same.items[0] || ignored[0]).ignored, true);
  const extended = M.mergeImported(ignored, [rec({ dueTs: ts(2026, 11, 30) })], mctx({ now: NOW + 2 }));
  assert.strictEqual(extended.items[0].ignored, undefined, 'an extension ends the ignoring');
  assert.strictEqual(extended.items[0].due, '2026-11-30');
  const stillOld = M.mergeImported(ignored, [rec({ dueTs: ts(2026, 11, 12) })], mctx({ now: NOW + 3 }));
  assert.strictEqual(stillOld.items[0].ignored, true, 'a new date that is still in the past stays ignored');
});

test('an unfinished-work estimate does not split an undated item into parts', () => {
  const E = global.TPEstimate;
  const base = { id: 'moodle:1', title: 'A', total: 1, unit: 'assignment', done: 0, today: 0, completed: false, source: { type: 'moodle', kind: 'assign' } };
  assert.strictEqual(E.withEstimate({ ...base, due: '' }, E.userEstimate(150)).total, 1);
  assert.strictEqual(E.withEstimate({ ...base, due: '2026-12-01' }, E.userEstimate(150)).total, 3);
});

test('Today and Week never see undated or ignored items (no overdue, no pacing, no crash)', () => {
  const items = [
    item({ id: 'late', title: 'Late', due: '2026-11-10' }),
    item({ id: 'ign', title: 'Ignored late', due: '2026-11-01', ignored: true }),
    item({ id: 'nodue', title: 'Undated', due: '' }),
    item({ id: 'soon', title: 'Soon', due: '2026-11-18' }),
  ];
  const panel = global.TPTodayLogic.computeTodayPanel({ items, storageKey: 'k', isLocked: () => false, unlockedToday: () => false, today, daysBetween });
  const shown = panel.requiredTight.map((t) => t.title).sort();
  assert.deepStrictEqual(shown, ['Late', 'Soon']);
  const days = global.TPWeekLogic.computePacedLoad({ items, today, daysBetween });
  assert.strictEqual(days.reduce((s, d) => s + d.total, 0), 2, 'only Late (lands on today) and Soon count');
  const stats = global.TPWeekLogic.statTiles({ items, today, daysBetween });
  assert.strictEqual(stats.dueThisWeek, 1);
  assert.strictEqual(stats.unitsLeft, 2);
  const plan = global.TPPlan.computeDays({ items, today: TODAY, daysBetween, isLocked: () => false });
  assert.ok(plan.days.every((d) => Number.isFinite(d.minutes)));
});

test('All groups: ignored and undated work get their own groups and are never "Overdue"', () => {
  const items = [
    item({ id: 'late', title: 'Late', due: '2026-11-10' }),
    item({ id: 'ign', title: 'Ignored late', due: '2026-11-01', ignored: true }),
    item({ id: 'nodue', title: 'Undated', due: '' }),
    item({ id: 'z', title: 'Zeta undated', due: '' }),
    item({ id: 'done', title: 'Done', completed: true }),
  ];
  const g = global.TPAllLogic.buildGroups({ items, query: '', sortMode: 'urgency', filterCourse: '', isLocked: () => false, today, daysBetween });
  const by = Object.fromEntries(g.map((x) => [x.key, x.rows.map((r) => r.it.title)]));
  assert.deepStrictEqual(by.overdue, ['Late']);
  assert.deepStrictEqual(by.noDue, ['Undated', 'Zeta undated']);
  assert.deepStrictEqual(by.ignored, ['Ignored late']);
  assert.deepStrictEqual(g.map((x) => x.key), ['overdue', 'noDue', 'ignored', 'completed']);
});

test('Courses: ignored work leaves the open and overdue counts and is listed separately', () => {
  const C = global.TPCourses;
  const items = [
    item({ id: 'late', title: 'Late', due: '2026-11-10' }),
    item({ id: 'ign', title: 'Ignored late', due: '2026-11-01', ignored: true }),
    item({ id: 'nodue', title: 'Undated', due: '' }),
  ];
  const row = C.overview([{ name: 'MATH 2400' }], items, TODAY, () => '#111')[0];
  assert.strictEqual(row.open, 2);
  assert.strictEqual(row.overdue, 1);
  assert.deepStrictEqual(C.openItemsForCourse(items, 'MATH 2400').map((i) => i.title), ['Late', 'Undated']);
  assert.deepStrictEqual(C.ignoredItemsForCourse(items, 'MATH 2400').map((i) => i.title), ['Ignored late']);
  assert.strictEqual(C.openCountForCourse(items, 'MATH 2400'), 2);
});

test('needsModel never asks Claude about ignored work', () => {
  const it = { id: 'moodle:1', title: 'A', due: '2026-11-01', ignored: true, source: { type: 'moodle', kind: 'assign' }, estimate: { basis: 'heuristic', minutes: 60 } };
  assert.strictEqual(M.needsModel(it, TODAY, false, false), false);
  assert.strictEqual(M.needsModel({ ...it, ignored: false }, TODAY, false, false), true);
});
