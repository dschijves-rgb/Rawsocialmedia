/**
 * app.js — boot and wiring.
 */

import * as ui from './ui.js';
import * as mem from './memory.js';
import * as voice from './voice.js';
import * as brain from './brain/index.js';

// Importing these registers their tools. Add a new tool file here and both
// brains can use it immediately.
import './tools/memory.js';
import './tools/email.js';

const VERSION = '0.1.0';
const PREFS = 'jarves.prefs';

const prefs = {
  tts: true,
  theme: 'dark',
  ...safeParse(localStorage.getItem(PREFS)),
};

function safeParse(s) {
  try { return JSON.parse(s) || {}; } catch { return {}; }
}

function savePrefs() {
  try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* private mode */ }
}

let busy = false;

/* ---------- the turn ---------- */

async function send(text) {
  const clean = String(text || '').trim();
  if (!clean || busy) return;

  busy = true;
  voice.shutUp();
  ui.clearInput();
  ui.addMessage('user', clean);
  await mem.saveMessage('user', clean);

  ui.setBusy(true);
  ui.showTyping();
  ui.setStatus('thinking…');

  let out;
  try {
    out = await brain.respond({ text: clean, history: await mem.history(20) });
  } catch (err) {
    out = { text: `Something broke on my end: ${err.message}`, toolCalls: [] };
  }

  ui.hideTyping();
  ui.setStatus('');

  if (out.degraded) ui.addMessage('system', out.degraded);
  ui.addMessage('jarves', out.text, { tools: out.toolCalls || [] });
  await mem.saveMessage('jarves', out.text);

  // Any turn can have changed what's stored, so keep the drawer honest.
  await refreshMemoryPanels();

  busy = false;
  ui.setBusy(false);

  if (prefs.tts) {
    ui.setStatus('speaking…');
    voice.speak(out.text, { onEnd: () => ui.setStatus('') });
  }
}

/* ---------- drawer panels ---------- */

async function refreshMemoryPanels() {
  const [facts, notes] = await Promise.all([mem.facts(), mem.notes()]);
  ui.renderFacts(facts, async (id) => { await mem.forget(id); refreshMemoryPanels(); });
  ui.renderNotes(notes, async (id) => { await mem.deleteNote(id); refreshMemoryPanels(); });
}

/* ---------- wiring ---------- */

function wireComposer() {
  ui.el.input.addEventListener('input', () => {
    ui.autoGrow();
    ui.el.sendBtn.disabled = busy || !ui.el.input.value.trim();
  });

  // Enter sends on a physical keyboard; on a phone the on-screen Enter should
  // make a newline, so only hijack it when there's no shift and a real key.
  ui.el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      e.preventDefault();
      send(ui.el.input.value);
    }
  });

  ui.el.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    send(ui.el.input.value);
  });
}

function wireMic() {
  if (!voice.canListen) {
    ui.el.micBtn.hidden = true;
    return;
  }

  ui.el.micBtn.addEventListener('click', () => {
    voice.prime(); // must happen inside a gesture or Android mutes the first reply

    if (voice.isListening()) {
      voice.stopListening();
      return;
    }

    voice.shutUp();
    const started = voice.startListening({
      onPartial: (t) => {
        ui.el.input.value = t;
        ui.autoGrow();
      },
      onFinal: (t) => send(t),
      onEnd: () => {
        ui.setListening(false);
        if (ui.el.status.textContent === 'listening…') ui.setStatus('');
      },
      onError: (err) => {
        ui.setListening(false);
        ui.setStatus(err.message, 'warn');
        setTimeout(() => ui.setStatus(''), 3600);
      },
    });

    if (started) {
      ui.setListening(true);
      ui.setStatus('listening…', 'live');
    }
  });
}

function wireDrawer() {
  ui.el.menuBtn.addEventListener('click', async () => {
    await refreshMemoryPanels();
    ui.openDrawer();
  });
  ui.el.closeDrawer.addEventListener('click', ui.closeDrawerPanel);
  ui.el.scrim.addEventListener('click', ui.closeDrawerPanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ui.el.drawer.hidden) ui.closeDrawerPanel();
  });
}

function wireSettings() {
  ui.el.muteBtn.addEventListener('click', () => {
    prefs.tts = !prefs.tts;
    applyVoicePref();
    savePrefs();
  });

  ui.el.ttsToggle.addEventListener('change', () => {
    prefs.tts = ui.el.ttsToggle.checked;
    applyVoicePref();
    savePrefs();
  });

  ui.el.themeToggle.addEventListener('change', () => {
    prefs.theme = ui.el.themeToggle.checked ? 'light' : 'dark';
    applyTheme();
    savePrefs();
  });

  ui.el.exportBtn.addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(await mem.exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jarves-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  ui.el.wipeBtn.addEventListener('click', async () => {
    const { facts, notes } = await mem.counts();
    if (!confirm(`Erase ${facts} fact(s), ${notes} note(s) and the whole conversation? This cannot be undone.`)) return;
    await mem.wipe();
    await refreshMemoryPanels();
    ui.el.transcript.replaceChildren();
    ui.welcome(send);
    ui.closeDrawerPanel();
  });
}

function applyVoicePref() {
  voice.setMuted(!prefs.tts);
  ui.el.ttsToggle.checked = prefs.tts;
  ui.el.muteBtn.setAttribute('aria-pressed', String(!prefs.tts));
  ui.el.muteBtn.setAttribute('aria-label', prefs.tts ? 'Mute replies' : 'Unmute replies');
}

function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
  ui.el.themeToggle.checked = prefs.theme === 'light';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', prefs.theme === 'light' ? '#F6F5F2' : '#0F0D0B');
}

function showBrain() {
  const b = brain.active();
  ui.setBrain(
    b.id,
    b.label,
    b.id === 'claude'
      ? 'Connected to a model. Full reasoning, with every tool available.'
      : 'Running on the built-in shell brain. Memory, notes and email commands are real. General reasoning needs an API key.'
  );
  ui.el.endpointInput.value = localStorage.getItem('jarves.endpoint') || '';
  ui.el.secretInput.value = localStorage.getItem('jarves.secret') || '';
  ui.el.disconnectBtn.disabled = !brain.isConfigured();
}

function wireBrainPanel() {
  ui.el.connectBtn.addEventListener('click', () => {
    const url = ui.el.endpointInput.value.trim();
    if (!url) {
      ui.setStatus('Paste your worker URL first.', 'warn');
      setTimeout(() => ui.setStatus(''), 3000);
      return;
    }
    brain.configureClaude(url, ui.el.secretInput.value.trim());
    showBrain();
    ui.closeDrawerPanel();
    ui.addMessage('system', 'Model connected. Ask me anything now.');
  });

  ui.el.disconnectBtn.addEventListener('click', () => {
    brain.configureClaude('', '');
    showBrain();
    ui.addMessage('system', 'Back on the shell brain.');
  });
}

/* ---------- start ---------- */

async function boot() {
  applyTheme();
  applyVoicePref();
  ui.el.version.textContent = `v${VERSION} · on-device`;
  ui.el.sendBtn.disabled = true;

  wireComposer();
  wireMic();
  wireDrawer();
  wireSettings();
  wireBrainPanel();
  showBrain();

  let past = [];
  try {
    past = await mem.history(40);
  } catch (err) {
    ui.addMessage('system', `Storage is unavailable, so nothing will be saved this session. (${err.message})`);
  }

  if (past.length) {
    ui.addMessage('system', '— earlier —');
    for (const m of past) ui.addMessage(m.role, m.text);
    ui.scrollToEnd(true);
  } else {
    ui.welcome(send);
  }

  await refreshMemoryPanels();

  if (!voice.canListen) {
    ui.setStatus('Voice input needs Chrome on Android.', 'warn');
    setTimeout(() => ui.setStatus(''), 5000);
  }
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is a bonus, not a requirement */ });
  });
}
