// The script with its shots beside it (Nov 22 2026, for Elle: "the script
// side by side with storyboards and shots"). Part 1: by scene. Nothing about
// how shots are kept changes: a shot is still an entry of kind 'shot' under
// its scene's heading paragraph (a novel: under its scene break), so Make,
// the Storyboard tab, shot codes, the connector and exports all see what is
// added here.
//
// Where the shots sit, per device (one Shots switch on the script):
//   - beside: a column to the right of the text, each scene's frames level
//     with the scene's line (a computer with room; a phone held sideways);
//   - rail: a phone held upright, "beside": a thin strip of picture-only
//     frames down the right edge;
//   - column: one column, a strip of the scene's frames under its line that
//     scrolls sideways (the phone's default, a choice on a computer).
//
// Michael's rules (Nov 22): a click only lights things up, it never scrolls
// or reflows the page; a shot opens floating over the page (a popover on a
// computer, a sheet on a phone); scenes go by his own scene names, never by
// slug lines.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { getEntry, getMany, putEntries } from './db.js';
import { plain as make } from './dom.js';
import { addFile, fileUrl, thumbUrl, isImage } from './files.js';
import { shotsUnder, newShot, shotCode, stillOf, withRenders, isVideo } from './production.js';
import { scenesOf } from './woven.js';
import { holdStill } from './steady.js';
import { shotCard } from './shotcard.js';
import './scriptshots.css';
import { screenKind, sceneName } from './scenename.js';

const KEY = new PluginKey('scriptShots');
const SITS = ['beside', 'column'];
const DEFAULT_SITS = { computer: 'beside', phone: 'column', sideways: 'beside' };
// Room the column beside the text takes (its width plus the gap to the text).
const ROOM = { computer: 372, sideways: 262, phone: 88 };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The scenes shots can hang under, in order: a script's scene headings, or
// a novel's scene breaks. Each is named by its own name, never its slug.
export function anchorsOf(doc, script) {
  if (script) {
    return scenesOf(doc).filter((s) => s.node && s.eid).map((s) => ({ eid: s.eid, pos: s.pos, size: s.node.nodeSize, n: String(s.node.attrs.code || s.n), code: s.node.attrs.code || '', title: s.title || '', first: s.first || '', slug: s.node.textContent || '' }));
  }
  const out = [];
  doc.forEach((node, pos) => {
    if (node.type.name !== 'sceneBreak' || !node.attrs.eid) return;
    out.push({ eid: node.attrs.eid, pos, size: node.nodeSize, n: String(out.length + 1), code: '', title: node.attrs.title || '', first: (doc.childAfter(pos + node.nodeSize).node?.textContent || '').trim(), slug: '' });
  });
  return out;
}
export class ScriptShots {
  // hooks: editor(), sheet (the .sheet element), piece(), world() (async),
  // script() (a script, not a novel), woven(), writing() (the Write view is
  // showing a piece with scenes), toast(text, action), openInMake(shot),
  // menu(anchor, items).
  constructor(hooks) {
    this.hooks = hooks;
    this.pieceId = null;
    this.on = false;
    this.shots = new Map(); // scene eid -> its shots, in order
    this.kinds = new Map(); // file id -> 'still' | 'video'
    this.versions = new Map(); // scene eid -> bumps when its shots change (redraws its strip)
    this.sel = null;
    this.open = null;
    this.saving = new Map();
    this.frame = 0;
    this.groupsKey = '';
    this.mode = 'off';
    this.layer = make('div', 'ss-side');
    this.layer.setAttribute('aria-label', 'Shots, beside the script');
    hooks.sheet.append(this.layer);
    try { const s = JSON.parse(localStorage.getItem('shotsSit') || '{}'); this.sits = { ...DEFAULT_SITS, ...Object.fromEntries(Object.entries(s).filter(([, v]) => SITS.includes(v))) }; } catch { this.sits = { ...DEFAULT_SITS }; }
    window.addEventListener('resize', () => this.refit());
    // Back in Write from Make (or anywhere): the shots as they are now.
    new MutationObserver(() => { if (this.hooks.writing() && this.on) this.reload().then(() => this.refit(true)); else this.refit(true); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-view'] });
    new ResizeObserver(() => this.place()).observe(hooks.editor().view.dom);
    // A click anywhere else lets go of the picked shot; nothing else changes.
    document.addEventListener('click', (e) => {
      if (!this.sel && !this.open) return;
      if (e.target.closest?.('.ss-side, .ss-strip, .ss-pop, .ss-sheet, .pop-menu, .toast')) return;
      this.pick(null);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (this.open || this.sel)) { e.preventDefault(); e.stopPropagation(); if (this.open) this.close(); else this.pick(null); }
    }, true);
  }

  get editor() { return this.hooks.editor(); }
  kind() { return screenKind(); }
  anchors() { return anchorsOf(this.editor.state.doc, this.hooks.script()); }
  version(eid) { return this.versions.get(eid) || 0; }

  // ---------- on or off, and where ----------

  // Before another chapter's words come in: nothing of the last one stays.
  unload() {
    this.pieceId = null;
    this.sel = this.open = null;
    this.shots = new Map();
    this.refit(true);
  }

  // A piece opened in Write: its switch, and its scenes' shots.
  async load(pieceId) {
    this.pieceId = pieceId || null;
    this.sel = this.open = null;
    this.closeFloat();
    try { this.on = !!pieceId && localStorage.getItem(`shotsOn:${pieceId}`) === '1'; } catch { this.on = false; }
    this.refit(true);
    if (this.on) await this.reload();
  }
  saveOn() { try { if (this.on) localStorage.setItem(`shotsOn:${this.pieceId}`, '1'); else localStorage.removeItem(`shotsOn:${this.pieceId}`); } catch { /* private window */ } }
  saveSits() { try { localStorage.setItem('shotsSit', JSON.stringify(this.sits)); } catch { /* private window */ } }

  // Where the shots sit now, from the switch, this screen and the room there is.
  modeNow() {
    if (!this.on || !this.pieceId || !this.hooks.writing()) return 'off';
    const k = this.kind();
    const sit = this.sits[k] || 'column';
    if (sit === 'column') return 'column';
    if (k === 'phone') return 'rail';
    if (k === 'sideways') return 'beside';
    // A computer: beside only when the text keeps its full width next to it.
    const page = this.hooks.sheet.parentElement;
    const cs = getComputedStyle(page);
    const room = page.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const width = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-width')) || 660;
    const notes = document.body.classList.contains('notes-on') && window.innerWidth > 900 ? 300 : 0;
    return room >= width + ROOM.computer + notes ? 'beside' : 'column';
  }

  // Draws the shots where they sit now (after a resize, a turn of the phone,
  // the switch). Changing where they sit keeps the line at the top of the
  // screen where it was.
  refit(quiet = false) {
    const next = this.modeNow();
    document.documentElement.classList.toggle('ss-able', !!this.pieceId && this.hooks.writing());
    if (next === this.mode) { this.place(); document.dispatchEvent(new CustomEvent('inkwell:shots', { detail: { on: this.on, mode: next } })); return; }
    const apply = () => {
      this.mode = next;
      const r = document.documentElement;
      r.classList.toggle('ss-on', next !== 'off');
      r.classList.toggle('ss-beside', next === 'beside');
      r.classList.toggle('ss-rail', next === 'rail');
      r.classList.toggle('ss-column', next === 'column');
      r.classList.toggle('ss-sideways', next === 'beside' && this.kind() === 'sideways');
      if (next === 'off') { this.sel = this.open = null; this.closeFloat(); }
      this.groupsKey = '';
      this.drawSide();
      this.redrawStrips();
      this.closeFloat();
      this.showOpen();
    };
    if (quiet) apply(); else holdStill(() => this.topLine(), apply);
    document.dispatchEvent(new CustomEvent('inkwell:shots', { detail: { on: this.on, mode: next } }));
  }
  // The paragraph at the top of the screen, to keep still.
  topLine() {
    const dom = this.editor.view.dom;
    for (const el of dom.children) { const r = el.getBoundingClientRect(); if (r.bottom > 80 && r.height > 0) return el; }
    return null;
  }

  async toggle() {
    if (!this.pieceId) { this.hooks.toast('Open a script to see its shots beside it'); return; }
    this.on = !this.on;
    this.saveOn();
    if (this.on) await this.reload(false);
    this.refit();
    const key = this.kind() === 'computer' ? ' Alt + B puts them away.' : '';
    this.hooks.toast(this.on ? `${this.mode === 'column' ? 'Shots in the script.' : 'Shots beside the script.'}${key}` : 'Shots put away. The script is only text.');
  }
  // Beside or in the script, for this kind of screen.
  async sitAt(sit) {
    if (!SITS.includes(sit)) return;
    this.sits[this.kind()] = sit;
    this.saveSits();
    if (!this.on) { this.on = true; this.saveOn(); await this.reload(false); }
    this.refit();
  }
  // The Shots button: off, it turns them on; on, a small menu says where they sit.
  button(anchor) {
    if (!this.on) { this.toggle(); return; }
    const k = this.kind();
    const sit = this.sits[k];
    const beside = k === 'phone' ? 'Beside: a strip of pictures' : 'Beside the script';
    this.hooks.menu(anchor, [
      { label: `${sit === 'beside' ? '✓ ' : ''}${beside}`, run: () => this.sitAt('beside') },
      { label: `${sit === 'column' ? '✓ ' : ''}In the script (one column)`, run: () => this.sitAt('column') },
      'sep',
      { label: 'Put the shots away', run: () => this.toggle() }
    ]);
  }

  // ---------- the shots ----------

  async reload(draw = true) {
    const anchors = this.anchors();
    const lists = await Promise.all(anchors.map((a) => shotsUnder(a.eid).catch(() => [])));
    const shots = new Map();
    anchors.forEach((a, i) => shots.set(a.eid, lists[i]));
    const files = new Set();
    for (const list of lists) for (const sh of list) for (const t of sh.fields?.tries || []) for (const id of t.files || []) if (!this.kinds.has(id)) files.add(id);
    if (files.size) for (const f of (await getMany([...files])).filter(Boolean)) this.kinds.set(f.id, isVideo(f.fields?.type) ? 'video' : 'still');
    this.world = await this.hooks.world();
    for (const a of anchors) {
      const was = (this.shots.get(a.eid) || []).map((s) => `${s.id}:${s.updated_at}`).join();
      const now = shots.get(a.eid).map((s) => `${s.id}:${s.updated_at}`).join();
      if (was !== now) this.versions.set(a.eid, this.version(a.eid) + 1);
    }
    this.shots = shots;
    if (this.open && !this.find(this.open)) { this.open = null; this.closeFloat(); }
    if (this.sel && !this.find(this.sel)) this.sel = null;
    if (draw) { this.groupsKey = ''; this.drawSide(); this.redrawStrips(); }
  }
  // The shot and the scene it's in.
  find(id) {
    for (const a of this.anchors()) { const sh = (this.shots.get(a.eid) || []).find((s) => s.id === id); if (sh) return { a, sh }; }
    return null;
  }
  all() { return this.anchors().flatMap((a) => (this.shots.get(a.eid) || []).map((sh) => ({ a, sh }))); }
  codeOf(sh, a) { return shotCode({ show: this.world?.fields?.production?.code, piece: this.hooks.piece()?.fields?.code, scene: a?.code || a?.n, shot: sh.fields?.n }); }
  still(sh) { return stillOf(sh, (id) => this.kinds.get(id)); }

  // ---------- drawing a shot, small ----------

  pic(sh, big = false) {
    const pic = make('span', 'ss-pic');
    const id = this.still(sh);
    if (id) (big ? fileUrl(id) : thumbUrl(id)).then((url) => { if (url) { const img = make('img'); img.src = url; img.alt = ''; pic.replaceChildren(img); } }).catch(() => {});
    pic.append(make('span', 'ss-nopic', sh.fields?.framing || (id ? '' : 'No picture yet')));
    return pic;
  }
  // A storyboard frame: the picture with the code and what happens under it.
  frameEl(sh, a, thumb = false) {
    const b = make('button', thumb ? 'ss-thumb' : 'ss-frame');
    b.type = 'button';
    b.dataset.shot = sh.id;
    const code = this.codeOf(sh, a);
    if (thumb) {
      b.setAttribute('aria-label', `${code}: ${sh.text || 'shot'}`);
      b.append(this.pic(sh), make('span', 'ss-num', sh.fields?.n || ''));
    } else {
      b.append(this.pic(sh), make('span', 'ss-code', code), make('span', 'ss-what', sh.text || 'What happens'));
    }
    b.classList.toggle('sel', this.sel === sh.id);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // the caret stays where it was
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.clickShot(sh.id); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.sel = sh.id; this.showOpen(sh.id); } });
    return b;
  }
  addEl(a, thumb = false) {
    const b = make('button', `${thumb ? 'ss-thumb' : 'ss-frame'} ss-add`);
    b.type = 'button';
    b.setAttribute('aria-label', `Add a shot to ${sceneName(a)}`);
    b.title = `Add a shot to ${sceneName(a)}`;
    b.append(make('span', 'ss-pic', thumb ? '+' : '+ shot'));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.add(a.eid); });
    return b;
  }

  // The column beside the text: one group per scene, each level with its line.
  drawSide() {
    const side = this.mode === 'beside' || this.mode === 'rail';
    this.layer.hidden = !side;
    if (!side) { this.layer.replaceChildren(); this.groupsKey = ''; return; }
    const anchors = this.anchors();
    const key = anchors.map((a) => `${a.eid}:${this.version(a.eid)}:${a.n}:${a.title}`).join('|') + this.mode;
    if (key === this.groupsKey) { this.place(); return; }
    this.groupsKey = key;
    const thumb = this.mode === 'rail';
    this.layer.replaceChildren(...anchors.map((a) => {
      const g = make('div', 'ss-group');
      g.dataset.eid = a.eid;
      g.setAttribute('aria-label', `Shots in ${sceneName(a)}`);
      for (const sh of this.shots.get(a.eid) || []) g.append(this.frameEl(sh, a, thumb));
      g.append(this.addEl(a, thumb));
      return g;
    }));
    this.place();
  }

  // Where each scene's line is on the page, from the top of the sheet.
  lineTop(a, base) {
    const view = this.editor.view;
    let el = this.hooks.woven() ? view.dom.querySelector(`.wv-line[data-eid="${CSS.escape(a.eid)}"]`) : null;
    if (!el) { try { el = view.nodeDOM(a.pos); } catch { el = null; } }
    if (!el?.getBoundingClientRect) return null;
    return el.getBoundingClientRect().top - base;
  }
  // Puts each scene's group level with its line; one that would overlap the
  // one above it waits under it. Only the column moves: the text never does.
  place() {
    if (this.mode !== 'beside' && this.mode !== 'rail') return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const anchors = this.anchors();
      const key = anchors.map((a) => `${a.eid}:${this.version(a.eid)}:${a.n}:${a.title}`).join('|') + this.mode;
      if (key !== this.groupsKey) { this.drawSide(); return; }
      const base = this.hooks.sheet.getBoundingClientRect().top;
      let y = 0;
      const gap = this.mode === 'rail' ? 6 : 14;
      for (const g of this.layer.children) {
        const a = anchors.find((x) => x.eid === g.dataset.eid);
        const top = a ? this.lineTop(a, base) : null;
        y = Math.max(y, top ?? y);
        g.style.transform = `translateY(${Math.round(y)}px)`;
        y += g.offsetHeight + gap;
      }
      this.placeFloat();
    });
  }

  // In one column: a strip of the scene's frames under its line. Each strip
  // is a widget, redrawn only when that scene's shots change.
  stripEl(a) {
    const box = make('div', 'ss-strip');
    box.contentEditable = 'false';
    box.dataset.eid = a.eid;
    box.setAttribute('aria-label', `Shots in ${sceneName(a)}`);
    for (const sh of this.shots.get(a.eid) || []) box.append(this.frameEl(sh, a));
    box.append(this.addEl(a));
    return box;
  }
  decorations(doc) {
    if (this.mode !== 'column') return null;
    const decos = anchorsOf(doc, this.hooks.script()).map((a) => Decoration.widget(a.pos + a.size, () => this.stripEl(a), { side: -2, key: `ss:${a.eid}:${this.version(a.eid)}:${a.n}`, ignoreSelection: true, stopEvent: () => true }));
    return DecorationSet.create(doc, decos);
  }
  // Only when strips show, or just stopped showing: a transaction of its own
  // otherwise would wake other plugins for nothing.
  redrawStrips() {
    const want = this.mode === 'column';
    if (!want && !this.stripsShown) return;
    this.stripsShown = want;
    const view = this.editor?.view;
    if (view) view.dispatch(view.state.tr.setMeta(KEY, { redraw: true }).setMeta('addToHistory', false));
  }

  // ---------- picking and opening (nothing moves) ----------

  // One click picks a shot (outlined, "Open ›" on it); a second opens it.
  clickShot(id) {
    if (this.sel === id) { if (this.open === id) this.close(); else this.showOpen(id); return; }
    this.sel = id;
    this.paint();
    if (this.open) this.showOpen(id);
  }
  pick(id) {
    this.sel = id;
    if (!id) this.close();
    this.paint();
  }
  paint() {
    for (const n of document.querySelectorAll('.ss-side [data-shot], .ss-strip [data-shot]')) {
      n.classList.toggle('sel', n.dataset.shot === this.sel);
      n.classList.toggle('opened', n.dataset.shot === this.open);
    }
  }
  close() { this.open = null; this.closeFloat(); this.paint(); }
  closeFloat() { document.querySelectorAll('.ss-pop, .ss-sheet').forEach((n) => n.remove()); this.float = null; }

  // The open shot floats: over its own place on a computer, as a sheet on a
  // phone. Nothing under it is pushed around.
  showOpen(id = this.open, focus = false) {
    this.closeFloat();
    const cur = id && this.mode !== 'off' ? this.find(id) : null;
    if (!cur) { this.open = null; this.paint(); return; }
    this.open = id;
    this.sel = id;
    const phone = this.kind() !== 'computer';
    const box = make('div', phone ? `ss-sheet${this.kind() === 'sideways' ? ' side' : ''}` : 'ss-pop');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `Shot ${this.codeOf(cur.sh, cur.a)}`);
    if (phone) {
      const list = this.all();
      const i = list.findIndex((x) => x.sh.id === id);
      const nav = make('div', 'ss-nav');
      const btn = (label, name, run) => { const b = make('button', '', label); b.type = 'button'; b.setAttribute('aria-label', name); b.addEventListener('click', run); return b; };
      nav.append(btn('‹', 'Shot before', () => this.step(-1)), make('span', 'ss-where', `Shot ${i + 1} of ${list.length}`), btn('›', 'Next shot', () => this.step(1)), btn('×', 'Close', () => this.close()));
      box.append(nav);
      document.body.append(box);
    } else {
      this.hooks.sheet.append(box);
    }
    box.append(this.detail(cur.sh, cur.a, !phone));
    this.float = box;
    this.paint();
    this.placeFloat(true);
    if (focus) box.querySelector('.ss-what-in')?.focus({ preventScroll: true });
  }
  // A popover sits over the shot's own place, kept on the screen.
  placeFloat(first = false) {
    const pop = this.float;
    if (!pop || !pop.classList.contains('ss-pop')) return;
    const node = document.querySelector(`.ss-side [data-shot="${CSS.escape(this.open)}"], .ss-strip [data-shot="${CSS.escape(this.open)}"]`);
    if (!node) return;
    const sheet = this.hooks.sheet.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    const beside = this.mode === 'beside';
    const width = beside ? Math.max(300, this.layer.offsetWidth) : 380;
    pop.style.width = `${width}px`;
    const left = beside ? this.layer.offsetLeft + this.layer.offsetWidth - width : Math.min(Math.max(0, r.left - sheet.left), sheet.width - width);
    pop.style.left = `${left}px`;
    if (!first && pop.dataset.top) return; // once placed, it stays put while you work in it
    const lo = -sheet.top + 12;
    const ruler = document.querySelector('.zm-ruler');
    const below = ruler && getComputedStyle(ruler).display !== 'none' ? ruler.offsetHeight : 0;
    const hi = window.innerHeight - below - sheet.top - pop.offsetHeight - 12;
    const top = Math.max(lo, Math.min(r.top - sheet.top, hi));
    pop.style.top = `${top}px`;
    pop.dataset.top = String(top);
  }

  // Stepping shot to shot (the sheet's ‹ ›) is the one time the page may
  // move, and only as far as it takes to bring the next shot into view.
  step(dir) {
    const list = this.all();
    if (!list.length) return;
    const i = list.findIndex((x) => x.sh.id === (this.open || this.sel));
    const to = list[(i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir + list.length) % list.length];
    this.sel = to.sh.id;
    if (this.open) this.showOpen(to.sh.id); else this.paint();
    const node = document.querySelector(`.ss-side [data-shot="${CSS.escape(to.sh.id)}"], .ss-strip [data-shot="${CSS.escape(to.sh.id)}"]`);
    if (!node) return;
    const r = node.getBoundingClientRect();
    const sheet = document.querySelector('.ss-sheet');
    const floor = window.innerHeight - (sheet ? sheet.offsetHeight + 16 : 0);
    if (r.top < 60) window.scrollBy(0, r.top - 80);
    else if (r.bottom > floor - 8) window.scrollBy(0, r.bottom - floor + 40);
    node.closest('.ss-strip')?.scrollTo?.({ left: node.offsetLeft - 8 });
  }

  // ---------- a shot, open ----------

  detail(sh, a, closeBtn) {
    return shotCard(sh, {
      code: this.codeOf(sh, a),
      scene: sceneName(a),
      pic: this.pic(sh, true),
      close: closeBtn ? () => this.close() : null,
      edit: (patch) => { if ('text' in patch) sh.text = patch.text; if ('framing' in patch) sh.fields = { ...sh.fields, framing: patch.framing }; this.patch(sh); this.later(sh.id); },
      done: () => { this.flush(sh.id); this.close(); },
      blur: () => this.flush(sh.id),
      picture: (f) => this.addPicture(sh.id, f),
      make: () => { this.flush(sh.id); this.hooks.openInMake(sh); },
      remove: () => this.remove(sh.id)
    });
  }
  // What happens and framing change on the frames as you type: no redraw.
  patch(sh) {
    for (const n of document.querySelectorAll(`.ss-side [data-shot="${CSS.escape(sh.id)}"], .ss-strip [data-shot="${CSS.escape(sh.id)}"]`)) {
      const w = n.querySelector('.ss-what');
      if (w) w.textContent = sh.text || 'What happens';
      const f = n.querySelector('.ss-nopic');
      if (f && !this.still(sh)) f.textContent = sh.fields?.framing || 'No picture yet';
    }
  }
  later(id) { clearTimeout(this.saving.get(id)); this.saving.set(id, setTimeout(() => this.flush(id), 500)); }
  async flush(id) {
    if (!this.saving.has(id)) return;
    clearTimeout(this.saving.get(id));
    this.saving.delete(id);
    const cur = this.find(id);
    const fresh = await getEntry(id);
    if (!cur || !fresh) return;
    const row = { ...fresh, text: cur.sh.text || '', fields: { ...fresh.fields, framing: cur.sh.fields?.framing || '' }, updated_at: Date.now() };
    delete row._by;
    await putEntries([row]);
    cur.sh.updated_at = row.updated_at; // ours: no redraw for it
  }

  // ---------- adding, pictures, removing ----------

  async add(eid, { what = '', framing = '', focus = true } = {}) {
    const sh = await newShot(eid, { what, framing, pieceId: this.pieceId });
    await this.reload();
    this.sel = sh.id;
    this.showOpen(sh.id, focus);
    const cur = this.find(sh.id);
    if (cur && focus) this.hooks.toast(`Shot ${this.codeOf(cur.sh, cur.a)} added to ${sceneName(cur.a)}`);
    return sh;
  }
  async addPicture(id, f) {
    if (!isImage(f.type)) { this.hooks.toast('Only pictures go on a frame here. Videos go in Make.'); return; }
    const row = await addFile(f, { shot: id });
    if (!row) { this.hooks.toast('That picture is over 50 MB.'); return; }
    await this.flush(id);
    const fresh = await getEntry(id);
    if (!fresh) return;
    this.kinds.set(row.id, 'still');
    const next = { ...fresh, fields: { ...withRenders(fresh.fields || {}, [row.id]), star: { ...(fresh.fields?.star || {}), still: row.id } }, updated_at: Date.now() };
    delete next._by;
    await putEntries([next]);
    await this.reload();
    if (this.open === id) this.showOpen(id);
  }
  async remove(id) {
    await this.flush(id);
    const fresh = await getEntry(id);
    if (!fresh) return;
    const cur = this.find(id);
    await putEntries([{ ...fresh, deleted: true, updated_at: Date.now() }]);
    this.close();
    this.sel = null;
    await this.reload();
    this.hooks.toast(`Shot ${cur ? this.codeOf(cur.sh, cur.a) : ''} moved to the Trash`, { label: 'Undo', run: async () => { await putEntries([{ ...fresh, deleted: false, updated_at: Date.now() }]); await this.reload(); } });
  }
}

// The editor's side of it: the strips under each scene line, in one column.
export const ShotStrips = Extension.create({
  name: 'shotStrips',
  addOptions() { return { shots: () => null }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key: KEY,
      props: { decorations: (state) => opts.shots()?.decorations(state.doc) || null }
    })];
  }
});

