// Reading streak and progress on the Desk (Part 8): the same quiet streak as
// training, seven days a week, and where he is in each of the four tracks.
// Text in the text inks; only the marks use the accent. Nothing here ever
// speaks of a missed day.

import { make } from './dom.js';
import { streakLine } from './trainstats.js';
import { readStreak, readGrid, readCount, readGridLine, readTip } from './readstats.js';
import { trackRows } from './firstlight.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
};

// st: First light's reading state. toggle(day): a past-week day tapped.
export function readBlock(st, today, { streak = true, progress = true, toggle = null } = {}) {
  const box = make('div', 'rd-block');
  if (streak) {
    const wrap = make('div', 'rd-streak');
    const line = streakLine(readStreak(st.days, today));
    if (line) wrap.append(make('p', 'tr-big', line));
    const cols = readGrid(st.days, today);
    const s = 16, x0 = 34, y0 = 2, W = x0 + 12 * s + 2, H = y0 + 7 * s + 18;
    const g = svg('svg', { class: 'tr-grid rd-grid', role: 'img', 'aria-label': 'Days you read in the last 12 weeks', width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    g.append(svg('text', { class: 'tr-ax', x: 0, y: y0 + s / 2 + 4 }, 'Mon'), svg('text', { class: 'tr-ax', x: 0, y: y0 + 6 * s + s / 2 + 4 }, 'Sun'),
      svg('text', { class: 'tr-ax', x: x0, y: H - 3 }, '12 weeks ago'), svg('text', { class: 'tr-ax', 'text-anchor': 'end', x: W - 2, y: H - 3 }, 'This week'));
    const R = { r: ['tr-h', 4.5], m: ['tr-m', 1.5], t: ['tr-t', 4.5] };
    cols.forEach((col, c) => col.forEach((cell, r) => {
      if (!cell.kind) return;
      const cx = x0 + c * s + s / 2, cy = y0 + r * s + s / 2;
      const grp = svg('g', { 'data-tip': readTip(cell), 'data-kind': cell.kind, 'data-day': cell.d });
      if (cell.tap && toggle) { grp.setAttribute('class', 'rd-tap'); grp.setAttribute('role', 'button'); grp.setAttribute('tabindex', '0'); grp.setAttribute('aria-label', readTip(cell)); }
      grp.append(svg('rect', { class: 'tr-hit', x: cx - s / 2, y: cy - s / 2, width: s, height: s }), svg('circle', { class: R[cell.kind][0], cx, cy, r: R[cell.kind][1] }));
      g.append(grp);
    }));
    const def = readGridLine(readCount(cols));
    const rd = make('p', 'hint tr-rd', def);
    const tip = (e) => { const t = e.target.closest?.('[data-tip]'); rd.textContent = t ? t.dataset.tip : def; };
    g.addEventListener('pointermove', tip);
    g.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') rd.textContent = def; });
    const hit = (e) => { const t = e.target.closest?.('.rd-tap'); if (t && toggle) { e.preventDefault(); toggle(t.dataset.day); } };
    g.addEventListener('click', hit);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') hit(e); });
    g.addEventListener('pointerdown', tip);
    wrap.append(g, rd);
    box.append(wrap);
  }
  if (progress) {
    const list = make('div', 'rd-tracks');
    for (const t of trackRows(st)) {
      const row = make('div', 'rd-track');
      row.dataset.track = t.k;
      const line = make('div', 'rd-line');
      line.append(make('span', 'rd-t', t.name), make('span', 'rd-g', t.words));
      const meter = make('div', 'rd-meter');
      meter.setAttribute('role', 'img');
      meter.setAttribute('aria-label', `${t.name}: chapter ${t.pos + 1} of ${t.total}`);
      meter.title = `Chapter ${t.pos + 1} of ${t.total}`;
      const fill = make('i');
      fill.style.width = `${((t.pos / t.total) * 100).toFixed(1)}%`;
      meter.append(fill);
      row.append(line, meter);
      list.append(row);
    }
    box.append(list);
  }
  return box;
}
