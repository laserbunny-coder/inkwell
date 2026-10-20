import { children, getEntry, putEntries, addSnapshot, snapshots } from './db.js';
import { tagsIn, wordCount } from './model.js';
import { refsIn } from './outline.js';
import { placeSorts } from './order.js';

const WAL = (id) => `wal:${id}`;
const SNAPSHOT_IDLE_MS = 4000;
const SAVE_DEBOUNCE_MS = 300;

// Loads one chapter into the editor and keeps it saved.
//
// Saving happens in two layers so no keystroke is lost:
// 1. On every change, the whole chapter is written synchronously to
//    localStorage (the write-ahead copy). This survives a crash or a closed tab.
// 2. A moment later, only the paragraphs that changed are written to
//    IndexedDB as entries. Once that lands, the write-ahead copy is cleared.
// On open, a leftover write-ahead copy means the last save never finished, so
// it wins and is saved again.
export class ChapterStore {
  constructor(onStatus) {
    this.onStatus = onStatus || (() => {});
    this.chapter = null;
    this.cache = new Map();
    this.timer = null;
    this.snapTimer = null;
    this.version = 0;
    this.savedVersion = 0;
    this.lastSnapshot = '';
    this.saving = Promise.resolve();
  }

  async load(chapterId) {
    this.chapter = await getEntry(chapterId);
    const rows = await children(chapterId);
    this.cache = new Map(rows.map((r) => [r.id, r]));
    const last = (await snapshots(chapterId))[0];
    this.lastSnapshot = last ? JSON.stringify(last.doc) : '';
    const wal = readWal(chapterId);
    if (wal) return { doc: wal.doc, recovered: true };
    return { doc: toDoc(rows), recovered: false };
  }

  get idle() { return this.version === this.savedVersion; }

  // Re-reads the chapter after another device changed it.
  async refresh() {
    const rows = await children(this.chapter.id);
    this.cache = new Map(rows.map((r) => [r.id, r]));
    return toDoc(rows);
  }

  // Called on every editor change.
  change(doc) {
    if (!this.chapter) return;
    this.version += 1;
    const json = doc.toJSON();
    try {
      localStorage.setItem(WAL(this.chapter.id), JSON.stringify({ at: Date.now(), doc: json }));
    } catch (e) {
      console.warn('write-ahead copy failed', e);
    }
    this.onStatus('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(doc), SAVE_DEBOUNCE_MS);
    clearTimeout(this.snapTimer);
    this.snapTimer = setTimeout(() => this.snapshot(json, doc.textContent), SNAPSHOT_IDLE_MS);
  }

  flush(doc) {
    clearTimeout(this.timer);
    const version = this.version;
    const chapter = this.chapter;
    this.saving = this.saving.then(() => this.write(chapter, doc, version)).catch((e) => {
      console.error(e);
      this.onStatus('error');
    });
    return this.saving;
  }

  async write(chapter, doc, version) {
    const now = Date.now();
    const rows = [];
    const present = new Set();
    let words = 0;
    const nodes = [];
    doc.forEach((node) => { if (node.attrs.eid) nodes.push(node); });
    const sorts = placeSorts(nodes.map((node) => {
      const prev = this.cache.get(node.attrs.eid);
      return prev && !prev.deleted && prev.parent_id === chapter.id ? prev.sort : undefined;
    }));
    nodes.forEach((node, i) => {
      const index = sorts[i];
      const id = node.attrs.eid;
      present.add(id);
      const kind = node.type.name === 'sceneBreak' ? 'scene' : node.type.name === 'heading' ? 'heading' : 'para';
      const text = node.textContent;
      words += wordCount(text);
      const content = node.toJSON().content || null;
      const prev = this.cache.get(id);
      const title = kind === 'scene' ? node.attrs.title : '';
      const same = prev && !prev.deleted && prev.sort === index && prev.kind === kind && prev.title === title &&
        JSON.stringify(prev.content) === JSON.stringify(content) && prev.parent_id === chapter.id;
      if (same) return;
      const row = {
        ...(prev || { id, created_at: now, links: [], type: null, fields: {}, area_id: null }),
        kind,
        parent_id: chapter.id,
        sort: index,
        title,
        text,
        content,
        tags: tagsIn(text),
        links: refsIn(content),
        deleted: false,
        updated_at: now
      };
      if (kind === 'heading') row.fields = { ...row.fields, level: node.attrs.level };
      rows.push(row);
    });
    for (const [id, prev] of this.cache) {
      if (!present.has(id) && !prev.deleted) rows.push({ ...prev, deleted: true, updated_at: now });
    }
    if (chapter.fields?.words !== words) {
      chapter.fields = { ...chapter.fields, words };
      chapter.updated_at = now;
      rows.push(chapter);
    }
    await putEntries(rows);
    for (const r of rows) if (r.id !== chapter.id) this.cache.set(r.id, r);
    if (version === this.version && chapter === this.chapter) {
      localStorage.removeItem(WAL(chapter.id));
      this.savedVersion = version;
      this.onStatus('saved');
    }
  }

  async snapshot(json, text) {
    const s = JSON.stringify(json);
    if (!this.chapter || s === this.lastSnapshot) return;
    this.lastSnapshot = s;
    await addSnapshot({ chapter_id: this.chapter.id, at: Date.now(), words: wordCount(text), doc: json });
  }

  // Before switching chapters or closing: finish any pending save and snapshot.
  async close(doc) {
    if (!this.chapter) return;
    if (this.version !== this.savedVersion) await this.flush(doc);
    clearTimeout(this.snapTimer);
    await this.snapshot(doc.toJSON(), doc.textContent);
  }
}

function readWal(id) {
  try {
    const raw = localStorage.getItem(WAL(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function toDoc(rows) {
  const content = rows.map((r) => {
    if (r.kind === 'scene') return { type: 'sceneBreak', attrs: { eid: r.id, title: r.title || '' } };
    if (r.kind === 'heading') return { type: 'heading', attrs: { eid: r.id, level: r.fields?.level || 2 }, ...(r.content ? { content: r.content } : {}) };
    return { type: 'paragraph', attrs: { eid: r.id }, ...(r.content ? { content: r.content } : {}) };
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
