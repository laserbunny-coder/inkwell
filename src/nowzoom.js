// Today and Now as one (Nov 25 2026, Michael: "the now page should just be a
// zoomed in view of that next task"). Now is no longer a page of its own:
// zoomed into a task that's on today, wherever it lives, the zoom is Now. The
// task is the page, written and edited as any zoomed-in line is (its title,
// Enter, Tab, [] , Ctrl + Enter, the phone's bar), and a slim strip at the foot
// keeps the day close:
//
//   ‹ Today   Not now                         3 of 7   Next ›
//
// ‹ Today goes out to the day (Alt + Left does too). Next (Alt + Down) zooms
// into the next task on today, Alt + Up the one before. Ticking it done keeps
// you here; Next lights up and waits until you press it. Zoomed deeper, into
// one of its lines, the strip stays. The order is the day's, kept as it was
// when you came in, so a task ticked done doesn't move under you.
import { make } from './dom.js';
import { media } from './device.js';
import { getEntry } from './db.js';
import { popMenu } from './menu.js';
import { loadTasks, dayPlan } from './tasks.js';
import { isoOf } from './dates.js';
import { zoomTo } from './nowpage.js';

const hover = media('mouse');
const clip = (t, n) => { const s = String(t || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled'; return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// What the ruler reads: the zoomed-in line that is Now, if any (app/zoom.js).
export const nowState = { zoom: null, task: null };

let it = null;
// Now, from anywhere (Alt + `, Enter on Today): zoom into the one thing.
export async function goNow({ still = () => true } = {}) {
  const p = it?.p || window.__plan;
  if (!p) return zoomTo({ stop: 'today' });
  await p.now.load();
  if (!p.items) await p.refresh().catch(() => {});
  if (!p.items) p.items = await loadTasks();
  const m = p.now.model();
  const id = m.cur?.item.row.id || m.cand?.item?.row.id;
  if (!still()) return undefined; // moved on meanwhile
  if (id) return p.openLine(id, { begin: false, still });
  // Nothing known yet (the day's first lines are laid when it's drawn): the
  // Now page lays them, and zooms on into a plain task from there (now.js).
  return zoomTo({ place: { view: 'plan', tab: 'now' }, way: 'in' });
}

export class NowZoom {
  constructor({ plan, notebook, here }) {
    this.p = plan;
    this.nb = notebook;
    this.here = here;
    this.order = [];
    this.timer = null;
    this.el = make('nav', 'nz-strip');
    this.el.setAttribute('aria-label', 'Now: this task and the day');
    this.el.hidden = true;
    document.body.append(this.el);
    it = this;
    this.el.addEventListener('click', (e) => this.click(e));
    document.addEventListener('inkwell:place', () => { this.saw(); this.soon(40); });
    document.addEventListener('inkwell:nowzoom-check', () => this.soon());
    // From the Now page (now.js), only while it's still the place shown.
    const onNowPage = () => history.state?.view === 'plan' && history.state?.tab === 'now' && !history.state?.line;
    document.addEventListener('inkwell:now-go', () => { if (onNowPage()) goNow({ still: onNowPage }).catch((e) => console.warn(e)); });
    // Before the app's own Alt + Left (Back), so out from the task is out to the day.
    window.addEventListener('keydown', (e) => this.key(e), true);
  }

  // Where he was on Today before zooming in (the list, the day's page or the
  // hours): out from the task goes back to that face.
  saw() {
    const st = history.state;
    if (!st || (st.view === 'notebook' && st.zoom)) return;
    const today = isoOf();
    const face = (st.view === 'plan' && ['day', 'calday'].includes(st.tab) && !st.day) || (st.view === 'notebook' && st.pageId === `day-${today}` && !st.zoom);
    this.from = face ? { ...st } : null;
  }

  out() {
    if (this.from) return zoomTo({ place: this.from, way: 'out' });
    return zoomTo({ stop: 'today' });
  }

  soon(ms = 150) { clearTimeout(this.timer); this.timer = setTimeout(() => this.check().catch((e) => console.warn(e)), ms); }

  hide() {
    if (this.el.hidden && !nowState.zoom) return;
    this.el.hidden = true;
    document.body.classList.remove('nz-on');
    this.set(null, null);
  }

  set(zoom, task) {
    if (nowState.zoom === zoom && nowState.task === task) return;
    nowState.zoom = zoom;
    nowState.task = task;
    document.dispatchEvent(new CustomEvent('inkwell:nowzoom'));
  }

  // The task the zoomed-in line is, or is under, if it's on today.
  async check() {
    const nb = this.nb();
    const zoom = this.here() && nb?.page ? nb.zoom : null;
    if (!zoom) return this.hide();
    const today = isoOf();
    const items = await loadTasks();
    let id = zoom;
    let item = null;
    for (let k = 0; k < 40 && id; k++) {
      item = items.find((i) => i.row.id === id && !i.ghost && !i.occ);
      if (item) break;
      const r = nb.store?.cache.get(id) || (await getEntry(id));
      id = r?.parent_id || null;
    }
    // Still zoomed in on the same line? (It may have moved on while we looked.)
    if (this.nb()?.zoom !== zoom || !this.here()) return undefined;
    const tid = item?.row.id;
    const dp = dayPlan(items, today, today);
    const list = [...dp.carried, ...dp.open].filter((i) => !i.ghost);
    const onDay = !!item && !!item.task?.day && item.task.day <= today;
    // A task ticked done today stays Now (it was on the day when you came in).
    if (!item || !(onDay && (list.includes(item) || this.order.includes(tid) || dp.done.includes(item)))) return this.hide();
    // The day's order, as it was: new tasks join at the end, gone ones leave.
    const live = new Set([...list, ...dp.done].map((i) => i.row.id));
    if (!this.order.includes(tid)) this.order = list.map((i) => i.row.id);
    this.order = this.order.filter((x) => live.has(x) || x === tid);
    for (const i of list) if (!this.order.includes(i.row.id)) this.order.push(i.row.id);
    if (!this.order.includes(tid)) this.order.unshift(tid);
    this.items = items;
    this.item = item;
    this.draw(zoom);
    this.set(zoom, tid);
    return undefined;
  }

  // The next (or the one before) still to do on today, in the day's order.
  step(dir) {
    const ids = this.order;
    const at = ids.indexOf(this.item?.row.id);
    const open = (x) => { const i = this.items?.find((y) => y.row.id === x && !y.ghost); return i && !i.row.fields?.done; };
    for (let k = 1; k < ids.length; k++) {
      const x = ids[(at + dir * k + ids.length * 2) % ids.length];
      if (open(x)) return this.items.find((y) => y.row.id === x);
    }
    return null;
  }

  draw(zoom) {
    const i = this.item;
    const done = !!i.row.fields?.done;
    const el = this.el;
    el.replaceChildren();
    const btn = (act, label, cls = '') => { const b = make('button', `nz-b${cls ? ` ${cls}` : ''}`, label); b.type = 'button'; b.dataset.nz = act; return b; };
    const back = btn('today', '‹ Today');
    if (hover.matches) back.title = 'Out to the day (Alt + Left)';
    el.append(back);
    if (!done && zoom === i.row.id) {
      const nn = btn('notnow', 'Not now');
      nn.setAttribute('aria-haspopup', 'menu');
      el.append(nn);
    }
    el.append(make('span', 'nz-sp'));
    const at = this.order.indexOf(i.row.id);
    el.append(make('span', 'nz-pos', `${at + 1} of ${this.order.length}`));
    const next = this.step(1);
    if (next) {
      const b = btn('next', '', done ? 'go' : '');
      b.append(make('span', 'nz-nm', done ? `Next: ${clip(next.row.text, 48)}` : 'Next'), document.createTextNode(' ›'));
      b.dataset.id = next.row.id;
      if (hover.matches) b.title = `Next: ${clip(next.row.text, 80)} (Alt + Down)`;
      el.append(b);
    } else if (done) el.append(make('span', 'nz-pos', '· the last one today'));
    el.hidden = false;
    document.body.classList.add('nz-on');
  }

  async click(e) {
    const b = e.target.closest('button[data-nz]');
    if (!b) return;
    const act = b.dataset.nz;
    if (act === 'today') return this.out();
    if (act === 'next') return this.p.openLine(b.dataset.id);
    if (act === 'notnow') {
      const id = this.item?.row.id;
      const one = (where, label, sub) => ({ label, sub, run: () => this.aside(id, where) });
      return popMenu(b, [
        one('later', 'Later today', 'To the end of today'),
        one('tomorrow', 'Enough for today', 'Counts as worked on; back tomorrow'),
        one('week', 'Any day this week', 'Off today, under Any day this week')
      ]);
    }
    return undefined;
  }

  // Not now: the Now page's own three choices, then on to what's next.
  async aside(id, where) {
    const now = this.p.now;
    await now.load();
    if (!this.p.items) this.p.items = this.items;
    if (now.st.task !== id) await now.save({ task: id, since: Date.now(), last: null });
    const next = this.step(1);
    await now.aside(where);
    if (next) return this.p.openLine(next.row.id);
    return zoomTo({ stop: 'today' });
  }

  key(e) {
    if (this.el.hidden || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const to = this.step(e.key === 'ArrowDown' ? 1 : -1);
      e.preventDefault();
      if (to) this.p.openLine(to.row.id);
      return;
    }
    // Out from the task itself: the day. Deeper in, Back steps out as it always has.
    if (e.key === 'ArrowLeft' && nowState.zoom && nowState.zoom === nowState.task) { e.preventDefault(); e.stopPropagation(); this.out(); }
  }
}
