/**
 * brain/claude.js — the real brain. Written, wired, and currently inert.
 *
 * It is inert because it needs ONE thing: an endpoint. An API key can never
 * live in this file — anyone who installs the app can read it. So this posts to
 * a small server-side function that holds the key and forwards to the Messages
 * API. `backend/worker.js` in this repo is that function, ready to deploy.
 *
 * Set ENDPOINT below (or call configure()) and this brain takes over. The tool
 * loop is already correct: tools are declared from the same registry the local
 * brain uses, so every tool works the moment the key lands.
 */

import * as tools from '../tools/index.js';
import * as mem from '../memory.js';

const STORAGE_KEY = 'jarves.endpoint';
const SECRET_KEY = 'jarves.secret';
const MODEL = 'claude-sonnet-5';
const MAX_TOOL_ROUNDS = 6;

let endpoint = localStorage.getItem(STORAGE_KEY) || '';
let secret = localStorage.getItem(SECRET_KEY) || '';

export function configure(url, sharedSecret = '') {
  endpoint = url || '';
  secret = sharedSecret || '';
  if (url) localStorage.setItem(STORAGE_KEY, url);
  else localStorage.removeItem(STORAGE_KEY);
  if (sharedSecret) localStorage.setItem(SECRET_KEY, sharedSecret);
  else localStorage.removeItem(SECRET_KEY);
}

export function isConfigured() {
  return !!endpoint;
}

async function systemPrompt() {
  const facts = await mem.facts();
  const known = facts.length
    ? facts.map((f) => `- ${f.text}`).join('\n')
    : '(nothing yet)';

  return `You are Jarves, a personal assistant living on your user's Android phone.

Voice: brief, warm, direct. You are being read aloud as often as not, so favour
short sentences and skip preamble. No bullet lists unless they asked for one.

You have persistent memory. What you already know about them:
${known}

Rules:
- Call recall before answering anything personal. Don't guess at their life.
- Call remember when they tell you something durable — a preference, a deadline,
  a name, a standing instruction. Don't announce it every time; just do it.
- You cannot send email. You draft; they send. Say so if they assume otherwise.
- If a tool returns a note saying the data is a sample, say that out loud.
- If you don't know, say you don't know.`;
}

export const claude = {
  id: 'claude',
  label: 'Claude',

  async respond({ text, history = [], signal }) {
    if (!endpoint) throw new Error('No endpoint configured for the Claude brain.');

    const messages = [
      ...history.slice(-20).map((m) => ({
        role: m.role === 'jarves' ? 'assistant' : 'user',
        content: m.text,
      })),
      { role: 'user', content: text },
    ];

    const system = await systemPrompt();
    const calls = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-jarves-key': secret },
        signal,
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system,
          messages,
          tools: tools.describe(),
        }),
      });

      if (!res.ok) {
        throw new Error(`Brain returned ${res.status}. ${(await res.text()).slice(0, 180)}`);
      }

      const data = await res.json();
      const blocks = data.content || [];
      messages.push({ role: 'assistant', content: blocks });

      const toolUses = blocks.filter((b) => b.type === 'tool_use');
      if (!toolUses.length) {
        const said = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return { text: said || '…', toolCalls: calls };
      }

      const results = [];
      for (const use of toolUses) {
        const result = await tools.run(use.name, use.input);
        calls.push({ name: use.name, input: use.input, result });
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: !result.ok,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: results });
    }

    return {
      text: `I got stuck in a loop working on that — too many tool calls. Try asking a narrower question.`,
      toolCalls: calls,
    };
  },
};
