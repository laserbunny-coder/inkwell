import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { OutlineDoc, LineIds, EntryRef, TagMarks, OutlineStore, descendants } from './outline.js';
import { getEntry, linkedFrom, byKind, byTag, putEntries } from './db.js';
import { entry } from './model.js';
import { bySort } from './order.js';
import { newPage } from './library.js';
import { freshenRefs } from './links.js';

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
  constructor({ onPick, onOpen, onStatus, onChange, onPlace }) {
    this.onOpen = onOpen;
    this.onChange = onChange || (() => {});
    this.onPlace = onPlace || (() => {});
    this.store = new OutlineStore((s) => {
      onStatus(s);
      // New pages, days and tags show on the shelves once they're saved.
      if (s === 'saved') { clearTimeout(this.shelfTimer); this.shelfTimer = setTimeout(() => this.onChange(), 600); }
    });
    this.page = null;
    this.editor = new Editor({
      element: $('#outline-editor'),
      extensions: [
        StarterKit.configure({ document: false, codeBlock: false, code: false, horizontalRule: false, heading: false, blockquote: false, trailingNode: false }),
        OutlineDoc, LineIds, EntryRef.configure({ onPick, onOpen }), TagMarks.configure({ onTag: (t) => this.showTag(t) })
      ],
      content: EMPTY,
      onUpdate: ({ editor }) => this.store.change(editor.state.doc)
    });
    window.__outline = this.editor;
    $('#nb-prev').addEventListener('click', () => this.step(-1));
    $('#nb-next').addEventListener('click', () => this.step(1));
    $('#nb-today').addEventListener('click', () => this.openDay());
    $('#nb-date').addEventListener('change', (e) => { if (e.target.value) this.openDay(e.target.value); });
    $('.past-days').addEventListener('click', (e) => {
      const ref = e.target.closest('a[data-ref]');
      if (ref) { e.preventDefault(); this.onOpen(ref.dataset.ref); return; }
      const line = e.target.closest('[data-line]');
      if (line) this.open(line.dataset.day, null, line.dataset.line);
    });
    this.more = new IntersectionObserver((seen) => { if (seen.some((s) => s.isIntersecting)) this.renderPastDays(false); });
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

  async newPage(parentId = null, title = '') {
    const page = await newPage(parentId, title);
    await this.open(page.id);
    $('#nb-title').focus();
  }

  async rename(title) {
    if (!this.page || this.isDay || !title || title === this.page.title) { this.renderHead(); return; }
    this.page.title = title;
    this.page.updated_at = Date.now();
    await putEntries([this.page]);
    this.onChange();
    this.onPlace(this.page);
  }

  async open(id, fallback, focusLine) {
    if (this.page) await this.store.close(this.editor.state.doc);
    const { doc, recovered } = await this.store.load(id, fallback);
    this.page = this.store.page;
    this.editor.commands.setContent(doc, { emitUpdate: false });
    if (recovered) this.store.change(this.editor.state.doc);
    freshenRefs(this.editor);
    this.renderHead();
    this.onPlace(this.page);
    await Promise.all([this.renderBacklinks(), this.renderPastDays()]);
    this.onChange();
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

  // Earlier days below today's, so you can scroll back through them.
  async renderPastDays(reset = true) {
    const box = $('.past-days');
    if (!this.isDay) { box.hidden = true; box.replaceChildren(); return; }
    if (reset) {
      const before = this.page.title;
      this.pastDays = (await byKind('day')).filter((d) => !d.deleted && d.title < before).sort((a, b) => (a.title < b.title ? 1 : -1));
      this.pastShown = 0;
      this.more.disconnect();
      box.replaceChildren();
    }
    box.querySelector('.past-more')?.remove();
    const next = this.pastDays.slice(this.pastShown, this.pastShown + 5);
    this.pastShown += next.length;
    for (const day of next) {
      const rows = await descendants(day.id);
      if (!rows.some((r) => r.text)) continue;
      const sec = document.createElement('section');
      sec.className = 'past-day';
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'past-title';
      h.textContent = titleOf(day);
      h.addEventListener('click', () => this.openDay(day.title));
      sec.append(h, lineTree(day.id, rows));
      box.append(sec);
    }
    if (this.pastShown < this.pastDays.length) {
      const more = document.createElement('div');
      more.className = 'past-more';
      box.append(more);
      this.more.observe(more);
    }
    box.hidden = !box.querySelector('.past-day');
  }

  // Every line and paragraph with this tag, wherever it lives.
  async showTag(tag) {
    const panel = $('.tag-results');
    const rows = (await byTag(tag)).filter((r) => r.kind === 'line' || r.kind === 'para')
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
    if (rows.some((r) => ['day', 'page', 'line'].includes(r.kind))) { this.onChange(); if (this.isDay) this.renderPastDays(); }
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

// A read-only copy of a day's lines, nested as written.
function lineTree(dayId, rows) {
  const byParent = new Map();
  for (const r of rows) {
    if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []);
    byParent.get(r.parent_id).push(r);
  }
  const list = (pid) => {
    const ul = document.createElement('ul');
    for (const r of (byParent.get(pid) || []).sort(bySort)) {
      const li = document.createElement('li');
      const p = document.createElement('p');
      p.dataset.line = r.id;
      p.dataset.day = dayId;
      appendInline(p, r.content);
      li.append(p);
      if (byParent.has(r.id)) li.append(list(r.id));
      ul.append(li);
    }
    return ul;
  };
  return list(dayId);
}

function appendInline(el, content) {
  for (const n of content || []) {
    if (n.type === 'entryRef') {
      const a = document.createElement('a');
      a.className = 'ref';
      a.href = '#';
      a.dataset.ref = n.attrs?.id;
      a.textContent = n.attrs?.title || 'Untitled';
      el.append(a);
    } else if (n.type === 'hardBreak') el.append(document.createElement('br'));
    else if (n.text) {
      let node = document.createTextNode(n.text);
      for (const m of n.marks || []) {
        const tag = { bold: 'strong', italic: 'em', strike: 's', underline: 'u' }[m.type];
        if (tag) { const w = document.createElement(tag); w.append(node); node = w; }
      }
      el.append(node);
    }
  }
}
