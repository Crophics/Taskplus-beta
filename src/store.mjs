// store.mjs — per-user Moodle connection records, encrypted at rest in KV.
// The record holds the Moodle web-service token (never the password).

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

async function importAesKey(keyB64) {
  let raw;
  try { raw = b64ToBytes(String(keyB64 || '')); } catch (e) { raw = new Uint8Array(0); }
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes, base64 encoded');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function seal(keyB64, obj) {
  const key = await importAesKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return 'v1.' + bytesToB64(iv) + '.' + bytesToB64(ct);
}

/** Returns the stored object, or null if it cannot be decrypted (wrong key, corrupt, unknown version). */
export async function open(keyB64, sealed) {
  try {
    const [ver, ivB64, ctB64] = String(sealed || '').split('.');
    if (ver !== 'v1') return null;
    const key = await importAesKey(keyB64);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB64) }, key, b64ToBytes(ctB64));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (e) {
    return null;
  }
}

export const recordKey = (uid) => 'moodle:' + uid;

export async function loadRecord(env, uid) {
  const sealed = await env.MOODLE_KV.get(recordKey(uid));
  return sealed ? open(env.TOKEN_ENC_KEY, sealed) : null;
}

export async function saveRecord(env, uid, record) {
  await env.MOODLE_KV.put(recordKey(uid), await seal(env.TOKEN_ENC_KEY, record));
}

export async function deleteRecord(env, uid) {
  await env.MOODLE_KV.delete(recordKey(uid));
}
