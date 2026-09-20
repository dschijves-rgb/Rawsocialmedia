/**
 * tools/memory.js — the tools that make Jarves feel like it knows you.
 * These are fully real today; no API key involved.
 */

import * as mem from '../memory.js';
import { register } from './index.js';

const when = (ts) => {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

register({
  name: 'remember',
  description:
    'Store a durable fact about the user or their world, so it can be recalled in any future conversation. Use for preferences, relationships, ongoing projects, and standing instructions — not for one-off chatter.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The fact, written as a standalone sentence.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional topic tags.' },
    },
    required: ['text'],
  },
  async run({ text, tags = [] }) {
    const fact = await mem.remember(text, tags);
    return {
      stored: fact.text,
      duplicate: !!fact.wasDuplicate,
      summary: fact.wasDuplicate ? 'Already knew that; refreshed it.' : `Got it — I'll remember that.`,
    };
  },
});

register({
  name: 'recall',
  description:
    'Search everything Jarves knows about the user. Call this before answering anything personal, rather than guessing.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to look for.' } },
    required: ['query'],
  },
  async run({ query }) {
    const hits = await mem.recall(query);
    return {
      count: hits.length,
      facts: hits.map((f) => ({ id: f.id, text: f.text, learned: when(f.createdAt) })),
      summary: hits.length ? `${hits.length} thing(s) on file.` : 'Nothing on file about that.',
    };
  },
});

register({
  name: 'forget',
  description: 'Delete a stored fact by its id. Confirm with the user before calling.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'number', description: 'The fact id, from recall.' } },
    required: ['id'],
  },
  async run({ id }) {
    await mem.forget(id);
    return { summary: 'Forgotten.' };
  },
});

register({
  name: 'add_note',
  description: 'Capture a freeform, timestamped note. Use for things to keep but not treat as a standing fact.',
  input_schema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The note body.' } },
    required: ['text'],
  },
  async run({ text }) {
    const note = await mem.addNote(text);
    return { id: note.id, summary: 'Noted.' };
  },
});

register({
  name: 'list_notes',
  description: 'List recent notes, or search them when a query is given.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Optional search text.' } },
  },
  async run({ query = '' }) {
    const hits = query ? await mem.searchNotes(query) : (await mem.notes()).slice(0, 10);
    return {
      count: hits.length,
      notes: hits.map((n) => ({ id: n.id, text: n.text, written: when(n.createdAt) })),
      summary: hits.length ? `${hits.length} note(s).` : 'No notes yet.',
    };
  },
});
