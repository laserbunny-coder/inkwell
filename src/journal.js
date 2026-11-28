// The Journal line (Nov 28 2026, Michael: "the top of the day in page view be
// a journal I can type in… a journal tag that I can pull up later and see all
// the journals in one place"). Every day page starts with one fixed line,
// "Journal". The lines written under it are ordinary outline lines, and they
// count as #journal without the tag being typed (db.js byTag, search.js).
//
// The line itself can't be renamed, deleted, moved, indented or turned into
// a task, and nothing goes above it. Its row (jr-YYYY-MM-DD, fields.journal)
// is saved only once something is written under it (outline.js), so an
// empty day doesn't fill the database. Its fold is one setting for every day
// on this device (outline.js FoldSet). All journals: journalpage.js.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ReplaceStep } from '@tiptap/pm/transform';
import { newId, entry, tagsIn } from './model.js';
import { getEntry, children } from './db.js';
import { foldKey } from './outline.js';

export const LABEL = 'Journal';
export const journalId = (iso) => `jr-${iso}`;
export const isJournalId = (id) => typeof id === 'string' && id.startsWith('jr-');
export const journalDay = (id) => (isJournalId(id) ? id.slice(3) : null);

const key = new PluginKey('journalLine');

// A day page's document (JSON) with its Journal line first: the saved one if
// there is one (wherever it had got to), else a new one with an empty line
// under it to write on. A page with nothing on it yet is only the Journal.
export function withJournal(doc, iso, emptyId = null) {
  const id = journalId(iso);
  const list = doc?.content?.[0]?.type === 'bulletList' ? doc.content[0] : { type: 'bulletList', content: [] };
  let items = (list.content || []).map((li) => (li.attrs?.journal && li.attrs.eid !== id ? { ...li, attrs: { ...li.attrs, journal: false } } : li));
  let j = items.find((li) => li.attrs?.eid === id);
  items = items.filter((li) => li !== j);
  // The empty page's one blank line (no id yet) gives way to the journal.
  if (!j && items.length === 1 && !items[0].attrs?.eid && !(items[0].content?.[0]?.content?.length) && items[0].content?.length < 2) items = [];
  const kids = j?.content?.find((c) => c.type === 'bulletList');
  const under = kids?.content?.length ? kids : { type: 'bulletList', content: [{ type: 'listItem', attrs: { eid: emptyId || newId('li') }, content: [{ type: 'paragraph' }] }] };
  j = { type: 'listItem', attrs: { ...(j?.attrs || {}), eid: id, journal: true, done: false, gather: null, mirror: null, checklist: false, box: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: LABEL }] }, under] };
  return { ...doc, type: 'doc', content: [{ ...list, content: [j, ...items] }] };
}

// The Journal line in a document, if it has one: always the first line.
export function journalIn(doc) {
  const list = doc.firstChild;
  const li = list?.firstChild;
  return li?.type.name === 'listItem' && li.attrs.journal ? { node: li, pos: 1 } : null;
}
const countJournals = (doc) => { let n = 0; doc.descendants((node) => { if (node.type.name === 'listItem' && node.attrs.journal) n++; return node.type.name !== 'paragraph'; }); return n; };
// The caret is on the Journal line's own words.
function onJournal(state) {
  const { $from } = state.selection;
  const j = journalIn(state.doc);
  return j && $from.depth >= 2 && $from.parent.type.name === 'paragraph' && $from.before($from.depth - 1) === j.pos ? j : null;
}
const kidsOf = (li) => (li.lastChild?.type.name === 'bulletList' ? li.lastChild : null);
// Lines under it, at any depth, that have words.
export function journalCount(node) {
  let n = 0;
  kidsOf(node)?.descendants((c) => { if (c.type.name === 'listItem' && c.firstChild?.content.size) n++; });
  return n;
}

// Puts the caret at the end of the first line under the Journal line (makes
// one if there's none), opening the fold. Returns the transaction.
export function intoJournal(state, { end = false } = {}) {
  const j = journalIn(state.doc);
  if (!j) return null;
  const tr = state.tr;
  if (foldKey.getState(state)?.folded.has(j.node.attrs.eid)) tr.setMeta(foldKey, { fold: j.node.attrs.eid, on: false });
  const kids = kidsOf(j.node);
  const schema = state.schema;
  let at;
  if (!kids) {
    const pos = j.pos + j.node.nodeSize - 1;
    tr.insert(pos, schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, schema.nodes.paragraph.create())));
    at = pos + 3;
  } else {
    const listPos = j.pos + 1 + j.node.firstChild.nodeSize;
    const li = end ? kids.lastChild : kids.firstChild;
    const liPos = end ? listPos + kids.nodeSize - 1 - li.nodeSize : listPos + 1;
    at = liPos + 1 + li.firstChild.nodeSize - 1;
  }
  return tr.setSelection(TextSelection.create(tr.doc, at)).scrollIntoView();
}

// setContent (opening a page, another device's version): the whole document
// replaced at once, which the guard lets through.
const wholeDoc = (tr, doc) => tr.steps.some((st) => st instanceof ReplaceStep && st.from === 0 && st.to === doc.content.size);

export const JournalLine = Extension.create({
  name: 'journalLine',
  // Ahead of the outline's own keys and clicks.
  priority: 300,
  addOptions() { return { onAll: () => {} }; },
  addKeyboardShortcuts() {
    const ed = () => this.editor;
    const stay = () => !!onJournal(ed().state);
    return {
      // Enter on the Journal line goes to the first line under it.
      Enter: () => { if (!stay()) return false; ed().view.dispatch(intoJournal(ed().state)); return true; },
      'Shift-Enter': () => stay(),
      Backspace: () => { const { $from, empty } = ed().state.selection; return stay() && empty && $from.parentOffset === 0; },
      Delete: () => { const { $from, empty } = ed().state.selection; return stay() && empty && $from.parentOffset === $from.parent.content.size; },
      Tab: () => stay(),
      'Shift-Tab': () => stay(),
      'Mod-Enter': () => stay(),
      'Mod-Shift-Enter': () => stay(),
      'Mod-Shift-Backspace': () => stay(),
      'Alt-Shift-ArrowUp': () => stay(),
      'Alt-Shift-ArrowDown': () => stay(),
      'Mod-Shift-ArrowUp': () => stay(),
      'Mod-Shift-ArrowDown': () => stay()
    };
  },
  addProseMirrorPlugins() {
    const onAll = () => this.options.onAll();
    return [new Plugin({
      key,
      // The guard: the Journal line stays first, keeps its name and its id,
      // and there's only ever one.
      filterTransaction(tr, state) {
        if (!tr.docChanged) return true;
        const was = journalIn(state.doc);
        if (!was || wholeDoc(tr, state.doc)) return true;
        const now = journalIn(tr.doc);
        return !!now && now.node.attrs.eid === was.node.attrs.eid && now.node.firstChild.textContent === LABEL &&
          now.node.firstChild.childCount === 1 && countJournals(tr.doc) === 1;
      },
      props: {
        // Words typed on the Journal line go to the first line under it.
        handleTextInput(view, _from, _to, text) {
          if (!onJournal(view.state)) return false;
          const tr = intoJournal(view.state);
          view.dispatch(tr.insertText(text, tr.selection.from));
          return true;
        },
        handlePaste: (view) => !!onJournal(view.state),
        decorations(state) {
          const j = journalIn(state.doc);
          if (!j) return null;
          const { node, pos } = j;
          const folded = !!foldKey.getState(state)?.folded.has(node.attrs.eid);
          const n = journalCount(node);
          const decos = [Decoration.node(pos, pos + node.nodeSize, { class: 'journal' })];
          decos.push(Decoration.widget(pos + 1 + node.firstChild.nodeSize - 1, () => {
            const w = document.createElement('span');
            w.className = 'jr-tail';
            w.contentEditable = 'false';
            const count = document.createElement('span');
            count.className = 'jr-count';
            count.textContent = folded && n ? `${n} line${n === 1 ? '' : 's'}` : '';
            const all = document.createElement('button');
            all.type = 'button';
            all.className = 'jr-all';
            all.tabIndex = -1;
            all.textContent = 'All journals ›';
            all.title = 'Every day’s journal in one place';
            const tri = document.createElement('button');
            tri.type = 'button';
            tri.className = 'jr-fold';
            tri.tabIndex = -1;
            tri.setAttribute('aria-label', folded ? 'Unfold the journal' : 'Fold the journal');
            tri.title = folded ? 'Unfold the journal' : 'Fold the journal';
            w.append(count, all, tri);
            return w;
          }, { side: 1, key: `jr-tail-${folded ? 1 : 0}-${folded ? n : ''}`, ignoreSelection: true, stopEvent: () => true }));
          // An empty journal: "Write here…" on its one line.
          const kids = kidsOf(node);
          const only = kids?.childCount === 1 ? kids.firstChild : null;
          if (only && !only.firstChild.content.size && !kidsOf(only)) {
            const p = pos + 1 + node.firstChild.nodeSize + 1 + 1;
            decos.push(Decoration.node(p, p + only.firstChild.nodeSize, { class: 'jr-write', 'data-ph': 'Write here…' }));
          }
          return DecorationSet.create(state.doc, decos);
        },
        handleDOMEvents: {
          pointerdown(view, event) {
            const b = event.target.closest?.('.jr-tail button');
            if (!b) return !!event.target.closest?.('.jr-tail');
            event.preventDefault();
            if (b.classList.contains('jr-fold')) {
              const j = journalIn(view.state.doc);
              if (j) view.dispatch(view.state.tr.setMeta(foldKey, { fold: j.node.attrs.eid }));
            } else if (b.classList.contains('jr-all')) onAll();
            return true;
          },
          mousedown: (_view, event) => !!event.target.closest?.('.jr-tail'),
          click: (_view, event) => !!event.target.closest?.('.jr-tail')
        }
      }
    })];
  }
});

// A day's Journal row, as saved (made now if it isn't yet: returned in
// `made`, for the caller to save with the rest).
export async function journalRow(iso) {
  const id = journalId(iso);
  const was = await getEntry(id);
  if (was && !was.deleted) return { row: was, made: null };
  const first = (await children(`day-${iso}`)).find((r) => r.kind === 'line');
  const row = {
    ...(was || entry('line', { id })), id, kind: 'line', parent_id: `day-${iso}`, sort: (first?.sort ?? 1) - 1, title: '',
    text: LABEL, content: [{ type: 'text', text: LABEL }], tags: [], links: [], deleted: false, updated_at: Date.now(),
    fields: { done: false, gather: null, gathered: null, mirror: null, journal: true }
  };
  return { row, made: row };
}

// A Journal-mode voice capture filed at the top of a day's page goes under
// that day's Journal line, at the end, with its time; the #journal is
// implied there, so it comes off the words. Returns the rows to save (the
// line, and the Journal row if it was made).
export async function intoJournalRow(line) {
  const iso = String(line?.parent_id || '').startsWith('day-') ? line.parent_id.slice(4) : null;
  if (!iso) return [line];
  const { row, made } = await journalRow(iso);
  const kids = made ? [] : await children(row.id);
  const sort = Math.max(0, ...kids.filter((k) => k.id !== line.id).map((k) => k.sort || 0)) + 1;
  const content = (line.content || []).map((n, i, all) => (i === all.length - 1 && n.type === 'text' ? { ...n, text: n.text.replace(/\s+#journal(?=\s|$)/u, '') } : n));
  const text = content.map((n) => (n.type === 'text' ? n.text : n.type === 'entryRef' ? n.attrs?.title || '' : '')).join('');
  return [...(made ? [made] : []), { ...line, parent_id: row.id, sort, content, text, tags: tagsIn(text), updated_at: Date.now() }];
}
