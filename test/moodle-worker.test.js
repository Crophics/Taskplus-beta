const test = require('node:test');
const assert = require('node:assert');

let W, C, A, S;
test.before(async () => {
  W = await import('../src/worker.mjs');
  C = await import('../src/moodle-client.mjs');
  A = await import('../src/auth.mjs');
  S = await import('../src/store.mjs');
});

const PROJECT = 'planner-88ab8';
const SITE = 'https://moodle.example.edu/moodle';
const ENC_KEY = Buffer.alloc(32, 7).toString('base64');
const NOW = 1_800_000_000_000; // ms
const NOW_SEC = NOW / 1000;

/* ---------- helpers ---------- */

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let keyPair, jwk;
async function ensureKeys() {
  if (keyPair) return;
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  );
  jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
}

async function makeToken(overrides = {}, signKey) {
  await ensureKeys();
  const header = { alg: 'RS256', kid: 'k1', typ: 'JWT' };
  const payload = {
    iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, sub: 'user-1',
    iat: NOW_SEC - 10, exp: NOW_SEC + 3000, ...overrides,
  };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signKey || keyPair.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64url(new Uint8Array(sig));
}

function fakeKv() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
}

const COURSES = [
  { id: 7, fullname: 'MATH 2400 Linear Algebra - 2026 FALL', startdate: NOW_SEC - 86400 * 60, enddate: NOW_SEC + 86400 * 60, visible: 1 },
  { id: 8, fullname: 'PHIL 2202 Ethics - 2026 FALL', startdate: NOW_SEC - 86400 * 60, enddate: NOW_SEC + 86400 * 60, visible: 1 },
  { id: 9, fullname: 'OLD 1000 Past Course - 2024 FALL', startdate: NOW_SEC - 86400 * 900, enddate: NOW_SEC - 86400 * 800, visible: 1 },
];

/** Fake Moodle + Google JWKS in one fetch. `calls` records every Moodle web-service function used. */
function makeFetch(opts = {}) {
  const calls = [];
  const goodToken = 'ws-token-abc';
  const fn = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('googleapis.com')) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    if (!u.startsWith(SITE)) throw new Error('unexpected host: ' + u);
    const body = new URLSearchParams(init.body || '');
    const reply = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (u.endsWith('/login/token.php')) {
      calls.push('login');
      if (body.get('username') === 'student' && body.get('password') === 'pw-secret') return reply({ token: goodToken });
      return reply({ error: 'Invalid login', errorcode: 'invalidlogin' });
    }
    if (u.endsWith('/webservice/rest/server.php')) {
      const f = body.get('wsfunction');
      calls.push(f);
      if (opts.expireToken || body.get('wstoken') !== goodToken) return reply({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
      if (opts.forbid && opts.forbid.includes(f)) return reply({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' });
      switch (f) {
        case 'gradereport_user_get_grade_items': throw new Error('the app no longer asks Moodle for grades');
        case 'core_webservice_get_site_info': return reply({ userid: 42, fullname: 'Test Student', sitename: 'Example U' });
        case 'core_enrol_get_users_courses': return reply(COURSES);
        case 'mod_assign_get_assignments':
          return reply({ courses: [{ id: 7, assignments: [
            { id: 101, cmid: 5001, name: 'Assignment 6', duedate: NOW_SEC + 86400 * 2, grade: 100, intro: '<p>Do problems.</p>', introattachments: [] },
            { id: 102, cmid: 5002, name: 'Assignment 5', duedate: NOW_SEC - 86400 * 5, grade: 100, intro: '' },
          ] }, { id: 8, assignments: [{ id: 103, cmid: 5003, name: 'Reading response', duedate: NOW_SEC + 86400, grade: 10, intro: '' }] }] });
        case 'mod_quiz_get_quizzes_by_courses':
          return reply({ quizzes: [{ id: 55, coursemodule: 6001, course: 7, name: 'Quiz 4', timeclose: NOW_SEC + 86400 * 3, timelimit: 1200, grade: 10, intro: '' }] });
        case 'mod_assign_get_submission_status': {
          const id = Number(body.get('assignid'));
          return reply({ lastattempt: { submission: { status: id === 102 ? 'submitted' : 'new' } } });
        }
        case 'mod_quiz_get_user_attempts': return reply({ attempts: [] });
        default: return reply({ exception: 'x', errorcode: 'nofunction' });
      }
    }
    throw new Error('unexpected url ' + u);
  };
  fn.calls = calls;
  return fn;
}

async function api(path, { method = 'POST', body, token, env, fetchFn, now = NOW } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = 'Bearer ' + (token || (await makeToken()));
  const req = new Request('https://beta.example.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await W.handleApi(req, env, { fetchFn, now: () => now });
  return { res, json: await res.json() };
}

function newEnv() {
  return { MOODLE_KV: fakeKv(), TOKEN_ENC_KEY: ENC_KEY };
}

test.beforeEach(() => { A.resetJwksCache(); });

/* ---------- normalizeSite ---------- */

test('normalizeSite accepts bare hosts and full urls', () => {
  assert.strictEqual(C.normalizeSite('moodle.school.edu'), 'https://moodle.school.edu');
  assert.strictEqual(C.normalizeSite(' https://School.edu/moodle/ '), 'https://school.edu/moodle');
  assert.strictEqual(C.normalizeSite('https://school.edu/moodle/login/index.php?x=1#y'), 'https://school.edu/moodle/login/index.php');
});

test('normalizeSite rejects unsafe or malformed addresses', () => {
  const bad = ['', 'http://school.edu', 'https://localhost', 'https://127.0.0.1', 'https://[::1]/', 'https://10.0.0.5',
    'https://intranet', 'https://x.internal', 'https://localhost.', 'https://x.internal.', 'https://printer.lan', 'https://a.test', 'https://host.example', 'https://x.intranet', 'https://school.123', 'https://0x7f.1', 'https://127.1', 'https://2130706433', 'https://a..edu', 'https://u:p@school.edu', 'https://school.edu:8443', 'ftp://school.edu', 'not a url', 'a'.repeat(300)];
  bad.forEach((b) => assert.throws(() => C.normalizeSite(b), (e) => e.code === 'bad_site', 'should reject: ' + b));
});

/* ---------- firebase token verification ---------- */

test('verifyFirebaseIdToken accepts a valid token', async () => {
  const out = await A.verifyFirebaseIdToken(await makeToken(), { projectId: PROJECT, fetchFn: makeFetch(), now: NOW });
  assert.strictEqual(out.uid, 'user-1');
});

test('verifyFirebaseIdToken rejects expired, wrong audience, wrong issuer, bad signature, garbage', async () => {
  const f = makeFetch();
  const check = async (token) => assert.rejects(A.verifyFirebaseIdToken(token, { projectId: PROJECT, fetchFn: f, now: NOW }), A.AuthError);
  await check(await makeToken({ exp: NOW_SEC - 1 }));
  await check(await makeToken({ aud: 'other-project' }));
  await check(await makeToken({ iss: 'https://evil.example/' + PROJECT }));
  await check(await makeToken({ sub: '' }));
  await check(await makeToken({ iat: NOW_SEC + 99999 }));
  await check('not.a.jwt');
  await check('');
  await check(undefined);
  const other = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  );
  await check(await makeToken({}, other.privateKey)); // signed with a key that is not in the JWKS
});

/* ---------- encrypted store ---------- */

test('seal/open round-trips and hides the plaintext', async () => {
  const sealed = await S.seal(ENC_KEY, { token: 'super-secret-token' });
  assert.ok(!sealed.includes('super-secret-token'));
  assert.deepStrictEqual(await S.open(ENC_KEY, sealed), { token: 'super-secret-token' });
});

test('open returns null for the wrong key, tampering and junk', async () => {
  const sealed = await S.seal(ENC_KEY, { a: 1 });
  assert.strictEqual(await S.open(Buffer.alloc(32, 9).toString('base64'), sealed), null);
  assert.strictEqual(await S.open(ENC_KEY, sealed.slice(0, -4) + 'AAAA'), null);
  assert.strictEqual(await S.open(ENC_KEY, 'garbage'), null);
  assert.strictEqual(await S.open(ENC_KEY, null), null);
});

test('seal rejects a key that is not 32 bytes', async () => {
  await assert.rejects(S.seal(Buffer.alloc(16).toString('base64'), {}));
});

/* ---------- API ---------- */

test('API requires a Firebase sign-in and server configuration', async () => {
  const f = makeFetch();
  let r = await api('/api/moodle/status', { method: 'GET', token: null, env: newEnv(), fetchFn: f });
  assert.strictEqual(r.res.status, 401);
  r = await api('/api/moodle/status', { method: 'GET', token: 'bad.token.here', env: newEnv(), fetchFn: f });
  assert.strictEqual(r.res.status, 401);
  r = await api('/api/moodle/status', { method: 'GET', env: {}, fetchFn: f });
  assert.strictEqual(r.res.status, 503);
  r = await api('/api/moodle/nope', { env: newEnv(), fetchFn: f });
  assert.strictEqual(r.res.status, 404);
  r = await api('/api/moodle/connect', { method: 'GET', env: newEnv(), fetchFn: f });
  assert.strictEqual(r.res.status, 405);
});

test('connect exchanges credentials for a token, stores only the encrypted token, and pre-selects current courses', async () => {
  const env = newEnv();
  const f = makeFetch();
  const { res, json } = await api('/api/moodle/connect', { env, fetchFn: f, body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'pw-secret' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(json.connected, true);
  assert.strictEqual(json.site, 'moodle.example.edu');
  assert.strictEqual(json.fullname, 'Test Student');
  assert.deepStrictEqual(json.courses.map((c) => [c.id, c.code, c.selected]), [[7, 'MATH 2400', true], [8, 'PHIL 2202', true], [9, 'OLD 1000', false]]);
  const wire = JSON.stringify(json);
  assert.ok(!wire.includes('ws-token-abc'), 'token must never be returned to the browser');
  assert.ok(!wire.includes('pw-secret'), 'password must never be returned');
  // What is at rest:
  const stored = [...env.MOODLE_KV.m.values()].join('|');
  assert.ok(!stored.includes('ws-token-abc'), 'token must be encrypted at rest');
  assert.ok(!stored.includes('pw-secret'), 'password must never be stored');
  assert.ok(!stored.includes('moodle.example.edu'), 'record should be fully encrypted');
});

test('connect reports bad credentials and bad sites without leaking details', async () => {
  const env = newEnv();
  const f = makeFetch();
  let r = await api('/api/moodle/connect', { env, fetchFn: f, body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'wrong' } });
  assert.strictEqual(r.res.status, 401);
  assert.strictEqual(r.json.error, 'bad_credentials');
  assert.ok(!JSON.stringify(r.json).includes('wrong'));
  r = await api('/api/moodle/connect', { env, fetchFn: f, body: { site: 'http://moodle.example.edu', username: 'a', password: 'b' } });
  assert.strictEqual(r.json.error, 'bad_site');
  r = await api('/api/moodle/connect', { env, fetchFn: f, body: { site: 'moodle.example.edu/moodle', username: '', password: 'b' } });
  assert.strictEqual(r.json.error, 'bad_request');
  assert.strictEqual(env.MOODLE_KV.m.size, 0, 'nothing is stored on failure');
});

async function connected(env, f) {
  await api('/api/moodle/connect', { env, fetchFn: f, body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'pw-secret' } });
}

test('status reflects connection, and each user only sees their own', async () => {
  const env = newEnv();
  const f = makeFetch();
  let r = await api('/api/moodle/status', { method: 'GET', env, fetchFn: f });
  assert.deepStrictEqual(r.json, { connected: false });
  await connected(env, f);
  r = await api('/api/moodle/status', { method: 'GET', env, fetchFn: f });
  assert.strictEqual(r.json.connected, true);
  const other = await api('/api/moodle/status', { method: 'GET', env, fetchFn: f, token: await makeToken({ sub: 'user-2' }) });
  assert.deepStrictEqual(other.json, { connected: false });
});

test('courses endpoint updates the selection and ignores unknown ids', async () => {
  const env = newEnv();
  const f = makeFetch();
  await connected(env, f);
  let r = await api('/api/moodle/courses', { env, fetchFn: f, body: { selected: [7, 999] } });
  assert.deepStrictEqual(r.json.courses.filter((c) => c.selected).map((c) => c.id), [7]);
  r = await api('/api/moodle/courses', { env, fetchFn: f, body: { selected: 'nope' } });
  assert.strictEqual(r.json.error, 'bad_request');
});

test('sync returns mapped records with submission state', async () => {
  const env = newEnv();
  const f = makeFetch();
  await connected(env, f);
  const { res, json } = await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 60_000 });
  assert.strictEqual(res.status, 200);
  const byId = Object.fromEntries(json.records.map((r) => [r.id, r]));
  assert.deepStrictEqual(Object.keys(byId).sort(), ['moodle:5001', 'moodle:5002', 'moodle:5003', 'moodle:6001']);
  assert.strictEqual(byId['moodle:5001'].state, 'none');
  assert.strictEqual(byId['moodle:5002'].state, 'submitted');
  assert.strictEqual(byId['moodle:5001'].course, 'MATH 2400');
  assert.strictEqual(byId['moodle:5003'].course, 'PHIL 2202');
  assert.strictEqual(byId['moodle:6001'].timeLimitMin, 20);
  assert.strictEqual(byId['moodle:5001'].link, SITE + '/mod/assign/view.php?id=5001');
  assert.ok(!JSON.stringify(json).includes('ws-token-abc'));
  assert.ok(json.syncedAt);
});

test('sync only fetches selected courses', async () => {
  const env = newEnv();
  const f = makeFetch();
  await connected(env, f);
  await api('/api/moodle/courses', { env, fetchFn: f, body: { selected: [8] } });
  const { json } = await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 60_000 });
  assert.deepStrictEqual(json.records.map((r) => r.id), ['moodle:5003']);
});

test('sync is rate limited per user', async () => {
  const env = newEnv();
  const f = makeFetch();
  await connected(env, f);
  const first = await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 60_000 });
  assert.strictEqual(first.res.status, 200);
  const second = await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 70_000 });
  assert.strictEqual(second.res.status, 429);
  assert.strictEqual(second.json.error, 'too_soon');
  const third = await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 130_000 });
  assert.strictEqual(third.res.status, 200);
});

test('sync respects the Moodle call budget and says what was skipped', async () => {
  const env = { ...newEnv(), SUBREQUEST_BUDGET: '4' }; // 3 base calls + 1 state check
  const f = makeFetch();
  await connected(env, f);
  const { json } = await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 60_000 });
  const checked = json.records.filter((r) => r.state !== null).length;
  assert.strictEqual(checked, 1);
  assert.ok(json.warnings.some((w) => w.startsWith('state_skipped:')));
  const soonest = json.records.filter((r) => r.state !== null)[0];
  assert.strictEqual(soonest.id, 'moodle:5002', 'the earliest-due item (a recently overdue one) is checked first');
});

test('an expired Moodle token disconnects and asks the user to reconnect', async () => {
  const env = newEnv();
  await connected(env, makeFetch());
  const { res, json } = await api('/api/moodle/sync', { env, fetchFn: makeFetch({ expireToken: true }), now: NOW + 60_000 });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(json.error, 'moodle_auth');
  const st = await api('/api/moodle/status', { method: 'GET', env, fetchFn: makeFetch() });
  assert.deepStrictEqual(st.json, { connected: false });
});

test('sync before connecting is a clear error', async () => {
  const { res, json } = await api('/api/moodle/sync', { env: newEnv(), fetchFn: makeFetch() });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(json.error, 'not_connected');
});

test('disconnect deletes the stored connection', async () => {
  const env = newEnv();
  const f = makeFetch();
  await connected(env, f);
  const r = await api('/api/moodle/disconnect', { env, fetchFn: f });
  assert.deepStrictEqual(r.json, { ok: true });
  assert.strictEqual(env.MOODLE_KV.m.size, 0);
});

test('sync never asks Moodle for grades and returns no grade data', async () => {
  const env = newEnv();
  const f = makeFetch();
  await connected(env, f);
  const { res, json } = await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 60_000 });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(json.records.length, 4);
  assert.strictEqual(json.grades, undefined);
  assert.ok(!json.warnings.some((w) => w.startsWith('grades_')));
});

test('accessexception on a core call is "forbidden", and keeps the stored connection', async () => {
  const env = newEnv();
  await connected(env, makeFetch());
  const f = makeFetch({ forbid: ['mod_assign_get_assignments'] });
  const { res, json } = await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 60_000 });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(json.error, 'moodle_forbidden');
  const st = await api('/api/moodle/status', { method: 'GET', env, fetchFn: f });
  assert.strictEqual(st.json.connected, true, 'a restricted function is not an expired sign-in');
});

test('non-API requests fall through to static assets', async () => {
  const env = { ASSETS: { fetch: async () => new Response('asset') } };
  const res = await W.default.fetch(new Request('https://beta.example.test/index.html'), env, {});
  assert.strictEqual(await res.text(), 'asset');
});

/* ---------- Phase 5: alerts routes ---------- */

test('push routes need sign-in and work without a Moodle connection', async () => {
  const env = newEnv();
  const FFN = makeFetch();
  assert.strictEqual((await api('/api/push/status', { method: 'GET', env, token: null, fetchFn: FFN })).res.status, 401);
  const r = await api('/api/push/register', { env, fetchFn: FFN, body: { token: 'device-token-aaaaaaaaaaaaaaaaaaaa', timeZone: 'America/New_York' } });
  assert.strictEqual(r.res.status, 200);
  assert.strictEqual(r.json.devices, 1);
  assert.strictEqual(r.json.configured, false);
  assert.strictEqual(r.json.tz, 'America/New_York');
  assert.strictEqual((await api('/api/push/register', { env, fetchFn: FFN, body: { token: 'x' } })).res.status, 400);
  const p = await api('/api/push/prefs', { env, fetchFn: FFN, body: { moved: false, quiet: { on: true, start: 23, end: 7 } } });
  assert.strictEqual(p.json.prefs.moved, false);
  assert.strictEqual(p.json.prefs.new, true);
  assert.deepStrictEqual(p.json.prefs.quiet, { on: true, start: 23, end: 7 });
  assert.strictEqual((await api('/api/push/status', { method: 'GET', env, fetchFn: FFN })).json.devices, 1);
  await api('/api/push/unregister', { env, fetchFn: FFN, body: {} });
  assert.strictEqual((await api('/api/push/status', { method: 'GET', env, fetchFn: FFN })).json.devices, 0);
});

test('push test says when the server has no FCM key or the device is unregistered', async () => {
  const env = newEnv();
  const FFN = makeFetch();
  assert.strictEqual((await api('/api/push/test', { env, fetchFn: FFN, body: {} })).json.error, 'not_configured');
});

test('sync reports new assignments as events after the baseline, and the feed keeps them', async () => {
  const env = newEnv();
  const f = makeFetch();
  await connected(env, f);
  const first = await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 60_000 });
  assert.deepStrictEqual(first.json.events, []); // baseline
  // Pretend the first snapshot predates one assignment.
  const snap = await S.open(ENC_KEY, env.MOODLE_KV.m.get('snap:user-1'));
  delete snap.items['moodle:5003'];
  env.MOODLE_KV.m.set('snap:user-1', await S.seal(ENC_KEY, snap));
  const second = await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 120_000 });
  assert.deepStrictEqual(second.json.events.map((e) => e.id), ['new:moodle:5003']);
  const feed = await api('/api/push/events', { method: 'GET', env, fetchFn: f });
  assert.strictEqual(feed.json.events.length, 1);
  assert.ok(!JSON.stringify(feed.json).includes('ws-token-abc'));
});

test('disconnect also forgets the snapshot and feed', async () => {
  const env = newEnv();
  const f = makeFetch();
  await connected(env, f);
  await api('/api/moodle/sync', { env, fetchFn: f, now: NOW + 60_000 });
  assert.ok(env.MOODLE_KV.m.has('snap:user-1'));
  await api('/api/moodle/disconnect', { env, fetchFn: f, body: {} });
  assert.ok(!env.MOODLE_KV.m.has('snap:user-1'));
  assert.ok(![...env.MOODLE_KV.m.keys()].some((k) => k.startsWith('moodle:')));
});

/* ---------- Delete my data ---------- */

function listingKv() {
  const kv = fakeKv();
  kv.list = async ({ prefix, limit = 1000 }) => {
    const all = [...kv.m.keys()].filter((k) => k.startsWith(prefix));
    return { keys: all.slice(0, limit).map((name) => ({ name })), list_complete: all.length <= limit };
  };
  return kv;
}

test('delete my data removes the connection, snapshot, feed, push devices and cached AI answers, in batches, and only for this user', async () => {
  const env = { MOODLE_KV: listingKv(), TOKEN_ENC_KEY: ENC_KEY };
  const f = makeFetch();
  await connected(env, f);
  const m = env.MOODLE_KV.m;
  for (const k of ['snap:user-1', 'evt:user-1', 'push:user-1']) m.set(k, 'x');
  for (let i = 0; i < 45; i++) m.set('est:user-1:' + i, 'x');
  m.set('est:user-2:keep', 'x'); m.set('push:user-2', 'x'); m.set('estn:user-1:2026-11-18', '3');
  let r = await api('/api/account/delete', { env, fetchFn: f, body: {} });
  assert.strictEqual(r.res.status, 200);
  assert.strictEqual(r.json.more, true, '45 cached answers need a second batch');
  r = await api('/api/account/delete', { env, fetchFn: f, body: {} });
  assert.strictEqual(r.json.more, false);
  const left = [...m.keys()].sort();
  assert.deepStrictEqual(left, ['est:user-2:keep', 'estn:user-1:2026-11-18', 'push:user-2'], 'the other user and the daily counter are untouched');
});

test('delete my data needs a signed-in user and works with nothing stored', async () => {
  const env = { MOODLE_KV: listingKv(), TOKEN_ENC_KEY: ENC_KEY };
  const noAuth = await api('/api/account/delete', { env, token: null, body: {} });
  assert.strictEqual(noAuth.res.status, 401);
  const empty = await api('/api/account/delete', { env, fetchFn: makeFetch(), body: {} });
  assert.strictEqual(empty.res.status, 200);
  assert.deepStrictEqual(empty.json, { ok: true, more: false });
});

/* ---------- redirects and the invite gate ---------- */

test('a Moodle address that redirects is refused (the password is never re-sent), with a hint to the real address', async () => {
  const redirecting = async () => new Response('', { status: 307, headers: { location: 'https://lms.realschool.edu/login/token.php' } });
  await assert.rejects(() => C.requestToken('https://moodle.school.edu', 'u', 'pw', redirecting), (e) => e.code === 'bad_site' && /lms\.realschool\.edu/.test(e.message));
  const toInternal = async () => new Response('', { status: 302, headers: { location: 'https://127.0.0.1/x' } });
  await assert.rejects(() => C.requestToken('https://moodle.school.edu', 'u', 'pw', toInternal), (e) => e.code === 'bad_site' && !/127/.test(e.message));
  const seen = [];
  const spy = async (url, init) => { seen.push(init.redirect); return new Response(JSON.stringify({ token: 't' })); };
  assert.strictEqual(await C.requestToken('https://moodle.school.edu', 'u', 'pw', spy), 't');
  assert.deepStrictEqual(seen, ['manual']);
});

test('with INVITE_CODES set, connecting needs a valid code, checked before Moodle is contacted; unset stays open', async () => {
  const connect = (env, invite, f) => api('/api/moodle/connect', { env, fetchFn: f, body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'pw-secret', ...(invite === undefined ? {} : { invite }) } });
  const env = newEnv();
  env.INVITE_CODES = ' friend-code-0123456789 , other-code-abcdefghij ';
  const f = makeFetch();
  const calls = [];
  const spy = async (...a) => { calls.push(a[0]); return f(...a); };
  let r = await connect(env, undefined, spy);
  assert.strictEqual(r.res.status, 403); assert.strictEqual(r.json.error, 'invite_required');
  r = await connect(env, 'wrong-code', spy);
  assert.strictEqual(r.res.status, 403); assert.strictEqual(r.json.error, 'invite_invalid');
  r = await connect(env, 'friend-code-0123456', spy);
  assert.strictEqual(r.json.error, 'invite_invalid', 'a prefix of a code is not the code');
  const moodleCallsBefore = calls.filter((u) => String(u).includes('moodle.example.edu')).length;
  assert.strictEqual(moodleCallsBefore, 0, 'Moodle is never contacted without a valid code');
  r = await connect(env, 'other-code-abcdefghij', spy);
  assert.strictEqual(r.res.status, 200);
  // one-time use: a different account cannot use the same code, the same account can (reconnecting)
  r = await api('/api/moodle/connect', { env, fetchFn: f, token: await makeToken({ sub: 'user-2' }), body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'pw-secret', invite: 'other-code-abcdefghij' } });
  assert.strictEqual(r.res.status, 403); assert.strictEqual(r.json.error, 'invite_used');
  r = await connect(env, 'other-code-abcdefghij', spy);
  assert.strictEqual(r.res.status, 200, 'the account that used the code can reconnect with it');
  assert.ok([...env.MOODLE_KV.m.entries()].filter(([k]) => k.startsWith('invite:')).every(([k, v]) => !k.includes('other-code') && !v.includes('user-')), 'only hashes are stored');
  // a different code is still free for the second account
  r = await api('/api/moodle/connect', { env, fetchFn: f, token: await makeToken({ sub: 'user-2' }), body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'pw-secret', invite: 'friend-code-0123456789' } });
  assert.strictEqual(r.res.status, 200);
  // a connected user is unaffected by the gate for everything else
  assert.strictEqual((await api('/api/moodle/status', { method: 'GET', env, fetchFn: f })).json.connected, true);
  // unset = open
  const open = newEnv();
  assert.strictEqual((await connect(open, undefined, makeFetch())).res.status, 200);
});

test('a failed connect (wrong password) does not use up the invite code', async () => {
  const env = newEnv();
  env.INVITE_CODES = 'one-time-code-xyz-123';
  const f = makeFetch();
  let r = await api('/api/moodle/connect', { env, fetchFn: f, body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'wrong', invite: 'one-time-code-xyz-123' } });
  assert.strictEqual(r.res.status, 401);
  assert.ok(![...env.MOODLE_KV.m.keys()].some((k) => k.startsWith('invite:')));
  r = await api('/api/moodle/connect', { env, fetchFn: f, body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'pw-secret', invite: 'one-time-code-xyz-123' } });
  assert.strictEqual(r.res.status, 200);
  assert.ok([...env.MOODLE_KV.m.keys()].some((k) => k.startsWith('invite:')));
});

test('invite check: open servers say so; with codes it says valid / invalid / used, without a token and without consuming anything', async () => {
  const check = (env, invite) => api('/api/invite/check', { env, token: null, body: invite === undefined ? {} : { invite } });
  assert.deepStrictEqual((await check(newEnv())).json, { required: false });
  const env = newEnv();
  env.INVITE_CODES = 'good-code-aaaaaaaaaaaa,other-code-bbbbbbbbbbbb';
  assert.deepStrictEqual((await check(env)).json, { required: true, ok: false, reason: 'required' });
  assert.deepStrictEqual((await check(env, 'nope')).json, { required: true, ok: false, reason: 'invalid' });
  assert.deepStrictEqual((await check(env, ' good-code-aaaaaaaaaaaa ')).json, { required: true, ok: true, reason: '' });
  assert.deepStrictEqual((await check(env, 'good-code-aaaaaaaaaaaa')).json, { required: true, ok: true, reason: '' }, 'checking twice does not use it up');
  assert.strictEqual([...env.MOODLE_KV.m.keys()].filter((k) => k.startsWith('invite:')).length, 0);
  const f = makeFetch();
  await api('/api/moodle/connect', { env, fetchFn: f, body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'pw-secret', invite: 'good-code-aaaaaaaaaaaa' } });
  assert.deepStrictEqual((await check(env, 'good-code-aaaaaaaaaaaa')).json, { required: true, ok: false, reason: 'used' });
  assert.strictEqual((await api('/api/invite/check', { env, token: null, method: 'GET' })).res.status, 405);
});

test('invite codes can live in KV (dashboard entries named code:<code>): gate on while any exists, one account per code, used codes are marked, deleting them all opens signup', async () => {
  const env = { MOODLE_KV: listingKv(), TOKEN_ENC_KEY: ENC_KEY };
  const m = env.MOODLE_KV.m;
  const check = (invite) => api('/api/invite/check', { env, token: null, body: { invite } });
  assert.deepStrictEqual((await check('')).json, { required: false }, 'no codes anywhere: open');
  m.set('code:friend-sam-0123456789', 'Sam');
  m.set('code:friend-ava-9876543210', 'Ava');
  assert.deepStrictEqual((await check('')).json, { required: true, ok: false, reason: 'required' });
  assert.deepStrictEqual((await check('nope-nope')).json, { required: true, ok: false, reason: 'invalid' });
  assert.deepStrictEqual((await check('../../etc/passwd')).json, { required: true, ok: false, reason: 'invalid' }, 'odd characters never reach KV');
  assert.deepStrictEqual((await check('friend-sam-0123456789')).json, { required: true, ok: true, reason: '' });
  const f = makeFetch();
  const connect = async (invite, sub) => api('/api/moodle/connect', { env, fetchFn: f, token: sub ? await makeToken({ sub }) : undefined, body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'pw-secret', invite } });
  let r = await connect('friend-sam-0123456789');
  assert.strictEqual(r.res.status, 200);
  assert.match(m.get('code:friend-sam-0123456789'), /^Sam \[used \d{4}-\d{2}-\d{2}\]$/, 'the dashboard entry shows it is spent, keeping the note');
  r = await connect('friend-sam-0123456789', 'user-2');
  assert.strictEqual(r.json.error, 'invite_used');
  assert.strictEqual(m.get('code:friend-ava-9876543210'), 'Ava', 'other codes are untouched');
  r = await connect('friend-sam-0123456789');
  assert.strictEqual(r.res.status, 200, 'the same account can reconnect');
  assert.ok(!/used.*used/.test(m.get('code:friend-sam-0123456789')), 'marked once');
  // both sources work together
  env.INVITE_CODES = 'from-variable-code-1';
  assert.strictEqual((await check('from-variable-code-1')).json.ok, true);
  assert.strictEqual((await check('friend-ava-9876543210')).json.ok, true);
  delete env.INVITE_CODES;
  // delete every code entry: signup is open again
  for (const k of [...m.keys()].filter((k) => k.startsWith('code:'))) m.delete(k);
  assert.deepStrictEqual((await check('')).json, { required: false });
  assert.strictEqual((await api('/api/moodle/connect', { env, fetchFn: f, token: await makeToken({ sub: 'user-3' }), body: { site: 'moodle.example.edu/moodle', username: 'student', password: 'pw-secret' } })).res.status, 200);
});
