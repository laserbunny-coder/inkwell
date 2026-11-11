// Go through. One thing at a time, in the middle of the screen, with the
// likeliest answer lit: press its letter, or Enter for the lit one. Two piles
// use it: the last week's loose lines (see loose.js) and the calls waiting on
// the Desk. Esc stops wherever you are; what's left stays for next time.

import './through.css';
import { looseRecent, guess, reviewThreads, sortLine, unsort } from './loose.js';
import { isoOf, dayWord } from './tasks.js';

const root = document.documentElement;
const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Which way a card leaves: up to a plan, down to wait, left into a project, right when skipped.
const LEAVES = { notoday: [0, 44], delete: [56, 0], task: [0, -44], tray: [0, -44], done: [0, -44], file: [-56, 0], drawer: [0, 44], keep: [0, 44], later: [0, 44], skip: [56, 0] };

export class Through {
  // toast(text); changed(rows) tells the open page a line was written;
  // worlds() → [{ id, title }] newest first; calls: { list() → [{ id, title,
  // kind, project, mins, waited, link, why }], done(id), later(id) };
  // onClose() hears when it shuts.
  constructor(hooks) {
    Object.assign(this, hooks);
    this.el = null;
  }

  get isOpen() { return !!this.el; }

  async open(kind = 'loose') {
    if (this.el) this.close(true);
    this.kind = kind;
    this.today = isoOf();
    this.last = null;
    this.choosing = false;
    this.busy = false;
    try {
      this.items = kind === 'calls' ? await this.calls.list() : kind === 'carried' ? await this.carried.list() : await this.looseItems();
    } catch (e) { console.warn(e); this.items = null; }
    if (!this.items) { this.toast(kind === 'calls' ? 'Couldn’t reach your Claude threads just now' : 'Couldn’t read your pages just now'); return false; }
    if (!this.items.length) { this.toast(kind === 'calls' ? 'Nothing needs you' : kind === 'carried' ? 'Nothing left from earlier days' : 'Nothing loose this week'); return false; }
    this.total = this.items.length;
    this.at = 0;
    this.skipped = 0;
    this.answered = 0;
    this.build();
    this.draw();
    return true;
  }

  async looseItems() {
    const [found, worlds] = [await looseRecent(this.today), await this.worlds()];
    this.places = worlds;
    const threads = new Map();
    const out = [];
    for (const { row, day } of found) {
      if (!threads.has(day)) threads.set(day, await reviewThreads(day));
      out.push({ id: row.id, text: row.text.trim(), day, guess: guess(row, { worlds, thread: threads.get(day).get(row.id) }) });
    }
    return out;
  }

  build() {
    this.back = make('div', 'thru-back');
    this.el = make('div', 'thru');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', this.kind === 'calls' ? 'Go through what needs you' : this.kind === 'carried' ? 'Go through the tasks from earlier days' : 'Go through loose lines');
    this.el.tabIndex = -1;
    this.back.append(this.el);
    this.back.addEventListener('mousedown', (e) => { if (e.target === this.back) this.close(); });
    this.onKey = (e) => this.key(e);
    document.addEventListener('keydown', this.onKey, true);
    this.before = document.activeElement;
    document.body.append(this.back);
    root.classList.add('going-through');
  }

  close(quiet = false) {
    if (!this.el) return;
    document.removeEventListener('keydown', this.onKey, true);
    this.back.remove();
    this.el = this.back = null;
    root.classList.remove('going-through');
    this.before?.focus?.({ preventScroll: true });
    if (!quiet) this.onClose?.(this.kind, this.answered);
  }

  options(it) {
    if (this.kind === 'carried') {
      return [
        ['K', 'Keep it for today', 'keep'],
        ['N', 'Not today: off the day, still where it’s written', 'notoday'],
        ...(it.canDelete ? [['D', it.hq ? 'Delete from Inkwell (it stays on the HQ board)' : 'Delete it', 'delete']] : []),
        ['S', 'Skip for now', 'skip']
      ];
    }
    if (this.kind === 'calls') {
      return [
        ['O', 'Open the thread', 'open'],
        ['D', 'Done: take it off the list', 'done'],
        ['L', 'Later: ask me tomorrow morning', 'later'],
        ['S', 'Skip for now', 'skip']
      ];
    }
    return [
      ['T', 'A task for today', 'task'],
      ['W', 'A task, not on a day yet', 'tray'],
      ['F', it.guess.to ? `File into ${it.guess.to.title}` : 'File into a project…', 'file'],
      ['D', 'Into the Drawer', 'drawer'],
      ['K', 'Keep it on the day', 'keep'],
      ['S', 'Skip for now', 'skip']
    ];
  }

  draw(next = false) {
    const it = this.items[this.at];
    if (!it) return this.finish();
    const calls = this.kind === 'calls';
    const prog = make('div', 'thru-prog');
    const carried = this.kind === 'carried';
    prog.append(make('span', 'thru-count', `${calls ? 'Needs you' : carried ? 'From earlier days' : 'Loose lines'} · ${Math.min(this.answered + this.skipped + 1, this.total)} of ${this.total}`));
    const right = make('span', 'thru-keys');
    if (this.last) {
      const u = make('button', 'thru-undo', 'Undo the last one');
      u.type = 'button';
      u.dataset.key = 'Z';
      u.addEventListener('click', () => this.undo());
      right.append(u);
    }
    const stop = make('button', 'thru-stop', 'Stop');
    stop.type = 'button';
    stop.title = 'Stop here (Esc). What’s left stays for next time.';
    stop.addEventListener('click', () => this.close());
    right.append(stop);
    prog.append(right);

    const card = make('div', `thru-card${next ? ' next' : ''}`);
    card.append(make('div', 'thru-big', calls ? it.title : it.text));
    const ctx = make('div', 'thru-ctx');
    if (carried) {
      const w = dayWord(it.day, this.today);
      ctx.append(document.createTextNode(`Planned for ${/^(Today|Yesterday|Tomorrow)$/.test(w) ? w.toLowerCase() : w}`));
      if (it.where) ctx.append(make('span', 'thru-why', it.where));
    } else if (calls) {
      ctx.append(make('span', 'thru-kind', it.kind), document.createTextNode(`${it.project} · about ${it.mins} min · waiting ${it.waited}`));
      if (it.why) ctx.append(make('span', 'thru-why', it.why));
    } else {
      ctx.append(document.createTextNode(cap(dayWord(it.day, this.today))));
      if (it.guess.why) ctx.append(make('span', 'thru-why', it.guess.why));
    }
    card.append(ctx);

    const opts = make('div', 'thru-opts');
    if (this.choosing) {
      opts.append(make('div', 'thru-pick', 'File into'));
      this.places.slice(0, 9).forEach((w, i) => opts.append(this.opt(String(i + 1), w.title || 'Untitled', () => this.answer('file', w))));
      opts.append(this.opt('B', 'Back', () => { this.choosing = false; this.draw(); }, 'quiet'));
    } else {
      const lit = calls ? 'open' : carried ? 'keep' : it.guess.how;
      for (const [k, label, how] of this.options(it)) {
        const b = this.opt(k, label, () => this.pick(how), how === lit ? 'sug' : '');
        if (how === lit) {
          // With keys it's Enter; on a phone the word says why it's lit.
          const e = make('span', 'thru-enter');
          e.append(make('span', 'te-why', !calls && !carried && it.guess.claude ? 'Claude’s guess' : ''), make('span', 'te-key', 'Enter'));
          b.append(e);
        }
        b.dataset.how = how;
        opts.append(b);
      }
    }
    card.append(opts);
    this.el.replaceChildren(prog, card);
    this.el.focus({ preventScroll: true });
  }

  opt(k, label, run, cls = '') {
    const b = make('button', `thru-opt${cls ? ` ${cls}` : ''}`);
    b.type = 'button';
    b.dataset.key = k;
    b.append(make('kbd', '', k), make('span', 'thru-label', label));
    b.addEventListener('click', run);
    return b;
  }

  key(e) {
    if (!this.el) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.choosing) { this.choosing = false; this.draw(); } else this.close(); return; }
    // Everything typed belongs to the card while it's up.
    if (e.key === 'Tab') return;
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key === 'Enter' ? 'Enter' : e.key.length === 1 ? e.key.toUpperCase() : '';
    if (!k) return;
    // Enter on a focused button is that button's own click.
    if (k === 'Enter' && document.activeElement?.closest?.('.thru button')) return;
    const b = k === 'Enter' ? this.el.querySelector('.thru-opt.sug') : [...this.el.querySelectorAll('[data-key]')].find((x) => x.dataset.key === k);
    if (!b) return;
    e.preventDefault();
    b.click();
  }

  pick(how) {
    const it = this.items[this.at];
    if (!it || this.busy) return;
    if (how === 'open') { if (it.link) window.open(it.link, '_blank', 'noopener'); return; }
    if (how === 'file' && this.kind !== 'calls' && !it.guess.to) {
      if (!this.places.length) { this.toast('Make a project in the Library first'); return; }
      this.choosing = true;
      this.draw();
      return;
    }
    return this.answer(how, it.guess?.to);
  }

  async answer(how, to = null) {
    const it = this.items[this.at];
    if (!it || this.busy) return;
    this.busy = true;
    this.choosing = false;
    try {
      if (how === 'skip') {
        this.items.push(this.items.splice(this.at, 1)[0]);
        this.skipped += 1;
        this.last = null;
      } else if (this.kind === 'carried') {
        const undo = await this.carried.answer(it, how);
        this.items.splice(this.at, 1);
        this.answered += 1;
        this.last = undo ? { it, undo, at: this.at } : null;
      } else if (this.kind === 'calls') {
        await (how === 'done' ? this.calls.done(it.id) : this.calls.later(it.id));
        this.items.splice(this.at, 1);
        this.answered += 1;
        this.last = null;
      } else {
        const { rows, before } = await sortLine(it.id, how, { to, today: this.today });
        if (rows.length) this.changed(rows);
        this.items.splice(this.at, 1);
        this.answered += 1;
        this.last = { it, before, at: this.at };
      }
    } catch (e) {
      console.warn(e);
      this.busy = false;
      this.toast(this.kind === 'calls' ? 'Couldn’t reach your list just now. Try again.' : 'Couldn’t save that. Try again.');
      return;
    }
    await this.leave(how);
    this.busy = false;
    // Everything left has been skipped once: that's the end of this pass.
    if (!this.el) return;
    if (this.skipped >= this.items.length) return this.finish();
    this.draw(true);
  }

  async undo() {
    if (!this.last || this.busy || this.kind === 'calls') return;
    this.busy = true;
    const { it, before, at, undo } = this.last;
    try {
      if (undo) await undo();
      else { const rows = await unsort(before); if (rows.length) this.changed(rows); }
    } catch (e) { console.warn(e); this.busy = false; return; }
    this.items.splice(Math.min(at, this.items.length), 0, it);
    this.at = Math.min(at, this.items.length - 1);
    this.answered -= 1;
    this.last = null;
    this.busy = false;
    this.draw();
  }

  // The card goes the way of its answer, then the next one comes up.
  leave(how) {
    const card = this.el?.querySelector('.thru-card');
    const motion = root.dataset.motion || 'full';
    if (!card || motion === 'off' || !card.animate) return Promise.resolve();
    const [dx, dy] = motion === 'full' ? (LEAVES[how] || [0, 0]) : [0, 0];
    const a = card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate(${dx}px, ${dy}px)` }], { duration: 170, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    return a.finished.catch(() => {});
  }

  finish() {
    const calls = this.kind === 'calls';
    const left = this.items.length;
    this.close();
    if (left) this.toast(`${left} left for next time`);
    else this.toast(calls ? 'That’s every call. Nothing needs you.' : this.kind === 'carried' ? 'All sorted. Today is just today.' : 'All sorted. Nothing loose this week.');
  }
}
