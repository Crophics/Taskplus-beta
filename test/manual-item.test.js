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
