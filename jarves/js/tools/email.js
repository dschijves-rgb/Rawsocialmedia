/**
 * tools/email.js — email, behind an adapter.
 *
 * Real email needs OAuth and a server to hold the token; a phone browser can't
 * safely do either. So the tool surface is built for real now, and the data
 * comes from a swappable adapter. Today that's `mockAdapter`. When the backend
 * lands, write a gmailAdapter with the same four methods, call
 * `setAdapter(gmailAdapter)`, and nothing else in the app changes.
 */

import { register } from './index.js';

/** @typedef {{ name:string, isLive:boolean, list:Function, read:Function, draft:Function }} EmailAdapter */

const seed = [
  {
    id: 'm1', from: 'Nadia Brekke <nadia@thornhillstudio.com>', subject: 'Re: October content block',
    date: Date.now() - 2 * 3600e3, unread: true,
    snippet: 'Happy with the three pillars. Can we push the shoot to the 14th?',
    body: `Hey,\n\nHappy with the three pillars you sent through — the "behind the build" angle especially.\n\nOne ask: can we push the shoot from the 9th to the 14th? Our studio is double-booked and the 14th gives us the whole day rather than a rushed morning.\n\nLet me know and I'll lock the crew.\n\nNadia`,
  },
  {
    id: 'm2', from: 'Stripe <receipts@stripe.com>', subject: 'Your receipt [#2291-8840]',
    date: Date.now() - 9 * 3600e3, unread: true,
    snippet: 'Receipt for your August subscription payment.',
    body: 'Amount: $29.00\nCard: •••• 4242\nNo action needed.',
  },
  {
    id: 'm3', from: 'Tom Alvarez <tom@northlightmedia.co>', subject: 'Quick question on the rate card',
    date: Date.now() - 26 * 3600e3, unread: false,
    snippet: 'Does the retainer cover reels or is that billed separately?',
    body: `Morning,\n\nGoing through the rate card before I take it to our finance lead. Does the monthly retainer cover short-form reels, or is that billed separately per asset?\n\nNot urgent — sometime this week is fine.\n\nTom`,
  },
];

const fmt = (ts) => {
  const h = Math.round((Date.now() - ts) / 3600e3);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

/** @type {EmailAdapter} */
export const mockAdapter = {
  name: 'mock',
  isLive: false,
  async list({ unreadOnly = false, limit = 10 } = {}) {
    return seed.filter((m) => (unreadOnly ? m.unread : true)).slice(0, limit);
  },
  async read({ id }) {
    const msg = seed.find((m) => m.id === id);
    if (!msg) throw new Error(`No message with id "${id}".`);
    msg.unread = false;
    return msg;
  },
  async draft({ to, subject, body }) {
    // A mock draft is deliberately not saved anywhere. Nothing is sent, ever —
    // sending is a separate, explicitly-confirmed capability we haven't built.
    return { to, subject, body, saved: false };
  },
};

let adapter = mockAdapter;

export function setAdapter(next) {
  if (!next?.list || !next?.read || !next?.draft) throw new Error('Bad email adapter.');
  adapter = next;
}

export function currentAdapter() {
  return adapter;
}

const provenance = () =>
  adapter.isLive ? undefined : 'SAMPLE DATA — no real mailbox is connected. Say so plainly when relaying this.';

register({
  name: 'email_list',
  description: 'List messages in the inbox, newest first. Use before reading or summarising mail.',
  input_schema: {
    type: 'object',
    properties: {
      unreadOnly: { type: 'boolean', description: 'Only unread messages.' },
      limit: { type: 'number', description: 'Max messages to return (default 10).' },
    },
  },
  async run(input) {
    const msgs = await adapter.list(input);
    return {
      source: adapter.name,
      live: adapter.isLive,
      note: provenance(),
      count: msgs.length,
      messages: msgs.map((m) => ({
        id: m.id, from: m.from, subject: m.subject,
        received: fmt(m.date), unread: m.unread, snippet: m.snippet,
      })),
    };
  },
});

register({
  name: 'email_read',
  description: 'Read the full body of one message by id, from email_list.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'The message id.' } },
    required: ['id'],
  },
  async run({ id }) {
    const m = await adapter.read({ id });
    return {
      source: adapter.name, live: adapter.isLive, note: provenance(),
      from: m.from, subject: m.subject, received: fmt(m.date), body: m.body,
    };
  },
});

register({
  name: 'email_draft',
  description:
    'Compose a reply or new message and show it to the user for approval. This never sends — Jarves cannot send mail.',
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient.' },
      subject: { type: 'string', description: 'Subject line.' },
      body: { type: 'string', description: 'Message body, in the user’s voice.' },
    },
    required: ['to', 'subject', 'body'],
  },
  async run(input) {
    const d = await adapter.draft(input);
    return { ...d, summary: 'Draft ready for you to review. Nothing was sent.' };
  },
});
