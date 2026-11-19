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
  assert.strictEqual(M.shouldAutoSync({ connected: true, lastImportAt: null }, NOW), true);
  assert.strictEqual(M.shouldAutoSync({ connected: true, lastImportAt: NOW - 1 * 60000, importShape: M.IMPORT_SHAPE }, NOW), false);
  assert.strictEqual(M.shouldAutoSync({ connected: true, lastImportAt: NOW - 3 * 60000, importShape: M.IMPORT_SHAPE }, NOW), true);
  // An import made before the current data format (e.g. before due times were stored) is redone at once, however recent.
  assert.strictEqual(M.shouldAutoSync({ connected: true, lastImportAt: NOW - 60000 }, NOW), true);
  assert.strictEqual(M.shouldAutoSync({ connected: true, lastImportAt: NOW - 60000, importShape: M.IMPORT_SHAPE - 1 }, NOW), true);
  // The server's own timestamp (set by its 30-minute check) must not make this device think it is current.
  assert.strictEqual(M.shouldAutoSync({ connected: true, lastSyncAt: NOW - 1000, lastImportAt: NOW - 2 * H, importShape: M.IMPORT_SHAPE }, NOW), true);
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
  assert.deepStrictEqual(inp.files, [{ name: 'a.pdf', size: 10 }], 'no download address unless handout reading is on');
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

/* ---------- Phase 4b: handouts ---------- */

const PDF = { name: 'sheet.pdf', size: 4000, url: 'https://m.example.edu/webservice/pluginfile.php/55/sheet.pdf', mime: 'application/pdf', modified: 100 };
function pdfItem(extra = {}) {
  const base = M.mergeImported([], [rec({ files: [PDF] })], ctx()).items[0];
  return { ...base, ...extra };
}
const claudeFiles = (over = {}) => claude({ files: { read: ['sheet.pdf'], skipped: [], retry: false }, ...over });

test('modelInput sends download addresses only when handout reading is on', () => {
  const it0 = pdfItem();
  assert.deepStrictEqual(M.modelInput(it0, 2, true).files, [{ name: 'sheet.pdf', size: 4000, url: PDF.url, mime: 'application/pdf', modified: 100 }]);
  assert.deepStrictEqual(M.modelInput(it0, 2, false).files, [{ name: 'sheet.pdf', size: 4000 }]);
  assert.deepStrictEqual(M.modelInput(it0, 2).files, [{ name: 'sheet.pdf', size: 4000 }]);
});

test('replacing a handout changes the assignment fingerprint, so Claude is asked again', () => {
  const a = pdfItem();
  const replaced = { ...a, source: { ...a.source, files: [{ ...PDF, modified: 200 }] } };
  const bigger = { ...a, source: { ...a.source, files: [{ ...PDF, size: 5000 }] } };
  assert.notStrictEqual(global.TPEstimate.inputsKey(replaced), global.TPEstimate.inputsKey(a));
  assert.notStrictEqual(global.TPEstimate.inputsKey(bigger), global.TPEstimate.inputsKey(a));
});

test('a Claude answer that never read the handout is upgraded once, when reading is on', () => {
  const base = pdfItem();
  const key = global.TPEstimate.inputsKey(base);
  const noRead = M.applyModelResults([base], [{ id: base.id, ok: true, estimate: claude() }], { today: TODAY, readFiles: false }).items[0];
  assert.strictEqual(noRead.estimate.filesAsked, false);
  assert.strictEqual(M.needsModel(noRead, TODAY, false, true), true, 'reading is on now: worth one more try');
  assert.strictEqual(M.needsModel(noRead, TODAY, false, false), false, 'reading is off: leave it alone');
  const read = M.applyModelResults([noRead], [{ id: noRead.id, ok: true, estimate: claudeFiles() }], { today: TODAY, readFiles: true }).items[0];
  assert.deepStrictEqual(read.estimate.filesRead, ['sheet.pdf']);
  assert.strictEqual(read.estimate.filesAsked, true);
  assert.strictEqual(M.needsModel(read, TODAY, false, true), false, 'asked and answered: no loop');
  assert.strictEqual(key, global.TPEstimate.inputsKey(read), 'the answer is for the same text');
});

test('an item with no PDF is never upgraded', () => {
  const plain = M.mergeImported([], [rec()], ctx()).items[0];
  const answered = M.applyModelResults([{ ...plain, source: { ...plain.source, files: [{ name: 'data.csv', size: 5, url: null, mime: 'text/csv', modified: null }] } }], [{ id: plain.id, ok: true, estimate: claude() }], { today: TODAY, readFiles: true }).items[0];
  assert.strictEqual(M.needsModel(answered, TODAY, false, true), false);
});

test('a handout that could not be fetched for a lasting reason is not retried; a temporary failure waits a day', () => {
  const base = pdfItem();
  const tooBig = M.applyModelResults([base], [{ id: base.id, ok: true, estimate: claude({ files: { read: [], skipped: [{ name: 'sheet.pdf', reason: 'too_large' }], retry: false } }) }], { today: TODAY, readFiles: true }).items[0];
  assert.strictEqual(tooBig.estimate.filesAsked, true);
  assert.deepStrictEqual(tooBig.estimate.filesSkipped, [{ name: 'sheet.pdf', reason: 'too_large' }]);
  assert.strictEqual(M.needsModel(tooBig, TODAY, false, true), false);

  const flaky = M.applyModelResults([base], [{ id: base.id, ok: true, estimate: claude({ files: { read: [], skipped: [{ name: 'sheet.pdf', reason: 'unavailable' }], retry: true } }) }], { today: TODAY, readFiles: true }).items[0];
  assert.strictEqual(flaky.estimate.filesAsked, false, 'a temporary failure is not "asked"');
  assert.deepStrictEqual(flaky.modelTry, { key: global.TPEstimate.inputsKey(base), day: TODAY });
  assert.strictEqual(M.needsModel(flaky, TODAY, false, true), false, 'not again today');
  assert.strictEqual(M.needsModel(flaky, '2026-11-18', false, true), true, 'but tomorrow');
});

test('files that had no download address get another go once the address is known', () => {
  const noUrl = pdfItem();
  noUrl.source = { ...noUrl.source, files: [{ ...PDF, url: null }] };
  const answered = M.applyModelResults([noUrl], [{ id: noUrl.id, ok: true, estimate: claude({ files: { read: [], skipped: [{ name: 'sheet.pdf', reason: 'bad_url' }], retry: false } }) }], { today: TODAY, readFiles: true }).items[0];
  assert.strictEqual(M.needsModel(answered, TODAY, false, true), false, 'still no address: nothing to do');
  const later = { ...answered, source: { ...answered.source, files: [PDF] } };
  assert.strictEqual(M.needsModel(later, TODAY, false, true), true, 'now it has one');
});

test('force asks regardless of the handout state', () => {
  const read = M.applyModelResults([pdfItem()], [{ id: pdfItem().id, ok: true, estimate: claudeFiles() }], { today: TODAY, readFiles: true }).items[0];
  assert.strictEqual(M.needsModel(read, TODAY, true, true), true);
});

test('feed: merges by id, newest first, counts unread, caps length', () => {
  const T = global.window.TPMoodle;
  let f = T.mergeFeed(null, [{ id: 'new:a', kind: 'new', title: 'A', at: 1000 }], 1000);
  f = T.markFeedSeen(f, 1500);
  f = T.mergeFeed(f, [{ id: 'new:a', kind: 'new', title: 'A', at: 2000 }, { id: 'moved:b:90', kind: 'moved', title: 'B', at: 2000 }], 2000);
  assert.strictEqual(f.events.length, 2);
  assert.strictEqual(T.unreadCount(f), 1);
  assert.strictEqual(T.unreadCount(T.markFeedSeen(f, 3000)), 0);
  assert.strictEqual(T.feedLine(f.events[0]).head, 'Date moved');
  const many = Array.from({ length: 80 }, (_, i) => ({ id: 'new:' + i, kind: 'new', title: 'x', at: i }));
  assert.strictEqual(T.mergeFeed(null, many, 100).events.length, 50);
});

test('explainWarnings turns sync warning codes into plain lines', () => {
  const courses = [{ id: 7, code: 'MATH 2400' }, { id: 8, code: 'PHIL 2202' }];
  const lines = M.explainWarnings(['state_failed:11', 'state_failed:12'], courses);
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /2 items/);
  assert.deepStrictEqual(M.explainWarnings([], courses), []);
  assert.deepStrictEqual(M.explainWarnings(undefined, courses), []);
});

test('ensureCourseNames adds an entry for each name that has none, so courses without assignments still get a card', () => {
  const list = [{ id: 'a', name: 'MATH 2400', color: '#111' }];
  assert.strictEqual(M.ensureCourseNames(list, ['math 2400', 'BIBL 1020', 'BIBL 1020', '', 'CSCI 2010']), 2);
  assert.deepStrictEqual(list.map((c) => c.name), ['MATH 2400', 'BIBL 1020', 'CSCI 2010']);
  assert.strictEqual(M.ensureCourses(list, [{ course: 'PHIL 2202' }]), 1);
});

test('progress map: records changes, merges newest-wins, and applies to another device\'s copy', () => {
  const imp = (o) => ({ id: 'moodle:1', source: { type: 'moodle' }, total: 1, done: 0, completed: false, updatedAt: 100, ...o });
  const a = M.progressMap([imp({ completed: true, done: 1, completedAt: '2026-11-18', updatedAt: 200 }), imp({ id: 'moodle:2' }), { id: 'manual', completed: true }], {}, 999);
  assert.deepStrictEqual(Object.keys(a), ['moodle:1']);
  assert.deepStrictEqual(a['moodle:1'], { c: true, d: 1, ca: '2026-11-18', at: 200 });
  // unchecking later is a newer record and wins in either merge order
  const b = M.progressMap([imp({ completed: false, done: 0, updatedAt: 300 })], a, 999);
  assert.strictEqual(M.mergeProgress(a, b, 1000)['moodle:1'].c, false);
  assert.strictEqual(M.mergeProgress(b, a, 1000)['moodle:1'].c, false);
  // the other device: item open, even if its own updatedAt is newer for an unrelated reason
  const phone = [imp({ updatedAt: 500 })];
  assert.strictEqual(M.applyProgress(phone, a), true);
  assert.deepStrictEqual([phone[0].completed, phone[0].done, phone[0].completedAt], [true, 1, '2026-11-18']);
  assert.strictEqual(M.applyProgress(phone, a), false);
});

test('an item first imported on a device where it was already finished on another starts finished', () => {
  const rec = { id: 'moodle:9', cmid: 9, courseId: 1, course: 'MATH', kind: 'assign', title: 'HW', dueTs: Math.floor(Date.now() / 1000) + 86400, state: 'none', link: 'x' };
  const r = M.mergeImported([], [rec], { today: '2026-11-18', now: 1, progress: { 'moodle:9': { c: true, d: 1, ca: '2026-11-17', at: 50 } } });
  assert.strictEqual(r.items[0].completed, true);
  assert.strictEqual(r.items[0].completedAt, '2026-11-17');
});

test('a sync completes an item once, when Moodle first reports it submitted; reopening it sticks', () => {
  const dueTs = Math.floor(Date.now() / 1000) + 86400;
  const rec = (state) => ({ id: 'moodle:3', cmid: 3, courseId: 1, course: 'MATH', kind: 'assign', title: 'HW', dueTs, state, link: 'x' });
  const first = M.mergeImported([], [rec('none')], { today: '2026-11-18', now: 1 }).items;
  const done = M.mergeImported(first, [rec('submitted')], { today: '2026-11-18', now: 2 }).items;
  assert.strictEqual(done[0].completed, true);
  const reopened = [{ ...done[0], completed: false, done: 0, completedAt: null }];
  const again = M.mergeImported(reopened, [rec('submitted')], { today: '2026-11-19', now: 3 }).items;
  assert.strictEqual(again[0].completed, false);
});

/* ---------- your own estimates sync ---------- */

const imported = (over = {}) => ({ id: 'moodle:7', title: 'Essay', course: 'PHIL 2202', due: '2026-11-25', total: 3, unit: 'part', done: 0, today: 0, completed: false,
  source: { type: 'moodle', kind: 'assign', cmid: 7 }, estimate: { minutes: 150, low: 120, high: 180, basis: 'heuristic', confidence: 'low', factors: [], steps: [] }, ...over });

test('estimate map: entries merge newest-wins, null means "reset", old and junk entries are dropped', () => {
  const a = { x: { m: 90, at: 100 }, y: { m: 60, at: 500 } };
  const b = { x: { m: null, at: 200 }, y: { m: 30, at: 400 }, z: { m: 'junk' }, w: null };
  assert.deepStrictEqual(M.mergeEstimateMap(a, b, 1000), { x: { m: null, at: 200 }, y: { m: 60, at: 500 } });
  assert.deepStrictEqual(M.mergeEstimateMap({ old: { m: 45, at: 1 } }, {}, 1 + 366 * 24 * 3600 * 1000), {});
  assert.deepStrictEqual(M.setEstimateEntry({ a: { m: 5, at: 1 } }, 'b', 120, 9), { a: { m: 5, at: 1 }, b: { m: 120, at: 9 } });
  assert.deepStrictEqual(M.setEstimateEntry({}, 'b', null, 9), { b: { m: null, at: 9 } });
});

test('applyEstimates puts your own estimate on an item that only has the automatic one (a fresh device)', () => {
  const it = imported();
  assert.strictEqual(M.applyEstimates([it], { 'moodle:7': { m: 90, at: 5 } }), true);
  assert.strictEqual(it.estimate.basis, 'user');
  assert.strictEqual(it.estimate.minutes, 90);
  assert.strictEqual(it.total, 2, 'an untouched item is re-split for the new time (90 min = 2 parts)');
  assert.strictEqual(M.applyEstimates([it], { 'moodle:7': { m: 90, at: 5 } }), false, 'already applied: no change');
});

test('applyEstimates: a newer number replaces an older one, and a reset goes back to the automatic estimate', () => {
  const it = imported({ estimate: { minutes: 60, low: 60, high: 60, basis: 'user', confidence: 'high', factors: ['set by you'], steps: [] } });
  assert.strictEqual(M.applyEstimates([it], { 'moodle:7': { m: 120, at: 9 } }), true);
  assert.strictEqual(it.estimate.minutes, 120);
  assert.strictEqual(M.applyEstimates([it], { 'moodle:7': { m: null, at: 10 } }), true);
  assert.notStrictEqual(it.estimate.basis, 'user');
  // a reset entry never touches an item that is not on your own estimate
  const ai = imported({ estimate: { minutes: 75, low: 60, high: 90, basis: 'model', confidence: 'medium', factors: [], steps: [] } });
  assert.strictEqual(M.applyEstimates([ai], { 'moodle:7': { m: null, at: 10 } }), false);
  assert.strictEqual(ai.estimate.basis, 'model');
});

test('applyEstimates ignores manual items, items with no entry, and junk numbers', () => {
  const manual = { id: 'm1', title: 'Hand-made', total: 1, done: 0, estimate: { minutes: 30, basis: 'heuristic' } };
  const plain = imported({ id: 'moodle:8' });
  assert.strictEqual(M.applyEstimates([manual, plain], { m1: { m: 60, at: 1 } }), false);
  assert.strictEqual(M.applyEstimates([imported()], { 'moodle:7': { m: NaN, at: 1 } }), false);
  assert.strictEqual(M.applyEstimates([imported()], undefined), false);
});
