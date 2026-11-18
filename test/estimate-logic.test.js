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
  assert.deepStrictEqual(E.userEstimate(92), { minutes: 90, low: 90, high: 90, basis: 'user', confidence: 'high', factors: ['set by you'], steps: [] });
  assert.strictEqual(E.userEstimate(1).minutes, 15);
  assert.strictEqual(E.userEstimate(99999).minutes, 600);
});

test('partsFor splits work into roughly 50-minute parts, never more than 8, quizzes stay whole', () => {
  const cases = [[20, 1], [40, 1], [70, 1], [75, 2], [100, 2], [125, 3], [150, 3], [200, 4], [400, 8], [600, 8]];
  cases.forEach(([m, n]) => assert.strictEqual(E.partsFor(m, 'assign'), n, m + ' min -> ' + n));
  assert.strictEqual(E.partsFor(270, 'quiz'), 1);
});

function imported(over = {}) {
  return { id: 'moodle:1', title: 'A', total: 1, unit: 'assignment', done: 0, today: 0, completed: false, due: '2026-12-01', source: { type: 'moodle', kind: 'assign' }, ...over };
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

/* ---------- Phase 4: Claude's estimates and named steps ---------- */

const modelResult = (over = {}) => ({ minutes: 100, low: 70, high: 140, confidence: 'medium', rationale: 'Seven problems.', steps: [{ name: 'Problems 4-7', minutes: 50 }, { name: 'Problems 8-10', minutes: 50 }], ...over });

test('inputsKey changes with anything the estimate depends on, and only that', () => {
  const base = imported({ title: 'A6', source: { type: 'moodle', kind: 'assign', points: 100, description: 'Do it', files: [{ name: 'a.pdf', size: 1 }], timeLimitMin: null, wordLimit: null, submissionTypes: ['file'] } });
  const k = E.inputsKey(base);
  assert.match(k, /^[0-9a-z]+$/);
  assert.strictEqual(E.inputsKey({ ...base }), k);
  const withSource = (over) => ({ ...base, source: { ...base.source, ...over } });
  assert.notStrictEqual(E.inputsKey({ ...base, title: 'A7' }), k);
  assert.notStrictEqual(E.inputsKey(withSource({ description: 'Do it differently' })), k);
  assert.notStrictEqual(E.inputsKey(withSource({ points: 50 })), k);
  assert.notStrictEqual(E.inputsKey(withSource({ files: [] })), k);
  assert.notStrictEqual(E.inputsKey(withSource({ wordLimit: 500 })), k);
  assert.strictEqual(E.inputsKey(withSource({ state: 'submitted', link: 'x' })), k, 'state and link do not change the estimate');
  assert.strictEqual(E.inputsKey({ ...base, done: 2, notes: 'mine', due: '2030-01-01' }), k, 'user progress and due dates do not either');
});

test('estimateForItem stamps the key and sameEstimate respects it', () => {
  const it1 = imported({ title: 'Quiz', source: { type: 'moodle', kind: 'quiz', timeLimitMin: 20 } });
  const a = E.estimateForItem(it1);
  assert.strictEqual(a.key, E.inputsKey(it1));
  assert.strictEqual(E.sameEstimate(a, { ...a }), true);
  assert.strictEqual(E.sameEstimate(a, { ...a, key: 'different' }), false);
});

test('fromModel builds a model-basis estimate, drops steps for a quiz, and tolerates missing fields', () => {
  const e = E.fromModel(modelResult(), 'k1', 'assign');
  assert.deepStrictEqual([e.minutes, e.low, e.high, e.basis, e.confidence, e.key], [100, 70, 140, 'model', 'medium', 'k1']);
  assert.deepStrictEqual(e.factors, ['Seven problems.']);
  assert.strictEqual(e.steps.length, 2);
  assert.deepStrictEqual(E.fromModel(modelResult(), 'k', 'quiz').steps, []);
  const bare = E.fromModel({ minutes: 60, low: 40, high: 90 }, 'k', 'assign');
  assert.deepStrictEqual([bare.confidence, bare.factors, bare.steps], ['low', [], []]);
});

test('partsFor uses the number of named steps when there are some', () => {
  assert.strictEqual(E.partsFor(300, 'assign', [{ name: 'a', minutes: 150 }, { name: 'b', minutes: 150 }]), 2);
  assert.strictEqual(E.partsFor(300, 'assign', []), 6, 'no steps: ~50 minutes each');
  assert.strictEqual(E.partsFor(300, 'assign'), 6);
  assert.strictEqual(E.partsFor(300, 'quiz', [{ name: 'a', minutes: 1 }, { name: 'b', minutes: 1 }]), 1);
  assert.strictEqual(E.partsFor(60, 'assign', Array.from({ length: 12 }, (_, i) => ({ name: 's' + i, minutes: 5 }))), 8, 'capped at 8');
});

test('withEstimate splits an untouched item into one part per named step', () => {
  const next = E.withEstimate(imported(), E.fromModel(modelResult({ minutes: 150, steps: [{ name: 'Read', minutes: 25 }, { name: 'Solve', minutes: 100 }, { name: 'Write up', minutes: 25 }] }), 'k', 'assign'));
  assert.strictEqual(next.total, 3);
  assert.strictEqual(next.unit, 'part');
  assert.strictEqual(E.stepName(next, 1), 'Solve');
  assert.strictEqual(E.stepName(next, 5), null);
});

test('a started item keeps its parts, so mismatched steps are not trusted', () => {
  const started = imported({ total: 3, unit: 'part', done: 1, today: 1 });
  const next = E.withEstimate(started, E.fromModel(modelResult(), 'k', 'assign')); // 2 steps, 3 parts
  assert.strictEqual(next.total, 3);
  assert.strictEqual(E.stepsUsable(next), false);
  assert.strictEqual(E.stepName(next, 0), null);
});

test('stepsUsable needs exactly one step per part', () => {
  const steps = [{ name: 'a', minutes: 50 }, { name: 'b', minutes: 50 }];
  assert.strictEqual(E.stepsUsable({ total: 2, estimate: { steps } }), true);
  assert.strictEqual(E.stepsUsable({ total: 3, estimate: { steps } }), false);
  assert.strictEqual(E.stepsUsable({ total: 2, estimate: { steps: [] } }), false);
  assert.strictEqual(E.stepsUsable({ total: 2 }), false);
  assert.strictEqual(E.stepsUsable({ total: 1, estimate: { steps: [{ name: 'only', minutes: 20 }] } }), true);
});

test('scaleSteps keeps names and count and makes the minutes add up', () => {
  const steps = [{ name: 'A', minutes: 25 }, { name: 'B', minutes: 50 }, { name: 'C', minutes: 25 }];
  const s = E.scaleSteps(steps, 200);
  assert.deepStrictEqual(s.map((x) => x.name), ['A', 'B', 'C']);
  assert.strictEqual(s.reduce((a, x) => a + x.minutes, 0), 200);
  s.forEach((x) => assert.strictEqual(x.minutes % 5, 0));
  assert.deepStrictEqual(E.scaleSteps(steps, 10), [], 'cannot fit 3 steps in 10 minutes');
  assert.deepStrictEqual(E.scaleSteps([], 100), []);
  assert.deepStrictEqual(E.scaleSteps(null, 100), []);
  assert.deepStrictEqual(E.scaleSteps([{ name: 'z', minutes: 0 }], 100), []);
});

test('adjusting a Claude estimate by hand keeps its step names', () => {
  const claude = E.fromModel(modelResult({ minutes: 100, steps: [{ name: 'Read', minutes: 25 }, { name: 'Solve', minutes: 75 }] }), 'k', 'assign');
  const mine = E.userEstimate(130, claude.steps);
  assert.strictEqual(mine.basis, 'user');
  assert.deepStrictEqual(mine.steps.map((x) => x.name), ['Read', 'Solve']);
  assert.strictEqual(mine.steps.reduce((a, x) => a + x.minutes, 0), 130);
  const next = E.withEstimate(E.withEstimate(imported(), claude), mine);
  assert.strictEqual(next.total, 2);
  assert.strictEqual(E.stepName(next, 1), 'Solve');
});
