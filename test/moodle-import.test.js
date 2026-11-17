const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
require('../js/courses.js');
require('../js/estimate-logic.js');
require('../js/moodle-client.js');

const M = global.TPMoodle;
const TODAY = '2026-11-17';
const NOW = 1_800_000_000_000;

// Build epoch seconds from LOCAL calendar parts so the tests hold in any timezone.
const ts = (y, mo, d, h = 9) => Math.floor(new Date(y, mo - 1, d, h, 0, 0).getTime() / 1000);

function rec(over = {}) {
  return {
    id: 'moodle:5001', cmid: 5001, instanceId: 101, courseId: 7, course: 'MATH 2400', kind: 'assign',
    title: 'Assignment 6', dueTs: ts(2026, 11, 19), opensTs: ts(2026, 11, 1, 0), cutoffTs: null, points: 100,
    description: 'Do problems.', files: [{ name: 'a.pdf', size: 10 }], timeLimitMin: null,
    link: 'https://m.example.edu/mod/assign/view.php?id=5001', state: 'none', ...over,
  };
}

const ctx = (extra = {}) => ({ today: TODAY, now: NOW, deletedLog: [], ...extra });

test('localDate uses the local calendar date', () => {
  assert.strictEqual(M.localDate(ts(2026, 11, 19, 9)), '2026-11-19');
  assert.strictEqual(M.localDate(ts(2026, 11, 19, 23)), '2026-11-19');
  assert.strictEqual(M.localDate(ts(2026, 1, 5, 0)), '2026-01-05');
});

test('a new record becomes a normal one-unit item with Moodle details on `source`', () => {
  const { items, stats, events } = M.mergeImported([], [rec()], ctx());
  assert.strictEqual(items.length, 1);
  const it = items[0];
  assert.strictEqual(it.id, 'moodle:5001');
  assert.strictEqual(it.title, 'Assignment 6');
  assert.strictEqual(it.course, 'MATH 2400');
  assert.strictEqual(it.due, '2026-11-19');
  // 100 pts -> 120 base, a 2-word description x0.85, +15 for the handout = 115 min -> 2 parts
  assert.strictEqual(it.estimate.minutes, 115);
  assert.strictEqual(it.estimate.basis, 'heuristic');
  assert.strictEqual(it.total, 2);
  assert.strictEqual(it.unit, 'part');
  const quizItem = M.mergeImported([], [rec({ id: 'moodle:9', cmid: 9, kind: 'quiz', timeLimitMin: 20 })], ctx()).items[0];
  assert.strictEqual(quizItem.total, 1, 'a quiz is one sitting');
  assert.strictEqual(quizItem.unit, 'quiz');
  assert.strictEqual(quizItem.estimate.basis, 'quiz-limit');
  assert.strictEqual(it.done, 0);
  assert.strictEqual(it.completed, false);
  assert.strictEqual(it.createdAt, TODAY);
  assert.strictEqual(it.source.type, 'moodle');
  assert.strictEqual(it.source.cmid, 5001);
  assert.strictEqual(it.source.opens, '2026-11-01');
  assert.strictEqual(it.source.description, 'Do problems.');
  assert.ok(M.isImported(it));
  assert.deepStrictEqual(stats, { added: 1, updated: 0, moved: 0, completed: 0, skippedDeleted: 0, skippedOld: 0 });
  assert.deepStrictEqual(events.map((e) => e.kind), ['new']);
});

test('re-importing the same record changes nothing and does not touch updatedAt', () => {
  const first = M.mergeImported([], [rec()], ctx());
  const again = M.mergeImported(first.items, [rec()], ctx({ now: NOW + 5000 }));
  assert.strictEqual(again.items.length, 1);
  assert.deepStrictEqual(again.stats, { added: 0, updated: 0, moved: 0, completed: 0, skippedDeleted: 0, skippedOld: 0 });
  assert.strictEqual(again.items[0], first.items[0], 'same object when nothing changed');
  assert.deepStrictEqual(again.events, []);
});

test('Moodle-owned fields update, user-owned fields are never touched', () => {
  const first = M.mergeImported([], [rec()], ctx());
  const mine = { ...first.items[0], notes: 'my note', subtasks: [{ text: 'step', done: true }], today: 1, order: 7, dependsOn: 'X', recurring: 'weekly' };
  const out = M.mergeImported([mine], [rec({ title: 'Assignment 6 (revised)', description: 'New text', dueTs: ts(2026, 11, 20) })], ctx({ now: NOW + 1000 }));
  const it = out.items[0];
  assert.strictEqual(it.title, 'Assignment 6 (revised)');
  assert.strictEqual(it.due, '2026-11-20');
  assert.strictEqual(it.source.description, 'New text');
  assert.strictEqual(it.notes, 'my note');
  assert.deepStrictEqual(it.subtasks, [{ text: 'step', done: true }]);
  assert.strictEqual(it.today, 1);
  assert.strictEqual(it.order, 7);
  assert.strictEqual(it.dependsOn, 'X');
  assert.strictEqual(it.recurring, 'weekly');
  assert.strictEqual(it.updatedAt, NOW + 1000);
  assert.strictEqual(out.stats.moved, 1);
  assert.deepStrictEqual(out.events, [{ kind: 'moved', id: 'moodle:5001', title: 'Assignment 6 (revised)', course: 'MATH 2400', from: '2026-11-19', to: '2026-11-20' }]);
});

test('the input array and items are not mutated', () => {
  const first = M.mergeImported([], [rec()], ctx());
  const snapshot = JSON.stringify(first.items);
  M.mergeImported(first.items, [rec({ title: 'Changed', state: 'submitted' })], ctx());
  assert.strictEqual(JSON.stringify(first.items), snapshot);
});

test('a submitted record completes an open item, but never un-completes one', () => {
  const first = M.mergeImported([], [rec()], ctx());
  const done = M.mergeImported(first.items, [rec({ state: 'submitted' })], ctx());
  assert.strictEqual(done.items[0].completed, true);
  assert.strictEqual(done.items[0].done, done.items[0].total, 'completing finishes every part');
  assert.strictEqual(done.items[0].completedAt, TODAY);
  assert.strictEqual(done.stats.completed, 1);
  const back = M.mergeImported(done.items, [rec({ state: 'none' })], ctx());
  assert.strictEqual(back.items[0].completed, true, 'never lowers a status');
  // a user who completed it by hand keeps it completed too
  const manual = { ...first.items[0], completed: true, done: 1, completedAt: '2026-11-18' };
  const kept = M.mergeImported([manual], [rec({ state: 'none' })], ctx());
  assert.strictEqual(kept.items[0].completed, true);
  assert.strictEqual(kept.items[0].completedAt, '2026-11-18');
});

test('a sync that skipped the state check keeps the last known state', () => {
  const first = M.mergeImported([], [rec({ state: 'draft' })], ctx());
  const skipped = M.mergeImported(first.items, [rec({ state: null })], ctx());
  assert.strictEqual(skipped.items[0].source.state, 'draft');
  assert.strictEqual(skipped.stats.updated, 0);
});

test('deleted (tombstoned) items are not re-added', () => {
  const out = M.mergeImported([], [rec()], ctx({ deletedLog: [{ id: 'moodle:5001', deletedAt: 1 }] }));
  assert.strictEqual(out.items.length, 0);
  assert.strictEqual(out.stats.skippedDeleted, 1);
});

test('old submitted work is not imported, recent submitted work arrives already completed', () => {
  const old = rec({ id: 'moodle:1', cmid: 1, dueTs: ts(2026, 9, 1), state: 'submitted' });
  const recent = rec({ id: 'moodle:2', cmid: 2, dueTs: ts(2026, 11, 12), state: 'submitted' });
  const overdueOpen = rec({ id: 'moodle:3', cmid: 3, dueTs: ts(2026, 9, 1), state: 'none' });
  const out = M.mergeImported([], [old, recent, overdueOpen], ctx());
  assert.deepStrictEqual(out.items.map((i) => i.id), ['moodle:2', 'moodle:3']);
  assert.strictEqual(out.items[0].completed, true);
  assert.strictEqual(out.items[1].completed, false, 'old but unsubmitted work still shows up as overdue');
  assert.strictEqual(out.stats.skippedOld, 1);
});

test('imported items append after existing ones in `order`, and manual items are untouched', () => {
  const manual = { id: 'a', title: 'Manual', course: 'X', due: '2026-12-01', total: 1, done: 0, order: 4 };
  const out = M.mergeImported([manual], [rec(), rec({ id: 'moodle:5002', cmid: 5002 })], ctx());
  assert.strictEqual(out.items[0], manual);
  assert.deepStrictEqual(out.items.slice(1).map((i) => i.order), [5, 6]);
});

test('ensureCourses adds each imported course code once, with a colour', () => {
  const courses = [{ id: 'c1', name: 'math 2400', color: '#111111' }];
  const added = M.ensureCourses(courses, [rec(), rec({ course: 'PHIL 2202' }), rec({ course: 'PHIL 2202' }), rec({ course: '' })], global.TPCourses);
  assert.strictEqual(added, 1);
  assert.deepStrictEqual(courses.map((c) => c.name), ['math 2400', 'PHIL 2202']);
  assert.ok(courses[1].color);
});

test('shouldAutoSync waits for the interval and needs a connection', () => {
  const H = 3600 * 1000;
  assert.strictEqual(M.shouldAutoSync(null, NOW), false);
  assert.strictEqual(M.shouldAutoSync({ connected: false }, NOW), false);
  assert.strictEqual(M.shouldAutoSync({ connected: true, lastSyncAt: null }, NOW), true);
  assert.strictEqual(M.shouldAutoSync({ connected: true, lastSyncAt: NOW - 2 * H }, NOW), false);
  assert.strictEqual(M.shouldAutoSync({ connected: true, lastSyncAt: NOW - 4 * H }, NOW), true);
});

test('summarize reads naturally', () => {
  assert.strictEqual(M.summarize({ added: 0, moved: 0, completed: 0 }), 'Moodle is up to date');
  assert.strictEqual(M.summarize({ added: 2, moved: 1, completed: 0 }), 'Moodle: 2 new, 1 date changed');
  assert.strictEqual(M.summarize({ added: 0, moved: 3, completed: 1 }), 'Moodle: 3 dates changed, 1 submitted');
});

test('an item already submitted when first imported gets an estimate but is not split', () => {
  const out = M.mergeImported([], [rec({ state: 'submitted', dueTs: ts(2026, 11, 15) })], ctx());
  assert.strictEqual(out.items[0].completed, true);
  assert.strictEqual(out.items[0].total, 1);
  assert.ok(out.items[0].estimate.minutes > 0);
});

test('changed Moodle details re-estimate an untouched item and re-split its parts', () => {
  const first = M.mergeImported([], [rec()], ctx());
  assert.strictEqual(first.items[0].total, 2);
  const long = 'word '.repeat(400);
  const again = M.mergeImported(first.items, [rec({ description: long })], ctx({ now: NOW + 1000 }));
  // 120 x1.4 = 168 + 15 = 183 -> 185 min -> 4 parts
  assert.strictEqual(again.items[0].estimate.minutes, 185);
  assert.strictEqual(again.items[0].total, 4);
  assert.strictEqual(again.items[0].updatedAt, NOW + 1000);
});

test('re-estimating keeps the parts of an item with progress, and never touches a user-set estimate', () => {
  const first = M.mergeImported([], [rec()], ctx());
  const started = { ...first.items[0], done: 1, today: 1 };
  const long = 'word '.repeat(400);
  const again = M.mergeImported([started], [rec({ description: long })], ctx());
  assert.strictEqual(again.items[0].estimate.minutes, 185);
  assert.strictEqual(again.items[0].total, 2, 'progress is not reinterpreted');
  assert.strictEqual(again.items[0].done, 1);

  const mine = { ...first.items[0], estimate: global.TPEstimate.userEstimate(30) };
  const kept = M.mergeImported([mine], [rec({ description: long })], ctx());
  assert.strictEqual(kept.items[0].estimate.minutes, 30);
  assert.strictEqual(kept.items[0].estimate.basis, 'user');
});

test('items imported before estimates existed get one on the next sync', () => {
  const legacy = { ...M.mergeImported([], [rec()], ctx()).items[0] };
  delete legacy.estimate;
  legacy.total = 1;
  legacy.unit = 'assignment';
  const out = M.mergeImported([legacy], [rec()], ctx({ now: NOW + 1 }));
  assert.strictEqual(out.items[0].estimate.minutes, 115);
  assert.strictEqual(out.items[0].total, 2);
});

test('submission types and word limit reach the item and the estimate', () => {
  const out = M.mergeImported([], [rec({ points: 10, title: 'Response', description: 'x', files: [], submissionTypes: ['onlinetext'], wordLimit: 1500 })], ctx());
  assert.deepStrictEqual(out.items[0].source.submissionTypes, ['onlinetext']);
  assert.strictEqual(out.items[0].source.wordLimit, 1500);
  assert.strictEqual(out.items[0].estimate.minutes, 170);
});
