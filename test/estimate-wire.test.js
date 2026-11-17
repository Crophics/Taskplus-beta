// Checks what the REAL Anthropic SDK puts on the wire for our request, using a local fake server.
// It cannot prove the live API accepts it (no key here), but it does prove the SDK produces the
// request we intend: endpoint, beta header, structured-output schema, fallbacks, effort, model.
// Skipped when the SDK is not installed (the Worker loads it lazily, so the rest of the suite does not need it).
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk'); } catch (e) { /* not installed */ }

let E;
test.before(async () => { E = await import('../src/estimate.mjs'); });

const RESPONSE = (extra = {}) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  content: [{ type: 'text', text: JSON.stringify({ minutes: 100, low: 70, high: 140, confidence: 'medium', rationale: 'Seven problems.', steps: [{ name: 'Problems 4-7', minutes: 50 }, { name: 'Problems 8-10', minutes: 50 }] }) }],
  usage: { input_tokens: 700, output_tokens: 200 }, ...extra,
});

function fakeServer(responder) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      const { status, json } = responder(seen.length);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: 'http://127.0.0.1:' + server.address().port })));
}

const input = () => E.sanitizeInput({ id: 'moodle:1', course: 'MATH 2400', title: 'Assignment 6', kind: 'assign', points: 100, description: 'Do problems 4-10.', files: ['a.pdf'], dueInDays: 2 });

test('with fallbacks on: the beta endpoint, the fallback beta header, fallbacks:"default", schema and effort', { skip: !Anthropic }, async () => {
  const { server, seen, base } = await fakeServer(() => ({ status: 200, json: RESPONSE() }));
  try {
    const client = new Anthropic({ apiKey: 'sk-ant-test', baseURL: base, maxRetries: 0 });
    const r = await E.callModel(client, input());
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.estimate.minutes, 100);
    const req = seen[0];
    assert.strictEqual(req.method, 'POST');
    assert.ok(req.url.startsWith('/v1/messages'), req.url);
    assert.ok(String(req.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01'), req.headers['anthropic-beta']);
    // SDK 1.x authenticates with a Bearer token under API version 2026-10-21; older versions used x-api-key.
    assert.ok(req.headers['x-api-key'] === 'sk-ant-test' || req.headers.authorization === 'Bearer sk-ant-test');
    assert.ok(req.headers['anthropic-version']);
    assert.strictEqual(req.body.model, 'claude-opus-5-5');
    assert.strictEqual(req.body.fallbacks, 'default');
    assert.strictEqual(req.body.output_config.effort, 'medium');
    assert.strictEqual(req.body.output_config.format.type, 'json_schema');
    assert.deepStrictEqual(req.body.output_config.format.schema, E.SCHEMA);
    assert.ok(req.body.max_tokens >= 8000);
    assert.strictEqual(req.body.system, E.SYSTEM_PROMPT);
    assert.strictEqual(req.body.messages[0].role, 'user');
    assert.ok(req.body.messages[0].content.startsWith('<assignment>'));
    assert.strictEqual('thinking' in req.body, false);
    assert.strictEqual('temperature' in req.body, false);
  } finally { server.close(); }
});

test('with fallbacks off: the plain endpoint, no beta header, no fallbacks field', { skip: !Anthropic }, async () => {
  const { server, seen, base } = await fakeServer(() => ({ status: 200, json: RESPONSE() }));
  try {
    const client = new Anthropic({ apiKey: 'sk-ant-test', baseURL: base, maxRetries: 0 });
    const r = await E.callModel(client, input(), { fallbacks: false });
    assert.strictEqual(r.ok, true);
    const req = seen[0];
    assert.ok(!String(req.headers['anthropic-beta'] || '').includes('server-side-fallback'));
    assert.strictEqual('fallbacks' in req.body, false);
    assert.strictEqual(req.body.output_config.format.type, 'json_schema');
  } finally { server.close(); }
});

test('real SDK error and refusal shapes map to our error codes', { skip: !Anthropic }, async () => {
  const cases = [
    [{ status: 429, json: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } }, 'busy'],
    [{ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }, 'server_misconfigured'],
    [{ status: 500, json: { type: 'error', error: { type: 'api_error', message: 'oops' } } }, 'model_error'],
    [{ status: 200, json: RESPONSE({ stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } }) }, 'refused'],
    [{ status: 200, json: RESPONSE({ stop_reason: 'max_tokens' }) }, 'truncated'],
  ];
  for (const [reply, expected] of cases) {
    const { server, base } = await fakeServer(() => reply);
    try {
      const client = new Anthropic({ apiKey: 'sk-ant-test', baseURL: base, maxRetries: 0 });
      const r = await E.callModel(client, input());
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.error, expected, JSON.stringify(reply.json).slice(0, 80));
    } finally { server.close(); }
  }
});
