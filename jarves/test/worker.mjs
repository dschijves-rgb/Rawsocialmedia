/**
 * worker.mjs — runs the Cloudflare Worker's handler in Node against a stubbed
 * upstream. Checks the betas -> anthropic-beta translation, the spend cap, and
 * that the API key never reaches the client.
 *
 *   node test/worker.mjs
 */

import worker from '../backend/worker.js';

let upstream = null;
globalThis.fetch = async (url, init) => {
  upstream = { url, headers: init.headers, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const env = { ANTHROPIC_API_KEY: 'sk-ant-test', SHARED_SECRET: 'sekrit' };
const post = (body, key = 'sekrit') =>
  worker.fetch(new Request('https://w.dev', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jarves-key': key, origin: 'http://localhost:8000' },
    body: JSON.stringify(body),
  }), env);

const ok = [];
const chk = (n, p, d = '') => { ok.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p ? '' : '  <<< ' + d}`); };

// happy path
let res = await post({ model: 'claude-opus-5', max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], messages: [] });
chk('forwards a good request', res.status === 200, String(res.status));
chk('betas became the anthropic-beta header',
  upstream.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01', JSON.stringify(upstream.headers['anthropic-beta']));
chk('betas stripped from the body', !('betas' in upstream.body), JSON.stringify(Object.keys(upstream.body)));
chk('api key attached server-side', upstream.headers['x-api-key'] === 'sk-ant-test');
chk('api version sent', upstream.headers['anthropic-version'] === '2023-06-01');
chk('key never leaks to the client', !JSON.stringify([...res.headers]).includes('sk-ant-test'));

// no betas -> no header
await post({ model: 'claude-opus-5', max_tokens: 100, messages: [] });
chk('omits anthropic-beta when no betas', !('anthropic-beta' in upstream.headers), JSON.stringify(upstream.headers));

// spend guard
await post({ model: 'claude-opus-5', max_tokens: 999999, messages: [] });
chk('caps runaway max_tokens', upstream.body.max_tokens === 16000, String(upstream.body.max_tokens));

// auth
res = await post({ messages: [] }, 'wrong-key');
chk('rejects a bad shared secret', res.status === 401, String(res.status));

res = await worker.fetch(new Request('https://w.dev', { method: 'GET' }), env);
chk('rejects GET', res.status === 405, String(res.status));

res = await worker.fetch(new Request('https://w.dev', { method: 'OPTIONS', headers: { origin: 'http://localhost:8000' } }), env);
chk('answers CORS preflight', res.status === 204 && !!res.headers.get('access-control-allow-origin'), String(res.status));

res = await post({ messages: [] });
chk('errors when the key is unconfigured',
  (await worker.fetch(new Request('https://w.dev', { method: 'POST', headers: { 'x-jarves-key': 'sekrit' }, body: '{}' }), { SHARED_SECRET: 'sekrit' })).status === 500);

const bad = ok.filter((x) => !x).length;
console.log(`\n${ok.length - bad}/${ok.length} passed`);
process.exit(bad ? 1 : 0);
