// What's waiting to land on today's page: shares the service worker kept
// (public/sw.js) and links the Save to Inkwell bookmark kept (save.html).
// Nothing else is imported here, so the little save window stays small.

const INBOX = 'inkwell-share';
export function openInbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INBOX, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('shares', { keyPath: 'at' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const result = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function takeInbox() {
  const db = await openInbox();
  const all = await result(db.transaction('shares').objectStore('shares').getAll());
  return { all, done: (at) => result(db.transaction('shares', 'readwrite').objectStore('shares').delete(at)) };
}

// Kept for the app the same way the service worker keeps a share.
export async function keepShare({ url = '', title = '', text = '' }) {
  const db = await openInbox();
  await result(db.transaction('shares', 'readwrite').objectStore('shares').put({ at: Date.now(), url, title, text, files: [] }));
}

// The save window asks any Inkwell already open (same browser) to take it.
export const SAVE_CHANNEL = 'inkwell-save';
