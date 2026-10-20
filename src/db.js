// Local storage for everything the app writes. Every piece of writing is an
// "entry": a project, act, chapter, paragraph, scene break, note, and later
// daily-page lines and vault captures. Entries share one shape so anything can
// be linked to and tagged. Past versions live in their own store so they never
// slow down the live draft.

const DB_NAME = 'writing';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('parent_id', 'parent_id');
      entries.createIndex('kind', 'kind');
      entries.createIndex('updated_at', 'updated_at');
      const snaps = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
      snaps.createIndex('chapter_id', 'chapter_id');
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getEntry(id) {
  const db = await open();
  return result(db.transaction('entries').objectStore('entries').get(id));
}

export async function children(parentId) {
  const db = await open();
  const rows = await result(db.transaction('entries').objectStore('entries').index('parent_id').getAll(parentId));
  return rows.filter((r) => !r.deleted).sort((a, b) => a.sort - b.sort);
}

export async function byKind(kind) {
  const db = await open();
  const rows = await result(db.transaction('entries').objectStore('entries').index('kind').getAll(kind));
  return rows.filter((r) => !r.deleted);
}

// Writes many entries in one transaction, so a save either lands whole or not at all.
export async function putEntries(rows) {
  if (!rows.length) return;
  const db = await open();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');
  for (const r of rows) store.put(r);
  return done(tx);
}

export async function addSnapshot(snap) {
  const db = await open();
  const tx = db.transaction('snapshots', 'readwrite');
  tx.objectStore('snapshots').add(snap);
  return done(tx);
}

export async function snapshots(chapterId) {
  const db = await open();
  const rows = await result(db.transaction('snapshots').objectStore('snapshots').index('chapter_id').getAll(chapterId));
  return rows.sort((a, b) => b.at - a.at);
}

export async function getMeta(key) {
  const db = await open();
  const row = await result(db.transaction('meta').objectStore('meta').get(key));
  return row ? row.value : undefined;
}

export async function setMeta(key, value) {
  const db = await open();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  return done(tx);
}

export async function allEntries() {
  const db = await open();
  return result(db.transaction('entries').objectStore('entries').getAll());
}
