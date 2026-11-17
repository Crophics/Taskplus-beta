// worker.mjs — Cloudflare Worker entry. Serves the static app (via the ASSETS
// binding) and the /api/moodle/* endpoints that talk to a user's Moodle site.
//
// Bindings (see wrangler.toml): ASSETS, MOODLE_KV; secret TOKEN_ENC_KEY.
// Every /api call must carry a valid Firebase ID token; the Moodle token
// never leaves this Worker.

import { verifyFirebaseIdToken, AuthError } from './auth.mjs';
import { MoodleError, normalizeSite, requestToken, getSiteInfo, getCourses, syncCourses } from './moodle-client.mjs';
import { pickDefaultCourses, courseCode } from './moodle-map.mjs';
import { loadRecord, saveRecord, deleteRecord } from './store.mjs';

const FIREBASE_PROJECT_ID = 'planner-88ab8';
const MIN_SYNC_INTERVAL_MS = 30 * 1000;
const MAX_BODY_BYTES = 8 * 1024;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

function fail(code, message, status) {
  return json({ error: code, message }, status);
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new MoodleError('too_large', 'Request too large', 413);
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

  const known = ['/api/moodle/status', '/api/moodle/connect', '/api/moodle/courses', '/api/moodle/sync', '/api/moodle/disconnect'];
  if (!known.includes(route)) return fail('not_found', 'Unknown endpoint', 404);
  const wantMethod = route === '/api/moodle/status' ? 'GET' : 'POST';
  if (request.method !== wantMethod) return fail('method_not_allowed', 'Use ' + wantMethod, 405);

  if (!env.MOODLE_KV || !env.TOKEN_ENC_KEY) return fail('not_configured', 'The server is not set up for Moodle yet', 503);

  let uid;
  try {
    const auth = request.headers.get('authorization') || '';
    const m = /^Bearer (.+)$/.exec(auth);
    ({ uid } = await verifyFirebaseIdToken(m ? m[1] : '', { projectId: env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID, fetchFn, now }));
  } catch (e) {
    if (e instanceof AuthError) return fail('unauthorized', 'Sign in to Taskplus first', 401);
    throw e;
  }

  try {
    if (route === '/api/moodle/status') {
      const rec = await loadRecord(env, uid);
      return json(rec ? statusView(rec) : { connected: false });
    }

    if (route === '/api/moodle/disconnect') {
      await deleteRecord(env, uid);
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
        result = await syncCourses(rec.site, rec.token, rec.userid, rec.selected, { fetchFn, nowSec: Math.floor(now / 1000), budget });
      } catch (e) {
        if (e instanceof MoodleError && e.code === 'moodle_auth') await deleteRecord(env, uid);
        throw e;
      }
      rec.courses = result.courses.map((c) => ({ id: c.id, fullname: c.fullname }));
      await saveRecord(env, uid, rec);
      return json({ records: result.records, grades: result.grades, warnings: result.warnings, syncedAt: now, courses: courseView(rec.courses, rec.selected) });
    }

    return fail('not_found', 'Unknown endpoint', 404);
  } catch (e) {
    if (e instanceof MoodleError) return fail(e.code, e.message, e.status);
    return fail('server_error', 'Something went wrong', 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return handleApi(request, env, {});
    return env.ASSETS.fetch(request);
  },
};
