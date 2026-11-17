// moodle-client.mjs — talks to a Moodle site's web-service API.
// Every network call takes an injectable fetch so tests never hit a real site.

import { mapAssignments, mapQuizzes, submissionState } from './moodle-map.mjs';

export class MoodleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 20000;
const STATE_WINDOW_SEC = 14 * 86400; // only check submission state for items due within the last 14 days or later
const STATE_CONCURRENCY = 4;

/**
 * Turns whatever the user typed ("moodle.school.edu", "https://school.edu/moodle/")
 * into a clean https base URL, or throws. This is the only place a user-supplied
 * host enters the system, so it is deliberately strict: https only, a real
 * hostname (no IPs, no localhost, no internal suffixes), no credentials or odd ports.
 */
export function normalizeSite(input) {
  let raw = String(input == null ? '' : input).trim();
  if (!raw || raw.length > 200) throw new MoodleError('bad_site', 'Enter your Moodle address, like moodle.yourschool.edu');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch (e) { throw new MoodleError('bad_site', 'That does not look like a web address'); }
  if (u.protocol !== 'https:') throw new MoodleError('bad_site', 'Moodle must be reached over https');
  if (u.username || u.password) throw new MoodleError('bad_site', 'Do not put a username or password in the address');
  if (u.port && u.port !== '443') throw new MoodleError('bad_site', 'Custom ports are not supported');
  const host = u.hostname.toLowerCase();
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
  const internal = host === 'localhost' || /\.(local|localhost|internal|lan|home|corp)$/.test(host);
  if (isIp || internal || !host.includes('.')) throw new MoodleError('bad_site', 'Use your school\'s Moodle web address');
  const path = u.pathname.replace(/\/+$/, '');
  return 'https://' + host + path;
}

function flatten(params) {
  const out = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x, i) => out.append(`${k}[${i}]`, String(x)));
    else if (v !== undefined && v !== null) out.append(k, String(v));
  });
  return out;
}

async function postForm(url, body, fetchFn) {
  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new MoodleError('moodle_unreachable', 'Could not reach Moodle', 502);
  }
  let json;
  try { json = await res.json(); } catch (e) {
    throw new MoodleError('bad_site', 'That address did not answer like a Moodle site');
  }
  return json;
}

/** Exchanges username + password for a web-service token (the password is never stored or logged). */
export async function requestToken(base, username, password, fetchFn = fetch) {
  const body = flatten({ username, password, service: 'moodle_mobile_app' });
  const out = await postForm(base + '/login/token.php', body, fetchFn);
  if (out && typeof out.token === 'string' && out.token) return out.token;
  const code = out && out.errorcode;
  if (code === 'invalidlogin') throw new MoodleError('bad_credentials', 'Moodle did not accept that username or password', 401);
  if (code === 'servicenotavailable' || code === 'enablewsdescription') {
    throw new MoodleError('service_unavailable', 'This Moodle site does not allow mobile app access', 403);
  }
  throw new MoodleError('bad_credentials', 'Could not sign in to Moodle', 401);
}

/** One web-service call. Invalid or expired tokens become a distinct `moodle_auth` error. */
export async function wsCall(base, token, fn, params = {}, fetchFn = fetch) {
  const body = flatten({ ...params, wstoken: token, wsfunction: fn, moodlewsrestformat: 'json' });
  const out = await postForm(base + '/webservice/rest/server.php', body, fetchFn);
  if (out && typeof out === 'object' && !Array.isArray(out) && out.exception) {
    if (out.errorcode === 'invalidtoken' || out.errorcode === 'accessexception') {
      throw new MoodleError('moodle_auth', 'Moodle sign-in expired. Connect again.', 401);
    }
    throw new MoodleError('moodle_error', 'Moodle returned an error (' + (out.errorcode || 'unknown') + ')', 502);
  }
  return out;
}

export async function getSiteInfo(base, token, fetchFn) {
  const info = await wsCall(base, token, 'core_webservice_get_site_info', {}, fetchFn);
  return { userid: info.userid, fullname: info.fullname || info.username || '', sitename: info.sitename || '' };
}

export async function getCourses(base, token, userid, fetchFn) {
  const list = await wsCall(base, token, 'core_enrol_get_users_courses', { userid }, fetchFn);
  return (Array.isArray(list) ? list : []).map((c) => ({
    id: c.id, fullname: c.fullname || c.shortname || '', startdate: c.startdate || 0, enddate: c.enddate || 0, visible: c.visible,
  }));
}

async function pool(items, size, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

/**
 * Fetches assignments + quizzes for the selected courses and their submission
 * state. `budget` caps total Moodle calls for the request (Workers limit the
 * number of outgoing requests per invocation); items beyond it come back with
 * `state: null` and a warning, and the next sync tries again.
 */
export async function syncCourses(base, token, userid, courseIds, opts = {}) {
  const { fetchFn = fetch, nowSec = Math.floor(Date.now() / 1000), budget = 40 } = opts;
  const warnings = [];
  let used = 0;

  const courses = await getCourses(base, token, userid, fetchFn); used++;
  const wanted = courses.filter((c) => courseIds.includes(c.id));
  if (!wanted.length) return { records: [], warnings: ['no_courses_selected'], courses };

  const ids = wanted.map((c) => c.id);
  const assignResp = await wsCall(base, token, 'mod_assign_get_assignments', { courseids: ids }, fetchFn); used++;
  const quizResp = await wsCall(base, token, 'mod_quiz_get_quizzes_by_courses', { courseids: ids }, fetchFn); used++;

  const records = [];
  let skippedNoDue = 0;
  wanted.forEach((c) => {
    const a = mapAssignments(c, { courses: ((assignResp && assignResp.courses) || []).filter((x) => x.id === c.id) }, base);
    const q = mapQuizzes(c, { quizzes: ((quizResp && quizResp.quizzes) || []).filter((x) => x.course === c.id) }, base);
    records.push(...a.records, ...q.records);
    skippedNoDue += a.skippedNoDue + q.skippedNoDue;
  });
  if (skippedNoDue) warnings.push('skipped_no_due_date:' + skippedNoDue);

  const candidates = records
    .filter((r) => r.dueTs >= nowSec - STATE_WINDOW_SEC)
    .sort((a, b) => a.dueTs - b.dueTs);
  const allowed = Math.max(0, budget - used);
  const checked = candidates.slice(0, allowed);
  if (candidates.length > checked.length) warnings.push('state_skipped:' + (candidates.length - checked.length));

  await pool(checked, STATE_CONCURRENCY, async (r) => {
    try {
      const resp = r.kind === 'assign'
        ? await wsCall(base, token, 'mod_assign_get_submission_status', { assignid: r.instanceId, userid }, fetchFn)
        : await wsCall(base, token, 'mod_quiz_get_user_attempts', { quizid: r.instanceId, userid, status: 'all' }, fetchFn);
      r.state = submissionState(r.kind, resp);
    } catch (e) {
      if (e instanceof MoodleError && e.code === 'moodle_auth') throw e;
      warnings.push('state_failed:' + r.cmid);
    }
  });

  return { records, warnings, courses };
}
