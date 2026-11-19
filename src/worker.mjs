// worker.mjs — Cloudflare Worker entry. Serves the static app (via the ASSETS
// binding) and the /api/moodle/* endpoints that talk to a user's Moodle site.
//
// Bindings (see wrangler.toml): ASSETS, MOODLE_KV; secret TOKEN_ENC_KEY.
// Every /api call must carry a valid Firebase ID token; the Moodle token
// never leaves this Worker.

import { processSync, knownStates, loadEvents, loadPush, savePush, pushStatus, registerToken, unregisterToken, cleanPrefs, cleanTimeZone, sendTest, runCron } from './push.mjs';
import { parseServiceAccount } from './fcm.mjs';
import { verifyFirebaseIdToken, AuthError } from './auth.mjs';
import { MoodleError, normalizeSite, requestToken, getSiteInfo, getCourses, syncCourses } from './moodle-client.mjs';
import { pickDefaultCourses, courseCode } from './moodle-map.mjs';
import { loadRecord, saveRecord, deleteRecord } from './store.mjs';
import { callGemini, GEMINI_DEFAULT_MODEL } from './gemini.mjs';
import { DEFAULT_MODEL, sanitizeInput, cacheMaterial, sha256Hex, callModel } from './estimate.mjs';
import { fetchHandouts, isPdf, TRANSIENT } from './handouts.mjs';

const FIREBASE_PROJECT_ID = 'planner-88ab8';
const MIN_SYNC_INTERVAL_MS = 30 * 1000;
const MAX_BODY_BYTES = 8 * 1024;
const ESTIMATE_MAX_ITEMS = 5;
const ESTIMATE_BODY_BYTES = 64 * 1024; // descriptions are up to 3,000 characters each
const ESTIMATE_CACHE_TTL = 180 * 86400;
const ESTIMATE_USER_DAILY = 60;
const ESTIMATE_GLOBAL_DAILY = 300;
const ESTIMATE_FILE_DAILY = 20;        // requests per user per day that read handouts (PDFs cost far more than text)
const ESTIMATE_RETRY_TTL = 3600;       // an answer that missed a handout for a temporary reason is only kept an hour

// The Anthropic SDK is imported only when a request actually needs it, so the rest of the
// Worker (and its tests) never loads it. Tests pass their own fake client via deps.makeClient.
async function defaultMakeClient(env) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/**
 * Which service answers estimates: ESTIMATE_PROVIDER ('claude' | 'gemini') if set, else Claude when
 * ANTHROPIC_API_KEY exists, else Gemini when GEMINI_API_KEY exists. null = not set up.
 */
export function pickProvider(env) {
  const want = String(env.ESTIMATE_PROVIDER || '').toLowerCase();
  if (want === 'gemini') return env.GEMINI_API_KEY ? 'gemini' : null;
  if (want === 'claude' || want === 'anthropic') return env.ANTHROPIC_API_KEY ? 'claude' : null;
  if (env.ANTHROPIC_API_KEY) return 'claude';
  if (env.GEMINI_API_KEY) return 'gemini';
  return null;
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

function fail(code, message, status) {
  return json({ error: code, message }, status);
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const text = await request.text();
  if (text.length > maxBytes) throw new MoodleError('too_large', 'Request too large', 413);
  try { return text ? JSON.parse(text) : {}; } catch (e) { throw new MoodleError('bad_request', 'Invalid JSON', 400); }
}

function courseView(courses, selected) {
  const sel = new Set(selected || []);
  return (courses || []).map((c) => ({ id: c.id, code: courseCode(c.fullname), name: c.fullname, selected: sel.has(c.id) }));
}

function statusView(rec) {
  return {
    connected: true,
    site: new URL(rec.site).host,
    fullname: rec.fullname || '',
    courses: courseView(rec.courses, rec.selected),
    lastSyncAt: rec.lastSyncAt || null,
  };
}

export async function handleApi(request, env, deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const now = deps.now ? deps.now() : Date.now();
  const url = new URL(request.url);
  const route = url.pathname.replace(/\/+$/, '');

  const methods = {
    '/api/moodle/status': 'GET', '/api/moodle/connect': 'POST', '/api/moodle/courses': 'POST', '/api/moodle/sync': 'POST',
    '/api/moodle/disconnect': 'POST', '/api/estimate': 'POST',
    '/api/push/status': 'GET', '/api/push/events': 'GET', '/api/push/register': 'POST', '/api/push/unregister': 'POST',
    '/api/push/prefs': 'POST', '/api/push/test': 'POST',
  };
  const wantMethod = methods[route];
  if (!wantMethod) return fail('not_found', 'Unknown endpoint', 404);
  if (request.method !== wantMethod) return fail('method_not_allowed', 'Use ' + wantMethod, 405);

  if (!env.MOODLE_KV || !env.TOKEN_ENC_KEY) return fail('not_configured', 'The server is not set up for Moodle yet', 503);
  if (route === '/api/estimate' && !pickProvider(env)) return fail('not_configured', 'Estimates are not set up on the server yet', 503);

  let uid;
  try {
    const auth = request.headers.get('authorization') || '';
    const m = /^Bearer (.+)$/.exec(auth);
    ({ uid } = await verifyFirebaseIdToken(m ? m[1] : '', { projectId: env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID, fetchFn, now }));
  } catch (e) {
    if (e instanceof AuthError) return fail('unauthorized', 'Sign in to Taskplus first', 401);
    throw e;
  }

  // Optional allowlist: ALLOWED_UIDS="uid1,uid2" limits who can spend the API budget.
  if (route === '/api/estimate' && env.ALLOWED_UIDS) {
    const allowed = String(env.ALLOWED_UIDS).split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(uid)) return fail('not_allowed', 'This account cannot use Claude estimates', 403);
  }

  try {
    if (route === '/api/estimate') {
      // Tied to a real Moodle connection, so a stray Google sign-in cannot spend the budget.
      const rec = await loadRecord(env, uid);
      if (!rec) return fail('not_connected', 'Connect Moodle first', 409);
      const body = await readJson(request, ESTIMATE_BODY_BYTES);
      const list = Array.isArray(body.items) ? body.items.slice(0, ESTIMATE_MAX_ITEMS) : null;
      if (!list || !list.length) throw new MoodleError('bad_request', 'items must be a non-empty list', 400);
      return json(await estimateItems(env, uid, list, { fresh: body.fresh === true, readFiles: body.readFiles === true, rec, now, deps }));
    }

    if (route.startsWith('/api/push/')) return await pushRoute(route, request, env, uid, now, deps);

    if (route === '/api/moodle/status') {
      const rec = await loadRecord(env, uid);
      return json(rec ? statusView(rec) : { connected: false });
    }

    if (route === '/api/moodle/disconnect') {
      await deleteRecord(env, uid);
      // The snapshot and feed hold assignment titles from the school: forget them with the connection.
      await env.MOODLE_KV.delete('snap:' + uid);
      await env.MOODLE_KV.delete('evt:' + uid);
      return json({ ok: true });
    }

    const body = await readJson(request);

    if (route === '/api/moodle/connect') {
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!username || !password || username.length > 256 || password.length > 256) {
        throw new MoodleError('bad_request', 'Enter your username and password');
      }
      const base = normalizeSite(body.site);
      const token = await requestToken(base, username, password, fetchFn);
      const info = await getSiteInfo(base, token, fetchFn);
      const courses = await getCourses(base, token, info.userid, fetchFn);
      const rec = {
        site: base, token, userid: info.userid, fullname: info.fullname,
        courses: courses.map((c) => ({ id: c.id, fullname: c.fullname })),
        selected: pickDefaultCourses(courses, Math.floor(now / 1000)),
        createdAt: now, lastSyncAt: null,
      };
      await saveRecord(env, uid, rec);
      return json(statusView(rec));
    }

    const rec = await loadRecord(env, uid);
    if (!rec) return fail('not_connected', 'Connect Moodle first', 409);

    if (route === '/api/moodle/courses') {
      const valid = new Set(rec.courses.map((c) => c.id));
      const selected = Array.isArray(body.selected) ? body.selected.filter((id) => valid.has(id)) : null;
      if (!selected) throw new MoodleError('bad_request', 'selected must be a list of course ids');
      rec.selected = selected;
      await saveRecord(env, uid, rec);
      return json(statusView(rec));
    }

    if (route === '/api/moodle/sync') {
      if (rec.lastSyncAt && now - rec.lastSyncAt < MIN_SYNC_INTERVAL_MS) {
        return json({ error: 'too_soon', message: 'Synced a moment ago', retryAfterSec: Math.ceil((MIN_SYNC_INTERVAL_MS - (now - rec.lastSyncAt)) / 1000) }, 429);
      }
      // Stamp first so a crash or repeated taps can't hammer the school's server.
      rec.lastSyncAt = now;
      await saveRecord(env, uid, rec);
      const budget = Number(env.SUBREQUEST_BUDGET) > 0 ? Number(env.SUBREQUEST_BUDGET) : 40;
      let result;
      try {
        result = await syncCourses(rec.site, rec.token, rec.userid, rec.selected, { fetchFn, nowSec: Math.floor(now / 1000), budget, known: await knownStates(env, uid) });
      } catch (e) {
        if (e instanceof MoodleError && e.code === 'moodle_auth') await deleteRecord(env, uid);
        throw e;
      }
      rec.courses = result.courses.map((c) => ({ id: c.id, fullname: c.fullname }));
      await saveRecord(env, uid, rec);
      // Events go to the feed, not to a push: the user is looking at the app right now.
      let events = [];
      try { events = await processSync(env, uid, result, now, { notify: false, deps }); } catch (e) { /* alerts must never break a sync */ }
      return json({ records: result.records, warnings: result.warnings, syncedAt: now, courses: courseView(rec.courses, rec.selected), events });
    }

    return fail('not_found', 'Unknown endpoint', 404);
  } catch (e) {
    if (e instanceof MoodleError) return fail(e.code, e.message, e.status);
    return fail('server_error', 'Something went wrong', 500);
  }
}

const TEST_PUSH_INTERVAL_MS = 30000;

async function pushRoute(route, request, env, uid, now, deps) {
  if (route === '/api/push/events') return json({ events: await loadEvents(env, uid) });
  if (route === '/api/push/status') return json(pushStatus(await loadPush(env, uid), env));
  const body = route === '/api/push/unregister' || route === '/api/push/test' ? await readJson(request).catch(() => ({})) : await readJson(request);
  if (route === '/api/push/register') {
    const p = await registerToken(env, uid, { token: body.token, tz: body.timeZone, userAgent: body.userAgent }, now);
    return json(pushStatus(p, env));
  }
  if (route === '/api/push/unregister') {
    await unregisterToken(env, uid, typeof body.token === 'string' ? body.token : null);
    return json({ ok: true });
  }
  if (route === '/api/push/prefs') {
    const p = await loadPush(env, uid);
    p.prefs = cleanPrefs(body, p.prefs);
    if (body.timeZone) p.tz = cleanTimeZone(body.timeZone);
    await savePush(env, uid, p);
    return json(pushStatus(p, env));
  }
  // test
  const p = await loadPush(env, uid);
  if (!parseServiceAccount(env.FCM_SERVICE_ACCOUNT)) return fail('not_configured', 'Push is not set up on the server yet', 503);
  if (!p.tokens.length) return fail('no_device', 'This device is not registered for alerts', 409);
  if (p.lastTest && now - p.lastTest < TEST_PUSH_INTERVAL_MS) return fail('too_soon', 'Wait a moment before another test', 429);
  p.lastTest = now;
  await savePush(env, uid, p);
  const r = await sendTest(env, uid, now, deps);
  return json({ sent: r.sent });
}

/**
 * One estimate per item: from this user's cache if the inputs are unchanged (a re-sync never
 * re-bills), otherwise one model call, counted against a per-user and an overall daily limit.
 * A failure for one item never fails the others.
 */
async function estimateItems(env, uid, list, { fresh, readFiles, rec, now, deps }) {
  const provider = pickProvider(env);
  const model = env.ESTIMATE_MODEL || (provider === 'gemini' ? GEMINI_DEFAULT_MODEL : DEFAULT_MODEL);
  const fallbacks = String(env.ESTIMATE_FALLBACKS || 'on').toLowerCase() !== 'off';
  const day = new Date(now).toISOString().slice(0, 10);
  const userLimit = Number(env.ESTIMATE_DAILY_LIMIT) > 0 ? Number(env.ESTIMATE_DAILY_LIMIT) : ESTIMATE_USER_DAILY;
  const globalLimit = Number(env.ESTIMATE_GLOBAL_DAILY_LIMIT) > 0 ? Number(env.ESTIMATE_GLOBAL_DAILY_LIMIT) : ESTIMATE_GLOBAL_DAILY;
  const userKey = `estn:${uid}:${day}`;
  const globalKey = `estn:all:${day}`;
  const fileKey = `estf:${uid}:${day}`;
  const fileLimit = Number(env.ESTIMATE_FILE_DAILY_LIMIT) > 0 ? Number(env.ESTIMATE_FILE_DAILY_LIMIT) : ESTIMATE_FILE_DAILY;
  const filesAllowed = readFiles && String(env.ESTIMATE_READ_FILES || 'on').toLowerCase() !== 'off';
  const results = [];
  let client = null;

  for (const raw of list) {
    const input = sanitizeInput(raw);
    if (!input) { results.push({ id: String((raw && raw.id) || ''), ok: false, error: 'bad_input' }); continue; }
    const wantFiles = filesAllowed && input.attachments.some(isPdf);
    const cacheKey = `est:${uid}:${await sha256Hex(cacheMaterial(input, model, wantFiles))}`;

    if (!fresh) {
      const hit = await env.MOODLE_KV.get(cacheKey);
      if (hit) {
        try { results.push({ id: input.id, ok: true, estimate: JSON.parse(hit), cached: true }); continue; } catch (e) { /* fall through and re-ask */ }
      }
    }

    const userCount = Number(await env.MOODLE_KV.get(userKey)) || 0;
    const globalCount = Number(await env.MOODLE_KV.get(globalKey)) || 0;
    if (userCount >= userLimit || globalCount >= globalLimit) { results.push({ id: input.id, ok: false, error: 'daily_limit' }); continue; }
    await env.MOODLE_KV.put(userKey, String(userCount + 1), { expirationTtl: 172800 });
    await env.MOODLE_KV.put(globalKey, String(globalCount + 1), { expirationTtl: 172800 });

    if (provider !== 'gemini') {
      try {
        client = client || await (deps.makeClient || defaultMakeClient)(env);
      } catch (e) {
        console.error('estimate: could not create the model client');
        results.push({ id: input.id, ok: false, error: 'server_misconfigured' });
        break;
      }
    }
    // Handouts: downloaded from the user's own Moodle with their token, only when asked for and under a daily cap.
    let docs = [];
    let skipped = [];
    if (wantFiles) {
      const used = Number(await env.MOODLE_KV.get(fileKey)) || 0;
      if (used >= fileLimit) {
        skipped = input.attachments.filter(isPdf).map((a) => ({ name: a.name, reason: 'file_limit' }));
      } else {
        await env.MOODLE_KV.put(fileKey, String(used + 1), { expirationTtl: 172800 });
        ({ docs, skipped } = await fetchHandouts(input.attachments, { site: rec.site, token: rec.token, fetchFn: deps.fetchFn || fetch }));
      }
    }

    const r = provider === 'gemini'
      ? await callGemini(input, { apiKey: env.GEMINI_API_KEY, model, documents: docs, fetchFn: deps.geminiFetch || fetch })
      : await callModel(client, input, { model, fallbacks, documents: docs });
    if (!r.ok) {
      results.push({ id: input.id, ok: false, error: r.error });
      if (r.error === 'server_misconfigured') break; // the key is wrong: every other item would fail too
      continue;
    }
    // Which files were read is the SERVER's report, not the model's. `retry` marks a miss that may be temporary.
    const retry = skipped.some((s) => TRANSIENT.has(s.reason) || s.reason === 'file_limit');
    const estimate = { ...r.estimate, pastCount: (input.past || []).length, provider: provider === 'gemini' ? 'gemini' : 'claude', files: { read: docs.map((d) => d.name), skipped, retry } };
    await env.MOODLE_KV.put(cacheKey, JSON.stringify(estimate), { expirationTtl: retry ? ESTIMATE_RETRY_TTL : ESTIMATE_CACHE_TTL });
    results.push({ id: input.id, ok: true, estimate, cached: false });
  }
  return { results, model };
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return handleApi(request, env, {});
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env, Date.now(), {}));
  },
};
