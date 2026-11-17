const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let C;
test.before(async () => { C = await import('../tools/compare-vault.mjs'); });
const note = (fm) => '---\n' + fm + '\n---\n# Note\n';
const L = (n) => `link: https://moodle.example.edu/mod/assign/view.php?id=${n}`;

function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'));
  const w = (rel, t) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
  w('Classes/MATH/Coursework/A1.md', note(`due: 2026-11-20\nstatus: todo\n${L(1)}`));       // agrees
  w('Classes/MATH/Coursework/A2.md', note(`due: 2026-11-21T23:59\nstatus: todo\n${L(2)}`)); // due differs
  w('Classes/MATH/Coursework/A3.md', note(`due: 2026-11-22\nstatus: todo\n${L(3)}`));       // missing in app
  w('Classes/MATH/Coursework/A4.md', note(`due: 2026-09-01\nstatus: graded\n${L(4)}`));     // old and finished: ignored
  w('Classes/CSCI/Coursework/T22.md', note('due: 2026-11-23\nstatus: todo\nlink: https://csci.example.edu/t22')); // no cmid
  w('Classes/MATH/Coursework/A5.md', note(`due: 2026-11-19\nstatus: submitted\n${L(5)}`)); // vault done, app open
  return root;
}
const it = (n, o = {}) => ({ id: 'moodle:' + n, title: 'T' + n, course: 'MATH', due: '2026-11-20', completed: false, archived: false, source: { type: 'moodle', state: 'none' }, ...o });

test('readVault reads link ids, due dates and status', () => {
  const v = C.readVault(vault());
  const a2 = v.find((n) => n.title === 'A2');
  assert.deepStrictEqual([a2.cmid, a2.due, a2.status], ['2', '2026-11-21', 'todo']);
  assert.strictEqual(v.find((n) => n.title === 'T22').cmid, null);
});

test('compare reports only live differences', () => {
  const v = C.readVault(vault());
  const app = [it(1), it(2, { due: '2026-11-25' }), it(5, { due: '2026-11-19' }), it(9, { title: 'Extra' })];
  const r = C.compare(v, app, { today: '2026-11-17' });
  assert.strictEqual(r.matched, 3); // A1, A2, A5
  assert.deepStrictEqual(r.onlyVault.map((n) => n.title).sort(), ['A3', 'T22']); // old graded A4 is ignored
  assert.deepStrictEqual(r.onlyApp.map((i) => i.title), ['Extra']);
  assert.deepStrictEqual(r.dueDiff.map((d) => [d.title, d.vault, d.app]), [['A2', '2026-11-21', '2026-11-25']]);
  assert.deepStrictEqual(r.statusDiff.map((d) => d.title), ['A5']);
});

test('--all includes finished and old notes; a full match reports nothing', () => {
  const v = C.readVault(vault());
  assert.ok(C.compare(v, [], { today: '2026-11-17', all: true }).onlyVault.some((n) => n.title === 'A4'));
  const clean = C.compare([{ course: 'M', title: 'x', cmid: '1', due: '2026-11-20', status: 'todo' }], [it(1)], { today: '2026-11-17' });
  assert.deepStrictEqual([clean.onlyVault, clean.onlyApp, clean.dueDiff, clean.statusDiff], [[], [], [], []]);
});

test('CLI runs end to end and says when things disagree', () => {
  const { spawnSync } = require('node:child_process');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bk-')), 'b.json');
  fs.writeFileSync(f, JSON.stringify([it(1)]));
  const r = spawnSync(process.execPath, [path.join(__dirname, '../tools/compare-vault.mjs'), vault(), f], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Not yet in agreement/);
  assert.match(r.stdout, /In the vault but not in Taskplus: \d/);
});
