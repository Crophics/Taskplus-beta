const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
require('../js/week-logic.js');

function ctx(items) {
  return {
    items,
    today: () => '2026-09-10',
    daysBetween: (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000),
  };
}

test('a single-part item contributes 1 unit on its due day', () => {
  const days = TPWeekLogic.computePacedLoad(ctx([
    { title: 'Reading', total: 1, done: 0, due: '2026-09-13', course: 'NT' },
  ]));
  assert.strictEqual(days[3].total, 1);
  assert.strictEqual(days[0].total, 0);
});

test('overdue work lands entirely on today (day 0)', () => {
  const days = TPWeekLogic.computePacedLoad(ctx([
    { title: 'Late book', total: 10, done: 4, due: '2026-09-05', course: 'NT' },
  ]));
  assert.strictEqual(days[0].total, 6);
  assert.strictEqual(days.slice(1).every(d => d.total === 0), true);
});

test('a multi-part item spreads its remaining units evenly across day 0..due day', () => {
  const days = TPWeekLogic.computePacedLoad(ctx([
    { title: 'Book', total: 12, done: 0, due: '2026-09-13', course: 'NT' }, // due in 3 days -> days 0-3, 4 days
  ]));
  [0, 1, 2, 3].forEach(i => assert.strictEqual(days[i].total, 3));
  assert.strictEqual(days[4].total, 0);
});

test('a due day beyond day 6 clamps its spread to the visible week', () => {
  const days = TPWeekLogic.computePacedLoad(ctx([
    { title: 'Semester project', total: 20, done: 0, due: '2026-10-01', course: 'NT' }, // far out
  ]));
  const total = days.reduce((s, d) => s + d.total, 0);
  assert.ok(total > 0);
  assert.strictEqual(days.length, 7);
});

test('heaviestDayLabel reports ties instead of picking one arbitrarily, and "none" when empty', () => {
  const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const tiedDays = [
    { dayIndex: 0, total: 3 }, { dayIndex: 1, total: 3 }, { dayIndex: 2, total: 1 },
    { dayIndex: 3, total: 0 }, { dayIndex: 4, total: 0 }, { dayIndex: 5, total: 0 }, { dayIndex: 6, total: 0 },
  ];
  assert.strictEqual(TPWeekLogic.heaviestDayLabel(tiedDays, dayLabels), '2 tied');
  const emptyDays = tiedDays.map(d => ({ ...d, total: 0 }));
  assert.strictEqual(TPWeekLogic.heaviestDayLabel(emptyDays, dayLabels), 'none');
  const singleDays = [
    { dayIndex: 0, total: 1 }, { dayIndex: 1, total: 5 }, { dayIndex: 2, total: 0 },
    { dayIndex: 3, total: 0 }, { dayIndex: 4, total: 0 }, { dayIndex: 5, total: 0 }, { dayIndex: 6, total: 0 },
  ];
  assert.strictEqual(TPWeekLogic.heaviestDayLabel(singleDays, dayLabels), 'Mo');
});

test('statTiles counts items due within the visible week and sums remaining units', () => {
  const items = [
    { total: 10, done: 4, due: '2026-09-12', completed: false, archived: false },
    { total: 1, done: 0, due: '2026-09-20', completed: false, archived: false },
    { total: 5, done: 5, due: '2026-09-11', completed: true, archived: false },
  ];
  const stats = TPWeekLogic.statTiles(ctx(items));
  assert.strictEqual(stats.dueThisWeek, 1);
  assert.strictEqual(stats.unitsLeft, 7);
});
