// Service worker: lets the app open offline. Same-origin files are fetched
// from the network first so updates show up right away, and the last copy is
// kept for when there is no connection. GitHub API calls are never touched.

const CACHE = 'vault-shell-v3';
const SHELL = [
  './',
  'index.html',
  'help.md',
  'app.css',
  'app.js',
  'markdown.js',
  'vault.js',
  'github.js',
  'state.js',
  'graph.js',
  'voice.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/IMFellEnglish.ttf',
  'fonts/Cinzel.ttf',
  'fonts/Inter.ttf',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
      )
  );
});
