#!/usr/bin/env node
// import-vault-grades.mjs — one-time helper: reads an Obsidian vault laid out like
// the study vault this app replaces and writes a JSON file of grade settings
// (assignment weights, course targets/credits/scales) for Taskplus to import.
//
//   node tools/import-vault-grades.mjs "<path to vault>" > grade-settings.json
//   add --fractions if your weights are written as 0.08 instead of 8
//
// It only READS the vault. Review the JSON (and the "report" at the end of it)
// before importing it in Taskplus: Settings > Import grade settings.
//
// Expected layout:  Classes/<CODE>/<CODE>.md             course page (target, credits, scale)
//                   Classes/<CODE>/Coursework/*.md       one note per assignment/quiz/exam
// A coursework note is matched to Moodle by the id=<number> in its `link:` field.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LETTERS = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-'];

function scalar(raw) {
  let v = String(raw).trim();
  if (v === '') return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

/** A small YAML-frontmatter reader: scalars, inline lists, block lists, one-level maps. Enough for vault notes. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest.trim() === '') {
      const items = [];
      const map = {};
      let j = i + 1;
      while (j < lines.length && /^\s+/.test(lines[j])) {
        const li = /^\s*-\s*(.*)$/.exec(lines[j]);
        const mm = /^\s+([^:]+):\s*(.*)$/.exec(lines[j]);
        if (li) items.push(scalar(li[1]));
        else if (mm) map[mm[1].trim()] = scalar(mm[2]);
        j++;
      }
      out[key] = items.length ? items : Object.keys(map).length ? map : '';
      i = j - 1;
    } else if (rest.trim().startsWith('[') && rest.trim().endsWith(']')) {
      out[key] = rest.trim().slice(1, -1).split(',').map((s) => scalar(s)).filter((s) => s !== '');
    } else {
      out[key] = scalar(rest);
    }
  }
  return out;
}

function scaleToCutoffs(scale) {
  if (Array.isArray(scale) && scale.length === 11 && scale.every((n) => typeof n === 'number')) return scale;
  if (scale && typeof scale === 'object' && !Array.isArray(scale)) {
    const c = LETTERS.map((l) => scale[l]);
    if (c.every((n) => typeof n === 'number')) return c;
  }
  return null;
}

function listMarkdown(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).sort(); } catch (e) { return []; }
}

export function collect(vaultPath, { fractions = false } = {}) {
  const classesDir = path.join(vaultPath, 'Classes');
  if (!fs.existsSync(classesDir)) throw new Error('No "Classes" folder in ' + vaultPath + '. Is this the vault root?');
  const result = { version: 1, weights: {}, courses: {}, report: { courses: 0, notes: 0, linked: 0, unlinked: [], warnings: [] } };
  const rep = result.report;
  const factor = fractions ? 100 : 1;

  fs.readdirSync(classesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).forEach((d) => {
    const code = d.name;
    const courseDir = path.join(classesDir, code);
    rep.courses++;

    const pagePath = path.join(courseDir, code + '.md');
    if (fs.existsSync(pagePath)) {
      const fm = parseFrontmatter(fs.readFileSync(pagePath, 'utf8'));
      const c = {};
      if (typeof fm.target === 'number' && fm.target >= 0 && fm.target <= 100) c.target = fm.target;
      if (typeof fm.credits === 'number' && fm.credits > 0) c.credits = fm.credits;
      if (fm.scale !== undefined) {
        const cut = scaleToCutoffs(fm.scale);
        if (cut) c.scale = cut;
        else rep.warnings.push(code + ': could not read the grade scale; the default 93/90/87... scale will be used');
      }
      if (Object.keys(c).length) result.courses[code] = c;
    } else {
      rep.warnings.push(code + ': no course page (' + code + '.md), so no target/credits');
    }

    const weights = [];
    listMarkdown(path.join(courseDir, 'Coursework')).forEach((file) => {
      const fm = parseFrontmatter(fs.readFileSync(path.join(courseDir, 'Coursework', file), 'utf8'));
      rep.notes++;
      if (typeof fm.weight !== 'number') return; // no weight written yet
      const weight = Math.round(fm.weight * factor * 100) / 100;
      const title = file.replace(/\.md$/i, '');
      const idMatch = /[?&]id=(\d+)/.exec(String(fm.link || ''));
      if (weight < 0 || weight > 100) { rep.warnings.push(code + ' / ' + title + ': weight ' + weight + ' is outside 0-100, skipped'); return; }
      if (idMatch) {
        result.weights['moodle:' + idMatch[1]] = weight;
        weights.push(weight);
        rep.linked++;
      } else {
        rep.unlinked.push({ course: code, title, weight });
      }
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    if (!fractions && sum > 0 && sum <= 1.5) {
      rep.warnings.push(code + ': the weights add up to ' + Math.round(sum * 100) / 100 + '. If they are written as fractions (0.08 meaning 8%), run again with --fractions');
    }
    if (sum > 100.5) rep.warnings.push(code + ': the weights add up to ' + Math.round(sum * 100) / 100 + '%, which is over 100');
  });

  if (rep.unlinked.length) {
    rep.warnings.push(rep.unlinked.length + ' weighted note(s) have no Moodle link (e.g. CSCI course-site tasks, or manual grade items), so they cannot be matched automatically. They are listed in "unlinked"; enter those weights in the app.');
  }
  return result;
}

function main(argv) {
  const args = argv.slice(2);
  const fractions = args.includes('--fractions');
  const vault = args.find((a) => !a.startsWith('--'));
  if (!vault) {
    console.error('Usage: node tools/import-vault-grades.mjs "<vault path>" [--fractions] > grade-settings.json');
    process.exit(2);
  }
  try {
    const out = collect(vault, { fractions });
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    const r = out.report;
    console.error(`Read ${r.courses} course folder(s), ${r.notes} coursework note(s): ${r.linked} weights matched to Moodle, ${r.unlinked.length} could not be matched.`);
    r.warnings.forEach((w) => console.error('! ' + w));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv);
