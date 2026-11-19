// Your own times adjust estimates for SIMILAR work only.
const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
require('../js/estimate-logic.js');
require('../js/learning.js');
const L = global.TPLearn;

const est = (minutes, over = {}) => ({ minutes, low: minutes - 10, high: minutes + 15, basis: 'model', confidence: 'medium', factors: [], steps: [], ...over });
const mk = (id, title, over = {}) => ({ id, title, course: 'FYSE 1000', due: '2026-12-01', total: 1, unit: 'assignment', done: 0, today: 0, completed: false,
  source: { type: 'moodle', kind: 'assign', cmid: 1 }, estimate: est(45), ...over });
const finished = (id, title, actual, e = 45) => mk(id, title, { completed: true, done: 1, estimate: est(e), actual: { minutes: actual, est: e, at: 1 } });

test('stem and label drop numbers but keep what makes work different', () => {
  assert.strictEqual(L.stem('Journal & Reflection #4'), 'journal & reflection');
  assert.strictEqual(L.stem('Journal &amp; Reflection 12'), 'journal & reflection');
  assert.strictEqual(L.stem('Assignment 11'), 'assignment');
  assert.strictEqual(L.stem('Essay 2: Death Penalty'), 'essay: death penalty');
  assert.notStrictEqual(L.stem('Journal & Reflection #4'), L.stem('Reflective Essay'));
  assert.strictEqual(L.label('Journal & Reflection #4'), 'Journal & Reflection');
  assert.strictEqual(L.keyOf({ title: '#1', course: 'X' }), '', 'too short to compare');
});

test('similar = same course, same kind, same title once numbers are removed', () => {
  const a = mk('a', 'Journal & Reflection #1');
  assert.strictEqual(L.keyOf(a), L.keyOf(mk('b', 'Journal & Reflection #4')));
  assert.notStrictEqual(L.keyOf(a), L.keyOf(mk('c', 'Journal & Reflection #4', { course: 'PHIL 2202' })));
  assert.notStrictEqual(L.keyOf(a), L.keyOf(mk('d', 'Journal & Reflection #4', { source: { type: 'moodle', kind: 'quiz' } })));
  assert.notStrictEqual(L.keyOf(a), L.keyOf(mk('e', 'Reflective Essay')));
});

test('journals 1-3 took about 20 min each (estimated 45): journal 4 is scaled, an essay in the same course is not', () => {
  const items = [finished('1', 'Journal & Reflection #1', 20), finished('2', 'Journal & Reflection #2', 25), finished('3', 'Journal & Reflection #3', 15),
    mk('4', 'Journal & Reflection #4'), mk('essay', 'Reflective Essay', { estimate: est(120) })];
  assert.strictEqual(L.applyLearning(items), true);
  const j4 = items[3], essay = items[4];
  assert.strictEqual(j4.estimate.minutes, 20, '45 x median(0.44, 0.56, 0.33) = 45 x 0.44');
  assert.deepStrictEqual({ n: j4.estimate.learned.n, label: j4.estimate.learned.label }, { n: 3, label: 'Journal & Reflection' });
  assert.strictEqual(j4.estimate.raw.minutes, 45, 'the original number is kept');
  assert.strictEqual(essay.estimate.minutes, 120, 'different kind of work: untouched');
  assert.strictEqual(essay.estimate.learned, undefined);
  assert.strictEqual(L.applyLearning(items), false, 'idempotent');
});

test('one finished example is not enough; two are', () => {
  const one = [finished('1', 'Journal #1', 20), mk('4', 'Journal #4')];
  assert.strictEqual(L.applyLearning(one), false);
  assert.strictEqual(one[1].estimate.minutes, 45);
  const two = [finished('1', 'Journal #1', 20), finished('2', 'Journal #2', 20), mk('4', 'Journal #4')];
  assert.strictEqual(L.applyLearning(two), true);
});

test('your own estimate, quiz limits, finished and ignored-by-kind items are never scaled', () => {
  const base = [finished('1', 'Journal #1', 20), finished('2', 'Journal #2', 20)];
  const mine = mk('4', 'Journal #4', { estimate: est(60, { basis: 'user' }) });
  const quiz = mk('5', 'Journal #5', { estimate: est(30, { basis: 'quiz-limit' }) });
  const done = mk('6', 'Journal #6', { completed: true });
  const manual = { id: 'm', title: 'Journal #7', course: 'FYSE 1000', estimate: est(45) };
  const items = [...base, mine, quiz, done, manual];
  assert.strictEqual(L.applyLearning(items), false);
  assert.deepStrictEqual(items.slice(2).map((i) => i.estimate.minutes), [60, 30, 45, 45]);
});

test('a factor close to 1 is left alone; extremes are clamped; results stay in range and in steps of 5', () => {
  const near = [finished('1', 'Reading #1', 44), finished('2', 'Reading #2', 47), mk('3', 'Reading #3')];
  assert.strictEqual(L.applyLearning(near), false);
  const tiny = [finished('1', 'Reading #1', 1), finished('2', 'Reading #2', 1), mk('3', 'Reading #3')];
  L.applyLearning(tiny);
  assert.strictEqual(tiny[2].estimate.minutes, 15, 'factor clamps to 0.3 and the result to the 15-minute floor');
  const huge = [finished('1', 'Lab #1', 600), finished('2', 'Lab #2', 600), mk('3', 'Lab #3', { estimate: est(300) })];
  L.applyLearning(huge);
  assert.strictEqual(huge[2].estimate.minutes, 600, 'capped at the 600-minute ceiling');
  assert.strictEqual(huge[2].estimate.minutes % 5, 0);
});

test('when the data goes away the adjustment is undone; a new AI estimate is adjusted again', () => {
  const items = [finished('1', 'Journal #1', 20), finished('2', 'Journal #2', 20), mk('4', 'Journal #4')];
  L.applyLearning(items);
  assert.strictEqual(items[2].estimate.minutes, 20);
  delete items[1].actual;
  assert.strictEqual(L.applyLearning(items), true);
  assert.strictEqual(items[2].estimate.minutes, 45);
  assert.strictEqual(items[2].estimate.learned, undefined);
  assert.strictEqual(items[2].estimate.raw, undefined);
  items[1].actual = { minutes: 20, est: 45, at: 2 };
  items[2].estimate = est(90); // the AI answered again with a new number
  L.applyLearning(items);
  assert.strictEqual(items[2].estimate.minutes, 40, '90 x 0.44');
});

test('steps are scaled with the minutes and the untouched item is re-split into fewer parts', () => {
  const steps = [{ name: 'Read', minutes: 30 }, { name: 'Write', minutes: 60 }, { name: 'Check', minutes: 30 }];
  const items = [finished('1', 'Essay #1', 60, 120), finished('2', 'Essay #2', 60, 120), mk('3', 'Essay #3', { total: 3, unit: 'part', estimate: est(120, { steps }) })];
  L.applyLearning(items);
  const e = items[2].estimate;
  assert.strictEqual(e.minutes, 60);
  assert.strictEqual(e.steps.reduce((s, x) => s + x.minutes, 0), 60);
  assert.strictEqual(e.steps.length, items[2].total, 'parts follow the steps');
});

test('recordActual keeps the estimate the item had, never the adjusted one, and rejects junk', () => {
  const it = mk('1', 'Journal #1');
  const a = L.recordActual(it, 25, 99);
  assert.deepStrictEqual(a, { minutes: 25, est: 45, at: 99 });
  assert.strictEqual(L.recordActual(mk('2', 'x'), 0), null);
  assert.strictEqual(L.recordActual(mk('2', 'x'), 'abc'), null);
  const adjusted = mk('3', 'Journal #3', { estimate: est(20, { raw: { minutes: 45, low: 35, high: 60, steps: [] }, learned: { factor: 0.44, n: 2, label: 'Journal' } }) });
  assert.strictEqual(L.recordActual(adjusted, 25).est, 45, 'compared with the ORIGINAL estimate so ratios do not compound');
  assert.strictEqual(L.recordActual(mk('4', 'y', { estimate: undefined }), 30), null, 'no estimate to compare with');
  assert.strictEqual(L.canAsk(mk('5', 'z')), true);
  assert.strictEqual(L.canAsk({ title: 'no estimate' }), false);
});
