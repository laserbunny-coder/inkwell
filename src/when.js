// When: one picker for any line, anywhere in Inkwell (one line or several).
// Today, Tomorrow, This week, Next week, This month (or next month's name in
// the last days of a month), Later, Not planned, then the next days, then
// "Pick a date…". Type to narrow it down ("fri", "next", "later"), Up and
// Down to move, Enter to take it, Esc to close. On a computer it opens by the
// line; on a phone it's a sheet from the bottom, with big rows for a thumb.

import { addDays, dateOf, horizon, whenHeadings, isoOf } from './tasks.js';

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const small = matchMedia('(max-width: 700px), (hover: none)');
const long = (iso, opts) => dateOf(iso).toLocaleDateString('en-US', opts);

// Every choice, in order: { id, label, hint, words, when, chip }.
// when: { day } | { span } | null (Not planned) | 'date' (ask for one).
export function whenChoices(today = isoOf()) {
  const h = horizon(today);
  const heads = whenHeadings(h);
  const hint = {
    today: long(h.today, { weekday: 'short', month: 'short', day: 'numeric' }),
    tomorrow: long(h.tomorrow, { weekday: 'short' }),
    week: 'any day, through Sunday',
    next: `from ${long(h.mon1, { month: 'short', day: 'numeric' })}`,
    month: h.month.here ? `after next week` : 'next month',
    later: 'no time yet'
  };
  const words = { today: ['now', 'tod'], tomorrow: ['tmr', 'tom'], week: ['this', 'wk'], next: ['nw'], month: ['month', 'mo'], later: ['someday', 'sometime'] };
  const out = heads.map((x) => ({ id: x.id, label: x.label, hint: hint[x.id], words: words[x.id] || [], when: x.when }));
  out.push({ id: 'none', label: 'Not planned', hint: 'off the plan', words: ['none', 'clear', 'unplan', 'off', 'no'], when: null });
  for (let n = 2; n <= 8; n++) {
    const iso = addDays(today, n);
    out.push({ id: `day-${iso}`, chip: true, label: `${long(iso, { weekday: 'short' })} ${dateOf(iso).getDate()}`, hint: long(iso, { weekday: 'long', month: 'long', day: 'numeric' }), words: [long(iso, { weekday: 'long' }).toLowerCase(), long(iso, { month: 'short' }).toLowerCase()], when: { day: iso } });
  }
  out.push({ id: 'date', label: 'Pick a date…', hint: '', words: ['date', 'pick', 'calendar', 'day'], when: 'date' });
  return out;
}

// Does what was typed fit this choice? Each word of it, or a word it's known by, starts with it.
export function fits(choice, typed) {
  const q = String(typed || '').trim().toLowerCase();
  if (!q) return true;
  const said = [...choice.label.toLowerCase().split(/\s+/), ...choice.words];
  if (choice.label.toLowerCase().startsWith(q)) return true;
  return q.split(/\s+/).every((w) => said.some((s) => s.startsWith(w)));
}

let open = null;
export const whenOpen = () => !!open;
export function closeWhen() { open?.close(); }

// Opens the picker. { anchor, at: { left, top }, title, current (a choice id),
// pick(choice) }. Resolves when it closes.
export function pickWhen({ anchor = null, at = null, title = 'When', current = null, pick }) {
  closeWhen();
  const choices = whenChoices();
  const sheet = small.matches;
  const box = make('div', `when-pick${sheet ? ' sheet' : ''}`);
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', title);
  const scrim = sheet ? make('div', 'when-scrim') : null;
  const head = make('div', 'wp-head');
  head.append(make('span', 'wp-title', title));
  const input = make('input', 'wp-find');
  input.type = 'text';
  input.placeholder = 'Type: fri, next, later…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Type to find a time');
  input.setAttribute('enterkeyhint', 'done');
  const list = make('div', 'wp-list');
  list.setAttribute('role', 'listbox');
  box.append(head, input, list);
  if (sheet) {
    const x = make('button', 'wp-x', '×');
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => done());
    head.append(x);
  }
  let shown = choices;
  let hi = 0;
  const draw = () => {
    shown = choices.filter((c) => fits(c, input.value));
    hi = Math.max(0, Math.min(hi, shown.length - 1));
    const rows = [];
    let chips = null;
    shown.forEach((c, n) => {
      const b = make('button', `wp-opt${c.chip ? ' chip' : ''}${n === hi ? ' hi' : ''}${c.id === current ? ' current' : ''}${c.id === 'none' ? ' none' : ''}`);
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(n === hi));
      b.dataset.n = String(n);
      b.append(make('span', 'wp-l', c.label));
      if (c.hint && !c.chip) b.append(make('span', 'wp-h', c.hint));
      if (c.chip) b.title = c.hint;
      b.addEventListener('click', (e) => { e.stopPropagation(); take(c); });
      // With nothing typed the days sit together in a row of chips.
      if (c.chip && !input.value.trim()) { if (!chips) { chips = make('div', 'wp-chips'); rows.push(chips); } chips.append(b); } else rows.push(b);
    });
    if (!shown.length) rows.push(make('div', 'wp-empty', 'Nothing fits. Try “fri”, “next” or “later”.'));
    list.replaceChildren(...rows);
    list.querySelector('.hi')?.scrollIntoView?.({ block: 'nearest' });
  };
  let finished = false;
  let resolve;
  const closed = new Promise((r) => { resolve = r; });
  const done = () => {
    if (finished) return;
    finished = true;
    box.remove();
    scrim?.remove();
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', place);
    open = null;
    if (anchor?.isConnected && !sheet) anchor.focus?.({ preventScroll: true });
    resolve();
  };
  const take = async (c) => {
    done();
    if (c.when === 'date') {
      const v = await askDate();
      if (v) await pick({ ...c, when: { day: v }, label: long(v, { weekday: 'short', month: 'short', day: 'numeric' }) });
      return;
    }
    await pick(c);
  };
  input.addEventListener('input', () => { hi = 0; draw(); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' && e.target !== input) { e.preventDefault(); hi = (hi + 1) % Math.max(1, shown.length); draw(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' && e.target !== input) { e.preventDefault(); hi = (hi - 1 + shown.length) % Math.max(1, shown.length); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) take(shown[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
    else if (e.key === 'Tab') { e.preventDefault(); }
  });
  const outside = (e) => { if (!box.contains(e.target) && e.target !== scrim) done(); };
  const place = () => {
    if (sheet) return;
    const r = at || anchor?.getBoundingClientRect?.() || { left: innerWidth / 2 - 150, top: innerHeight / 3, bottom: innerHeight / 3 };
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    const below = (at ? r.top : r.bottom) + 4;
    box.style.left = `${left}px`;
    box.style.top = `${below + h > innerHeight - 8 ? Math.max(8, (at ? r.top : r.top) - h - 4) : below}px`;
  };
  if (scrim) { scrim.addEventListener('click', () => done()); document.body.append(scrim); }
  document.body.append(box);
  draw();
  place();
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  window.addEventListener('resize', place);
  // On a phone the keyboard stays down until the box is tapped.
  if (!sheet) input.focus({ preventScroll: true });
  else box.querySelector('.wp-opt')?.focus({ preventScroll: true });
  open = { close: done };
  return closed;
}

// "Pick a date…": the phone's or the browser's own date picker.
function askDate() {
  return new Promise((resolve) => {
    const box = make('div', 'when-pick when-date');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Which day?');
    const input = make('input', 'wp-find');
    input.type = 'date';
    input.min = isoOf();
    const ok = make('button', 'wp-ok', 'Plan it');
    const no = make('button', 'wp-cancel', 'Cancel');
    const row = make('div', 'wp-row');
    row.append(no, ok);
    box.append(make('span', 'wp-title', 'Which day?'), input, row);
    const scrim = make('div', 'when-scrim');
    const end = (v) => { box.remove(); scrim.remove(); resolve(v && /^\d{4}-\d\d-\d\d$/.test(v) ? v : null); };
    ok.addEventListener('click', () => end(input.value));
    no.addEventListener('click', () => end(null));
    scrim.addEventListener('click', () => end(null));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); end(input.value); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(null); } });
    document.body.append(scrim, box);
    input.focus();
    try { input.showPicker?.(); } catch { /* not from here */ }
  });
}

// Which choice is lit for a task now (its heading, or its exact day).
export function currentChoice(task, today = isoOf()) {
  if (!task) return null;
  const h = horizon(today);
  if (task.day && task.day > h.tomorrow && task.day <= addDays(today, 8)) return `day-${task.day}`;
  if (!task.day && !task.span?.kind) return 'none';
  if (task.day === h.today) return 'today';
  if (task.day === h.tomorrow) return 'tomorrow';
  if (task.span?.kind === 'week') return task.span.start === h.mon1 ? 'next' : !task.span.start || task.span.start <= h.mon0 ? 'week' : null;
  if (task.span?.kind === 'month') return task.span.start === h.month.start ? 'month' : null;
  if (task.span?.kind === 'later') return 'later';
  return null;
}
