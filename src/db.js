// Local storage for everything the app writes. Every piece of writing is an
// "entry": a project, act, chapter, paragraph, scene break, note, and later
// daily-page lines and vault captures. Entries share one shape so anything can
// be linked to and tagged. Past versions live in their own store so they never
// slow down the live draft.

import { bySort } from './order.js';

const DB_NAME = 'writing';
const DB_VERSION = 4;

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
      if (e.oldVersion < 3) {
        // Which entries mention which: one row per link, so "linked from" is a lookup, not a scan.
        req.transaction.objectStore('entries').createIndex('links', 'links', { multiEntry: true });
      }
      if (e.oldVersion < 4) {
        // One row per #tag, so a tag's lines are a lookup, not a scan.
        req.transaction.objectStore('entries').createIndex('tags', 'tags', { multiEntry: true });
      }
    };
    // An older copy of the app, open in another window or tab, is holding the
    // storage and the upgrade has to wait for it. Say so (and cover the page,
    // so nothing is typed that can't be saved yet); it carries on by itself
    // once that copy is closed.
    req.onblocked = () => showBlocked(true);
    req.onsuccess = () => {
      showBlocked(false);
      // A newer version of the app opened in another tab and needs to upgrade
      // storage: step aside and reload into the new version (the write-ahead
      // copy keeps anything not yet saved).
      req.result.onversionchange = () => { req.result.close(); location.reload(); };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function showBlocked(on) {
  let el = document.getElementById('storage-blocked');
  if (!on) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'storage-blocked';
  el.setAttribute('role', 'alert');
  el.innerHTML = '<div><p><strong>Finishing an update</strong></p><p>The writing app is also open in another window or tab with the older version. Close that copy and your writing will appear here. Nothing has been lost.</p></div>';
  document.body.append(el);
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

// Gone from view: deleted for good, or in the Trash (still there, and can come back).
export const isTrashed = (r) => !!r?.fields?.trashed;
const live = (r) => !r.deleted && !isTrashed(r);

export async function getEntry(id) {
  const db = await open();
  return result(db.transaction('entries').objectStore('entries').get(id));
}

export async function children(parentId) {
  const db = await open();
  const rows = await result(db.transaction('entries').objectStore('entries').index('parent_id').getAll(parentId));
  return rows.filter(live).sort(bySort);
}

export async function linkedFrom(id) {
  const db = await open();
  const rows = await result(db.transaction('entries').objectStore('entries').index('links').getAll(id));
  return rows.filter(live);
}

export async function byTag(tag) {
  const db = await open();
  const rows = await result(db.transaction('entries').objectStore('entries').index('tags').getAll(tag));
  return rows.filter(live);
}

export async function byKind(kind, { withTrash = false } = {}) {
  const db = await open();
  const rows = await result(db.transaction('entries').objectStore('entries').index('kind').getAll(kind));
  return rows.filter((r) => !r.deleted && (withTrash || !isTrashed(r)));
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
  if (!fromSync) onLocalWrite(rows);
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

export async function conflicts() {
  const db = await open();
  return result(db.transaction('conflicts').objectStore('conflicts').getAll());
}

export async function dropConflict(key) {
  const db = await open();
  const tx = db.transaction('conflicts', 'readwrite');
  tx.objectStore('conflicts').delete(key);
  return done(tx);
}

// Deleted entries stay behind as markers so every device hears they're gone.
// Once a marker is old and already sent to the cloud, this device can forget
// it. The cloud keeps its copy, so a device that's been away still learns.
export async function forgetDeleted(olderThan) {
  const db = await open();
  const tx = db.transaction(['entries', 'outbox'], 'readwrite');
  const entries = tx.objectStore('entries');
  const outbox = tx.objectStore('outbox');
  let count = 0;
  entries.index('updated_at').openCursor(IDBKeyRange.upperBound(olderThan)).onsuccess = (e) => {
    const c = e.target.result;
    if (!c) return;
    const row = c.value;
    if (row.deleted) {
      outbox.getKey(row.id).onsuccess = (ev) => { if (ev.target.result === undefined) { entries.delete(row.id); count += 1; } };
    }
    c.continue();
  };
  await done(tx);
  return count;
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
