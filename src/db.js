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

export async function children(parentId, { withTrash = false } = {}) {
  const db = await open();
  const rows = await result(db.transaction('entries').objectStore('entries').index('parent_id').getAll(parentId));
  return rows.filter((r) => !r.deleted && (withTrash || !isTrashed(r))).sort(bySort);
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

// The most used tags, most first. Counts from the tags index's keys alone
// (no rows read), then checks each has at least one live entry, so a big
// vault doesn't load every line to draw the shelf.
export async function topTags(limit = 30) {
  const db = await open();
  const index = db.transaction('entries').objectStore('entries').index('tags');
  const counts = new Map();
  await new Promise((resolve, reject) => {
    const req = index.openKeyCursor();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      counts.set(c.key, (counts.get(c.key) || 0) + 1);
      c.continue();
    };
  });
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([t]) => t);
  const hasLive = (tag) => new Promise((resolve, reject) => {
    const req = db.transaction('entries').objectStore('entries').index('tags').openCursor(tag);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(false);
      if (live(c.value)) return resolve(true);
      c.continue();
    };
  });
  const out = [];
  for (const t of ranked) {
    if (out.length >= limit) break;
    if (await hasLive(t)) out.push(t);
  }
  return out;
}

// Every (tag, entry) pair, one entry per tag it carries.
export async function eachTagged(fn) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const req = db.transaction('entries').objectStore('entries').index('tags').openCursor();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      fn(c.key, c.value);
      c.continue();
    };
  });
}

export async function byKind(kind, { withTrash = false } = {}) {
  const db = await open();
  const rows = await result(db.transaction('entries').objectStore('entries').index('kind').getAll(kind));
  return rows.filter((r) => !r.deleted && (withTrash || !isTrashed(r)));
}

let onLocalWrite = () => {};
export function onLocalWrites(fn) { onLocalWrite = fn; }

// Who is writing on this device: the signed-in person's id once sync knows
// it, 'me' (the owner of this vault) before that. Claude's words carry
// 'claude'. Every entry keeps who made it (fields.by) and who last changed
// its words (fields.edited_by); entries from before this have neither and
// are the owner's.
let writer = 'me';
export function setWriter(id) { writer = id || 'me'; }
export const CLAUDE = 'claude';

// A row may say who wrote it this time (`_by`, for words Claude wrote);
// otherwise it's whoever is writing here, but only when its words changed,
// so moving, sorting or trashing something keeps its author.
function stamp(row, prev, by) {
  const fields = row.fields || {};
  const who = by || writer;
  if (!prev) return { ...row, fields: { ...fields, by: fields.by || who, edited_by: by || fields.edited_by || fields.by || who } };
  // A copy of the row from before it was last saved still keeps the authors.
  const kept = { ...fields };
  if (!kept.by && prev.fields?.by) kept.by = prev.fields.by;
  if (!kept.edited_by && prev.fields?.edited_by) kept.edited_by = prev.fields.edited_by;
  const changed = (row.text || '') !== (prev.text || '') || (row.title || '') !== (prev.title || '');
  if (changed || by) kept.edited_by = who;
  return { ...row, fields: kept };
}

// Writes many entries in one transaction, so a save either lands whole or not
// at all. Local writes are also queued for the cloud in the same transaction.
export async function putEntries(rows, { fromSync = false, stamp: stamping = !fromSync } = {}) {
  if (!rows.length) return;
  const db = await open();
  // A deletion dated before the clean-up's last pass (one restored from a
  // backup, say) moves that mark back, so the next pass still sees it.
  const oldest = Math.min(...rows.filter((r) => r.deleted).map((r) => r.updated_at || 0));
  const late = oldest < Date.now() - 7 * 864e5;
  const tx = db.transaction(late ? ['entries', 'outbox', 'meta'] : ['entries', 'outbox'], 'readwrite');
  const store = tx.objectStore('entries');
  const outbox = tx.objectStore('outbox');
  for (const r of rows) {
    const { chapters, _by, ...row } = r;
    if (stamping) store.get(row.id).onsuccess = (e) => store.put(stamp(row, e.target.result, _by));
    else store.put(row);
    if (!fromSync) outbox.put({ id: row.id });
  }
  if (late) {
    const meta = tx.objectStore('meta');
    meta.get('forgotThrough').onsuccess = (e) => {
      const was = e.target.result?.value;
      if (was !== undefined && oldest < was) meta.put({ key: 'forgotThrough', value: oldest });
    };
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
  // Only what's newly old since the last pass is looked at, a few thousand at
  // a time, so this never holds up reading and writing.
  const since = (await getMeta('forgotThrough')) || 0;
  if (since >= olderThan) return 0;
  const db = await open();
  const tx = db.transaction(['entries', 'outbox'], 'readwrite');
  const entries = tx.objectStore('entries');
  const outbox = tx.objectStore('outbox');
  let count = 0;
  let seen = 0;
  let through = olderThan;
  let waiting = Infinity;
  entries.index('updated_at').openCursor(IDBKeyRange.bound(since, olderThan)).onsuccess = (e) => {
    const c = e.target.result;
    if (!c) return;
    if (seen >= 5000) { through = c.key; return; }
    seen += 1;
    const row = c.value;
    if (row.deleted) {
      const at = c.key;
      outbox.getKey(row.id).onsuccess = (ev) => {
        if (ev.target.result === undefined) { entries.delete(row.id); count += 1; }
        // Not sent yet: look at it again next time.
        else waiting = Math.min(waiting, at);
      };
    }
    c.continue();
  };
  await done(tx);
  await setMeta('forgotThrough', Math.min(through, waiting));
  return count;
}

// Every entry except old versions, handed to `fn` a slice at a time with a
// pause between slices, so saves and other reads get through meanwhile.
export async function eachEntry(fn, { batch = 2000 } = {}) {
  const db = await open();
  let after = null;
  for (;;) {
    const range = after === null ? null : IDBKeyRange.lowerBound(after, true);
    const rows = await result(db.transaction('entries').objectStore('entries').getAll(range, batch));
    for (const r of rows) if (r.kind !== 'version') fn(r);
    if (rows.length < batch) return;
    after = rows[rows.length - 1].id;
    await new Promise((res) => setTimeout(res, 0));
  }
}

// Several entries in one go (missing ones come back undefined).
export async function getMany(ids) {
  const db = await open();
  const store = db.transaction('entries').objectStore('entries');
  return Promise.all(ids.map((id) => result(store.get(id))));
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

export async function allSnapshots() {
  const db = await open();
  return result(db.transaction('snapshots').objectStore('snapshots').getAll());
}

export async function dropSnapshots(ids) {
  const db = await open();
  const tx = db.transaction('snapshots', 'readwrite');
  for (const id of ids) tx.objectStore('snapshots').delete(id);
  return done(tx);
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

// Every entry. Saved versions (History's full copies of a chapter or page)
// are left out unless asked for: they pile up over the years, and lists,
// search and the Trash never need them. They're read straight from the kind
// index on both sides of 'version', so they aren't even loaded.
export async function allEntries({ versions = false } = {}) {
  const db = await open();
  const tx = db.transaction('entries');
  if (versions) return result(tx.objectStore('entries').getAll());
  const kind = tx.objectStore('entries').index('kind');
  const [before, after] = await Promise.all([
    result(kind.getAll(IDBKeyRange.upperBound('version', true))),
    result(kind.getAll(IDBKeyRange.lowerBound('version', true)))
  ]);
  return before.concat(after);
}
