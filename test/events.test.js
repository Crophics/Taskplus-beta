const test = require('node:test');
const assert = require('node:assert');
let E;
test.before(async () => { E = await import('../src/events.mjs'); });

const NOW = Date.UTC(2026, 10, 17, 15, 0, 0);
const sec = NOW / 1000;
const rec = (id, o = {}) => ({ id, kind: 'assign', title: 'T' + id, course: 'MATH', dueTs: sec + 3 * 86400, state: 'none', ...o });

test('first snapshot is a baseline: no events', () => {
  const s = E.buildSnapshot([rec('moodle:1')], null, NOW);
  assert.deepStrictEqual(E.diffSnapshots(null, s, NOW), []);
});
test('new unfinished assignment is reported; submitted is not', () => {
  const a = E.buildSnapshot([rec('moodle:1')], null, NOW);
  const b = E.buildSnapshot([rec('moodle:1'), rec('moodle:2'), rec('moodle:3', { state: 'submitted' })], a, NOW);
  const ev = E.diffSnapshots(a, b, NOW);
  assert.deepStrictEqual(ev.map((e) => e.id), ['new:moodle:2']);
});
test('moved due date, ignoring sub-hour nudges', () => {
  const a = E.buildSnapshot([rec('moodle:1')], null, NOW);
  const nudge = E.buildSnapshot([rec('moodle:1', { dueTs: sec + 3 * 86400 + 600 })], a, NOW);
  assert.strictEqual(E.diffSnapshots(a, nudge, NOW).length, 0);
  const moved = E.buildSnapshot([rec('moodle:1', { dueTs: sec + 5 * 86400 })], a, NOW);
  const ev = E.diffSnapshots(a, moved, NOW);
  assert.strictEqual(ev[0].kind, 'moved');
});
test('grade-book-only entries from an older snapshot are forgotten', () => {
  const old = { v: 1, at: NOW, items: { 'gi:9': { t: 'Attendance', c: 'MATH', k: 'g', d: null, g: 90, f: null }, 'moodle:1': { t: 'x', c: 'MATH', k: 'a', d: null, s: null } } };
  const s = E.buildSnapshot([rec('moodle:1')], old, NOW);
  assert.ok(!('gi:9' in s.items));
  assert.deepStrictEqual(E.diffSnapshots(old, s, NOW), [], 'dropping them announces nothing');
});
test('null state from a budget-limited sync keeps the known state', () => {
  const a = E.buildSnapshot([rec('moodle:1', { state: 'submitted' })], null, NOW);
  const b = E.buildSnapshot([rec('moodle:1', { state: null })], a, NOW);
  assert.strictEqual(b.items['moodle:1'].s, 'submitted');
});
test('dueSoon: 24h and 1h reminders fire once, skip submitted', () => {
  const s = E.buildSnapshot([rec('moodle:1', { dueTs: sec + 20 * 3600 }), rec('moodle:2', { dueTs: sec + 1800 }), rec('moodle:3', { dueTs: sec + 1800, state: 'submitted' })], null, NOW);
  const r = E.dueSoon(s, NOW, []);
  assert.deepStrictEqual(r.map((x) => x.id), ['moodle:2', 'moodle:1']);
  assert.strictEqual(E.dueSoon(s, NOW, r.map((x) => x.key)).length, 0);
});
test('composePush batches', () => {
  const evs = [1, 2, 3, 4].map((i) => ({ id: 'new:' + i, kind: 'new', title: 'A' + i, course: 'C', dueTs: sec }));
  assert.match(E.composePush(evs, 'UTC').title, /4 updates/);
  assert.match(E.composePush(evs.slice(0, 1), 'UTC').title, /^New: A1/);
});
test('quiet hours wrap midnight', () => {
  const q = { on: true, start: 22, end: 8 };
  assert.strictEqual(E.isQuiet(Date.UTC(2026, 10, 17, 23), 'UTC', q), true);
  assert.strictEqual(E.isQuiet(Date.UTC(2026, 10, 17, 12), 'UTC', q), false);
  assert.strictEqual(E.isQuiet(Date.UTC(2026, 10, 17, 3), 'UTC', q), true);
  assert.strictEqual(E.isQuiet(NOW, 'UTC', { on: false, start: 22, end: 8 }), false);
});
