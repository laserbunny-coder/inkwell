import { allEntries, putEntries } from './db.js';
import { entry, wordCount } from './model.js';
import { scriptLines, LINES_PER_PAGE } from './script.js';

// Progress over time. Once a day (and whenever you write) the app notes what
// each novel, screenplay and the notes come to, in one small synced entry per
// day ("tally-YYYY-MM-DD"). What you wrote on a day is that day's total minus
// the one before. Days from before tallies began are estimated from when each
// paragraph or line was first written.

const pad = (n) => String(n).padStart(2, '0');
export const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dateOf = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (day, n) => { const d = dateOf(day); d.setDate(d.getDate() + n); return dayOf(d.getTime()); };
const MANUSCRIPT = ['novel', 'screenplay'];

// What everything comes to now, plus each piece of writing with the day it was started.
export function measure(rows) {
  const live = new Map(rows.filter((r) => !r.deleted).map((r) => [r.id, r]));
  const bookCache = new Map();
  const bookOf = (r) => {
    const seen = [];
    let p = r;
    for (let i = 0; p && i < 60; i++) {
      if (bookCache.has(p.id)) { p = bookCache.get(p.id); break; }
      seen.push(p.id);
      if (p.kind === 'project' || p.kind === 'day') break;
      p = live.get(p.parent_id);
    }
    const book = p?.kind === 'project' ? p : null;
    for (const id of seen) bookCache.set(id, book);
    return book;
  };
  const books = {};
  const info = {};
  let notes = 0;
  const pieces = [];
  for (const r of live.values()) {
    const text = r.text || '';
    if (r.kind === 'para' || r.kind === 'heading') {
      const book = bookOf(r);
      const type = book?.fields?.type || 'novel';
      if (!book || !MANUSCRIPT.includes(type)) continue;
      const w = wordCount(text);
      const l = type === 'screenplay' && r.kind === 'para' ? scriptLines([{ el: r.fields?.el || 'action', n: text.trim().length }]) : 0;
      books[book.id] ||= { w: 0, l: 0 };
      books[book.id].w += w;
      books[book.id].l += l;
      info[book.id] = { title: book.title || 'Untitled', type };
      pieces.push({ scope: book.id, day: dayOf(r.created_at || r.updated_at || 0), w, l });
    } else if (r.kind === 'line' || r.kind === 'note') {
      const w = wordCount(text);
      notes += w;
      pieces.push({ scope: 'notes', day: dayOf(r.created_at || r.updated_at || 0), w, l: 0 });
    }
  }
  return { books, notes, info, pieces };
}

const totalsBefore = (pieces, day) => {
  const books = {};
  let notes = 0;
  for (const p of pieces) {
    if (p.day >= day) continue;
    if (p.scope === 'notes') notes += p.w;
    else { books[p.scope] ||= { w: 0, l: 0 }; books[p.scope].w += p.w; books[p.scope].l += p.l; }
  }
  return { books, notes };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Notes today's totals, if they changed. The first tally ever also keeps where the day started.
export async function record(now = Date.now()) {
  const rows = await allEntries();
  const m = measure(rows);
  const day = dayOf(now);
  const id = `tally-${day}`;
  const end = { books: m.books, notes: m.notes };
  const tallies = rows.filter((r) => r.kind === 'tally' && !r.deleted);
  const prev = tallies.find((t) => t.id === id);
  if (prev && same(prev.fields?.end, end)) return false;
  const fields = { ...(prev?.fields || {}), day, end };
  if (!prev && !tallies.some((t) => t.fields?.day < day)) fields.start = totalsBefore(m.pieces, day);
  await putEntries([{ ...(prev || entry('tally', { id, title: `Progress ${day}` })), fields, deleted: false, updated_at: now }]);
  return true;
}

// Periods ending now: days, weeks (from Monday) or months.
function periods(unit, count, today) {
  const out = [];
  if (unit === 'day') {
    for (let i = count - 1; i >= 0; i--) { const d = addDays(today, -i); out.push({ from: d, to: d }); }
  } else if (unit === 'week') {
    const t = dateOf(today);
    const monday = addDays(today, -((t.getDay() + 6) % 7));
    for (let i = count - 1; i >= 0; i--) { const from = addDays(monday, -7 * i); out.push({ from, to: addDays(from, 6) }); }
  } else {
    const t = dateOf(today);
    for (let i = count - 1; i >= 0; i--) {
      const a = new Date(t.getFullYear(), t.getMonth() - i, 1);
      const b = new Date(t.getFullYear(), t.getMonth() - i + 1, 0);
      out.push({ from: dayOf(a.getTime()), to: dayOf(b.getTime()) });
    }
  }
  return out;
}

// Words (w) and script lines (l) written in each period, for every book, the notes and everything together.
export function progress(rows, { unit = 'day', count = 14, now = Date.now() } = {}) {
  const m = measure(rows);
  const tallies = rows.filter((r) => r.kind === 'tally' && !r.deleted && r.fields?.end).sort((a, b) => (a.fields.day < b.fields.day ? -1 : 1));
  const firstDay = tallies[0]?.fields.day || null;
  const byDay = new Map(tallies.map((t) => [t.fields.day, t]));
  const scopes = [...Object.keys(m.books), 'notes'];
  const val = (totals, s) => (s === 'notes' ? { w: totals?.notes || 0, l: 0 } : totals?.books?.[s] || null);

  // Estimated days: what was first written that day.
  const started = new Map();
  for (const p of m.pieces) {
    const k = `${p.scope} ${p.day}`;
    const v = started.get(k) || { w: 0, l: 0 };
    v.w += p.w; v.l += p.l;
    started.set(k, v);
  }
  let last = null;
  const recorded = new Map();
  for (const t of tallies) {
    const before = last ? last.fields.end : t.fields.start || totalsBefore(m.pieces, t.fields.day);
    const d = {};
    for (const s of scopes) {
      const e = val(t.fields.end, s);
      if (!e) continue; // not there that day (or deleted since)
      const b = val(before, s) || { w: 0, l: 0 };
      d[s] = { w: e.w - b.w, l: e.l - b.l };
    }
    recorded.set(t.fields.day, d);
    last = t;
  }
  const onDay = (s, day) => {
    if (!firstDay || day < firstDay) return started.get(`${s} ${day}`) || { w: 0, l: 0 };
    return byDay.has(day) ? recorded.get(day)[s] || { w: 0, l: 0 } : { w: 0, l: 0 };
  };

  const today = dayOf(now);
  const list = periods(unit, count, today);
  const series = {};
  for (const s of [...scopes, 'all']) series[s] = list.map((p) => ({ ...p, w: 0, l: 0 }));
  list.forEach((p, i) => {
    for (let day = p.from; day <= p.to && day <= today; day = addDays(day, 1)) {
      for (const s of scopes) {
        const v = onDay(s, day);
        series[s][i].w += v.w; series[s][i].l += v.l;
        series.all[i].w += v.w; series.all[i].l += v.l;
      }
    }
  });
  const totals = { all: { w: m.notes, l: 0 }, notes: { w: m.notes, l: 0 } };
  for (const [id, b] of Object.entries(m.books)) { totals[id] = b; totals.all.w += b.w; totals.all.l += b.l; }
  return { series, totals, info: m.info, estimatedBefore: firstDay || today, periods: list };
}

export const pagesOf = (lines) => lines / LINES_PER_PAGE;

// ---------- the panel ----------

const LABELS = { day: 'Days', week: 'Weeks', month: 'Months' };
const COUNTS = { day: 14, week: 12, month: 12 };
const fmtWords = (n) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()} word${Math.abs(n) === 1 ? '' : 's'}`;
const fmtPages = (lines) => {
  const p = Math.abs(pagesOf(lines));
  const t = p < 10 ? (Math.round(p * 10) / 10).toString() : Math.round(p).toLocaleString();
  return `${lines < 0 ? '−' : ''}${t} page${t === '1' ? '' : 's'}`;
};
const short = (day, opts) => dateOf(day).toLocaleDateString(undefined, opts);

function periodName(unit, p, i, n) {
  if (i === n - 1) return { day: 'Today', week: 'This week', month: 'This month' }[unit];
  if (unit === 'day') return i === n - 2 ? 'Yesterday' : short(p.from, { weekday: 'short', month: 'short', day: 'numeric' });
  if (unit === 'week') return `Week of ${short(p.from, { month: 'short', day: 'numeric' })}`;
  return short(p.from, { month: 'long', year: 'numeric' });
}

export class StatsPanel {
  constructor(el, { onClose } = {}) {
    this.el = el;
    this.onClose = onClose;
    this.unit = localStorage.getItem('statsUnit') || 'day';
    this.scope = 'all';
    el.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => { this.unit = b.dataset.unit; localStorage.setItem('statsUnit', this.unit); this.render(); }));
  }

  get isOpen() { return !this.el.hidden; }

  async open() {
    this.el.hidden = false;
    await record().catch((e) => console.error(e));
    await this.render();
  }

  close() { this.el.hidden = true; this.onClose?.(); }
  toggle() { return this.isOpen ? this.close() : this.open(); }

  async render() {
    const rows = await allEntries();
    const data = progress(rows, { unit: this.unit, count: COUNTS[this.unit] });
    this.el.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === this.unit)));
    const scopes = [
      { id: 'all', name: 'Everything', kind: '' },
      ...Object.entries(data.info).sort((a, b) => a[1].title.localeCompare(b[1].title)).map(([id, b]) => ({ id, name: b.title, kind: b.type === 'screenplay' ? 'Screenplay' : 'Novel', script: b.type === 'screenplay' })),
      { id: 'notes', name: 'Notes', kind: 'Notebook and notes' }
    ];
    if (!scopes.some((s) => s.id === this.scope)) this.scope = 'all';
    const n = data.periods.length;
    const amount = (s, v) => (s.script ? `${fmtPages(v.l)} · ${fmtWords(v.w)}` : fmtWords(v.w));

    // The chosen one: this period, then a bar for each period before it.
    const s = scopes.find((x) => x.id === this.scope);
    const series = data.series[s.id];
    const now = series[n - 1];
    const head = this.el.querySelector('.stats-now');
    head.replaceChildren();
    const big = document.createElement('div');
    big.className = 'stats-big';
    big.textContent = amount(s, now);
    const sub = document.createElement('div');
    sub.className = 'stats-sub';
    sub.textContent = `${periodName(this.unit, now, n - 1, n)} · ${s.name}`;
    head.append(big, sub);

    const metric = (v) => Math.max(0, s.script ? v.l : v.w);
    const max = Math.max(1, ...series.map(metric));
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${n * 10} 48`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'stats-bars');
    series.forEach((p, i) => {
      const h = metric(p) ? Math.max(1.5, (metric(p) / max) * 46) : 0.75;
      const r = document.createElementNS(svgNS, 'rect');
      r.setAttribute('x', String(i * 10 + 1.5));
      r.setAttribute('width', '7');
      r.setAttribute('y', String(48 - h));
      r.setAttribute('height', String(h));
      r.setAttribute('rx', '1.2');
      if (i === n - 1) r.setAttribute('class', 'now');
      if (p.to < data.estimatedBefore) r.setAttribute('class', 'guess');
      const t = document.createElementNS(svgNS, 'title');
      t.textContent = `${periodName(this.unit, p, i, n)}: ${amount(s, p)}`;
      r.append(t);
      svg.append(r);
    });
    const axis = document.createElement('div');
    axis.className = 'stats-axis';
    axis.innerHTML = '<span></span><span></span>';
    axis.firstChild.textContent = periodName(this.unit, series[0], 0, n);
    axis.lastChild.textContent = periodName(this.unit, now, n - 1, n);
    this.el.querySelector('.stats-chart').replaceChildren(svg, axis);

    // Everything you're writing: this period and the total so far. Pick one to chart it.
    const list = this.el.querySelector('.stats-list');
    list.replaceChildren();
    for (const x of scopes) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(x.id === this.scope));
      b.innerHTML = '<span class="name"></span><span class="period"></span><span class="total"></span>';
      b.querySelector('.name').textContent = x.name;
      if (x.kind) { const k = document.createElement('small'); k.textContent = x.kind; b.querySelector('.name').append(k); }
      b.querySelector('.period').textContent = amount(x, data.series[x.id][n - 1]);
      const tot = data.totals[x.id] || { w: 0, l: 0 };
      b.querySelector('.total').textContent = x.script ? `${fmtPages(tot.l)} so far` : `${fmtWords(tot.w)} so far`;
      b.addEventListener('click', () => { this.scope = x.id; this.render(); });
      li.append(b);
      list.append(li);
    }
    const foot = this.el.querySelector('.stats-foot');
    const guessed = data.periods[0].from < data.estimatedBefore;
    foot.hidden = !guessed;
    if (guessed) foot.textContent = `Before ${short(data.estimatedBefore, { month: 'short', day: 'numeric' })} is estimated from the day each paragraph was started.${scopes.some((x) => x.script) ? ' Pages are estimates at standard script layout.' : ''}`;
  }
}
