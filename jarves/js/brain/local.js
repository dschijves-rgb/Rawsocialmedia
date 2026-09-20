/**
 * brain/local.js — the shell brain.
 *
 * No API key, no network, no cost. It is a deliberate rule-based router, not a
 * fake language model: it handles memory, notes and email commands *for real*
 * by calling the same tools the Claude brain will call, and it is honest about
 * everything else rather than bluffing an answer.
 *
 * When the real brain lands this file does not get deleted — it stays as the
 * offline fallback for when the network or the API is down.
 */

import * as tools from '../tools/index.js';

const reply = (text, calls = []) => ({ text, toolCalls: calls });

async function call(name, input, calls) {
  const result = await tools.run(name, input);
  calls.push({ name, input, result });
  return result;
}

const CAPABILITIES = `Right now I'm running on the shell brain, so here's what's genuinely mine:

**Memory** — "remember that the shoot moved to the 14th", then later "what do you know about the shoot". Also "forget …".
**Notes** — "note: call Tom back", "show my notes".
**Email** — "check my email", "read the one from Nadia", "draft a reply to Tom". *(Sample mailbox — nothing real is connected yet.)*

What I *can't* do yet is think. Open questions, writing, reasoning, anything off this list — that needs a real model behind me, which is the next thing we wire up.`;

export const local = {
  id: 'local',
  label: 'shell brain',

  async respond({ text }) {
    const q = text.trim();
    const l = q.toLowerCase();
    const calls = [];

    /* ---------- memory ---------- */

    let m = l.match(/^(?:please\s+)?(?:remember|keep in mind|don'?t forget)(?:\s+that)?[:,]?\s+(.+)/is);
    if (m) {
      const fact = q.slice(q.length - m[1].length).trim().replace(/[.!]+$/, '');
      const r = await call('remember', { text: fact }, calls);
      if (!r.ok) return reply(`I couldn't store that — ${r.error}`, calls);
      return reply(r.duplicate ? `Already had that one, but it's fresh now.` : `Got it. I'll remember that.`, calls);
    }

    m = l.match(/^(?:what do you (?:know|remember)|what'?s? on file|tell me)(?:\s+about)?\s*(.*)$/is);
    if (m && (l.includes('know') || l.includes('remember') || l.includes('on file'))) {
      const topic = q.slice(q.length - m[1].length).trim().replace(/[?.!]+$/, '');
      const r = await call('recall', { query: topic }, calls);
      if (!r.ok) return reply(`Memory lookup failed — ${r.error}`, calls);
      if (!r.count) {
        return reply(
          topic ? `Nothing on file about “${topic}”. Tell me and I'll keep it.` : `I don't know anything about you yet.`,
          calls
        );
      }
      const lines = r.facts.map((f) => `• ${f.text} *(${f.learned})*`).join('\n');
      return reply(`${topic ? `On “${topic}”:` : `Here's what I know:`}\n${lines}`, calls);
    }

    m = l.match(/^forget(?:\s+(?:that|about))?\s+(.+)/is);
    if (m) {
      const topic = q.slice(q.length - m[1].length).trim().replace(/[.!?]+$/, '');
      const found = await call('recall', { query: topic }, calls);
      if (!found.ok || !found.count) return reply(`Nothing on file about “${topic}”, so nothing to forget.`, calls);
      const target = found.facts[0];
      await call('forget', { id: target.id }, calls);
      const rest = found.count - 1;
      return reply(
        `Forgotten: *${target.text}*` + (rest ? `\n\n${rest} other thing(s) matched — ask again to drop the next one.` : ''),
        calls
      );
    }

    /* ---------- notes ---------- */

    m = l.match(/^(?:note|jot(?: down)?|take a note|make a note|remind me)(?:\s+that)?[:,]?\s+(.+)/is);
    if (m) {
      const body = q.slice(q.length - m[1].length).trim();
      const r = await call('add_note', { text: body }, calls);
      if (!r.ok) return reply(`Couldn't save that — ${r.error}`, calls);
      return reply(`Noted.`, calls);
    }

    if (/^(?:show|list|read|what are)?\s*(?:me\s+)?(?:my\s+)?notes\b|^what'?s? in my notes/i.test(l)) {
      const r = await call('list_notes', {}, calls);
      if (!r.ok) return reply(`Couldn't read your notes — ${r.error}`, calls);
      if (!r.count) return reply(`No notes yet. Say “note: …” and I'll start one.`, calls);
      return reply(
        `Your notes:\n` + r.notes.map((n) => `• ${n.text} *(${n.written})*`).join('\n'),
        calls
      );
    }

    /* ---------- email ---------- */

    m = l.match(/(?:read|open|show)\s+(?:me\s+)?(?:the\s+)?(?:one|email|message|mail)\s+from\s+([a-z\s]+)/i);
    if (m) {
      const who = m[1].trim();
      const list = await call('email_list', { limit: 20 }, calls);
      if (!list.ok) return reply(`Couldn't reach the mailbox — ${list.error}`, calls);
      const hit = list.messages.find((x) => x.from.toLowerCase().includes(who.split(/\s+/)[0]));
      if (!hit) return reply(`Nothing in the inbox from “${who}”.`, calls);
      const full = await call('email_read', { id: hit.id }, calls);
      if (!full.ok) return reply(`Couldn't open it — ${full.error}`, calls);
      return reply(
        `**${full.subject}**\nFrom ${full.from} · ${full.received}\n\n${full.body}` + sampleNote(full),
        calls
      );
    }

    if (/\b(e-?mail|inbox|mail)\b/i.test(l) && /\b(check|any|new|unread|read|what'?s|show|got)\b/i.test(l)) {
      const unreadOnly = /\bunread\b|\bnew\b/i.test(l);
      const r = await call('email_list', { unreadOnly }, calls);
      if (!r.ok) return reply(`Couldn't reach the mailbox — ${r.error}`, calls);
      if (!r.count) return reply(unreadOnly ? `Inbox is clear — nothing unread.` : `Inbox is empty.`, calls);
      const lines = r.messages
        .map((x) => `${x.unread ? '●' : '○'} **${x.subject}**\n   ${x.from.split('<')[0].trim()} · ${x.received}\n   *${x.snippet}*`)
        .join('\n\n');
      const head = unreadOnly ? `${r.count} unread:` : `${r.count} in the inbox:`;
      return reply(`${head}\n\n${lines}` + sampleNote(r), calls);
    }

    m = l.match(/(?:draft|write|reply)\s+(?:a\s+)?(?:reply\s+)?(?:to\s+)?([a-z\s]+?)(?:\s+about\s+(.+))?$/i);
    if (m && /\b(draft|reply|respond)\b/i.test(l)) {
      const who = m[1].trim();
      const list = await call('email_list', { limit: 20 }, calls);
      const hit = list.ok && list.messages.find((x) => x.from.toLowerCase().includes(who.split(/\s+/)[0]));
      if (!hit) return reply(`I'd need a real model behind me to write that from scratch. Drafting replies to mail I can see works — try “draft a reply to Nadia”.`, calls);
      return reply(
        `I can *find* the thread — **${hit.subject}** from ${hit.from.split('<')[0].trim()} — but writing the reply is the part that needs a real model. That's the next thing we wire up.\n\nWant the full message so you can answer it yourself? Say “read the one from ${who.split(/\s+/)[0]}”.`,
        calls
      );
    }

    /* ---------- small talk, honestly ---------- */

    if (/^(hi|hey|hello|yo|good (morning|evening|afternoon))\b/i.test(l)) {
      const known = await call('recall', { query: '' }, calls);
      const tail = known.ok && known.count ? ` I've got ${known.count} thing(s) on file for you.` : '';
      return reply(`Here.${tail} What do you need?`, calls);
    }

    if (/\b(what can you do|help|capabilities|commands|what do you do)\b/i.test(l)) {
      return reply(CAPABILITIES, calls);
    }

    if (/\b(who are you|what are you|your name)\b/i.test(l)) {
      return reply(
        `Jarves. Your assistant, running entirely on your phone — no account, no server, nothing leaves this device.\n\nI'm at the shell stage: memory, notes and email commands work for real. Reasoning comes when we connect a model.`,
        calls
      );
    }

    if (/\b(thanks|thank you|cheers|nice one|perfect)\b/i.test(l)) {
      return reply(`Any time.`, calls);
    }

    if (/\b(what(?:'s| is) the )?(time|date|day)\b/i.test(l) && l.length < 40) {
      const now = new Date();
      return reply(
        `${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} on ${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}.`,
        calls
      );
    }

    /* ---------- the honest fallback ---------- */

    const related = await call('recall', { query: q }, calls);
    const memoryHint =
      related.ok && related.count
        ? `\n\nFor what it's worth, this is on file and might be related:\n${related.facts.slice(0, 3).map((f) => `• ${f.text}`).join('\n')}`
        : '';

    return reply(
      `That one needs a real brain, and I don't have one connected yet — I won't invent an answer.${memoryHint}\n\nWhat works today: **remember …**, **what do you know about …**, **note: …**, **show my notes**, **check my email**. Say **help** for the full list.`,
      calls
    );
  },
};

function sampleNote(r) {
  return r.live === false ? `\n\n*(Sample mailbox — no real account is connected.)*` : '';
}
