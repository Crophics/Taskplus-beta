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
