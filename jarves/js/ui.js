/**
 * ui.js — everything that touches the DOM.
 *
 * The one rule in here: message text is escaped before any formatting is
 * applied. Tool output and (later) model output both land in these bubbles, so
 * the formatter must never be a way to inject markup.
 */

const $ = (id) => document.getElementById(id);

export const el = {
  transcript: $('transcript'),
  status: $('status'),
  input: $('input'),
  composer: $('composer'),
  sendBtn: $('sendBtn'),
  micBtn: $('micBtn'),
  muteBtn: $('muteBtn'),
  menuBtn: $('menuBtn'),
  drawer: $('drawer'),
  scrim: $('scrim'),
  closeDrawer: $('closeDrawer'),
  factList: $('factList'),
  factEmpty: $('factEmpty'),
  factCount: $('factCount'),
  noteList: $('noteList'),
  noteEmpty: $('noteEmpty'),
  noteCount: $('noteCount'),
  ttsToggle: $('ttsToggle'),
  themeToggle: $('themeToggle'),
  exportBtn: $('exportBtn'),
  wipeBtn: $('wipeBtn'),
  brainChip: $('brainChip'),
  brainHint: $('brainHint'),
  endpointInput: $('endpointInput'),
  secretInput: $('secretInput'),
  connectBtn: $('connectBtn'),
  disconnectBtn: $('disconnectBtn'),
  version: $('version'),
};

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Escape first, then allow exactly **bold** and *dim*. Nothing else. */
function format(text) {
  return escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<em>$2</em>');
}

const atBottom = () => {
  const t = el.transcript;
  return t.scrollHeight - t.scrollTop - t.clientHeight < 90;
};

export function scrollToEnd(force = false) {
  if (!force && !atBottom()) return;
  requestAnimationFrame(() => {
    el.transcript.scrollTo({ top: el.transcript.scrollHeight, behavior: 'smooth' });
  });
}

export function addMessage(role, text, { tools = [] } = {}) {
  const stick = atBottom();

  if (tools.length) {
    const names = [...new Set(tools.map((t) => t.name))].join(' · ');
    const chip = document.createElement('div');
    chip.className = 'msg tool';
    chip.innerHTML = `<div class="bubble">used ${escape(names)}</div>`;
    el.transcript.appendChild(chip);
  }

  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const who = role === 'user' ? 'You' : role === 'jarves' ? 'Jarves' : '';
  wrap.innerHTML =
    (who ? `<div class="who">${who}</div>` : '') + `<div class="bubble">${format(text)}</div>`;
  el.transcript.appendChild(wrap);

  scrollToEnd(stick || role === 'user');
  return wrap;
}

let typingEl = null;

export function showTyping() {
  if (typingEl) return;
  typingEl = document.createElement('div');
  typingEl.className = 'msg jarves';
  typingEl.innerHTML = `<div class="who">Jarves</div><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>`;
  el.transcript.appendChild(typingEl);
  scrollToEnd(true);
}

export function hideTyping() {
  typingEl?.remove();
  typingEl = null;
}

export function setStatus(text = '', tone = '') {
  el.status.textContent = text;
  el.status.className = `status${tone ? ' ' + tone : ''}`;
}

export function setBusy(busy) {
  document.body.classList.toggle('is-thinking', busy);
  el.sendBtn.disabled = busy || !el.input.value.trim();
}

export function setListening(on) {
  document.body.classList.toggle('is-listening', on);
  el.micBtn.setAttribute('aria-pressed', String(on));
}

export function welcome(onPick) {
  const card = document.createElement('div');
  card.className = 'msg welcome';
  card.innerHTML = `
    <h2>Good to see you.</h2>
    <p>I'm Jarves. Everything you tell me stays on this phone. Start by teaching me something.</p>
    <div class="suggest">
      <button type="button">remember that I shoot content on Thursdays</button>
      <button type="button">check my email</button>
      <button type="button">note: call Tom about the rate card</button>
      <button type="button">what can you do</button>
    </div>`;
  card.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => onPick(b.textContent.trim()))
  );
  el.transcript.appendChild(card);
}

/* ---------- drawer ---------- */

export function openDrawer() {
  el.drawer.hidden = false;
  el.scrim.hidden = false;
  el.menuBtn.setAttribute('aria-expanded', 'true');
  el.closeDrawer.focus();
}

export function closeDrawerPanel() {
  el.drawer.hidden = true;
  el.scrim.hidden = true;
  el.menuBtn.setAttribute('aria-expanded', 'false');
}

const trashIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>`;

const ago = (ts) => {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function renderList(listEl, emptyEl, countEl, items, onDelete) {
  listEl.replaceChildren();
  countEl.textContent = String(items.length);
  emptyEl.hidden = items.length > 0;

  for (const item of items) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escape(item.text)}<time>${ago(item.createdAt)}</time></span>
                    <button type="button" aria-label="Delete">${trashIcon}</button>`;
    li.querySelector('button').addEventListener('click', () => onDelete(item.id));
    listEl.appendChild(li);
  }
}

export function renderFacts(items, onDelete) {
  renderList(el.factList, el.factEmpty, el.factCount, items.slice().reverse(), onDelete);
}

export function renderNotes(items, onDelete) {
  renderList(el.noteList, el.noteEmpty, el.noteCount, items, onDelete);
}

export function setBrain(id, label, hint) {
  el.brainChip.textContent = label;
  el.brainHint.textContent = hint;
  el.brainChip.style.opacity = id === 'claude' ? '1' : '.75';
}

/* ---------- composer ---------- */

export function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 132) + 'px';
}

export function clearInput() {
  el.input.value = '';
  autoGrow();
  el.sendBtn.disabled = true;
}
