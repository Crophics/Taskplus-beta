const test = require('node:test');
const assert = require('node:assert');

let T;
test.before(async () => { T = await import('../tools/vault-frontmatter.mjs'); });

const note = (fm) => '---\n' + fm + '\n---\n# Note\n';

test('parseFrontmatter reads scalars, quoted strings, inline and block lists, and maps', () => {
  const fm = T.parseFrontmatter(note('a: 5\nb: "x y"\nc: yes\nd: [1, 2, 3]\ne:\n  - 4\n  - 5\nf:\n  A: 93\n  B: 83\ng: 0.5\nh: true'));
  assert.deepStrictEqual(fm, { a: 5, b: 'x y', c: 'yes', d: [1, 2, 3], e: [4, 5], f: { A: 93, B: 83 }, g: 0.5, h: true });
  assert.deepStrictEqual(T.parseFrontmatter('no frontmatter here'), {});
});
