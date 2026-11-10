// Notes beside. In the Beside pane, the notes on the draft open in the main
// window, in the order of the text: your own, Claude's and readers' comments.
// Clicking one takes the main window to its paragraph. Writing and answering
// notes stays in the margin (Notes, Ctrl + 2); this is for reading them
// alongside while the margin is put away.

import './beside.css';
import { byKind, children, getEntry } from './db.js';
import { noteTypes } from './model.js';
import { bySort } from './order.js';

const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// The paragraphs of a chapter in reading order, however deep they sit.
async function paragraphs(chapterId) {
  const out = [];
  const walk = async (id) => {
    for (const r of (await children(id)).filter((x) => !x.deleted && x.kind !== 'note').sort(bySort)) { out.push(r); await walk(r.id); }
  };
  await walk(chapterId);
  return out;
}

// What the pane shows for a chapter: [{ note, type, para, at }], top to bottom.
export async function notesFor(chapterId, { skip = () => false } = {}) {
  if (!chapterId) return [];
  const [paras, types, all] = [await paragraphs(chapterId), await noteTypes(), await byKind('note')];
  const at = new Map(paras.map((p, i) => [p.id, i]));
  const byId = new Map(types.map((t) => [t.id, t]));
  return all
    .filter((n) => !n.deleted && n.fields?.chapter_id === chapterId && (n.text || '').trim() && !n.fields?.resolved && at.has(n.parent_id) && !skip(n))
    .map((n) => ({ note: n, type: byId.get(n.type) || null, para: paras[at.get(n.parent_id)], at: at.get(n.parent_id) }))
    .sort((a, b) => a.at - b.at || bySort(a.note, b.note));
}

export class SideNotes {
  // hooks: mainPlace() → where the main window is; open(chapterId, paraId)
  // takes the main window to a paragraph; skip(note) → left out (a kind
  // switched off under Look); shown() → is this view the one showing;
  // named() hears when the title may have changed.
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.chapterId = null;
    this.title = '';
    el.addEventListener('click', (e) => {
      const card = e.target.closest('[data-para]');
      if (card) this.hooks.open(this.chapterId, card.dataset.para);
    });
  }

  async show() { await this.refresh(); }

  // The main window moved, or a note changed: look again.
  soon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (this.hooks.shown()) this.refresh(); }, 120);
  }

  async refresh() {
    const turn = (this.turn = (this.turn || 0) + 1);
    const place = this.hooks.mainPlace();
    const chapterId = place?.view === 'write' ? place.chapterId || null : null;
    const chapter = chapterId ? await getEntry(chapterId) : null;
    const rows = chapter ? await notesFor(chapterId, { skip: this.hooks.skip }) : [];
    // Named for the piece; a chapter among several is named too.
    let piece = chapter;
    for (let i = 0; piece && piece.kind !== 'project' && i < 6; i++) piece = piece.parent_id ? await getEntry(piece.parent_id) : null;
    const several = chapter ? (await children(chapter.parent_id)).filter((c) => c.kind === 'chapter').length > 1 : false;
    if (turn !== this.turn) return;
    this.chapterId = chapter ? chapterId : null;
    this.title = chapter ? (several || !piece ? chapter.title : piece.title) || 'Untitled' : '';
    const head = make('header', 'sn-head');
    head.append(make('div', 'sn-eyebrow', chapter && several && piece?.title ? `Notes · ${piece.title}` : 'Notes'), make('h1', '', chapter ? this.title : 'No draft open'));
    const list = make('div', 'sn-list');
    if (!chapter) list.append(make('p', 'sn-empty', 'Open a draft in the main view and its notes show here.'));
    else if (!rows.length) list.append(make('p', 'sn-empty', 'No notes on this one yet. Ctrl + Shift + N adds a note to the paragraph you’re in.'));
    for (const { note, type, para } of rows) {
      const card = make('button', 'sn-card');
      card.type = 'button';
      card.dataset.para = para.id;
      card.dataset.note = note.id;
      const c = note.fields?.comment;
      const who = c ? (c.owner ? 'You, on the link' : c.name || 'A reader') : note.type === 'claude' || note.fields?.claude ? 'Claude' : type?.name || 'Note';
      const kind = make('span', 'sn-kind', who);
      if (type?.color) kind.style.setProperty('--dot', type.color);
      card.append(kind);
      if (c?.quote) card.append(make('span', 'sn-quote', `“${short(c.quote, 90)}”`));
      card.append(make('span', 'sn-text', note.text.trim()));
      const words = (para.text || '').trim();
      if (words) card.append(make('span', 'sn-on', short(words, 70)));
      card.title = 'Go to this paragraph in the main view';
      list.append(card);
    }
    this.el.replaceChildren(head, list);
    this.hooks.named?.();
  }
}
