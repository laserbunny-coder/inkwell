// The strip that travels: away from Today, a thin line under the top bar keeps
// the one thing in view (a small dot, its name, Done and Not now). Its name
// goes back to Now. Part 2 of "One thing at a time" (Nov 15 2026).
//
// While he writes, only the text (his words: "I don't like to have anything
// but the text itself"): in a draft the strip doesn't show unless the Look
// says so ("While you write a draft": Nothing, A small dot, The strip), and in
// Focus nothing shows whatever the choice. The one exception: five minutes
// before a calendar event its name shows here, in a draft too (Look: "Fixed
// times reach me while I write").
//
// hooks: view() → the view's name ('write' for a draft), inToday() → bool,
// go(place), off(name) → a Look switch is off, plan → the Plan (its Now, its
// calendar hook).

import { readNow, SMALLS, isSmall, writeStrip } from './now.js';
import { getEntry } from './db.js';
import { dayPlan, isoOf, loadTasks } from './tasks.js';
import { clockWord } from './calendar.js';
import { make } from './dom.js';

const root = document.documentElement;
const TAKEOVER = 5; // minutes before an event that it shows here
const LINGER = 0; // minutes after an event ends (it's over: the strip lets go)

export class NowStrip {
  constructor(hooks) {
    this.h = hooks;
    this.el = make('div', 'now-strip');
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'The one thing');
    this.el.hidden = true;
    document.querySelector('.topbar')?.after(this.el);
    this.up = false; // the dot was opened, for this visit
    this.at = '';
    this.timer = 0;
    this.turn = 0;
    this.el.addEventListener('click', (e) => this.click(e));
    document.addEventListener('inkwell:now', () => this.soon());
    // Focus, and the view, are classes and data on <html>.
    new MutationObserver(() => this.soon()).observe(root, { attributes: true, attributeFilter: ['class', 'data-view'] });
    setInterval(() => this.soon(), 30e3);
    // It sits under the top bar while the bar shows, else at the very top.
    const tb = document.querySelector('.topbar');
    new MutationObserver(() => this.place()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    tb?.addEventListener('transitionend', () => this.place());
    window.addEventListener('resize', () => this.place());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.soon(); });
  }

  place() {
    if (this.el.hidden) return;
    const tb = document.querySelector('.topbar');
    let top = 0;
    if (tb) {
      const cs = getComputedStyle(tb);
      const r = tb.getBoundingClientRect();
      if (cs.visibility !== 'hidden' && Number(cs.opacity) > 0.1 && r.bottom > 1) top = Math.round(r.bottom);
    }
    this.el.style.setProperty('--ns-top', `${top}px`);
  }

  // Somewhere new: the dot closes again.
  moved(place) {
    const at = JSON.stringify(place || null);
    if (at !== this.at) { this.at = at; this.up = false; }
    this.soon();
  }

  // Once things settle, but never put off for long (<html>'s classes change often).
  soon() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = 0; this.update(); }, 60);
  }

  // What the strip says now: { kind: 'event' | 'dot' | 'strip', ... } or null.
  async model() {
    const h = this.h;
    if (root.classList.contains('in-pane') || h.inToday()) return null;
    const draft = h.view() === 'write';
    const focus = root.classList.contains('focus');
    const today = isoOf();
    const now = Date.now();
    const st = await readNow(today);
    const mode = !draft && !focus ? 'strip' : focus ? 'none' : writeStrip() === 'dot' && this.up ? 'strip' : writeStrip();
    // A calendar event, from five minutes before it starts to its end.
    const evOk = (!draft && !focus) ? !h.off('nowstrip') : !h.off('nowevents');
    if (evOk && !h.off('calendar') && h.plan?.hooks.calendar) {
      const got = h.plan.hooks.calendar(today, today);
      const list = got.now || [];
      if (!got.now) got.fresh.then((l) => { if (l?.length) this.soon(); });
      const ev = list.filter((e) => e.day === today && !e.allDay && !st.events[e.id] && now >= e.start - TAKEOVER * 6e4 && now < e.end + LINGER * 6e4).sort((a, b) => a.start - b.start)[0];
      if (ev) {
        const mins = Math.max(1, Math.round((ev.start - now) / 6e4));
        return { kind: 'event', name: ev.title, when: now < ev.start ? `in ${mins} minute${mins === 1 ? '' : 's'}` : `now, until ${clockWord(ev.end)}`, id: ev.id };
      }
    }
    if (h.off('nowstrip') || mode === 'none' || !st.task) return null;
    let name = '';
    if (st.task === SMALLS) {
      const items = await loadTasks(today);
      const dp = dayPlan(items, today, today);
      const left = [...dp.carried, ...dp.open].filter((i) => !i.ghost && isSmall(i) && !i.row.fields?.done && !st.skipped.includes(i.row.id));
      if (!left.length) return null;
      name = left[0].row.text || 'Untitled';
    } else {
      const row = await getEntry(st.task);
      if (!row || row.deleted || row.fields?.done) return null;
      name = row.text || 'Untitled';
    }
    return { kind: mode === 'dot' ? 'dot' : 'strip', name, smalls: st.task === SMALLS };
  }

  async update() {
    const turn = ++this.turn;
    let m = null;
    try { m = await this.model(); } catch (e) { console.warn(e); }
    if (turn !== this.turn) return;
    const el = this.el;
    const key = JSON.stringify(m);
    if (key === this.drawn) return;
    this.drawn = key;
    root.classList.toggle('has-nowstrip', !!m && m.kind !== 'dot');
    el.hidden = !m;
    el.className = `now-strip${m ? ` ns-k-${m.kind}` : ''}`;
    this.place();
    el.replaceChildren();
    if (!m) return;
    if (m.kind === 'dot') {
      const b = make('button', 'ns-dot');
      b.type = 'button';
      b.dataset.ns = 'up';
      b.setAttribute('aria-label', `Show the one thing: ${m.name}`);
      b.title = m.name;
      el.append(b);
      return;
    }
    const name = make('button', 'ns-name');
    name.type = 'button';
    name.dataset.ns = 'now';
    name.title = 'Back to Now (Alt + 1)';
    const t = make('span', 'ns-t', m.name);
    if (m.kind === 'event') t.append(make('span', 'ns-when', `, ${m.when}`));
    name.append(make('i'), t);
    el.append(name);
    if (m.kind === 'strip') {
      const done = make('button', 'ns-btn', 'Done');
      done.type = 'button';
      done.dataset.ns = 'done';
      const not = make('button', 'ns-btn', 'Not now');
      not.type = 'button';
      not.dataset.ns = 'notnow';
      el.append(done, not);
    }
  }

  async click(e) {
    const b = e.target.closest('[data-ns]');
    if (!b || this.busy) return;
    const act = b.dataset.ns;
    if (act === 'up') { this.up = true; this.drawn = null; return this.update(); }
    this.busy = true;
    try {
      await this.h.go({ view: 'plan', tab: 'now' });
      const now = this.h.plan?.now;
      if (!now) return undefined;
      if (act === 'done') await now.done();
      else if (act === 'notnow' && now.model().cur) { now.asking = true; this.h.plan.redraw(); now.focusFirst('.now-choice'); }
    } finally { this.busy = false; }
    return undefined;
  }
}
