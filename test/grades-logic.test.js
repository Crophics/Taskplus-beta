const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
require('../js/grades-logic.js');
const G = global.TPGrades;

const e = (id, pct, extra = {}) => ({ id, name: id, kind: 'assign', pct, due: null, ...extra });

/* ---------- letters and GPA ---------- */

test('letterFor uses the default 93/90/87... scale', () => {
  const cases = [[100, 'A'], [93, 'A'], [92.99, 'A-'], [90, 'A-'], [89.99, 'B+'], [87, 'B+'], [83, 'B'], [80, 'B-'], [77, 'C+'], [73, 'C'], [70, 'C-'], [67, 'D+'], [63, 'D'], [60, 'D-'], [59.99, 'F'], [0, 'F']];
  cases.forEach(([p, l]) => assert.strictEqual(G.letterFor(p), l, p + ' -> ' + l));
});

test('letterFor rounds to two decimals before comparing, handles a custom scale and missing grades', () => {
  assert.strictEqual(G.letterFor(92.996), 'A', 'rounds up to 93.00');
  const strict = [95, 92, 89, 85, 82, 79, 75, 72, 69, 65, 62];
  assert.strictEqual(G.letterFor(93, strict), 'A-');
  assert.strictEqual(G.letterFor(95, strict), 'A');
  assert.strictEqual(G.letterFor(null), null);
  assert.strictEqual(G.letterFor(NaN), null);
  assert.strictEqual(G.letterFor(80, [1, 2, 3]), 'B-', 'an invalid scale falls back to the default');
});

test('isValidCutoffs wants eleven strictly descending numbers in 0-100', () => {
  assert.strictEqual(G.isValidCutoffs(G.DEFAULT_CUTOFFS), true);
  assert.strictEqual(G.isValidCutoffs([93, 90]), false);
  assert.strictEqual(G.isValidCutoffs([93, 93, 87, 83, 80, 77, 73, 70, 67, 63, 60]), false);
  assert.strictEqual(G.isValidCutoffs([93, 90, 87, 83, 80, 77, 73, 70, 67, 63, 101]), false);
  assert.strictEqual(G.isValidCutoffs(null), false);
});

test('gpa is credit-weighted and ignores courses with no grade', () => {
  const r = G.gpa([{ pct: 95, credits: 3 }, { pct: 85, credits: 1 }, { pct: null, credits: 4 }]);
  // (4.0*3 + 3.0... 85 is B (83-86.99) = 3.0) -> (12 + 3) / 4 = 3.75
  assert.strictEqual(r.gpa, 3.75);
  assert.strictEqual(r.credits, 4);
  assert.strictEqual(r.courses, 2);
  assert.deepStrictEqual(G.gpa([]), { gpa: null, courses: 0, credits: 0 });
  assert.strictEqual(G.gpa([{ pct: 50, credits: 3 }]).gpa, 0);
});

/* ---------- the grade math ---------- */

test('current grade is the weighted average of graded, weighted work', () => {
  const entries = [e('a', 90), e('b', 80), e('c', null)];
  const r = G.computeCourse(entries, { a: 10, b: 10, c: 20 }, { target: 90 });
  assert.strictEqual(r.currentPct, 85); // (10*.9 + 10*.8) / 20
  assert.strictEqual(r.gradedWeight, 20);
  assert.strictEqual(r.earned, 17);
  assert.strictEqual(r.remainingWeight, 80);
  assert.strictEqual(r.source, 'weights');
});

test('needed average on the rest: reachable, secured, out of reach, complete', () => {
  const entries = [e('a', 90), e('b', 80), e('c', null)];
  const w = { a: 10, b: 10, c: 20 };
  let r = G.computeCourse(entries, w, { target: 90 });
  assert.strictEqual(r.needed, 91.3); // (90-17)*100/80 = 91.25
  assert.strictEqual(r.outlook, 'reachable');
  assert.strictEqual(r.maxPossible, 97);
  r = G.computeCourse(entries, w, { target: 99 });
  assert.strictEqual(r.outlook, 'out-of-reach');
  assert.strictEqual(r.needed, 102.5);
  r = G.computeCourse(entries, w, { target: 15 });
  assert.strictEqual(r.outlook, 'secured');
  assert.ok(r.needed <= 0);
  r = G.computeCourse([e('a', 90), e('b', 80)], { a: 60, b: 40 }, { target: 90 });
  assert.strictEqual(r.outlook, 'complete');
  assert.strictEqual(r.needed, null);
  assert.strictEqual(r.currentPct, 86); // .6*90 + .4*80
});

test('graded work with no weight is left out and counted, not guessed', () => {
  const r = G.computeCourse([e('a', 90), e('b', 50)], { a: 10 }, { target: 90 });
  assert.strictEqual(r.currentPct, 90);
  assert.strictEqual(r.unweightedGraded, 1);
});

test('zero, negative and junk weights count as no weight', () => {
  const r = G.computeCourse([e('a', 90), e('b', 50), e('c', 70)], { a: 10, b: 0, c: 'x' }, { target: 90 });
  assert.strictEqual(r.gradedWeight, 10);
  assert.strictEqual(r.unweightedGraded, 2);
});

test('with no weights at all it falls back to Moodle\'s own course total', () => {
  let r = G.computeCourse([e('a', 90)], {}, { target: 90, moodleTotal: 87.456 });
  assert.strictEqual(r.source, 'moodle');
  assert.strictEqual(r.currentPct, 87.46);
  assert.strictEqual(r.outlook, 'unknown');
  assert.strictEqual(r.needed, null);
  r = G.computeCourse([e('a', null)], {}, { target: 90 });
  assert.strictEqual(r.source, 'none');
  assert.strictEqual(r.currentPct, null);
});

test('weights over 100 are flagged and leave nothing remaining', () => {
  const r = G.computeCourse([e('a', 90), e('b', 80)], { a: 70, b: 50 }, { target: 90 });
  assert.strictEqual(r.overweight, true);
  assert.strictEqual(r.remainingWeight, 0);
  assert.strictEqual(r.outlook, 'complete');
});

test('totalWeight counts ungraded weights too, so the UI can say how much of the course is covered', () => {
  const r = G.computeCourse([e('a', 90), e('b', null)], { a: 30, b: 25 }, { target: 90 });
  assert.strictEqual(r.totalWeight, 55);
});

/* ---------- entries ---------- */

function item(id, title, course, due, over = {}) {
  return { id, title, course, due, completed: false, archived: false, source: { type: 'moodle', kind: 'assign' }, ...over };
}

test('buildEntries joins Moodle grade items with imported items and splits graded / coming up', () => {
  const items = [
    item('moodle:1', 'Assignment 1', 'MATH 2400', '2026-10-01'),
    item('moodle:2', 'Assignment 2', 'MATH 2400', '2026-11-20'),
    item('moodle:3', 'Quiz 3', 'MATH 2400', '2026-11-18', { completed: true }),
    item('moodle:9', 'Other course', 'PHIL 2202', '2026-11-20'),
    item('moodle:8', 'Archived', 'MATH 2400', '2026-01-01', { archived: true }),
    { id: 'manual', title: 'Manual', course: 'MATH 2400', due: '2026-11-19' },
  ];
  const grades = { items: [
    { id: 'moodle:1', name: 'Assignment 1', kind: 'assign', pct: 88, gradedTs: 100, feedback: 'ok', weightSuggested: 10 },
    { id: 'moodle:2', name: 'Assignment 2', kind: 'assign', pct: null },
    { id: 'gi:5', name: 'Attendance', kind: 'manual', pct: 90, gradedTs: 200 },
  ] };
  const { coming, graded } = G.buildEntries('math 2400', items, grades);
  assert.deepStrictEqual(graded.map((x) => x.id), ['gi:5', 'moodle:1'], 'most recently graded first');
  assert.deepStrictEqual(coming.map((x) => x.id), ['moodle:3', 'moodle:2'], 'soonest due first; ungraded imported items the gradebook lacks are included');
  assert.strictEqual(coming[0].submitted, true);
  assert.strictEqual(graded[1].feedback, 'ok');
  assert.strictEqual(graded[1].weightSuggested, 10);
  assert.strictEqual(graded[1].due, '2026-10-01');
  assert.ok(![...coming, ...graded].some((x) => x.id === 'manual' || x.id === 'moodle:9' || x.id === 'moodle:8'));
});

test('buildEntries works with no grade report at all', () => {
  const items = [item('moodle:1', 'A1', 'MATH 2400', '2026-11-20')];
  const r = G.buildEntries('MATH 2400', items, null);
  assert.deepStrictEqual(r.coming.map((x) => x.id), ['moodle:1']);
  assert.deepStrictEqual(r.graded, []);
});

test('buildEntries puts undated entries last', () => {
  const items = [item('moodle:1', 'B', 'MATH 2400', '2026-11-20')];
  const grades = { items: [{ id: 'gi:5', name: 'Attendance', kind: 'manual', pct: null }] };
  assert.deepStrictEqual(G.buildEntries('MATH 2400', items, grades).coming.map((x) => x.id), ['moodle:1', 'gi:5']);
});

/* ---------- settings ---------- */

test('setWeight stores, clamps, rounds and clears without mutating', () => {
  const s0 = G.emptySettings();
  const s1 = G.setWeight(s0, 'moodle:1', '8.555');
  assert.strictEqual(s1.weights['moodle:1'], 8.56);
  assert.deepStrictEqual(s0.weights, {});
  assert.strictEqual(G.setWeight(s1, 'moodle:1', 250).weights['moodle:1'], 100);
  assert.strictEqual('moodle:1' in G.setWeight(s1, 'moodle:1', '').weights, false);
  assert.strictEqual('moodle:1' in G.setWeight(s1, 'moodle:1', 'abc').weights, false);
  assert.strictEqual('moodle:1' in G.setWeight(s1, 'moodle:1', -5).weights, false);
  assert.strictEqual(G.setWeight(s1, 'moodle:1', 0).weights['moodle:1'], 0);
});

test('courseSettings has defaults, and setCourseSetting validates', () => {
  let s = G.emptySettings();
  assert.deepStrictEqual(G.courseSettings(s, 'MATH 2400'), { target: 90, credits: 3, scale: null });
  s = G.setCourseSetting(s, 'MATH 2400', { target: 93.26, credits: 4.2 });
  assert.deepStrictEqual(G.courseSettings(s, 'MATH 2400'), { target: 93.3, credits: 4, scale: null });
  s = G.setCourseSetting(s, 'MATH 2400', { target: 150, credits: 999 });
  assert.deepStrictEqual(G.courseSettings(s, 'MATH 2400'), { target: 100, credits: 30, scale: null });
  s = G.setCourseSetting(s, 'MATH 2400', { credits: 0 });
  assert.strictEqual(G.courseSettings(s, 'MATH 2400').credits, 0.5);
  s = G.setCourseSetting(s, 'MATH 2400', { scale: [95, 92, 89, 85, 82, 79, 75, 72, 69, 65, 62] });
  assert.strictEqual(G.courseSettings(s, 'MATH 2400').scale[0], 95);
  s = G.setCourseSetting(s, 'MATH 2400', { scale: [1, 2] });
  assert.strictEqual(G.courseSettings(s, 'MATH 2400').scale[0], 95, 'an invalid scale is ignored');
  s = G.setCourseSetting(s, 'MATH 2400', { scale: null });
  assert.strictEqual(G.courseSettings(s, 'MATH 2400').scale, null);
});

test('importSettings keeps valid entries, ignores junk and merges over existing values', () => {
  const start = G.setWeight(G.emptySettings(), 'moodle:1', 5);
  const out = G.importSettings(start, {
    weights: { 'moodle:1': 8, 'moodle:2': 12.5, 'gi:7': 5, 'bogus': 3, 'moodle:3': 'x', 'moodle:4': 150 },
    courses: { 'MATH 2400': { target: 92, credits: 4, scale: G.DEFAULT_CUTOFFS }, 'PHIL 2202': { target: 'high' }, '': { target: 90 } },
  });
  assert.deepStrictEqual(out.settings.weights, { 'moodle:1': 8, 'moodle:2': 12.5, 'gi:7': 5 });
  assert.strictEqual(out.settings.courses['MATH 2400'].target, 92);
  assert.strictEqual('PHIL 2202' in out.settings.courses, false);
  assert.deepStrictEqual(out.stats, { weights: 3, courses: 1, ignored: 5 });
  assert.deepStrictEqual(start.weights, { 'moodle:1': 5 }, 'input not mutated');
  assert.deepStrictEqual(G.importSettings(start, null).stats.ignored, 1);
});

/* ---------- the store ---------- */

test('mergeGrades replaces synced courses and keeps others', () => {
  const s1 = G.mergeGrades(null, [{ course: 'MATH 2400', courseId: 7, total: 80, items: [{ id: 'moodle:1' }] }], 1000);
  assert.strictEqual(s1.syncedAt, 1000);
  const s2 = G.mergeGrades(s1, [{ course: 'PHIL 2202', courseId: 8, total: null, items: [] }, { course: 'MATH 2400', courseId: 7, total: 85, items: [] }], 2000);
  assert.strictEqual(s2.courses['MATH 2400'].total, 85);
  assert.strictEqual(s2.courses['MATH 2400'].syncedAt, 2000);
  assert.ok(s2.courses['PHIL 2202']);
  assert.strictEqual(s1.courses['MATH 2400'].total, 80, 'previous store untouched');
  const s3 = G.mergeGrades(s2, [], 3000);
  assert.deepStrictEqual(Object.keys(s3.courses).sort(), ['MATH 2400', 'PHIL 2202']);
});

/* ---------- overview ---------- */

test('overview lists courses that have Moodle data, with grade, letter, target and next item', () => {
  const items = [
    item('moodle:1', 'A1', 'MATH 2400', '2026-11-10', { completed: true }),
    item('moodle:2', 'A2', 'MATH 2400', '2026-11-20'),
    item('moodle:3', 'Late', 'MATH 2400', '2026-11-01'),
    item('moodle:4', 'R3', 'PHIL 2202', '2026-11-18'),
  ];
  const store = { courses: { 'MATH 2400': { total: 60, items: [{ id: 'moodle:1', name: 'A1', kind: 'assign', pct: 90, gradedTs: 5 }] } } };
  const settings = G.setCourseSetting(G.setWeight(G.emptySettings(), 'moodle:1', 20), 'MATH 2400', { target: 92, credits: 4 });
  const courses = [{ id: 'a', name: 'MATH 2400' }, { id: 'b', name: 'PHIL 2202' }, { id: 'c', name: 'BIBL 1020' }];
  const o = G.overview({ courses, items, store, settings, colorFor: (n) => '#' + n.length, today: '2026-11-17' });
  assert.deepStrictEqual(o.rows.map((r) => r.name), ['MATH 2400', 'PHIL 2202'], 'BIBL has no Moodle data');
  const math = o.rows[0];
  assert.strictEqual(math.pct, 90);
  assert.strictEqual(math.letter, 'A-');
  assert.strictEqual(math.target, 92);
  assert.strictEqual(math.credits, 4);
  assert.strictEqual(math.source, 'weights');
  assert.strictEqual(math.next.id, 'moodle:2', 'skips overdue and submitted items');
  const phil = o.rows[1];
  assert.strictEqual(phil.pct, null);
  assert.strictEqual(phil.letter, null);
  assert.strictEqual(phil.next.id, 'moodle:4');
  assert.strictEqual(o.gpa.gpa, 3.7, 'only MATH has a grade: A- = 3.7');
});

test('overview falls back to the Moodle total when no weights are entered', () => {
  const store = { courses: { 'MATH 2400': { total: 87.4, items: [{ id: 'moodle:1', name: 'A1', kind: 'assign', pct: 90 }] } } };
  const o = G.overview({ courses: [{ name: 'MATH 2400' }], items: [], store, settings: G.emptySettings(), today: '2026-11-17' });
  assert.strictEqual(o.rows[0].pct, 87.4);
  assert.strictEqual(o.rows[0].source, 'moodle');
  assert.strictEqual(o.rows[0].letter, 'B+');
});

test('overview with nothing synced is empty', () => {
  const o = G.overview({ courses: [{ name: 'MATH 2400' }], items: [], store: null, settings: G.emptySettings(), today: '2026-11-17' });
  assert.deepStrictEqual(o.rows, []);
  assert.strictEqual(o.gpa.gpa, null);
});
