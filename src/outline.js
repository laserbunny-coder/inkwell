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
        },
        done: {
          default: false,
          parseHTML: (el) => el.hasAttribute('data-done'),
          renderHTML: (a) => (a.done ? { 'data-done': '' } : {})
        },
        // A line can gather a tag: everything tagged with it lands under it.
        gather: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el) => el.getAttribute('data-gather'),
          renderHTML: (a) => (a.gather ? { 'data-gather': a.gather } : {})
        },
        // A mirror shows (and edits) another line or paragraph, wherever it lives.
        mirror: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el) => el.getAttribute('data-mirror'),
          renderHTML: (a) => (a.mirror ? { 'data-mirror': '' } : {})
        },
        // What it has gathered so far, so a line you delete stays gone.
        gathered: { default: null, keepOnSplit: false, parseHTML: () => null, renderHTML: () => ({}) }
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

// A gathering line wears a small #tag after its words; clicking it lists the
// tag. A mirror shows, faintly on hover, where its original lives; clicking
// that opens it there. Both are drawn by CSS from attributes, not widgets in
// the text, so arrow keys and the caret move past them as if they weren't there.
export const mirrorKey = new PluginKey('gatherBadge');
export const GatherBadge = Extension.create({
  name: 'gatherBadge',
  addOptions() { return { onTag: () => {}, onOpen: () => {}, origin: () => '' }; },
  addProseMirrorPlugins() {
    const { onTag, onOpen, origin } = this.options;
    const build = (doc) => {
      const decos = [];
      doc.descendants((node, pos) => {
        if (node.type.name !== 'listItem' || !node.firstChild) return;
        if (node.attrs.mirror) {
          const from = origin(node.attrs.mirror);
          decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'mirror', ...(from ? { 'data-from': from } : {}) }));
        }
        if (node.attrs.gather) {
          decos.push(Decoration.node(pos + 1, pos + 1 + node.firstChild.nodeSize, { class: 'gathers', 'data-gathers': `#${node.attrs.gather}` }));
        }
      });
      return DecorationSet.create(doc, decos);
    };
    // Clicks past the end of a line's words land on the drawn label.
    const pastWords = (p, event) => {
      const r = document.createRange();
      r.selectNodeContents(p);
      const rects = [...r.getClientRects()].filter((x) => x.width);
      const last = rects.at(-1);
      if (!last) return false;
      const chip = parseFloat(getComputedStyle(p, '::after').width) || 80;
      return event.clientY >= last.top && event.clientY <= last.bottom && event.clientX > last.right + 4 && event.clientX < last.right + 12 + chip;
    };
    const hit = (event) => {
      const li = event.target.closest?.('li.mirror[data-from]');
      if (li && event.target === li) {
        const p = li.querySelector(':scope > p');
        if (p && event.clientX > p.getBoundingClientRect().right - 24) return { open: li };
      }
      const p = event.target.closest?.('p.gathers');
      if (p && event.target === p && pastWords(p, event)) return { tag: p };
      return null;
    };
    return [new Plugin({
      key: mirrorKey,
      // Clearing a mirror's words takes the mirror off this line (the
      // original keeps its words), so an emptied line never refills itself.
      appendTransaction(trs, _old, state) {
        if (!trs.some((t) => t.docChanged)) return null;
        let tr = null;
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'listItem' || !node.attrs.mirror || node.firstChild?.content.size) return;
          tr = tr || state.tr;
          // A fresh id too: the mirror's id stays free in case it's brought back.
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, mirror: null, eid: null });
        });
        return tr;
      },
      state: {
        init: (_c, state) => build(state.doc),
        apply: (tr, old) => (tr.docChanged || tr.getMeta(mirrorKey) ? build(tr.doc) : old)
      },
      props: {
        decorations(state) { return this.getState(state); },
        handleDOMEvents: {
          mousedown(_view, event) {
            if (!hit(event)) return false;
            event.preventDefault();
            return true;
          },
          click(view, event) {
            const h = hit(event);
            if (!h) return false;
            event.preventDefault();
            if (h.tag) onTag(h.tag.dataset.gathers.slice(1));
            else {
              const eid = h.open.dataset.eid;
              let id = null;
              view.state.doc.descendants((n) => { if (!id && n.type.name === 'listItem' && n.attrs.eid === eid) id = n.attrs.mirror; return !id; });
              if (id) onOpen(id);
            }
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

// Moves the line you're on (with everything under it) past its neighbour, up or down.
export function moveLine(editor, dir) {
  const { state } = editor;
  const { $head, head } = state.selection;
  let d = $head.depth;
  while (d > 0 && $head.node(d).type.name !== 'listItem') d--;
  if (!d) return false;
  const li = $head.node(d);
  const list = $head.node(d - 1);
  const index = $head.index(d - 1);
  const liPos = $head.before(d);
  const other = list.maybeChild(index + dir);
  if (!other) return false;
  const to = dir < 0 ? liPos - other.nodeSize : liPos + other.nodeSize;
  const tr = state.tr.delete(liPos, liPos + li.nodeSize).insert(to, li);
  tr.setSelection(TextSelection.create(tr.doc, to + (head - liPos)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

// Drags a line by its dot (shown or not) to sit before or after another.
function startDrag(view, dragged, event, { onClick } = {}) {
  const eid = dragged.querySelector(':scope > .line-gutter')?.dataset.eid;
  const x0 = event.clientX, y0 = event.clientY;
  let mark = null, drop = null;
  const begin = () => {
    mark = document.createElement('div');
    mark.className = 'line-drop';
    mark.hidden = true;
    document.body.append(mark);
    dragged.classList.add('dragging');
    document.body.classList.add('line-dragging');
  };
  const find = (e) => {
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('li');
    if (!hit || !view.dom.contains(hit) || dragged.contains(hit)) return null;
    const box = hit.querySelector(':scope > p')?.getBoundingClientRect() || hit.getBoundingClientRect();
    return { li: hit, after: e.clientY > box.top + box.height / 2, box };
  };
  const move = (e) => {
    if (!mark && Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
    if (!mark) begin();
    drop = find(e);
    mark.hidden = !drop;
    if (drop) Object.assign(mark.style, { left: `${drop.box.left}px`, width: `${drop.box.width}px`, top: `${(drop.after ? drop.box.bottom : drop.box.top) - 1}px` });
  };
  const done = (e) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', done);
    window.removeEventListener('pointercancel', done);
    if (!mark) { if (e.type === 'pointerup') onClick?.(); return; }
    mark.remove();
    dragged.classList.remove('dragging');
    document.body.classList.remove('line-dragging');
    if (!drop || e.type === 'pointercancel') return;
    const state = view.state;
    const posOf = (id) => { let at = -1; if (!id) return at; state.doc.descendants((n, pos) => { if (at < 0 && n.type.name === 'listItem' && n.attrs.eid === id) at = pos; return at < 0; }); return at; };
    const from = posOf(eid);
    const at = posOf(drop.li.querySelector(':scope > .line-gutter')?.dataset.eid);
    if (from < 0 || at < 0) return;
    const node = state.doc.nodeAt(from);
    const target = state.doc.nodeAt(at);
    if (node?.type.name !== 'listItem' || target?.type.name !== 'listItem') return;
    const tr = state.tr.delete(from, from + node.nodeSize);
    const to = tr.mapping.map(drop.after ? at + target.nodeSize : at, drop.after ? 1 : -1);
    tr.insert(to, node);
    tr.setSelection(TextSelection.create(tr.doc, Math.min(to + 2, tr.doc.content.size)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', done);
  window.addEventListener('pointercancel', done);
}

// Done: the line is struck through (Ctrl+Enter, or the Done button on a phone).
export function toggleDone(editor) {
  const { $head } = editor.state.selection;
  let d = $head.depth;
  while (d > 0 && $head.node(d).type.name !== 'listItem') d--;
  if (!d) return false;
  const pos = $head.before(d);
  const li = $head.node(d);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...li.attrs, done: !li.attrs.done }));
  return true;
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
      'Mod-Enter': () => toggleDone(this.editor),
      'Alt-Shift-ArrowUp': () => moveLine(this.editor, -1),
      'Alt-Shift-ArrowDown': () => moveLine(this.editor, 1),
      'Mod-ArrowUp': () => setFold(true),
      'Mod-ArrowDown': () => setFold(false),
      // Enter on the zoomed-in line starts its first line underneath, since a
      // line beside it would be out of view.
      Enter: () => {
        const st = foldKey.getState(this.editor.state);
        const li = at();
        // Enter on an empty line at the top level would try to step out of the
        // outline (there's nowhere to go, and the next words were lost); it
        // starts a new line below instead.
        const { $from: $e } = this.editor.state.selection;
        if (li && !li.firstChild.content.size && $e.depth === 3 && $e.node(2) === li && li.attrs.eid !== st?.zoom) {
          return this.editor.commands.command(({ tr, dispatch }) => {
            const after = $e.after(2);
            tr.insert(after, this.editor.schema.nodes.listItem.create(null, this.editor.schema.nodes.paragraph.create()));
            if (dispatch) tr.setSelection(TextSelection.create(tr.doc, after + 2));
            return true;
          });
        }
        // Enter inside a mirror doesn't cut its words in two (that would cut
        // its original too); it opens a new line after it.
        const { $from: $m, $to: $mt } = this.editor.state.selection;
        if (li?.attrs.mirror && $m.parent.type.name === 'paragraph' && $m.node($m.depth - 1) === li && $mt.sameParent($m) &&
          !($m.parentOffset === 0 && $mt.parentOffset === 0 && $m.parent.content.size > 0) && $mt.parentOffset < $m.parent.content.size) {
          return this.editor.chain().setTextSelection($m.end()).splitListItem('listItem').run();
        }
        // Enter at the very start of a line opens a new line above and leaves
        // this one whole, so its id (and a mirror's link to its original) stays
        // with its words.
        const { $from: $at, empty } = this.editor.state.selection;
        if (empty && li && li.attrs.eid !== st?.zoom && $at.parent.type.name === 'paragraph' && $at.parentOffset === 0 &&
          $at.parent.content.size > 0 && $at.node($at.depth - 1) === li) {
          const schema = this.editor.schema;
          const tr = this.editor.state.tr.insert($at.before($at.depth - 1), schema.nodes.listItem.create(null, schema.nodes.paragraph.create()));
          this.editor.view.dispatch(tr.scrollIntoView());
          return true;
        }
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
          pointerdown(view, event) {
            const b = event.target.closest?.('.line-gutter button');
            if (!b) return false;
            event.preventDefault();
            const eid = b.parentElement.dataset.eid;
            if (!eid) return true;
            if (b.classList.contains('fold')) view.dispatch(view.state.tr.setMeta(foldKey, { fold: eid }));
            // A click (or tap) zooms in; with a mouse, a drag moves the line. On a phone the row's arrows move it.
            else if (event.pointerType === 'touch') view.dispatch(view.state.tr.setMeta(foldKey, { zoom: eid }));
            else startDrag(view, b.closest('li'), event, { onClick: () => view.dispatch(view.state.tr.setMeta(foldKey, { zoom: eid })) });
            return true;
          },
          mousedown(_view, event) {
            if (!event.target.closest?.('.line-gutter button')) return false;
            event.preventDefault();
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
  constructor(onStatus, onSources) {
    this.onStatus = onStatus || (() => {});
    // Told when a mirror's edit was written back to the line it shows.
    this.onSources = onSources || (() => {});
    this.page = null;
    this.cache = new Map();
    // Mirrors: what each shows (source id -> row), and each mirror's words as
    // last shown, so only a real edit is written back to the source.
    this.sources = new Map();
    this.shown = new Map();
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
    await this.loadSources(rows);
    try {
      const wal = JSON.parse(localStorage.getItem(WAL(pageId)) || 'null');
      if (wal) { this.shown = new Map(); return { doc: withSources(wal.doc, this.sources, this.shown), recovered: true }; }
    } catch { /* fall through */ }
    return { doc: toOutlineDoc(pageId, rows, this.sources), recovered: false };
  }

  async refresh() {
    const rows = await descendants(this.page.id);
    this.cache = new Map(rows.map((r) => [r.id, r]));
    await this.loadSources(rows);
    return toOutlineDoc(this.page.id, rows, this.sources);
  }

  async loadSources(rows) {
    this.sources = new Map();
    for (const r of rows) {
      const id = r.fields?.mirror;
      if (id && !this.sources.has(id)) this.sources.set(id, (await getEntry(id)) || null);
    }
  }

  addSource(row) { this.sources.set(row.id, row); }

  // What each mirror shows right now; called once the editor holds the page.
  noteShown(doc, reset = false) {
    if (reset) this.shown = new Map();
    doc.descendants((node) => {
      if (node.type.name !== 'listItem' || !node.attrs.mirror) return;
      if (reset || !this.shown.has(node.attrs.eid)) this.shown.set(node.attrs.eid, JSON.stringify(node.firstChild?.toJSON().content || null));
    });
  }

  ids() { return new Set([this.page?.id, ...this.cache.keys(), ...this.sources.keys()]); }

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
        const done = !!item.attrs.done;
        const gather = item.attrs.gather || null;
        const gathered = item.attrs.gathered || null;
        const mirror = item.attrs.mirror || null;
        const same = prev && !prev.deleted && prev.parent_id === parentId && prev.sort === sort && !!prev.fields?.done === done &&
          (prev.fields?.gather || null) === gather && JSON.stringify(prev.fields?.gathered || null) === JSON.stringify(gathered) &&
          (prev.fields?.mirror || null) === mirror && JSON.stringify(prev.content) === JSON.stringify(content);
        if (!same) {
          rows.push({
            ...(prev || { id, created_at: now, type: null, fields: {}, area_id: null, title: '' }),
            kind: 'line', parent_id: parentId, sort, text, content, fields: { ...(prev?.fields || {}), done, gather, gathered, mirror },
            // A mirror keeps a copy of its words (for search and exports) but
            // not its tags, so the line isn't found twice under its #tag.
            tags: mirror ? [] : tagsIn(text), links: refsIn(content), deleted: false, updated_at: now
          });
        }
        if (mirror) edits.push({ id, mirror, content, text });
        item.forEach((child) => { if (child.type.name === 'bulletList') visit(child, id); });
      });
    };
    const edits = [];
    doc.forEach((list) => visit(list, page.id));
    for (const [id, prev] of this.cache) {
      if (!present.has(id) && !prev.deleted) rows.push({ ...prev, deleted: true, updated_at: now });
    }
    // A mirror whose words changed here writes them back to the line it shows.
    const sourceRows = [];
    for (const m of edits) {
      const json = JSON.stringify(m.content);
      const shown = this.shown.get(m.id);
      this.shown.set(m.id, json);
      // An emptied mirror is on its way out, not a reason to wipe the original.
      if (shown === undefined || shown === json || !m.text.trim()) continue;
      const src = await getEntry(m.mirror);
      if (!src || src.deleted || JSON.stringify(src.content) === json) continue;
      const row = { ...src, content: m.content, text: m.text, tags: tagsIn(m.text), links: refsIn(m.content), updated_at: now };
      sourceRows.push(row);
      this.sources.set(row.id, row);
    }
    rows.push(...sourceRows);
    if (rows.length) {
      page.updated_at = now;
      rows.push(page);
    }
    await putEntries(rows);
    for (const r of rows) if (r.id !== page.id && !sourceRows.includes(r)) this.cache.set(r.id, r);
    if (sourceRows.length) this.onSources(sourceRows);
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

// A mirror shows its source's words as they are now. If the source is gone for
// good, the mirror becomes an ordinary line with the words it last showed.
function mirrorView(attrs, content, sources) {
  if (!attrs.mirror || !sources.has(attrs.mirror)) return { attrs, content };
  const src = sources.get(attrs.mirror);
  if (!src) return { attrs, content };
  if (src.deleted) return { attrs: { ...attrs, mirror: null }, content };
  return { attrs, content: src.content || null };
}

// A recovered write-ahead copy keeps its own words, which may hold an edit to a
// mirror that never got saved; measured against the source, that edit is
// written back on the next save.
function withSources(doc, sources, shown) {
  const walk = (node) => {
    if (node.type === 'listItem' && node.attrs?.mirror) {
      const src = sources.get(node.attrs.mirror);
      if (src?.deleted) return { ...node, attrs: { ...node.attrs, mirror: null }, content: node.content?.map(walk) };
      if (src && node.attrs.eid) shown.set(node.attrs.eid, JSON.stringify(src.content || null));
    }
    return node.content ? { ...node, content: node.content.map(walk) } : node;
  };
  return walk(doc);
}

function toOutlineDoc(pageId, rows, sources = new Map()) {
  const byParent = new Map();
  for (const r of rows) {
    if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []);
    byParent.get(r.parent_id).push(r);
  }
  const list = (pid) => {
    const items = (byParent.get(pid) || []).sort(bySort).map((r) => {
      const v = mirrorView({ eid: r.id, done: !!r.fields?.done, gather: r.fields?.gather || null, gathered: r.fields?.gathered || null, mirror: r.fields?.mirror || null }, r.content, sources);
      const content = [{ type: 'paragraph', ...(v.content ? { content: v.content } : {}) }];
      const kids = list(r.id);
      if (kids) content.push(kids);
      return { type: 'listItem', attrs: v.attrs, content };
    });
    return items.length ? { type: 'bulletList', content: items } : null;
  };
  return { type: 'doc', content: [list(pageId) || { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] };
}
