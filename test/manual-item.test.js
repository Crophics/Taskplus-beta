const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
require('../js/due-time.js');
require('../js/estimate-logic.js');
require('../js/moodle-client.js');
require('../js/learning.js');

const E = global.TPEstimate;
const M = global.TPMoodle;
const L = global.TPLearn;

const dayStr = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const manual = (over = {}) => ({
  id: 'm1', title: 'Essay on Kant', course: 'PHIL 2202', due: dayStr(5), dueTime: '23:59', total: 1, unit: '', done: 0, today: 0,
  completed: false, archived: false, source: { type: 'manual', kind: 'assign', description: 'Write a 1500-word essay on the categorical imperative.' }, ...over,
});

test('manual items are estimable; old unit-style manual items are not', () => {
  assert.ok(E.isEstimable(manual()));
  assert.ok(E.isEstimable({ source: { type: 'moodle' } }));
  assert.ok(!E.isEstimable({ title: 'Old', total: 10, unit: 'pages' }));
  assert.ok(!M.isImported(manual())); // still synced as a whole item, not through the side maps
});

test('a new manual item gets an estimate and parts, like an import', () => {
  const made = E.withEstimate(manual(), E.estimateForItem(manual()));
  assert.ok(made.estimate.minutes >= 5);
  assert.strictEqual(made.estimate.basis, 'heuristic');
  assert.ok(made.total >= 1);
  assert.ok(made.estimate.key);
});

test('your own minutes make a user estimate and split into parts', () => {
  const made = E.withEstimate(manual(), E.userEstimate(240));
  assert.strictEqual(made.estimate.basis, 'user');
  assert.ok(made.total > 1);
  assert.strictEqual(made.unit, 'part');
});

test('the AI is asked about a manual item that has a rule-of-thumb estimate, and only then', () => {
  const made = E.withEstimate(manual(), E.estimateForItem(manual()));
  assert.ok(M.needsModel(made, dayStr(0), false, false));
  assert.ok(!M.needsModel({ ...made, estimate: { ...made.estimate, basis: 'user' } }, dayStr(0), false, false));
  assert.ok(!M.needsModel({ title: 'Old', estimate: { basis: 'heuristic' } }, dayStr(0), false, false));
});

test('the AI input for a manual item carries its description and no notes', () => {
  const made = E.withEstimate(manual({ notes: 'private' }), E.userEstimate(60));
  const input = M.modelInput(made, 5, false, []);
  assert.match(input.description, /categorical imperative/);
  assert.ok(!JSON.stringify(input).includes('private'));
});

test('a changed description changes the estimate key (so it is re-estimated)', () => {
  const a = manual();
  const b = manual({ source: { ...a.source, description: 'Something else entirely.' } });
  assert.notStrictEqual(E.inputsKey(a), E.inputsKey(b));
});

test('manual items count for learning from finished work', () => {
  const done = (n) => manual({ id: 'd' + n, title: 'Journal #' + n, completed: true, estimate: { minutes: 30, basis: 'heuristic' }, actual: { minutes: 15, est: 30, at: 1 } });
  assert.ok(L.pastWork(manual(), [done(1), done(2)]).length === 2);
});

/* ---- converting items made before the new Add sheet ---- */
const legacy = (over = {}) => ({
  id: 'l1', title: 'Read chapters', course: 'PHIL 2202', due: dayStr(6), total: 10, unit: 'pages', done: 0, today: 0,
  completed: false, archived: false, notes: 'keep me', subtasks: [{ text: 'a', done: false }], dependsOn: '', recurring: '', ...over,
});

test('an untouched old item becomes a new-style one with an estimate and parts', () => {
  const next = E.convertLegacy(legacy());
  assert.ok(E.isEstimable(next));
  assert.strictEqual(next.source.type, 'manual');
  assert.ok(next.estimate && next.estimate.minutes > 0);
  assert.notStrictEqual(next.unit, 'pages'); // the unit is replaced by parts
  assert.strictEqual(next.notes, 'keep me');
  assert.strictEqual(next.subtasks.length, 1);
  assert.strictEqual(next.id, 'l1');
});

test('an old item with progress keeps its amount, so what you logged still means the same', () => {
  const next = E.convertLegacy(legacy({ done: 4 }));
  assert.strictEqual(next.total, 10);
  assert.strictEqual(next.unit, 'pages');
  assert.strictEqual(next.done, 4);
  assert.ok(next.estimate.minutes > 0);
});

test('your own minutes survive the conversion', () => {
  const next = E.convertLegacy(legacy({ estimate: E.userEstimate(240) }));
  assert.strictEqual(next.estimate.basis, 'user');
  assert.strictEqual(next.estimate.minutes, 240);
});

test('a description from the interim sheet moves onto source', () => {
  const next = E.convertLegacy(legacy({ description: 'Chapters 1-3' }));
  assert.strictEqual(next.source.description, 'Chapters 1-3');
  assert.ok(!('description' in next));
});

test('finished, archived, undated, imported and already converted items are left alone', () => {
  assert.strictEqual(E.convertLegacy(legacy({ completed: true })), null);
  assert.strictEqual(E.convertLegacy(legacy({ archived: true })), null);
  assert.strictEqual(E.convertLegacy(legacy({ due: '' })), null);
  assert.strictEqual(E.convertLegacy(manual()), null);
  assert.strictEqual(E.convertLegacy({ ...legacy(), source: { type: 'moodle' } }), null);
});

test('converting twice changes nothing the second time', () => {
  const once = E.convertLegacy(legacy());
  assert.strictEqual(E.convertLegacy(once), null);
});
