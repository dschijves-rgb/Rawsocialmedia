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

// Lock this down to where the app is actually served from.
const ALLOWED_ORIGINS = [
  'https://dschijves-rgb.github.io',
  'http://localhost:8000',
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
    body.max_tokens = Math.min(Number(body.max_tokens) || 1024, 2048);

    const upstream = await fetch(API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  },
};
