// vault-frontmatter.mjs — the small YAML-frontmatter reader used by tools/compare-vault.mjs.

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
