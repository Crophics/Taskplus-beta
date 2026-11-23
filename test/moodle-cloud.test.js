const { test } = require('node:test');
const assert = require('node:assert');

global.window = global;
require('../js/due-time.js');
require('../js/courses.js');
require('../js/estimate-logic.js');
require('../js/moodle-client.js');

const M = global.TPMoodle;
const TODAY = '2026-11-23';
const NOW = 1_800_000_000_000;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const imported = (over = {}) => ({
  id: 'moodle:5001', title: 'Assignment 11', course: 'MATH 2400', due: addDays(TODAY, 3), dueTime: '23:59', createdAt: TODAY,
  total: 2, done: 0, today: 0, completed: false, archived: false, notes: 'private note', estimate: { minutes: 60, basis: 'user' },
  source: { type: 'moodle', cmid: 5001, instanceId: 1, courseId: 7, kind: 'assign', link: 'https://m.example.edu/mod/assign/view.php?id=5001', points: 100,
    description: 'Do problems 1-10.', files: [{ name: 'hw.pdf', size: 1234, modified: 5, url: 'https://m.example.edu/webservice/pluginfile.php/1/hw.pdf?token=SECRET' }],
    timeLimitMin: null, submissionTypes: ['file'], wordLimit: null, state: 'new' },
  ...over,
});

test('the cloud entry has the Moodle details only: no notes, no estimate, no file addresses, no tokens', () => {
  const map = M.setCloudEntries({}, [imported()], TODAY, NOW, []);
  const e = map['moodle:5001'];
  assert.strictEqual(e.at, NOW);
  assert.strictEqual(e.b.title, 'Assignment 11');
  assert.deepStrictEqual(e.b.source.files, [{ name: 'hw.pdf', size: 1234, modified: 5 }]);
  const text = JSON.stringify(map);
  assert.ok(!text.includes('SECRET') && !text.includes('private note') && !text.includes('"estimate"'));
});

test('an unchanged item does not rewrite its entry; a changed one does', () => {
  const a = M.setCloudEntries({}, [imported()], TODAY, NOW, []);
  const b = M.setCloudEntries(a, [imported()], TODAY, NOW + 1000, []);
  assert.strictEqual(b['moodle:5001'].at, NOW);
  const c = M.setCloudEntries(a, [imported({ due: addDays(TODAY, 4) })], TODAY, NOW + 2000, []);
  assert.strictEqual(c['moodle:5001'].at, NOW + 2000);
});

test('manual items, old work, deleted items and archived items are not synced this way', () => {
  const manual = { id: 'm1', title: 'x', source: { type: 'manual' }, due: addDays(TODAY, 2) };
  const old = imported({ id: 'moodle:1', due: addDays(TODAY, -60) });
  const arch = imported({ id: 'moodle:2', archived: true });
  const del = imported({ id: 'moodle:3' });
  const map = M.setCloudEntries({}, [manual, old, arch, del], TODAY, NOW, [{ id: 'moodle:3' }]);
  assert.deepStrictEqual(Object.keys(map), []);
});

test('entries age out, and a deleted item leaves the map', () => {
  const prior = { 'moodle:1': { at: 1, b: { ...M.cloudBaseOf(imported({ id: 'moodle:1', due: addDays(TODAY, -60) })) } }, 'moodle:5001': { at: 1, b: M.cloudBaseOf(imported()) } };
  const out = M.setCloudEntries(prior, [], TODAY, NOW, [{ id: 'moodle:5001' }]);
  assert.deepStrictEqual(Object.keys(out), []);
});

test('merging keeps the newer entry per item and drops junk', () => {
  const e = (title, at) => ({ at, b: { ...M.cloudBaseOf(imported({ title })) } });
  const out = M.mergeCloudMap({ a: e('old', 1), b: e('only here', 5) }, { a: e('new', 2), junk: { at: 'x' }, bad: null });
  assert.strictEqual(out.a.b.title, 'new');
  assert.strictEqual(out.b.b.title, 'only here');
  assert.ok(!out.junk && !out.bad);
});

test('a new device gets the items from the cloud, with estimates and parts, and no alert events', () => {
  const map = M.setCloudEntries({}, [imported()], TODAY, NOW, []);
  const r = M.applyCloudItems([], map, { today: TODAY, now: NOW });
  assert.strictEqual(r.added, 1);
  const it = r.items[0];
  assert.strictEqual(it.id, 'moodle:5001');
  assert.strictEqual(it.title, 'Assignment 11');
  assert.strictEqual(it.dueTime, '23:59');
  assert.ok(it.estimate && it.estimate.minutes > 0);
  assert.ok(M.isImported(it));
  assert.strictEqual(it.notes, ''); // your notes arrive through their own map
});

test('items this device already has, or deleted, or finished long ago are not added again', () => {
  const map = M.setCloudEntries({}, [imported(), imported({ id: 'moodle:7', title: 'Gone' }), imported({ id: 'moodle:8', title: 'Done long ago', source: { ...imported().source, state: 'submitted' } })], TODAY, NOW, []);
  const have = [imported({ title: 'Local copy wins' })];
  const r = M.applyCloudItems(have, map, { today: TODAY, now: NOW, deletedLog: [{ id: 'moodle:7' }] });
  assert.strictEqual(r.items.find((x) => x.id === 'moodle:5001').title, 'Local copy wins');
  assert.ok(!r.items.find((x) => x.id === 'moodle:7'));
  const late = M.applyCloudItems([], { 'moodle:8': { at: 1, b: { ...M.cloudBaseOf(imported({ id: 'moodle:8', due: addDays(TODAY, -20), source: { ...imported().source, state: 'submitted' } })) } } }, { today: TODAY, now: NOW });
  assert.strictEqual(late.added, 0);
});

test('progress done on another device carries onto a cloud-filled item', () => {
  const map = M.setCloudEntries({}, [imported()], TODAY, NOW, []);
  const r = M.applyCloudItems([], map, { today: TODAY, now: NOW, progress: { 'moodle:5001': { c: true, ca: TODAY, at: NOW } } });
  assert.strictEqual(r.items[0].completed, true);
});
