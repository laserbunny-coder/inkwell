import { putEntries, getEntry, children, getMeta, setMeta, topTags, eachEntry, CLAUDE } from './db.js';
import { withTag } from './capture.js';
import { entry, tagsIn } from './model.js';
import { GAP } from './order.js';
import { addFile, isAudio } from './files.js';
import { queueMeeting } from './meeting.js';

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

// Kept for the app the same way the service worker keeps a share: the
// "Save to Inkwell" bookmark on a computer opens ?save=<address>&title=<name>.
export async function keepShare({ url = '', title = '', text = '' }) {
  const db = await openInbox();
  await result(db.transaction('shares', 'readwrite').objectStore('shares').put({ at: Date.now(), url, title, text, files: [] }));
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/i;

// A line that's nothing but a web address (pasted, or typed and left):
// returns the address, or null.
export function bareLink(text) {
  const t = (text || '').trim().replace(/[).,;!?]+$/, '');
  if (!t || /\s/.test(t)) return null;
  const u = /^www\./i.test(t) ? `https://${t}` : t;
  if (!/^https?:\/\/[^/?#]+\.[^/?#]+/i.test(u)) return null;
  try { return new URL(u).href; } catch { return null; }
}

// What a caught link shows until its snapshot names it: the site.
export function linkLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// A link pasted or typed on a line of its own (on any day or page) gets what
// a link shared from the phone gets: a snapshot with its real title, picture,
// a short summary under it and a tag. The line already shows the site's name
// as a link (see linkcatch.js); this marks it and puts it in the queue.
export async function catchLink(lineId, url) {
  const line = await getEntry(lineId);
  if (!line || line.deleted || line.fields?.url || line.fields?.mirror) return null;
  const row = { ...line, fields: { ...line.fields, capture: 'share', url }, updated_at: Date.now() };
  await putEntries([row]);
  await queue({ line: lineId, url, named: false, picture: false, wrote: line.text, label: line.text, at: Date.now() });
  return row;
}

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

// A shared title that's only the site's name ("YouTube") doesn't name the page,
// so the snapshot's real title replaces it.
export function namesPage(title, link) {
  const t = (title || '').trim().toLowerCase().replace(/^www\./, '');
  if (!t) return false;
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
    return t !== host && !host.split('.').includes(t.replace(/\s+/g, ''));
  } catch { return true; }
}

const fileNode = (row) => ({ type: 'file', attrs: { id: row.id, name: row.title, type: row.fields.type, size: row.fields.size, duration: row.fields.duration || 0 } });
const textOf = (content) => (content || []).map((n) => (n.type === 'text' ? n.text : n.type === 'entryRef' ? n.attrs?.title || '' : '')).join('');
const blankFields = { done: false, gather: null, gathered: null, mirror: null };

// Puts one share on today's page: the picture(s), the link under its name and
// any words that came with it. Claude's summary lands right under it later.
// Returns { line, rows }.
export async function addShare(share, day = today(), skipped = []) {
  const { link, name, words } = readShare(share);
  const files = [];
  for (const f of share.files || []) {
    const file = f instanceof File ? f : new File([f.blob], f.name || 'Shared', { type: f.type });
    const row = await addFile(file);
    if (row) files.push(row); else skipped.push(file.name);
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
  rows.push(line, ...files);
  await putEntries([...rows.filter((r) => !files.includes(r))]);
  // A shared recording is written out: a meeting becomes a meeting page, one voice an idea.
  const audio = files.find((f) => isAudio(f.fields.type));
  if (audio) await queueMeeting({ line: line.id, file: audio.id, wrote: text, at: Date.now() });
  if (link) await queue({ line: line.id, url: link, named: namesPage(share.title, link), picture: files.some((f) => /^image\//.test(f.fields.type)), wrote: text, at: Date.now() });
  return { line, rows };
}

// Everything shared since the app last looked, oldest first.
// Files too big to keep are named in `skipped`.
export async function takeShares(skipped = []) {
  let inbox;
  try { inbox = await takeInbox(); } catch { return []; }
  const out = [];
  for (const s of inbox.all.sort((a, b) => a.at - b.at)) {
    try {
      const added = await addShare(s, today(), skipped);
      if (added) out.push(added);
    } catch (e) { console.error(e); continue; }
    await inbox.done(s.at);
  }
  return out;
}

// Shares used to come with an empty line under them to write on, which sat
// between the link and its summary. Once per device, empty ones are taken away.
export async function tidyShareBlanks() {
  if (await getMeta('shareBlanksTidied')) return [];
  const shares = [];
  await eachEntry((r) => { if (r.kind === 'line' && !r.deleted && r.fields?.capture === 'share') shares.push(r.id); });
  const rows = [];
  const now = Date.now();
  for (const id of shares) {
    for (const kid of await children(id)) {
      if (kid.kind !== 'line' || kid.deleted || (kid.text || '').trim() || (kid.content || []).length) continue;
      if ((await children(kid.id)).some((g) => !g.deleted)) continue;
      rows.push({ ...kid, deleted: true, updated_at: now });
    }
  }
  if (rows.length) await putEntries(rows);
  await setMeta('shareBlanksTidied', now);
  return rows;
}

// ---------- snapshots of shared links ----------

async function waiting() { return (await getMeta('snapshotQueue')) || []; }
async function queue(item) { await setMeta('snapshotQueue', [...(await waiting()).filter((q) => q.line !== item.line), item]); }
async function unqueue(lineId) { await setMeta('snapshotQueue', (await waiting()).filter((q) => q.line !== lineId)); }

let busy = null;
// typing(lineId) says the line is on the page being written on and its last
// words aren't saved yet: the snapshot waits for a pause, so it can't be
// written over by the next save.
export function snapshotPending({ ask, canAsk, onRows, typing = () => false }) {
  busy ||= (async () => {
    const items = await waiting();
    if (!items.length || !canAsk()) return;
    for (const it of items) {
      let snap;
      try {
        snap = await ask({ mode: 'snapshot', url: it.url, words: it.wrote || '', tags: await topTags(40) });
      } catch (e) {
        // A page that can't be read stays a plain link; anything else tries again later.
        if (e.status && e.status < 500 && e.status !== 429) await unqueue(it.line);
        continue;
      }
      for (let waited = 0; typing(it.line) && waited < 60000; waited += 400) await new Promise((r) => setTimeout(r, 400));
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
export async function placeSnapshot(it, { title = '', summary = '', site = '', image = null, tag = '' }) {
  const line = await getEntry(it.line);
  if (!line || line.deleted) return [];
  const rows = [];
  const now = Date.now();
  let content = line.content || [];
  // A caught link keeps its name in place even once words are written after
  // it ("x.com love this" becomes "<title> love this").
  const same = line.text === it.wrote;
  const named = (n) => n.type === 'text' && n.marks?.some((m) => m.type === 'link' && (!it.label || m.attrs?.href === it.url)) && (same || (it.label && n.text === it.label));
  if (same || it.label) {
    if (title && !it.named) content = content.map((n) => (named(n) ? { ...n, text: title } : n));
    if (image?.id && !it.picture && !content.some((n) => n.type === 'file')) {
      const file = entry('file', { id: image.id, title: image.name || 'Picture', fields: { type: image.type, size: image.size || 0, from: it.url } });
      rows.push(file);
      content = [fileNode(file), { type: 'text', text: ' ' }, ...content];
    }
  }
  const text = textOf(content);
  rows.push(withTag({ ...line, content, text, tags: tagsIn(text), fields: { ...line.fields, snapshot: { title, summary, site, image: image?.id || null, at: now } }, updated_at: now }, tag));
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
