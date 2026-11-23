// A sketch pad for a storyboard frame: a few seconds of drawing, with a pen's
// pressure when there is one (Michael's S Pen) and an even line for a finger
// or a mouse (Elle). Lifted from the storyboard playground, whose feel he
// judged right (Nov 23 2026), so the curves in brush() stay as they are.
//
// openSketchPad({ title, under, strokes }) resolves { blob, strokes } when the
// pad closes with something drawn (Done, ×, Escape: a sketch is never lost),
// or null when nothing was drawn. `under` is a picture shown faintly beneath
// (Draw over it); `strokes` reopens an earlier sketch to keep drawing.
import { plain as make } from './dom.js';
import './sketchpad.css';

export const PW = 1600;
export const PH = 900;
const PAPER = '#FBFAF6';
const TOOLS = { pencil: 'Pencil', ink: 'Ink', tone: 'Tone', erase: 'Eraser' };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const KEPT = 'sketchPad';

// One brush per tool. Pressure sets the weight; pencil also gets darker with
// it. Pencil and tone only ever darken the paper, so tone slides under lines.
function brush(x, tool, size, p) {
  if (tool === 'erase') { x.globalCompositeOperation = 'destination-out'; x.strokeStyle = '#000'; x.lineWidth = size * (16 + 44 * p); }
  else if (tool === 'tone') { x.globalCompositeOperation = 'darken'; x.strokeStyle = '#BEBAB1'; x.lineWidth = size * (26 + 34 * p); }
  else if (tool === 'ink') { x.globalCompositeOperation = 'source-over'; x.strokeStyle = '#1B1A18'; x.lineWidth = size * (1.2 + 10 * Math.pow(p, 1.3)); }
  else { const g = Math.round(208 - 165 * Math.pow(p, 0.8)); x.globalCompositeOperation = 'darken'; x.strokeStyle = `rgb(${g},${g - 2},${g - 6})`; x.lineWidth = size * (1.3 + 2.8 * p); }
}
// Draws a stroke from point `from` on (only the new part while drawing).
export function drawStroke(x, s, from = 0, end = false) {
  const P = s.pts;
  const n = P.length;
  if (!n) return;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  if (from === 0) { brush(x, s.tool, s.size, P[0][2]); x.beginPath(); x.moveTo(P[0][0], P[0][1]); x.lineTo(P[0][0] + 0.01, P[0][1]); x.stroke(); }
  for (let i = Math.max(1, from); i < n; i += 1) {
    const a = P[i - 1];
    const b = P[i];
    brush(x, s.tool, s.size, (a[2] + b[2]) / 2);
    x.beginPath();
    if (i === 1) { x.moveTo(a[0], a[1]); x.lineTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    else { const z = P[i - 2]; x.moveTo((z[0] + a[0]) / 2, (z[1] + a[1]) / 2); x.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    x.stroke();
  }
  if (end && n > 1) { const a = P[n - 2]; const b = P[n - 1]; brush(x, s.tool, s.size, b[2]); x.beginPath(); x.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); x.lineTo(b[0], b[1]); x.stroke(); }
  x.globalCompositeOperation = 'source-over';
}

// The sketch as a picture on paper.
export function sketchPicture(strokes) {
  const ink = document.createElement('canvas');
  ink.width = PW;
  ink.height = PH;
  const ix = ink.getContext('2d');
  for (const s of strokes) drawStroke(ix, s, 0, true);
  const c = document.createElement('canvas');
  c.width = PW;
  c.height = PH;
  const x = c.getContext('2d');
  x.fillStyle = PAPER;
  x.fillRect(0, 0, PW, PH);
  x.drawImage(ink, 0, 0);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

function kept() { try { return JSON.parse(localStorage.getItem(KEPT) || '{}'); } catch { return {}; } }
function keep(v) { try { localStorage.setItem(KEPT, JSON.stringify({ ...kept(), ...v })); } catch { /* private window */ } }

let current = null;
export const padOpen = () => !!current;

export function openSketchPad({ title = 'Sketch', under = null, strokes = null } = {}) {
  current?.close(false);
  return new Promise((resolve) => {
    const k = kept();
    const pad = {
      strokes: (strokes || []).map((s) => ({ ...s, pts: s.pts.slice() })),
      redo: [], tool: TOOLS[k.tool] ? k.tool : 'pencil', size: Number(k.size) || 1,
      cur: null, pen: false, view: { s: 1, x: 0, y: 0 }, touch: new Map(), gest: null, wait: false
    };
    const el = make('div', 'sk-pad');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Sketch pad');
    // A finger or pen acts on lifting, so a tap right after drawing is
    // never lost; the click that may follow is then let go.
    const btn = (cls, label, run, name) => {
      const b = make('button', cls, label);
      b.type = 'button';
      if (name) b.setAttribute('aria-label', name);
      let lifted = 0;
      b.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') return; lifted = Date.now(); run(); });
      b.addEventListener('click', (e) => { e.preventDefault(); if (Date.now() - lifted < 700) return; run(); });
      return b;
    };

    const top = make('div', 'sk-top');
    const stat = make('span', 'sk-stat', 'A pen adds pressure');
    top.append(make('p', 'sk-title', title), stat, btn('sk-x', '×', () => close(true), 'Close the pad (the sketch is kept)'));
    const mid = make('div', 'sk-mid');
    const sheet = make('div', 'sk-sheet');
    const cv = make('canvas');
    cv.width = PW;
    cv.height = PH;
    cv.setAttribute('aria-label', 'Drawing');
    let underEl = null;
    if (under) { underEl = make('img', 'sk-under'); underEl.src = under; underEl.alt = ''; sheet.append(underEl); }
    sheet.append(cv);
    mid.append(sheet);

    const tools = make('div', 'sk-tools');
    const toolBtns = {};
    const mark = () => { for (const t in toolBtns) toolBtns[t].setAttribute('aria-pressed', String(pad.tool === t)); };
    const setTool = (t) => { pad.tool = t; keep({ tool: t }); mark(); };
    const keys = { pencil: '1', ink: '2', tone: '3', erase: '4' };
    for (const t in TOOLS) { toolBtns[t] = btn('sk-btn', TOOLS[t], () => setTool(t)); toolBtns[t].title = `${TOOLS[t]} (${keys[t]})`; tools.append(toolBtns[t]); }
    mark();
    const sizeL = make('label', 'sk-size', 'Size');
    const size = make('input');
    size.type = 'range';
    size.min = '0.4';
    size.max = '3';
    size.step = '0.1';
    size.value = String(pad.size);
    size.title = 'Size ([ and ])';
    size.addEventListener('input', () => { pad.size = Number(size.value); keep({ size: pad.size }); });
    const bump = (d) => { pad.size = clamp(Math.round((pad.size + d) * 10) / 10, 0.4, 3); size.value = String(pad.size); keep({ size: pad.size }); };
    sizeL.append(size);
    const fitBtn = btn('sk-btn', 'Fit', () => { pad.view = { s: 1, x: 0, y: 0 }; view(); });
    fitBtn.hidden = true;
    const undoB = btn('sk-btn', 'Undo', () => undo());
    undoB.title = 'Undo (Ctrl + Z, or tap with two fingers)';
    const redoB = btn('sk-btn', 'Redo', () => redo());
    redoB.title = 'Redo (Ctrl + Y)';
    tools.append(sizeL, undoB, redoB, btn('sk-btn', 'Clear', () => { if (pad.strokes.length) { pad.redo = []; pad.strokes = []; redraw(); } }), fitBtn);
    if (underEl) {
      const u = btn('sk-btn', 'Under', () => { underEl.hidden = !underEl.hidden; u.setAttribute('aria-pressed', String(!underEl.hidden)); });
      u.setAttribute('aria-pressed', 'true');
      u.title = 'Show or hide the frame you’re drawing over';
      tools.append(u);
    }
    tools.append(make('span', 'sk-sp'));
    tools.append(btn('sk-btn', 'Save picture', async () => {
      if (!drawn()) return;
      const blob = await sketchPicture(pad.strokes);
      const a = make('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${title.replace(/[^\w -]+/g, '').trim() || 'sketch'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }));
    const doneB = btn('sk-btn go', 'Done', () => close(true));
    doneB.title = 'Done: the sketch goes on the shot (Escape does the same)';
    tools.append(doneB);
    el.append(top, mid, tools);
    document.body.append(el);
    document.documentElement.classList.add('sk-open');
    const x = cv.getContext('2d', { desynchronized: true });

    const drawn = () => pad.strokes.some((s) => s.tool !== 'erase');
    const redraw = () => { x.clearRect(0, 0, PW, PH); for (const s of pad.strokes) drawStroke(x, s, 0, true); };
    const undo = () => { if (pad.strokes.length && !pad.cur) { pad.redo.push(pad.strokes.pop()); redraw(); } };
    const redo = () => { if (pad.redo.length && !pad.cur) { pad.strokes.push(pad.redo.pop()); redraw(); } };

    // The sheet is fitted by hand so two fingers can zoom and move it.
    const base = { x: 0, y: 0, w: 0 };
    const view = () => { const v = pad.view; sheet.style.transform = `translate(${base.x + v.x}px, ${base.y + v.y}px) scale(${v.s})`; fitBtn.hidden = v.s === 1; };
    const fit = () => { const W = mid.clientWidth; const H = mid.clientHeight; const w = Math.min(W, (H * 16) / 9); base.w = w; base.x = (W - w) / 2; base.y = (H - (w * 9) / 16) / 2; sheet.style.width = `${w}px`; sheet.style.height = `${(w * 9) / 16}px`; view(); };
    const origin = () => { const r = mid.getBoundingClientRect(); return { x: r.left + base.x, y: r.top + base.y }; };
    const zoomAt = (cx, cy, s, v0 = pad.view, anchor = { x: cx, y: cy }) => {
      const O = origin();
      const qx = (anchor.x - O.x - v0.x) / v0.s;
      const qy = (anchor.y - O.y - v0.y) / v0.s;
      pad.view = s <= 1 ? { s: 1, x: 0, y: 0 } : { s, x: cx - O.x - qx * s, y: cy - O.y - qy * s };
      view();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(mid);
    fit();
    redraw();

    const pt = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) * PW) / r.width, ((e.clientY - r.top) * PH) / r.height, e.pointerType === 'pen' ? clamp(e.pressure, 0.02, 1) : 0.5]; };
    let said = '';
    const say = (t) => { if (t !== said) { said = t; stat.textContent = t; } };
    const two = () => { const [a, b] = [...pad.touch.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };
    const endStroke = () => { if (!pad.cur) return; drawStroke(x, pad.cur, pad.cur.pts.length, true); pad.cur = null; };

    mid.addEventListener('pointerdown', (e) => {
      if (e.target !== cv && e.pointerType !== 'touch') return;
      e.preventDefault();
      if (e.pointerType === 'pen') pad.pen = true;
      if (e.pointerType === 'touch') {
        pad.touch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pad.touch.size === 2) {
          // A second finger: drop the line the first one started and zoom instead.
          if (pad.cur && pad.cur.touch) { pad.strokes.pop(); pad.cur = null; redraw(); }
          pad.gest = { ...two(), v0: { ...pad.view }, t: performance.now(), moved: false };
          return;
        }
        if (pad.pen || pad.wait || pad.gest || e.target !== cv) return; // a resting palm never draws once a pen is in use
      }
      if (pad.cur) return;
      try { cv.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
      // The S Pen's button held: the eraser while it's held.
      const erase = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) || (e.buttons & 2));
      pad.cur = { id: e.pointerId, touch: e.pointerType === 'touch', tool: erase ? 'erase' : pad.tool, size: pad.size, pts: [pt(e)] };
      pad.strokes.push(pad.cur);
      pad.redo = [];
      drawStroke(x, pad.cur);
    });
    mid.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'pen') { pad.pen = true; say(e.pressure > 0 ? `Pen pressure ${String(Math.round(e.pressure * 100)).padStart(3, ' ')}%` : 'Pen ready'); }
      if (e.pointerType === 'touch' && pad.touch.has(e.pointerId)) {
        pad.touch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pad.gest && pad.touch.size >= 2) {
          const g = pad.gest;
          const n = two();
          if (Math.abs(n.d - g.d) > 12 || Math.hypot(n.m.x - g.m.x, n.m.y - g.m.y) > 12) g.moved = true;
          if (g.moved) zoomAt(n.m.x, n.m.y, clamp((g.v0.s * n.d) / g.d, 1, 8), g.v0, g.m);
          return;
        }
      }
      if (!pad.cur || e.pointerId !== pad.cur.id) return;
      const more = e.getCoalescedEvents?.() || [];
      const from = pad.cur.pts.length;
      for (const c of more.length ? more : [e]) pad.cur.pts.push(pt(c));
      drawStroke(x, pad.cur, from);
    });
    const up = (e) => {
      if (e.pointerType === 'touch') {
        pad.touch.delete(e.pointerId);
        if (pad.gest) {
          const g = pad.gest;
          pad.gest = null;
          pad.wait = pad.touch.size > 0;
          if (!g.moved && performance.now() - g.t < 350) undo(); // a two-finger tap
          return;
        }
        if (!pad.touch.size) pad.wait = false;
      }
      if (pad.cur && e.pointerId === pad.cur.id) endStroke();
      if (e.pointerType === 'pen') say('Pen ready');
    };
    mid.addEventListener('pointerup', up);
    mid.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    mid.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, clamp(pad.view.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 8)); }, { passive: false });

    const onKey = (e) => {
      if (e.target === size) return;
      const ctrl = e.ctrlKey || e.metaKey;
      let used = true;
      if (e.key === 'Escape') close(true);
      else if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) undo();
      else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) redo();
      else if (!ctrl && !e.altKey && ['1', '2', '3', '4'].includes(e.key)) setTool(Object.keys(TOOLS)[Number(e.key) - 1]);
      else if (!ctrl && e.key === '[') bump(-0.2);
      else if (!ctrl && e.key === ']') bump(0.2);
      else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', onKey, true);

    async function close(keepIt) {
      if (current !== handle) return;
      current = null;
      ro.disconnect();
      document.removeEventListener('keydown', onKey, true);
      endStroke();
      const out = keepIt && drawn() ? { blob: await sketchPicture(pad.strokes), strokes: pad.strokes.map(({ tool, size: sz, pts }) => ({ tool, size: sz, pts: pts.map((p) => p.map((v) => Math.round(v * 100) / 100)) })) } : null;
      el.remove();
      document.documentElement.classList.remove('sk-open');
      resolve(out);
    }
    const handle = { close };
    current = handle;
    window.__sketchPad = { pad, cv, undo, close };
    doneB.focus({ preventScroll: true });
  });
}
