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

/* ---------- Phase 4: Claude's estimates ---------- */

const claude = (over = {}) => ({ minutes: 150, low: 110, high: 210, confidence: 'medium', rationale: 'Seven problems and a proof.', steps: [{ name: 'Read', minutes: 25 }, { name: 'Problems 4-7', minutes: 75 }, { name: 'Write up', minutes: 50 }], ...over });

function withClaude(over = {}) {
  const first = M.mergeImported([], [rec()], ctx()).items[0];
  return global.TPEstimate.withEstimate(first, global.TPEstimate.fromModel(claude(over), global.TPEstimate.inputsKey(first), 'assign'));
}

test('a Claude estimate survives a sync while the assignment is unchanged', () => {
  const it0 = withClaude();
  assert.strictEqual(it0.estimate.basis, 'model');
  assert.strictEqual(it0.total, 3);
  const out = M.mergeImported([it0], [rec()], ctx({ now: NOW + 5000 }));
  assert.strictEqual(out.items[0], it0, 'untouched: same object, no update');
  assert.strictEqual(out.stats.updated, 0);
});

test('when Moodle changes the description, the old Claude answer is dropped for the rule of thumb', () => {
  const it0 = withClaude();
  const out = M.mergeImported([it0], [rec({ description: 'Completely different instructions. '.repeat(30) })], ctx({ now: NOW + 5000 }));
  assert.strictEqual(out.items[0].estimate.basis, 'heuristic');
  assert.strictEqual(out.items[0].source.description.startsWith('Completely different'), true);
  // 90 words -> x1; 120 base for 100 points + 15 for the handout = 135 minutes -> round(135/50) = 3 parts
  assert.strictEqual(out.items[0].estimate.minutes, 135);
  assert.strictEqual(out.items[0].total, 3);
  assert.strictEqual(global.TPEstimate.stepsUsable(out.items[0]), false, 'the old step names are gone with the old answer');
  assert.notStrictEqual(out.items[0].estimate.key, it0.estimate.key);
});

test('needsModel: only unfinished imported work with the rule-of-thumb estimate', () => {
  const base = M.mergeImported([], [rec()], ctx()).items[0];
  assert.strictEqual(M.needsModel(base, TODAY), true);
  assert.strictEqual(M.needsModel(withClaude(), TODAY), false, 'already has Claude\'s answer');
  assert.strictEqual(M.needsModel({ ...base, estimate: global.TPEstimate.userEstimate(60) }, TODAY), false, 'your number');
  assert.strictEqual(M.needsModel({ ...base, completed: true }, TODAY), false);
  assert.strictEqual(M.needsModel({ ...base, archived: true }, TODAY), false);
  assert.strictEqual(M.needsModel({ ...base, estimate: undefined }, TODAY), false);
  assert.strictEqual(M.needsModel({ id: 'm', title: 'manual', estimate: global.TPEstimate.userEstimate(60) }, TODAY), false, 'manual items never go to Claude');
  const quiz = M.mergeImported([], [rec({ id: 'moodle:9', cmid: 9, kind: 'quiz', timeLimitMin: 20 })], ctx()).items[0];
  assert.strictEqual(M.needsModel(quiz, TODAY), false, 'a known quiz time limit needs no asking');
  const quizNoLimit = M.mergeImported([], [rec({ id: 'moodle:8', cmid: 8, kind: 'quiz', timeLimitMin: null })], ctx()).items[0];
  assert.strictEqual(M.needsModel(quizNoLimit, TODAY), true, 'but a quiz with no limit does');
});

test('needsModel: an item that failed today is not retried today, but is tomorrow or after it changes', () => {
  const base = M.mergeImported([], [rec()], ctx()).items[0];
  const key = global.TPEstimate.inputsKey(base);
  const failed = { ...base, modelTry: { key, day: TODAY } };
  assert.strictEqual(M.needsModel(failed, TODAY), false);
  assert.strictEqual(M.needsModel(failed, '2026-11-18'), true);
  const changed = { ...failed, source: { ...failed.source, description: 'new text' } };
  assert.strictEqual(M.needsModel(changed, TODAY), true);
  assert.strictEqual(M.needsModel(withClaude(), TODAY, true), true, 'force asks again even with an answer');
  assert.strictEqual(M.needsModel({ ...base, estimate: global.TPEstimate.userEstimate(60) }, TODAY, true), true, 'force overrides your own number (you pressed the button)');
});

test('modelInput sends the assignment details only', () => {
  const it0 = { ...M.mergeImported([], [rec({ submissionTypes: ['file'], wordLimit: 500 })], ctx()).items[0], notes: 'my private note', completed: false };
  const inp = M.modelInput(it0, 2);
  assert.deepStrictEqual(Object.keys(inp).sort(), ['course', 'description', 'dueInDays', 'files', 'id', 'kind', 'points', 'submissionTypes', 'timeLimitMin', 'title', 'wordLimit']);
  assert.strictEqual(inp.dueInDays, 2);
  assert.deepStrictEqual(inp.files, ['a.pdf']);
  assert.strictEqual(inp.wordLimit, 500);
  assert.ok(!JSON.stringify(inp).includes('private'), 'notes never leave the device');
});

test('applyModelResults applies answers: parts follow the steps, the key is stamped, input is not mutated', () => {
  const base = M.mergeImported([], [rec()], ctx()).items[0];
  const keys = { [base.id]: global.TPEstimate.inputsKey(base) };
  const snapshot = JSON.stringify(base);
  const out = M.applyModelResults([base], [{ id: base.id, ok: true, estimate: claude() }], { today: TODAY, keys });
  assert.strictEqual(out.stats.applied, 1);
  const it1 = out.items[0];
  assert.strictEqual(it1.estimate.basis, 'model');
  assert.strictEqual(it1.estimate.key, keys[base.id]);
  assert.strictEqual(it1.total, 3);
  assert.strictEqual(global.TPEstimate.stepName(it1, 1), 'Problems 4-7');
  assert.strictEqual(JSON.stringify(base), snapshot);
});

test('applyModelResults drops stale answers and never overwrites your number unless forced', () => {
  const base = M.mergeImported([], [rec()], ctx()).items[0];
  const stale = M.applyModelResults([base], [{ id: base.id, ok: true, estimate: claude() }], { today: TODAY, keys: { [base.id]: 'an-old-key' } });
  assert.strictEqual(stale.stats.stale, 1);
  assert.strictEqual(stale.stats.applied, 0);
  assert.strictEqual(stale.items[0].estimate.basis, 'heuristic');
  const mine = { ...base, estimate: global.TPEstimate.userEstimate(40) };
  const kept = M.applyModelResults([mine], [{ id: mine.id, ok: true, estimate: claude() }], { today: TODAY });
  assert.strictEqual(kept.items[0].estimate.basis, 'user');
  const forced = M.applyModelResults([mine], [{ id: mine.id, ok: true, estimate: claude() }], { today: TODAY, force: true });
  assert.strictEqual(forced.items[0].estimate.basis, 'model');
});

test('applyModelResults protects progress: a started item keeps its parts', () => {
  const base = { ...M.mergeImported([], [rec()], ctx()).items[0], done: 1, today: 1 };
  const out = M.applyModelResults([base], [{ id: base.id, ok: true, estimate: claude() }], { today: TODAY });
  assert.strictEqual(out.items[0].estimate.basis, 'model');
  assert.strictEqual(out.items[0].total, base.total, 'parts unchanged');
  assert.strictEqual(out.items[0].done, 1);
});

test('applyModelResults records failures and reports the cases that should stop further asking', () => {
  const base = M.mergeImported([], [rec()], ctx()).items[0];
  const key = global.TPEstimate.inputsKey(base);
  const refused = M.applyModelResults([base], [{ id: base.id, ok: false, error: 'refused' }], { today: TODAY });
  assert.deepStrictEqual(refused.items[0].modelTry, { key, day: TODAY });
  assert.strictEqual(refused.stats.failed, 1);
  const busy = M.applyModelResults([base], [{ id: base.id, ok: false, error: 'busy' }], { today: TODAY });
  assert.strictEqual(busy.items[0].modelTry, undefined, 'a busy server is not the item\'s fault; retry soon');
  const limited = M.applyModelResults([base], [{ id: base.id, ok: false, error: 'daily_limit' }], { today: TODAY });
  assert.strictEqual(limited.stats.limited, true);
  assert.strictEqual(limited.items[0].modelTry, undefined);
  const down = M.applyModelResults([base], [{ id: base.id, ok: false, error: 'server_misconfigured' }], { today: TODAY });
  assert.strictEqual(down.stats.unavailable, true);
  const unknown = M.applyModelResults([base], [{ id: 'nope', ok: true, estimate: claude() }], { today: TODAY });
  assert.strictEqual(unknown.items[0], base);
});

test('a successful answer clears an earlier failure mark', () => {
  const base = M.mergeImported([], [rec()], ctx()).items[0];
  const failed = { ...base, modelTry: { key: global.TPEstimate.inputsKey(base), day: TODAY } };
  const out = M.applyModelResults([failed], [{ id: failed.id, ok: true, estimate: claude() }], { today: TODAY });
  assert.strictEqual(out.items[0].modelTry, undefined);
});
