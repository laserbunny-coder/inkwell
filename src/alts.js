import { Extension, Mark, getMarkRange } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { keyLabel } from './keys.js';

// Alternates: a word, phrase or paragraph can hold other ways of saying it.
// You keep writing with one showing and flip between them in place until one
// settles. Only the one showing is part of the text; exports and word counts
// never see the others.
//
// A word or phrase carries an `alt` mark with every version and which one is
// showing. A paragraph keeps its versions in attributes (saved as
// fields.versions / fields.pvi on its entry).

const parseJson = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };

export const AltMark = Mark.create({
  name: 'alt',
  inclusive: false,
  excludes: 'alt',
  addAttributes() {
    return {
      versions: { default: [], parseHTML: (el) => parseJson(el.getAttribute('data-alts'), []), renderHTML: (a) => ({ 'data-alts': JSON.stringify(a.versions) }) },
      i: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-i')) || 0, renderHTML: (a) => ({ 'data-i': String(a.i) }) }
    };
  },
  parseHTML() { return [{ tag: 'span[data-alts]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', { ...HTMLAttributes, class: 'alt' }, 0]; }
});

export const ParagraphVersions = Extension.create({
  name: 'paragraphVersions',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        versions: { default: null, keepOnSplit: false, rendered: false },
        pvi: {
          default: 0,
          keepOnSplit: false,
          parseHTML: () => 0,
          // Shown as a faint "2/3" in the margin, so you know a paragraph has others.
          renderHTML: (a) => (a.versions?.length > 1 ? { 'data-pv': `${a.pvi + 1}/${a.versions.length}` } : {})
        }
      }
    }];
  }
});

// ---------- finding things in the document ----------

function wordAround(state) {
  const { $from, from, to, empty } = state.selection;
  if (!empty) return { from, to };
  const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, '￼');
  const at = $from.parentOffset;
  let a = at; let b = at;
  const w = /[\p{L}\p{N}'’-]/u;
  while (a > 0 && w.test(text[a - 1])) a -= 1;
  while (b < text.length && w.test(text[b])) b += 1;
  if (a === b) return null;
  const start = $from.start();
  return { from: start + a, to: start + b };
}

// The alternate under the caret (or the selection), if there is one.
export function altAt(state, pos = state.selection.from) {
  const type = state.schema.marks.alt;
  const $pos = state.doc.resolve(pos);
  // The caret can sit just inside either end of the word.
  const mark = [...($pos.nodeAfter?.marks || []), ...($pos.nodeBefore?.marks || [])].find((m) => m.type === type);
  if (!mark) return null;
  const range = getMarkRange($pos, type, mark.attrs);
  if (!range) return null;
  return { ...range, mark, text: state.doc.textBetween(range.from, range.to) };
}

function paragraphAt(state, pos = state.selection.from) {
  const $pos = state.doc.resolve(pos);
  if ($pos.depth < 1) return null;
  const node = $pos.node(1);
  if (!['paragraph', 'heading'].includes(node.type.name)) return null;
  return { node, pos: $pos.before(1) };
}

// Every version, with the one showing brought up to date with any edits to it.
function wordVersions(alt) {
  const versions = [...alt.mark.attrs.versions];
  versions[alt.mark.attrs.i] = alt.text;
  return versions;
}
function paraVersions(p) {
  const versions = p.node.attrs.versions ? [...p.node.attrs.versions] : [p.node.toJSON().content || []];
  versions[p.node.attrs.pvi || 0] = p.node.toJSON().content || [];
  return versions;
}
const contentText = (content) => (content || []).map((n) => n.text || (n.type === 'entryRef' ? n.attrs?.title || '' : '')).join('');

// ---------- changes ----------

function setWord(editor, alt, versions, i) {
  const { state } = editor;
  const type = state.schema.marks.alt;
  if (versions.length < 2) {
    editor.view.dispatch(state.tr.removeMark(alt.from, alt.to, type));
    return;
  }
  const text = versions[i];
  const others = (state.doc.nodeAt(alt.from)?.marks || []).filter((m) => m.type !== type);
  const tr = state.tr.replaceWith(alt.from, alt.to, state.schema.text(text, [...others, type.create({ versions, i })]));
  editor.view.dispatch(tr);
}

function setParagraph(editor, p, versions, i) {
  const { state } = editor;
  const keep = versions.length > 1;
  let tr = state.tr.setNodeMarkup(p.pos, undefined, { ...p.node.attrs, versions: keep ? versions : null, pvi: keep ? i : 0 });
  const content = Fragment.fromJSON(state.schema, versions[i] || []);
  tr = tr.replaceWith(p.pos + 1, p.pos + p.node.nodeSize - 1, content);
  editor.view.dispatch(tr);
}

// Flips to the next or previous version of the word under the caret, or of the
// paragraph if the caret isn't on an alternate. Returns false if there's nothing to flip.
export function flip(editor, dir) {
  const { state } = editor;
  const alt = altAt(state);
  if (alt) {
    const versions = wordVersions(alt);
    const i = (alt.mark.attrs.i + dir + versions.length) % versions.length;
    const caret = Math.min(state.selection.from, alt.from + versions[i].length);
    setWord(editor, alt, versions, i);
    editor.commands.setTextSelection(caret);
    return true;
  }
  const p = paragraphAt(state);
  if (!p || !(p.node.attrs.versions?.length > 1)) return false;
  const versions = paraVersions(p);
  const i = ((p.node.attrs.pvi || 0) + dir + versions.length) % versions.length;
  setParagraph(editor, p, versions, i);
  editor.commands.setTextSelection(p.pos + 1);
  return true;
}

// Keeps the paragraph as it is now as one version and gives you a copy to rewrite.
export function newParagraphVersion(editor) {
  const p = paragraphAt(editor.state);
  if (!p) return false;
  const versions = paraVersions(p);
  const current = versions[p.node.attrs.pvi || 0];
  versions.push(current);
  setParagraph(editor, p, versions, versions.length - 1);
  editor.commands.setTextSelection(p.pos + p.node.nodeSize - 1);
  return true;
}

// ---------- the panel ----------

// A small panel beside the text listing every version. Pick one to use it, type
// to add one, × to drop one. It never takes the caret unless you open it with
// the keyboard to add something.
export class AltPanel {
  constructor(editor) {
    this.editor = editor;
    this.el = document.createElement('aside');
    this.el.className = 'alt-panel';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Alternates');
    document.body.append(this.el);
    this.scope = null;
    this.target = null;
    editor.on('selectionUpdate', () => this.follow());
    editor.on('update', () => this.follow());
    this.el.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); editor.commands.focus(); }
    });
    // Tapping or clicking a word that has alternates shows them.
    editor.view.dom.addEventListener('click', (e) => {
      if (e.target.closest?.('.alt') && !root().classList.contains('focus') && !root().classList.contains('hide-alts')) {
        requestAnimationFrame(() => this.open({ scope: 'word' }));
      }
    });
  }

  get isOpen() { return !this.el.hidden; }

  // scope: 'word' or 'para'. focusAdd puts the caret in the "add" box.
  open({ scope = 'word', focusAdd = false } = {}) {
    const { state } = this.editor;
    this.scope = scope;
    if (scope === 'word') {
      const alt = altAt(state);
      const range = alt || wordAround(state);
      if (!range) { this.scope = 'para'; } else this.target = { from: range.from, to: range.to };
    }
    if (this.scope === 'para') {
      const p = paragraphAt(state);
      if (!p) return;
      this.target = { pos: p.pos };
    }
    this.render();
    this.el.hidden = false;
    this.place();
    if (focusAdd) this.el.querySelector('input')?.focus();
  }

  close() { this.el.hidden = true; this.target = null; }

  toggle(opts) { if (this.isOpen && this.scope === (opts?.scope || 'word')) this.close(); else this.open(opts); }

  // As the caret moves, the panel follows the alternate it's on, or closes.
  follow() {
    if (!this.isOpen) return;
    if (this.el.contains(document.activeElement)) { this.render(true); this.place(); return; }
    const { state } = this.editor;
    if (this.scope === 'word') {
      const alt = altAt(state);
      const range = alt || wordAround(state);
      const sameWord = range && this.target && range.from <= this.target.to && range.to >= this.target.from;
      if (!alt && !sameWord) return this.close();
      this.target = { from: range.from, to: range.to };
    } else {
      const p = paragraphAt(state);
      if (!p) return this.close();
      this.target = { pos: p.pos };
    }
    this.render();
    this.place();
  }

  current() {
    const { state } = this.editor;
    if (this.scope === 'word') {
      const alt = altAt(state, this.target.from);
      if (alt) return { alt, versions: wordVersions(alt), i: alt.mark.attrs.i };
      const text = state.doc.textBetween(this.target.from, this.target.to);
      return { alt: null, versions: [text], i: 0 };
    }
    const p = paragraphAt(state, this.target.pos + 1);
    return { p, versions: paraVersions(p), i: p.node.attrs.pvi || 0 };
  }

  use(versions, i) {
    const c = this.current();
    if (this.scope === 'word') {
      if (c.alt) setWord(this.editor, c.alt, versions, i);
      else if (versions.length > 1) {
        const { state } = this.editor;
        this.editor.view.dispatch(state.tr.addMark(this.target.from, this.target.to, state.schema.marks.alt.create({ versions, i })));
      }
      const alt = altAt(this.editor.state, this.target.from);
      if (alt) this.target = { from: alt.from, to: alt.to };
    } else setParagraph(this.editor, c.p, versions, i);
    this.render(true);
    this.place();
  }

  render(keepInput) {
    if (!this.target) return;
    const { versions, i } = this.current();
    const draft = keepInput ? this.el.querySelector('input')?.value || '' : '';
    const hadFocus = keepInput && this.el.querySelector('input') === document.activeElement;
    const word = this.scope === 'word';
    this.el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'alt-head';
    head.innerHTML = `<span class="panel-label">${word ? 'Alternates' : 'Versions of this paragraph'}</span>`;
    const swap = document.createElement('button');
    swap.type = 'button';
    swap.className = 'ghost-btn';
    swap.textContent = word ? 'Paragraph' : 'Word';
    swap.title = word ? 'Versions of the whole paragraph' : 'Alternates for the word at the caret';
    swap.onclick = () => this.open({ scope: word ? 'para' : 'word' });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ghost-btn';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.onclick = () => { this.close(); this.editor.commands.focus(); };
    head.append(swap, close);
    const list = document.createElement('ul');
    versions.forEach((v, n) => {
      const li = document.createElement('li');
      li.className = n === i ? 'current' : '';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'alt-pick';
      pick.textContent = word ? v : contentText(v).slice(0, 140) || '(empty)';
      pick.title = n === i ? 'Showing now' : 'Use this one';
      pick.onclick = () => { if (n !== i) this.use(versions, n); };
      li.append(pick);
      if (versions.length > 1) {
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'ghost-btn alt-drop';
        drop.textContent = '×';
        drop.setAttribute('aria-label', 'Drop this version');
        drop.onclick = () => {
          const rest = versions.filter((_, k) => k !== n);
          this.use(rest, n === i ? Math.min(n, rest.length - 1) : (n < i ? i - 1 : i));
        };
        li.append(drop);
      }
      list.append(li);
    });
    this.el.append(head, list);
    if (word) {
      const input = document.createElement('input');
      input.placeholder = 'Add another…';
      input.setAttribute('aria-label', 'Add an alternate');
      input.value = draft;
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = input.value.trim();
        if (!v) return;
        const c = this.current();
        if (c.versions.includes(v)) { input.value = ''; return; }
        input.value = '';
        // Adding keeps the one showing; Shift+Enter switches to the new one.
        this.use([...c.versions, v], e.shiftKey ? c.versions.length : c.i);
        this.el.querySelector('input')?.focus();
      });
      this.el.append(input);
      if (hadFocus) input.focus();
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = keyLabel('Enter adds it, ⇧Enter uses it. ⌥↑ ⌥↓ flip in place.');
      this.el.append(hint);
    } else {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'pill';
      add.textContent = 'New version to rewrite';
      add.title = keyLabel('Keeps this one and gives you a copy to change (⌘⇧D)');
      add.onclick = () => { newParagraphVersion(this.editor); this.editor.commands.focus(); };
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = keyLabel('⌥↑ ⌥↓ flip in place.');
      this.el.append(add, hint);
    }
  }

  // Beside the left edge of the page, level with the word; a sheet at the
  // bottom on a narrow screen.
  place() {
    if (!this.target || this.el.hidden) return;
    const narrow = matchMedia('(max-width: 900px)').matches;
    this.el.classList.toggle('sheet-mode', narrow);
    if (narrow) { this.el.style.top = ''; this.el.style.left = ''; return; }
    const pos = this.scope === 'word' ? this.target.from : this.target.pos + 1;
    let top;
    try { top = this.editor.view.coordsAtPos(pos).top; } catch { return; }
    const page = this.editor.view.dom.getBoundingClientRect();
    const width = 240;
    this.el.style.left = `${Math.max(12, page.left - width - 48)}px`;
    this.el.style.top = `${Math.max(12, Math.min(top - 12, window.innerHeight - this.el.offsetHeight - 12))}px`;
  }
}

const root = () => document.documentElement;
