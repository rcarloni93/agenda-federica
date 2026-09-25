const CACHE = 'federica-agenda-v5';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './firebase-config.js',
  './db.js',
  './geo.js',
  './finance.js',
  './app.js',
  './sync.js',
  './auth.js',
  './manifest.json',
  './icons/icon.svg',
];

// Cached opportunistically (see fetch handler below) rather than at install
// time: Cache.addAll fails the whole install if any single cross-origin
// fetch has trouble, so these are picked up the first time they're
// actually requested instead, then served from cache when offline after.
const CACHEABLE_CROSS_ORIGIN = new Set([
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-compat.js',
]);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Manages same-origin requests (the app shell) plus the specific
// whitelisted cross-origin Firebase SDK files above. Everything else
// cross-origin — Nominatim/OSRM geocoding and routing calls, Google
// Fonts — passes straight to the network so it's never accidentally
// served stale from cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isSameOrigin = url.origin === location.origin;
  if (!isSameOrigin && !CACHEABLE_CROSS_ORIGIN.has(e.request.url)) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
