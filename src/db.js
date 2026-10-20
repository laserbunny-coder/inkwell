// Local storage for everything the app writes. Every piece of writing is an
// "entry": a project, act, chapter, paragraph, scene break, note, and later
// daily-page lines and vault captures. Entries share one shape so anything can
// be linked to and tagged. Past versions live in their own store so they never
// slow down the live draft.

const DB_NAME = 'writing';
const DB_VERSION = 2;

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('parent_id', 'parent_id');
        entries.createIndex('kind', 'kind');
        entries.createIndex('updated_at', 'updated_at');
        const snaps = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
        snaps.createIndex('chapter_id', 'chapter_id');
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (e.oldVersion < 2) {
        // Ids of entries changed on this device and not yet sent to the cloud.
        const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
        // Everything written before sync existed still needs sending once.
        const tx = req.transaction;
        tx.objectStore('entries').openCursor().onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return;
          outbox.put({ id: c.value.id });
          c.continue();
        };
        // A copy of the other device's version whenever both changed the same entry offline.
        db.createObjectStore('conflicts', { keyPath: 'key', autoIncrement: true });
      }
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

let onLocalWrite = () => {};
export function onLocalWrites(fn) { onLocalWrite = fn; }

// Writes many entries in one transaction, so a save either lands whole or not
// at all. Local writes are also queued for the cloud in the same transaction.
export async function putEntries(rows, { fromSync = false } = {}) {
  if (!rows.length) return;
  const db = await open();
  const tx = db.transaction(['entries', 'outbox'], 'readwrite');
  const store = tx.objectStore('entries');
  const outbox = tx.objectStore('outbox');
  for (const r of rows) {
    const { chapters, ...row } = r;
    store.put(row);
    if (!fromSync) outbox.put({ id: row.id });
  }
  await done(tx);
  if (!fromSync) onLocalWrite();
}

export async function outboxIds() {
  const db = await open();
  return (await result(db.transaction('outbox').objectStore('outbox').getAllKeys()));
}

// Clears sent entries from the queue, unless they changed again while sending.
export async function clearOutbox(sent) {
  const db = await open();
  const tx = db.transaction(['entries', 'outbox'], 'readwrite');
  const entries = tx.objectStore('entries');
  const outbox = tx.objectStore('outbox');
  for (const { id, updated_at, server_at } of sent) {
    entries.get(id).onsuccess = (e) => {
      const now = e.target.result;
      if (now && now.updated_at !== updated_at) return;
      outbox.delete(id);
      // Take the server's timestamp, so this change isn't pulled back down as new.
      if (now && server_at) entries.put({ ...now, updated_at: server_at });
    };
  }
  return done(tx);
}

export async function dropFromOutbox(ids) {
  const db = await open();
  const tx = db.transaction('outbox', 'readwrite');
  for (const id of ids) tx.objectStore('outbox').delete(id);
  return done(tx);
}

export async function addConflict(row) {
  const db = await open();
  const tx = db.transaction('conflicts', 'readwrite');
  tx.objectStore('conflicts').add({ ...row, saved_at: Date.now() });
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
