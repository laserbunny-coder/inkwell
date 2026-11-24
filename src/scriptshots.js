// The script with its shots beside it (Nov 22 2026, for Elle: "the script
// side by side with storyboards and shots"). Part 1: by scene. Nothing about
// how shots are kept changes: a shot is still an entry of kind 'shot' under
// its scene's heading paragraph (a novel: under its scene break), so Make,
// the Storyboard tab, shot codes, the connector and exports all see what is
// added here.
//
// Part 2 (Nov 22 2026): each shot sits on the lines it covers (the "lined
// script"). A shot keeps its first and last line by paragraph id
// (fields.from, fields.to; see shotlines.js); one on no lines waits at its
// scene line. A tramline beside the words marks each shot's lines, a dotted
// mark each line no shot covers yet, and the scene says "3 shots · 2 lines
// without one". Click a line (Shift + click or drag for several) and a small
// bar offers "+ Shot for these lines" and "Move shot 03 here".
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
import { addFile, fileUrl, fileBlob, thumbUrl, isImage } from './files.js';
import { shotsUnder, newShot, shotCode, stillOf, withRenders, isVideo, isFilmed, gotIt, shotStatus } from './production.js';
import { stageSetOf } from './library.js';
import { snap, resolve, linesIn, inOrder, covering, bareLines, lanes, placeAmong } from './shotlines.js';
import { scenesOf } from './woven.js';
import { holdStill } from './steady.js';
import { shotCard } from './shotcard.js';
import { picturesOnScene, picturesOnShot, picturesText, pictureSources, sketch, tryOf, framePrompt } from './picturesin.js';
import { popMenu } from './menu.js';
import { gripMethods, stepEnd } from './shotgrips.js';
import './scriptshots.css';
import { screenKind, sceneName } from './scenename.js';

const KEY = new PluginKey('scriptShots');
const SITS = ['beside', 'column'];
const DEFAULT_SITS = { computer: 'beside', phone: 'column', sideways: 'beside' };
// Room the column beside the text takes (its width plus the gap to the text).
const ROOM = { computer: 372, sideways: 262, phone: 88 };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The scenes shots can hang under, in order: a script's scene headings, or
// a novel's scene breaks. Each is named by its own name, never its slug, and
// carries its lines: the paragraphs after it, up to the next scene
// ({ id, el, text, pos, end }).
export function anchorsOf(doc, script) {
  let out;
  if (script) {
    out = scenesOf(doc).filter((s) => s.node && s.eid).map((s) => ({ eid: s.eid, pos: s.pos, size: s.node.nodeSize, n: String(s.node.attrs.code || s.n), code: s.node.attrs.code || '', title: s.title || '', first: s.first || '', slug: s.node.textContent || '' }));
  } else {
    out = [];
    doc.forEach((node, pos) => {
      if (node.type.name !== 'sceneBreak' || !node.attrs.eid) return;
      out.push({ eid: node.attrs.eid, pos, size: node.nodeSize, n: String(out.length + 1), code: '', title: node.attrs.title || '', first: (doc.childAfter(pos + node.nodeSize).node?.textContent || '').trim(), slug: '' });
    });
  }
  const at = new Map(out.map((a) => [a.pos, a]));
  let cur = null;
  for (const a of out) a.paras = [];
  doc.forEach((node, pos) => {
    if (at.has(pos)) { cur = at.get(pos); return; }
    if (!cur || node.type.name !== 'paragraph') return;
    if (script && node.attrs.el === 'scene') { cur = null; return; } // a heading that isn't saved yet
    if (node.attrs.eid) cur.paras.push({ id: node.attrs.eid, el: node.attrs.el || 'action', text: node.textContent, pos, end: pos + node.nodeSize });
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
    this.last = null; // the shot picked last, for "Move shot 03 here"
    this.hover = null;
    this.lit = []; // the shots that cover the line clicked
    this.shown = new Map(); // shot id -> the picture tapped in its open card
    this.lines = null; // the lines picked: { eid, from, to } (indexes in its scene)
    this.saving = new Map();
    this.frame = 0;
    this.groupsKey = '';
    this.mode = 'off';
    this.layer = make('div', 'ss-side');
    this.layer.setAttribute('aria-label', 'Shots, beside the script');
    // Tramlines, the dotted marks and what's lit, over the page: they never
    // take room, so nothing in the script moves for them.
    this.marks = make('div', 'ss-marks');
    this.marks.setAttribute('aria-hidden', 'true');
    this.bar = make('div', 'ss-bar');
    this.bar.hidden = true;
    this.bar.addEventListener('mousedown', (e) => e.preventDefault()); // the picked words stay picked
    hooks.sheet.append(this.marks, this.layer, this.bar);
    this.gripsInit();
    try { const s = JSON.parse(localStorage.getItem('shotsSit') || '{}'); this.sits = { ...DEFAULT_SITS, ...Object.fromEntries(Object.entries(s).filter(([, v]) => SITS.includes(v))) }; } catch { this.sits = { ...DEFAULT_SITS }; }
    window.addEventListener('resize', () => this.refit());
    // Back in Write from Make (or anywhere): the shots as they are now.
    new MutationObserver(() => { if (this.hooks.writing() && this.on) this.reload().then(() => this.refit(true)); else this.refit(true); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-view'] });
    const dom = hooks.editor().view.dom;
    new ResizeObserver(() => this.place()).observe(dom);
    // A click on a line lights the shots on it and offers a shot for it;
    // typing puts the bar away again.
    const picked = () => setTimeout(() => this.pickLines(), 0);
    dom.addEventListener('mouseup', picked);
    dom.addEventListener('touchend', picked);
    // Pictures dragged from the computer's folders onto a line: a shot there.
    dom.addEventListener('dragover', (e) => {
      if (!this.picsDragged(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.showDrop(this.lineAt(e.clientX, e.clientY), null, this.picked ?? (this.picked = this.lines));
    }, true);
    dom.addEventListener('dragleave', (e) => { if (!dom.contains(e.relatedTarget)) this.endDrop(); }, true);
    dom.addEventListener('drop', (e) => {
      if (!this.picsDragged(e)) return;
      const files = [...(e.dataTransfer.files || [])].filter((f) => isImage(f.type));
      const hit = this.lineAt(e.clientX, e.clientY);
      const picked = this.picked;
      this.endDrop();
      if (!files.length || !hit) return;
      e.preventDefault();
      e.stopPropagation();
      this.picturesOnLines(hit.a, this.dropSpan(hit, picked), files);
    }, true);
    // While a frame is held and dragged on a phone, the page doesn't scroll.
    document.addEventListener('touchmove', (e) => { if (this.dragging) e.preventDefault(); }, { passive: false });
    // Typing lets go of picked lines; Shift + arrows in the words stretch the
    // picked words, and the lines follow them.
    const arrow = (e) => e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp');
    dom.addEventListener('keydown', (e) => { if (this.lines && !arrow(e) && !['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) this.dropLines(); });
    dom.addEventListener('keyup', (e) => { if (this.lines && arrow(e)) this.pickLines(); });
    // Shift + click on a line stretches a picked frame (or lines picked in
    // the margin) as far as that line.
    dom.addEventListener('mousedown', (e) => {
      if (!e.shiftKey || e.button > 0 || this.mode === 'off') return;
      const b = this.block();
      if (!b || (b.kind === 'pick' && !this.lines?.margin)) return;
      const hit = this.lineAt(e.clientX, e.clientY);
      if (!hit || !this.stretchTo(hit)) return;
      e.preventDefault();
      this.dropped = Date.now();
    }, true);
    // A click anywhere else lets go of the picked shot; nothing else changes.
    document.addEventListener('click', (e) => {
      if (!this.sel && !this.open && !this.lines) return;
      if (e.target.closest?.('.ss-side, .ss-rows, .ss-pop, .ss-sheet, .ss-bar, .ss-gut, .ss-knob, .ss-banner, .pop-menu, .toast')) return;
      if (this.lines && !dom.contains(e.target)) this.dropLines();
      if (this.sel || this.open) this.pick(null);
    });
    document.addEventListener('keydown', (e) => { this.gripKey(e); }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.placing && !this.open) { e.preventDefault(); e.stopPropagation(); this.placing = null; this.paint(); return; }
      if (e.key === 'Escape' && (this.open || this.sel || this.lines)) { e.preventDefault(); e.stopPropagation(); if (this.open) this.close(); else if (this.sel) this.pick(null); else this.dropLines(); }
    }, true);
  }

  get editor() { return this.hooks.editor(); }
  kind() { return screenKind(); }
  anchors() {
    const doc = this.editor.state.doc;
    const script = !!this.hooks.script();
    if (this.cache?.doc !== doc || this.cache.script !== script) this.cache = { doc, script, list: anchorsOf(doc, script) };
    return this.cache.list;
  }
  // A scene's shots in the order they sit: on no lines first, then by line.
  ordered(a) { return inOrder(this.shots.get(a.eid) || [], a.paras); }
  span(sh, a) {
    // While a knob is pulled the frame's lines follow it (saved on letting go).
    if (this.stretch?.id === sh.id) return { from: this.stretch.from, to: this.stretch.to };
    return resolve(sh, a.paras);
  }
  countText(a) {
    const list = this.shots.get(a.eid) || [];
    if (!list.length) return 'No shots yet';
    const bare = bareLines(list, a.paras).length;
    return `${plural(list.length, 'shot')}${bare ? ` · ${plural(bare, 'line')} without one` : ''}`;
  }
  // The words a shot covers, said plainly for the open shot.
  coversText(sh, a) {
    const r = this.span(sh, a);
    if (!r) return 'Not on any lines yet. Click a line in the script, then Move shot here.';
    const first = a.paras[r.from]?.text?.trim() || '';
    const words = first.split(/\s+/).slice(0, 6).join(' ');
    return `Covers ${plural(linesIn(a.paras, r.from, r.to), 'line')}, from “${words}${first.split(/\s+/).length > 6 ? '…' : ''}”`;
  }
  version(eid) { return this.versions.get(eid) || 0; }

  // ---------- on or off, and where ----------

  // Before another chapter's words come in: nothing of the last one stays.
  unload() {
    this.pieceId = null;
    this.sel = this.open = this.last = this.hover = this.lines = this.placing = null;
    this.lit = [];
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
      if (next === 'off') { this.sel = this.open = this.lines = this.hover = this.placing = null; this.lit = []; this.closeFloat(); }
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
    // How the film is made (filmed or generated), as Make sees it.
    try { const set = stageSetOf(this.hooks.piece(), this.world); this.setId = set.own ? set.base : set.id; } catch { this.setId = null; }
    for (const a of anchors) {
      const was = (this.shots.get(a.eid) || []).map((s) => `${s.id}:${s.updated_at}`).join();
      const now = shots.get(a.eid).map((s) => `${s.id}:${s.updated_at}`).join();
      if (was !== now) this.versions.set(a.eid, this.version(a.eid) + 1);
    }
    this.shots = shots;
    if (this.open && !this.find(this.open)) { this.open = null; this.closeFloat(); }
    if (this.sel && !this.find(this.sel)) this.sel = null;
    if (draw) { this.groupsKey = ''; this.drawSide(); this.redrawStrips(); this.place(); }
  }
  // The shot and the scene it's in.
  find(id) {
    for (const a of this.anchors()) { const sh = (this.shots.get(a.eid) || []).find((s) => s.id === id); if (sh) return { a, sh }; }
    return null;
  }
  all() { return this.anchors().flatMap((a) => this.ordered(a).map((sh) => ({ a, sh }))); }
  codeOf(sh, a) { return shotCode({ show: this.world?.fields?.production?.code, piece: this.hooks.piece()?.fields?.code, scene: a?.code || a?.n, shot: sh.fields?.n }); }
  still(sh) { return stillOf(sh, (id) => this.kinds.get(id)); }

  // ---------- drawing a shot, small ----------

  pic(sh, big = false, id = this.still(sh)) {
    const pic = make('span', 'ss-pic');
    if (id) (big ? fileUrl(id) : thumbUrl(id)).then((url) => { if (url) { const img = make('img'); img.src = url; img.alt = ''; pic.replaceChildren(img); } }).catch(() => {});
    pic.append(make('span', 'ss-nopic', sh.fields?.framing || (id ? '' : 'No picture yet')));
    return pic;
  }
  // A shot, small: a row (its picture, code, what happens, framing), or on a
  // phone held upright a picture with its number.
  cardEl(sh, a, thumb = false) {
    const b = make('button', thumb ? 'ss-thumb' : 'ss-card');
    b.type = 'button';
    b.dataset.shot = sh.id;
    b.dataset.eid = a.eid;
    const code = this.codeOf(sh, a);
    if (thumb) {
      b.setAttribute('aria-label', `${code}: ${sh.text || 'shot'}`);
      b.append(this.pic(sh), make('span', 'ss-num', sh.fields?.n || ''));
    } else {
      const words = make('span', 'ss-words');
      words.append(make('span', 'ss-code', code), make('span', 'ss-what', sh.text || 'What happens'), make('span', 'ss-framing', sh.fields?.framing || ''));
      if (!this.span(sh, a)) words.append(make('span', 'ss-loose', 'Not on any lines yet'));
      b.append(this.pic(sh), words);
    }
    // A filmed shot's Got it, right on the frame: one tap on the shoot day.
    if (isFilmed(sh, this.setId)) {
      const on = gotIt(sh);
      b.classList.toggle('got', on);
      const tick = make('span', 'ss-tick', on ? '✓' : '');
      tick.setAttribute('role', 'button');
      tick.setAttribute('aria-pressed', String(on));
      tick.setAttribute('aria-label', on ? 'Got it (tap to undo)' : 'Got it');
      tick.title = tick.getAttribute('aria-label');
      tick.addEventListener('pointerdown', (e) => e.stopPropagation());
      tick.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.setGot(sh.id, !on).then(() => this.reload()); });
      b.querySelector('.ss-pic')?.append(tick);
    }
    b.classList.toggle('sel', this.sel === sh.id);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // the caret stays where it was
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (Date.now() - (this.dropped || 0) < 500) return; this.clickShot(sh.id); });
    b.addEventListener('pointerdown', (e) => this.dragShot(e, sh, a, b));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); }); // a held frame is being dragged, not asking for a menu
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.sel = this.last = sh.id; this.showOpen(sh.id); } });
    b.addEventListener('mouseenter', () => { this.hover = sh.id; this.paint(); });
    b.addEventListener('mouseleave', () => { if (this.hover === sh.id) { this.hover = null; this.paint(); } });
    return b;
  }
  addEl(a, label = '+ shot') {
    const b = make('button', 'ss-addbtn', label);
    b.type = 'button';
    b.setAttribute('aria-label', `Add a shot to ${sceneName(a)}`);
    b.title = `Add a shot to ${sceneName(a)}`;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.add(a.eid); });
    return b;
  }
  // "+ pictures": several at once fill the scene's shots without a picture,
  // in order, then each one left becomes a new shot.
  picsEl(a, label = '+ pictures') {
    const b = make('label', 'ss-addbtn ss-addpics', label);
    b.title = `Add pictures to ${sceneName(a)}: they fill its shots without a picture, then make new shots`;
    b.setAttribute('aria-label', `Add pictures to ${sceneName(a)}`);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => e.stopPropagation());
    const input = make('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.hidden = true;
    input.addEventListener('change', async () => {
      const files = [...(input.files || [])];
      input.value = '';
      if (!files.length) return;
      const r = await picturesOnScene(a.eid, files, { pieceId: this.pieceId });
      await this.reload();
      this.hooks.toast(picturesText(r), r.filled + r.made ? { label: 'Undo', run: async () => { await r.undo(); await this.reload(); } } : undefined);
    });
    b.append(input);
    return b;
  }
  // At each scene line: how many shots and how many lines still without one.
  headEl(a, thumb = false) {
    const h = make('div', 'ss-head');
    h.dataset.eid = a.eid;
    if (thumb) { h.append(this.picsEl(a, '+ pics'), this.addEl(a, '+ shot')); h.title = this.countText(a); return h; }
    h.append(make('span', 'ss-count', this.countText(a)), this.picsEl(a), this.addEl(a));
    return h;
  }

  // Beside the text: at each scene line its count, then each shot level
  // with its first line (one on no lines waits at the scene line).
  sideKey(anchors) {
    return anchors.map((a) => `${a.eid}:${this.version(a.eid)}:${a.n}:${a.title}:${this.ordered(a).map((sh) => `${sh.id}${this.span(sh, a) ? '' : '-'}`).join(',')}`).join('|') + this.mode;
  }
  drawSide() {
    const side = this.mode === 'beside' || this.mode === 'rail';
    this.layer.hidden = !side;
    if (!side) { this.layer.replaceChildren(); this.groupsKey = ''; return; }
    const anchors = this.anchors();
    const key = this.sideKey(anchors);
    if (key === this.groupsKey) { this.place(); return; }
    this.groupsKey = key;
    const thumb = this.mode === 'rail';
    this.layer.replaceChildren(...anchors.flatMap((a) => [this.headEl(a, thumb), ...this.ordered(a).map((sh) => this.cardEl(sh, a, thumb))]));
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
  // Where a line is (its top and bottom, from the top of the sheet).
  paraBox(p, base) {
    let el = null;
    try { el = this.editor.view.nodeDOM(p.pos); } catch { el = null; }
    if (!el?.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    return r.height || r.width ? { top: r.top - base, bottom: r.bottom - base } : null;
  }
  // Puts everything where it goes: each shot level with its first line (one
  // that would overlap the one above waits under it), the tramlines, the
  // dotted marks, what's lit and the bar over picked lines. Only these move:
  // the text never does.
  place() {
    if (this.mode === 'off') { this.marks.replaceChildren(); this.bar.hidden = true; return; }
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.placeNow());
  }
  placeNow() {
    if (this.mode === 'off') return;
    const anchors = this.anchors();
    const side = this.mode === 'beside' || this.mode === 'rail';
    if (side && this.sideKey(anchors) !== this.groupsKey) { this.drawSide(); return; }
    const sheet = this.hooks.sheet.getBoundingClientRect();
    const base = sheet.top;
    const ed = this.editor.view.dom.getBoundingClientRect();
    const textL = ed.left - sheet.left;
    const textR = ed.right - sheet.left;
    const rail = this.mode === 'rail';
    const gutter = side ? (rail ? 3 : 8) : 0;
    const laneW = rail ? 4 : 6;
    const x = (lane) => (side ? textR + gutter + lane * laneW : Math.max(2 - sheet.left, textL - 9 - lane * 5));
    const marks = [];
    const boxes = new Map(); // shot id -> its lines' box, for what's lit
    const tram = new Map(); // shot id -> its tramline
    const nodeOf = new Map([...this.layer.children].filter((n) => n.dataset.shot).map((n) => [n.dataset.shot, n]));
    const headOf = new Map([...this.layer.children].filter((n) => !n.dataset.shot).map((n) => [n.dataset.eid, n]));
    let y = 0;
    const gap = rail ? 5 : 6;
    for (const a of anchors) {
      const list = this.ordered(a);
      const geo = a.paras.map((p) => this.paraBox(p, base));
      const lane = lanes(list, a.paras);
      for (const sh of list) {
        const r = this.span(sh, a);
        if (!r || !geo[r.from] || !geo[r.to]) continue;
        const box = { top: geo[r.from].top, bottom: geo[r.to].bottom };
        boxes.set(sh.id, box);
        const t = { left: x(lane.get(sh.id) || 0), top: box.top + 3, height: Math.max(6, box.bottom - box.top - 6) };
        tram.set(sh.id, t);
        const m = make('span', 'ss-tram');
        m.dataset.shot = sh.id;
        Object.assign(m.style, { left: `${t.left}px`, top: `${t.top}px`, height: `${t.height}px` });
        marks.push(m);
      }
      for (const i of bareLines(list, a.paras)) {
        const { to } = snap(a.paras, i, i);
        if (!geo[i] || !geo[to]) continue;
        const m = make('span', 'ss-bare');
        Object.assign(m.style, { left: `${x(0)}px`, top: `${geo[i].top + 4}px`, height: `${Math.max(4, geo[to].bottom - geo[i].top - 8)}px` });
        marks.push(m);
      }
      for (const n of document.querySelectorAll(`.ss-count[data-eid="${CSS.escape(a.eid)}"], .ss-head[data-eid="${CSS.escape(a.eid)}"] .ss-count`)) { const t = this.countText(a); if (n.textContent !== t) n.textContent = t; }
      if (!side) continue;
      const head = headOf.get(a.eid);
      if (head) {
        y = Math.max(y, this.lineTop(a, base) ?? y);
        head.style.top = `${Math.round(y)}px`;
        y += head.offsetHeight + gap;
      }
      for (const sh of list) {
        const node = nodeOf.get(sh.id);
        if (!node) continue;
        const box = boxes.get(sh.id);
        y = Math.max(y, box ? box.top - (rail ? 0 : 6) : y);
        node.style.top = `${Math.round(y)}px`;
        y += node.offsetHeight + gap;
      }
    }
    // What's lit: the lines of the shot under the pointer or picked, the
    // lines picked in the script, and a line from each lit shot to its lines.
    const show = this.hover || this.sel;
    const hl = (box, cls) => { const m = make('span', cls); Object.assign(m.style, { left: `${textL - 6}px`, width: `${textR - textL + 12}px`, top: `${box.top - 1}px`, height: `${box.bottom - box.top + 2}px` }); marks.push(m); };
    if (show && boxes.has(show)) hl(boxes.get(show), 'ss-hl');
    const pickBox = this.linesBox(anchors, base);
    if (pickBox) hl(pickBox, 'ss-hl pick');
    const on = new Set([show, ...this.lit].filter(Boolean));
    for (const m of marks) if (m.dataset?.shot && on.has(m.dataset.shot)) m.classList.add('on');
    if (side) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ss-links');
      for (const id of on) {
        const t = tram.get(id);
        const node = nodeOf.get(id);
        if (!t || !node) continue;
        const x1 = t.left + 1.5;
        const x2 = this.layer.offsetLeft + 1;
        const y2 = node.offsetTop + Math.min(node.offsetHeight / 2, 30);
        const y1 = Math.min(Math.max(y2, t.top + 4), t.top + t.height - 4);
        const mx = (x1 + x2) / 2;
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`);
        const dot = document.createElementNS(svg.namespaceURI, 'circle');
        Object.entries({ cx: x2, cy: y2, r: 2.5 }).forEach(([k, v]) => dot.setAttribute(k, String(v)));
        svg.append(path, dot);
      }
      marks.push(svg);
    }
    this.marks.replaceChildren(...marks);
    this.placeGrips({ anchors, base, sheet, textL, textR, x, side });
    const b = this.block();
    const bt = b && this.paraBox(b.a.paras[b.from], base);
    const bb = b && this.paraBox(b.a.paras[b.to], base);
    this.placeBar(bt && bb ? { ...b, top: bt.top, bottom: bb.bottom } : null, textR, sheet);
    this.placeFloat();
  }

  // In one column: each shot is a row right above its first line; the scene
  // line has its count, "+ shot" and the shots on no lines yet. Each is a
  // widget, redrawn only when what it shows changes.
  rowsEl(a, list, head) {
    const box = make('div', `ss-rows${head ? ' ss-headrow' : ''}`);
    box.contentEditable = 'false';
    box.dataset.eid = a.eid;
    if (head) {
      const h = make('div', 'ss-head');
      h.dataset.eid = a.eid;
      const count = make('span', 'ss-count', this.countText(a));
      count.dataset.eid = a.eid;
      h.append(count, this.picsEl(a), this.addEl(a));
      box.append(h);
      box.setAttribute('aria-label', `Shots in ${sceneName(a)}`);
    }
    for (const sh of list) box.append(this.cardEl(sh, a));
    return box;
  }
  decorations(doc) {
    if (this.mode !== 'column') return null;
    const decos = [];
    const opts = (key) => ({ key, ignoreSelection: true, stopEvent: () => true });
    for (const a of anchorsOf(doc, this.hooks.script())) {
      const list = inOrder(this.shots.get(a.eid) || [], a.paras);
      const at = new Map();
      const loose = [];
      for (const sh of list) { const r = resolve(sh, a.paras); if (r) { if (!at.has(r.from)) at.set(r.from, []); at.get(r.from).push(sh); } else loose.push(sh); }
      const v = this.version(a.eid);
      decos.push(Decoration.widget(a.pos + a.size, () => this.rowsEl(a, loose, true), { side: -2, ...opts(`ssh:${a.eid}:${v}:${a.n}:${loose.map((s) => s.id).join()}`) }));
      for (const [i, shots] of at) decos.push(Decoration.widget(a.paras[i].pos, () => this.rowsEl(a, shots, false), { side: -1, ...opts(`ssr:${a.eid}:${v}:${a.n}:${shots.map((s) => s.id).join()}`) }));
    }
    return DecorationSet.create(doc, decos);
  }
  // Only when rows show, or just stopped showing: a transaction of its own
  // otherwise would wake other plugins for nothing.
  redrawStrips() {
    const want = this.mode === 'column';
    if (!want && !this.stripsShown) return;
    this.stripsShown = want;
    const view = this.editor?.view;
    if (view) view.dispatch(view.state.tr.setMeta(KEY, { redraw: true }).setMeta('addToHistory', false));
  }
  // The words changed: the shots follow their lines.
  docChanged() { if (this.mode !== 'off') this.place(); }

  // ---------- picking lines ----------

  // The line (or lines) the caret or the picked words are on, in one scene.
  pickLines() {
    if (this.mode === 'off' || !this.pieceId || this.dragging || Date.now() - (this.dropped || 0) < 500) return;
    const { from, to } = this.editor.state.selection;
    const where = (pos) => this.lineAtPos(pos);
    const A = where(from);
    if (!A) { this.dropLines(); return; }
    const B = where(Math.max(from, to - 1));
    const end = B && B.a === A.a ? B.i : A.a.paras.length - 1;
    const r = snap(A.a.paras, A.i, end);
    if (this.placing) { const cur = this.find(this.placing); if (cur) { this.placeOn(cur, A.a, r); return; } }
    this.lines = { eid: A.a.eid, from: r.from, to: r.to };
    this.lit = covering(this.shots.get(A.a.eid) || [], A.a.paras, r.from).map((s) => s.id);
    this.paint();
  }
  dropLines() {
    if (!this.lines && !this.lit.length) return;
    this.lines = null;
    this.lit = [];
    this.bar.hidden = true;
    this.paint();
  }
  linesBox(anchors, base) {
    const L = this.lines;
    const a = L && anchors.find((x) => x.eid === L.eid);
    if (!a || !a.paras[L.from] || !a.paras[L.to]) return null;
    const t = this.paraBox(a.paras[L.from], base);
    const b = this.paraBox(a.paras[L.to], base);
    return t && b ? { top: t.top, bottom: b.bottom, a } : null;
  }
  // The little bar over the lit block: above it, or under it where there's
  // no room above. Never on the lines themselves. − and + always come first,
  // in the same place, so they never shift under a finger.
  placeBar(box, textR, sheet) {
    const bar = this.bar;
    if (!box) { bar.hidden = true; bar.replaceChildren(); delete bar.dataset.sig; return; }
    if (this.dragging || this.placing) { bar.hidden = true; return; }
    const { a } = box;
    const n = this.linesNow(a, box);
    const btn = (label, run, cls = '') => { const b = make('button', cls, label); b.type = 'button'; b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); run(); }); return b; };
    // What the buttons act on is read when they're pressed: the bar is kept
    // while its words stay the same, and the lit block may have changed.
    const now = () => { const l = this.lines; const at = l && this.anchors().find((x) => x.eid === l.eid); return at ? { at, l } : null; };
    const less = btn('−', () => this.stepBlock('to', -1), 'ss-sq ss-less');
    const more = btn('+', () => this.stepBlock('to', 1), 'ss-sq ss-more');
    less.setAttribute('aria-label', 'Take the last line away');
    more.setAttribute('aria-label', 'Add the next line');
    less.disabled = !this.stepOk(box, 'to', -1);
    more.disabled = !this.stepOk(box, 'to', 1);
    const kids = [less, more];
    let say;
    if (box.kind === 'shot') {
      say = `Shot ${box.sh.fields?.n || ''} · ${n === 1 ? '1 line' : `${n} lines`}`;
      const id = box.sh.id;
      kids.push(btn('Open', () => this.showOpen(id)));
    } else {
      say = `${n === 1 ? '1 line' : `${n} lines`} picked`;
      const shot = btn('+ Shot', () => { const x = now(); if (x) this.add(x.at.eid, { from: x.l.from, to: x.l.to }); });
      shot.title = `A new shot for ${n === 1 ? 'this line' : 'these lines'}`;
      kids.push(shot);
      // + Picture: a picture straight onto the picked lines (the phone's gallery).
      const pic = btn('+ Picture', () => { const x = now(); if (x) this.choosePicture(pic, (files, meta) => this.picturesOnLines(x.at, x.l, files, meta), { title: `A frame for ${sceneName(x.at)}` }); }, 'ss-barpic');
      pic.title = 'A picture for these lines: it becomes a shot covering them';
      kids.push(pic);
      const mover = this.find(this.open || this.last);
      const r = mover ? this.span(mover.sh, mover.a) : null;
      if (mover && mover.a.eid === a.eid && !(r && r.from === box.from && r.to === box.to)) {
        kids.push(btn(`${r ? 'Move' : 'Put'} shot ${mover.sh.fields?.n || ''} here`, () => { const x = now(); if (x) this.placeOn(mover, x.at, x.l); }));
      }
    }
    const label = make('span', 'ss-say', say);
    kids.unshift(label);
    const sig = kids.map((k) => `${k.textContent}${k.disabled ? '0' : ''}`).join('|');
    if (bar.dataset.sig !== sig) { bar.replaceChildren(...kids); bar.dataset.sig = sig; }
    bar.hidden = false;
    const h = bar.offsetHeight || 32;
    const ruler = document.querySelector('.zm-ruler');
    const topBar = 64;
    const above = box.top - h - 6;
    const roomAbove = sheet.top + above > topBar;
    const below = box.bottom + 6;
    const fitsBelow = sheet.top + below + h < window.innerHeight - (ruler?.offsetHeight || 0);
    bar.style.top = `${roomAbove || !fitsBelow ? above : below}px`;
    bar.style.left = `${Math.max(0, textR - bar.offsetWidth)}px`;
  }
  stepOk(box, end, d) { return !!stepEnd(box.a.paras, box, end, d); }

  // ---------- picking and opening (nothing moves) ----------

  // One click picks a shot (outlined, "Open ›" on it); a second opens it.
  clickShot(id) {
    this.last = id;
    // A frame on no lines, tapped: it waits for one tap on its line.
    const cur = this.find(id);
    if (cur && !this.span(cur.sh, cur.a) && this.sel !== id && !this.open) { this.startPlacing(id); return; }
    if (this.placing && this.placing !== id) this.placing = null;
    if (this.sel === id) { if (this.open === id) this.close(); else this.showOpen(id); return; }
    this.sel = id;
    this.paint();
    if (this.open) this.showOpen(id);
  }
  pick(id) {
    this.sel = id;
    if (id) this.last = id;
    if (!id) this.close();
    this.paint();
  }
  paint() {
    for (const n of document.querySelectorAll('.ss-side [data-shot], .ss-rows [data-shot]')) {
      n.classList.toggle('sel', n.dataset.shot === this.sel);
      n.classList.toggle('opened', n.dataset.shot === this.open);
      n.classList.toggle('on', n.dataset.shot === this.hover || this.lit.includes(n.dataset.shot));
    }
    this.place();
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
    this.placing = null;
    this.sel = this.last = id;
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
    const node = document.querySelector(`.ss-side [data-shot="${CSS.escape(this.open)}"], .ss-rows [data-shot="${CSS.escape(this.open)}"]`);
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

  // Alt + Down and Alt + Up step shot to shot when a shot is picked or the
  // caret isn't in the words (in the words they keep their own job).
  stepping() { return this.mode !== 'off' && (!!(this.sel || this.open) || !this.editor.isFocused); }

  // Stepping shot to shot (the sheet's ‹ ›, Alt + Up / Down) is the one time the page may
  // move, and only as far as it takes to bring the next shot into view.
  step(dir) {
    const list = this.all();
    if (!list.length) return;
    const i = list.findIndex((x) => x.sh.id === (this.open || this.sel));
    const to = list[(i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir + list.length) % list.length];
    this.sel = this.last = to.sh.id;
    if (this.open) this.showOpen(to.sh.id); else this.paint();
    const node = document.querySelector(`.ss-side [data-shot="${CSS.escape(to.sh.id)}"], .ss-rows [data-shot="${CSS.escape(to.sh.id)}"]`);
    if (!node) return;
    const r = node.getBoundingClientRect();
    const sheet = document.querySelector('.ss-sheet');
    const floor = window.innerHeight - (sheet ? sheet.offsetHeight + 16 : 0);
    if (r.top < 60) window.scrollBy(0, r.top - 80);
    else if (r.bottom > floor - 8) window.scrollBy(0, r.bottom - floor + 40);
      }

  // ---------- a shot, open ----------

  detail(sh, a, closeBtn) {
    // The picture shown: the one tapped in its strip, else the frame.
    let shown = this.shown.get(sh.id);
    if (!shown || !tryOf(sh, shown)) shown = this.still(sh);
    const t = shown ? tryOf(sh, shown) : null;
    const star = sh.fields?.star || {};
    const pics = (sh.fields?.tries || []).flatMap((tr) => (tr.files || []).filter((id) => this.kinds.get(id) !== 'video').map((id) => ({ id, tr }))).reverse();
    const title = `Shot ${this.codeOf(sh, a)}${sh.text ? `: ${sh.text}` : ''}`;
    return shotCard(sh, {
      code: this.codeOf(sh, a),
      scene: sceneName(a),
      covers: this.coversText(sh, a),
      status: shotStatus(sh, this.setId),
      got: isFilmed(sh, this.setId) ? { on: gotIt(sh), set: (on) => this.setGot(sh.id, on) } : null,
      pic: this.pic(sh, true, shown),
      sketch: {
        blank: () => this.sketchOn(sh.id, { title }),
        over: shown && !t?.strokes ? () => this.sketchOn(sh.id, { title, under: shown, from: t?.id }) : null,
        again: t?.strokes ? () => this.sketchOn(sh.id, { title, strokes: t.strokes, from: t.id }) : null
      },
      frames: {
        list: pics.map(({ id, tr }) => ({ id, board: tr.kind === 'board', star: star.still === id || star.board === id, shown: id === shown, url: thumbUrl(id) })),
        show: (id) => { this.shown.set(sh.id, id); this.showOpen(sh.id); },
        star: (id) => this.starFrame(sh.id, id)
      },
      copyPrompt: () => this.copyPrompt(sh, a),
      savePicture: shown ? () => this.savePicture(shown, title) : null,
      close: closeBtn ? () => this.close() : null,
      edit: (patch) => { if ('text' in patch) sh.text = patch.text; if ('framing' in patch) sh.fields = { ...sh.fields, framing: patch.framing }; this.patch(sh); this.later(sh.id); },
      done: () => { this.flush(sh.id); this.close(); },
      blur: () => this.flush(sh.id),
      picture: (files) => this.addPictures(sh.id, files),
      place: { label: this.span(sh, a) ? 'Put on other lines' : 'Put on lines', run: () => this.startPlacing(sh.id) },
      unplace: this.span(sh, a) ? () => this.takeOff(sh.id) : null,
      ends: this.endsOf(sh, a),
      make: () => { this.flush(sh.id); this.hooks.openInMake(sh); },
      remove: () => this.remove(sh.id)
    });
  }
  // Starts at / Ends at: each end's first words, with a line earlier or later.
  endsOf(sh, a) {
    const r = this.span(sh, a);
    if (!r) return null;
    const words = (i) => { const p = a.paras[i]; const t = (p?.text || '').trim(); return t.length > 40 ? `${t.slice(0, 38)}…` : t || '(an empty line)'; };
    const lastStart = [...a.paras.keys()].filter((i) => i <= r.to && (a.paras[i].text || '').trim() && !['dialogue', 'paren'].includes(a.paras[i].el)).at(-1) ?? r.to;
    const end = (k, i) => ({ words: words(i), up: stepEnd(a.paras, r, k, -1) ? () => this.nudge(sh.id, k, -1) : null, down: stepEnd(a.paras, r, k, 1) ? () => this.nudge(sh.id, k, 1) : null });
    return { start: end('from', r.from), end: end('to', lastStart) };
  }
  // Got it, from the open shot: the same field Make's tick sets.
  async setGot(id, on) {
    await this.flush(id);
    const fresh = await getEntry(id);
    if (!fresh) return;
    const fields = { ...fresh.fields };
    if (on) fields.got = Date.now(); else delete fields.got;
    const row = { ...fresh, fields, updated_at: Date.now() };
    delete row._by;
    await putEntries([row]);
    const cur = this.find(id);
    if (cur) { cur.sh.fields = fields; cur.sh.updated_at = row.updated_at; }
    this.showOpen?.();
  }
  // What happens and framing change on the frames as you type: no redraw.
  patch(sh) {
    for (const n of document.querySelectorAll(`.ss-side [data-shot="${CSS.escape(sh.id)}"], .ss-rows [data-shot="${CSS.escape(sh.id)}"]`)) {
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

  // A new shot: on the lines picked (between the shots around it, so one put
  // between 3 and 4 is 3A), or at the scene line.
  // ---------- pictures and text, joined by hand ----------

  // The line at a place in the text, or under a point on the screen: { a, i }.
  lineAtPos(pos) {
    for (const a of this.anchors()) { const i = a.paras.findIndex((p) => pos >= p.pos && pos < p.end); if (i >= 0) return { a, i }; }
    return null;
  }
  lineAt(x, y) {
    if (this.mode === 'off') return null;
    const at = this.editor.view.posAtCoords({ left: x, top: y });
    return at ? this.lineAtPos(at.inside >= 0 ? at.inside : at.pos) || this.lineAtPos(at.pos) : null;
  }
  // A drop on lines that were picked lands on all of them; anywhere else, on
  // the line under it (a name and its speech count as one).
  dropSpan(hit, picked) {
    if (picked && picked.eid === hit.a.eid && hit.i >= picked.from && hit.i <= picked.to) return { from: picked.from, to: picked.to };
    return snap(hit.a.paras, hit.i, hit.i);
  }
  // Lights the lines a drop would land on (only in `eid`'s scene, when given).
  showDrop(hit, eid, picked) {
    const ok = hit && (!eid || hit.a.eid === eid);
    const next = ok ? { eid: hit.a.eid, ...this.dropSpan(hit, picked) } : null;
    const same = (next && this.lines && next.eid === this.lines.eid && next.from === this.lines.from && next.to === this.lines.to) || (!next && !this.lines);
    this.dragging = this.dragging || 'files';
    if (!same) { this.lines = next; this.lit = []; this.paint(); }
    document.documentElement.classList.toggle('ss-dropping', true);
  }
  endDrop() {
    if (this.dragging === 'files') this.dragging = null;
    this.picked = undefined;
    document.documentElement.classList.remove('ss-dropping');
    if (this.lines) { this.lines = null; this.paint(); }
  }
  picsDragged(e) {
    if (this.mode === 'off' || !this.pieceId) return false;
    const items = [...(e.dataTransfer?.items || [])];
    return items.some((it) => it.kind === 'file' && /^image\//.test(it.type || '')) || (!items.length && [...(e.dataTransfer?.types || [])].includes('Files'));
  }

  // Pictures onto lines: one new shot covering them, the first picture its still.
  // The one way pictures land on lines, whatever made them.
  async picturesOnLines(a, span, files, meta = null) {
    const pics = files.filter((f) => isImage(f.type));
    if (!pics.length) { if (files.length) this.hooks.toast('Only pictures go on a frame here. Videos go in Make.'); return; }
    const sh = await this.add(a.eid, { from: span.from, to: span.to, focus: false });
    const r = await picturesOnShot(sh.id, pics, meta);
    await this.reload();
    this.showOpen(sh.id);
    const cur = this.find(sh.id);
    const code = cur ? this.codeOf(cur.sh, cur.a) : '';
    const n = cur ? linesIn(cur.a.paras, span.from, span.to) : 1;
    this.hooks.toast(`Shot ${code} on ${plural(n, 'line')}, with ${meta?.source === 'sketch' ? 'its sketch' : r.added === 1 ? 'its picture' : `${r.added} pictures`}`, { label: 'Undo', run: async () => {
      const now = await getEntry(sh.id);
      if (now) await putEntries([{ ...now, deleted: true, updated_at: Date.now() }]);
      if (this.open === sh.id) this.close();
      await this.reload();
    } });
  }

  // Where the picture comes from: straight to the only source there is
  // today, a short menu once there are more (sketch, image model).
  choosePicture(anchor, land, ctx = {}) {
    const run = async (src) => { const got = await src.pick(ctx); const files = Array.isArray(got) ? got : got?.files || []; if (files.length) land(files, got?.meta || null); };
    if (pictureSources.length === 1) { run(pictureSources[0]); return; }
    popMenu(anchor, pictureSources.map((src) => ({ label: src.label, run: () => run(src) })));
  }

  // ---------- sketches ----------

  // A sketch onto a shot: the pad, then a new try (a board frame).
  async sketchOn(id, ctx) {
    await this.flush(id);
    const got = await sketch(ctx);
    if (!got?.files?.length) return;
    const r = await picturesOnShot(id, got.files, got.meta);
    if (!r.added) return;
    await this.reload();
    const cur = this.find(id);
    const last = cur && (cur.sh.fields?.tries || []).at(-1)?.files?.at(-1);
    if (last) this.shown.set(id, last);
    this.sel = this.last = id;
    this.showOpen(id);
    this.hooks.toast(`Sketch kept on shot ${cur ? this.codeOf(cur.sh, cur.a) : ''}`, { label: 'Undo', run: async () => { await r.undo(); this.shown.delete(id); await this.reload(); if (this.open === id) this.showOpen(id); } });
  }
  // A star picks the frame: a sketch is the board frame (star.board), a
  // picture the still. Tapping the picked one again unpicks it.
  async starFrame(id, fileId) {
    await this.flush(id);
    const fresh = await getEntry(id);
    if (!fresh) return;
    const t = tryOf(fresh, fileId);
    const k = t?.kind === 'board' ? 'board' : 'still';
    const star = { ...(fresh.fields?.star || {}) };
    if (star[k] === fileId) delete star[k]; else star[k] = fileId;
    const row = { ...fresh, fields: { ...fresh.fields, star }, updated_at: Date.now() };
    delete row._by;
    await putEntries([row]);
    this.shown.set(id, fileId);
    await this.reload();
    if (this.open === id) this.showOpen(id);
  }
  async copyPrompt(sh, a) {
    const r = this.span(sh, a);
    const lines = r ? a.paras.slice(r.from, r.to + 1) : [];
    const heading = (await getEntry(a.eid))?.text || '';
    const text = await framePrompt({ style: this.world?.fields?.production?.style || '', scene: sceneName(a), heading, code: this.codeOf(sh, a), what: sh.text, framing: sh.fields?.framing || '', lines, worldId: this.world?.id || null });
    try { await navigator.clipboard.writeText(text); this.hooks.toast('Prompt copied. Paste it into Gemini or ChatGPT with the sketch (Save picture).'); } catch { this.hooks.toast('Couldn’t reach the clipboard here.'); }
    return text;
  }
  async savePicture(fileId, title) {
    const blob = await fileBlob(fileId).catch(() => null);
    if (!blob) return;
    const a = make('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\w -]+/g, '').trim() || 'frame'}.${/png/.test(blob.type) ? 'png' : 'jpg'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // "Put on lines" from the open shot (or a tap on a frame on no lines): a
  // banner says what to do, and one tap on a line puts it there.
  startPlacing(id) {
    const cur = this.find(id);
    if (!cur) return;
    if (this.open) this.close();
    this.lines = null;
    this.lit = [];
    this.sel = this.last = this.placing = id;
    this.paint();
  }
  // Off its lines, back to waiting at its scene (Undo puts it back).
  async takeOff(id) {
    await this.flush(id);
    const fresh = await getEntry(id);
    if (!fresh) return;
    const fields = { ...fresh.fields };
    delete fields.from;
    delete fields.to;
    const row = { ...fresh, fields, updated_at: Date.now() };
    delete row._by;
    await putEntries([row]);
    await this.reload();
    const cur = this.find(id);
    if (this.open === id) this.showOpen(id);
    this.hooks.toast(`Shot ${cur ? this.codeOf(cur.sh, cur.a) : ''} is off its lines and waits at its scene`, { label: 'Undo', run: async () => { const now = await getEntry(id); if (!now) return; const back = { ...now, fields: { ...now.fields, from: fresh.fields?.from, to: fresh.fields?.to }, updated_at: Date.now() }; delete back._by; await putEntries([back]); await this.reload(); if (this.open === id) this.showOpen(id); } });
  }

  // A frame dragged onto lines covers them. With a mouse it starts on a
  // small move; with a finger, after holding it still for a moment.
  dragShot(e, sh, a, node) {
    if (e.button > 0 || this.mode === 'off') return;
    const touch = e.pointerType !== 'mouse';
    const x0 = e.clientX;
    const y0 = e.clientY;
    let x = x0;
    let y = y0;
    let live = false;
    let ghost = null;
    let hit = null;
    let scroll = 0;
    const picked = this.lines;
    const move = () => {
      ghost.style.transform = `translate(${x - 30}px, ${y - 24}px)`;
      hit = this.lineAt(x, y);
      const other = hit && hit.a.eid !== a.eid;
      ghost.classList.toggle('no', !!other);
      this.showDrop(other ? null : hit, a.eid, picked);
      this.dragging = sh.id;
    };
    const begin = () => {
      live = true;
      this.dragging = sh.id;
      ghost = make('div', 'ss-ghost');
      ghost.append(this.pic(sh));
      ghost.append(make('span', 'ss-num', sh.fields?.n || ''));
      document.body.append(ghost);
      document.documentElement.classList.add('ss-dragging');
      navigator.vibrate?.(12);
      move();
      // Near the top or bottom, the page creeps along so far lines can be reached.
      scroll = setInterval(() => {
        const ruler = document.querySelector('.zm-ruler');
        const bottom = window.innerHeight - (ruler?.offsetHeight || 0);
        const d = y < 90 ? -14 : y > bottom - 70 ? 14 : 0;
        if (d) { window.scrollBy(0, d); move(); }
      }, 30);
    };
    const hold = touch ? setTimeout(begin, 380) : null;
    const done = () => {
      clearTimeout(hold);
      clearInterval(scroll);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      ghost?.remove();
      document.documentElement.classList.remove('ss-dragging', 'ss-dropping');
      this.dragging = null;
    };
    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      x = ev.clientX;
      y = ev.clientY;
      if (!live) {
        if (Math.hypot(x - x0, y - y0) < 8) return;
        if (touch) { done(); return; } // a finger that moves first is scrolling
        begin();
      }
      move();
    };
    const onUp = async (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const was = live;
      const at = hit;
      done();
      if (!was) return;
      this.dropped = Date.now();
      this.lines = null;
      if (!at) { this.paint(); return; }
      if (at.a.eid !== a.eid) { this.paint(); this.hooks.toast(`Shot ${this.codeOf(sh, a)} belongs to ${sceneName(a)}: drop it on a line there`); return; }
      this.placing = null;
      await this.moveTo(sh.id, at.a, this.dropSpan(at, picked));
    };
    const onCancel = (ev) => { if (ev.pointerId !== e.pointerId) return; const was = live; done(); if (was) { this.lines = null; this.paint(); } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  async add(eid, { what = '', framing = '', focus = true, from = null, to = null } = {}) {
    const a = this.anchors().find((x) => x.eid === eid);
    let opts = { what, framing, pieceId: this.pieceId };
    if (a && from != null && a.paras[from]) {
      const r = snap(a.paras, from, to ?? from);
      const { sort, index } = placeAmong(this.shots.get(eid) || [], a.paras, r.from);
      opts = { ...opts, place: { sort, index }, lines: { from: a.paras[r.from].id, to: a.paras[r.to].id } };
    }
    const sh = await newShot(eid, opts);
    this.lines = null;
    this.lit = [];
    await this.reload();
    this.sel = this.last = sh.id;
    this.showOpen(sh.id, focus);
    const cur = this.find(sh.id);
    if (cur && focus) this.hooks.toast(`Shot ${this.codeOf(cur.sh, cur.a)} added to ${sceneName(cur.a)}`);
    return sh;
  }
  // "Move shot 03 here": the shot now covers the picked lines.
  // It lands picked: its lines lit, the knobs on them, the bar under them.
  async moveTo(id, a, L) {
    await this.flush(id);
    const fresh = await getEntry(id);
    if (!fresh || !a.paras[L.from] || !a.paras[L.to]) return;
    const was = !!(fresh.fields?.from || fresh.fields?.to);
    const row = { ...fresh, fields: { ...fresh.fields, from: a.paras[L.from].id, to: a.paras[L.to].id }, updated_at: Date.now() };
    delete row._by;
    await putEntries([row]);
    this.lines = null;
    this.lit = [];
    this.placing = null;
    this.stretch = null;
    await this.reload();
    const cur = this.find(id);
    if (cur) {
      this.sel = this.last = id;
      this.hooks.toast(`Shot ${this.codeOf(cur.sh, cur.a)} ${was ? 'now covers' : 'is on'} ${plural(linesIn(a.paras, L.from, L.to), 'line')}. Pull a knob to change that.`, { label: 'Undo', run: async () => { const now = await getEntry(id); if (!now) return; const back = { ...now, fields: { ...now.fields, from: fresh.fields?.from || '', to: fresh.fields?.to || '' }, updated_at: Date.now() }; if (!back.fields.from) { delete back.fields.from; delete back.fields.to; } delete back._by; await putEntries([back]); await this.reload(); } });
      if (this.open === id) this.showOpen(id); else this.paint();
    }
  }
  async addPictures(id, files) {
    if (files.length === 1) return this.addPicture(id, files[0]);
    await this.flush(id);
    const r = await picturesOnShot(id, files);
    if (!r.added) { this.hooks.toast('Only pictures go on a frame here. Videos go in Make.'); return; }
    await this.reload();
    if (this.open === id) this.showOpen(id);
    this.hooks.toast(`${r.added} pictures on this shot${r.skipped ? ` (${r.skipped} left out)` : ''}`, { label: 'Undo', run: async () => { await r.undo(); await this.reload(); if (this.open === id) this.showOpen(id); } });
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
Object.assign(ScriptShots.prototype, gripMethods);

export const ShotStrips = Extension.create({
  name: 'shotStrips',
  addOptions() { return { shots: () => null }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key: KEY,
      props: { decorations: (state) => opts.shots()?.decorations(state.doc) || null },
      view: () => ({ update: (view, prev) => { if (!view.state.doc.eq(prev.doc)) opts.shots()?.docChanged(); } })
    })];
  }
});

