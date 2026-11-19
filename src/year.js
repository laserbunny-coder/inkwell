// Year: the zoom's furthest stop on the time side (Nov 2026, Part 1). Twelve
// months from this one, each with how many lines are planned in it and its
// lines (the dated ones first), then "Sometime this year" (a task's span
// 'later'), with Not planned beside it. No new data: the same tasks Plan and
// Calendar show, seen from further away. A month opens its first week; a line
// opens where it is written.
import { make } from './dom.js';
import { addDays, dateOf, isoOf, isRepeat, spanOf, weekOf } from './tasks.js';
import { media } from './device.js';

const hover = media('mouse');

const long = (iso, opts) => dateOf(iso).toLocaleDateString('en-US', opts);
const ym = (iso) => String(iso || '').slice(0, 7);
const clip = (t, n = 60) => { const s = String(t || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled'; return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// The twelve months from today's, as { ym, first, label, n, days: [lines on a day], loose: [sometime that month], weeks: n }.
export function yearModel(items, today = isoOf()) {
  const start = dateOf(`${ym(today)}-01`);
  const months = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(start.getFullYear(), start.getMonth() + m, 1);
    const first = isoOf(d);
    months.push({ ym: ym(first), first, label: long(first, { month: 'long' }), year: d.getFullYear(), n: 0, loose: [], days: [], weeks: 0 });
  }
  const byYm = new Map(months.map((m) => [m.ym, m]));
  const later = [];
  let loose = 0;
  for (const i of items) {
    if (!i.mine || i.row.fields?.done || i.ghost) continue;
    const t = i.task;
    if (isRepeat(t) || t.habit) continue;
    const sp = spanOf(t);
    if (t.day) {
      // A day gone by counts in this month: it's still to do.
      const m = byYm.get(t.day < today ? ym(today) : ym(t.day));
      if (!m) continue;
      m.n += 1;
      m.days.push(i);
    } else if (sp && sp.kind === 'month') {
      // Sometime in a month: written out in its month (Part 3).
      const m = byYm.get(ym(!sp.start || sp.start < today ? today : sp.start));
      if (m) m.loose.push(i);
    } else if (sp && sp.kind === 'week') {
      const m = byYm.get(ym(!sp.start || sp.start < today ? today : addDays(sp.start, 3)));
      if (m) { m.n += 1; m.weeks += 1; }
    } else if (sp?.kind === 'later') later.push(i);
    else loose += 1;
  }
  for (const m of months) {
    m.days.sort((a, b) => (a.task.day < b.task.day ? -1 : a.task.day > b.task.day ? 1 : (a.task.order || 0) - (b.task.order || 0)));
  }
  return { months, later, loose };
}

// plan: the Plan (plan.js) whose sheet this draws into.
export function drawYear(plan) {
  const today = plan.today;
  const { months, later } = yearModel(plan.items, today);
  const sheet = plan.sheet;
  const head = make('header', 'pl-top');
  const left = make('div');
  const last = months[11];
  left.append(make('div', 'pl-eyebrow', `${months[0].label} ${months[0].year} to ${last.label} ${last.year}`), make('h1', '', 'Year'));
  head.append(left);

  const grid = make('div', 'yr-months');
  for (const m of months) {
    const box = make('section', `yr-month${m.ym === ym(today) ? ' yr-now' : ''}`);
    box.dataset.month = m.ym;
    box.dataset.drop = `month:${m.ym}`;
    const name = make('button', 'yr-name', m.year !== months[0].year && m.ym.endsWith('-01') ? `${m.label} ${m.year}` : m.label);
    name.type = 'button';
    name.title = `Into ${m.label}: its four weeks`;
    name.addEventListener('click', () => {
      // The month's first whole week (the one it starts in, if it starts on a Monday).
      const w0 = weekOf(m.first)[0];
      const week = m.ym === ym(today) ? null : w0 < m.first ? addDays(w0, 7) : w0;
      plan.hooks.go({ view: 'plan', tab: 'ahead', ...(week ? { week } : {}) });
    });
    box.append(name);
    // Every line in the month, each one to drag (or hold on a phone) to
    // another month, to Sometime this year or to Not planned: the ones on a
    // day with their date, then the ones for sometime that month. Past six,
    // the rest wait behind “N more”.
    const rows = [...m.days.map((i) => lineButton(plan, i, 'yr-line in', i.task.day < today ? today : i.task.day)), ...m.loose.map((i) => lineButton(plan, i, 'yr-line in'))];
    const open = plan.yrOpen?.has(m.ym);
    for (const r of open ? rows : rows.slice(0, 6)) box.append(r);
    if (rows.length > 6) {
      const more = make('button', 'yr-more', open ? 'Fewer' : `${rows.length - 6} more`);
      more.type = 'button';
      more.addEventListener('click', () => { plan.yrOpen = plan.yrOpen || new Set(); if (open) plan.yrOpen.delete(m.ym); else plan.yrOpen.add(m.ym); drawYear(plan); });
      box.append(more);
    }
    if (m.weeks) box.append(make('span', 'yr-n', `${m.weeks} for some day in a week`));
    if (!rows.length && !m.weeks) box.append(make('span', 'yr-n', 'Nothing yet'));
    grid.append(box);
  }

  const some = make('section', 'yr-later');
  some.append(make('div', 'pl-eyebrow', 'Sometime this year'));
  if (!later.length) some.append(make('p', 'hint', 'Nothing yet. Alt + W on a line, then Later, puts it here.'));
  some.dataset.drop = 'year';
  for (const i of later) some.append(lineButton(plan, i, 'yr-line'));
  // Not planned beside the year (under it on a phone), to drag from.
  const main = make('div', 'pw-main');
  main.append(grid, some);
  const wrap = make('div', 'pw-wrap yr-wrap');
  wrap.append(main, plan.weekShelf());
  sheet.replaceChildren(head, wrap);
  plan.just = null;
}

// A line on the Year: opens where it is; dragged, or picked (right-click) and moved.
function lineButton(plan, i, cls, day = null) {
  const b = make('button', `${cls}${i.task.mark ? ' mark' : ''}${i.task.mark === 'hard' ? ' hard' : ''}`);
  if (day) b.append(make('span', 'yr-day', long(day, { month: 'short', day: 'numeric' })));
  b.append(make('span', 'yr-text', clip(i.row.text)));
  b.type = 'button';
  b.dataset.task = i.row.id;
  b.dataset.move = '1';
  if (hover.matches) b.draggable = true;
  b.title = 'Open it where it’s written';
  b.addEventListener('click', () => plan.openLine(i));
  return b;
}
