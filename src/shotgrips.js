// Adding lines to a frame and taking them away (Nov 24 2026, brief
// inkwell-storyboard/build-brief-lines-grips.md). Michael, on his phone: a
// frame went on one line at a time and could only be moved, never grown or
// shrunk. Now the lit block (a picked frame's lines, or the lines picked)
// has a knob at each end joined by a band in the margin: solid for a frame,
// broken with hollow knobs for lines picked with no frame yet. Pull a knob
// (or anywhere in the margin beside the block, and a little past each end)
// to add or take away lines; − and + on the bar do the same with taps; a tap
// in the margin picks a line without the caret, a slide down it picks
// several. Nothing changes in how shots are kept: one stretch, fields.from
// and fields.to, saved through moveTo with Undo.
//
// The feel is meant to be tuned on his phone after it's live, so every
// number a finger meets is here, in one place.
export const GRIP = {
  zone: 26, // px past each end of the lit block that still takes hold of an end (touch, pen)
  move: 6, // px a finger moves before a touch is a pull, not a tap
  hold: 380, // ms a finger rests in the margin before a slide down it picks lines (a flick still scrolls)
  knob: 32, // a knob's size on a touch screen, px
  knobMouse: 16, // with a mouse (its target is bigger than it looks)
  edge: 26, // on a touch screen a knob's centre stays this far in from the screen's left edge (Android's back swipe)
  gutMax: 64, // the widest the margin strip gets beside the words, px
  creep: 70, // px from the top or bottom where a pull scrolls the page along
  creepStep: 10 // px per tick when it does
};

import { snap, lineStarts, covering, lanes } from './shotlines.js';
import { plain as make } from './dom.js';
import { sceneName } from './scenename.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// The steps a stretch grows and shrinks by: whole lines of the script (a
// name and its speech are one), as snap() makes them.
export function unitsOf(paras) {
  const s = lineStarts(paras);
  return s.length ? s.map((i) => snap(paras, i, i)) : paras.map((_, i) => ({ from: i, to: i }));
}
const unitAt = (us, i) => { let k = 0; us.forEach((u, j) => { if (u.from <= i) k = j; }); return k; };

// A stretch moved by one line at one end (end 'from' or 'to', d -1 or 1),
// kept inside the scene and never past its other end; null when it can't.
export function stepEnd(paras, L, end, d) {
  const us = unitsOf(paras);
  let u0 = unitAt(us, L.from);
  let u1 = unitAt(us, L.to);
  if (end === 'to') u1 += d; else u0 += d;
  if (u0 < 0 || u1 > us.length - 1 || u0 > u1) return null;
  return { from: us[u0].from, to: us[u1].to };
}

export const gripMethods = {
  // The lit block: the lines picked, else the picked frame's lines.
  block() {
    const anchors = this.anchors();
    if (this.lines) {
      const a = anchors.find((x) => x.eid === this.lines.eid);
      return a ? { kind: 'pick', a, from: this.lines.from, to: this.lines.to } : null;
    }
    const cur = this.sel ? this.find(this.sel) : null;
    const r = cur && this.span(cur.sh, cur.a);
    return r ? { kind: 'shot', a: cur.a, sh: cur.sh, from: r.from, to: r.to } : null;
  },
  linesNow(a, L) { return Math.max(1, unitsOf(a.paras).filter((u) => u.from >= L.from && u.from <= L.to).length); },

  // Built once: the margin strip, the band, the two knobs, the banner.
  gripsInit() {
    this.gut = make('div', 'ss-gut');
    this.zone = make('div', 'ss-zone');
    this.band = make('div', 'ss-band');
    this.knobs = { from: make('button', 'ss-knob'), to: make('button', 'ss-knob') };
    for (const k of ['from', 'to']) {
      const b = this.knobs[k];
      b.type = 'button';
      b.dataset.end = k;
      b.setAttribute('aria-label', k === 'from' ? 'First line: pull to add or take away lines' : 'Last line: pull to add or take away lines');
      b.addEventListener('pointerdown', (e) => this.gripDown(e, k));
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    }
    this.gut.append(this.zone);
    this.gut.addEventListener('pointerdown', (e) => this.gutDown(e));
    this.gut.addEventListener('contextmenu', (e) => e.preventDefault());
    this.banner = make('div', 'ss-banner');
    this.banner.hidden = true;
    this.banner.setAttribute('role', 'status');
    this.hooks.sheet.append(this.gut, this.band, this.knobs.from, this.knobs.to);
    document.body.append(this.banner);
    for (const n of [this.gut, this.band, this.knobs.from, this.knobs.to]) n.hidden = true;
  },

  // Where the strip, band and knobs go (from placeNow, sheet coordinates).
  placeGrips({ anchors, base, sheet, textL, textR, x, side }) {
    const off = this.mode === 'off';
    this.gut.hidden = off;
    this.placeBanner();
    if (off) { this.band.hidden = this.knobs.from.hidden = this.knobs.to.hidden = true; return; }
    const touch = matchMedia('(pointer: coarse)').matches;
    // The strip: with a mouse, the margin where the tramlines are. With a
    // finger, the open margin left of the words: beside, the gap between the
    // words and the shots is too thin to hit (Nov 24, beside became the only
    // way on a phone), while the knobs stay on the frame's own tramline.
    let left;
    let width;
    if (side && !touch) {
      left = textR;
      width = Math.max(14, this.layer.offsetLeft - textR);
    } else {
      left = Math.max(-sheet.left, textL - GRIP.gutMax);
      width = Math.max(14, textL - left);
    }
    Object.assign(this.gut.style, { left: `${left}px`, width: `${width}px`, height: `${this.hooks.sheet.scrollHeight}px` });
    const b = this.block();
    const geo = b ? [this.paraBox(b.a.paras[b.from], base), this.paraBox(b.a.paras[b.to], base)] : null;
    if (!b || !geo[0] || !geo[1]) { this.band.hidden = this.knobs.from.hidden = this.knobs.to.hidden = this.zone.hidden = true; return; }
    const top = geo[0].top;
    const bottom = geo[1].bottom;
    // The band sits on the frame's own tramline; picked lines take the
    // first lane free beside any frames already on them.
    const list = this.ordered(b.a);
    const lane = lanes(list, b.a.paras);
    let k;
    if (b.kind === 'shot') k = lane.get(b.sh.id) || 0;
    else {
      const over = list.filter((s) => { const r = this.span(s, b.a); return r && r.from <= b.to && r.to >= b.from; }).map((s) => lane.get(s.id) || 0);
      k = over.length ? Math.max(...over) + 1 : 0;
    }
    let bx = x(k) + 1.5;
    if (touch) bx = Math.max(bx, GRIP.edge - sheet.left);
    const size = touch ? GRIP.knob : GRIP.knobMouse;
    Object.assign(this.band.style, { left: `${bx}px`, top: `${top}px`, height: `${Math.max(4, bottom - top)}px` });
    this.band.className = `ss-band${b.kind === 'pick' ? ' pk' : ''}`;
    this.band.hidden = false;
    for (const [end, y] of [['from', top], ['to', bottom]]) {
      const n = this.knobs[end];
      n.hidden = false;
      n.className = `ss-knob${b.kind === 'pick' ? ' pk' : ''}${this.held === end ? ' live' : ''}`;
      Object.assign(n.style, { left: `${bx}px`, top: `${y}px`, width: `${size}px`, height: `${size}px` });
    }
    // Beside the block (and a little past each end) a finger takes hold of an end.
    this.zone.hidden = !touch;
    Object.assign(this.zone.style, { top: `${top - GRIP.zone}px`, height: `${bottom - top + 2 * GRIP.zone}px` });
  },

  // "Put on lines": the shot waits for one tap on its line.
  placeBanner() {
    const cur = this.placing && this.mode !== 'off' ? this.find(this.placing) : null;
    if (!cur) { this.banner.hidden = true; delete this.banner.dataset.shot; return; }
    if (this.banner.dataset.shot === cur.sh.id && !this.banner.hidden) return;
    const touch = matchMedia('(pointer: coarse)').matches;
    const n = cur.sh.fields?.n || '';
    const say = make('span', '', touch
      ? `Tap the line shot ${n} belongs to, or hold the margin and slide down it for several.`
      : `Click the line shot ${n} belongs to, or drag down the margin for several.`);
    const cancel = make('button', '', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', (e) => { e.stopPropagation(); this.placing = null; this.paint(); });
    this.banner.replaceChildren(say, cancel);
    this.banner.dataset.shot = cur.sh.id;
    this.banner.hidden = false;
  },

  // The line under a point in the margin (its scene and index).
  lineAtY(y) {
    const r = this.editor.view.dom.getBoundingClientRect();
    return this.lineAt(r.left + 12, y);
  },

  // ---------- pointers ----------

  gutDown(e) {
    if (e.button > 0 || this.mode === 'off') return;
    const hit = this.lineAtY(e.clientY);
    const b = this.block();
    const mouse = e.pointerType === 'mouse';
    e.preventDefault(); // no caret, no keyboard
    this.dropText();
    if (!mouse && b && hit && hit.a.eid === b.a.eid && !this.placing) {
      const t = this.paraBox(b.a.paras[b.from], 0);
      const z = this.paraBox(b.a.paras[b.to], 0);
      if (t && z && e.clientY > t.top - GRIP.zone && e.clientY < z.bottom + GRIP.zone) {
        this.gripDown(e, e.clientY < (t.top + z.bottom) / 2 ? 'from' : 'to', hit);
        return;
      }
    }
    if (!hit) return;
    const act = { id: e.pointerId, y0: e.clientY, x: e.clientX, hit, live: mouse, moved: false };
    this.act = act;
    if (!mouse) act.hold = setTimeout(() => { if (this.act === act && !act.gone) { act.live = true; this.dragging = 'margin'; navigator.vibrate?.(10); } }, GRIP.hold);
    const move = (ev) => {
      if (ev.pointerId !== act.id) return;
      if (!act.live) {
        // A finger that moves before the hold is scrolling the page.
        if (Math.abs(ev.clientY - act.y0) > GRIP.move) { act.gone = true; clearTimeout(act.hold); }
        return;
      }
      if (!act.moved && Math.abs(ev.clientY - act.y0) < GRIP.move) return;
      act.moved = true;
      this.dragging = 'margin';
      const at = this.lineAtY(ev.clientY);
      if (!at || at.a.eid !== act.hit.a.eid) { this.creep(ev.clientY); return; }
      const r = snap(at.a.paras, Math.min(act.hit.i, at.i), Math.max(act.hit.i, at.i));
      const L = this.lines;
      if (!L || L.eid !== at.a.eid || L.from !== r.from || L.to !== r.to) {
        this.lines = { eid: at.a.eid, from: r.from, to: r.to, margin: true };
        if (this.sel) this.last = this.sel;
        if (!this.placing) this.sel = null;
        this.lit = covering(this.shots.get(at.a.eid) || [], at.a.paras, r.from).map((s) => s.id);
        this.paint();
      }
      this.creep(ev.clientY);
    };
    const up = (ev) => {
      if (ev.pointerId !== act.id) return;
      clearTimeout(act.hold);
      this.stopCreep();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.act = null;
      this.dragging = null;
      this.dropped = Date.now();
      if (ev.type !== 'pointerup' || act.gone) { this.paint(); return; }
      if (act.moved) {
        if (this.placing && this.lines) { const L = this.lines; const cur = this.find(this.placing); this.lines = null; if (cur) this.placeOn(cur, this.anchors().find((a) => a.eid === L.eid), L); }
        else this.paint();
        return;
      }
      if (ev.shiftKey && this.stretchTo(act.hit)) return;
      this.tapMargin(act.hit, act.x);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  },

  // Taking hold of an end. The other end stays put; the held end follows
  // the pointer and may cross it, so either knob pulled either way does
  // something. On a one-line block the first move decides which end is held.
  gripDown(e, end, tap = null) {
    if (e.button > 0) return;
    const b = this.block();
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    this.dropText();
    const us = unitsOf(b.a.paras);
    const u0 = unitAt(us, b.from);
    const u1 = unitAt(us, b.to);
    const t = this.paraBox(b.a.paras[b.from], 0);
    const z = this.paraBox(b.a.paras[b.to], 0);
    if (!t || !z) return;
    const act = { id: e.pointerId, y0: e.clientY, end, off: e.clientY - (end === 'from' ? t.top : z.bottom), one: u0 === u1 ? [t.top, z.bottom] : null, moved: false, b, us, anchor: end === 'from' ? u1 : u0, was: { from: b.from, to: b.to } };
    this.act = act;
    this.held = end;
    this.dragging = 'grip';
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* gone */ }
    const mid = (j) => { const p = this.paraBox(b.a.paras[us[j].from], 0); const q = this.paraBox(b.a.paras[us[j].to], 0); return p && q ? (p.top + q.bottom) / 2 : null; };
    const move = (ev) => {
      if (ev.pointerId !== act.id) return;
      act.lastY = ev.clientY;
      if (!act.moved && Math.abs(ev.clientY - act.y0) < GRIP.move) return;
      if (!act.moved && act.one) act.off = act.y0 - act.one[ev.clientY > act.y0 ? 1 : 0];
      act.moved = true;
      this.pullTo(act, ev.clientY - act.off, mid);
      this.creep(ev.clientY, () => this.pullTo(act, act.lastY - act.off, mid));
    };
    const up = (ev) => {
      if (ev.pointerId !== act.id) return;
      this.stopCreep();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.act = null;
      this.held = null;
      this.dragging = null;
      this.dropped = Date.now();
      const now = act.now;
      if (!act.moved) { this.paint(); if (tap && ev.type === 'pointerup') this.tapMargin(tap, ev.clientX); return; }
      if (b.kind === 'shot') {
        this.stretch = null;
        if (now && (now.from !== act.was.from || now.to !== act.was.to) && ev.type === 'pointerup') this.moveTo(b.sh.id, b.a, now, { keep: true });
        else this.paint();
      } else this.paint();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  },
  pullTo(act, y, mid) {
    const { us, anchor, b } = act;
    const m = mid(anchor);
    if (m == null) return;
    let u0 = anchor;
    let u1 = anchor;
    const down = y >= m;
    if (down) { for (let j = anchor + 1; j < us.length; j += 1) { const v = mid(j); if (v == null || v >= y) break; u1 = j; } } else { for (let j = anchor - 1; j >= 0; j -= 1) { const v = mid(j); if (v == null || v <= y) break; u0 = j; } }
    const now = { from: us[u0].from, to: us[u1].to };
    const held = down ? 'to' : 'from';
    if (act.now && act.now.from === now.from && act.now.to === now.to && this.held === held) return;
    act.now = now;
    this.held = held;
    if (b.kind === 'shot') this.stretch = { id: b.sh.id, ...now };
    else { this.lines = { ...this.lines, eid: b.a.eid, ...now }; this.lit = covering(this.shots.get(b.a.eid) || [], b.a.paras, now.from).map((s) => s.id); }
    this.paint();
  },
  // Near the top or bottom of the screen a pull or slide creeps the page along.
  creep(y, again) {
    this.stopCreep();
    const ruler = document.querySelector('.zm-ruler');
    const bottom = window.innerHeight - (ruler?.offsetHeight || 0);
    const d = y < GRIP.creep ? -GRIP.creepStep : y > bottom - GRIP.creep ? GRIP.creepStep : 0;
    if (!d) return;
    this.creeping = setInterval(() => { window.scrollBy(0, d); again?.(); }, 30);
  },
  stopCreep() { clearInterval(this.creeping); this.creeping = 0; },
  // The margin takes over from the browser's own text selection.
  dropText() {
    const view = this.editor.view;
    if (view.hasFocus()) view.dom.blur();
    try { window.getSelection()?.removeAllRanges(); } catch { /* none */ }
  },

  // A tap in the margin takes what is on that line: its frame (anywhere
  // across the margin, the nearest tramline when there are several), or the
  // line itself. A tap on the lit block's own margin keeps it lit.
  tapMargin(hit, x) {
    const { a, i } = hit;
    if (this.placing) { const cur = this.find(this.placing); if (cur) this.placeOn(cur, a, snap(a.paras, i, i)); return; }
    const L = this.lines;
    if (L && L.eid === a.eid && i >= L.from && i <= L.to) return;
    const on = covering(this.shots.get(a.eid) || [], a.paras, i);
    if (!on.length) {
      const r = snap(a.paras, i, i);
      if (this.sel) this.last = this.sel;
      if (this.open) this.close();
      this.sel = null;
      this.lines = { eid: a.eid, from: r.from, to: r.to, margin: true };
      this.lit = [];
      this.paint();
      return;
    }
    let id = on[0].id;
    let best = Infinity;
    for (const t of this.marks.querySelectorAll('.ss-tram')) {
      if (!on.some((s) => s.id === t.dataset.shot)) continue;
      const r = t.getBoundingClientRect();
      const d = Math.abs(x - (r.left + r.width / 2));
      if (d < best) { best = d; id = t.dataset.shot; }
    }
    this.lines = null;
    this.lit = [];
    if (this.sel === id) { this.paint(); return; }
    this.sel = this.last = id;
    if (this.open) this.showOpen(id); else this.paint();
  },
  // Shift + click on a line: the lit block reaches it.
  stretchTo(hit) {
    const b = this.block();
    if (!b || b.a.eid !== hit.a.eid || this.placing) return false;
    const r = snap(b.a.paras, Math.min(b.from, hit.i), Math.max(b.to, hit.i));
    this.setBlock(b, r);
    return true;
  },
  // − and +, the keys and the open shot's arrows: one line at one end.
  stepBlock(end, d) {
    const b = this.block();
    if (!b) return false;
    const r = stepEnd(b.a.paras, b, end, d);
    if (!r) return false;
    this.setBlock(b, r);
    return true;
  },
  setBlock(b, r) {
    if (b.kind === 'shot') { this.moveTo(b.sh.id, b.a, r, { keep: true }); return; }
    this.lines = { ...this.lines, eid: b.a.eid, from: r.from, to: r.to };
    this.lit = covering(this.shots.get(b.a.eid) || [], b.a.paras, r.from).map((s) => s.id);
    this.paint();
  },
  // The open shot's Starts at / Ends at arrows.
  async nudge(id, end, d) {
    const cur = this.find(id);
    const r = cur && this.span(cur.sh, cur.a);
    if (!r) return;
    const next = stepEnd(cur.a.paras, r, end, d);
    if (next) await this.moveTo(id, cur.a, next, { keep: true });
  },
  // A shot put on lines (a tap, a slide, the bar): it lands picked.
  async placeOn(cur, a, L) {
    if (!a) return;
    if (a.eid !== cur.a.eid) { this.hooks.toast(`Shot ${this.codeOf(cur.sh, cur.a)} belongs to ${sceneName(cur.a)}: tap a line there`); return; }
    this.placing = null;
    this.dropText();
    await this.moveTo(cur.sh.id, a, L, { keep: true });
  },
  // Keys with a frame or lines picked (the caret not in the words):
  // Shift + Down adds the next line, Shift + Up takes the last away,
  // Alt + Shift + Up starts a line earlier, Alt + Shift + Down a line later.
  gripKey(e) {
    if (this.mode === 'off' || !e.shiftKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return false;
    if (this.editor.isFocused || e.target.closest?.('input, textarea, [contenteditable="true"]')) return false;
    if (!this.block()) return false;
    const d = e.key === 'ArrowDown' ? 1 : -1;
    e.preventDefault();
    e.stopPropagation();
    if (e.altKey) this.stepBlock('from', d); else this.stepBlock('to', d);
    return true;
  }
};

export { plural };
