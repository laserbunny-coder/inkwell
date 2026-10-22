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
      i: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-i')) || 0, renderHTML: (a) => ({ 'data-i': String(a.i) }) },
      // The versions Claude suggested, so the panel can mark them.
      claude: { default: [], parseHTML: (el) => parseJson(el.getAttribute('data-claude'), []), renderHTML: (a) => (a.claude?.length ? { 'data-claude': JSON.stringify(a.claude) } : {}) }
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
        // The rewrites Claude suggested (their words), so a paragraph showing
        // one of them is saved as Claude's writing until you change it.
        pclaude: { default: null, keepOnSplit: false, rendered: false },
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

function paragraphById(state, eid) {
  let found = null;
  state.doc.forEach((node, pos) => { if (!found && eid && node.attrs.eid === eid) found = { node, pos }; });
  return found;
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

function setWord(editor, alt, versions, i, claude = alt.mark?.attrs.claude || []) {
  const { state } = editor;
  const type = state.schema.marks.alt;
  if (versions.length < 2) {
    editor.view.dispatch(state.tr.removeMark(alt.from, alt.to, type));
    return;
  }
  const text = versions[i];
  const others = (state.doc.nodeAt(alt.from)?.marks || []).filter((m) => m.type !== type);
  const by = claude.filter((v) => versions.includes(v));
  const tr = state.tr.replaceWith(alt.from, alt.to, state.schema.text(text, [...others, type.create({ versions, i, claude: by })]));
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

// What the caret is on, for the row above a phone keyboard: the word's
// alternates (which one of how many) and the paragraph's versions.
export function altsHere(state) {
  const alt = altAt(state);
  const p = paragraphAt(state);
  const pv = p?.node.attrs.versions?.length > 1 ? { i: p.node.attrs.pvi || 0, n: p.node.attrs.versions.length } : null;
  return { word: alt ? { i: alt.mark.attrs.i, n: wordVersions(alt).length } : null, para: pv };
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
// What Claude gets to see when asked: the paragraph with the passage marked,
// a little text either side, and what the book is.
const LEAF = '\ufffc';
function paragraphText(state, p) {
  return state.doc.textBetween(p.pos + 1, p.pos + p.node.nodeSize - 1, undefined, LEAF);
}
function around(state, p, dir, limit) {
  const out = [];
  let size = 0;
  const index = state.doc.resolve(p.pos).index(0);
  for (let k = index + dir; k >= 0 && k < state.doc.childCount && size < limit; k += dir) {
    const t = state.doc.child(k).textContent;
    if (!t) continue;
    out[dir < 0 ? 'unshift' : 'push'](t);
    size += t.length;
  }
  return out.join('\n\n');
}

// Claude's suggestions can reach a word or two past the passage ("a" to "an").
// All versions then cover the same wider stretch, so flipping back restores the
// sentence exactly. A stretch that would cross a link, another alternate or a
// change of bold/italic stays at the passage.
function placeSuggestions(state, p, target, suggestions) {
  const start = p.pos + 1;
  const text = paragraphText(state, p);
  const tFrom = target.from - start;
  const tTo = target.to - start;
  const found = [];
  for (const s of suggestions || []) {
    const replace = typeof s?.replace === 'string' ? s.replace : '';
    const said = typeof s?.with === 'string' ? s.with.trim() : '';
    if (!replace || !said || said.includes(LEAF) || /[⟦⟧\n]/.test(said)) continue;
    let at = -1;
    for (let k = text.indexOf(replace, Math.max(0, tFrom - replace.length)); k !== -1 && k <= tFrom; k = text.indexOf(replace, k + 1)) {
      if (k + replace.length >= tTo) { at = k; break; }
    }
    if (at === -1 || tFrom - at > 30 || at + replace.length - tTo > 30) continue;
    found.push({ a: at, b: at + replace.length, said });
  }
  const type = state.schema.marks.alt;
  const own = altAt(state, target.from)?.mark || null;
  const plain = (a, b) => {
    let ok = true;
    let first = null;
    state.doc.nodesBetween(start + a, start + b, (node) => {
      if (!node.isText) { if (!node.isBlock) ok = false; return; }
      const marks = node.marks.filter((m) => m.type !== type);
      const alt = node.marks.find((m) => m.type === type);
      if (alt && !(own && alt.eq(own))) ok = false;
      const key = JSON.stringify(marks.map((m) => m.toJSON()));
      if (first === null) first = key; else if (key !== first) ok = false;
    });
    return ok;
  };
  let use = found;
  let a = Math.min(tFrom, ...use.map((f) => f.a));
  let b = Math.max(tTo, ...use.map((f) => f.b));
  if (!plain(a, b)) {
    use = found.filter((f) => f.a === tFrom && f.b === tTo);
    a = tFrom; b = tTo;
  }
  const wrap = (s, x, y) => text.slice(a, x) + s + text.slice(y, b);
  return {
    from: start + a,
    to: start + b,
    prefix: text.slice(a, tFrom),
    suffix: text.slice(tTo, b),
    added: use.map((f) => wrap(f.said, f.a, f.b))
  };
}

export class AltPanel {
  // ask(body) sends a request to Claude and resolves with its answer; canAsk()
  // says whether that's possible now (signed in, online); context() describes
  // the book for Claude.
  constructor(editor, { ask = null, canAsk = () => false, context = () => ({}) } = {}) {
    this.editor = editor;
    this.ask = ask;
    this.canAsk = canAsk;
    this.context = context;
    this.busy = false;
    this.note = '';
    this.el = document.createElement('aside');
    this.el.className = 'alt-panel';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Alternates');
    document.body.append(this.el);
    this.scope = null;
    this.target = null;
    editor.on('selectionUpdate', () => this.follow());
    editor.on('update', () => this.follow());
    window.visualViewport?.addEventListener('resize', () => this.place());
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
    if (!this.busy) this.note = '';
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
    const { versions, i, alt } = this.current();
    const byClaude = new Set(alt?.mark.attrs.claude || []);
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
      if (word && byClaude.has(v)) { li.classList.add('by-claude'); pick.title += ' (suggested by Claude)'; }
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
        if (v === '??') { input.value = ''; this.askClaude(); return; }
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
      this.appendAsk('Ask Claude', 'Ask Claude for ones that fit this sentence (or type ?? and Enter)');
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
      this.el.append(add);
      this.appendAsk('Ask Claude for a rewrite', 'Adds two rewrites of this paragraph to flip between');
      this.el.append(hint);
    }
    if (this.note) {
      const note = document.createElement('div');
      note.className = 'hint alt-note';
      note.textContent = this.note;
      this.el.append(note);
    }
  }

  appendAsk(label, title) {
    if (!this.ask || !this.canAsk()) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill alt-ask';
    b.textContent = this.busy ? 'Asking Claude…' : label;
    b.title = title;
    b.disabled = this.busy;
    b.onclick = () => this.askClaude();
    this.el.append(b);
  }

  async askClaude() {
    if (this.busy || !this.ask || !this.target) return;
    if (!this.canAsk()) { this.note = 'Asking Claude needs a connection and sync turned on.'; this.render(); return; }
    const { state } = this.editor;
    const word = this.scope === 'word';
    const p = paragraphAt(state, word ? this.target.from : this.target.pos + 1);
    if (!p) return;
    const text = paragraphText(state, p);
    const ctx = (await this.context()) || {};
    const body = {
      mode: word ? 'word' : 'paragraph',
      before: around(state, p, -1, 3000),
      after: around(state, p, 1, 2000),
      book: ctx.book || '',
      chapter: ctx.chapter || '',
      idea: ctx.idea || '',
      element: p.node.attrs.el || ''
    };
    let target = null;
    if (word) {
      target = { from: this.target.from, to: this.target.to };
      const start = p.pos + 1;
      const a = target.from - start;
      const b = target.to - start;
      body.paragraph = `${text.slice(0, a)}⟦${text.slice(a, b)}⟧${text.slice(b)}`.replaceAll(LEAF, '');
      body.existing = this.current().versions;
    } else body.paragraph = p.node.textContent;
    const eid = p.node.attrs.eid;
    this.busy = true;
    this.note = '';
    this.render(true);
    let answer;
    try {
      answer = await this.ask(body);
    } catch (e) {
      this.note = e?.message || 'Couldn’t reach Claude. Try again.';
    }
    this.busy = false;
    // Only use the answer if the paragraph is still as it was when we asked.
    const now = paragraphById(this.editor.state, eid);
    if (answer && (!now || now.node.attrs.eid !== eid || paragraphText(this.editor.state, now) !== text)) {
      answer = null;
      this.note = 'The paragraph changed while Claude was thinking. Ask again.';
    }
    if (answer?.error) { this.note = answer.error; answer = null; }
    if (answer && word) { const shift = now.pos - p.pos; this.addWordSuggestions(now, { from: target.from + shift, to: target.to + shift }, answer.suggestions); }
    if (answer && !word) this.addRewrites(now, answer.rewrites);
    if (this.isOpen) { this.render(true); this.place(); }
  }

  addWordSuggestions(p, target, suggestions) {
    const { state } = this.editor;
    const placed = placeSuggestions(state, p, target, suggestions);
    const alt = altAt(state, target.from);
    const mine = alt ? wordVersions(alt) : [state.doc.textBetween(target.from, target.to)];
    const i = alt ? alt.mark.attrs.i : 0;
    const versions = mine.map((v) => placed.prefix + v + placed.suffix);
    const claude = (alt?.mark.attrs.claude || []).map((v) => placed.prefix + v + placed.suffix);
    let added = 0;
    for (const v of placed.added) {
      if (versions.includes(v)) continue;
      versions.push(v);
      claude.push(v);
      added += 1;
    }
    if (!added) { this.note = 'Claude didn’t come up with anything new for this one.'; return; }
    setWord(this.editor, { from: placed.from, to: placed.to, mark: null }, versions, i, claude);
    this.target = { from: placed.from, to: placed.from + versions[i].length };
    this.scope = 'word';
  }

  addRewrites(p, rewrites) {
    const texts = (rewrites || []).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().replace(/\s*\n+\s*/g, ' '));
    const versions = paraVersions(p);
    const have = new Set(versions.map(contentText));
    const fresh = texts.filter((t) => !have.has(t));
    if (!fresh.length) { this.note = 'Claude didn’t come up with a new rewrite. Try again.'; return; }
    for (const t of fresh) versions.push([{ type: 'text', text: t }]);
    const { state } = this.editor;
    this.editor.view.dispatch(state.tr.setNodeMarkup(p.pos, undefined, { ...p.node.attrs, pclaude: [...(p.node.attrs.pclaude || []), ...fresh] }));
    p = paragraphById(this.editor.state, p.node.attrs.eid);
    setParagraph(this.editor, p, versions, p.node.attrs.pvi || 0);
    this.target = { pos: p.pos };
    this.note = `Added ${fresh.length === 1 ? 'a rewrite' : `${fresh.length} rewrites`}. Pick one, or flip with ⌥↑ ⌥↓.`;
  }

  // Beside the left edge of the page, level with the word; a sheet at the
  // bottom on a narrow screen.
  place() {
    if (!this.target || this.el.hidden) return;
    const narrow = matchMedia('(max-width: 900px)').matches;
    this.el.classList.toggle('sheet-mode', narrow);
    if (narrow) {
      this.el.style.top = ''; this.el.style.left = '';
      const vv = window.visualViewport;
      const keyboard = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
      const bar = [...document.querySelectorAll('.script-bar')].find((b) => !b.hidden);
      const barH = bar ? bar.offsetHeight : 0;
      this.el.style.bottom = `${keyboard + barH + 8}px`;
      this.el.style.maxHeight = `${Math.round(((vv ? vv.height : window.innerHeight) - barH) * 0.6)}px`;
      return;
    }
    const pos = this.scope === 'word' ? this.target.from : this.target.pos + 1;
    let top;
    try { top = this.editor.view.coordsAtPos(pos).top; } catch { return; }
    const page = this.editor.view.dom.getBoundingClientRect();
    const width = 240;
    this.el.style.bottom = ''; this.el.style.maxHeight = '';
    this.el.style.left = `${Math.max(12, page.left - width - 48)}px`;
    this.el.style.top = `${Math.max(12, Math.min(top - 12, window.innerHeight - this.el.offsetHeight - 12))}px`;
  }
}

const root = () => document.documentElement;
