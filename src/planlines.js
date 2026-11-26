// Lines under lines in the plan (Nov 20 2026, Michael: "full outliner type
// text... bullet points that expand"). The summary, every thread line and
// every note in the plan under a scene line is the top line of a small
// outline. The top line stays the plain field it is; the lines under it are
// ordinary outline lines (kind 'line', parent = the line they sit under), and
// the outliner's own rules edit them (src/outline.js), so Enter, Tab, fold and
// move behave as they do on any page.
//   - under a thread line or a note, the first lines' parent is that note;
//   - under the summary, the first lines' parent is the scene's anchor (its
//     heading paragraph) and they carry fields.plan = 'summary', so nothing
//     else that hangs on the anchor is ever mistaken for them.
// A small editor is made for a top line that has lines (or gets its first),
// and dropped (after saving) when its block is drawn again.
import { holdStill } from './steady.js';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import { OutlineDoc, OutlineItem, OutlineKeys, LineIds, OutlineFold, TagMarks, EntryRef, LineChecks, OutlineStore, descendants, toOutlineDoc, foldKey, indentLines, outdentLines, moveLine, toggleDone, toggleBox, hasBox, canMoveLine, removeLine } from './outline.js';
import { openHandleMenu } from './handlemenu.js';
import { toast } from './menu.js';
import { Suggest } from './suggest.js';
import { getEntry, putEntries } from './db.js';
import { plain as make } from './dom.js';

// Folded top lines, on this device, in the outliner's own list.
const FOLDED = 'folded';
const folded = () => { try { return new Set(JSON.parse(localStorage.getItem(FOLDED) || '[]')); } catch { return new Set(); } };
export function isFolded(id) { return folded().has(id); }
export function setFolded(id, on) {
  const set = folded();
  if (on) set.add(id); else set.delete(id);
  try { localStorage.setItem(FOLDED, JSON.stringify([...set].slice(-2000))); } catch {}
}

// The lines under a top line, at any depth (the summary's: only its own).
export async function linesUnder(ownerId, summary = false) {
  const rows = await descendants(ownerId);
  if (!summary) return rows;
  const keep = new Set();
  const byParent = new Map();
  for (const r of rows) { if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []); byParent.get(r.parent_id).push(r); }
  const walk = (id) => { for (const r of byParent.get(id) || []) { keep.add(r.id); walk(r.id); } };
  for (const r of byParent.get(ownerId) || []) if (r.fields?.plan === 'summary') { keep.add(r.id); walk(r.id); }
  return rows.filter((r) => keep.has(r.id));
}

// The same store pages use, rooted at the top line's own row, which it never
// writes (so a summary or note typed meanwhile can't be undone by a save here).
class PlanStore extends OutlineStore {
  constructor(summary, onStatus) {
    super(onStatus);
    this.summary = summary;
    this.touchPage = false;
  }
  async open(ownerId) {
    this.page = (await getEntry(ownerId)) || { id: ownerId };
    const rows = await linesUnder(ownerId, this.summary);
    this.cache = new Map(rows.map((r) => [r.id, r]));
    this.version = this.savedVersion = 0;
    return rows;
  }
  async snapshot() { /* no page history for these */ }
  async write(page, doc, version) {
    await super.write(page, doc, version);
    if (!this.summary) return;
    const fix = [];
    for (const r of this.cache.values()) {
      if (r.parent_id === page.id && !r.deleted && r.fields?.plan !== 'summary') { r.fields = { ...r.fields, plan: 'summary' }; fix.push(r); }
    }
    if (fix.length) await putEntries(fix);
  }
}

const count = (doc) => { let n = 0; doc.descendants((node) => { if (node.type.name === 'listItem') n++; }); return n; };
const blank = (doc) => count(doc) === 1 && !doc.textContent.trim();

// The keys that keep the caret in the plan: Tab never leaves it, Esc goes
// back to the text, Up from the first line and Backspace in an empty first
// line go back to the top line.
const PlanKeys = Extension.create({
  name: 'planKeys',
  priority: 300,
  addOptions() { return { toTop: () => {}, leave: () => {} }; },
  addKeyboardShortcuts() {
    const ed = () => this.editor;
    const atFirst = () => {
      const { $from, empty } = ed().state.selection;
      return empty && $from.parentOffset === 0 && $from.before($from.depth) === 2;
    };
    return {
      Tab: () => { indentLines(ed()); return true; },
      'Shift-Tab': () => { outdentLines(ed()); return true; },
      Escape: () => { this.options.leave(); return true; },
      ArrowUp: () => { if (!atFirst()) return false; this.options.toTop(); return true; },
      Backspace: () => {
        if (!atFirst()) return false;
        const doc = ed().state.doc;
        const first = doc.firstChild.firstChild;
        if (first.firstChild.content.size || first.childCount > 1) { this.options.toTop(); return true; }
        // An empty first line with nothing under it goes; the caret goes up.
        if (doc.firstChild.childCount === 1) { this.options.toTop(true); return true; }
        ed().commands.command(({ tr }) => { tr.delete(1, 1 + first.nodeSize); return true; });
        this.options.toTop();
        return true;
      }
    };
  }
});

export class PlanLines {
  // hooks: leave(), openRef(id), onFocus(editor | null)
  constructor(hooks) {
    this.hooks = hooks;
    this.live = new Map(); // owner id -> { editor, store, box }
    this.active = null;
  }

  // Under a top line: { sub, fold }. sub holds the lines (empty when there
  // are none); fold is the ▾ / "▸ N" mark for the top line's right end.
  // start: make a first line (or a new first line) and put the caret in it.
  // top(): the top line's field, for the caret to go back to.
  mount(ownerId, { summary = false, start = false, top = () => null, leave = null, folds = true } = {}) {
    const sub = make('div', 'wv-sub');
    sub.hidden = true;
    const fold = make('button', 'wv-fold');
    fold.type = 'button';
    fold.hidden = true;
    if (!ownerId) return { sub, fold };
    fold.addEventListener('click', () => holdStill(() => (fold.isConnected ? fold : document.querySelector(`[data-owner="${CSS.escape(ownerId)}"] .wv-fold`)), () => {
      setFolded(ownerId, !isFolded(ownerId));
      const it = this.live.get(ownerId);
      if (it) this.show(it);
    }));
    const opts = { top, leave };
    // Drawn again (the line's block is rebuilt often): the same editor moves
    // into the new place at once, so nothing under the pointer shifts.
    const prev = this.live.get(ownerId);
    if (prev && !prev.editor.isDestroyed) {
      sub.append(prev.host);
      Object.assign(prev, { sub, fold, opts, folds });
      this.show(prev);
      if (start) this.startLine(prev, true);
      return { sub, fold };
    }
    (async () => {
      const store = new PlanStore(summary, () => {});
      const rows = await store.open(ownerId);
      if ((!rows.length && !start) || this.live.has(ownerId)) return;
      if (start && folds && isFolded(ownerId)) setFolded(ownerId, false);
      const host = make('div', 'wv-lines');
      sub.append(host);
      const it = { ownerId, store, sub, fold, opts, host, summary, folds, n: 0, editor: null };
      const toTop = (dropIt = false) => {
        const f = it.opts.top();
        if (dropIt) this.clear(ownerId);
        if (f) { f.focus(); if (f.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length); }
      };
      const goBack = () => (it.opts.leave ? it.opts.leave() : this.hooks.leave?.());
      it.editor = new Editor({
        element: host,
        extensions: [
          StarterKit.configure({ document: false, listItem: false, codeBlock: false, code: false, horizontalRule: false, heading: false, blockquote: false, trailingNode: false }),
          OutlineDoc, OutlineItem, OutlineKeys, LineIds, OutlineFold, TagMarks, LineChecks,
          EntryRef.configure({ onOpen: (id) => this.hooks.openRef?.(id) }), Suggest,
          PlanKeys.configure({ toTop, leave: goBack })
        ],
        content: toOutlineDoc(ownerId, rows),
        onUpdate: ({ editor: e }) => { store.change(e.state.doc); it.n = count(e.state.doc); this.show(it); },
        onFocus: ({ editor: e }) => { this.active = e; this.hooks.onFocus?.(e); },
        onBlur: ({ editor: e }) => {
          store.flush(e.state.doc);
          // A first line left empty is no line at all (once the tap that
          // took the caret away has landed, so nothing moves under it).
          setTimeout(() => { if (!e.isDestroyed && !e.isFocused && blank(e.state.doc)) this.clear(ownerId); }, 300);
          setTimeout(() => { if (this.active === e && !e.isFocused) { this.active = null; this.hooks.onFocus?.(null); } }, 50);
        }
      });
      it.editor.view.dom.setAttribute('aria-label', 'Lines under it');
      // One way everywhere (Nov 26 2026): held still, or a right-click, is the line's menu here too.
      it.editor.view.dom.addEventListener('line-menu', (e) => {
        const { eid, anchor, at } = e.detail;
        const li = anchor.closest('li');
        li?.classList.add('menu-open');
        openHandleMenu({ anchor, at, editor: it.editor, build: () => linesMenu(it.editor, eid), onClose: () => li?.classList.remove('menu-open') });
      });
      this.live.set(ownerId, it);
      it.n = count(it.editor.state.doc);
      this.show(it);
      if (start) this.startLine(it, rows.length > 0);
    })().catch((e) => console.error(e));
    return { sub, fold };
  }

  show(it) {
    // The grid opens a cell's lines on a tap, whatever the plan's fold says.
    const shut = it.folds && isFolded(it.ownerId);
    const { fold, sub } = it;
    fold.hidden = !it.n || !it.folds;
    sub.hidden = !it.n || shut;
    fold.textContent = shut ? `▸ ${it.n}` : '▾';
    fold.title = shut ? `Show the ${it.n === 1 ? 'line' : `${it.n} lines`} under it (Ctrl + Down)` : 'Fold the lines under it (Ctrl + Up)';
    fold.setAttribute('aria-label', fold.title);
    fold.setAttribute('aria-expanded', String(!shut));
  }

  // The caret into a first line: a new one above the others when there are
  // some, else the one empty line a new outline starts with.
  startLine(it, fresh) {
    if (it.folds && isFolded(it.ownerId)) { setFolded(it.ownerId, false); this.show(it); }
    const ed = it.editor;
    if (fresh) {
      const tr = ed.state.tr.insert(1, ed.schema.nodes.listItem.create(null, ed.schema.nodes.paragraph.create()));
      tr.setSelection(TextSelection.create(tr.doc, 3));
      ed.view.dispatch(tr);
    }
    requestAnimationFrame(() => ed.commands.focus(fresh ? 3 : 'start', { scrollIntoView: false }));
  }

  // Everything under a top line goes (its only line was left empty).
  async clear(ownerId) {
    const it = this.live.get(ownerId);
    if (!it) return;
    this.live.delete(ownerId);
    const { editor, store, sub, fold } = it;
    await store.saving;
    const gone = [...store.cache.values()].filter((r) => !r.deleted).map((r) => ({ ...r, deleted: true, updated_at: Date.now() }));
    if (gone.length) await putEntries(gone);
    editor.destroy();
    sub.replaceChildren();
    sub.hidden = true;
    fold.hidden = true;
  }

  // Saved, then let go (its block is being drawn again, or the chapter closes).
  async drop(ownerId) {
    const it = this.live.get(ownerId);
    if (!it) return;
    this.live.delete(ownerId);
    if (!it.store.idle) await it.store.flush(it.editor.state.doc);
    await it.store.saving;
    it.editor.destroy();
  }

  // Blocks that are no longer on the page.
  sweep() {
    for (const [id, it] of this.live) if (!it.sub.isConnected) this.drop(id);
  }
  async dropAll() {
    await Promise.all([...this.live.keys()].map((id) => this.drop(id)));
  }
  editorFor(ownerId) { return this.live.get(ownerId)?.editor || null; }

  // The phone's outline row works on the plan line you're in.
  act(what) {
    const ed = this.active;
    if (!ed) return false;
    if (what === 'indent') { ed.commands.focus(); indentLines(ed); }
    else if (what === 'outdent') { ed.commands.focus(); outdentLines(ed); }
    else if (what === 'up' || what === 'down') moveLine(ed, what === 'up' ? -1 : 1);
    else if (what === 'undo') ed.chain().focus().undo().run();
    else if (what === 'redo') ed.chain().focus().redo().run();
    else if (what === 'fold') {
      const { $from } = ed.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const li = $from.node(d);
        if (li.type.name !== 'listItem') continue;
        if (li.lastChild?.type.name !== 'bulletList') continue;
        const on = !foldKey.getState(ed.state)?.folded?.has(li.attrs.eid);
        ed.view.dispatch(ed.state.tr.setMeta(foldKey, { fold: li.attrs.eid, on }));
        break;
      }
      ed.commands.focus();
    }
    else return false;
    return true;
  }
}

// Everything under a removed thread line or note goes to the Trash with it;
// Undo brings back exactly those lines.
export async function trashLinesUnder(ownerId) {
  const rows = await descendants(ownerId);
  const now = Date.now();
  const gone = rows.map((r) => ({ ...r, deleted: true, updated_at: now }));
  if (gone.length) await putEntries(gone);
  return gone;
}
export async function restoreLines(rows) {
  const now = Date.now();
  if (rows.length) await putEntries(rows.map((r) => ({ ...r, deleted: false, updated_at: now })));
}

// The menu for a line in a small outline: what can be done to the line itself.
function findIn(ed, eid) {
  let hit = null;
  ed.state.doc.descendants((n, pos) => {
    if (hit) return false;
    if (n.type.name === 'listItem' && n.attrs.eid === eid) { hit = { node: n, pos, $pos: ed.state.doc.resolve(pos) }; return false; }
    return true;
  });
  return hit;
}
function linesMenu(ed, eid) {
  const line = findIn(ed, eid);
  if (!line) return { sections: [] };
  const { node, pos, $pos } = line;
  let under = 0;
  node.descendants((n) => { if (n.type.name === 'listItem') under++; });
  const nested = $pos.depth > 1;
  const inChecklist = nested && !!$pos.node($pos.depth - 1).attrs.checklist;
  const lines = (n) => `${n} line${n === 1 ? '' : 's'}`;
  // Line actions work on the line the caret is in, so put it there first.
  const on = (fn) => () => {
    const now = findIn(ed, eid);
    if (!now) return;
    ed.commands.setTextSelection(now.pos + 1 + now.node.firstChild.nodeSize - 1);
    fn();
  };
  return {
    title: `Line${under ? ` · ${lines(under)} under it` : ''}`,
    sections: [
      [
        { label: node.attrs.done ? 'Not done' : 'Mark done', keys: '⌘↵', run: on(() => { toggleDone(ed); ed.commands.focus(); }) },
        { label: hasBox(node, inChecklist) ? 'No box on this line' : 'Box on this line', run: on(() => { toggleBox(ed); ed.commands.focus(); }) }
      ],
      [
        { label: 'Outdent', keys: '⇧Tab', stay: true, half: 'indent', off: !nested, run: on(() => { ed.commands.focus(); outdentLines(ed); }) },
        { label: 'Indent', keys: 'Tab', stay: true, half: 'indent', off: $pos.index() === 0, run: on(() => { ed.commands.focus(); indentLines(ed); }) },
        { label: 'Move up', keys: 'Alt+⇧↑', stay: true, half: 'move', off: !canMoveLine(ed.state, -1, pos + 2), run: on(() => moveLine(ed, -1)) },
        { label: 'Move down', keys: 'Alt+⇧↓', stay: true, half: 'move', off: !canMoveLine(ed.state, 1, pos + 2), run: on(() => moveLine(ed, 1)) }
      ],
      [{ label: under ? `Delete line and the ${lines(under)} under it` : 'Delete line', danger: true, run: () => {
        const now = findIn(ed, eid);
        if (!now) return;
        const tr = ed.state.tr;
        if (now.$pos.depth === 1 && now.$pos.parent.childCount === 1) tr.replaceWith(now.pos, now.pos + now.node.nodeSize, ed.schema.nodes.listItem.create(null, ed.schema.nodes.paragraph.create()));
        else removeLine(tr, now.pos);
        ed.view.dispatch(tr);
        ed.commands.focus();
        toast(under ? `Deleted a line and the ${lines(under)} under it` : 'Line deleted', { label: 'Undo', run: () => ed.chain().focus().undo().run() });
      } }]
    ]
  };
}
