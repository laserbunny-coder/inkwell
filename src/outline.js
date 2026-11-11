import { Node, Extension, InputRule, mergeAttributes } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import { ListItem } from '@tiptap/extension-list';
import { Fragment, Slice } from '@tiptap/pm/model';
import { EditorState, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { children, getEntry, putEntries, snapshots } from './db.js';
import { keep } from './history.js';
import { newId, tagsIn } from './model.js';
import { placeSorts, bySort } from './order.js';
import { walKey } from './panes.js';

// The notebook's pages (daily pages and named pages) are outlines: lines you
// can nest, Workflowy-style. Every line is its own entry whose parent is the
// line above it in the tree (or the page itself), so any line can be linked,
// tagged and found later.

export const OutlineDoc = Document.extend({ content: 'bulletList' });

// A line holds its words and, under them, its own lines; nothing else. (A
// second paragraph inside a line wasn't saved, so words put there were lost.)
export const OutlineItem = ListItem.extend({ content: 'paragraph bulletList?' });

// Pages saved before that rule may hold a line with extra paragraphs (from a
// Backspace or a paste); each becomes a line of its own just after it.
export function oneParagraphPerLine(doc) {
  const fixList = (list) => ({
    ...list,
    content: (list.content || []).flatMap((li) => {
      if (li.type !== 'listItem') return [li];
      const paras = (li.content || []).filter((c) => c.type === 'paragraph');
      const lists = (li.content || []).filter((c) => c.type === 'bulletList').map(fixList);
      const kids = lists.length > 1 ? [{ type: 'bulletList', content: lists.flatMap((l) => l.content || []) }] : lists;
      const [first, ...extra] = paras.length ? paras : [{ type: 'paragraph' }];
      const extras = extra.map((p) => ({ type: 'listItem', attrs: { eid: null }, content: [p] }));
      return [{ ...li, content: [first, ...kids] }, ...extras];
    })
  });
  return { ...doc, content: (doc.content || []).map((n) => (n.type === 'bulletList' ? fixList(n) : n)) };
}

// Pasting several lines of plain text makes them lines, nested by their
// indent (tabs or spaces), with any "- ", "* " or "• " in front taken off and
// "[x] " marking a line done, as Workflowy and Tana copy them.
export function linesFromText(text, schema) {
  const raw = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (raw.length < 2) return null;
  const width = (l) => l.match(/^[\t ]*/)[0].replace(/\t/g, '    ').length;
  const widths = [...new Set(raw.map(width))].sort((a, b) => a - b);
  const rows = raw.map((l) => {
    let t = l.trim().replace(/^([-*•‣◦]|\d+[.)])\s+/, '');
    let done = false;
    const box = t.match(/^\[([ xX])\]\s+/);
    if (box) { done = box[1] !== ' '; t = t.slice(box[0].length); }
    return { level: widths.indexOf(width(l)), text: t, done, box: !!box };
  });
  // A line can only be one step deeper than the line above it.
  for (let i = 0; i < rows.length; i++) rows[i].level = Math.min(rows[i].level, i ? rows[i - 1].level + 1 : 0);
  let i = 0;
  const build = (level) => {
    const items = [];
    while (i < rows.length && rows[i].level === level) {
      const r = rows[i++];
      const content = [schema.nodes.paragraph.create(null, r.text ? schema.text(r.text) : null)];
      if (i < rows.length && rows[i].level > level) content.push(build(level + 1));
      items.push(schema.nodes.listItem.create({ done: r.done, box: r.box || null }, content));
    }
    return schema.nodes.bulletList.create(null, items);
  };
  const list = build(0);
  // Open at both ends, so the first line joins the words before the caret and
  // the words after the caret follow the last line.
  let depth = 3;
  for (let last = list.lastChild; kidsOf(last); last = kidsOf(last).lastChild) depth += 2;
  return new Slice(Fragment.from(list), 3, depth);
}

// Opens a page or chapter in an editor with an undo history of its own, so
// Ctrl+Z can't undo the opening itself (which emptied the page, and the empty
// page was saved) or reach back into the page that was open before.
export function loadDoc(editor, doc) {
  editor.commands.setContent(doc, { emitUpdate: false });
  const s = editor.state;
  editor.view.updateState(EditorState.create({ doc: s.doc, selection: s.selection, plugins: s.plugins }));
}
// Another device's changes shown in the open page: not something to undo.
export function replaceDoc(editor, doc) {
  editor.chain().setMeta('addToHistory', false).setContent(doc, { emitUpdate: false }).run();
}

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
          keepOnSplit: false,
          parseHTML: (el) => el.hasAttribute('data-done'),
          renderHTML: (a) => (a.done ? { 'data-done': '' } : {})
        },
        // A checklist line: the lines right under it get tick boxes.
        checklist: {
          default: false,
          keepOnSplit: false,
          parseHTML: (el) => el.hasAttribute('data-checklist'),
          renderHTML: (a) => (a.checklist ? { 'data-checklist': '' } : {})
        },
        // A tick box on this one line (true), or none on a line in a checklist
        // that's a note rather than a thing to do (false). Enter carries it on.
        box: {
          default: null,
          keepOnSplit: true,
          parseHTML: (el) => (el.getAttribute('data-box') === '1' ? true : el.getAttribute('data-box') === '0' ? false : null),
          renderHTML: (a) => (a.box === true ? { 'data-box': '1' } : a.box === false ? { 'data-box': '0' } : {})
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
// Folds a line away on this device, in any page that's open too (a voice
// capture lands with the lines under it folded, so a long ramble stays one line).
const openViews = new Set();
export function foldAway(eid) {
  const set = loadFolded();
  set.add(eid);
  saveFolded(set);
  for (const view of openViews) {
    const tr = view.state.tr.setMeta(foldKey, { fold: eid, on: true });
    // A caret in what's being folded moves up to the end of the line itself.
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'listItem' || node.attrs.eid !== eid) return true;
      const kids = kidsOf(node);
      const from = pos + node.nodeSize - kids?.nodeSize - 1;
      if (kids && tr.selection.head > from && tr.selection.head < pos + node.nodeSize) tr.setSelection(Selection.near(tr.doc.resolve(pos + 1 + node.firstChild.nodeSize - 1), -1));
      return false;
    });
    view.dispatch(tr);
  }
}

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

// Each line's dot doubles as its six-dot handle (shown on hover, unless the
// handle is switched off). Its menu is built by the app, which listens for
// 'line-menu' on the editor.
const GRIP = '<svg class="grip" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></g></svg>';
const lineMenu = (view, anchor, eid, at) => view.dom.dispatchEvent(new CustomEvent('line-menu', { detail: { eid, anchor, at } }));

// Moves the line you're on (with everything under it) past its neighbour, up
// or down. At the top or bottom of its group it carries on into the group
// next door (as Workflowy does), but never out of a zoom.
export function canMoveLine(state, dir, at) { return !!moveTarget(state, dir, at); }

function moveTarget(state, dir, at = state.selection.head) {
  const $head = state.doc.resolve(at);
  let d = $head.depth;
  while (d > 0 && $head.node(d).type.name !== 'listItem') d--;
  if (!d) return null;
  const li = $head.node(d);
  const list = $head.node(d - 1);
  const index = $head.index(d - 1);
  const liPos = $head.before(d);
  const zoom = foldKey.getState(state)?.zoom;
  if (li.attrs.eid === zoom) return null;
  const other = list.maybeChild(index + dir);
  if (other) return { li, liPos, to: dir < 0 ? liPos - other.nodeSize : liPos + other.nodeSize };
  if (d < 3) return null;
  const parent = $head.node(d - 2);
  if (parent.attrs.eid === zoom) return null;
  const outer = $head.node(d - 3);
  const next = outer.maybeChild($head.index(d - 3) + dir);
  if (!next) return null;
  const parentPos = $head.before(d - 2);
  const nextPos = dir < 0 ? parentPos - next.nodeSize : parentPos + parent.nodeSize;
  return { li, liPos, into: { node: next, pos: nextPos } };
}

export function moveLine(editor, dir) {
  const { state } = editor;
  const m = moveTarget(state, dir);
  if (!m) return false;
  const { li, liPos } = m;
  const head = state.selection.head;
  const tr = state.tr;
  let to;
  if (m.into) {
    // Into the neighbouring group: last under it going up, first going down.
    const { node, pos } = m.into;
    const kids = kidsOf(node);
    const list = state.doc.resolve(liPos).parent;
    if (list.childCount === 1) tr.delete(state.doc.resolve(liPos).before(), state.doc.resolve(liPos).after());
    else tr.delete(liPos, liPos + li.nodeSize);
    const p = tr.mapping.map(pos);
    if (!kids) {
      const at = p + node.nodeSize - 1;
      tr.insert(at, state.schema.nodes.bulletList.create(null, li));
      to = at + 1;
    } else {
      const kidsPos = p + node.nodeSize - 1 - kids.nodeSize;
      to = dir < 0 ? kidsPos + kids.nodeSize - 1 : kidsPos + 1;
      tr.insert(to, li);
    }
    if (foldKey.getState(state)?.folded.has(node.attrs.eid)) tr.setMeta(foldKey, { fold: node.attrs.eid, on: false });
  } else {
    to = m.to;
    tr.delete(liPos, liPos + li.nodeSize).insert(to, li);
  }
  tr.setSelection(TextSelection.create(tr.doc, to + (head - liPos)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

// A drag can leave this window for a pane beside it (panes.js): the app says
// whether the pointer is over another window, and takes the drop there.
let dragOut = null;
export function setLineDragOut(hooks) { dragOut = hooks; }

// Drags a line by its dot (shown or not) to sit before or after another, or,
// let go further to the right, as the first line under it (as in Workflowy).
// With a finger the line lifts and follows it, and near the top or bottom of
// the screen the page scrolls along for as long as the finger stays there.
const NEST = 44; // px right of a line's words that drops a line under it
// One move of a line, fed by a mouse, by the dots under a finger, or by a
// finger held on the line's words: begin() lifts it, move() follows, end() lands it.
function lineDrag(view, dragged, touch) {
  const eid = dragged.querySelector(':scope > .line-gutter')?.dataset.eid;
  let mark = null, drop = null, lift = null, fade = null, dy = 0, raf = 0, last = null;
  // The editor may draw the line afresh while it moves, so it's found by its id.
  const live = () => [...view.dom.querySelectorAll('li')].find((l) => l.querySelector(':scope > .line-gutter')?.dataset.eid === eid) || dragged;
  const find = (e) => {
    let hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('li');
    // A finger on the dots is in the margin: look across the words at that height too.
    if (!hit && touch) {
      const r = view.dom.getBoundingClientRect();
      hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 120), e.clientY)?.closest?.('li');
    }
    if (!hit || !view.dom.contains(hit) || live().contains(hit)) return null;
    const box = hit.querySelector(':scope > p')?.getBoundingClientRect() || hit.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    // Further right than the line's words start: under it, as its first line (not into a folded one).
    const into = after && e.clientX > box.left + NEST && !hit.classList.contains('folded') && !hit.classList.contains('zoom-root');
    return { li: hit, after, into, box };
  };
  const place = (e) => {
    drop = find(e);
    const away = !drop && !!dragOut?.over(e);
    document.body.classList.toggle('line-drag-away', away);
    mark.hidden = !drop;
    if (drop) {
      const indent = drop.into ? 24 : 0;
      Object.assign(mark.style, { left: `${drop.box.left + indent}px`, width: `${drop.box.width - indent}px`, top: `${(drop.after ? drop.box.bottom : drop.box.top) - 1}px` });
    }
  };
  const begin = (e) => {
    last = e;
    mark = document.createElement('div');
    mark.className = 'line-drop';
    mark.hidden = true;
    document.body.append(mark);
    document.body.classList.add('line-dragging');
    // The line itself waits, faded, where it was. This is done from outside the
    // editor: a change to its own lines would have it draw them again, and a
    // finger's touch would lose track of the words it is on.
    fade = document.createElement('style');
    fade.textContent = `li:has(> .line-gutter[data-eid="${CSS.escape(eid || '')}"]) { opacity: .35; }`;
    document.head.append(fade);
    if (!touch) return;
    // A copy of the line's words pops out and rides with the finger.
    const p = dragged.querySelector(':scope > p');
    const b = (p || dragged).getBoundingClientRect();
    lift = document.createElement('div');
    lift.className = 'line-lift';
    lift.setAttribute('aria-hidden', 'true');
    lift.textContent = p?.textContent || '';
    if (kidsCount(dragged)) lift.dataset.more = `+${kidsCount(dragged)}`;
    Object.assign(lift.style, { left: `${b.left}px`, width: `${Math.min(b.width, innerWidth - b.left - 8)}px`, top: `${b.top}px` });
    document.body.append(lift);
    // It rides just above the finger, so the line where it will land stays in sight.
    dy = b.height + 22;
    lift.style.top = `${e.clientY - dy}px`;
    navigator.vibrate?.(8);
    const box = scroller(view.dom);
    const step = () => {
      if (!mark) return;
      const y = last.clientY, edge = 72;
      const speed = y < edge ? -Math.ceil((edge - y) / 6) : y > innerHeight - edge ? Math.ceil((y - (innerHeight - edge)) / 6) : 0;
      if (speed) { if (box) box.scrollTop += speed; else window.scrollBy(0, speed); place(last); }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  const move = (e) => {
    last = e;
    if (lift) lift.style.top = `${e.clientY - dy}px`;
    place(e);
  };
  // Lands the line where it was let go (or nowhere, when called off).
  const end = (e, off = false) => {
    cancelAnimationFrame(raf);
    lift?.remove();
    fade?.remove();
    mark?.remove();
    mark = null;
    document.body.classList.remove('line-dragging', 'line-drag-away');
    if (off || !e) return;
    drop = find(e);
    // Let go over a pane beside: it moves there.
    if (!drop) { if (dragOut) Promise.resolve(dragOut.drop(e, eid)).catch((err) => console.error(err)); return; }
    dropLineAt(view, eid, drop.li.querySelector(':scope > .line-gutter')?.dataset.eid, drop.after, drop.into);
  };
  return { begin, move, end, started: () => !!mark };
}

// The dots under a mouse or finger: a click or tap zooms in, a slide moves
// the line. With a finger, holding the dots still brings up the line's menu.
const MENU_HOLD = 450; // ms
let touchHeld = false; // a finger is on a line: the phone's own long-press menu waits
function startDrag(view, dragged, event, { onClick, onHold } = {}) {
  const x0 = event.clientX, y0 = event.clientY;
  const touch = event.pointerType === 'touch';
  const d = lineDrag(view, dragged, touch);
  let held = false;
  const timer = touch && onHold ? setTimeout(() => { held = true; navigator.vibrate?.(12); onHold(); }, MENU_HOLD) : 0;
  if (touch) touchHeld = true;
  // Keep hearing the pointer even when it goes over a pane beside this window.
  try { view.dom.setPointerCapture(event.pointerId); } catch { /* not a pointer we can hold */ }
  const move = (e) => {
    if (held) return;
    if (!d.started()) {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < (touch ? 6 : 5)) return;
      clearTimeout(timer);
      d.begin(e);
    }
    d.move(e);
  };
  const done = (e) => {
    clearTimeout(timer);
    try { view.dom.releasePointerCapture(event.pointerId); } catch { /* already let go */ }
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', done);
    window.removeEventListener('pointercancel', done);
    setTimeout(() => { touchHeld = false; }, 0);
    if (held) return;
    if (!d.started()) { if (e.type === 'pointerup') onClick?.(); return; }
    d.end(e, e.type === 'pointercancel');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', done);
  window.addEventListener('pointercancel', done);
}

// On a phone, as in Workflowy: a finger held still on a line's words for a
// moment lifts the line, and it then follows the finger up and down until
// let go. A tap still puts the cursor there, a quick swipe still scrolls, and
// in the line you're typing in a hold still selects words.
const HOLD = 400; // ms
function holdDrags(view) {
  let t = null; // { li, x, y, timer, d, armed, moved }
  const stop = () => {
    if (!t) return;
    clearTimeout(t.timer);
    for (const [k, f] of hear) t.el.removeEventListener(k, f);
    document.documentElement.classList.remove('line-holding');
    t = null;
    setTimeout(() => { touchHeld = !!t; }, 0);
  };
  const start = (e) => {
    stop();
    if (e.touches.length !== 1 || !matchMedia('(hover: none)').matches) return;
    const el = e.target;
    if (el.closest?.('.line-gutter, .line-box, a, button, [contenteditable="false"]')) return;
    const li = el.closest?.('li');
    if (!li || !view.dom.contains(li) || !li.querySelector(':scope > p')?.contains(el)) return;
    if (li.classList.contains('zoom-root') || !li.querySelector(':scope > .line-gutter')?.dataset.eid) return;
    if (li.classList.contains('here') && view.hasFocus()) return; // typing here: a hold selects words
    const { clientX: x, clientY: y } = e.touches[0];
    touchHeld = true;
    t = { li, x, y, armed: false, moved: false, el };
    // Should the editor draw the line afresh, the touch stays with the words
    // first touched: hear it there too.
    for (const [k, f] of hear) el.addEventListener(k, f, { passive: false });
    t.timer = setTimeout(() => {
      if (!t) return;
      t.armed = true;
      document.documentElement.classList.add('line-holding');
      getSelection()?.removeAllRanges?.();
      t.d = lineDrag(view, li, true);
      t.d.begin({ clientX: x, clientY: y });
      navigator.vibrate?.(12);
    }, HOLD);
  };
  const once = (f) => (e) => { if (e) { if (e.inkHeard) return; e.inkHeard = true; } f(e); };
  const move = once((e) => {
    if (!t) return;
    const { clientX, clientY } = e.touches[0];
    if (!t.armed) {
      if (Math.hypot(clientX - t.x, clientY - t.y) > 8) stop(); // a scroll, not a hold
      return;
    }
    if (e.cancelable) e.preventDefault(); // the page stays put; the line moves
    if (Math.hypot(clientX - t.x, clientY - t.y) > 4) t.moved = true;
    t.d.move({ clientX, clientY });
  });
  const end = once((e) => {
    if (!t) return;
    const was = t;
    stop();
    if (!was.armed) return;
    if (e.cancelable) e.preventDefault(); // no tap (and no keyboard) when it lands
    const c = e.changedTouches?.[0];
    // Held still and let go: it settles back where it was.
    was.d.end(c && was.moved ? { clientX: c.clientX, clientY: c.clientY } : null, !was.moved);
  });
  const off = once(() => { if (t?.armed) t.d.end(null, true); stop(); });
  const hear = [['touchmove', move], ['touchend', end], ['touchcancel', off]];
  view.dom.addEventListener('touchstart', start, { passive: true });
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('touchend', end, { passive: false });
  window.addEventListener('touchcancel', off);
  // The phone's own long-press menu (and word picking) would end the hold.
  const menu = (e) => { if (touchHeld || t) { e.preventDefault(); e.stopImmediatePropagation(); } };
  view.dom.addEventListener('contextmenu', menu, true);
  return () => {
    off();
    view.dom.removeEventListener('touchstart', start);
    window.removeEventListener('touchmove', move);
    window.removeEventListener('touchend', end);
    window.removeEventListener('touchcancel', off);
    view.dom.removeEventListener('contextmenu', menu, true);
  };
}
const kidsCount = (li) => li.querySelectorAll(':scope > ul li').length;
// The box that scrolls the notebook (or none: the page itself scrolls).
function scroller(el) {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

// Puts the line `eid` (with what's under it) just before or after the line
// `targetEid`, or (into) as the first line under it.
export function dropLineAt(view, eid, targetEid, after, into = false) {
  const state = view.state;
  const posOf = (id) => { let at = -1; if (!id) return at; state.doc.descendants((n, pos) => { if (at < 0 && n.type.name === 'listItem' && n.attrs.eid === id) at = pos; return at < 0; }); return at; };
  if (!eid || eid === targetEid) return false;
  const from = posOf(eid);
  const at = posOf(targetEid);
  if (from < 0 || at < 0) return false;
  const node = state.doc.nodeAt(from);
  const target = state.doc.nodeAt(at);
  if (node?.type.name !== 'listItem' || target?.type.name !== 'listItem') return false;
  // Not into itself.
  if (at > from && at < from + node.nodeSize) return false;
  const tr = state.tr.delete(from, from + node.nodeSize);
  let to;
  if (into) {
    const at2 = tr.mapping.map(at);
    const t2 = tr.doc.nodeAt(at2);
    const kids = t2.childCount > 1 && t2.lastChild.type.name === 'bulletList';
    if (kids) { to = at2 + 1 + t2.firstChild.nodeSize + 1; tr.insert(to, node); }
    else { const end = at2 + t2.nodeSize - 1; tr.insert(end, state.schema.nodes.bulletList.create(null, node)); to = end + 1; }
  } else {
    to = tr.mapping.map(after ? at + target.nodeSize : at, after ? 1 : -1);
    tr.insert(to, node);
  }
  tr.setSelection(TextSelection.create(tr.doc, Math.min(to + 2, tr.doc.content.size)));
  view.dispatch(tr.scrollIntoView());
  // On a phone, landing a line doesn't bring the keyboard up.
  if (!matchMedia('(hover: none)').matches) view.focus();
  return true;
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

// Tick boxes. A line can be a checklist: the lines right under it get boxes
// (the lines under those stay notes). Any single line can have a box of its
// own, and a line in a checklist can go without one, to say something about
// the things around it. Ticking a box is the same as Done (Ctrl+Enter).
const lineAt = (state) => {
  const { $head } = state.selection;
  for (let d = $head.depth; d > 0; d--) if ($head.node(d).type.name === 'listItem') return { node: $head.node(d), pos: $head.before(d), $pos: state.doc.resolve($head.before(d)) };
  return null;
};
// Is the line at `pos` in a checklist (its parent line is one)?
function inChecklist(doc, pos) {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'listItem') return !!$pos.node(d).attrs.checklist;
  return false;
}
export const hasBox = (node, inList) => node.attrs.box === true || (node.attrs.box !== false && inList);
export function lineChecks(state) {
  const line = lineAt(state);
  if (!line) return null;
  const inList = inChecklist(state.doc, line.pos);
  return { checklist: !!line.node.attrs.checklist, box: hasBox(line.node, inList), inList };
}
export function toggleChecklist(editor) {
  const line = lineAt(editor.state);
  if (!line) return false;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(line.pos, undefined, { ...line.node.attrs, checklist: !line.node.attrs.checklist }));
  return true;
}
export function toggleBox(editor) {
  const line = lineAt(editor.state);
  if (!line) return false;
  const inList = inChecklist(editor.state.doc, line.pos);
  const shown = hasBox(line.node, inList);
  const box = shown ? (inList ? false : null) : (inList ? null : true);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(line.pos, undefined, { ...line.node.attrs, box }));
  return true;
}
const boxKey = new PluginKey('lineChecks');
export const LineChecks = Extension.create({
  name: 'lineChecks',
  addInputRules() {
    // "[] " or "[ ] " at the start of a line gives it a box; "[x] " a ticked one.
    return [new InputRule({
      find: /^\[( |x|X)?\]\s$/,
      handler: ({ state, range, match }) => {
        const $from = state.doc.resolve(range.from);
        let d = $from.depth;
        while (d > 0 && $from.node(d).type.name !== 'listItem') d--;
        if (!d) return null;
        const li = $from.node(d);
        const pos = $from.before(d);
        const inList = inChecklist(state.doc, pos);
        const tr = state.tr.delete(range.from, range.to);
        tr.setNodeMarkup(pos, undefined, { ...li.attrs, box: inList ? null : true, done: /x/i.test(match[1] || '') });
      }
    })];
  },
  addProseMirrorPlugins() {
    const tick = (view, eid) => {
      let at = -1;
      let li = null;
      view.state.doc.descendants((n, pos) => {
        if (at >= 0) return false;
        if (n.type.name === 'listItem' && n.attrs.eid === eid) { at = pos; li = n; return false; }
        return true;
      });
      if (at < 0) return;
      view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...li.attrs, done: !li.attrs.done }));
    };
    return [new Plugin({
      key: boxKey,
      props: {
        decorations(state) {
          const decos = [];
          const walk = (list, base, inList) => {
            list.forEach((li, offset) => {
              const pos = base + offset;
              if (li.type.name !== 'listItem') return;
              const kids = kidsOf(li);
              if (hasBox(li, inList)) {
                const done = !!li.attrs.done;
                decos.push(Decoration.node(pos, pos + li.nodeSize, { class: 'boxed' }));
                decos.push(Decoration.widget(pos + 1, () => {
                  const b = document.createElement('button');
                  b.type = 'button';
                  b.className = 'line-box';
                  b.tabIndex = -1;
                  b.contentEditable = 'false';
                  b.dataset.eid = li.attrs.eid || '';
                  b.setAttribute('role', 'checkbox');
                  b.setAttribute('aria-checked', String(done));
                  b.setAttribute('aria-label', done ? 'Done; tap to untick' : 'Tick when done');
                  return b;
                }, { side: -1, key: `b-${li.attrs.eid}-${done ? 1 : 0}`, ignoreSelection: true }));
              }
              if (li.attrs.checklist) {
                // How many are ticked, faintly after the checklist's own words.
                let all = 0;
                let ticked = 0;
                kids?.forEach((k) => { if (hasBox(k, true)) { all++; if (k.attrs.done) ticked++; } });
                decos.push(Decoration.node(pos, pos + li.nodeSize, { class: 'checklist' }));
                if (all) {
                  const end = pos + 1 + li.firstChild.nodeSize - 1;
                  decos.push(Decoration.widget(end, () => {
                    const c = document.createElement('span');
                    c.className = 'check-count';
                    c.contentEditable = 'false';
                    c.textContent = `${ticked}/${all}`;
                    return c;
                  }, { side: 1, key: `c-${li.attrs.eid}-${ticked}-${all}`, ignoreSelection: true }));
                }
              }
              if (kids) walk(kids, pos + li.nodeSize - 1 - kids.nodeSize + 1, !!li.attrs.checklist);
            });
          };
          state.doc.forEach((list, offset) => { if (list.type.name === 'bulletList') walk(list, offset + 1, false); });
          return DecorationSet.create(state.doc, decos);
        },
        handleDOMEvents: {
          // A tap or click on a box ticks it, without moving the caret or
          // bringing up the keyboard on a phone.
          pointerdown(view, event) {
            const b = event.target.closest?.('.line-box');
            if (!b) return false;
            event.preventDefault();
            if (event.button === 0 && b.dataset.eid) tick(view, b.dataset.eid);
            return true;
          },
          mousedown(_view, event) {
            if (!event.target.closest?.('.line-box')) return false;
            event.preventDefault();
            return true;
          },
          click(_view, event) {
            if (!event.target.closest?.('.line-box')) return false;
            event.preventDefault();
            return true;
          }
        }
      }
    })];
  }
});

// Workflowy-style editing. The page is read as the lines you can see: a
// folded line's lines and anything outside a zoom don't count, so keys never
// reach into a fold or out of the zoom.
function shownLines(state) {
  const st = foldKey.getState(state) || { folded: new Set(), zoom: null };
  const out = [];
  const walk = (list, base, inZoom) => {
    list.forEach((li, offset) => {
      const pos = base + offset;
      const root = st.zoom && li.attrs.eid === st.zoom;
      const seen = inZoom || root;
      if (seen) out.push({ node: li, pos });
      const kids = kidsOf(li);
      if (!kids) return;
      if (seen && !root && st.folded.has(li.attrs.eid)) return;
      walk(kids, pos + li.nodeSize - 1 - kids.nodeSize + 1, seen);
    });
  };
  state.doc.forEach((list, offset) => walk(list, offset + 1, !st.zoom));
  return { lines: out, zoom: st.zoom };
}

// The line the caret's words are in (not a line that merely contains it).
function lineHere($pos) {
  if ($pos.parent.type.name !== 'paragraph' || $pos.depth < 2) return null;
  const li = $pos.node($pos.depth - 1);
  if (li.type.name !== 'listItem' || li.firstChild !== $pos.parent) return null;
  return { node: li, pos: $pos.before($pos.depth - 1) };
}

const textEnd = (line) => line.pos + 1 + line.node.firstChild.nodeSize - 1;

// Takes a line out of the page; an emptied list goes with it.
export function removeLine(tr, pos) {
  const $p = tr.doc.resolve(pos);
  const li = tr.doc.nodeAt(pos);
  if ($p.parent.childCount === 1 && $p.depth > 1) return tr.delete($p.before(), $p.after());
  return tr.delete(pos, pos + li.nodeSize);
}

// Splits a line with lines under it at the caret (see Enter).
function splitAround(state, tr, dispatch, liPos) {
  const { from, to } = state.selection;
  const li = state.doc.nodeAt(liPos);
  const para = li.firstChild;
  const end = liPos + 1 + para.nodeSize - 1;
  if (from < liPos + 2 || to > end) return false;
  const st = foldKey.getState(state);
  const rest = state.doc.slice(to, end).content;
  tr.delete(from, end);
  const fresh = state.schema.nodes.listItem.create(null, state.schema.nodes.paragraph.create(null, rest));
  const now = tr.doc.nodeAt(liPos);
  let at;
  if (st?.folded.has(li.attrs.eid)) at = liPos + now.nodeSize;
  else at = liPos + now.nodeSize - 1 - kidsOf(now).nodeSize + 1;
  tr.insert(at, fresh);
  if (dispatch) tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView();
  return true;
}

// Backspace at the start of a line (or Delete at the end of the one above):
// its words join the end of the line you can see above it. An empty line just
// goes. A line with lines under it only joins a line that has none of its
// own, and its lines come along; otherwise nothing happens, as in Workflowy.
function joinUp(state, tr, dispatch, linePos) {
  const { lines, zoom } = shownLines(state);
  const i = lines.findIndex((l) => l.pos === linePos);
  if (i <= 0) return true;
  const line = lines[i];
  const above = lines[i - 1];
  if (line.node.attrs.eid === zoom) return true;
  const kids = kidsOf(line.node);
  const empty = !line.node.firstChild.content.size;
  const join = textEnd(above);
  const caret = (at) => { if (dispatch) tr.setSelection(TextSelection.create(tr.doc, at)).scrollIntoView(); };
  if (empty && !kids) {
    removeLine(tr, linePos);
    caret(join);
    return true;
  }
  // Words can't flow into the zoomed-in line, a mirror's original, or out of a gathering line.
  if (above.node.attrs.eid === zoom) return true;
  if (!empty && (line.node.attrs.mirror || above.node.attrs.mirror || line.node.attrs.gather)) return true;
  if (kids) {
    const $l = state.doc.resolve(linePos);
    const sibling = $l.index() > 0 && $l.parent.child($l.index() - 1) === above.node;
    if (!sibling || kidsOf(above.node)) return true;
    const st = foldKey.getState(state);
    tr.delete(linePos, linePos + line.node.nodeSize);
    tr.insert(above.pos + above.node.nodeSize - 1, kids);
    tr.insert(join, line.node.firstChild.content);
    if (st?.folded.has(line.node.attrs.eid)) tr.setMeta(foldKey, { fold: above.node.attrs.eid, on: true });
    caret(join);
    return true;
  }
  removeLine(tr, linePos);
  tr.insert(join, line.node.firstChild.content);
  caret(join);
  return true;
}

export const OutlineKeys = Extension.create({
  name: 'outlineKeys',
  // Ahead of the list's own keys.
  priority: 200,
  addKeyboardShortcuts() {
    const ed = () => this.editor;
    return {
      Backspace: () => {
        const { empty, $from } = ed().state.selection;
        const line = lineHere($from);
        if (!empty || !line || $from.parentOffset !== 0) return false;
        return ed().commands.command(({ tr, state, dispatch }) => joinUp(state, tr, dispatch, line.pos));
      },
      Delete: () => {
        const { empty, $from } = ed().state.selection;
        const line = lineHere($from);
        if (!empty || !line || $from.parentOffset !== $from.parent.content.size) return false;
        return ed().commands.command(({ tr, state, dispatch }) => {
          const { lines } = shownLines(state);
          const i = lines.findIndex((l) => l.pos === line.pos);
          if (i < 0 || i === lines.length - 1) return true;
          return joinUp(state, tr, dispatch, lines[i + 1].pos);
        });
      },
      Tab: () => indentLines(ed()),
      'Shift-Tab': () => outdentLines(ed()),
      'Mod-Shift-ArrowUp': () => moveLine(ed(), -1),
      'Mod-Shift-ArrowDown': () => moveLine(ed(), 1),
      'Mod-Shift-Backspace': () => deleteLine(ed())
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('outlinePaste'),
      props: { clipboardTextParser: (text, _$at, plain, view) => linesFromText(text, view.state.schema) }
    })];
  }
});

// The lines picked: the line the selection starts in and its later siblings
// down to the one the selection ends in.
function pickedLines(state) {
  const { $from, $to } = state.selection;
  let d = $from.depth;
  while (d > 0 && $from.node(d).type.name !== 'listItem') d--;
  if (!d) return null;
  const list = $from.node(d - 1);
  const first = $from.index(d - 1);
  let last = first;
  if ($to.depth >= d && $to.node(d - 1) === list && $to.before(d - 1) === $from.before(d - 1)) last = $to.index(d - 1);
  return { d, list, listPos: $from.before(d - 1), first, last, pos: $from.before(d) };
}

// Tab: the lines go under the line above them (which opens, if folded).
export function indentLines(editor) {
  const p = pickedLines(editor.state);
  if (!p) return false;
  const zoom = foldKey.getState(editor.state)?.zoom;
  if (p.first === 0 || p.list.child(p.first).attrs.eid === zoom) return true;
  return editor.chain().sinkListItem('listItem').scrollIntoView().run();
}

// Shift+Tab: the lines step out to just after the line they were under; the
// lines below them stay where they were (Workflowy), rather than moving under them.
export function outdentLines(editor) {
  const { state } = editor;
  const p = pickedLines(state);
  if (!p || p.d < 3) return true;
  const parent = state.doc.resolve(p.listPos).parent;
  const parentPos = state.doc.resolve(p.listPos).before();
  if (parent.attrs.eid === foldKey.getState(state)?.zoom) return true;
  let from = p.pos;
  let to = from;
  for (let i = p.first; i <= p.last; i++) to += p.list.child(i).nodeSize;
  const moving = state.doc.slice(from, to).content;
  const { anchor, head } = state.selection;
  const tr = state.tr;
  if (p.first === 0 && p.last === p.list.childCount - 1) tr.delete(p.listPos, p.listPos + p.list.nodeSize);
  else tr.delete(from, to);
  const at = tr.mapping.map(parentPos + parent.nodeSize, -1);
  tr.insert(at, moving);
  tr.setSelection(TextSelection.create(tr.doc, at + (anchor - from), at + (head - from)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

// Ctrl+Shift+Backspace: the line goes, with everything under it.
export function deleteLine(editor) {
  const { state } = editor;
  const line = lineHere(state.selection.$from);
  if (!line || line.node.attrs.eid === foldKey.getState(state)?.zoom) return true;
  const { lines } = shownLines(state);
  const i = lines.findIndex((l) => l.pos === line.pos);
  const tr = state.tr;
  const $l = state.doc.resolve(line.pos);
  if ($l.depth === 1 && $l.parent.childCount === 1) {
    tr.replaceWith(line.pos, line.pos + line.node.nodeSize, state.schema.nodes.listItem.create(null, state.schema.nodes.paragraph.create()));
    tr.setSelection(TextSelection.create(tr.doc, line.pos + 2));
  } else {
    removeLine(tr, line.pos);
    const above = lines[i - 1];
    if (above && above.pos < line.pos) tr.setSelection(TextSelection.create(tr.doc, textEnd(above)));
    else tr.setSelection(Selection.near(tr.doc.resolve(Math.min(line.pos + 2, tr.doc.content.size)), 1));
  }
  editor.view.dispatch(tr.scrollIntoView());
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
        // Enter on an empty indented line keeps one blank line between
        // paragraphs at that level: when the line above it has words, a new
        // line starts below and this one stays blank. Only when the line above
        // is blank too (or there's none) does Enter step out a level.
        if (li && !li.firstChild.content.size && !kidsOf(li) && $e.depth > 3 && $e.node($e.depth - 1) === li &&
          li.attrs.eid !== st?.zoom && $e.index($e.depth - 2) > 0) {
          const prev = $e.node($e.depth - 2).child($e.index($e.depth - 2) - 1);
          if (prev.firstChild?.content.size) {
            return this.editor.commands.command(({ tr, dispatch }) => {
              const after = $e.after($e.depth - 1);
              tr.insert(after, this.editor.schema.nodes.listItem.create(null, this.editor.schema.nodes.paragraph.create()));
              if (dispatch) tr.setSelection(TextSelection.create(tr.doc, after + 2)).scrollIntoView();
              return true;
            });
          }
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
        // Enter in a line with lines under it: whatever follows the caret
        // (nothing, at the end) becomes a new line where you'd see it: right
        // after the whole group if it's folded, or as the first line under it
        // if it's open. The line keeps its lines, its fold and its id.
        if (li && kidsOf(li) && li.attrs.eid !== st?.zoom && $at.parent.type.name === 'paragraph' && $at.node($at.depth - 1) === li) {
          return this.editor.commands.command(({ tr, state, dispatch }) => splitAround(state, tr, dispatch, $at.before($at.depth - 1)));
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
      view: (view) => {
        openViews.add(view);
        const unhold = holdDrags(view);
        return {
          update(view, prev) {
            const a = foldKey.getState(view.state);
            const b = foldKey.getState(prev);
            if (a.zoom !== b.zoom) onZoom(a.zoom);
          },
          destroy() { openViews.delete(view); unhold(); }
        };
      },
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
          // The line the caret is in: on a phone its handle stands in for the dot.
          const { $head } = state.selection;
          let here = -1;
          for (let d = $head.depth; d > 0; d--) if ($head.node(d).type.name === 'listItem') { here = $head.before(d); break; }
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'listItem') return;
            const eid = node.attrs.eid;
            const kids = kidsOf(node);
            const folded = kids && st.folded.has(eid) && eid !== st.zoom;
            const cls = [kids ? 'has-kids' : '', folded ? 'folded' : '', pos === here ? 'here' : ''];
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
              w.innerHTML = `${kids ? '<button type="button" class="fold" tabindex="-1" aria-label="Fold or unfold"></button>' : ''}<button type="button" class="bullet" tabindex="-1" aria-label="Zoom in, or right-click for this line's actions">${GRIP}</button>`;
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
            else if (event.button !== 0) return true; // a right-click opens the menu (below)
            // A click or tap zooms in; a drag moves the line. With a finger,
            // holding the dots still brings up the line's menu (as a right-click does).
            else {
              const li = b.closest('li');
              const zoom = () => view.dispatch(view.state.tr.setMeta(foldKey, { zoom: eid }));
              startDrag(view, li, event, { onClick: zoom, onHold: () => lineMenu(view, b, eid) });
            }
            return true;
          },
          contextmenu(view, event) {
            const b = event.target.closest?.('.line-gutter');
            if (!b?.dataset.eid) return false;
            event.preventDefault();
            if (touchHeld) return true; // a finger on the dots: its own hold opens the menu
            lineMenu(view, b.querySelector('.bullet') || b, b.dataset.eid, { left: event.clientX, top: event.clientY });
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

// Per window: a pane beside the main window keeps its own (panes.js).
const WAL = walKey;

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
    this.snapTimer = null;
    this.lastSnapshot = '';
    this.saving = Promise.resolve();
  }

  get idle() { return this.version === this.savedVersion; }

  // A version for the page's history, kept when typing pauses (see history.js).
  async snapshot(json, text) {
    const s = JSON.stringify(json);
    if (!this.page || s === this.lastSnapshot) return;
    if (!this.lastSnapshot) this.lastSnapshot = JSON.stringify((await snapshots(this.page.id))[0]?.doc || null);
    if (s === this.lastSnapshot) return;
    this.lastSnapshot = s;
    await keep(this.page.id, json, text);
  }

  async load(pageId, fallback) {
    clearTimeout(this.snapTimer);
    this.lastSnapshot = '';
    this.page = (await getEntry(pageId)) || fallback;
    const rows = await descendants(pageId);
    this.cache = new Map(rows.map((r) => [r.id, r]));
    this.version = this.savedVersion = 0;
    await this.loadSources(rows);
    try {
      const wal = JSON.parse(localStorage.getItem(WAL(pageId)) || 'null');
      if (wal) { this.shown = new Map(); return { doc: withSources(oneParagraphPerLine(wal.doc), this.sources, this.shown), recovered: true }; }
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
    clearTimeout(this.snapTimer);
    this.snapTimer = setTimeout(() => this.snapshot(doc.toJSON(), doc.textContent), 4000);
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
    if (this.page && this.snapTimer) { clearTimeout(this.snapTimer); this.snapTimer = null; await this.snapshot(doc.toJSON(), doc.textContent); }
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
        const checklist = !!item.attrs.checklist;
        const box = item.attrs.box ?? null;
        const same = prev && !prev.deleted && prev.parent_id === parentId && prev.sort === sort && !!prev.fields?.done === done &&
          !!prev.fields?.checklist === checklist && (prev.fields?.box ?? null) === box &&
          (prev.fields?.gather || null) === gather && JSON.stringify(prev.fields?.gathered || null) === JSON.stringify(gathered) &&
          (prev.fields?.mirror || null) === mirror && JSON.stringify(prev.content) === JSON.stringify(content);
        if (!same) {
          rows.push({
            ...(prev || { id, created_at: now, type: null, fields: {}, area_id: null, title: '' }),
            kind: 'line', parent_id: parentId, sort, text, content, fields: taskDone(checkFields({ ...(prev?.fields || {}), done, gather, gathered, mirror }, checklist, box), now),
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
    // A line changed underneath since it was loaded (a snapshot naming a
    // link, Claude's tag) keeps what was added to it; the words are yours.
    for (const r of rows) {
      const was = this.cache.get(r.id);
      if (!was || r.deleted) continue;
      const now = await getEntry(r.id);
      if (now && !now.deleted && (now.updated_at || 0) > (was.updated_at || 0)) {
        // Ticked somewhere else (the plan, Claude) while this page had it open:
        // the tick stands unless it was changed here too.
        const done = r.fields.done === !!was.fields?.done ? !!now.fields?.done : r.fields.done;
        const f = { ...now.fields, done, gather: r.fields.gather, gathered: r.fields.gathered, mirror: r.fields.mirror };
        r.fields = taskDone(f, Date.now());
      }
    }
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

// A task ticked here, in its words, is done now; unticked, it's open again
// (and whatever timer was running on it stops). See tasks.js.
function taskDone(fields, now) {
  const t = fields.task;
  if (!t?.v) return fields;
  if (fields.done && !t.done_at) return { ...fields, task: { ...t, done_at: now, run: null, log: t.run ? [...(t.log || []), [t.run, now]] : t.log || [] } };
  if (!fields.done && t.done_at) return { ...fields, task: { ...t, done_at: null, actual: null } };
  return fields;
}

// Checklist marks are kept only where set, so other lines' rows don't change.
function checkFields(fields, checklist, box) {
  const f = { ...fields };
  if (checklist) f.checklist = true; else delete f.checklist;
  if (box === null) delete f.box; else f.box = box;
  return f;
}

function toOutlineDoc(pageId, rows, sources = new Map()) {
  const byParent = new Map();
  for (const r of rows) {
    if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []);
    byParent.get(r.parent_id).push(r);
  }
  const list = (pid) => {
    const items = (byParent.get(pid) || []).sort(bySort).map((r) => {
      const v = mirrorView({ eid: r.id, done: !!r.fields?.done, gather: r.fields?.gather || null, gathered: r.fields?.gathered || null, mirror: r.fields?.mirror || null, checklist: !!r.fields?.checklist, box: r.fields?.box ?? null }, r.content, sources);
      const content = [{ type: 'paragraph', ...(v.content ? { content: v.content } : {}) }];
      const kids = list(r.id);
      if (kids) content.push(kids);
      return { type: 'listItem', attrs: v.attrs, content };
    });
    return items.length ? { type: 'bulletList', content: items } : null;
  };
  return { type: 'doc', content: [list(pageId) || { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] };
}
