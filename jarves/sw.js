/**
 * sw.js — offline shell.
 *
 * Cache-first for the app's own files so Jarves opens instantly and still
 * works with no signal (the local brain needs no network at all). Anything
 * cross-origin — fonts, and later the model endpoint — goes straight to the
 * network and is never cached.
 */

const CACHE = 'jarves-v0.1.0';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/ui.js',
  'js/memory.js',
  'js/voice.js',
  'js/brain/index.js',
  'js/brain/local.js',
  'js/brain/claude.js',
  'js/tools/index.js',
  'js/tools/memory.js',
  'js/tools/email.js',
  'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // a missing optional file must not block install
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts, model endpoint: never cached

  e.respondWith(
    caches.match(request).then((hit) => {
      if (hit) {
        // Serve instantly, refresh quietly in the background.
        e.waitUntil(
          fetch(request)
            .then((res) => res.ok && caches.open(CACHE).then((c) => c.put(request, res.clone())))
            .catch(() => {})
        );
        return hit;
      }
      return fetch(request).catch(() => caches.match('index.html'));
    })
  );
});
