const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
require('../js/estimate-logic.js');
const E = global.TPEstimate;

const words = (n) => Array.from({ length: n }, () => 'word').join(' ');

/* ---------- quizzes ---------- */

test('a quiz with a time limit: limit + equal study time, basis quiz-limit', () => {
  const r = E.estimateRecord({ kind: 'quiz', title: 'Quiz 4', timeLimitMin: 20 });
  assert.strictEqual(r.minutes, 40);  // 20 take + 20 study
  assert.strictEqual(r.low, 25);      // 20 + 25% of the study time
  assert.strictEqual(r.high, 60);     // 20 + 2x the study time
  assert.strictEqual(r.basis, 'quiz-limit');
  assert.strictEqual(r.confidence, 'medium');
  assert.ok(r.factors.some((f) => f.includes('20 min time limit')));
});

test('a quiz with no limit assumes 30 minutes and says it is a guess', () => {
  const r = E.estimateRecord({ kind: 'quiz', title: 'Quiz 5', timeLimitMin: null });
  assert.strictEqual(r.minutes, 60);
  assert.strictEqual(r.basis, 'heuristic');
  assert.strictEqual(r.confidence, 'low');
});

test('study time for a quiz is clamped to 15-60 minutes, and exams get far more', () => {
  assert.strictEqual(E.estimateRecord({ kind: 'quiz', title: 'Q', timeLimitMin: 5 }).minutes, 20);   // 5 + 15
  assert.strictEqual(E.estimateRecord({ kind: 'quiz', title: 'Q', timeLimitMin: 120 }).minutes, 180); // 120 + 60
  const exam = E.estimateRecord({ kind: 'quiz', title: 'Midterm Exam', timeLimitMin: 90 });
  assert.strictEqual(exam.minutes, 270); // 90 + 180
});

/* ---------- assignments ---------- */

test('assignment baseline comes from points and description length', () => {
  // 100 points -> 120 base; a 10-word description x0.85 = 102 -> 100
  const short = E.estimateRecord({ kind: 'assign', title: 'Assignment 6', points: 100, description: words(10) });
  assert.strictEqual(short.minutes, 100);
  assert.strictEqual(short.low, 70);
  assert.strictEqual(short.high, 150);
  assert.strictEqual(short.basis, 'heuristic');
  assert.strictEqual(short.confidence, 'low');
  // the same work with a long description is bigger: 120 x1.4 = 168 -> 170
  assert.strictEqual(E.estimateRecord({ kind: 'assign', title: 'Assignment 6', points: 100, description: words(400) }).minutes, 170);
});

test('points tiers', () => {
  const m = (points) => E.estimateRecord({ kind: 'assign', title: 'Assignment', points, description: words(60) }).minutes;
  assert.strictEqual(m(10), 30);
  assert.strictEqual(m(25), 45);
  assert.strictEqual(m(50), 75);
  assert.strictEqual(m(100), 120);
  assert.strictEqual(m(500), 180);
  assert.strictEqual(E.estimateRecord({ kind: 'assign', title: 'Assignment', points: null, description: words(60) }).minutes, 60);
});

test('light tasks are shorter, writing and projects are longer, exams are the longest', () => {
  const base = { kind: 'assign', points: 10, description: words(60) };
  assert.strictEqual(E.estimateRecord({ ...base, title: 'Reading Response 3' }).minutes, 20); // 30 x0.6 = 18 -> 20
  assert.strictEqual(E.estimateRecord({ ...base, title: 'Research Paper' }).minutes, 150);    // floor of 150
  assert.strictEqual(E.estimateRecord({ ...base, title: 'Final Exam' }).minutes, 240);
  assert.strictEqual(E.estimateRecord({ ...base, title: 'Reflection Paper' }).minutes, 150, 'heavy beats light');
});

test('a handout adds reading time', () => {
  const noFile = E.estimateRecord({ kind: 'assign', title: 'Homework', points: 50, description: words(60) }).minutes;
  const withFile = E.estimateRecord({ kind: 'assign', title: 'Homework', points: 50, description: words(60), files: [{ name: 'a.pdf' }] }).minutes;
  assert.strictEqual(noFile, 75);
  assert.strictEqual(withFile, 90);
});

test('a word limit sets a floor on writing time', () => {
  // 10 pts, light: ~20 minutes by the rules, but a 1,500-word limit takes ~170
  const r = E.estimateRecord({ kind: 'assign', title: 'Response', points: 10, description: words(60), wordLimit: 1500 });
  assert.strictEqual(r.minutes, 170);
  assert.ok(r.factors.some((f) => f.includes('1500-word limit')));
  // a small limit never lowers an estimate
  assert.strictEqual(E.estimateRecord({ kind: 'assign', title: 'Homework', points: 100, description: words(60), wordLimit: 100 }).minutes, 120);
});

test('estimates are bounded and rounded to 5 minutes', () => {
  const tiny = E.estimateRecord({ kind: 'assign', title: 'Reading', points: 1, description: '' });
  assert.ok(tiny.minutes >= 15);
  const huge = E.estimateRecord({ kind: 'assign', title: 'Thesis', points: 1000, description: words(900), files: [{}], wordLimit: 50000 });
  assert.strictEqual(huge.minutes, 600);
  [tiny, huge, E.estimateRecord({ kind: 'assign', title: 'x', points: 37, description: words(77) })].forEach((r) => {
    assert.strictEqual(r.minutes % 5, 0);
    assert.ok(r.low <= r.minutes && r.minutes <= r.high);
  });
});

test('estimateRecord copes with missing fields', () => {
  assert.doesNotThrow(() => E.estimateRecord({}));
  assert.doesNotThrow(() => E.estimateRecord(undefined));
  assert.ok(E.estimateRecord({}).minutes >= 15);
});

test('estimateForItem reads the Moodle details from item.source', () => {
  const item = { title: 'Quiz 4', source: { type: 'moodle', kind: 'quiz', timeLimitMin: 20 } };
  assert.strictEqual(E.estimateForItem(item).minutes, 40);
  const a = { title: 'Assignment 6', source: { type: 'moodle', kind: 'assign', points: 100, description: words(10), files: [] } };
  assert.strictEqual(E.estimateForItem(a).minutes, 100);
});

/* ---------- user override, parts, applying ---------- */

test('userEstimate is exact, rounded to 5 and clamped', () => {
  assert.deepStrictEqual(E.userEstimate(92), { minutes: 90, low: 90, high: 90, basis: 'user', confidence: 'high', factors: ['set by you'] });
  assert.strictEqual(E.userEstimate(1).minutes, 15);
  assert.strictEqual(E.userEstimate(99999).minutes, 600);
});

test('partsFor splits work into roughly 50-minute parts, never more than 8, quizzes stay whole', () => {
  const cases = [[20, 1], [40, 1], [70, 1], [75, 2], [100, 2], [125, 3], [150, 3], [200, 4], [400, 8], [600, 8]];
  cases.forEach(([m, n]) => assert.strictEqual(E.partsFor(m, 'assign'), n, m + ' min -> ' + n));
  assert.strictEqual(E.partsFor(270, 'quiz'), 1);
});

function imported(over = {}) {
  return { id: 'moodle:1', title: 'A', total: 1, unit: 'assignment', done: 0, today: 0, completed: false, source: { type: 'moodle', kind: 'assign' }, ...over };
}

test('withEstimate re-splits an untouched imported item into parts', () => {
  const next = E.withEstimate(imported(), E.userEstimate(150));
  assert.strictEqual(next.total, 3);
  assert.strictEqual(next.unit, 'part');
  assert.strictEqual(next.estimate.minutes, 150);
  const small = E.withEstimate(imported({ total: 3, unit: 'part' }), E.userEstimate(30));
  assert.strictEqual(small.total, 1);
  assert.strictEqual(small.unit, 'assignment');
  const quiz = E.withEstimate(imported({ source: { type: 'moodle', kind: 'quiz' } }), E.userEstimate(300));
  assert.strictEqual(quiz.total, 1);
  assert.strictEqual(quiz.unit, 'quiz');
});

test('withEstimate never reinterprets progress: items with progress keep their parts', () => {
  const started = imported({ total: 3, unit: 'part', done: 1, today: 1 });
  const next = E.withEstimate(started, E.userEstimate(400));
  assert.strictEqual(next.total, 3);
  assert.strictEqual(next.done, 1);
  assert.strictEqual(next.estimate.minutes, 400);
  const earlierProgress = imported({ total: 3, unit: 'part', done: 1, today: 0 });
  assert.strictEqual(E.withEstimate(earlierProgress, E.userEstimate(400)).total, 3);
  const completed = imported({ completed: true });
  assert.strictEqual(E.withEstimate(completed, E.userEstimate(400)).total, 1);
});

test('withEstimate leaves manual items\' units alone and does not mutate the input', () => {
  const manual = { id: 'm', title: 'Read book', total: 12, unit: 'pages', done: 0, today: 0, completed: false };
  const next = E.withEstimate(manual, E.userEstimate(120));
  assert.strictEqual(next.total, 12);
  assert.strictEqual(next.unit, 'pages');
  assert.strictEqual(next.estimate.minutes, 120);
  const it = imported();
  E.withEstimate(it, E.userEstimate(150));
  assert.strictEqual(it.total, 1);
  assert.strictEqual(it.estimate, undefined);
});

test('sameEstimate compares the numbers and basis', () => {
  const a = E.userEstimate(60);
  assert.strictEqual(E.sameEstimate(a, { ...a }), true);
  assert.strictEqual(E.sameEstimate(a, E.userEstimate(65)), false);
  assert.strictEqual(E.sameEstimate(a, null), false);
});
