import { putEntries, getEntry } from './db.js';
import { entry, newId } from './model.js';

// Pictures and files dropped or pasted into the writing. Like everything else,
// the device is the first copy: the file is kept here at once (in its own
// small database, so the main one never has to change shape for it) and goes
// up to the cloud's file storage when there's a connection. What other devices
// learn through sync is a small "file" entry (name, type, size); they fetch
// the file itself the first time it's shown, and keep it from then on.
//
// In the text, a file is a small inline piece that names the entry, so it
// moves, gets copied and gets backed up with the paragraph or line it sits in.

const DB = 'writing-files';
export const MAX_BYTES = 50 * 1024 * 1024;
const MAX_SIDE = 2560;

let dbp = null;
function open() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blobs', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const result = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function store(mode = 'readonly') { return (await open()).transaction('blobs', mode).objectStore('blobs'); }

export async function localFile(id) { return result((await store()).get(id)); }
async function keep(row) { return result((await store('readwrite')).put(row)); }

// The cloud side, set once sync knows who's signed in.
let backend = null;
let userId = null;
const waiting = new Map();
export function setFileBackend(b, uid) { backend = b; userId = uid; if (b && uid) uploadPending(); }
const pathOf = (id) => `${userId}/${id}`;

// Big photos are scaled down to a sensible size for reading on a screen,
// which keeps the vault (and the nightly backup) small. Anything else is kept
// exactly as it is.
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return { blob: file };
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return { blob: file }; }
  const { width: w, height: h } = bmp;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  if (scale === 1 && file.size < 2 * 1024 * 1024) { bmp.close?.(); return { blob: file, w, h }; }
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d').drawImage(bmp, 0, 0, cw, ch);
  bmp.close?.();
  // PNGs (screenshots, drawings) stay sharp; photos become JPEGs.
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((res) => canvas.toBlob(res, type, 0.86));
  if (!blob || blob.size >= file.size) return { blob: file, w, h };
  return { blob, w: cw, h: ch };
}

const extOf = (type, name) => {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name || '');
  if (type === 'image/jpeg') return 'jpg';
  return m ? m[1].toLowerCase() : (type.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '');
};

// Keeps a dropped or pasted file and returns its entry, or null if too big.
export async function addFile(file) {
  if (!file || file.size > MAX_BYTES) return null;
  const { blob, w, h } = await shrink(file);
  const type = blob.type || file.type || 'application/octet-stream';
  let name = file.name || '';
  if (!name || name === 'image.png') name = `${type.startsWith('image/') ? 'Picture' : 'File'} ${new Date().toLocaleDateString()}.${extOf(type, name)}`;
  else if (blob !== file && type === 'image/jpeg') name = name.replace(/\.\w+$/, '') + '.jpg';
  const id = newId('fi');
  await keep({ id, blob, type, uploaded: false });
  const row = entry('file', { id, title: name, fields: { type, size: blob.size, ...(w ? { w, h } : {}) } });
  await putEntries([row]);
  uploadPending();
  return row;
}

// Sends what hasn't gone up yet, one at a time. Failing is fine: it tries
// again on the next sync.
let uploading = null;
export function uploadPending() {
  if (!backend?.upload || !userId) return Promise.resolve(0);
  uploading ||= (async () => {
    let sent = 0;
    const rows = await result((await store()).getAll());
    for (const r of rows.filter((x) => !x.uploaded)) {
      try {
        await backend.upload(pathOf(r.id), r.blob, r.type);
        await keep({ ...r, uploaded: true });
        sent += 1;
      } catch (e) {
        console.warn('file upload failed, will retry', e);
        break;
      }
    }
    return sent;
  })().finally(() => { uploading = null; });
  return uploading;
}

export async function unsentFiles() {
  const rows = await result((await store()).getAll());
  return rows.filter((r) => !r.uploaded).length;
}

// The file itself: from this device, or fetched from the cloud once and kept.
export async function fileBlob(id) {
  const here = await localFile(id);
  if (here) return here.blob;
  if (!backend?.download || !userId) return null;
  if (!waiting.has(id)) {
    waiting.set(id, (async () => {
      try {
        const blob = await backend.download(pathOf(id));
        if (!blob) return null;
        const meta = await getEntry(id);
        await keep({ id, blob, type: meta?.fields?.type || blob.type, uploaded: true });
        return blob;
      } catch {
        return null;
      } finally {
        waiting.delete(id);
      }
    })());
  }
  return waiting.get(id);
}

const urls = new Map();
export async function fileUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const blob = await fileBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export const isImage = (type) => /^image\//.test(type || '');

export function sizeLabel(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Where a file sits in a backup: Files/<id>-<name>, safe on every computer.
export function filePath(id, name) {
  const safe = (name || 'file').replace(/[\\/:*?"<>|#\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
  return `Files/${id}-${safe}`;
}
