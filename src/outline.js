import { Node, Extension, InputRule, mergeAttributes } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { children, getEntry, putEntries } from './db.js';
import { newId, tagsIn } from './model.js';

// The notebook's pages (daily pages and named pages) are outlines: lines you
// can nest, Workflowy-style. Every line is its own entry whose parent is the
// line above it in the tree (or the page itself), so any line can be linked,
// tagged and found later.

export const OutlineDoc = Document.extend({ content: 'bulletList' });

// Stable ids on every line, at any depth.
export const LineIds = Extension.create({
  name: 'lineIds',
  addGlobalAttributes() {
    return [{
      types: ['listItem'],
      attributes: {
        eid: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-eid'),
          renderHTML: (a) => (a.eid ? { 'data-eid': a.eid } : {})
        }
      }
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('lineIds'),
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null;
        const seen = new Set();
        let tr = null;
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'listItem') return;
          const id = node.attrs.eid;
          if (!id || seen.has(id)) {
            tr = tr || state.tr;
            const fresh = newId('li');
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, eid: fresh });
            seen.add(fresh);
          } else seen.add(id);
        });
        if (tr) tr.setMeta('addToHistory', false);
        return tr;
      }
    })];
  }
});

// A link to another entry, shown as a chip. Typing [[ opens the picker.
export const EntryRef = Node.create({
  name: 'entryRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { onOpen: () => {}, onPick: () => {} };
  },
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-ref'), renderHTML: () => ({}) },
      title: { default: '', parseHTML: (el) => el.textContent, renderHTML: () => ({}) }
    };
  },
  // So the linked name counts as the line's text (search, tags, export).
  extendNodeSchema() { return { leafText: (node) => node.attrs.title || '' }; },
  parseHTML() { return [{ tag: 'a[data-ref]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-ref': node.attrs.id, class: 'ref', href: '#' }), node.attrs.title || 'Untitled'];
  },
  renderText({ node }) { return `[[${node.attrs.title}]]`; },
  addInputRules() {
    return [new InputRule({
      find: /\[\[$/,
      handler: ({ range, chain }) => {
        chain().deleteRange(range).run();
        this.options.onPick(this.editor);
      }
    })];
  },
  addProseMirrorPlugins() {
    const open = this.options.onOpen;
    return [new Plugin({
      key: new PluginKey('entryRefClick'),
      props: {
        handleDOMEvents: {
          click(_view, event) {
            const a = event.target.closest?.('a[data-ref]');
            if (!a) return false;
            event.preventDefault();
            open(a.getAttribute('data-ref'));
            return true;
          }
        }
      }
    })];
  }
});

export function refsIn(content) {
  const ids = new Set();
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.type === 'entryRef' && n.attrs?.id) ids.add(n.attrs.id);
      walk(n.content);
    }
  };
  walk(content);
  return [...ids];
}

const WAL = (id) => `wal:${id}`;

// Loads and saves one outline page, the same two-layer way as chapters:
// write-ahead copy at once, changed lines to IndexedDB a moment later.
export class OutlineStore {
  constructor(onStatus) {
    this.onStatus = onStatus || (() => {});
    this.page = null;
    this.cache = new Map();
    this.version = 0;
    this.savedVersion = 0;
    this.timer = null;
    this.saving = Promise.resolve();
  }

  get idle() { return this.version === this.savedVersion; }

  async load(pageId, fallback) {
    this.page = (await getEntry(pageId)) || fallback;
    const rows = await descendants(pageId);
    this.cache = new Map(rows.map((r) => [r.id, r]));
    this.version = this.savedVersion = 0;
    try {
      const wal = JSON.parse(localStorage.getItem(WAL(pageId)) || 'null');
      if (wal) return { doc: wal.doc, recovered: true };
    } catch { /* fall through */ }
    return { doc: toOutlineDoc(pageId, rows), recovered: false };
  }

  async refresh() {
    const rows = await descendants(this.page.id);
    this.cache = new Map(rows.map((r) => [r.id, r]));
    return toOutlineDoc(this.page.id, rows);
  }

  ids() { return new Set([this.page?.id, ...this.cache.keys()]); }

  change(doc) {
    if (!this.page) return;
    this.version += 1;
    try { localStorage.setItem(WAL(this.page.id), JSON.stringify({ at: Date.now(), doc: doc.toJSON() })); } catch { /* full */ }
    this.onStatus('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(doc), 300);
  }

  flush(doc) {
    clearTimeout(this.timer);
    const version = this.version;
    const page = this.page;
    this.saving = this.saving.then(() => this.write(page, doc, version)).catch((e) => { console.error(e); this.onStatus('error'); });
    return this.saving;
  }

  async close(doc) {
    if (this.page && !this.idle) await this.flush(doc);
  }

  async write(page, doc, version) {
    const now = Date.now();
    const rows = [];
    const present = new Set();
    const visit = (list, parentId) => {
      let sort = 0;
      list.forEach((item) => {
        if (item.type.name !== 'listItem') return;
        sort += 1;
        const id = item.attrs.eid;
        if (!id) return;
        present.add(id);
        const para = item.firstChild;
        const content = para?.toJSON().content || null;
        const text = para?.textContent || '';
        const prev = this.cache.get(id);
        const same = prev && !prev.deleted && prev.parent_id === parentId && prev.sort === sort &&
          JSON.stringify(prev.content) === JSON.stringify(content);
        if (!same) {
          rows.push({
            ...(prev || { id, created_at: now, type: null, fields: {}, area_id: null, title: '' }),
            kind: 'line', parent_id: parentId, sort, text, content,
            tags: tagsIn(text), links: refsIn(content), deleted: false, updated_at: now
          });
        }
        item.forEach((child) => { if (child.type.name === 'bulletList') visit(child, id); });
      });
    };
    doc.forEach((list) => visit(list, page.id));
    for (const [id, prev] of this.cache) {
      if (!present.has(id) && !prev.deleted) rows.push({ ...prev, deleted: true, updated_at: now });
    }
    if (rows.length) {
      page.updated_at = now;
      rows.push(page);
    }
    await putEntries(rows);
    for (const r of rows) if (r.id !== page.id) this.cache.set(r.id, r);
    if (version === this.version && page === this.page) {
      localStorage.removeItem(WAL(page.id));
      this.savedVersion = version;
      this.onStatus('saved');
    }
  }
}

export async function descendants(id) {
  const out = [];
  const walk = async (pid) => {
    for (const row of await children(pid)) {
      if (row.kind !== 'line') continue;
      out.push(row);
      await walk(row.id);
    }
  };
  await walk(id);
  return out;
}

function toOutlineDoc(pageId, rows) {
  const byParent = new Map();
  for (const r of rows) {
    if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []);
    byParent.get(r.parent_id).push(r);
  }
  const list = (pid) => {
    const items = (byParent.get(pid) || []).sort((a, b) => a.sort - b.sort).map((r) => {
      const content = [{ type: 'paragraph', ...(r.content ? { content: r.content } : {}) }];
      const kids = list(r.id);
      if (kids) content.push(kids);
      return { type: 'listItem', attrs: { eid: r.id }, content };
    });
    return items.length ? { type: 'bulletList', content: items } : null;
  };
  return { type: 'doc', content: [list(pageId) || { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] };
}
