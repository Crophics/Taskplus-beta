// gemini.mjs - the same estimate as estimate.mjs, asked of Google's Gemini API instead of Claude.
//
// It reuses the prompt, the input fencing, the JSON schema and, above all, the validation from
// estimate.mjs, so a Gemini answer is held to exactly the same rules as a Claude one. It talks to the
// REST endpoint with plain fetch (no SDK), and like callModel it never throws for API problems: it
// returns {ok: true, estimate, usage} or {ok: false, error}, so a failure only ever means "keep the
// rule-of-thumb estimate". The API key goes in a header only, never in a URL or a log line.

import { SYSTEM_PROMPT, SCHEMA, buildUserContent, validateOutput } from './estimate.mjs';

export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

// finishReason values that mean the content was declined rather than cut off or broken.
const REFUSED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT']);

/** The request body for one estimate. Exported so tests can check exactly what is sent. */
export function buildGeminiRequest(input, { model = GEMINI_DEFAULT_MODEL, documents = [] } = {}) {
  const parts = [
    ...documents.map((d) => ({ inlineData: { mimeType: 'application/pdf', data: d.data } })),
    { text: buildUserContent(input, documents.map((d) => d.name)) },
  ];
  const generationConfig = {
    responseMimeType: 'application/json',
    responseJsonSchema: SCHEMA,
    maxOutputTokens: 8192, // thinking tokens count against this too
  };
  // Gemini 3 and newer take a thinking level; a short answer needs little thinking.
  if (/^gemini-(3|4)/.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig,
  };
}

export async function callGemini(input, opts = {}) {
  const { apiKey, model = GEMINI_DEFAULT_MODEL, documents = [], fetchFn = fetch } = opts;
  if (!apiKey) return { ok: false, error: 'server_misconfigured' };
  let res;
  try {
    res = await fetchFn(ENDPOINT + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildGeminiRequest(input, { model, documents })),
    });
  } catch (e) {
    console.error('estimate: gemini request failed', e && e.name);
    return { ok: false, error: 'model_error' };
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const status = res.status;
    const msg = String((body && body.error && body.error.message) || '');
    console.error('estimate: gemini call failed', status);
    if (status === 429 || status === 503) return { ok: false, error: 'busy' };
    // A wrong key is a 400 "API key not valid" (or a 401/403): every other item would fail too.
    if (status === 401 || status === 403 || /api key/i.test(msg)) return { ok: false, error: 'server_misconfigured' };
    return { ok: false, error: 'model_error' };
  }
  if (!body) return { ok: false, error: 'bad_output' };
  if (body.promptFeedback && body.promptFeedback.blockReason) return { ok: false, error: 'refused' };
  const cand = body.candidates && body.candidates[0];
  if (!cand) return { ok: false, error: 'bad_output' };
  if (REFUSED.has(cand.finishReason)) return { ok: false, error: 'refused' };
  if (cand.finishReason === 'MAX_TOKENS') return { ok: false, error: 'truncated' };
  const text = ((cand.content && cand.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: 'bad_output' }; }
  const estimate = validateOutput(parsed, input);
  if (!estimate) return { ok: false, error: 'bad_output' };
  const u = body.usageMetadata;
  return { ok: true, estimate, usage: u ? { input: u.promptTokenCount, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } : null };
}
