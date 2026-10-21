import { Node, Extension, InputRule, mergeAttributes } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { children, getEntry, putEntries } from './db.js';
import { newId, tagsIn } from './model.js';
import { placeSorts, bySort } from './order.js';

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
    return ['a', mergeAttributes(HTMLAttributes, { 'data-ref': node.attrs.id, class: 'ref', role: 'link' }), node.attrs.title || 'Untitled'];
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

// #tags show as tags in the text, and clicking one lists everything with it.
const TAG = /(^|\s)(#[\p{L}\p{N}_-]+)/gu;
export const TagMarks = Extension.create({
  name: 'tagMarks',
  addOptions() { return { onTag: () => {} }; },
  addProseMirrorPlugins() {
    const onTag = this.options.onTag;
    const build = (doc) => {
      const decos = [];
      doc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const m of node.text.matchAll(TAG)) {
          const from = pos + m.index + m[1].length;
          decos.push(Decoration.inline(from, from + m[2].length, { class: 'tag', 'data-tag': m[2].slice(1).toLowerCase() }));
        }
      });
      return DecorationSet.create(doc, decos);
    };
    return [new Plugin({
      key: new PluginKey('tagMarks'),
      state: {
        init: (_c, state) => build(state.doc),
        apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old)
      },
      props: {
        decorations(state) { return this.getState(state); },
        handleDOMEvents: {
          click(_view, event) {
            const t = event.target.closest?.('.tag[data-tag]');
            if (!t || event.altKey) return false;
            event.preventDefault();
            onTag(t.dataset.tag);
            return true;
          }
        }
      }
    })];
  }
});

// Folding and zooming, Workflowy-style. The arrow beside a line with lines
// under it folds them away; clicking a bullet zooms in so that line is the
// whole page. Which lines are folded is remembered on this device.
export const foldKey = new PluginKey('fold');
const FOLDED = 'folded';
const loadFolded = () => { try { return new Set(JSON.parse(localStorage.getItem(FOLDED) || '[]')); } catch { return new Set(); } };
const saveFolded = (set) => { try { localStorage.setItem(FOLDED, JSON.stringify([...set].slice(-2000))); } catch {} };
const kidsOf = (li) => (li.lastChild?.type.name === 'bulletList' ? li.lastChild : null);

// Where each line sits, and which parts of the page are out of sight.
function hiddenRanges(doc, { folded, zoom }) {
  const ranges = [];
  let root = null;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'listItem') return;
    if (zoom && node.attrs.eid === zoom) root = { from: pos, to: pos + node.nodeSize, node };
    const kids = kidsOf(node);
    if (kids && folded.has(node.attrs.eid) && node.attrs.eid !== zoom) {
      const start = pos + node.nodeSize - 1 - kids.nodeSize;
      ranges.push({ from: start, to: start + kids.nodeSize, eid: node.attrs.eid });
    }
  });
  return { ranges, root };
}

export const OutlineFold = Extension.create({
  name: 'outlineFold',
  addOptions() { return { onZoom: () => {} }; },
  addKeyboardShortcuts() {
    const at = () => {
      const { $from } = this.editor.state.selection;
      for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'listItem') return $from.node(d);
      return null;
    };
    const setFold = (on) => {
      const li = at();
      if (!li || !kidsOf(li)) return false;
      return this.editor.commands.command(({ tr }) => { tr.setMeta(foldKey, { fold: li.attrs.eid, on }); return true; });
    };
    return {
      'Mod-ArrowUp': () => setFold(true),
      'Mod-ArrowDown': () => setFold(false),
      // Enter on the zoomed-in line starts its first line underneath, since a
      // line beside it would be out of view.
      Enter: () => {
        const st = foldKey.getState(this.editor.state);
        const li = at();
        if (!st?.zoom || !li || li.attrs.eid !== st.zoom) return false;
        const { $from } = this.editor.state.selection;
        if ($from.parent.type.name !== 'paragraph' || $from.node($from.depth - 1) !== li) return false;
        const schema = this.editor.schema;
        const liPos = $from.before($from.depth - 1);
        const fresh = schema.nodes.listItem.create(null, schema.nodes.paragraph.create());
        const kids = kidsOf(li);
        let tr = this.editor.state.tr;
        let insertAt;
        if (kids) { insertAt = liPos + li.nodeSize - 1 - kids.nodeSize + 1; tr = tr.insert(insertAt, fresh); }
        else { insertAt = liPos + li.nodeSize - 1; tr = tr.insert(insertAt, schema.nodes.bulletList.create(null, fresh)); insertAt += 1; }
        tr.setSelection(TextSelection.create(tr.doc, insertAt + 2));
        this.editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
      Escape: () => {
        const st = foldKey.getState(this.editor.state);
        if (!st?.zoom) return false;
        return this.editor.commands.command(({ tr }) => { tr.setMeta(foldKey, { zoom: null }); return true; });
      }
    };
  },
  addProseMirrorPlugins() {
    const onZoom = this.options.onZoom;
    return [new Plugin({
      key: foldKey,
      state: {
        init: () => ({ folded: loadFolded(), zoom: null }),
        apply(tr, old) {
          const m = tr.getMeta(foldKey);
          if (!m) return old;
          const next = { folded: old.folded, zoom: old.zoom };
          if ('fold' in m) {
            next.folded = new Set(old.folded);
            const on = m.on ?? !old.folded.has(m.fold);
            if (on) next.folded.add(m.fold); else next.folded.delete(m.fold);
            saveFolded(next.folded);
          }
          if ('zoom' in m) next.zoom = m.zoom;
          return next;
        }
      },
      view: () => ({
        update(view, prev) {
          const a = foldKey.getState(view.state);
          const b = foldKey.getState(prev);
          if (a.zoom !== b.zoom) onZoom(a.zoom);
        }
      }),
      // Keep the caret where you can see it: arrows skip over folded lines,
      // and anything typed or moved into a fold opens it.
      appendTransaction(trs, oldState, state) {
        const st = foldKey.getState(state);
        if (!st.folded.size && !st.zoom) return null;
        if (!trs.some((t) => t.docChanged || t.selectionSet || t.getMeta(foldKey))) return null;
        const { ranges, root } = hiddenRanges(state.doc, st);
        const head = state.selection.head;
        if (st.zoom && !root) return state.tr.setMeta(foldKey, { zoom: null });
        const forward = head >= oldState.selection.head;
        if (root && (head < root.from || head > root.to)) {
          const sel = head < root.from ? Selection.findFrom(state.doc.resolve(root.from + 1), 1, true) : Selection.findFrom(state.doc.resolve(root.to - 1), -1, true);
          return sel ? state.tr.setSelection(sel) : null;
        }
        const inside = ranges.find((r) => head > r.from && head < r.to);
        if (!inside) return null;
        if (trs.some((t) => t.docChanged)) return state.tr.setMeta(foldKey, { fold: inside.eid, on: false });
        const sel = forward ? Selection.findFrom(state.doc.resolve(inside.to), 1, true) : Selection.findFrom(state.doc.resolve(inside.from), -1, true);
        return state.tr.setSelection(sel || Selection.findFrom(state.doc.resolve(inside.from), -1, true));
      },
      props: {
        decorations(state) {
          const st = foldKey.getState(state);
          const decos = [];
          const { root } = hiddenRanges(state.doc, st);
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'listItem') return;
            const eid = node.attrs.eid;
            const kids = kidsOf(node);
            const folded = kids && st.folded.has(eid) && eid !== st.zoom;
            const cls = [kids ? 'has-kids' : '', folded ? 'folded' : ''];
            if (root) {
              if (eid === st.zoom) cls.push('zoom-root');
              else if (pos < root.from && pos + node.nodeSize > root.to) cls.push('zoom-path');
              else if (pos < root.from || pos >= root.to) cls.push('zoom-hidden');
            }
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: cls.filter(Boolean).join(' ') }));
            decos.push(Decoration.widget(pos + 1, () => {
              const w = document.createElement('span');
              w.className = 'line-gutter';
              w.contentEditable = 'false';
              w.innerHTML = `${kids ? '<button type="button" class="fold" tabindex="-1" aria-label="Fold or unfold"></button>' : ''}<button type="button" class="bullet" tabindex="-1" aria-label="Zoom in"></button>`;
              w.dataset.eid = eid || '';
              return w;
            }, { side: -1, key: `g-${eid}-${kids ? 1 : 0}`, ignoreSelection: true }));
          });
          return DecorationSet.create(state.doc, decos);
        },
        handleDOMEvents: {
          mousedown(view, event) {
            const b = event.target.closest?.('.line-gutter button');
            if (!b) return false;
            event.preventDefault();
            const eid = b.parentElement.dataset.eid;
            if (!eid) return true;
            if (b.classList.contains('fold')) view.dispatch(view.state.tr.setMeta(foldKey, { fold: eid }));
            else view.dispatch(view.state.tr.setMeta(foldKey, { zoom: eid }));
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
      const items = [];
      list.forEach((item) => { if (item.type.name === 'listItem' && item.attrs.eid) items.push(item); });
      const sorts = placeSorts(items.map((item) => {
        const prev = this.cache.get(item.attrs.eid);
        return prev && !prev.deleted && prev.parent_id === parentId ? prev.sort : undefined;
      }));
      items.forEach((item, i) => {
        const sort = sorts[i];
        const id = item.attrs.eid;
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
    const items = (byParent.get(pid) || []).sort(bySort).map((r) => {
      const content = [{ type: 'paragraph', ...(r.content ? { content: r.content } : {}) }];
      const kids = list(r.id);
      if (kids) content.push(kids);
      return { type: 'listItem', attrs: { eid: r.id }, content };
    });
    return items.length ? { type: 'bulletList', content: items } : null;
  };
  return { type: 'doc', content: [list(pageId) || { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] };
}
