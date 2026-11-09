// Service worker for the installable singer app. Always tries the network first (data must be live);
// the cached copy is only a fallback so the app still opens with a friendly message when offline.
const CACHE = 'rrs-app-v1';
const SHELL = ['app.html', 'css/style.css', 'css/app.css', 'js/common.js', 'js/app.js', 'img/app-192.png', 'img/logo-mark.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin || req.url.includes('/api/')) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('app.html', { ignoreSearch: true }))));
});
