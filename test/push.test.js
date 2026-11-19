const test = require('node:test');
const assert = require('node:assert');

let P, F, S;
test.before(async () => { P = await import('../src/push.mjs'); F = await import('../src/fcm.mjs'); S = await import('../src/store.mjs'); });

const ENC = Buffer.alloc(32, 9).toString('base64');
const NOW = Date.UTC(2026, 10, 17, 15, 0, 0);
const sec = NOW / 1000;
const TOKEN = 'device-token-aaaaaaaaaaaaaaaaaaaa';

function kv() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }) };
}

let saJson;
async function serviceAccount() {
  if (saJson) return saJson;
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  saJson = JSON.stringify({ client_email: 'push@planner-88ab8.iam.gserviceaccount.com', project_id: 'planner-88ab8', private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n` });
  return saJson;
}

function fakeFcm(opts = {}) {
  const sent = [];
  const fn = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      assert.match(String(init.body), /assertion=[\w-]+\.[\w-]+\.[\w-]+/);
      return new Response(JSON.stringify({ access_token: 'oauth', expires_in: 3600 }));
    }
    if (u === 'https://fcm.googleapis.com/v1/projects/planner-88ab8/messages:send') {
      assert.strictEqual(init.headers.authorization, 'Bearer oauth');
      const msg = JSON.parse(init.body).message;
      sent.push(msg);
      if (opts.dead && opts.dead.includes(msg.token)) return new Response(JSON.stringify({ error: { status: 'UNREGISTERED' } }), { status: 404 });
      return new Response('{}');
    }
    throw new Error('unexpected ' + u);
  };
  return { fn, sent };
}

const rec = (id, o = {}) => ({ id, kind: 'assign', title: 'T' + id, course: 'MATH', dueTs: sec + 3 * 86400, state: 'none', ...o });
const result = (records) => ({ records, warnings: [], courses: [{ id: 7, fullname: 'MATH' }] });

async function setup(opts = {}) {
  const env = { MOODLE_KV: kv(), TOKEN_ENC_KEY: ENC, FCM_SERVICE_ACCOUNT: await serviceAccount() };
  F.resetFcmCache();
  await P.registerToken(env, 'u1', { token: TOKEN, tz: 'UTC', userAgent: 'x' }, NOW);
  return env;
}

test('registerToken validates, dedupes and caps devices', async () => {
  const env = await setup();
  await assert.rejects(P.registerToken(env, 'u1', { token: 'short' }, NOW));
  for (let i = 0; i < 7; i++) await P.registerToken(env, 'u1', { token: 'tok-' + String(i).repeat(25) }, NOW + i);
  await P.registerToken(env, 'u1', { token: 'tok-' + '6'.repeat(25) }, NOW + 9);
  const p = await P.loadPush(env, 'u1');
  assert.strictEqual(p.tokens.length, P.MAX_TOKENS);
  assert.strictEqual(new Set(p.tokens.map((t) => t.t)).size, P.MAX_TOKENS);
});

test('stored push data is encrypted at rest', async () => {
  const env = await setup();
  assert.ok(!env.MOODLE_KV.m.get('push:u1').includes(TOKEN));
});

test('cleanPrefs ignores junk', () => {
  const p = P.cleanPrefs({ new: false, moved: 'yes', quiet: { on: true, start: 23, end: 99 } }, null);
  assert.strictEqual(p.new, false);
  assert.strictEqual(p.moved, true);
  assert.deepStrictEqual(p.quiet, { on: true, start: 23, end: 8 });
});

test('processSync: baseline silent, then a new assignment pushes once', async () => {
  const env = await setup(); const f = fakeFcm();
  await P.processSync(env, 'u1', result([rec('moodle:1')]), NOW, { notify: true, deps: { fetchFn: f.fn } });
  assert.strictEqual(f.sent.length, 0);
  const ev = await P.processSync(env, 'u1', result([rec('moodle:1'), rec('moodle:2')]), NOW + 1000, { notify: true, deps: { fetchFn: f.fn } });
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(f.sent.length, 1);
  assert.match(f.sent[0].data.title, /^New: Tmoodle:2/);
  assert.deepStrictEqual(Object.keys(f.sent[0]).sort(), ['data', 'token', 'webpush']); // data-only, no notification block
  // same sync again: nothing new
  await P.processSync(env, 'u1', result([rec('moodle:1'), rec('moodle:2')]), NOW + 2000, { notify: true, deps: { fetchFn: f.fn } });
  assert.strictEqual(f.sent.length, 1);
  assert.strictEqual((await P.loadEvents(env, 'u1')).length, 1);
});

test('in-app sync (notify=false) records the feed but sends nothing', async () => {
  const env = await setup(); const f = fakeFcm();
  await P.processSync(env, 'u1', result([rec('moodle:1')]), NOW, { notify: false });
  const ev = await P.processSync(env, 'u1', result([rec('moodle:1'), rec('moodle:2')]), NOW + 1, { notify: false });
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(f.sent.length, 0);
});

test('preferences filter, and quiet hours hold then batch', async () => {
  const env = await setup(); const f = fakeFcm();
  const p = await P.loadPush(env, 'u1');
  p.prefs = P.cleanPrefs({ moved: false, quiet: { on: true, start: 22, end: 8 } }, p.prefs);
  await P.savePush(env, 'u1', p);
  const night = Date.UTC(2026, 10, 17, 23, 0, 0);
  await P.processSync(env, 'u1', result([rec('moodle:1')]), night - 10, { notify: false });
  await P.processSync(env, 'u1', result([rec('moodle:1', { dueTs: sec + 9 * 86400 }), rec('moodle:2'), rec('moodle:3')]), night, { notify: true, deps: { fetchFn: f.fn } });
  assert.strictEqual(f.sent.length, 0); // quiet, and the moved event was filtered out
  assert.strictEqual((await P.loadPush(env, 'u1')).pending.length, 2);
  const morning = Date.UTC(2026, 10, 18, 9, 0, 0);
  await P.notifyUser(env, 'u1', [], (await (async () => { const s = await S.open(ENC, env.MOODLE_KV.m.get('snap:u1')); return s; })()), morning, { fetchFn: f.fn });
  assert.strictEqual(f.sent.length, 1);
  assert.match(f.sent[0].data.title, /2 updates/);
  assert.strictEqual((await P.loadPush(env, 'u1')).pending.length, 0);
});

test('due-soon reminder is sent once; dead tokens are dropped', async () => {
  const env = await setup();
  await P.registerToken(env, 'u1', { token: 'dead-token-bbbbbbbbbbbbbbbbbbbb' }, NOW);
  const f = fakeFcm({ dead: ['dead-token-bbbbbbbbbbbbbbbbbbbb'] });
  const snap = { v: 1, at: NOW, items: { 'moodle:9': { t: 'Lab', c: 'CSCI', k: 'a', d: sec + 1800, s: 'none' } } };
  await P.notifyUser(env, 'u1', [], snap, NOW, { fetchFn: f.fn });
  const dues = f.sent.filter((m) => /within the hour/.test(m.data.title));
  assert.strictEqual(dues.length, 2); // one per device
  assert.strictEqual((await P.loadPush(env, 'u1')).tokens.length, 1);
  const before = f.sent.length;
  await P.notifyUser(env, 'u1', [], snap, NOW + 60000, { fetchFn: f.fn });
  assert.strictEqual(f.sent.length, before);
});

test('runCron syncs stale users, skips recently synced, survives a failing user', async () => {
  const env = await setup();
  await P.registerToken(env, 'u2', { token: 'u2-token-cccccccccccccccccccc' }, NOW);
  await S.saveRecord(env, 'u1', { site: 's', token: 't', userid: 1, courses: [], selected: [], lastSyncAt: 0 });
  await S.saveRecord(env, 'u2', { site: 's', token: 't', userid: 2, courses: [], selected: [], lastSyncAt: 0 });
  const f = fakeFcm();
  const seen = [];
  const syncFn = async (site, tok, userid) => { seen.push(userid); if (userid === 1) throw new Error('boom'); return result([rec('moodle:1')]); };
  const r = await P.runCron(env, NOW, { fetchFn: f.fn, syncFn });
  assert.deepStrictEqual(seen.sort(), [1, 2]);
  assert.strictEqual(r.users, 1);
  // a second run right away does not sync again
  await P.runCron(env, NOW + 60000, { fetchFn: f.fn, syncFn });
  assert.strictEqual(seen.length, 2);
});

test('runCron stops when the subrequest budget is spent', async () => {
  const env = await setup();
  env.CRON_SUBREQUEST_BUDGET = '30'; env.SUBREQUEST_BUDGET = '20';
  for (const u of ['u1', 'u2', 'u3']) {
    await P.registerToken(env, u, { token: u + '-token-dddddddddddddddddddd' }, NOW);
    await S.saveRecord(env, u, { site: 's', token: 't', userid: u, courses: [], selected: [], lastSyncAt: 0 });
  }
  const seen = [];
  await P.runCron(env, NOW, { fetchFn: fakeFcm().fn, syncFn: async (s, t, uid) => { seen.push(uid); return result([]); } });
  assert.ok(seen.length >= 1 && seen.length < 3);
  // the user left over is served first next time
  const first = seen.slice();
  await P.runCron(env, NOW + 60000, { fetchFn: fakeFcm().fn, syncFn: async (s, t, uid) => { seen.push(uid); return result([]); } });
  assert.ok(!first.includes(seen[first.length]));
});

test('a failed test push says why: a refused key, a permission error, a bad payload keeps the device, a bad token drops it', async () => {
  const env = await setup();
  const mk = (tokenRes, sendRes) => async (url) => (String(url).startsWith('https://oauth2.googleapis.com/token') ? tokenRes() : sendRes());
  // 1. Google refuses the key
  F.resetFcmCache();
  let r = await P.sendTest(env, 'u1', NOW, { fetchFn: mk(() => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 }), () => null) });
  assert.strictEqual(r.sent, 0);
  assert.match(r.errors[0], /Google refused the push key \(invalid_grant: Invalid JWT Signature/);
  // 2. the key works but may not send (the role or the API is missing)
  F.resetFcmCache();
  r = await P.sendTest(env, 'u1', NOW, { fetchFn: mk(() => new Response(JSON.stringify({ access_token: 'oauth', expires_in: 3600 })), () => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Firebase Cloud Messaging API has not been used in project 1 before' } }), { status: 403 })) });
  assert.match(r.errors[0], /Google answered 403 PERMISSION_DENIED: Firebase Cloud Messaging API has not been used/);
  assert.strictEqual((await P.loadPush(env, 'u1')).tokens.length, 1, 'a permission error never forgets the device');
  // 3. a bad request that is not about the token keeps the device
  F.resetFcmCache();
  r = await P.sendTest(env, 'u1', NOW, { fetchFn: mk(() => new Response(JSON.stringify({ access_token: 'oauth', expires_in: 3600 })), () => new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received.' } }), { status: 400 })) });
  assert.match(r.errors[0], /400 INVALID_ARGUMENT/);
  assert.strictEqual((await P.loadPush(env, 'u1')).tokens.length, 1);
  // 4. a bad token drops it and says so
  F.resetFcmCache();
  r = await P.sendTest(env, 'u1', NOW, { fetchFn: mk(() => new Response(JSON.stringify({ access_token: 'oauth', expires_in: 3600 })), () => new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }), { status: 400 })) });
  assert.match(r.errors[0], /device forgotten/);
  assert.strictEqual((await P.loadPush(env, 'u1')).tokens.length, 0);
});

test('a successful test names the devices it went to, without exposing the user agent', async () => {
  const env = await setup();
  await P.registerToken(env, 'u1', { token: 'phone-token-bbbbbbbbbbbbbbbbbbbbbb', tz: 'UTC', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 Version/18 Safari/604.1' }, NOW + 1);
  await P.registerToken(env, 'u1', { token: 'win-token-cccccccccccccccccccccccc', tz: 'UTC', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' }, NOW + 2);
  const f = fakeFcm();
  const r = await P.sendTest(env, 'u1', NOW, { fetchFn: f.fn });
  assert.strictEqual(r.sent, 3);
  assert.deepStrictEqual(r.targets.slice(0, 2).sort(), ['Chrome on Windows', 'Safari on iPhone']);
  assert.ok(!JSON.stringify(r.targets).includes('Mozilla'));
  assert.strictEqual(P.deviceLabel(''), 'a device');
});
