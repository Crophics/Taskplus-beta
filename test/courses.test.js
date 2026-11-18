const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
require('../js/courses.js');

test('migrateFromItems derives one course per distinct name, first-seen casing wins', () => {
  const items = [
    { course: 'NT 301' },
    { course: 'nt 301' },
    { course: 'PSY 101' },
    { course: '' },
    {},
  ];
  const courses = TPCourses.migrateFromItems(items, {});
  assert.strictEqual(courses.length, 2);
  assert.deepStrictEqual(courses.map((c) => c.name).sort(), ['NT 301', 'PSY 101']);
  courses.forEach((c) => assert.ok(c.color));
});

test('migrateFromItems reuses a legacy tp-course-colors override', () => {
  const items = [{ course: 'NT 301' }];
  const courses = TPCourses.migrateFromItems(items, { 'nt 301': '#123456' });
  assert.strictEqual(courses[0].color, '#123456');
});

test('addCourse rejects case-insensitive duplicates', () => {
  const courses = [];
  assert.ok(TPCourses.addCourse(courses, 'NT 301'));
  assert.strictEqual(TPCourses.addCourse(courses, 'nt 301'), null);
  assert.strictEqual(courses.length, 1);
});

test('renameCourse rewrites every matching item and keeps the id stable', () => {
  const items = [{ course: 'NT 301' }, { course: 'nt 301' }, { course: 'PSY 101' }];
  const courses = [{ id: 'c1', name: 'NT 301', color: '#111' }];
  assert.ok(TPCourses.renameCourse(items, courses, 'c1', 'NT 302'));
  assert.strictEqual(courses[0].name, 'NT 302');
  assert.strictEqual(items[0].course, 'NT 302');
  assert.strictEqual(items[1].course, 'NT 302');
  assert.strictEqual(items[2].course, 'PSY 101');
});

test('deleteCourse only removes the collection entry, items keep their string', () => {
  const items = [{ course: 'NT 301' }];
  const courses = [{ id: 'c1', name: 'NT 301', color: '#111' }];
  assert.ok(TPCourses.deleteCourse(courses, 'c1'));
  assert.strictEqual(courses.length, 0);
  assert.strictEqual(items[0].course, 'NT 301');
  assert.strictEqual(TPCourses.colorFor(courses, 'NT 301'), TPCourses.FALLBACK_COLOR);
});

test('nextPaletteColor skips colors already assigned to another course', () => {
  const courses = [{ id: 'c1', name: 'A', color: TPCourses.PALETTE[0] }];
  assert.strictEqual(TPCourses.nextPaletteColor(courses), TPCourses.PALETTE[1]);
});

test('openItemsForCourse: open work only, soonest first, undated last, name matching ignores case', () => {
  const items = [
    { title: 'B', course: 'math 2400', due: '2026-11-20' },
    { title: 'A', course: 'MATH 2400', due: '2026-11-18' },
    { title: 'Z', course: 'MATH 2400', due: '' },
    { title: 'done', course: 'MATH 2400', due: '2026-11-17', completed: true },
    { title: 'old', course: 'MATH 2400', due: '2026-11-01', archived: true },
    { title: 'other', course: 'PHIL 2202', due: '2026-11-19' },
  ];
  assert.deepStrictEqual(TPCourses.openItemsForCourse(items, 'MATH 2400').map((i) => i.title), ['A', 'B', 'Z']);
});

test('overview: counts open and overdue work and finds the next due item, sorted by name', () => {
  const items = [
    { title: 'late', course: 'PHIL', due: '2026-11-10' },
    { title: 'soon', course: 'PHIL', due: '2026-11-18' },
    { title: 'later', course: 'PHIL', due: '2026-11-25' },
    { title: 'x', course: 'ART', due: '2026-11-17', completed: true },
  ];
  const rows = TPCourses.overview([{ name: 'PHIL', color: '#111' }, { name: 'ART', color: '#222' }], items, '2026-11-17', (n) => 'c-' + n);
  assert.deepStrictEqual(rows.map((r) => r.name), ['ART', 'PHIL']);
  assert.deepStrictEqual([rows[0].open, rows[0].next], [0, null]);
  assert.strictEqual(rows[1].open, 3);
  assert.strictEqual(rows[1].overdue, 1);
  assert.strictEqual(rows[1].next.title, 'soon');
  assert.strictEqual(rows[1].color, 'c-PHIL');
});

test('dedupeByName keeps one entry per course name (case and spacing ignored), first wins, colour is lent', () => {
  const list = [
    { id: 'a', name: 'MATH 2400', color: null },
    { id: 'b', name: ' math 2400 ', color: '#123456' },
    { id: 'c', name: 'PHIL 2202', color: '#abcdef' },
    { id: 'd', name: 'PHIL 2202', color: '#000000' },
  ];
  const out = TPCourses.dedupeByName(list);
  assert.deepStrictEqual(out.map((c) => c.id), ['a', 'c']);
  assert.strictEqual(out[0].color, '#123456');
  assert.strictEqual(out[1].color, '#abcdef');
  assert.deepStrictEqual(TPCourses.dedupeByName(null), []);
});

test('overview shows a course once even if the list holds two entries for it', () => {
  const rows = TPCourses.overview([{ id: 'a', name: 'MATH 2400' }, { id: 'b', name: 'MATH 2400' }, { id: 'c', name: 'ART' }], [], '2026-11-17', () => '#111');
  assert.deepStrictEqual(rows.map((r) => r.name), ['ART', 'MATH 2400']);
});

test('overview counts each course\'s items so an empty course can say no assignments yet', () => {
  const rows = TPCourses.overview([{ name: 'BIBL 1020' }, { name: 'MATH' }], [{ title: 'x', course: 'math', due: '2026-12-01', completed: true }], '2026-11-17', () => '#111');
  assert.deepStrictEqual(rows.map((r) => [r.name, r.total, r.open]), [['BIBL 1020', 0, 0], ['MATH', 1, 0]]);
});

test('a deleted course is removed by its tombstone, even when another device sends it back', () => {
  const T = [];
  const dead = TPCourses.recordDeletion(T, 'PHIL 2202', 1000);
  const back = [{ id: 'x', name: 'phil 2202', color: '#111' }, { id: 'y', name: 'MATH', color: '#222' }];
  assert.deepStrictEqual(TPCourses.applyTombstones(back, dead).map((c) => c.name), ['MATH']);
});

test('a course added again after the deletion survives it', () => {
  const dead = TPCourses.recordDeletion([], 'PHIL 2202', 1000);
  const again = [{ id: 'x', name: 'PHIL 2202', createdAt: 2000 }];
  assert.strictEqual(TPCourses.applyTombstones(again, dead).length, 1);
});

test('mergeTombstones keeps the newest per name and drops very old ones', () => {
  const now = 400 * 86400000;
  const m = TPCourses.mergeTombstones([{ key: 'a', deletedAt: now - 5 }], [{ key: 'a', deletedAt: now - 1 }, { key: 'b', deletedAt: 1 }], now);
  assert.deepStrictEqual(m, [{ key: 'a', deletedAt: now - 1 }]);
});

test('dedupeByName drops an entry with no name', () => {
  assert.deepStrictEqual(TPCourses.dedupeByName([{ id: '1', name: '' }, { id: '2', name: 'A' }, { id: '3', name: '  ' }]).map((c) => c.id), ['2']);
});
