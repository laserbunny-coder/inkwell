// Training streak and charts on the Desk (Part 7). Quiet: one plain line for
// the streak, twelve weeks of dots, and a chart behind each goal, opened by
// tapping the goal. Text is always in the text inks; only the marks use the
// accent. Nothing here ever speaks of a missed day.

import { make } from './dom.js';
import { streakOf, streakLine, gridOf, gridCount, gridLine, cellTip, seriesOf, inWindow, chartSentence, pointSentence, niceTicks, shortStep, shortDate, daysBetween, plusDays } from './trainstats.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
};
const r1 = (n) => Math.round(n * 10) / 10;

// The streak line, the grid and its quiet line, and the key.
export function streakBlock(log, today) {
  const box = make('div', 'tr-streak');
  const line = streakLine(streakOf(log, today));
  if (line) box.append(make('p', 'tr-big', line));
  const cols = gridOf(log, today);
  const s = 16, x0 = 34, y0 = 2, W = x0 + 12 * s + 2, H = y0 + 6 * s + 18;
  const g = svg('svg', { class: 'tr-grid', role: 'img', 'aria-label': 'Training days in the last 12 weeks', width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  g.append(svg('text', { class: 'tr-ax', x: 0, y: y0 + s / 2 + 4 }, 'Mon'), svg('text', { class: 'tr-ax', x: 0, y: y0 + 5 * s + s / 2 + 4 }, 'Sat'),
    svg('text', { class: 'tr-ax', x: x0, y: H - 3 }, '12 weeks ago'), svg('text', { class: 'tr-ax', 'text-anchor': 'end', x: W - 2, y: H - 3 }, 'This week'));
  const R = { h: ['tr-h', 5.5], l: ['tr-l', 3.5], m: ['tr-m', 1.5], t: ['tr-t', 4.5] };
  cols.forEach((col, c) => col.forEach((cell, r) => {
    if (!cell.kind) return;
    const cx = x0 + c * s + s / 2, cy = y0 + r * s + s / 2;
    const grp = svg('g', { 'data-tip': cellTip(cell), 'data-kind': cell.kind, 'data-day': cell.d });
    grp.append(svg('rect', { class: 'tr-hit', x: cx - s / 2, y: cy - s / 2, width: s, height: s }), svg('circle', { class: R[cell.kind][0], cx, cy, r: R[cell.kind][1] }));
    g.append(grp);
  }));
  const def = gridLine(gridCount(cols));
  const rd = make('p', 'hint tr-rd', def);
  const tip = (e) => { const t = e.target.closest?.('[data-tip]'); rd.textContent = t ? t.dataset.tip : def; };
  g.addEventListener('pointermove', tip);
  g.addEventListener('pointerdown', tip);
  g.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') rd.textContent = def; });
  const key = make('p', 'hint tr-key');
  const dot = (cls, r) => { const k = svg('svg', { width: 12, height: 12, 'aria-hidden': 'true' }); k.append(svg('circle', { class: cls, cx: 6, cy: 6, r })); return k; };
  key.append(dot('tr-h', 5.5), ' Hard day ', dot('tr-l', 3.5), ' Light day');
  box.append(g, rd, key);
  return box;
}

// A chart behind one goal: the last twelve weeks of its numbers.
// steps: the ladder's step names; mark: where a ladder asks to move up.
export function chartBox(goal, log, today, { steps = [], mark = null, phone = false } = {}) {
  const box = make('div', 'tr-chart');
  const all = seriesOf(log, goal.k);
  if (!all.length) { box.append(make('p', 'hint tr-rd', 'Your chart starts with your first number.')); return box; }
  const pts = inWindow(all, today);
  const start = pts[0].d < plusDays(today, -83) ? pts[0].d : plusDays(today, -83);
  const span = Math.max(daysBetween(start, today), 1);
  const line = goal.lad ? mark : goal.goal;
  const lineLabel = goal.lad ? (mark != null ? `Move up at ${mark}` : '') : goal.gl;
  const W = phone ? 320 : 520, H = 150, ml = 30, mr = line != null ? 88 : 66, mt = 20, mb = 22;
  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals, line ?? 0);
  if (hi === lo) hi = lo + 1;
  lo = Math.max(0, lo - (hi - lo) * 0.2);
  if (lo < hi * 0.35) lo = 0;
  hi += (hi - lo) * 0.08;
  const X = (d) => r1(ml + (daysBetween(start, d) / span) * (W - ml - mr));
  const Y = (v) => r1(mt + (1 - (v - lo) / (hi - lo)) * (H - mt - mb));
  const c = svg('svg', { class: 'tr-svg', role: 'img', tabindex: 0, width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  for (const t of niceTicks(lo, hi)) c.append(svg('line', { class: 'tr-gr', x1: ml, x2: W - mr, y1: Y(t), y2: Y(t) }), svg('text', { class: 'tr-ax', 'text-anchor': 'end', x: ml - 6, y: Y(t) + 4 }, String(t)));
  if (line != null) c.append(svg('line', { class: 'tr-goal', x1: ml, x2: W - mr, y1: Y(line), y2: Y(line) }), svg('text', { class: 'tr-ax', x: W - mr + 6, y: Y(line) + 4 }, lineLabel));
  // A ladder breaks where he moved up: one stretch per step.
  const segs = [];
  for (const p of pts) { const g = segs.at(-1); if (!g || g.s !== p.s) segs.push({ s: p.s, p: [p] }); else g.p.push(p); }
  const last = pts.at(-1);
  segs.forEach((g, j) => {
    const old = j < segs.length - 1 ? ' old' : '';
    const x1 = j ? (X(segs[j - 1].p.at(-1).d) + X(g.p[0].d)) / 2 : ml;
    const x2 = j < segs.length - 1 ? (X(g.p.at(-1).d) + X(segs[j + 1].p[0].d)) / 2 : W - mr;
    if (j) c.append(svg('line', { class: 'tr-gr', x1, x2: x1, y1: mt - 14, y2: H - mb }));
    if (goal.lad) { const nm = shortStep(steps[g.s] || ''); if (nm && x2 - x1 >= nm.length * 6.4 + 10) c.append(svg('text', { class: 'tr-ax tr-step', x: x1 + (j ? 6 : 0), y: mt - 8 }, nm)); }
    if (g.p.length > 1) c.append(svg('polyline', { class: `tr-ln${old}`, points: g.p.map((p) => `${X(p.d)},${Y(p.v)}`).join(' ') }));
    if (pts.length <= 8 || g.p.length === 1) for (const p of g.p) if (p !== last) c.append(svg('circle', { class: `tr-pt${old}`, cx: X(p.d), cy: Y(p.v), r: 4 }));
  });
  let lx = X(last.d) + 9, ly = Y(last.v) + 4;
  if (lx > W - mr - 4) lx = W - mr + 6;
  if (line != null && Math.abs(ly - Y(line) - 4) < 13) ly = Y(line) + 4 + (last.v > line ? -14 : 14);
  const xh = svg('line', { class: 'tr-xh', y1: mt, y2: H - mb, visibility: 'hidden' });
  const hd = svg('circle', { class: 'tr-hd', r: 7, visibility: 'hidden' });
  c.append(xh, svg('circle', { class: 'tr-pt', cx: X(last.d), cy: Y(last.v), r: 4.5 }), hd,
    svg('text', { class: 'tr-val', x: lx, y: ly }, `${last.v} ${goal.u}`),
    svg('text', { class: 'tr-ax', x: ml, y: H - 5 }, start === plusDays(today, -83) ? '12 weeks ago' : shortDate(start)),
    svg('text', { class: 'tr-ax', 'text-anchor': 'end', x: W - mr, y: H - 5 }, 'Today'));
  const sum = chartSentence(goal, pts, steps);
  c.setAttribute('aria-label', `${goal.n}. ${sum}`);
  const rd = make('p', 'hint tr-rd', sum);
  let at = null;
  const show = (i) => {
    at = Math.max(0, Math.min(pts.length - 1, i));
    const p = pts[at];
    xh.setAttribute('x1', X(p.d)); xh.setAttribute('x2', X(p.d)); xh.setAttribute('visibility', 'visible');
    hd.setAttribute('cx', X(p.d)); hd.setAttribute('cy', Y(p.v)); hd.setAttribute('visibility', 'visible');
    rd.textContent = pointSentence(goal, p, steps);
  };
  const off = () => { at = null; xh.setAttribute('visibility', 'hidden'); hd.setAttribute('visibility', 'hidden'); rd.textContent = sum; };
  const near = (e) => {
    const b = c.getBoundingClientRect();
    const x = (e.clientX - b.left) * (W / b.width);
    let bi = 0;
    pts.forEach((p, i) => { if (Math.abs(X(p.d) - x) < Math.abs(X(pts[bi].d) - x)) bi = i; });
    show(bi);
  };
  c.addEventListener('pointermove', near);
  c.addEventListener('pointerdown', near);
  c.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') off(); });
  c.addEventListener('blur', off);
  c.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    show((at == null ? pts.length : at) + (e.key === 'ArrowLeft' ? -1 : 1));
  });
  const nums = make('details', 'tr-nums');
  nums.append(make('summary', '', 'The numbers'));
  const table = make('table');
  for (const p of [...pts].reverse()) {
    const tr = make('tr');
    tr.append(make('td', '', shortDate(p.d)), make('td', '', `${p.v} ${goal.u}`));
    if (goal.lad) tr.append(make('td', '', steps[p.s] || ''));
    table.append(tr);
  }
  nums.append(table);
  box.append(c, rd, nums);
  return box;
}
