// Month: the zoom's four weeks (Part 3, Nov 2026). Four weeks from this one,
// each a row: its name and dates (into the week), what it is for (its dates
// to hit and its "any day" lines, written out), and its seven days as dots
// (a dot a line; a day goes into that day). Under the weeks, "Sometime this
// month" and the months after, with their loose lines. Every row takes a
// dropped line, and a line is dragged, picked or opened as anywhere else.
// No new data: day, span week and span month, as Plan writes them.
import { make } from './dom.js';
import { media } from './device.js';
import { addDays, dateOf, isoOf, isRepeat, spanOf, weekOf } from './tasks.js';
import { zoomTo } from './nowpage.js';

const hover = media('mouse');
const ym = (iso) => String(iso || '').slice(0, 7);
const long = (iso, o) => dateOf(iso).toLocaleDateString('en-US', o);
const md = (iso) => long(iso, { month: 'short', day: 'numeric' });
const clip = (t, n = 60) => { const s = String(t || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled'; return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

export function monthModel(items, start, today = isoOf()) {
  const mon0 = weekOf(today)[0];
  const weeks = [0, 1, 2, 3].map((n) => addDays(start, n * 7));
  const end = addDays(start, 27);
  const mine = items.filter((i) => i.mine && !i.ghost);
  const open = (i) => !i.row.fields?.done;
  const rows = weeks.map((w) => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((k) => {
      const iso = addDays(w, k);
      const on = mine.filter((i) => (open(i) ? i.task.day === iso || (iso === today && i.task.day && i.task.day < today && !isRepeat(i.task)) : String(i.task.done_at ? isoOf(i.task.done_at) : '') === iso && i.task.day));
      return { iso, lines: on.filter((i) => !i.task.mark).map((i) => ({ id: i.row.id, done: !open(i) })) };
    });
    const marks = mine.filter((i) => open(i) && i.task.day && i.task.mark && i.task.day >= w && i.task.day <= addDays(w, 6)).sort((a, b) => (a.task.day < b.task.day ? -1 : 1));
    const loose = mine.filter((i) => {
      const s = open(i) && spanOf(i.task);
      if (!s || s.kind !== 'week') return false;
      const sw = s.start && s.start > mon0 ? s.start : mon0;
      return sw === w;
    });
    return { w, days, marks, loose };
  });
  const months = [...new Set([ym(start < today ? today : start), ym(end)])];
  const monthRows = months.map((m) => ({
    m,
    lines: mine.filter((i) => {
      const s = open(i) && spanOf(i.task);
      if (!s || s.kind !== 'month') return false;
      const sm = s.start && ym(s.start) > ym(today) ? ym(s.start) : ym(today);
      return sm === m;
    })
  }));
  return { weeks: rows, months: monthRows, start, end };
}

const weekName = (w, today) => {
  const mon0 = weekOf(today)[0];
  if (w === mon0) return 'This week';
  if (w === addDays(mon0, 7)) return 'Next week';
  return `Week of ${md(w)}`;
};
const monthWord = (m, today) => (m === ym(today) ? 'Sometime this month' : `Sometime in ${long(`${m}-15`, m.slice(0, 4) === today.slice(0, 4) ? { month: 'long' } : { month: 'long', year: 'numeric' })}`);

function lineEl(plan, i, { date = null } = {}) {
  const b = make('button', `mo-line${i.task.mark ? ' mark' : ''}${i.task.mark === 'hard' ? ' hard' : ''}`);
  b.type = 'button';
  b.dataset.task = i.row.id;
  b.dataset.move = '1';
  if (hover.matches) b.draggable = true;
  if (date) b.append(make('span', 'mo-date', date));
  b.append(make('span', 'mo-tx', clip(i.row.text)));
  b.title = 'Open it (right-click to pick it and move it)';
  b.addEventListener('click', () => plan.openLine(i.row.id));
  return b;
}

// plan: the Plan whose sheet this draws into.
export function drawMonth(plan) {
  const today = plan.today;
  const start = weekOf(plan.week || today)[0];
  const { weeks, months, end } = monthModel(plan.items || [], start, today);
  const byId = new Map((plan.items || []).map((i) => [i.row.id, i]));
  const head = make('header', 'pl-top');
  const left = make('div');
  const eye = make('div', 'pl-eyebrow');
  const yr = make('button', 'ah-year', 'the year');
  yr.type = 'button';
  yr.title = 'Out to the year (press 1 again, or minus)';
  yr.addEventListener('click', () => zoomTo({ place: { view: 'plan', tab: 'year' }, way: 'out' }));
  eye.append(`${md(start)} to ${md(end)} · `, yr);
  left.append(eye, make('h1', '', 'Four weeks'));
  const nav = make('div', 'pl-nav');
  const mon0 = weekOf(today)[0];
  const step = (n) => { const s = addDays(start, n * 28); return zoomTo({ place: { view: 'plan', tab: 'ahead', ...(s === mon0 ? {} : { week: s }) }, way: n < 0 ? 'prev' : 'next' }); };
  const btn = (label, aria, run, hide = false) => { const b = make('button', 'ghost-btn', label); b.type = 'button'; b.setAttribute('aria-label', aria); b.addEventListener('click', run); b.hidden = hide; return b; };
  nav.append(btn('‹', 'The four weeks before (Shift + Left)', () => step(-1), start <= mon0), btn('From this week', 'Back to the four weeks from this one', () => zoomTo({ place: { view: 'plan', tab: 'ahead' }, way: 'prev' }), start === mon0), btn('›', 'The four weeks after (Shift + Right)', () => step(1)));
  const side = make('div', 'pl-side');
  side.append(nav, ...[plan.pullButton?.()].filter(Boolean));
  head.append(left, side);

  const box = make('div', 'mo-weeks');
  for (const wk of weeks) {
    const sec = make('section', `mo-week${wk.w === mon0 ? ' now' : ''}`);
    sec.dataset.drop = `week:${wk.w}`;
    const h = make('button', 'mo-wh');
    h.type = 'button';
    h.title = 'Into this week';
    h.append(make('b', '', weekName(wk.w, today)), make('span', '', `${md(wk.w)} to ${long(addDays(wk.w, 6), ym(wk.w) === ym(addDays(wk.w, 6)) ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`));
    h.addEventListener('click', () => zoomTo({ place: { view: 'plan', tab: 'week', ...(wk.w === mon0 ? {} : { week: wk.w }) }, way: 'in' }));
    const list = make('div', 'mo-lines');
    for (const i of wk.marks) list.append(lineEl(plan, i, { date: md(i.task.day) }));
    for (const i of wk.loose) list.append(lineEl(plan, i));
    if (!list.childElementCount) list.append(make('span', 'mo-none', hover.matches ? 'Nothing for any day yet' : ''));
    const dots = make('div', 'mo-days');
    for (const d of wk.days) {
      const c = make('button', `mo-day${d.iso === today ? ' today' : ''}${d.iso < today ? ' past' : ''}`);
      c.type = 'button';
      c.dataset.drop = `day:${d.iso}`;
      c.title = `${long(d.iso, { weekday: 'long', month: 'short', day: 'numeric' })}${d.lines.length ? `: ${d.lines.map((x) => clip(byId.get(x.id)?.row.text, 30)).join(', ')}` : ''}`;
      c.setAttribute('aria-label', `${long(d.iso, { weekday: 'long', month: 'long', day: 'numeric' })}, ${d.lines.filter((x) => !x.done).length} open`);
      const dd = make('span', 'mo-dots');
      for (const x of d.lines.slice(0, 8)) dd.append(make('i', x.done ? 'on' : ''));
      if (d.lines.length > 8) dd.append(make('em', '', `+${d.lines.length - 8}`));
      c.append(make('em', 'mo-dn', `${long(d.iso, { weekday: 'narrow' })} ${dateOf(d.iso).getDate()}`), dd);
      c.addEventListener('click', () => plan.intoDay(d.iso));
      dots.append(c);
    }
    sec.append(h, list, dots);
    box.append(sec);
  }
  const loose = make('div', 'mo-months');
  for (const mr of months) {
    const sec = make('section', 'mo-month');
    sec.dataset.drop = `month:${mr.m}`;
    sec.append(make('h2', 'pl-label', monthWord(mr.m, today)));
    const list = make('div', 'mo-lines');
    for (const i of mr.lines) list.append(lineEl(plan, i));
    if (!mr.lines.length) list.append(make('span', 'mo-none', hover.matches ? 'Drop a line here for sometime that month' : 'Nothing yet'));
    sec.append(list);
    loose.append(sec);
  }
  plan.sheet.replaceChildren(head, box, loose);
  plan.just = null;
}
