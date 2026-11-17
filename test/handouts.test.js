const test = require('node:test');
const assert = require('node:assert');

let H;
test.before(async () => { H = await import('../src/handouts.mjs'); });

const SITE = 'https://moodle.example.edu/moodle';
const FILE = SITE + '/webservice/pluginfile.php/55/mod_assign/introattachment/0/sheet.pdf';
const pdfBytes = (n = 200) => { const b = new Uint8Array(n); b.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0); return b; };
const att = (over = {}) => ({ name: 'sheet.pdf', size: 1000, url: FILE, mime: 'application/pdf', modified: 1, ...over });

/* ---------- which URLs may be fetched with the user's token ---------- */

test('downloadUrl accepts only this site\'s web-service file paths and adds the token', () => {
  assert.strictEqual(H.downloadUrl(FILE, SITE, 'TOK'), FILE + '?token=TOK');
  assert.strictEqual(H.downloadUrl(FILE + '?forcedownload=1#x', SITE, 'TOK'), FILE + '?forcedownload=1&token=TOK');
  assert.strictEqual(H.downloadUrl(FILE + '?token=OLD', SITE, 'TOK'), FILE + '?token=TOK', 'a token already in the URL is replaced, not duplicated');
});

test('downloadUrl refuses other hosts, other paths, plain http, credentials, traversal and junk', () => {
  const bad = [
    'https://evil.example.org/moodle/webservice/pluginfile.php/55/x.pdf',          // another host
    'https://moodle.example.edu.evil.org/moodle/webservice/pluginfile.php/1/x.pdf',
    'https://moodle.example.edu/other/webservice/pluginfile.php/55/x.pdf',          // outside the site's path
    SITE + '/course/view.php?id=7',                                                   // not a file path
    SITE + '/webservice/pluginfile.php/../../admin/x.pdf',
    'http://moodle.example.edu/moodle/webservice/pluginfile.php/55/x.pdf',          // not https
    'https://user:pw@moodle.example.edu/moodle/webservice/pluginfile.php/55/x.pdf',
    '', 'not a url', null, undefined,
  ];
  bad.forEach((u) => assert.strictEqual(H.downloadUrl(u, SITE, 'TOK'), null, String(u)));
  assert.strictEqual(H.downloadUrl(FILE, 'garbage', 'TOK'), null);
});

test('a site with no path prefix works too', () => {
  const site = 'https://moodle.example.edu';
  assert.ok(H.downloadUrl('https://moodle.example.edu/webservice/pluginfile.php/1/a.pdf', site, 'T'));
  assert.strictEqual(H.downloadUrl('https://moodle.example.edu/moodle/webservice/pluginfile.php/1/a.pdf', site, 'T'), null, 'a path the user did not connect is refused');
});

/* ---------- reading ---------- */

const resp = (bytes, init = {}) => new Response(bytes, { status: 200, ...init });

test('readLimited returns the bytes under the cap and null over it', async () => {
  assert.strictEqual((await H.readLimited(resp(new Uint8Array(10)), 100)).length, 10);
  assert.strictEqual(await H.readLimited(resp(new Uint8Array(101)), 100), null);
  assert.strictEqual(await H.readLimited(resp(new Uint8Array(5), { headers: { 'content-length': '999999' } }), 100), null, 'a declared size over the cap is refused before reading');
});

test('readLimited stops reading a stream that runs past the cap', async () => {
  let pulled = 0;
  const stream = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(40)); if (pulled > 50) c.close(); } });
  assert.strictEqual(await H.readLimited(new Response(stream), 100), null);
  assert.ok(pulled < 10, 'it did not drain the whole stream: ' + pulled);
});

test('toBase64 round-trips, including large inputs', () => {
  const big = new Uint8Array(100000).map((_, i) => i % 251);
  assert.deepStrictEqual(new Uint8Array(Buffer.from(H.toBase64(big), 'base64')), big);
  assert.strictEqual(H.toBase64(new Uint8Array(0)), '');
});

test('isPdf looks at the mime type or the extension', () => {
  assert.strictEqual(H.isPdf({ name: 'a.PDF' }), true);
  assert.strictEqual(H.isPdf({ name: 'a', mime: 'application/pdf' }), true);
  assert.strictEqual(H.isPdf({ name: 'a.docx', mime: 'application/msword' }), false);
  assert.strictEqual(H.isPdf(null), false);
});

/* ---------- fetchHandouts ---------- */

function fetcher(map) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url: String(url), init }); const r = map(String(url)); return r instanceof Error ? Promise.reject(r) : r; };
  fn.calls = calls;
  return fn;
}
const run = (files, fetchFn, over = {}) => H.fetchHandouts(files, { site: SITE, token: 'TOK', fetchFn, ...over });

test('downloads a PDF with the token, refusing redirects, and returns it as base64', async () => {
  const f = fetcher(() => resp(pdfBytes(300)));
  const out = await run([att()], f);
  assert.deepStrictEqual(out.skipped, []);
  assert.strictEqual(out.docs.length, 1);
  assert.strictEqual(out.docs[0].name, 'sheet.pdf');
  assert.strictEqual(Buffer.from(out.docs[0].data, 'base64').length, 300);
  assert.strictEqual(f.calls[0].url, FILE + '?token=TOK');
  assert.strictEqual(f.calls[0].init.redirect, 'manual');
});

test('skips with a reason, and never throws: not a pdf, too large, too many, bad url, unavailable, redirected, fake pdf', async () => {
  const urlOf = (n) => SITE + '/webservice/pluginfile.php/55/' + n;
  const files = [
    att({ name: 'a.docx', mime: 'application/msword', url: urlOf('a.docx') }),
    att({ name: 'huge.pdf', size: 99 * 1024 * 1024, url: urlOf('huge.pdf') }),
    att({ name: 'offsite.pdf', url: 'https://evil.example.org/webservice/pluginfile.php/1/x.pdf' }),
    att({ name: 'gone.pdf', url: urlOf('gone.pdf') }),
    att({ name: 'moved.pdf', url: urlOf('moved.pdf') }),
    att({ name: 'down.pdf', url: urlOf('down.pdf') }),
    att({ name: 'fake.pdf', url: urlOf('fake.pdf') }),
    att({ name: 'ok1.pdf', url: urlOf('ok1.pdf') }),
    att({ name: 'ok2.pdf', url: urlOf('ok2.pdf') }),
    att({ name: 'ok3.pdf', url: urlOf('ok3.pdf') }),
  ];
  const f = fetcher((u) => {
    if (u.includes('gone.pdf')) return resp('nope', { status: 404 });
    if (u.includes('moved.pdf')) return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
    if (u.includes('down.pdf')) return new Error('network down');
    if (u.includes('fake.pdf')) return resp(new TextEncoder().encode('<html>login page</html>'));
    return resp(pdfBytes(50));
  });
  const out = await run(files, f);
  assert.deepStrictEqual(out.docs.map((d) => d.name), ['ok1.pdf', 'ok2.pdf']);
  const reasons = Object.fromEntries(out.skipped.map((s) => [s.name, s.reason]));
  assert.deepStrictEqual(reasons, { 'a.docx': 'not_pdf', 'huge.pdf': 'too_large', 'offsite.pdf': 'bad_url', 'gone.pdf': 'unavailable', 'moved.pdf': 'redirected', 'down.pdf': 'unavailable', 'fake.pdf': 'not_a_pdf', 'ok3.pdf': 'too_many' });
  assert.ok(!f.calls.some((c) => c.url.includes('evil.example.org')), 'the off-site URL was never requested');
  assert.ok(!f.calls.some((c) => c.url.includes('169.254')), 'the redirect target was never followed');
});

test('a download that turns out larger than the cap is dropped, and the total across files is capped', async () => {
  const f = fetcher(() => resp(pdfBytes(300)));
  const out = await run([att({ name: 'a.pdf', size: 0 })], f, { maxFileBytes: 200 });
  assert.deepStrictEqual(out.skipped, [{ name: 'a.pdf', reason: 'too_large' }]);
  const two = await run([att({ name: 'a.pdf' }), att({ name: 'b.pdf', url: SITE + '/webservice/pluginfile.php/55/b.pdf' })], fetcher(() => resp(pdfBytes(300))), { maxTotal: 400 });
  assert.deepStrictEqual(two.docs.map((d) => d.name), ['a.pdf']);
  assert.deepStrictEqual(two.skipped.map((s) => s.reason), ['too_large']);
});

test('the transient set holds the reasons worth retrying', () => {
  assert.ok(H.TRANSIENT.has('unavailable') && H.TRANSIENT.has('redirected'));
  assert.ok(!H.TRANSIENT.has('not_pdf') && !H.TRANSIENT.has('too_large'));
});
