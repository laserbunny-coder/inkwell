// A warning before a lesson or meeting (Nov 17 2026, the settings review).
//
// The strip that travels went with the old layout. What Michael kept of it:
// five minutes before a calendar event, a small quiet line at the top centre
// of the window says its name and time ("Christopher · 3:00 pm"). It shows on
// every stop and in true focus too, where it is the only thing allowed to
// appear. A tap or click puts it away; it leaves by itself when the event
// starts. No sound, no amber (amber is only for what needs him).
//
// hooks: plan → the Plan (its calendar hook), off(name) → a Look switch is off.

import { isoOf } from './tasks.js';
import { make } from './dom.js';

const BEFORE = 5; // minutes before an event that it shows
// "3:00 pm", as he wrote it.
const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, ' ');

export class EventWarn {
  constructor(hooks) {
    this.h = hooks;
    this.gone = new Set(); // events put away with a tap, this session
    this.el = make('button', 'ev-warn');
    this.el.type = 'button';
    this.el.hidden = true;
    this.el.addEventListener('click', () => { if (this.id) this.gone.add(this.id); this.show(null); });
    document.body.append(this.el);
    this.timer = 0;
    setInterval(() => this.soon(), 20e3);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.soon(); });
  }

  soon() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = 0; this.update(); }, 60);
  }

  // The event due in the next five minutes, or null.
  next(now = Date.now()) {
    const h = this.h;
    if (!h.plan?.hooks.calendar) return null;
    const today = isoOf();
    const got = h.plan.hooks.calendar(today, today);
    if (!got.now) { got.fresh?.then((l) => { if (l?.length) this.soon(); }); return null; }
    return got.now.filter((e) => e.day === today && !e.allDay && !this.gone.has(e.id) && now >= e.start - BEFORE * 6e4 && now < e.start)
      .sort((a, b) => a.start - b.start)[0] || null;
  }

  update() {
    let ev = null;
    try { ev = this.next(); } catch (e) { console.warn(e); }
    this.show(ev);
    // Leave by itself the moment it starts.
    clearTimeout(this.leave);
    if (ev) this.leave = setTimeout(() => this.soon(), Math.max(1000, ev.start - Date.now() + 500));
  }

  show(ev) {
    this.id = ev?.id || null;
    this.el.hidden = !ev;
    if (!ev) return;
    const text = `${ev.title || 'An event'} · ${clock(ev.start)}`;
    this.el.textContent = text;
    this.el.setAttribute('aria-label', `Coming up: ${text}. Tap to put it away.`);
    this.el.title = 'Put it away';
  }
}
