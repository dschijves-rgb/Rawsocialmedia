/**
 * worker.js — the key-holder.
 *
 * A Cloudflare Worker (free tier is plenty) that sits between the phone and the
 * Messages API. Its whole job is to hold the API key, because anything shipped
 * inside the app can be read by anyone who installs it.
 *
 * Deploy:
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler deploy
 *   wrangler secret put ANTHROPIC_API_KEY
 *   wrangler secret put SHARED_SECRET     # any long random string
 *
 * Then in the app: open the drawer and set the endpoint to the worker URL,
 * or run in the console:
 *   localStorage.setItem('jarves.endpoint', 'https://<your>.workers.dev')
 *
 * Without SHARED_SECRET this is an open proxy billed to your card, so the
 * check below is not optional.
 */

const API = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// Worst case one call can cost. At Opus 5 output rates this bounds a runaway
// or stolen client to roughly 40 cents a request.
const MAX_TOKENS_CEILING = 16000;

// Lock this down to where the app is actually served from. Origin is scheme +
// host only — no path. Cloudflare Pages preview builds get their own subdomain
// (abc123.jarves.pages.dev), so add one here if you ever need to test against a
// preview rather than production.
const ALLOWED_ORIGINS = [
  'https://jarves.pages.dev',
  'http://localhost:8731',
];

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'access-control-allow-origin': ok,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-jarves-key',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const headers = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'POST only.' }, 405, headers);

    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Worker is missing ANTHROPIC_API_KEY.' }, 500, headers);
    if (!env.SHARED_SECRET) return json({ error: 'Worker is missing SHARED_SECRET.' }, 500, headers);

    if (request.headers.get('x-jarves-key') !== env.SHARED_SECRET) {
      return json({ error: 'Not your worker.' }, 401, headers);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Body must be JSON.' }, 400, headers);
    }

    // Cap what a stolen client can spend in one call.
    body.max_tokens = Math.min(Number(body.max_tokens) || 16000, MAX_TOKENS_CEILING);

    // The SDKs take betas as a request field; raw HTTP needs the header. The
    // app sends `betas: [...]`, so translate and strip it — leaving it in the
    // body would be rejected as an unknown parameter.
    const betas = Array.isArray(body.betas) ? body.betas : [];
    delete body.betas;

    const headersOut = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': API_VERSION,
    };
    if (betas.length) headersOut['anthropic-beta'] = betas.join(',');

    const upstream = await fetch(API, {
      method: 'POST',
      headers: headersOut,
      body: JSON.stringify(body),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  },
};
