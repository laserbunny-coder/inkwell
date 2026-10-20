import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { OutlineDoc, LineIds, EntryRef, OutlineStore } from './outline.js';
import { getEntry, linkedFrom, byKind, putEntries } from './db.js';
import { entry, newId } from './model.js';

// The notebook: a page for every day, plus named pages, all written as nested
// lines. Lines can link to pages, days and chapters with [[, carry #tags, and
// every page shows the lines elsewhere that link to it.

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');

export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayId = (iso) => `day-${iso}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const shiftDay = (iso, n) => { const d = fromIso(iso); d.setDate(d.getDate() + n); return isoDate(d); };

export function titleOf(e) {
  if (e.kind === 'day') return fromIso(e.title || e.id.slice(4)).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return e.title || 'Untitled';
}

const ROOTS = ['day', 'page', 'chapter', 'project'];
export async function rootOf(row) {
  let r = row;
  for (let i = 0; r && i < 50 && !ROOTS.includes(r.kind); i++) r = await getEntry(r.parent_id);
  return r;
}

const EMPTY = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] };

export class Notebook {
  constructor({ onPick, onOpen, onStatus }) {
    this.onOpen = onOpen;
    this.store = new OutlineStore((s) => {
      onStatus(s);
      // New pages, days and tags show on the shelves once they're saved.
      if (s === 'saved') { clearTimeout(this.shelfTimer); this.shelfTimer = setTimeout(() => this.renderShelves(), 600); }
    });
    this.page = null;
    this.editor = new Editor({
      element: $('#outline-editor'),
      extensions: [
        StarterKit.configure({ document: false, codeBlock: false, code: false, horizontalRule: false, heading: false, blockquote: false, trailingNode: false }),
        OutlineDoc, LineIds, EntryRef.configure({ onPick, onOpen })
      ],
      content: EMPTY,
      onUpdate: ({ editor }) => this.store.change(editor.state.doc)
    });
    window.__outline = this.editor;
    $('#nb-prev').addEventListener('click', () => this.step(-1));
    $('#nb-next').addEventListener('click', () => this.step(1));
    $('#nb-today').addEventListener('click', () => this.openDay());
    $('#nb-new-page').addEventListener('click', () => this.newPage());
    const title = $('#nb-title');
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.editor.commands.focus('start'); } });
    title.addEventListener('blur', () => this.rename(title.textContent.trim()));
  }

  get isDay() { return this.page?.kind === 'day'; }

  async openDay(iso = isoDate()) {
    const id = dayId(iso);
    // A day is only saved once something is written on it.
    return this.open(id, entry('day', { id, title: iso }));
  }

  step(n) { if (this.isDay) this.openDay(shiftDay(this.page.title, n)); }

  async newPage(title = '') {
    const page = entry('page', { id: newId('pg'), title });
    await putEntries([page]);
    await this.open(page.id);
    $('#nb-title').focus();
  }

  async rename(title) {
    if (!this.page || this.isDay || !title || title === this.page.title) { this.renderHead(); return; }
    this.page.title = title;
    this.page.updated_at = Date.now();
    await putEntries([this.page]);
    this.renderShelves();
  }

  async open(id, fallback, focusLine) {
    if (this.page) await this.store.close(this.editor.state.doc);
    const { doc, recovered } = await this.store.load(id, fallback);
    this.page = this.store.page;
    this.editor.commands.setContent(doc, { emitUpdate: false });
    if (recovered) this.store.change(this.editor.state.doc);
    localStorage.setItem('notebookPage', id);
    this.renderHead();
    await Promise.all([this.renderBacklinks(), this.renderShelves()]);
    if (focusLine) this.focusLine(focusLine);
    else this.editor.commands.focus('end');
  }

  focusLine(eid) {
    this.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'listItem' && node.attrs.eid === eid) {
        this.editor.commands.setTextSelection(pos + 2 + node.firstChild.content.size);
        this.editor.view.focus();
        this.editor.view.nodeDOM(pos)?.scrollIntoView({ block: 'center' });
        return false;
      }
    });
  }

  renderHead() {
    const title = $('#nb-title');
    title.textContent = this.page ? titleOf(this.page) : '';
    title.contentEditable = this.isDay ? 'false' : 'true';
    $('#nb-prev').hidden = $('#nb-next').hidden = !this.isDay;
    $('#nb-today').hidden = this.isDay && this.page.title === isoDate();
    $('#nb-kind').textContent = this.isDay ? (this.page.title === isoDate() ? 'Today' : 'Daily page') : 'Page';
  }

  async renderBacklinks() {
    const box = $('.backlinks');
    const list = $('#backlinks-list');
    const rows = this.page ? await linkedFrom(this.page.id) : [];
    list.replaceChildren();
    for (const row of rows) {
      const root = await rootOf(row);
      if (!root || root.deleted) continue;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="from"></span><span class="line"></span>';
      b.querySelector('.from').textContent = titleOf(root);
      b.querySelector('.line').textContent = row.text || '';
      b.addEventListener('click', () => this.onOpen(row.id));
      li.append(b);
      list.append(li);
    }
    box.hidden = !list.children.length;
  }

  async renderShelves() {
    const today = isoDate();
    const days = (await byKind('day')).filter((d) => !d.deleted && d.title !== today).sort((a, b) => (a.title < b.title ? 1 : -1)).slice(0, 10);
    const pages = (await byKind('page')).filter((p) => !p.deleted).sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    const lines = (await byKind('line')).filter((l) => !l.deleted);
    const tags = new Map();
    for (const l of lines) for (const t of l.tags || []) tags.set(t, (tags.get(t) || 0) + 1);

    const button = (label, current, run, cls = 'tree-chapter') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls + (current ? ' current' : '');
      b.textContent = label;
      b.addEventListener('click', run);
      return b;
    };
    const heading = (label) => { const d = document.createElement('div'); d.className = 'tree-act'; d.textContent = label; return d; };
    const box = $('#shelves-tree');
    box.replaceChildren(
      button('Today', this.page?.id === dayId(today), () => this.openDay(), 'tree-chapter shelf-today'),
      ...(pages.length ? [heading('Pages')] : []),
      ...pages.map((p) => button(titleOf(p), this.page?.id === p.id, () => this.open(p.id))),
      ...(days.length ? [heading('Days')] : []),
      ...days.map((d) => button(fromIso(d.title).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), this.page?.id === d.id, () => this.openDay(d.title)))
    );
    const tagBox = $('#shelves-tags');
    tagBox.replaceChildren(...[...tags].sort((a, b) => b[1] - a[1]).map(([t]) => button(`#${t}`, false, () => this.showTag(t), 'tag-chip')));
    $('#shelves-tags-label').hidden = !tags.size;
  }

  // Every line and paragraph with this tag, wherever it lives.
  async showTag(tag) {
    const panel = $('.tag-results');
    const rows = [...await byKind('line'), ...await byKind('para')].filter((r) => !r.deleted && r.tags?.includes(tag))
      .sort((a, b) => b.updated_at - a.updated_at);
    $('#tag-results-title').textContent = `#${tag}`;
    const list = $('#tag-results-list');
    list.replaceChildren();
    for (const row of rows) {
      const root = await rootOf(row);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="from"></span><span class="line"></span>';
      b.querySelector('.from').textContent = root ? titleOf(root) : '';
      b.querySelector('.line').textContent = row.text;
      b.addEventListener('click', () => { panel.hidden = true; this.onOpen(row.id); });
      li.append(b);
      list.append(li);
    }
    panel.hidden = false;
  }

  // Another device changed this page: take its version once ours is saved.
  async applyRemote(rows, tries = 0) {
    if (!this.page) return;
    const ids = this.store.ids();
    const touched = rows.some((r) => ids.has(r.id) || ids.has(r.parent_id));
    if (rows.some((r) => ['day', 'page', 'line'].includes(r.kind))) this.renderShelves();
    if (rows.some((r) => r.links?.includes(this.page.id))) this.renderBacklinks();
    if (!touched) return;
    if (!this.store.idle) { if (tries < 20) setTimeout(() => this.applyRemote(rows, tries + 1), 800); return; }
    const page = await getEntry(this.page.id);
    if (page) { this.store.page = this.page = page; this.renderHead(); }
    const doc = await this.store.refresh();
    const ed = this.editor;
    if (JSON.stringify(doc) === JSON.stringify(ed.state.doc.toJSON())) return;
    const { $from } = ed.state.selection;
    let anchor = null;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'listItem') { anchor = { eid: $from.node(d).attrs.eid, offset: $from.parentOffset }; break; }
    }
    const focused = ed.isFocused;
    ed.commands.setContent(doc, { emitUpdate: false });
    if (anchor) {
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'listItem' && node.attrs.eid === anchor.eid) {
          ed.commands.setTextSelection(Math.min(pos + 2 + anchor.offset, pos + 1 + node.firstChild.nodeSize - 1));
          return false;
        }
      });
    }
    if (focused) ed.view.focus();
  }

  close() { return this.page ? this.store.close(this.editor.state.doc) : null; }
}
