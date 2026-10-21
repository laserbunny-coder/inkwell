// Keeps the app working with no signal. The page itself is fetched fresh when
// online (so updates arrive) and served from cache when offline; built files
// have unique names, so they are served from cache first.
const CACHE = 'inkwell-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isPage = req.mode === 'navigate';
  const isAsset = url.origin === location.origin && url.pathname.includes('/assets/');
  const isFont = url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  // Pages, the manifest and icons: fresh when online, so a new name or icon arrives.
  if (isPage || (url.origin === location.origin && !isAsset)) {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then((r) => r || (isPage ? caches.match('./') : Response.error()))));
  } else if (isAsset || isFont) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
