// Keeps the app working with no signal. The page itself is fetched fresh when
// online (so updates arrive) and served from cache when offline; built files
// have unique names, so they are served from cache first.
const CACHE = 'inkwell-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

// Share into Inkwell: Android sends what was shared here (see share_target in
// the manifest). It's kept in a small database for the app, which then opens
// and puts it on today's page (src/share.js).
async function takeShare(req) {
  const form = await req.formData();
  const files = form.getAll('files').filter((f) => f && typeof f !== 'string' && f.size);
  const share = {
    at: Date.now(),
    title: String(form.get('title') || ''),
    text: String(form.get('text') || ''),
    url: String(form.get('url') || ''),
    files: await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, blob: new Blob([await f.arrayBuffer()], { type: f.type }) })))
  };
  await new Promise((resolve, reject) => {
    const open = indexedDB.open('inkwell-share', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('shares', { keyPath: 'at' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('shares', 'readwrite');
      tx.objectStore('shares').put(share);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
  });
  return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share')) {
    e.respondWith(takeShare(req).catch(() => Response.redirect(new URL('./', self.registration.scope).href, 303)));
    return;
  }
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
