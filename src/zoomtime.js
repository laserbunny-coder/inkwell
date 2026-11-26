// The zoom, Part 3 (Nov 2026): moving a line across time. A line has one
// time: a day, any day of a week (span week), sometime in a month (span
// month), sometime this year (span later), or not planned. One key moves a
// picked line further out (today, this week, this month, this year, not
// planned), closer in (all the way to Now), or to the neighbour day, week or
// month. The same moves sit on a small bar over the ruler (the phone's way),
// and a line dragged onto a ruler stop lands there. Every move says so, with
// Undo (plan.applyWhen). No new data: the same task fields Plan writes.
//
// Also here: the Not planned shelf, opened from the top line's count.

import { make } from './dom.js';
import { media } from './device.js';
import { addDays, weekOf, isoOf, spanOf, dateOf } from './tasks.js';
import { lineName } from './firstlight.js';

const hover = media('mouse');
const ym = (iso) => String(iso || '').slice(0, 7);
const addM = (m, n) => { const d = new Date(`${m}-01T12:00`); d.setMonth(d.getMonth() + n); return isoOf(d).slice(0, 7); };
const short = (iso, o) => dateOf(iso).toLocaleDateString('en-US', o);
const clip = (t, n = 50) => { const s = String(t || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled'; return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const monthName = (m, today) => short(`${m}-15`, m.slice(0, 4) === today.slice(0, 4) ? { month: 'long' } : { month: 'long', year: 'numeric' });

// Where a line is in time, seen from today. A day gone by is today's (it
// waits on top of today); a week or month gone by rolls on to this one.
export function timeOf(i, today = isoOf()) {
  const t = i?.task || {};
  const mon0 = weekOf(today)[0];
  if (t.day) return { g: 'day', d: t.day < today ? today : t.day };
  const s = spanOf(t);
  if (s?.kind === 'week') return { g: 'week', w: s.start && s.start > mon0 ? s.start : mon0 };
  if (s?.kind === 'month') return { g: 'month', m: s.start && ym(s.start) > ym(today) ? ym(s.start) : ym(today) };
  if (s?.kind === 'later') return { g: 'year' };
  return { g: 'none' };
}

// Where you are looking: { lvl, day, week, today }.
export function viewOf(plan) {
  const today = plan.today;
  const tab = plan.tab;
  if (tab === 'now') return { lvl: 'now', day: today, week: weekOf(today)[0], today };
  if (tab === 'day' || tab === 'calday') { const d = plan.dayAt || today; return { lvl: 'day', day: d, week: weekOf(d)[0], today }; }
  if (tab === 'week') { const w = weekOf(plan.week || today)[0]; return { lvl: 'week', day: w === weekOf(today)[0] ? today : w, week: w, today }; }
  if (tab === 'ahead') { const w = weekOf(plan.week || today)[0]; return { lvl: 'month', day: w === weekOf(today)[0] ? today : w, week: w, today }; }
  if (tab === 'year') return { lvl: 'year', day: today, week: weekOf(today)[0], today };
  return { lvl: 'other', day: today, week: weekOf(today)[0], today };
}

// One step further out: a day to its week, a week to its month, a month to
// the year, the year to not planned.
export function outTarget(at) {
  if (at.g === 'day') return { g: 'week', w: weekOf(at.d)[0] };
  if (at.g === 'week') return { g: 'month', m: ym(addDays(at.w, 3)) };
  if (at.g === 'month') return { g: 'year' };
  if (at.g === 'year') return { g: 'none' };
  return null;
}
// One step closer in, toward where you are looking, and from today to Now.
export function inTarget(at, v, isCur = false) {
  const today = v.today;
  const mon0 = weekOf(today)[0];
  if (at.g === 'none') {
    if (v.lvl === 'year') return { g: 'year' };
    if (v.lvl === 'month') return { g: 'month', m: ym(v.day < today ? today : v.day) };
    if (v.lvl === 'week') return { g: 'week', w: v.week };
    return { g: 'day', d: v.lvl === 'day' ? v.day : today };
  }
  if (at.g === 'year') return { g: 'month', m: ['day', 'week', 'month'].includes(v.lvl) && ym(v.day) >= ym(today) ? ym(v.day) : ym(today) };
  if (at.g === 'month') {
    if (at.m === ym(v.day) && v.week >= mon0) return { g: 'week', w: v.week };
    if (at.m === ym(today)) return { g: 'week', w: mon0 };
    return { g: 'week', w: weekOf(`${at.m}-01`)[0] < `${at.m}-01` ? addDays(weekOf(`${at.m}-01`)[0], 7) : weekOf(`${at.m}-01`)[0] };
  }
  if (at.g === 'week') {
    let d = at.w === v.week ? v.day : at.w === mon0 ? today : at.w;
    if (d < today) d = today;
    return { g: 'day', d };
  }
  if (at.g === 'day' && at.d === today) return isCur ? null : { g: 'now' };
  if (at.g === 'day') return { g: 'day', d: today };
  return null;
}
// The neighbour: the day, week or month before (-1) or after (1).
export function sideTarget(at, dir, today = isoOf()) {
  if (at.g === 'day') { const d = addDays(at.d, dir); return d < today ? null : { g: 'day', d }; }
  if (at.g === 'week') { const w = addDays(at.w, 7 * dir); return w < weekOf(today)[0] ? null : { g: 'week', w }; }
  if (at.g === 'month') { const m = addM(at.m, dir); return m < ym(today) ? null : { g: 'month', m }; }
  return null;
}

// What Plan writes for a time (setWhen's `when`).
export function whenFor(t) {
  if (!t || t.g === 'none') return null;
  if (t.g === 'day') return { day: t.d };
  if (t.g === 'week') return { span: { kind: 'week', start: t.w } };
  if (t.g === 'month') return { span: { kind: 'month', start: `${t.m}-01` } };
  if (t.g === 'year') return { span: { kind: 'later', start: null } };
  return null;
}
// A time in words, as the bar and the note say it.
export function sayTime(t, today = isoOf(), small = false) {
  if (!t) return '';
  if (t.g === 'now') return 'Now';
  if (t.g === 'none') return 'Not planned';
  if (t.g === 'year') return small ? 'This year' : 'Sometime this year';
  if (t.g === 'day') {
    if (t.d === today) return 'Today';
    if (t.d === addDays(today, 1)) return 'Tomorrow';
    return short(t.d, small ? { weekday: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
  }
  if (t.g === 'week') {
    const mon0 = weekOf(today)[0];
    if (t.w === mon0) return small ? 'This week' : 'Any day this week';
    if (t.w === addDays(mon0, 7)) return small ? 'Next week' : 'Any day next week';
    return `Week of ${short(t.w, { month: 'short', day: 'numeric' })}`;
  }
  if (t.g === 'month') return t.m === ym(today) ? (small ? 'This month' : 'Sometime this month') : `${small ? '' : 'Sometime in '}${monthName(t.m, today)}`;
  return '';
}
// A drop place's key ("day:2026-11-18", "week:…", "month:2026-12", "year",
// "none", "now") as a time.
export function parseKey(k) {
  const [a, b] = String(k || '').split(':');
  if (a === 'day' && b) return { g: 'day', d: b };
  if (a === 'week' && b) return { g: 'week', w: b };
  if (a === 'month' && b) return { g: 'month', m: b };
  if (['year', 'none', 'now'].includes(a)) return { g: a };
  return null;
}

// Moves lines to a time, with the note and Undo. To Now: on today, after the
// one thing, and he is on it (Now's own "Bring to today").
export async function moveTo(plan, ids, t) {
  if (!t || !ids.length) return null;
  const today = plan.today;
  if (t.g === 'now') {
    const i = plan.item(ids[0]);
    if (!i) return null;
    return plan.now.bring(i);
  }
  const when = whenFor(t);
  return plan.applyWhen(ids, when, sayTime(t, today));
}

// ---------- picking a line (Up and Down, right-click, or hold on a phone) ----------

const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const busy = () => !!document.querySelector('.pop-menu, .ask-backdrop, dialog[open], .palette:not([hidden]), .page-settings:not([hidden]), .go-panel, .history:not([hidden]), .shortcuts:not([hidden])');
const TIME_TABS = ['day', 'week', 'ahead', 'year'];

export class Pick {
  constructor(plan) {
    this.plan = plan;
    this.id = null;
    this.bar = null;
    document.addEventListener('keydown', (e) => this.key(e), true);
    document.addEventListener('contextmenu', (e) => this.context(e), true);
  }
  active() { return this.plan.pageShown && TIME_TABS.includes(this.plan.tab) && document.documentElement.dataset.view === 'plan'; }
  rows() {
    return [...this.plan.sheet.querySelectorAll('[data-task]:not([data-part]):not([data-ghost])')]
      .filter((el) => !el.parentElement?.closest('[data-task]') && el.getClientRects().length);
  }
  rowOf(id) { return id ? this.rows().find((el) => el.dataset.task === id) || null : null; }
  set(id, { scroll = true } = {}) {
    this.id = id;
    this.paint();
    if (scroll) this.rowOf(id)?.scrollIntoView({ block: 'nearest' });
  }
  drop() { if (!this.id) return; this.id = null; this.paint(); }
  // After every redraw: the picked line keeps its mark, and the bar its words.
  paint() {
    const sheet = this.plan.sheet;
    sheet.querySelectorAll('.zm-picked').forEach((x) => x.classList.remove('zm-picked'));
    // A new view lets go; a line moved out of sight stays picked, so the
    // next Ctrl + Up takes it further still (the bar names it).
    const where = `${this.plan.tab}|${this.plan.dayAt || ''}|${this.plan.week || ''}`;
    if (where !== this.where) { this.where = where; if (!this.moving) this.id = null; }
    const el = this.active() ? this.rowOf(this.id) : null;
    if (!el && !(this.id && this.active() && this.plan.item(this.id))) this.id = null;
    el?.classList.add('zm-picked');
    this.drawBar(!el);
  }
  at() { const i = this.id && this.plan.item(this.id); return i ? timeOf(i, this.plan.today) : null; }
  targets() {
    const i = this.plan.item(this.id);
    if (!i) return {};
    const at = timeOf(i, this.plan.today);
    const v = viewOf(this.plan);
    const cur = this.plan.now?.m?.cur;
    const isCur = !!cur && cur.item.row.id === this.id;
    return { at, out: outTarget(at), in: inTarget(at, v, isCur), prev: sideTarget(at, -1, this.plan.today), next: sideTarget(at, 1, this.plan.today) };
  }
  async go(which) {
    const id = this.id;
    const t = this.targets()[which];
    if (!id || !t) return;
    this.moving = true;
    try { await moveTo(this.plan, [id], t); } finally { this.moving = false; }
    // It stays picked, where it went or out of sight.
    if (t.g === 'now') return;
    this.id = id;
    this.paint();
  }
  async tick() {
    const i = this.plan.item(this.id);
    if (!i || i.ghost) return;
    const done = !i.row.fields?.done;
    await this.plan.tick(i, done);
    this.hooks?.();
  }
  drawBar(away = false) {
    const id = this.id;
    const i = id && this.plan.item(id);
    if (!i || !this.active()) { if (this.bar) this.bar.hidden = true; document.documentElement.classList.remove('zm-picking'); return; }
    if (!this.bar) {
      this.bar = make('div', 'zm-movebar');
      this.bar.setAttribute('role', 'toolbar');
      this.bar.setAttribute('aria-label', 'The picked line');
      this.bar.addEventListener('click', (e) => this.barClick(e));
      document.body.append(this.bar);
    }
    const today = this.plan.today;
    const t = this.targets();
    const small = !hover.matches;
    const done = !!i.row.fields?.done;
    const b = (act, label, key, target, title) => {
      const x = make('button', `zm-mb${act === 'out' || act === 'in' ? ' wide' : ''}`);
      x.type = 'button';
      x.dataset.mb = act;
      x.append(make('span', '', label));
      if (key && hover.matches) x.append(make('kbd', '', key));
      if (target === null) x.disabled = true;
      if (title) x.title = title;
      return x;
    };
    const name = make('span', 'zm-mb-name', clip(lineName(i.row), small ? 22 : 34));
    name.title = away ? 'Picked, and out of sight here' : '';
    if (!away) name.hidden = true;
    this.bar.replaceChildren(
      name,
      b('tick', done ? 'Not done' : 'Done', 'Space'),
      b('prev', '‹', 'Ctrl ←', t.prev, t.prev ? `To ${sayTime(t.prev, today)}` : 'Nothing earlier'),
      b('next', '›', 'Ctrl →', t.next, t.next ? `To ${sayTime(t.next, today)}` : ''),
      make('span', 'zm-mb-sp'),
      b('out', `↑ ${t.out ? sayTime(t.out, today, small) : 'Furthest out'}`, 'Ctrl ↑', t.out, 'Further out'),
      b('in', `↓ ${t.in ? sayTime(t.in, today, small) : 'Closest in'}`, 'Ctrl ↓', t.in, 'Closer in'),
      b('open', 'Zoom in', 'Enter', undefined, 'Zoom into it'),
      b('more', '⋯', '', undefined, 'More: When, rename, delete'),
      b('let', '✕', 'Esc', undefined, 'Let go')
    );
    const prev = this.bar.querySelector('[data-mb="prev"]');
    const next = this.bar.querySelector('[data-mb="next"]');
    prev.setAttribute('aria-label', t.prev ? `Move to ${sayTime(t.prev, today)}` : 'Nothing earlier');
    next.setAttribute('aria-label', t.next ? `Move to ${sayTime(t.next, today)}` : 'Nothing later');
    this.bar.hidden = false;
    document.documentElement.classList.add('zm-picking');
  }
  barClick(e) {
    const el = e.target.closest('[data-mb]');
    if (!el || el.disabled) return;
    const a = el.dataset.mb;
    if (a === 'tick') return this.tick();
    if (a === 'prev' || a === 'next' || a === 'out' || a === 'in') return this.go(a);
    if (a === 'open') { const id = this.id; this.drop(); return this.plan.openLine(id); }
    if (a === 'more') { const i = this.plan.item(this.id); if (i) this.plan.menu(i, el); return; }
    if (a === 'let') return this.drop();
  }
  context(e) {
    if (!this.active()) return;
    // Today as an outline: a right-click anywhere on a line is the task's menu (as in Tana).
    if (e.target.closest?.('.pl-ol')) return;
    const row = e.target.closest?.('[data-task]:not([data-part]):not([data-ghost])');
    if (!row || !this.plan.sheet.contains(row) || typing(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    this.set(row.dataset.task, { scroll: false });
  }
  key(e) {
    if (!this.active() || e.isComposing || busy()) return;
    if (typing(e.target) || typing(document.activeElement)) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (!ctrl && !e.altKey && !e.shiftKey && (k === 'ArrowDown' || k === 'ArrowUp')) {
      const rows = this.rows();
      if (!rows.length) return;
      stop();
      const at = rows.findIndex((el) => el.dataset.task === this.id);
      const n = at < 0 ? (k === 'ArrowDown' ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + (k === 'ArrowDown' ? 1 : -1)));
      return this.set(rows[n].dataset.task);
    }
    if (!this.id) return;
    if (ctrl && !e.altKey && !e.shiftKey) {
      const which = { ArrowUp: 'out', ArrowDown: 'in', ArrowLeft: 'prev', ArrowRight: 'next' }[k];
      if (which) { stop(); return this.go(which); }
      return;
    }
    if (ctrl || e.altKey) return;
    if (k === ' ' || k === 'Spacebar') { stop(); return this.tick(); }
    if (k === 'Enter') { stop(); const id = this.id; this.drop(); return this.plan.openLine(id); }
    if (k === 'Escape') { stop(); return this.drop(); }
  }
}

// ---------- the Not planned shelf ----------

// Lines with no day and no time, in the order they were made. The top line's
// count opens it; a line is dragged from it (or onto it to take a line off
// the plan), and its + drops a line into whatever is in view.
export function unplannedOf(plan) {
  return (plan.items || []).filter((i) => i.mine && !i.row.fields?.done && !i.ghost && !i.task.day && !spanOf(i.task) && !i.task.repeat?.every)
    .sort((a, b) => (b.row.created_at || 0) - (a.row.created_at || 0));
}

export class Shelf {
  constructor(plan) {
    this.plan = plan;
    this.open = false;
    this.el = null;
  }
  count() { return unplannedOf(this.plan).length; }
  toggle(on = !this.open) { this.open = on; this.draw(); }
  draw() {
    const plan = this.plan;
    const btn = document.querySelector('.zm-np');
    if (btn) { const n = this.count(); btn.textContent = `Not planned · ${n}`; btn.setAttribute('aria-expanded', String(!!this.open)); btn.dataset.drop = 'none'; }
    if (!this.open || false) { if (this.el) this.el.hidden = true; document.documentElement.classList.remove('zm-shelf-on'); return; }
    if (!this.el) {
      this.el = make('aside', 'zm-shelf');
      this.el.setAttribute('aria-label', 'Not planned');
      this.el.dataset.drop = 'none';
      this.el.addEventListener('click', (e) => this.click(e));
      document.body.append(this.el);
      plan.drags(this.el);
    }
    const list = unplannedOf(plan);
    const v = viewOf(plan);
    const into = inTarget({ g: 'none' }, v);
    const head = make('div', 'zm-shelf-h');
    const close = make('button', 'ghost-btn zm-shelf-x', '×');
    close.type = 'button';
    close.dataset.sh = 'close';
    close.setAttribute('aria-label', 'Close Not planned');
    head.append(make('h2', '', `Not planned · ${list.length}`), close);
    const hint = make('p', 'zm-shelf-p', `${hover.matches ? 'Drag a line onto a day, a week or a ruler stop.' : 'Hold a line and slide it onto a day or a ruler stop.'} The + puts it in ${sayTime(into, plan.today).replace(/^(Any|Sometime|Today|Tomorrow|Not)\b/, (c) => c.toLowerCase())}.`);
    const box = make('div', 'zm-shelf-list');
    for (const i of list) {
      const r = make('div', 'zm-shelf-row');
      r.dataset.task = i.row.id;
      r.dataset.move = '1';
      if (hover.matches) r.draggable = true;
      const plus = make('button', 'zm-shelf-plus', '+');
      plus.type = 'button';
      plus.dataset.sh = 'in';
      plus.setAttribute('aria-label', `Put it in ${sayTime(into, plan.today)}`);
      const words = make('button', 'zm-shelf-tx', clip(i.row.text, 70));
      words.type = 'button';
      words.dataset.sh = 'open';
      words.title = 'Open it';
      r.append(plus, words);
      box.append(r);
    }
    if (!list.length) box.append(make('p', 'zm-shelf-empty', 'Nothing is waiting here.'));
    this.el.replaceChildren(head, hint, box);
    this.el.hidden = false;
    document.documentElement.classList.add('zm-shelf-on');
  }
  async click(e) {
    const el = e.target.closest('[data-sh]');
    if (!el) return;
    const a = el.dataset.sh;
    if (a === 'close') return this.toggle(false);
    const id = el.closest('[data-task]')?.dataset.task;
    if (!id) return;
    if (a === 'open') return this.plan.openLine(id);
    if (a === 'in') {
      const into = inTarget({ g: 'none' }, viewOf(this.plan));
      await moveTo(this.plan, [id], into);
    }
  }
}

// A ruler stop as a time to drop a line on (the time side only).
export function stopKey(stop, today = isoOf()) {
  if (stop === 'now') return 'now';
  if (stop === 'today') return `day:${today}`;
  if (stop === 'week') return `week:${weekOf(today)[0]}`;
  if (stop === 'month') return `month:${ym(today)}`;
  if (stop === 'year') return 'year';
  return null;
}

// A line dragged with the mouse onto the ruler (outside the sheet, so its
// own listeners): over a time stop it shows where it would land, resting
// there zooms the view, and the drop moves it.
export function rulerDrops(plan, Plan) {
  let rest = null;
  const stopEl = (e) => e.target.closest?.('.zm-ruler .zm-stop[data-stop]');
  const clear = () => document.querySelectorAll('.zm-ruler .zm-dropon').forEach((x) => x.classList.remove('zm-dropon'));
  document.addEventListener('dragover', (e) => {
    const el = Plan.dragging ? stopEl(e) : null;
    const key = el ? stopKey(el.dataset.stop, plan.today) : null;
    if (!key) { if (!e.target.closest?.('.zm-ruler')) return; clear(); clearTimeout(rest?.timer); rest = null; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clear();
    el.classList.add('zm-dropon');
    if (rest?.stop !== el.dataset.stop) {
      clearTimeout(rest?.timer);
      const stop = el.dataset.stop;
      rest = { stop, timer: setTimeout(() => { import('./nowpage.js').then((m) => m.zoomTo({ stop })); }, 700) };
    }
  });
  document.addEventListener('dragleave', (e) => { if (stopEl(e)) { clear(); } });
  document.addEventListener('drop', async (e) => {
    const el = Plan.dragging ? stopEl(e) : null;
    const key = el ? stopKey(el.dataset.stop, plan.today) : null;
    clearTimeout(rest?.timer);
    rest = null;
    clear();
    if (!key) return;
    e.preventDefault();
    const id = Plan.dragging;
    Plan.dragging = null;
    if (id.startsWith('part:')) return;
    await moveTo(plan, plan.movingIds(id), parseKey(key));
  });
}
