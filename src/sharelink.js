import { byKind, getEntry, putEntries, getMeta, setMeta } from './db.js';
import { entry, noteTypes, saveNoteTypes } from './model.js';
import { pieceDoc, pageDoc } from './drafts.js';
import { worldOf, bookType } from './library.js';

// Share links: a piece or a bible page that anyone with the link can read,
// and comment on, with no account. What they read is a copy this app sends
// up (the words only, in reading order: never notes, the grid, other pieces,
// day pages or anything of Daybook's), and it's sent again as you write.
// Comments come back as margin notes in their own Comments category.
//
// The share itself is an entry (kind 'share', id sh-<what's shared>) so both
// devices know about it, and a backup has it.

export const shareId = (rootId) => `sh-${rootId}`;
export const COMMENT_TYPE = { id: 'comment', name: 'Comments', color: '#2E8B7A' };
export const CLAUDE_TYPE = { id: 'claude', name: 'Claude', color: '#9C7A45' };

// A link's secret: 24 letters and digits (about 140 bits), so it can't be guessed.
export function newToken() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => abc[b % 62]).join('');
}

export const linkFor = (token, here = location.href) => `${new URL('read.html', here.split('#')[0].split('?')[0]).href}#${token}`;

// The reader's copy, as small as it can be.
const compact = (b) => {
  const out = { id: b.eid, k: b.kind === 'heading' ? 'h' : b.kind === 'para' ? 'p' : b.kind, r: b.runs };
  if (b.el) out.el = b.el;
  if (b.kind === 'heading' && b.level) out.lv = b.level;
  if (b.kind === 'scene' && b.level > 1) out.lv = b.level;
  if (b.code) out.code = b.code;
  if (b.kind === 'line') { out.d = b.depth; if (b.done) out.done = true; }
  return out;
};

export async function shareContent(root) {
  const page = root.kind === 'page';
  const chapters = page ? await pageDoc(root) : await pieceDoc(root.id);
  return {
    v: 1,
    type: page ? 'page' : bookType(root) === 'screenplay' ? 'screenplay' : 'novel',
    title: root.title || 'Untitled',
    chapters: chapters.map((ch) => ({ id: ch.id, title: ch.title, blocks: ch.blocks.filter((b) => b.eid).map(compact) }))
  };
}

// A short fingerprint, so the copy is only sent when the words changed.
export function hashOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

// A note category is added the first time it's needed.
export async function ensureNoteType(type) {
  const types = await noteTypes();
  if (types.some((t) => t.id === type.id)) return types;
  const next = [...types, type];
  await saveNoteTypes(next);
  return next;
}

export async function sharesOf() {
  return (await byKind('share')).filter((s) => !s.deleted && !s.fields?.revoked);
}

export class Sharing {
  constructor({ backend, user, onComments }) {
    this.backend = backend;
    this.user = user;
    this.onComments = onComments || (() => {});
    this.busy = null;
  }

  get ready() { return !!this.user() && !!this.backend()?.saveShare && navigator.onLine !== false; }

  async current(root) {
    const s = await getEntry(shareId(root.id));
    return s && !s.deleted && !s.fields?.revoked ? s : null;
  }

  // Turn sharing on: make the link and send the first copy.
  async start(root, { comments = true } = {}) {
    const prev = await getEntry(shareId(root.id));
    const token = prev?.fields?.token && !prev.fields.revoked ? prev.fields.token : newToken();
    const world = await worldOf(root);
    const row = { ...(prev || entry('share', { id: shareId(root.id) })), title: root.title || '', deleted: false, updated_at: Date.now(),
      fields: { token, root: root.id, kind: root.kind === 'page' ? 'page' : 'piece', world: world?.id || null, comments, revoked: false, hash: null, sent: null } };
    await this.send(row, root, true);
    return row;
  }

  // Send the reader's copy if the words changed since it was last sent.
  async send(share, root, force = false) {
    root = root || (await getEntry(share.fields.root));
    if (!root || root.deleted) return false;
    const content = await shareContent(root);
    const hash = hashOf(JSON.stringify(content) + (share.fields.comments ? '1' : '0'));
    if (!force && hash === share.fields.hash) return false;
    await this.backend().saveShare({
      id: share.fields.token, root_id: root.id, world_id: share.fields.world, kind: share.fields.kind,
      title: root.title || 'Untitled', content, can_comment: !!share.fields.comments, revoked: false
    });
    await putEntries([{ ...share, title: root.title || '', fields: { ...share.fields, hash, sent: Date.now() }, updated_at: Date.now() }]);
    return true;
  }

  async setComments(share, on) {
    const fresh = await getEntry(share.id);
    const next = { ...fresh, fields: { ...fresh.fields, comments: on }, updated_at: Date.now() };
    await this.send(next, null, true);
    return getEntry(share.id);
  }

  // Turn the link off: readers see "This link has been turned off". A new
  // link made later is a different address.
  async stop(share) {
    const fresh = await getEntry(share.id);
    await this.backend().saveShare({ id: fresh.fields.token, root_id: fresh.fields.root, world_id: fresh.fields.world, kind: fresh.fields.kind, title: fresh.title || '', content: {}, can_comment: false, revoked: true });
    await putEntries([{ ...fresh, fields: { ...fresh.fields, revoked: true, hash: null }, updated_at: Date.now() }]);
  }

  // Keep every link's copy up to date, and bring in new comments. Cheap when
  // nothing changed; runs every couple of minutes and when the app is hidden.
  refresh() {
    if (!this.ready) return Promise.resolve(0);
    if (this.busy) return this.busy;
    this.busy = (async () => {
      const shares = await sharesOf();
      if (!shares.length) return 0;
      for (const s of shares) await this.send(s).catch((e) => console.warn('share not sent', e));
      return this.pullComments(shares);
    })().finally(() => { this.busy = null; });
    return this.busy;
  }

  // New comments become margin notes (Comments category) on the paragraph or
  // line they're about; replies join their comment's note.
  async pullComments(shares) {
    shares = shares || (await sharesOf());
    const byToken = new Map(shares.map((s) => [s.fields.token, s]));
    if (!byToken.size) return 0;
    const since = (await getMeta('commentsSince')) || '1970-01-01T00:00:00Z';
    const rows = await this.backend().comments([...byToken.keys()], since);
    if (!rows.length) return 0;
    await ensureNoteType(COMMENT_TYPE);
    const now = Date.now();
    const notes = new Map();
    const fresh = [];
    for (const c of rows) {
      if (!c.parent_id) {
        const id = `cm-${c.id}`;
        if (await getEntry(id)) continue;
        const share = byToken.get(c.share_id);
        const block = c.block ? await getEntry(c.block) : null;
        const home = block ? (block.kind === 'line' ? { page_id: share?.fields.root } : { chapter_id: block.parent_id }) : { page_id: share?.fields.root };
        const note = entry('note', {
          id, parent_id: c.block || share?.fields.root || null, type: COMMENT_TYPE.id, text: c.text, created_at: Date.parse(c.created_at) || now,
          fields: { ...home, by: c.owner ? null : `reader:${c.name}`, comment: { id: c.id, share: share?.id || null, name: c.name, quote: c.quote || '', at: Date.parse(c.created_at) || now, owner: !!c.owner }, replies: [], ...(c.resolved ? { resolved: true } : {}) }
        });
        if (!note.fields.by) delete note.fields.by;
        notes.set(id, note);
        if (!c.owner) fresh.push(note);
      } else {
        const id = `cm-${c.parent_id}`;
        const note = notes.get(id) || (await getEntry(id));
        if (!note) continue;
        const replies = note.fields?.replies || [];
        if (replies.some((r) => r.id === c.id)) continue;
        notes.set(id, { ...note, fields: { ...note.fields, replies: [...replies, { id: c.id, name: c.name, text: c.text, at: Date.parse(c.created_at) || now, owner: !!c.owner }] }, updated_at: now });
        if (!c.owner) fresh.push(note);
      }
    }
    if (notes.size) await putEntries([...notes.values()]);
    await setMeta('commentsSince', rows[rows.length - 1].created_at);
    if (fresh.length) this.onComments(fresh);
    return fresh.length;
  }

  // Answer a comment from Inkwell; the reader sees it under theirs.
  async reply(note, text) {
    const share = note.fields?.comment?.share ? await getEntry(note.fields.comment.share) : null;
    if (!share) throw new Error('This comment’s link is gone');
    const name = (await this.backend().name?.().catch(() => '')) || 'The writer';
    const got = await this.backend().reply({ share_id: share.fields.token, parent_id: note.fields.comment.id, name, text });
    const fresh = await getEntry(note.id);
    const replies = [...(fresh.fields?.replies || []), { id: got.id, name, text, at: Date.parse(got.created_at) || Date.now(), owner: true }];
    const next = { ...fresh, fields: { ...fresh.fields, replies }, updated_at: Date.now() };
    await putEntries([next]);
    return next;
  }

  async resolve(note, resolved = true) {
    const fresh = await getEntry(note.id);
    const next = { ...fresh, fields: { ...fresh.fields, resolved }, updated_at: Date.now() };
    await putEntries([next]);
    if (fresh.fields?.comment?.id) this.backend().resolveComment(fresh.fields.comment.id, resolved).catch((e) => console.warn(e));
    return next;
  }
}

// Every comment that came in on one share, newest first.
export async function commentsOn(share) {
  return (await byKind('note')).filter((n) => !n.deleted && n.fields?.comment?.share === share.id).sort((a, b) => (b.fields.comment.at || 0) - (a.fields.comment.at || 0));
}
