// auth.mjs — verifies a Firebase Auth ID token (RS256 JWT) inside a Worker, so
// every API call is tied to a signed-in Taskplus user without any server secret.

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const JWKS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SEC = 300;

let jwksCache = { at: 0, keys: null };

export class AuthError extends Error {}

function b64urlToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parseJsonPart(part) {
  try { return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))); } catch (e) { throw new AuthError('malformed token'); }
}

async function getJwks(fetchFn, now) {
  if (jwksCache.keys && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchFn(JWKS_URL);
  if (!res.ok) throw new AuthError('could not load signing keys');
  const body = await res.json();
  jwksCache = { at: now, keys: body.keys || [] };
  return jwksCache.keys;
}

/** For tests: forget cached signing keys. */
export function resetJwksCache() {
  jwksCache = { at: 0, keys: null };
}

/** Returns {uid} for a valid token, otherwise throws AuthError. */
export async function verifyFirebaseIdToken(token, { projectId, fetchFn = fetch, now = Date.now() } = {}) {
  if (typeof token !== 'string') throw new AuthError('missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('malformed token');
  const header = parseJsonPart(parts[0]);
  const payload = parseJsonPart(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new AuthError('unsupported token');

  const keys = await getJwks(fetchFn, now);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]),
  );
  if (!ok) throw new AuthError('bad signature');

  const nowSec = Math.floor(now / 1000);
  if (!(payload.exp > nowSec)) throw new AuthError('token expired');
  if (typeof payload.iat === 'number' && payload.iat > nowSec + CLOCK_SKEW_SEC) throw new AuthError('token from the future');
  if (payload.aud !== projectId) throw new AuthError('wrong audience');
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) throw new AuthError('wrong issuer');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new AuthError('no subject');
  return { uid: payload.sub };
}
