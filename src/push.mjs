// push.mjs — change detection, the "What's new" feed, and push delivery, per user.
//
// KV keys (all sealed with TOKEN_ENC_KEY, they hold assignment titles):
//   push:<uid>  tokens, prefs, pending (held by quiet hours), reminders already sent
//   snap:<uid>  the last snapshot of Moodle (events.mjs)
//   evt:<uid>   the most recent events, newest first, for the in-app feed
import { seal, open, loadRecord, saveRecord, deleteRecord } from './store.mjs';
import { buildSnapshot, diffSnapshots, composePush, dueSoon, describeReminder, pruneReminders, isQuiet } from './events.mjs';
import { parseServiceAccount, sendPush } from './fcm.mjs';
import { syncCourses, MoodleError } from './moodle-client.mjs';

export const MAX_TOKENS = 5;
export const MAX_EVENTS = 50;
export const CRON_SYNC_EVERY_MS = 3 * 3600 * 1000;
export const DEFAULT_PREFS = { new: true, moved: true, due: true, quiet: { on: false, start: 22, end: 8 } };

const key = (kind, uid) => `${kind}:${uid}`;
async function load(env, kind, uid) {
  const s = await env.MOODLE_KV.get(key(kind, uid));
  return s ? open(env.TOKEN_ENC_KEY, s) : null;
}
async function save(env, kind, uid, obj) { await env.MOODLE_KV.put(key(kind, uid), await seal(env.TOKEN_ENC_KEY, obj)); }

/** What the last sync saw for each item: {id: 'submitted'|'draft'|'none'}. Lets a sync skip finished work. */
export async function knownStates(env, uid) {
  const snap = await load(env, 'snap', uid);
  const out = {};
  Object.entries((snap && snap.items) || {}).forEach(([id, it]) => { if (it && it.s) out[id] = it.s; });
  return out;
}

export async function loadPush(env, uid) {
  const p = await load(env, 'push', uid);
  return { tokens: [], prefs: DEFAULT_PREFS, pending: [], reminders: [], tz: 'UTC', lastCron: 0, ...(p || {}) };
}
export const savePush = (env, uid, p) => save(env, 'push', uid, p);

export function cleanPrefs(input, old) {
  const base = { ...DEFAULT_PREFS, ...(old || {}) };
  const out = { ...base, quiet: { ...base.quiet } };
  if (input && typeof input === 'object') {
    ['new', 'moved', 'due'].forEach((k) => { if (typeof input[k] === 'boolean') out[k] = input[k]; });
    const q = input.quiet;
    if (q && typeof q === 'object') {
      if (typeof q.on === 'boolean') out.quiet.on = q.on;
      const hr = (v) => Number.isInteger(v) && v >= 0 && v <= 23;
      if (hr(q.start)) out.quiet.start = q.start;
      if (hr(q.end)) out.quiet.end = q.end;
    }
  }
  return out;
}

export function cleanTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return String(tz); } catch (e) { return 'UTC'; }
}

export async function registerToken(env, uid, { token, tz, userAgent }, now) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 400) throw new MoodleError('bad_request', 'Invalid push token');
  const p = await loadPush(env, uid);
  p.tokens = p.tokens.filter((t) => t.t !== token);
  p.tokens.unshift({ t: token, at: now, ua: String(userAgent || '').slice(0, 120) });
  p.tokens = p.tokens.slice(0, MAX_TOKENS);
  if (tz) p.tz = cleanTimeZone(tz);
  await savePush(env, uid, p);
  return p;
}

export async function unregisterToken(env, uid, token) {
  const p = await loadPush(env, uid);
  p.tokens = token ? p.tokens.filter((t) => t.t !== token) : [];
  await savePush(env, uid, p);
}

export function pushStatus(p, env) {
  return { configured: !!parseServiceAccount(env.FCM_SERVICE_ACCOUNT), devices: p.tokens.length, prefs: p.prefs, tz: p.tz };
}

/* ---------------- feed ---------------- */

export async function loadEvents(env, uid) { return (await load(env, 'evt', uid)) || []; }

async function addEvents(env, uid, events, now) {
  if (!events.length) return;
  const list = await loadEvents(env, uid);
  const seen = new Set(list.map((e) => e.id));
  const fresh = events.filter((e) => !seen.has(e.id)).map((e) => ({ ...e, at: now }));
  if (!fresh.length) return;
  await save(env, 'evt', uid, fresh.concat(list).slice(0, MAX_EVENTS));
}

/* ---------------- delivery ---------------- */

async function deliver(env, uid, p, msg, deps, now) {
  const sa = parseServiceAccount(env.FCM_SERVICE_ACCOUNT);
  if (!sa || !p.tokens.length) return { sent: 0, errors: [] };
  let sent = 0;
  const alive = [];
  const errors = [];
  for (const t of p.tokens) {
    try {
      const r = await sendPush(sa, t.t, msg, { fetchFn: deps.fetchFn || fetch, now });
      if (r.ok) sent++;
      else if (r.reason) errors.push(r.dead ? r.reason + ' (device forgotten, enable alerts again)' : r.reason);
      if (r.ok || !r.dead) alive.push(t);
    } catch (e) { alive.push(t); errors.push(String((e && e.message) || 'push failed').slice(0, 200)); }
  }
  p.tokens = alive;
  return { sent, errors };
}

const PREF_OF = { new: 'new', moved: 'moved' };

/**
 * Record what a sync found and (when `notify`) push it. A user's own in-app sync passes notify=false:
 * they are looking at the app, and the events still land in the feed. Returns the events found.
 */
export async function processSync(env, uid, result, now, { notify, deps = {} } = {}) {
  const prev = await load(env, 'snap', uid);
  const next = buildSnapshot(result.records, prev, now);
  const events = diffSnapshots(prev, next, now);
  await save(env, 'snap', uid, next);
  await addEvents(env, uid, events, now);
  if (notify) await notifyUser(env, uid, events, next, now, deps);
  return events;
}

/** Push events (those the user wants), plus any held back earlier, plus due-soon reminders. */
export async function notifyUser(env, uid, events, snapshot, now, deps = {}) {
  const p = await loadPush(env, uid);
  if (!p.tokens.length) return { sent: 0 };
  const wanted = events.filter((e) => p.prefs[PREF_OF[e.kind]]);
  p.pending = p.pending.concat(wanted).slice(-MAX_EVENTS);
  const reminders = p.prefs.due ? dueSoon(snapshot, now, p.reminders) : [];
  const quiet = isQuiet(now, p.tz, p.prefs.quiet);
  let sent = 0;
  if (!quiet) {
    // An urgent reminder is allowed to interrupt nothing: it only goes out outside quiet hours too.
    if (p.pending.length) {
      sent += (await deliver(env, uid, p, composePush(p.pending, p.tz), deps, now)).sent;
      p.pending = [];
    }
    for (const r of reminders) {
      const m = describeReminder(r, p.tz);
      sent += (await deliver(env, uid, p, m, deps, now)).sent;
      p.reminders.push(r.key, ...r.skip);
    }
  }
  p.reminders = pruneReminders(p.reminders, now);
  await savePush(env, uid, p);
  return { sent };
}

export async function sendTest(env, uid, now, deps = {}) {
  const p = await loadPush(env, uid);
  const r = await deliver(env, uid, p, { title: 'Taskplus alerts are on', body: 'This is a test notification.', tag: 'taskplus-test' }, deps, now);
  await savePush(env, uid, p);
  return r;
}

/* ---------------- cron ---------------- */

/**
 * Runs every 30 minutes. Cloudflare allows few outgoing requests per invocation, so users are
 * handled least-recently-served first until the budget is spent; anyone left over goes first next time.
 */
export async function runCron(env, now, deps = {}) {
  if (!env.MOODLE_KV || !env.TOKEN_ENC_KEY) return { users: 0 };
  const fetchFn = deps.fetchFn || fetch;
  let budget = Number(env.CRON_SUBREQUEST_BUDGET) > 0 ? Number(env.CRON_SUBREQUEST_BUDGET) : 45;
  const listed = await env.MOODLE_KV.list({ prefix: 'push:', limit: 200 });
  const users = [];
  for (const k of listed.keys) {
    const uid = k.name.slice('push:'.length);
    const p = await loadPush(env, uid);
    if (p.tokens.length) users.push({ uid, p });
  }
  users.sort((a, b) => a.p.lastCron - b.p.lastCron);
  let done = 0;
  for (const { uid, p } of users) {
    if (budget < 12) break;
    try {
      const rec = await loadRecord(env, uid);
      const reserve = 4 + p.tokens.length * 2;
      if (rec && now - (rec.lastSyncAt || 0) >= CRON_SYNC_EVERY_MS && budget - reserve >= 12) {
        const per = Math.min(Number(env.SUBREQUEST_BUDGET) > 0 ? Number(env.SUBREQUEST_BUDGET) : 40, budget - reserve);
        rec.lastSyncAt = now;
        await saveRecord(env, uid, rec);
        let result;
        try {
          result = await (deps.syncFn || syncCourses)(rec.site, rec.token, rec.userid, rec.selected, { fetchFn, nowSec: Math.floor(now / 1000), budget: per, known: await knownStates(env, uid) });
        } catch (e) {
          if (e instanceof MoodleError && e.code === 'moodle_auth') await deleteRecord(env, uid);
          throw e;
        }
        budget -= per;
        rec.courses = result.courses.map((c) => ({ id: c.id, fullname: c.fullname }));
        await saveRecord(env, uid, rec);
        await processSync(env, uid, result, now, { notify: true, deps });
      } else if (rec) {
        const snap = await load(env, 'snap', uid);
        if (snap) await notifyUser(env, uid, [], snap, now, deps);
      }
      budget -= reserve;
      const fresh = await loadPush(env, uid);
      fresh.lastCron = now;
      await savePush(env, uid, fresh);
      done++;
    } catch (e) { /* one user's failure must not stop the rest */ }
  }
  return { users: done };
}
