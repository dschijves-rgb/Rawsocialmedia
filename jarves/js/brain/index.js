/**
 * brain/index.js — picks which brain answers, and guarantees an answer.
 *
 * A Brain is anything with:  respond({ text, history, signal }) -> { text, toolCalls }
 *
 * Selection is: use Claude when an endpoint is configured, otherwise the local
 * shell brain — and if Claude fails mid-turn (offline, rate limit, bad key),
 * fall through to local rather than showing the user an error page. An
 * assistant that dies without a network isn't an assistant.
 */

import { local } from './local.js';
import { claude, isConfigured } from './claude.js';

export { configure as configureClaude, isConfigured } from './claude.js';

export function active() {
  return isConfigured() ? claude : local;
}

export async function respond(turn) {
  const brain = active();

  if (brain === local) return { ...(await local.respond(turn)), brain: local.id };

  try {
    return { ...(await claude.respond(turn)), brain: claude.id };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const fallback = await local.respond(turn);
    return {
      ...fallback,
      brain: local.id,
      degraded: `Couldn't reach the model (${err.message}) — answered on the shell brain instead.`,
    };
  }
}
