import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { AltMark } from './alts.js';
import { OutlineDoc, LineIds, EntryRef, TagMarks, GatherBadge, mirrorKey, OutlineFold, foldKey, OutlineStore, descendants } from './outline.js';
import { getEntry, getMany, linkedFrom, byKind, byTag, putEntries, children, isTrashed } from './db.js';
import { entry } from './model.js';
import { bySort } from './order.js';
import { moveEntry } from './move.js';
import { newPage } from './library.js';
import { freshenRefs } from './links.js';
import { FileEmbed } from './filenode.js';
import { MAX_BYTES } from './files.js';
import { toast } from './menu.js';

// The notebook: a page for every day, plus named pages, all written as nested
// lines. Lines can link to pages, days and chapters with [[, carry #tags, and
// every page shows the lines elsewhere that link to it.

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');

export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayId = (iso) => `day-${iso}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const shiftDay = (iso, n) => { const d = fromIso(iso); d.setDate(d.getDate() + n); return isoDate(d); };

// Fills a "Linked from" list: every line or paragraph that links to this entry.
export async function renderLinkedFrom(targetId, box, list, onOpen) {
  const rows = await linkedFrom(targetId);
  list.replaceChildren();
  const roots = await rootsOf(rows);
  for (const row of rows) {
    const root = roots.get(row.id);
    if (!root || root.deleted || row.id === targetId) continue;
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span class="from"></span><span class="line"></span>';
    b.querySelector('.from').textContent = titleOf(root);
    b.querySelector('.line').textContent = row.text || '';
    b.addEventListener('click', () => onOpen(row.id));
    li.append(b);
    list.append(li);
  }
  box.hidden = !list.children.length;
  return list.children.length;
}

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

// The same for many rows at once: one read per level instead of one per
// row, so a tag or a page linked from a thousand lines still opens quickly.
// Returns a Map from each row's id to its home (or undefined).
export async function rootsOf(rows) {
  const known = new Map(rows.map((r) => [r.id, r]));
  const out = new Map();
  let walking = rows.map((r) => ({ id: r.id, at: r }));
  for (let depth = 0; walking.length && depth < 50; depth++) {
    const next = [];
    const need = new Set();
    for (const w of walking) {
      if (!w.at || ROOTS.includes(w.at.kind)) { out.set(w.id, w.at); continue; }
      next.push(w);
      if (w.at.parent_id && !known.has(w.at.parent_id)) need.add(w.at.parent_id);
    }
    if (need.size) {
      const ids = [...need];
      (await getMany(ids)).forEach((r, i) => known.set(ids[i], r));
    }
    walking = next.map((w) => ({ id: w.id, at: w.at.parent_id ? known.get(w.at.parent_id) : undefined }));
  }
  return out;
}

// The same short id for the same gathering line and original, on any device.
export function mirrorEid(gatherer, source) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const ch of `${gatherer}|${source}`) {
    const k = ch.codePointAt(0);
    a = Math.imul(a ^ k, 16777619);
    b = Math.imul(b ^ k, 2246822519) ^ (b >>> 15);
  }
  return `li_g${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

const EMPTY = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] };

export class Notebook {
  constructor({ onPick, onOpen, onStatus, onChange, onPlace, onZoom, onSources }) {
    this.onZoom = onZoom || (() => {});
    this.origins = new Map();
    this.onOpen = onOpen;
    this.onChange = onChange || (() => {});
    this.onPlace = onPlace || (() => {});
    this.store = new OutlineStore((s) => {
      onStatus(s);
      // New pages, days and tags show on the shelves once they're saved.
      if (s === 'saved') { clearTimeout(this.shelfTimer); this.shelfTimer = setTimeout(() => this.onChange(), 600); }
    }, onSources);
    this.page = null;
    this.editor = new Editor({
      element: $('#outline-editor'),
      extensions: [
        StarterKit.configure({ document: false, codeBlock: false, code: false, horizontalRule: false, heading: false, blockquote: false, trailingNode: false }),
        OutlineDoc, LineIds, EntryRef.configure({ onPick, onOpen }), TagMarks.configure({ onTag: (t) => this.showTag(t) }), GatherBadge.configure({ onTag: (t) => this.showTag(t), onOpen, origin: (id) => this.origins.get(id) || '' }), AltMark,
        OutlineFold.configure({ onZoom: (eid) => this.zoomed(eid) }),
        FileEmbed.configure({ onTooBig: (f) => toast(`“${f.name}” is too big to add (the limit is ${Math.round(MAX_BYTES / 1048576)} MB)`) })
      ],
      content: EMPTY,
      onUpdate: ({ editor }) => this.store.change(editor.state.doc)
    });
    window.__outline = this.editor;
    $('#nb-prev').addEventListener('click', () => this.step(-1));
    $('#nb-next').addEventListener('click', () => this.step(1));
    $('#nb-today').addEventListener('click', () => this.openDay());
    $('#nb-date').addEventListener('change', (e) => { if (e.target.value) this.openDay(e.target.value); });
    $('.past-toggle').addEventListener('click', () => this.togglePastDays());
    $('.past-list').addEventListener('click', (e) => {
      const ref = e.target.closest('a[data-ref]');
      if (ref) { e.preventDefault(); this.onOpen(ref.dataset.ref); return; }
      const line = e.target.closest('[data-line]');
      if (line) this.open(line.dataset.day, null, line.dataset.line);
    });
    this.more = new IntersectionObserver((seen) => { if (seen.some((s) => s.isIntersecting)) this.renderPastDays(false); });
    $('#nb-links').addEventListener('click', () => $('.backlinks').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    const title = $('#nb-title');
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.editor.commands.focus('start'); } });
    title.addEventListener('blur', () => this.rename(title.textContent.trim()));
  }

  get isDay() { return this.page?.kind === 'day'; }

  get zoom() { return foldKey.getState(this.editor.state)?.zoom || null; }

  currentLine() {
    const { $from } = this.editor.state.selection;
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'listItem') return $from.node(d).attrs.eid;
    return null;
  }

  // Sends a line, with everything under it, to the end of another page, day or chapter.
  async moveLineTo(eid, targetId, fallback) {
    if (!eid || !targetId || targetId === this.page?.id) return false;
    const ok = await moveEntry(eid, targetId, { fallback });
    this.editor.commands.focus();
    return ok;
  }

  toggleFold() {
    const eid = this.currentLine();
    if (eid) this.editor.view.dispatch(this.editor.state.tr.setMeta(foldKey, { fold: eid }));
    this.editor.commands.focus();
  }

  zoomTo(eid) {
    if ((eid || null) === this.zoom) return;
    this.editor.view.dispatch(this.editor.state.tr.setMeta(foldKey, { zoom: eid || null }));
  }

  // Zoomed in: a trail back up to the page, and the day's extras step aside.
  zoomed(eid) {
    // The page changes under the caret when zooming in or out; bring it back into view.
    requestAnimationFrame(() => this.editor.commands.scrollIntoView());
    const trail = $('#nb-zoom');
    $('.notebook').classList.toggle('zoomed', !!eid);
    trail.replaceChildren();
    trail.hidden = !eid;
    if (eid) {
      const path = [];
      const find = (node, chain) => {
        let hit = null;
        node.forEach((child) => {
          if (hit) return;
          if (child.type.name === 'listItem') {
            if (child.attrs.eid === eid) hit = chain;
            else hit = find(child, [...chain, child]);
          } else if (!child.isTextblock) hit = find(child, chain);
        });
        return hit;
      };
      path.push(...(find(this.editor.state.doc, []) || []));
      const crumb = (label, target) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', () => { this.zoomTo(target); this.editor.commands.focus(); });
        trail.append(b);
      };
      crumb(this.page ? titleOf(this.page) : 'Page', null);
      for (const li of path) {
        const t = li.firstChild?.textContent.trim() || 'Untitled line';
        crumb(t.length > 40 ? `${t.slice(0, 38)}…` : t, li.attrs.eid);
      }
      this.editor.commands.focus();
    }
    this.onZoom(eid);
  }

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
    this.store.noteShown(this.editor.state.doc, !recovered);
    if (recovered) this.store.change(this.editor.state.doc);
    // Caret in place now, not after everything below has loaded: by then you
    // may be typing, or have opened the [[ picker, which mustn't lose it.
    // (If the [[ picker is already open and typing, leave the caret with it.)
    if (!document.activeElement?.closest('.picker')) {
      if (focusLine) this.focusLine(focusLine);
      else this.editor.commands.focus('end');
    }
    await this.noteOrigins();
    freshenRefs(this.editor);
    this.renderHead();
    this.onPlace(this.page);
    await Promise.all([this.renderBacklinks(), this.renderPastDays()]);
    await this.gather();
    this.onChange();
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
    const n = this.page ? await renderLinkedFrom(this.page.id, $('.backlinks'), $('#backlinks-list'), this.onOpen) : 0;
    const chip = $('#nb-links');
    chip.hidden = !n;
    chip.textContent = `Linked from ${n}`;
  }

  // Earlier days below today's, so you can scroll back through them. They sit
  // behind the line under the day: click it to open or close them. Closed is
  // the default, and the choice is kept on this device.
  get pastOpen() {
    try { return localStorage.getItem('pastDays') === 'open'; } catch { return false; }
  }

  togglePastDays(open = !this.pastOpen) {
    try { if (open) localStorage.setItem('pastDays', 'open'); else localStorage.removeItem('pastDays'); } catch {}
    if (this.isDay) this.renderPastDays();
  }

  async renderPastDays(reset = true) {
    const box = $('.past-days');
    const list = $('.past-list');
    const toggle = $('.past-toggle');
    if (!this.isDay) { box.hidden = true; list.replaceChildren(); return; }
    const open = this.pastOpen;
    if (reset) {
      const before = this.page.title;
      this.pastDays = (await byKind('day')).filter((d) => !d.deleted && d.title < before).sort((a, b) => (a.title < b.title ? 1 : -1));
      this.pastShown = 0;
      this.more.disconnect();
      list.replaceChildren();
      box.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.title = open ? 'Hide earlier days' : 'Show earlier days';
      if (!open) {
        // Only the line, and only if there's an earlier day with something on it.
        let any = false;
        for (const day of this.pastDays) if ((await descendants(day.id)).some((r) => r.text)) { any = true; break; }
        if (this.page && this.isDay && !this.pastOpen) box.hidden = !any;
        return;
      }
    }
    if (!open) return;
    list.querySelector('.past-more')?.remove();
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
      list.append(sec);
    }
    if (this.pastShown < this.pastDays.length) {
      const more = document.createElement('div');
      more.className = 'past-more';
      list.append(more);
      this.more.observe(more);
    }
    box.hidden = !list.querySelector('.past-day');
  }

  // Gathering: a line that gathers a #tag gets a linked line under it for
  // everything with that tag, wherever it was written, and for anything
  // tagged later. Those lines are yours to sort, nest and note on; one you
  // delete isn't brought back, since the line remembers what it has gathered.
  gatherLine() {
    const { $from } = this.editor.state.selection;
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).attrs.gather) return $from.node(d);
    return null;
  }

  // One at a time, so two runs can't both add the same line.
  gather() {
    this.gathering = (this.gathering || Promise.resolve()).then(() => this.gatherNow()).catch((e) => { console.error(e); return 0; });
    return this.gathering;
  }

  async gatherNow() {
    const ed = this.editor;
    const page = this.page;
    const spots = [];
    ed.state.doc.descendants((node) => { if (node.type.name === 'listItem' && node.attrs.gather) spots.push(node.attrs); });
    if (!spots.length) return 0;
    const found = new Map();
    for (const { gather: tag } of spots) {
      if (found.has(tag)) continue;
      const rows = [];
      const tagged = (await byTag(tag)).filter((row) => row.kind === 'line' || row.kind === 'para');
      const roots = await rootsOf(tagged);
      for (const row of tagged) {
        const root = roots.get(row.id);
        if (root && !root.deleted && !isTrashed(root) && root.id !== page.id) rows.push(row);
      }
      found.set(tag, rows.sort((a, b) => a.created_at - b.created_at));
    }
    // A mirror's id comes from its gathering line and its original, so two
    // devices gathering the same line make the same mirror, not two. One that
    // already exists (here, or moved to another page) isn't made again.
    const taken = new Set();
    for (const { eid, gather: tag } of spots) {
      for (const r of found.get(tag)) {
        const ex = eid && await getEntry(mirrorEid(eid, r.id));
        if (ex && !ex.deleted && !isTrashed(ex) && ex.fields?.mirror === r.id) taken.add(ex.id);
      }
    }
    if (this.page !== page || ed.isDestroyed) return 0;
    const onPage = new Set();
    ed.state.doc.descendants((node) => {
      if (node.type.name === 'listItem' && node.attrs.eid) onPage.add(node.attrs.eid);
      if (node.type.name === 'listItem' && node.attrs.mirror) onPage.add(node.attrs.mirror);
    });
    const { schema } = ed;
    const tr = ed.state.tr;
    let added = 0;
    // Last line first, so earlier positions stay put.
    const at = [];
    tr.doc.descendants((node, pos) => { if (node.type.name === 'listItem' && node.attrs.gather) at.push({ node, pos }); });
    for (const { node, pos } of at.reverse()) {
      const seen = new Set(node.attrs.gathered || []);
      const matches = found.get(node.attrs.gather) || [];
      const fresh = matches.filter((r) => !seen.has(r.id) && !onPage.has(r.id) && !taken.has(mirrorEid(node.attrs.eid, r.id)));
      const all = [...new Set([...seen, ...matches.map((r) => r.id)])];
      if (!fresh.length && all.length === seen.size) continue;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, gathered: all });
      if (!fresh.length) continue;
      const items = fresh.map((r) => {
        let para;
        try { para = schema.nodeFromJSON({ type: 'paragraph', ...(r.content ? { content: r.content } : {}) }); } catch { para = schema.nodes.paragraph.create(null, r.text ? schema.text(r.text) : null); }
        return schema.nodes.listItem.create({ mirror: r.id, eid: node.attrs.eid ? mirrorEid(node.attrs.eid, r.id) : null }, para);
      });
      for (const r of fresh) { onPage.add(r.id); this.store.addSource(r); }
      const kids = node.lastChild?.type.name === 'bulletList' ? node.lastChild : null;
      if (kids) tr.insert(pos + node.nodeSize - 2, items);
      else tr.insert(pos + node.nodeSize - 1, schema.nodes.bulletList.create(null, items));
      added += fresh.length;
    }
    if (tr.docChanged) {
      ed.view.dispatch(tr.setMeta('addToHistory', false));
      this.store.noteShown(ed.state.doc);
      await this.noteOrigins();
    }
    return added;
  }

  // Where each mirror's original lives, shown faintly beside it.
  async noteOrigins() {
    const ids = [];
    this.editor.state.doc.descendants((n) => { if (n.type.name === 'listItem' && n.attrs.mirror && !this.origins.has(n.attrs.mirror)) ids.push(n.attrs.mirror); });
    if (!ids.length) return;
    for (const id of ids) {
      const src = await getEntry(id);
      const root = src && await rootOf(src);
      // Short, so it fits the margin: "Wed, Oct 21" for a day, else the page's name.
      this.origins.set(id, !root ? '' : root.kind === 'day' ? fromIso(root.title || root.id.slice(4)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : titleOf(root));
    }
    const ed = this.editor;
    if (!ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta(mirrorKey, 'origins').setMeta('addToHistory', false));
  }

  // Starts gathering a tag on the line you're on, or a new line at the end if it already has words.
  async addGather(tag) {
    tag = tag.replace(/^#/, '').toLowerCase();
    const ed = this.editor;
    const { schema } = ed;
    const label = tag.charAt(0).toUpperCase() + tag.slice(1).replace(/[-_]/g, ' ');
    let target = null;
    const { $from } = ed.state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type.name === 'listItem') { if (!n.firstChild.textContent.trim() && !n.attrs.gather) target = { node: n, pos: $from.before(d) }; break; }
    }
    const tr = ed.state.tr;
    if (target) {
      tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, gather: tag, gathered: null });
      tr.insertText(label, target.pos + 2);
    } else {
      const list = tr.doc.firstChild;
      const end = list.nodeSize - 1;
      tr.insert(end, schema.nodes.listItem.create({ gather: tag }, schema.nodes.paragraph.create(null, schema.text(label))));
    }
    ed.view.dispatch(tr);
    const n = await this.gather();
    let line = null;
    ed.state.doc.descendants((node, pos) => { if (!line && node.type.name === 'listItem' && node.attrs.gather === tag) line = { node, pos }; return !line; });
    if (line) ed.commands.setTextSelection(line.pos + 1 + line.node.firstChild.nodeSize - 1);
    ed.view.focus();
    return n;
  }

  // Stops the line gathering; what it already gathered stays where it is.
  stopGather() {
    const li = this.gatherLine();
    if (!li) return;
    this.setGatherAttrs(li.attrs.eid, { gather: null, gathered: null });
  }

  // Brings back gathered lines that were deleted.
  async regather() {
    const li = this.gatherLine();
    if (!li) return 0;
    this.setGatherAttrs(li.attrs.eid, { gathered: null });
    return this.gather();
  }

  setGatherAttrs(eid, attrs) {
    const ed = this.editor;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'listItem' && node.attrs.eid === eid) {
        ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
        return false;
      }
    });
  }

  // Every line and paragraph with this tag, wherever it lives.
  async showTag(tag) {
    const panel = $('.tag-results');
    this.shownTag = tag;
    const rows = (await byTag(tag)).filter((r) => r.kind === 'line' || r.kind === 'para')
      .sort((a, b) => b.updated_at - a.updated_at);
    $('#tag-results-title').textContent = `#${tag}`;
    const list = $('#tag-results-list');
    list.replaceChildren();
    // The newest few hundred first; the rest a tap away, so a tag used for
    // years still opens at once.
    const show = async (from, to) => {
      const part = rows.slice(from, to);
      const roots = await rootsOf(part);
      for (const row of part) {
        const root = roots.get(row.id);
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
      if (to < rows.length) {
        const li = document.createElement('li');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'more';
        more.textContent = `Show ${Math.min(500, rows.length - to).toLocaleString()} more of ${(rows.length - to).toLocaleString()}`;
        more.addEventListener('click', () => { li.remove(); show(to, to + 500); });
        li.append(more);
        list.append(li);
      }
    };
    await show(0, 300);
    panel.hidden = false;
  }

  // Another device changed this page: take its version once ours is saved.
  async applyRemote(rows, tries = 0) {
    if (!this.page) return;
    const ids = this.store.ids();
    const touched = rows.some((r) => ids.has(r.id) || ids.has(r.parent_id));
    if (rows.some((r) => ['day', 'page', 'line'].includes(r.kind))) { this.onChange(); if (this.isDay) this.renderPastDays(); }
    if (rows.some((r) => r.links?.includes(this.page.id))) this.renderBacklinks();
    if (rows.some((r) => r.tags?.length) && this.store.idle) this.gather();
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
    this.store.noteShown(ed.state.doc, true);
    if (anchor) {
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'listItem' && node.attrs.eid === anchor.eid) {
          ed.commands.setTextSelection(Math.min(pos + 2 + anchor.offset, pos + 1 + node.firstChild.nodeSize - 1));
          return false;
        }
      });
    }
    if (focused) ed.view.focus();
    this.gather();
  }

  // Shows another version of this page (from its history). Mirrored lines keep
  // showing their originals as they are now, so going back never rewrites them.
  replaceDoc(json, save) {
    const live = (n) => {
      if (n.type === 'listItem' && n.attrs?.mirror && this.store.sources.get(n.attrs.mirror)) {
        const src = this.store.sources.get(n.attrs.mirror);
        return { ...n, content: (n.content || []).map((c) => (c.type === 'paragraph' ? { ...c, content: src.content || undefined } : live(c))) };
      }
      return n.content ? { ...n, content: n.content.map(live) } : n;
    };
    this.editor.commands.setContent(save ? live(json) : json, { emitUpdate: false });
    this.store.noteShown(this.editor.state.doc, true);
    if (save) this.store.change(this.editor.state.doc);
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
      a.setAttribute('role', 'link');
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
