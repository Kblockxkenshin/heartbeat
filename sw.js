// Offline support so Heartbeat installs like an app.
const CACHE = 'heartbeat-v2';
const FILES = ['./', './index.html', './manifest.json', './icon.svg', './css/app.css',
  './js/app.js', './js/config.js', './js/data.js', './js/store.js', './js/tmdb.js', './js/ui.js', './js/journey.js',
  './js/screens/home.js', './js/screens/detail.js', './js/screens/quickrate.js', './js/screens/me.js',
  './js/screens/search.js', './js/screens/match.js', './js/screens/list.js', './js/screens/feed.js', './js/screens/about.js'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // TMDB images: cache-first (they never change).
  if (url.host === 'image.tmdb.org') {
    e.respondWith(caches.open('heartbeat-img').then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
