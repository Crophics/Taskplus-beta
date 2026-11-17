const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let T;
test.before(async () => { T = await import('../tools/import-vault-grades.mjs'); });

const note = (fm) => '---\n' + fm + '\n---\n# Note\n';

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
  const w = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  w('Classes/MATH 2400/MATH 2400.md', note('type: course\ncode: MATH 2400\ncredits: 4\ntarget: 92\nscale: [94, 91, 88, 84, 81, 78, 74, 71, 68, 64, 61]\nstatus: active'));
  w('Classes/MATH 2400/Coursework/MATH Assignment 5.md', note('type: assignment\ncourse: "[[MATH 2400]]"\ndue: 2026-09-28\nstatus: graded\nweight: 8\nscore: 94\nlink: https://moodle.example.edu/moodle/mod/assign/view.php?id=5001\nsubmitted: yes'));
  w('Classes/MATH 2400/Coursework/MATH Assignment 6.md', note('type: assignment\ncourse: "[[MATH 2400]]"\ndue: 2026-11-19\nstatus: todo\nweight: 8.5\nlink: https://moodle.example.edu/moodle/mod/assign/view.php?id=5002'));
  w('Classes/MATH 2400/Coursework/MATH MyLab Homework.md', note('type: assignment\ncourse: "[[MATH 2400]]"\nweight: 10\nstatus: todo'));
  w('Classes/MATH 2400/Coursework/MATH Quiz 1.md', note('type: quiz\ncourse: "[[MATH 2400]]"\nstatus: todo\nlink: https://moodle.example.edu/moodle/mod/quiz/view.php?id=6001'));
  w('Classes/CSCI 2010/CSCI 2010.md', note('type: course\ncode: CSCI 2010\ncredits: 3\ntarget: 90\nscale:\n  A: 93\n  A-: 90\n  B+: 87\n  B: 83\n  B-: 80\n  C+: 77\n  C: 73\n  C-: 70\n  D+: 67\n  D: 63\n  D-: 60'));
  w('Classes/CSCI 2010/Coursework/CSCI T22 Wordle.md', note('type: assignment\nweight: 5\nlink: https://csci.example.edu/courses/2026/tasks/T22.html#t22'));
  w('Classes/FYSE 1000/Coursework/FYSE Reflection.md', note('type: assignment\nweight: 0.05\nlink: https://moodle.example.edu/moodle/mod/assign/view.php?id=7001'));
  w('Classes/FYSE 1000/Coursework/FYSE Essay.md', note('type: assignment\nweight: 0.10\nlink: https://moodle.example.edu/moodle/mod/assign/view.php?id=7002'));
  return root;
}

test('parseFrontmatter reads scalars, quoted strings, inline and block lists, and maps', () => {
  const fm = T.parseFrontmatter(note('a: 5\nb: "x y"\nc: yes\nd: [1, 2, 3]\ne:\n  - 4\n  - 5\nf:\n  A: 93\n  B: 83\ng: 0.5\nh: true'));
  assert.deepStrictEqual(fm, { a: 5, b: 'x y', c: 'yes', d: [1, 2, 3], e: [4, 5], f: { A: 93, B: 83 }, g: 0.5, h: true });
  assert.deepStrictEqual(T.parseFrontmatter('no frontmatter here'), {});
});

test('collect turns Moodle-linked weights and course pages into import settings', () => {
  const vault = makeVault();
  const out = T.collect(vault);
  assert.strictEqual(out.weights['moodle:5001'], 8);
  assert.strictEqual(out.weights['moodle:5002'], 8.5);
  assert.strictEqual('moodle:6001' in out.weights, false, 'a note with no weight is not invented');
  assert.deepStrictEqual(out.courses['MATH 2400'], { target: 92, credits: 4, scale: [94, 91, 88, 84, 81, 78, 74, 71, 68, 64, 61] });
  assert.deepStrictEqual(out.courses['CSCI 2010'].scale, [93, 90, 87, 83, 80, 77, 73, 70, 67, 63, 60], 'a letter-keyed scale is accepted');
  assert.strictEqual(out.report.courses, 3);
  assert.strictEqual(out.report.linked, 4);
});

test('weighted notes with no Moodle link are listed, not guessed', () => {
  const out = T.collect(makeVault());
  assert.deepStrictEqual(out.report.unlinked.map((u) => [u.course, u.title, u.weight]), [['CSCI 2010', 'CSCI T22 Wordle', 5], ['MATH 2400', 'MATH MyLab Homework', 10]].sort((a, b) => a[0].localeCompare(b[0])));
  assert.ok(out.report.warnings.some((w) => w.includes('no Moodle link')));
});

test('weights that look like fractions trigger a warning, and --fractions converts them', () => {
  const vault = makeVault();
  const plain = T.collect(vault);
  assert.ok(plain.report.warnings.some((w) => w.startsWith('FYSE 1000') && w.includes('--fractions')));
  assert.strictEqual(plain.weights['moodle:7001'], 0.05);
  const fixed = T.collect(vault, { fractions: true });
  assert.strictEqual(fixed.weights['moodle:7001'], 5);
  assert.strictEqual(fixed.weights['moodle:7002'], 10);
  assert.ok(!fixed.report.warnings.some((w) => w.startsWith('FYSE 1000') && w.includes('--fractions')));
});

test('collect refuses a folder that is not a vault, and never writes to the vault', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'novault-'));
  assert.throws(() => T.collect(empty), /No "Classes" folder/);
  const vault = makeVault();
  const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).sort().join('|');
  const before = snapshot(vault);
  T.collect(vault);
  assert.strictEqual(snapshot(vault), before);
});

test('the command line prints JSON on stdout and the human summary on stderr', () => {
  const vault = makeVault();
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'import-vault-grades.mjs'), vault], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.strictEqual(parsed.weights['moodle:5001'], 8);
  assert.ok(r.stderr.includes('weights matched to Moodle'));
  const bad = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'import-vault-grades.mjs')], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 2);
});

test('settings produced by the tool are accepted by the app importer', () => {
  global.window = global;
  require('../js/grades-logic.js');
  const out = T.collect(makeVault());
  const res = global.TPGrades.importSettings(global.TPGrades.emptySettings(), out);
  assert.strictEqual(res.settings.weights['moodle:5001'], 8);
  assert.strictEqual(res.settings.courses['MATH 2400'].target, 92);
  assert.strictEqual(res.stats.weights, 4);
  assert.strictEqual(res.stats.courses, 2);
});
