const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
require('../js/all-logic.js');

function baseCtx(overrides = {}) {
  return {
    items: [],
    query: '',
    sortMode: 'urgency',
    filterCourse: '',
    isLocked: () => false,
    today: () => '2026-09-10',
    daysBetween: (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000),
    ...overrides,
  };
}

test('groups by Overdue/This week/Later/Blocked/Completed under urgency sort, empty groups omitted', () => {
  const items = [
    { title: 'Late one', due: '2026-09-05', completed: false },
    { title: 'This week one', due: '2026-09-12', completed: false },
    { title: 'Done one', due: '2026-09-01', completed: true },
  ];
  const groups = TPAllLogic.buildGroups(baseCtx({ items }));
  assert.deepStrictEqual(groups.map(g => g.key), ['overdue', 'thisWeek', 'completed']);
});

test('blocked items land in the Blocked group even if due this week', () => {
  const items = [{ title: 'Locked', due: '2026-09-11', completed: false }];
  const groups = TPAllLogic.buildGroups(baseCtx({ items, isLocked: () => true }));
  assert.strictEqual(groups[0].key, 'blocked');
});

test('course sort groups by course name, "No course" bucket for blank', () => {
  const items = [
    { title: 'A', course: 'NT 301', due: '2026-09-11' },
    { title: 'B', course: '', due: '2026-09-11' },
  ];
  const groups = TPAllLogic.buildGroups(baseCtx({ items, sortMode: 'course' }));
  assert.deepStrictEqual(groups.map(g => g.key).sort(), ['NT 301', 'No course']);
});

test('search matches title, course, or unit case-insensitively', () => {
  const items = [
    { title: 'Chapter 1', course: 'NT 301', unit: 'pages', due: '2026-09-11' },
    { title: 'Something else', course: 'PSY 101', unit: 'problems', due: '2026-09-11' },
  ];
  const groups = TPAllLogic.buildGroups(baseCtx({ items, query: 'nt 301' }));
  assert.strictEqual(groups[0].rows.length, 1);
  assert.strictEqual(groups[0].rows[0].it.title, 'Chapter 1');
});

test('course filter narrows to one course, case-insensitive', () => {
  const items = [
    { title: 'A', course: 'NT 301', due: '2026-09-11' },
    { title: 'B', course: 'PSY 101', due: '2026-09-11' },
  ];
  const groups = TPAllLogic.buildGroups(baseCtx({ items, filterCourse: 'nt 301' }));
  const allRows = groups.flatMap(g => g.rows);
  assert.strictEqual(allRows.length, 1);
  assert.strictEqual(allRows[0].it.title, 'A');
});

test('within a group, completed sinks below blocked, which sinks below open', () => {
  const items = [
    { title: 'Done', due: '2026-09-11', completed: true },
    { title: 'Blocked', due: '2026-09-11', completed: false },
    { title: 'Open', due: '2026-09-11', completed: false },
  ];
  const groups = TPAllLogic.buildGroups(baseCtx({
    items, sortMode: 'course',
    isLocked: (it) => it.title === 'Blocked',
  }));
  assert.deepStrictEqual(groups[0].rows.map(r => r.it.title), ['Open', 'Blocked', 'Done']);
});

test('an item due today at a time that has passed is listed under Overdue; with no time it stays in This week', () => {
  require('../js/due-time.js');
  const now = new Date(); const mm = now.getHours() * 60 + now.getMinutes();
  if (mm === 0) return; // nothing can be "earlier today" at midnight
  const real = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const earlier = String(Math.floor((mm - 1) / 60)).padStart(2, '0') + ':' + String((mm - 1) % 60).padStart(2, '0');
  const items = [
    { title: 'Timed, passed', due: real, dueTime: earlier, completed: false },
    { title: 'No time', due: real, completed: false },
  ];
  const groups = TPAllLogic.buildGroups(baseCtx({ items, today: () => real }));
  assert.deepStrictEqual(groups.find((g) => g.key === 'overdue').rows.map((r) => r.it.title), ['Timed, passed']);
  assert.deepStrictEqual(groups.find((g) => g.key === 'thisWeek').rows.map((r) => r.it.title), ['No time']);
});
