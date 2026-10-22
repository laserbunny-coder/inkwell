import { putEntries, getEntry, children, getMeta, setMeta, CLAUDE } from './db.js';
import { entry, tagsIn } from './model.js';
import { GAP } from './order.js';
import { addFile } from './files.js';

// Share into Inkwell: from Chrome, Instagram, Pinterest or any Android app,
// Share, then Inkwell. The phone hands the shared page, picture or text to
// Inkwell's service worker (public/sw.js), which keeps it and opens the app;
// here it lands on today's page with an empty line under it for what it
// sparked. A link also gets a snapshot (its title, a picture and a short
// summary) when there's a connection, so it's still useful if the page
// disappears.

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// What the service worker kept, waiting for the app.
const INBOX = 'inkwell-share';
function openInbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INBOX, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('shares', { keyPath: 'at' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const result = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function takeInbox() {
  const db = await openInbox();
  const all = await result(db.transaction('shares').objectStore('shares').getAll());
  return { all, done: (at) => result(db.transaction('shares', 'readwrite').objectStore('shares').delete(at)) };
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;

// Shared bits, made sense of: the link, a name for it, and any other words.
export function readShare({ title = '', text = '', url = '' }) {
  const found = (text.match(URL_RE) || [])[0] || '';
  const link = (url || found).replace(/[).,;!?]+$/, '');
  let words = text.replace(link, '').replace(URL_RE, '').trim();
  let name = title.trim();
  // Words with no link are the capture itself; with a link, they're kept beside it.
  if (!name && !link && words && words.length <= 120 && !words.includes('\n')) { name = words; words = ''; }
  if (words === name) words = '';
  if (!name && link) { try { name = new URL(link).hostname.replace(/^www\./, ''); } catch { name = link; } }
  return { link, name, words };
}

const fileNode = (row) => ({ type: 'file', attrs: { id: row.id, name: row.title, type: row.fields.type, size: row.fields.size, duration: row.fields.duration || 0 } });
const textOf = (content) => (content || []).map((n) => (n.type === 'text' ? n.text : n.type === 'entryRef' ? n.attrs?.title || '' : '')).join('');
const blankFields = { done: false, gather: null, gathered: null, mirror: null };

// Puts one share on today's page: the picture(s), the link under its name and
// any words that came with it, then an empty line under it to write on.
// Returns { line, spark, rows }.
export async function addShare(share, day = today()) {
  const { link, name, words } = readShare(share);
  const files = [];
  for (const f of share.files || []) {
    const row = await addFile(f instanceof File ? f : new File([f.blob], f.name || 'Shared', { type: f.type }));
    if (row) files.push(row);
  }
  if (!link && !name && !words && !files.length) return null;
  const content = files.map(fileNode);
  const label = name || (files.length ? '' : words);
  if (label) {
    if (content.length) content.push({ type: 'text', text: ' ' });
    content.push({ type: 'text', text: label, ...(link ? { marks: [{ type: 'link', attrs: { href: link } }] } : {}) });
  }
  if (words && label !== words) content.push({ type: 'text', text: `${content.length ? ' — ' : ''}“${words}”` });
  const dayId = `day-${day}`;
  const rows = [];
  const dayRow = await getEntry(dayId);
  if (!dayRow || dayRow.deleted) rows.push({ ...(dayRow || entry('day', { id: dayId, title: day })), deleted: false, updated_at: Date.now() });
  const kids = await children(dayId);
  const sort = kids.length ? Math.max(...kids.map((k) => k.sort || 0)) + GAP : GAP;
  const text = textOf(content);
  const line = entry('line', { parent_id: dayId, sort, text, content, tags: tagsIn(text), fields: { ...blankFields, capture: 'share', ...(link ? { url: link } : {}) } });
  const spark = entry('line', { parent_id: line.id, sort: GAP, fields: { ...blankFields } });
  rows.push(line, ...files, spark);
  await putEntries([...rows.filter((r) => !files.includes(r))]);
  if (link) await queue({ line: line.id, url: link, named: !!share.title?.trim(), picture: files.some((f) => /^image\//.test(f.fields.type)), wrote: text, at: Date.now() });
  return { line, spark, rows };
}

// Everything shared since the app last looked, oldest first.
export async function takeShares() {
  let inbox;
  try { inbox = await takeInbox(); } catch { return []; }
  const out = [];
  for (const s of inbox.all.sort((a, b) => a.at - b.at)) {
    try {
      const added = await addShare(s, today());
      if (added) out.push(added);
    } catch (e) { console.error(e); continue; }
    await inbox.done(s.at);
  }
  return out;
}

// ---------- snapshots of shared links ----------

async function waiting() { return (await getMeta('snapshotQueue')) || []; }
async function queue(item) { await setMeta('snapshotQueue', [...(await waiting()).filter((q) => q.line !== item.line), item]); }
async function unqueue(lineId) { await setMeta('snapshotQueue', (await waiting()).filter((q) => q.line !== lineId)); }

let busy = null;
export function snapshotPending({ ask, canAsk, onRows }) {
  busy ||= (async () => {
    const items = await waiting();
    if (!items.length || !canAsk()) return;
    for (const it of items) {
      let snap;
      try {
        snap = await ask({ mode: 'snapshot', url: it.url });
      } catch (e) {
        // A page that can't be read stays a plain link; anything else tries again later.
        if (e.status && e.status < 500 && e.status !== 429) await unqueue(it.line);
        continue;
      }
      const rows = await placeSnapshot(it, snap || {});
      await unqueue(it.line);
      if (rows.length) onRows(rows);
    }
  })().catch((e) => console.error(e)).finally(() => { busy = null; });
  return busy;
}

// The snapshot is kept on the line (fields.snapshot). If the line is as it was
// shared, a better name goes on the link and the page's picture goes in front;
// the short summary goes under it as Claude's line, after yours.
export async function placeSnapshot(it, { title = '', summary = '', site = '', image = null }) {
  const line = await getEntry(it.line);
  if (!line || line.deleted) return [];
  const rows = [];
  const now = Date.now();
  let content = line.content || [];
  if (line.text === it.wrote) {
    if (title && !it.named) content = content.map((n) => (n.type === 'text' && n.marks?.some((m) => m.type === 'link') ? { ...n, text: title } : n));
    if (image?.id && !it.picture) {
      const file = entry('file', { id: image.id, title: image.name || 'Picture', fields: { type: image.type, size: image.size || 0, from: it.url } });
      rows.push(file);
      content = [fileNode(file), { type: 'text', text: ' ' }, ...content];
    }
  }
  const text = textOf(content);
  rows.push({ ...line, content, text, tags: tagsIn(text), fields: { ...line.fields, snapshot: { title, summary, site, image: image?.id || null, at: now } }, updated_at: now });
  if (summary) {
    const kids = await children(line.id);
    const id = `${line.id}-s`;
    const prev = kids.find((k) => k.id === id);
    const sort = prev?.sort ?? (kids.length ? Math.max(...kids.map((k) => k.sort || 0)) + GAP : GAP);
    rows.push({ ...(prev || entry('line', { id })), kind: 'line', parent_id: line.id, sort, text: summary, content: [{ type: 'text', text: summary }], tags: [], links: [], deleted: false, updated_at: now, fields: { ...(prev?.fields || {}), ...blankFields }, _by: CLAUDE });
  }
  await putEntries(rows);
  return rows;
}
