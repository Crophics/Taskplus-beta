// handouts.mjs — downloads an assignment's attached PDFs from the user's Moodle so Claude can read them.
//
// This is the one place a URL that came from the browser meets the user's stored Moodle token, so it is
// strict about it: the URL must be on the SAME site the user connected (never another host), must be a
// Moodle web-service file path, is fetched with redirects refused (a redirect could point anywhere), and
// must come back as a real PDF under a size cap. Anything else is skipped with a reason; a skipped file
// never fails the estimate, it just means Claude works from the description alone.

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // one PDF
export const MAX_FILES = 2;                    // per assignment
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

// Reasons that are probably temporary: the answer should not be remembered as "this file is unreadable".
export const TRANSIENT = new Set(['unavailable', 'redirected']);

export function isPdf(file) {
  const name = String((file && file.name) || '').toLowerCase();
  const mime = String((file && file.mime) || '').toLowerCase();
  return mime === 'application/pdf' || name.endsWith('.pdf');
}

/**
 * The URL to download, with the user's token added, or null if it is not an acceptable Moodle file URL
 * for this site. `site` is the base the user connected, e.g. https://moodle.school.edu/moodle.
 */
export function downloadUrl(url, site, token) {
  let u;
  let base;
  try { u = new URL(String(url)); base = new URL(site); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.host !== base.host || u.username || u.password) return null;
  const prefix = base.pathname.replace(/\/+$/, '') + '/webservice/pluginfile.php/';
  if (!u.pathname.startsWith(prefix) || u.pathname.includes('..')) return null;
  u.hash = '';
  u.searchParams.set('token', token);
  return u.toString();
}

/** Reads a response body, giving up (null) as soon as it passes `max` bytes. */
export async function readLimited(res, max) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body || !res.body.getReader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > max ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch (e) { /* ignore */ } return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  chunks.forEach((c) => { out.set(c, at); at += c.length; });
  return out;
}

export function toBase64(bytes) {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(bin);
}

const isPdfBytes = (b) => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d; // "%PDF-"

/**
 * attachments: [{name, size, url, mime, modified}]. Returns {docs: [{name, data(base64)}], skipped: [{name, reason}]}.
 * Reasons: not_pdf, too_many, too_large, bad_url, unavailable, redirected, not_a_pdf.
 */
export async function fetchHandouts(attachments, { site, token, fetchFn = fetch, maxFileBytes = MAX_FILE_BYTES, maxFiles = MAX_FILES, maxTotal = MAX_TOTAL_BYTES }) {
  const docs = [];
  const skipped = [];
  let total = 0;
  for (const f of attachments || []) {
    if (!isPdf(f)) { skipped.push({ name: f.name, reason: 'not_pdf' }); continue; }
    if (docs.length >= maxFiles) { skipped.push({ name: f.name, reason: 'too_many' }); continue; }
    if (f.size > maxFileBytes) { skipped.push({ name: f.name, reason: 'too_large' }); continue; }
    const url = downloadUrl(f.url, site, token);
    if (!url) { skipped.push({ name: f.name, reason: 'bad_url' }); continue; }
    let res;
    try {
      res = await fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    } catch (e) { skipped.push({ name: f.name, reason: 'unavailable' }); continue; }
    if (res.status >= 300 && res.status < 400) { skipped.push({ name: f.name, reason: 'redirected' }); continue; }
    if (!res.ok) { skipped.push({ name: f.name, reason: 'unavailable' }); continue; }
    const bytes = await readLimited(res, Math.min(maxFileBytes, maxTotal - total));
    if (!bytes) { skipped.push({ name: f.name, reason: 'too_large' }); continue; }
    if (!isPdfBytes(bytes)) { skipped.push({ name: f.name, reason: 'not_a_pdf' }); continue; }
    total += bytes.length;
    docs.push({ name: f.name, data: toBase64(bytes) });
  }
  return { docs, skipped };
}
