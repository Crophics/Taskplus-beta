#!/usr/bin/env node
// compare-vault.mjs — cutover check: does Taskplus agree with the Obsidian vault?
//
//   node tools/compare-vault.mjs "<vault path>" taskplus-backup.json [--all]
//
// taskplus-backup.json is Settings > Export > Backup (it includes imported Moodle items).
// Only READS both. Prints what is only in one place and where the due date or status differs.
// By default it ignores vault notes that are already finished (status submitted/graded/done) and items
// due more than 14 days ago, so the report is about what is still live; --all includes everything.
//
// Assumed vault note fields (the same ones tools/import-vault-grades.mjs reads): `link:` containing
// id=<cmid>, `due:` (a date, optionally with a time), `status:`. Adjust FIELD_* below if yours differ.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './import-vault-grades.mjs';

const FIELD_DUE = 'due';
const FIELD_STATUS = 'status';
const DONE = new Set(['submitted', 'graded', 'done', 'complete', 'completed']);

const ymd = (v) => { const m = /(\d{4}-\d{2}-\d{2})/.exec(String(v == null ? '' : v)); return m ? m[1] : null; };
const dayNum = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / 86400000);

export function readVault(vaultPath) {
  const dir = path.join(vaultPath, 'Classes');
  if (!fs.existsSync(dir)) throw new Error('No "Classes" folder in ' + vaultPath);
  const out = [];
  fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).forEach((d) => {
    const cw = path.join(dir, d.name, 'Coursework');
    let files = [];
    try { files = fs.readdirSync(cw).filter((f) => f.toLowerCase().endsWith('.md')); } catch (e) { /* no coursework */ }
    files.forEach((f) => {
      const fm = parseFrontmatter(fs.readFileSync(path.join(cw, f), 'utf8'));
      const id = /[?&]id=(\d+)/.exec(String(fm.link || ''));
      out.push({
        course: d.name, title: f.replace(/\.md$/i, ''), cmid: id ? id[1] : null,
        due: ymd(fm[FIELD_DUE]), status: String(fm[FIELD_STATUS] || '').toLowerCase(),
      });
    });
  });
  return out;
}

export function compare(vault, appItems, { today, all = false } = {}) {
  const t = dayNum(today);
  const recent = (due) => all || !due || dayNum(due) >= t - 14;
  const live = vault.filter((n) => all || !DONE.has(n.status)).filter((n) => recent(n.due));
  const app = appItems.filter((i) => i && typeof i.id === 'string' && i.id.startsWith('moodle:'))
    .filter((i) => all || (!i.completed && !i.archived && recent(ymd(i.due))));
  const byCmid = new Map(vault.filter((n) => n.cmid).map((n) => [n.cmid, n]));
  const appById = new Map(appItems.filter((i) => i && i.id).map((i) => [i.id.replace(/^moodle:/, ''), i]));

  const onlyVault = live.filter((n) => !n.cmid || !appById.has(n.cmid));
  const onlyApp = app.filter((i) => !byCmid.has(i.id.replace(/^moodle:/, '')));
  const dueDiff = [];
  const statusDiff = [];
  vault.forEach((n) => {
    const i = n.cmid && appById.get(n.cmid);
    if (!i) return;
    if (!all && DONE.has(n.status) && i.completed) return;
    const vd = n.due, ad = ymd(i.due);
    if (vd && ad && vd !== ad && recent(vd)) dueDiff.push({ course: n.course, title: n.title, vault: vd, app: ad });
    const appDone = !!i.completed || (i.source && i.source.state === 'submitted');
    if (recent(vd) && DONE.has(n.status) !== appDone && (DONE.has(n.status) || appDone)) {
      statusDiff.push({ course: n.course, title: n.title, vault: n.status || '(none)', app: appDone ? 'done/submitted' : 'open' });
    }
  });
  const matched = vault.filter((n) => n.cmid && appById.has(n.cmid)).length;
  return { matched, onlyVault, onlyApp, dueDiff, statusDiff };
}

function main(argv) {
  const args = argv.slice(2);
  const all = args.includes('--all');
  const [vaultPath, backup] = args.filter((a) => !a.startsWith('--'));
  if (!vaultPath || !backup) { console.error('Usage: node tools/compare-vault.mjs "<vault>" taskplus-backup.json [--all]'); process.exit(2); }
  try {
    const items = JSON.parse(fs.readFileSync(backup, 'utf8'));
    if (!Array.isArray(items)) throw new Error('The backup file should be a list of items (Settings > Export > Backup).');
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const r = compare(readVault(vaultPath), items, { today, all });
    console.log(`Matched ${r.matched} vault note(s) to Taskplus items.`);
    const sect = (title, rows, fmt) => { console.log(`\n${title}: ${rows.length}`); rows.forEach((x) => console.log('  ' + fmt(x))); };
    sect('In the vault but not in Taskplus', r.onlyVault, (n) => `${n.course} / ${n.title}${n.cmid ? '' : '  (no Moodle link: CSCI or manual?)'}`);
    sect('In Taskplus but not in the vault', r.onlyApp, (i) => `${i.course || '?'} / ${i.title}`);
    sect('Due dates differ', r.dueDiff, (d) => `${d.course} / ${d.title}: vault ${d.vault}, Taskplus ${d.app}`);
    sect('Status differs', r.statusDiff, (d) => `${d.course} / ${d.title}: vault ${d.vault}, Taskplus ${d.app}`);
    const bad = r.onlyVault.length + r.onlyApp.length + r.dueDiff.length + r.statusDiff.length;
    console.log(bad ? '\nNot yet in agreement.' : '\nIn agreement.');
  } catch (e) { console.error(e.message); process.exit(1); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv);
