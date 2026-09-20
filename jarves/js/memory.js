/**
 * memory.js — everything Jarves knows, on this device only.
 *
 * Three stores:
 *   facts    things it knows about you, durable, surfaced to the brain every turn
 *   notes    freeform captures, timestamped, never auto-surfaced
 *   messages conversation history, so a reload doesn't wipe the thread
 *
 * IndexedDB rather than localStorage: this store is meant to grow into
 * attachments and embeddings later, and the async shape is the same either way.
 */

const DB_NAME = 'jarves';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('facts')) {
        const s = db.createObjectStore('facts', { keyPath: 'id', autoIncrement: true });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('notes')) {
        const s = db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('messages')) {
        const s = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } else {
      t.oncomplete = () => resolve();
    }
  });
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/* ---------- facts ---------- */

export async function remember(text, tags = []) {
  const clean = String(text).trim();
  if (!clean) throw new Error('Nothing to remember.');

  // Don't stack near-duplicates — update the existing fact instead.
  const existing = await facts();
  const dupe = existing.find((f) => f.text.toLowerCase() === clean.toLowerCase());
  if (dupe) {
    dupe.updatedAt = Date.now();
    await tx('facts', 'readwrite', (s) => s.put(dupe));
    return { ...dupe, wasDuplicate: true };
  }

  const fact = { text: clean, tags, createdAt: Date.now(), updatedAt: Date.now() };
  const id = await tx('facts', 'readwrite', (s) => s.add(fact));
  return { ...fact, id };
}

export async function facts() {
  return (await tx('facts', 'readonly', (s) => s.getAll())) || [];
}

export async function forget(id) {
  await tx('facts', 'readwrite', (s) => s.delete(Number(id)));
}

/**
 * Keyword recall. Deliberately simple and explainable — every hit can be
 * traced to a shared word. Swap in embeddings here when the brain lands.
 */
export async function recall(query, limit = 8) {
  const terms = norm(query);
  const all = await facts();
  if (!terms.length) return all.slice(-limit).reverse();

  return all
    .map((f) => {
      const words = norm(f.text + ' ' + (f.tags || []).join(' '));
      const hits = terms.filter((t) => words.some((w) => w === t || (t.length > 3 && w.startsWith(t))));
      return { fact: f, score: hits.length };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.fact.updatedAt - a.fact.updatedAt)
    .slice(0, limit)
    .map((r) => r.fact);
}

/* ---------- notes ---------- */

export async function addNote(text) {
  const clean = String(text).trim();
  if (!clean) throw new Error('Nothing to note.');
  const note = { text: clean, createdAt: Date.now() };
  const id = await tx('notes', 'readwrite', (s) => s.add(note));
  return { ...note, id };
}

export async function notes() {
  const all = (await tx('notes', 'readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteNote(id) {
  await tx('notes', 'readwrite', (s) => s.delete(Number(id)));
}

export async function searchNotes(query, limit = 10) {
  const terms = norm(query);
  const all = await notes();
  if (!terms.length) return all.slice(0, limit);
  return all
    .map((n) => {
      const words = norm(n.text);
      const hits = terms.filter((t) => words.some((w) => w === t || (t.length > 3 && w.startsWith(t))));
      return { note: n, score: hits.length };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.note);
}

/* ---------- conversation ---------- */

export async function saveMessage(role, text) {
  const msg = { role, text, ts: Date.now() };
  const id = await tx('messages', 'readwrite', (s) => s.add(msg));
  return { ...msg, id };
}

export async function history(limit = 60) {
  const all = (await tx('messages', 'readonly', (s) => s.getAll())) || [];
  return all.slice(-limit);
}

/* ---------- whole-store operations ---------- */

export async function exportAll() {
  return {
    exportedAt: new Date().toISOString(),
    app: 'jarves',
    facts: await facts(),
    notes: await notes(),
    messages: await history(1000),
  };
}

export async function wipe() {
  for (const store of ['facts', 'notes', 'messages']) {
    await tx(store, 'readwrite', (s) => s.clear());
  }
}

export async function counts() {
  return { facts: (await facts()).length, notes: (await notes()).length };
}
