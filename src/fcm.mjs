// fcm.mjs — send a push through Firebase Cloud Messaging (HTTP v1) from the Worker.
// The secret FCM_SERVICE_ACCOUNT is a service-account JSON; its private key signs a short-lived
// JWT that Google exchanges for an OAuth token. Messages are data-only, the shape sw.js displays.

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function b64url(bytes) {
  let bin = '';
  new Uint8Array(bytes).forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const enc = (s) => new TextEncoder().encode(s);

function pemToDer(pem) {
  const b64 = String(pem).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function parseServiceAccount(raw) {
  try {
    const sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (sa && sa.client_email && sa.private_key && sa.project_id) return sa;
  } catch (e) { /* fall through */ }
  return null;
}

export async function signJwt(sa, nowSec) {
  const header = b64url(enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(enc(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 })));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

let cached = null; // {email, token, exp} — reused within one Worker isolate
export function resetFcmCache() { cached = null; }

export async function accessToken(sa, fetchFn, nowMs) {
  if (cached && cached.email === sa.client_email && cached.exp > nowMs + 60000) return cached.token;
  const jwt = await signJwt(sa, Math.floor(nowMs / 1000));
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  if (!res.ok) {
    // Google says what is wrong ("invalid_grant", "Invalid JWT Signature", ...). Nothing secret is in it.
    let why = '';
    try { const e = await res.json(); why = [e.error, e.error_description].filter(Boolean).join(': '); } catch (e) { /* ignore */ }
    throw new Error('Google refused the push key' + (why ? ' (' + why.slice(0, 160) + ')' : ' (HTTP ' + res.status + ')'));
  }
  const j = await res.json();
  if (!j.access_token) throw new Error('Google refused the push key');
  cached = { email: sa.client_email, token: j.access_token, exp: nowMs + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

/**
 * Send one data-only message. Returns {ok:true} or {ok:false, dead:boolean}. `dead` means the token
 * will never work again and should be forgotten.
 */
export async function sendPush(sa, deviceToken, msg, { fetchFn = fetch, now = Date.now() } = {}) {
  const bearer = await accessToken(sa, fetchFn, now);
  const data = {
    title: String(msg.title || 'Taskplus').slice(0, 120),
    body: String(msg.body || '').slice(0, 240),
    icon: msg.icon || '/icons/icon-192.png',
    tag: msg.tag || 'taskplus',
    url: msg.url || '/',
  };
  const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { token: deviceToken, data, webpush: { headers: { Urgency: 'high', TTL: '86400' } } } }),
  });
  if (res.ok) return { ok: true };
  let status = '';
  let message = '';
  try { const e = (await res.json()).error || {}; status = e.status || ''; message = String(e.message || ''); } catch (e) { /* ignore */ }
  // A bad request can be a bad payload as well as a bad token: only forget the device when Google says the token is bad.
  const badToken = res.status === 404 || status === 'NOT_FOUND' || status === 'UNREGISTERED' || (res.status === 400 && /registration token|not a valid fcm/i.test(message));
  return { ok: false, dead: badToken, reason: `Google answered ${res.status}${status ? ' ' + status : ''}${message ? ': ' + message.slice(0, 160) : ''}` };
}
