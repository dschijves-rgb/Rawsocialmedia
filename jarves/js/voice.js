/**
 * voice.js — speech in, speech out.
 *
 * Android Chrome quirks this works around:
 *  - recognition stops on its own after a pause; we don't fight it, we treat
 *    the final result as the end of the turn
 *  - getVoices() is empty on first call until the voiceschanged event fires
 *  - speak() is ignored unless it follows a real user gesture, so the first
 *    tap primes the synth with a silent utterance
 */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canListen = !!SR;
export const canSpeak = 'speechSynthesis' in window;

/* ---------- listening ---------- */

let recognition = null;
let listening = false;

export function startListening({ onPartial, onFinal, onEnd, onError } = {}) {
  if (!SR) {
    onError?.(new Error('This browser has no speech recognition.'));
    return false;
  }
  if (listening) return false;

  recognition = new SR();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let settled = '';

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) settled += chunk;
      else interim += chunk;
    }
    if (interim) onPartial?.(settled + interim);
    if (settled) onPartial?.(settled);
  };

  recognition.onerror = (e) => {
    listening = false;
    const map = {
      'not-allowed': 'Microphone blocked. Allow it in your browser settings.',
      'service-not-allowed': 'Microphone blocked by the system.',
      'no-speech': "Didn't catch that.",
      network: 'Speech recognition needs a connection.',
      aborted: null,
    };
    const msg = map[e.error];
    if (msg) onError?.(new Error(msg));
  };

  recognition.onend = () => {
    listening = false;
    const final = settled.trim();
    if (final) onFinal?.(final);
    onEnd?.();
  };

  try {
    recognition.start();
    listening = true;
    return true;
  } catch {
    listening = false;
    return false;
  }
}

export function stopListening() {
  if (recognition && listening) {
    try { recognition.stop(); } catch { /* already stopped */ }
  }
}

export const isListening = () => listening;

/* ---------- speaking ---------- */

let voices = [];
let primed = false;
let muted = false;

function loadVoices() {
  if (!canSpeak) return;
  voices = speechSynthesis.getVoices();
}

if (canSpeak) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

/** Pick the most natural English voice available; fall back to the default. */
function pickVoice() {
  if (!voices.length) loadVoices();
  const lang = (navigator.language || 'en-US').toLowerCase();
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  const pool = en.length ? en : voices;
  return (
    pool.find((v) => v.lang?.toLowerCase() === lang && /natural|neural|enhanced|google/i.test(v.name)) ||
    pool.find((v) => /natural|neural|enhanced/i.test(v.name)) ||
    pool.find((v) => /google/i.test(v.name)) ||
    pool.find((v) => v.lang?.toLowerCase() === lang) ||
    pool[0] ||
    null
  );
}

/** Call once from inside a tap handler, or Android silently drops the first speak(). */
export function prime() {
  if (!canSpeak || primed) return;
  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    speechSynthesis.speak(u);
    primed = true;
  } catch { /* not fatal */ }
}

export function setMuted(v) {
  muted = !!v;
  if (muted) shutUp();
}

export const isMuted = () => muted;

export function shutUp() {
  if (canSpeak) try { speechSynthesis.cancel(); } catch { /* nothing to cancel */ }
}

/** Strip the markdown emphasis so it isn't read out as "asterisk asterisk". */
function speakable(text) {
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[•○●]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speak(text, { onEnd } = {}) {
  if (!canSpeak || muted) { onEnd?.(); return; }
  const body = speakable(text);
  if (!body) { onEnd?.(); return; }

  shutUp();
  const u = new SpeechSynthesisUtterance(body);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = 1.04;
  u.pitch = 1;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
}
