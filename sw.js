// Heartbeat service worker: opens fast and works offline.
//  - App shell: cached on install, updated in the background.
//  - TMDB data (/api/tmdb): network first, saved copy when offline.
//  - Posters & backdrops: not touched here (the browser loads and caches them itself).
const VERSION = 'v42';
const SHELL = `hb-shell-${VERSION}`, API = 'hb-api', IMG = 'hb-img', IMG_MAX = 200;
const FILES = ['/', '/index.html', '/manifest.json', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png',
  '/css/app.css', '/css/icons.css', '/js/app.js', '/js/config.js', '/js/data.js', '/js/store.js', '/js/tmdb.js', '/js/ui.js', '/js/journey.js',
  '/js/screens/home.js', '/js/screens/detail.js', '/js/screens/quickrate.js', '/js/screens/me.js', '/js/screens/search.js',
  '/js/screens/match.js', '/js/screens/list.js', '/js/screens/feed.js', '/js/screens/about.js',
  '/js/cloud.js', '/js/screens/auth.js', '/js/reviews.js', '/js/screens/reviews.js',
  '/js/social.js', '/js/screens/people.js', '/js/vendor/qrcode.js', '/js/screens/chat.js', '/js/screens/recs.js', '/js/screens/plus.js', '/js/screens/wrapped.js', '/js/screens/play.js', '/js/screens/security.js', '/js/screens/admin.js', '/js/screens/studio.js', '/js/legal.js', '/js/screens/legal.js', '/js/screens/upcoming.js', '/js/screens/boxoffice.js', '/js/screens/taste.js', '/js/motion.js', '/icons/tmdb.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('hb-shell-') && k !== SHELL || k.startsWith('heartbeat-') || k === IMG).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;

  // Posters & backdrops (image.tmdb.org) are left to the browser and its normal cache.
  if (url.origin !== location.origin) return;

  // Backend settings: always ask the network (never cache).
  if (url.pathname === '/api/config' || url.pathname === '/api/img' || url.pathname === '/api/billing' || url.pathname === '/api/stripe-webhook' || url.pathname === '/api/review-check' || url.pathname === '/api/studio-summary') return;
  // TMDB data: network first, cached copy when offline.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(API).then(c => c.put(req, cp)); } return r; })
      .catch(() => caches.match(req).then(r => r || new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } }))));
    return;
  }

  // Pages: network first so updates show up, cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(SHELL).then(c => c.put('/', cp)); return r; })
      .catch(() => caches.match('/', { ignoreSearch: true }).then(r => r || caches.match('/index.html'))));
    return;
  }

  // Code and styles (.js / .css): always try the network first so a new version shows up right away;
  // fall back to the saved copy when offline or very slow.
  if (/\.(js|css|mjs)$/.test(url.pathname)) {
    e.respondWith(caches.open(SHELL).then(async c => {
      const net = fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
      const slow = new Promise(res => setTimeout(res, 4000));
      try { const r = await Promise.race([net, slow.then(() => null)]); if (r) return r; } catch (er) { /* offline */ }
      return (await c.match(req, { ignoreSearch: true })) || net;
    }));
    return;
  }
  // Icons, fonts, images: serve fast from cache, refresh in the background.
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
