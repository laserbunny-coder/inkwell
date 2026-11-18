// Now: one thing at a time. Today's first view (Alt + 1): the thing you're on,
// in large type, and nothing else in the middle of the screen. Done and
// "Not now" under it. After either, a gate: what just happened in one faint
// line, then what's next, and nothing becomes current until Begin.
//
// Decided with Michael on Nov 15 2026 (thread "Reshape Inkwell around how I
// really work", brief Part 1). It isn't a mode or a room: it's Today, drawn
// from the same list Plan shows (tasks.js dayPlan, events woven in by time).
//
// What's current is one pointer kept with the plan's settings (the
// `settings-plan` entry, fields.now), so the phone and the computer agree:
//   { day, task: id | 'smalls' | null, since, skipped: [ids], last, events }
// last: what the gate says happened ({ k: 'done' | 'set' | 'event', t, ... }).
// events: { event id: 'over' | 'missed' }, the calendar events dealt with today.
// A pointer from another day counts as nothing (each day starts at the gate).

import { popMenu } from './menu.js';
import { getEntry } from './db.js';
import { dayPlan, weave, addDays, isoOf, setTask, tickTask, weekOf, PLAN_ID, savePlanSettings, taskOf, TASKS_PAGE } from './tasks.js';
import { clockWord } from './calendar.js';
import { media } from './device.js';
import { make } from './dom.js';
import { talkView, heardView, closeView } from './nowends.js';
import { TrainNow } from './nowtrain.js';
import { isTraining } from './training.js';
import { LightNow } from './nowlight.js';
import { isLight } from './firstlight.js';
import { pageView, pageTarget, zoomTo, tieMenu, forOf } from './nowpage.js';
import './now.css';

export const SMALLS = 'smalls';
const hover = media('mouse');
const SOON = 45; // minutes: a fixed time this close says "in 30 minutes"
const TAKEOVER = 5; // minutes before an event that it takes over Now
const LINGER = 120; // minutes after an event ends that it still asks "It is over?"
const clip = (t, n = 60) => { const s = String(t || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled'; return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
// Small things ride together: marked small (⋯ > A small thing), and habits.
export const isSmall = (i) => !!(i?.task?.small || i?.task?.habit);

const blankNow = (day) => ({ day, task: null, since: 0, skipped: [], last: null, events: {} });
export async function readNow(today = isoOf()) {
  const row = await getEntry(PLAN_ID);
  const s = row && !row.deleted ? row.fields?.now : null;
  if (!s || s.day !== today) return blankNow(today);
  return { ...blankNow(today), ...s, skipped: Array.isArray(s.skipped) ? s.skipped : [], events: s.events && typeof s.events === 'object' ? s.events : {} };
}

// Anything the strip shows has changed: the pointer, a choice, a switch.
export const nowChanged = () => document.dispatchEvent(new CustomEvent('inkwell:now'));

// Where the one thing lives, said short ("The Ninja Bunch · Two-minute hook"),
// and what opens it: the page or piece its line links to, else where it's
// written. Nothing for a day page or the Tasks page.
function firstLink(nodes) {
  for (const n of nodes || []) {
    if (n.type === 'entryRef' && n.attrs?.id) return n.attrs;
    const in_ = firstLink(n.content);
    if (in_) return in_;
  }
  return null;
}
export function whereOf(i) {
  if (!i) return null;
  const w = i.world?.title || '';
  const link = firstLink(i.row.content);
  if (link && link.id !== i.world?.id) return { label: [w, link.title || 'Untitled'].filter(Boolean).join(' · '), id: link.id };
  if (link) return { label: w || link.title || 'Untitled', id: link.id };
  const r = i.root;
  if (!r || r.kind === 'day' || r.id === TASKS_PAGE) return null;
  const name = r.title || 'Untitled';
  return { label: w && w !== name ? `${w} · ${name}` : name, id: i.row.id, own: true };
}

export class Now {
  constructor(plan) {
    this.p = plan;
    this.st = blankNow(isoOf());
    this.listOpen = false; // "3 more today" opened
    this.asking = false; // the three choices under Not now
    this.smallsOpen = false; // the group's names shown in the list
    this.ctxOpen = false; // the one thing's notes
    this.busy = false;
    // The two ends of the day (Part 4): null | 'talk' | 'heard' | 'close'.
    this.mode = null;
    this.talk = { text: '', busy: false, note: '' };
    this.heard = null;
    this.close = { also: [], alive: '', drained: '', first: '', busy: false };
    this.forms = {};
    this.train = new TrainNow(this); // Training, one exercise at a time (Part 6)
    this.light = new LightNow(this); // First light, the morning reading (Part 5)
    document.addEventListener('keydown', (e) => this.key(e));
  }

  get shown() { return this.p.pageShown && this.p.tab === 'now'; }
  off(name) { return !!this.p.hooks.off?.(name); }

  async load() { this.st = await readNow(this.p.today); await this.train.load(); await this.light.load(); }

  // Runs one action at a time (a key, Enter in a number).
  run(fn) {
    if (this.busy) return;
    this.busy = true;
    Promise.resolve(fn()).catch((e) => console.warn(e)).finally(() => { this.busy = false; });
  }
  async save(patch) {
    this.st = { ...this.st, ...patch, day: this.p.today };
    await savePlanSettings({ now: this.st });
    nowChanged();
  }

  // ---------- what there is ----------

  model() {
    const p = this.p;
    const today = p.today;
    const now = Date.now();
    const dp = dayPlan(p.items, today, today);
    const st = this.st;
    const together = !this.off('smallsgo');
    const open = dp.open.filter((i) => !i.ghost);
    const evs = p.cal.filter((e) => e.day === today && !e.allDay);
    const live = evs.filter((e) => !st.events[e.id]);
    // First light is the first line of the morning, ahead of what's left from
    // earlier days too (unless he has dragged it down the day).
    const lead = open[0] && isLight(open[0].row) ? [{ item: open[0] }] : [];
    const rest = lead.length ? open.slice(1) : open;
    const seq = [...lead, ...dp.carried.filter((i) => !i.ghost).map((item) => ({ item })), ...(live.length ? weave(rest, live, today, now, today) : rest.map((item) => ({ item })))];
    const smalls = seq.filter((x) => x.item && isSmall(x.item)).map((x) => x.item);
    const item = (id) => seq.find((x) => x.item?.row.id === id)?.item || null;
    // What's current: one task, or the small things (the first not skipped).
    let cur = null;
    if (st.task === SMALLS) {
      const left = smalls.filter((i) => !st.skipped.includes(i.row.id));
      if (left.length) cur = { smalls: true, items: left, item: left[0], name: left[0].row.text || 'Untitled' };
    } else if (st.task) {
      const i = item(st.task);
      if (i) cur = { item: i, name: i.row.text || 'Untitled' };
    }
    // What's next: the rest in order, the small things as one entry.
    const rows = [];
    let group = null;
    for (const x of seq) {
      if (x.event) { rows.push(x); continue; }
      if (cur && !cur.smalls && x.item === cur.item) continue;
      if (together && isSmall(x.item)) {
        if (cur?.smalls) continue;
        if (!group) { group = { group: true, items: [] }; rows.push(group); }
        group.items.push(x.item);
        continue;
      }
      rows.push(x);
    }
    // At the gate: the next one (or the one set aside for an event, to pick back up).
    // Small things skipped earlier today wait behind the rest (still in the list).
    const waiting = (x) => x.group && x.items.every((i) => st.skipped.includes(i.row.id));
    let cand = rows.find((x) => !x.event && !waiting(x)) || rows.find((x) => !x.event) || null;
    const prev = st.last?.prev;
    if (!cur && prev) {
      const back = prev === SMALLS ? rows.find((x) => x.group) : rows.find((x) => x.item?.row.id === prev);
      if (back) cand = back;
    }
    const lastOf = (x) => (x.group ? 'A few small things' : x.item.row.text || 'Untitled');
    // On the zoom there is no gate: the next line simply is the one thing (Part 2).
    let auto = false;
    if (!cur && cand) {
      auto = true;
      cur = cand.group ? { smalls: true, items: cand.items.filter((i) => !st.skipped.includes(i.row.id)), item: null, name: '' } : { item: cand.item, name: cand.item.row.text || 'Untitled' };
      if (cur.smalls) { if (!cur.items.length) cur.items = cand.items; cur.item = cur.items[0]; cur.name = cur.item.row.text || 'Untitled'; }
      const at = rows.indexOf(cand);
      if (at >= 0) rows.splice(at, 1);
      cand = rows.find((x) => !x.event && !waiting(x)) || rows.find((x) => !x.event) || null;
    }
    // A calendar event takes over from five minutes before it starts.
    const active = live.filter((e) => now >= e.start - TAKEOVER * 6e4 && now < e.end + LINGER * 6e4).sort((a, b) => a.start - b.start)[0] || null;
    const upcoming = live.filter((e) => e.start > now).sort((a, b) => a.start - b.start)[0] || null;
    return { dp, rows, cur, auto, cand, candName: cand ? lastOf(cand) : '', active, upcoming, more: rows.filter((x) => !x.event).length, smalls, together, back: !!(cand && prev && (cand.group ? prev === SMALLS : cand.item?.row.id === prev)) };
  }

  // ---------- drawing ----------

  draw() { return this.drawPage(); }

  // The zoom (Part 2): Now is a page, the one thing or the line being visited.
  drawPage() {
    const p = this.p;
    const sheet = p.sheet;
    const m = (this.m = this.model());
    const held = p.held(sheet);
    const typing = sheet.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) ? document.activeElement.id : null;
    if (this.mode === 'heard' && m.cur && !m.auto) this.mode = null;
    const visit = !!pageTarget(this, m)?.visit;
    const mode = m.active || visit ? null : this.mode;
    const box = make('div', `now-view now-page${mode ? ' now-ends' : ''}`);
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', visit ? 'A line, opened' : 'Now');
    if (m.active && !visit) box.append(this.eventView(m));
    else if (mode === 'talk') box.append(talkView(this));
    else if (mode === 'heard') box.append(heardView(this, m));
    else if (mode === 'close') box.append(closeView(this, m));
    else box.append(...pageView(this, m));
    if (this.light.note && !m.active && !mode) box.querySelector('.np-hero')?.after(make('p', 'now-hint now-rnote', this.light.note));
    sheet.replaceChildren(box);
    p.restore(sheet, held);
    if (typing) sheet.querySelector(`#${CSS.escape(typing)}`)?.focus({ preventScroll: true });
    p.just = null;
  }


  async thought(input) {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await this.p.hooks.thought?.(text);
  }

  // The one thing, its two buttons (or the three choices under Not now).
  mid(m) {
    if (this.train.active(m.cur)) return this.train.view(m.cur);
    const mid = make('div', 'now-mid');
    const cur = m.cur;
    if (cur.smalls) mid.append(make('p', 'now-eyebrow', `Small things · ${cur.items.length} left`));
    const thing = make('h1', 'now-thing', cur.name);
    thing.dataset.now = 'ctx';
    thing.dataset.task = cur.item.row.id;
    thing.tabIndex = 0;
    if (cur.item.notes) { thing.setAttribute('role', 'button'); thing.setAttribute('aria-expanded', String(this.ctxOpen)); thing.title = this.ctxOpen ? 'Hide the lines under it' : 'Show the lines under it'; thing.classList.add('has-notes'); }
    mid.append(thing);
    const where = !cur.smalls && !this.off('nowwhere') ? whereOf(cur.item) : null;
    if (where) {
      const a = make('button', 'now-where');
      a.type = 'button';
      a.dataset.now = 'where';
      a.append(make('span', '', where.label), make('span', 'now-where-go', ' ›'));
      a.title = hover.matches ? 'Open it (Enter or O)' : 'Open it';
      mid.append(a);
    }
    if (this.ctxOpen && cur.item.notes) mid.append(this.p.kidsBox(cur.item.row.id));
    if (this.asking) mid.append(this.choices(cur));
    else {
      const acts = make('div', 'now-acts');
      acts.append(this.btn('done', 'Done', 'go', 'D'));
      if (cur.smalls) acts.append(this.btn('skip', 'Skip this one', '', 'S'));
      acts.append(this.btn('notnow', 'Not now', '', 'N'));
      mid.append(acts);
    }
    return mid;
  }

  choices(cur) {
    const box = make('div', 'now-choices');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Not now');
    const one = (where, label, said, key) => {
      const b = make('button', 'now-choice');
      b.type = 'button';
      b.dataset.now = 'aside';
      b.dataset.where = where;
      b.append(make('span', 'nc-l', label), make('small', '', said));
      if (hover.matches) b.append(make('kbd', '', key));
      box.append(b);
    };
    if (this.train.active(cur)) {
      one('later', 'Later today', 'The session waits where you stopped', '1');
      one('tomorrow', 'Enough for today', 'Off today. Tomorrow it starts fresh', '2');
      one('another', 'Another day', 'Off today. Your place does not move', '3');
      one('own', 'I trained on my own', 'Counts as a session; the next one takes its turn', '4');
      box.append(this.btn('keep', 'Keep going with it', 'quiet', 'Esc'));
      return box;
    }
    const them = cur.smalls ? 'They go' : 'It goes';
    one('later', 'Later today', `${them} to the end of today`, '1');
    one('tomorrow', 'Enough for today', `Counts as worked on, and ${cur.smalls ? 'they come' : 'it comes'} back tomorrow`, '2');
    one('week', 'Any day this week', `Off today: ${cur.smalls ? 'they wait' : 'it waits'} under Any day this week`, '3');
    box.append(this.btn('keep', 'Keep going with it', 'quiet', 'Esc'));
    return box;
  }

  btn(act, label, cls = '', key = '') {
    const b = make('button', `now-btn${cls ? ` ${cls}` : ''}`, label);
    b.type = 'button';
    b.dataset.now = act;
    if (key && hover.matches) b.title = `${label} (${key === 'Esc' ? 'Esc' : key})`;
    return b;
  }

  // Under the one thing: "3 more today", the next fixed time, and the list.
  foot(m, { list = false } = {}) {
    const foot = make('div', `now-foot${list ? ' open' : ''}`);
    const row = make('div', 'now-footrow');
    if (nowFace() !== 'next' || !m.cur) {
      const more = this.btn('more', m.more ? `${m.more} more today` : 'Nothing else today', 'quiet now-more', 'Space');
      more.setAttribute('aria-expanded', String(list));
      if (!m.more && !m.rows.length) more.disabled = true;
      row.append(more);
    } else row.append(make('span'));
    const ev = this.evLine(m);
    if (ev) row.append(ev);
    foot.append(row);
    if (list) foot.append(this.list(m));
    return foot;
  }

  evLine(m) {
    const e = m.upcoming;
    if (!e || this.off('calendar')) return null;
    const mins = Math.round((e.start - Date.now()) / 6e4);
    const soon = mins <= SOON;
    const el = make('span', `now-ev${soon ? ' soon' : ''}`, soon ? `${e.title} in ${mins} minute${mins === 1 ? '' : 's'}` : `${clockWord(e.start)} · ${e.title}`);
    el.dataset.event = e.id;
    return el;
  }

  // The list of what's next: plain plan rows (drag to reorder), events in
  // their place, and the small things as one entry that opens.
  list(m) {
    const p = this.p;
    const list = make('div', 'pl-list now-list');
    list.dataset.day = p.today;
    for (const x of m.rows) {
      if (x.event) { list.append(p.wovenEvent(x.event, x.at)); continue; }
      if (x.group) { list.append(...this.groupRow(x)); continue; }
      list.append(...p.taskRow(x.item, { carried: !!x.item.task.day && x.item.task.day < p.today }));
    }
    if (!list.childElementCount) list.append(make('p', 'now-none', 'Nothing else is lined up.'));
    return list;
  }

  groupRow(g) {
    const row = make('div', 'pl-task now-group');
    row.dataset.task = SMALLS;
    row.dataset.move = '1';
    if (hover.matches) row.draggable = true;
    const grip = make('span', 'pl-grip', '⠿');
    grip.setAttribute('aria-hidden', 'true');
    const fold = make('button', `pl-check now-gfold${this.smallsOpen ? ' open' : ''}`, this.smallsOpen ? '▾' : '▸');
    fold.dataset.now = 'smalls';
    fold.setAttribute('aria-expanded', String(this.smallsOpen));
    fold.setAttribute('aria-label', this.smallsOpen ? 'Hide the small things' : 'Show the small things');
    const title = make('div', 'pl-title');
    const words = make('button', 'pl-words', 'A few small things');
    words.dataset.now = 'smalls';
    title.append(words, make('span', 'now-gn', String(g.items.length)));
    row.append(grip, fold, title, make('div', 'pl-meta'));
    if (!this.smallsOpen) return [row];
    const inner = make('div', 'pl-list now-smalls');
    inner.dataset.day = this.p.today;
    inner.dataset.smalls = '1';
    for (const i of g.items) inner.append(...this.p.taskRow(i, { carried: !!i.task.day && i.task.day < this.p.today }));
    const begin = this.btn('begin-smalls', 'Begin the small things', 'quiet now-gbegin');
    inner.append(begin);
    return [row, inner];
  }

  // The day as a line: what's done, the one thing, what's next, on one thin line.
  thread(m, { side = false } = {}) {
    const box = make('div', `now-thread${side ? ' side' : ''}`);
    for (const i of m.dp.done) {
      const d = make('div', 'th th-done');
      d.append(make('i'), make('span', '', i.row.text || 'Untitled'));
      box.append(d);
    }
    const here = make('div', 'th th-now');
    here.append(make('i'));
    if (side) here.append(make('span', '', m.cur.name));
    else here.append(this.mid(m));
    box.append(here);
    const list = this.list(m);
    list.classList.add('th-list');
    box.append(list);
    if (!side) { const ev = this.evLine(m); if (ev) { const f = make('div', 'now-footrow'); f.append(make('span'), ev); box.append(f); } }
    return box;
  }


  // A calendar event, from five minutes before it starts.
  eventView(m) {
    const e = m.active;
    const now = Date.now();
    const mins = Math.max(1, Math.round((e.start - now) / 6e4));
    const when = now < e.start ? `In ${mins} minute${mins === 1 ? '' : 's'}` : now < e.end ? 'Now' : `Ended at ${clockWord(e.end)}`;
    const mid = make('div', 'now-mid');
    mid.dataset.event = e.id;
    mid.append(make('p', 'now-eyebrow sig', when), make('h1', 'now-thing', e.title), make('p', 'now-ref', `${clockWord(e.start)} to ${clockWord(e.end)}`));
    if (m.cur) mid.append(make('p', 'now-aside', `Set aside: ${m.cur.smalls ? 'the small things' : m.cur.name}`));
    const acts = make('div', 'now-acts');
    const over = this.btn('over', 'It is over', 'go');
    over.dataset.event = e.id;
    const not = this.btn('missed', 'It did not happen', 'quiet');
    not.dataset.event = e.id;
    acts.append(over, not);
    mid.append(acts);
    return mid;
  }

  // ---------- doing ----------

  async click(e) {
    const el = e.target.closest('[data-now]');
    if (!el || this.busy) return false;
    // Today's top (the zoom) offers the two ends of the day too.
    if (!this.shown && !(['talkday', 'closeday'].includes(el.dataset.now))) return false;
    const act = el.dataset.now;
    this.busy = true;
    if (!/^l/.test(act)) this.light.note = '';
    try {
      if (['tset', 'tmin', 'tnum', 'tnum2', 'tskip', 'tback', 'tup'].includes(act)) await this.train.click(act, el);
      else if (/^l(read|next|back|list|set|setok|done|skip|yest)$/.test(act)) await this.light.click(act);
      else if (act === 'done') await this.done();
      else if (act === 'skip') await this.skip();
      else if (act === 'notnow') { this.asking = true; this.p.redraw(); this.focusFirst('.now-choice'); }
      else if (act === 'keep') { this.asking = false; this.p.redraw(); }
      else if (act === 'aside') await this.aside(el.dataset.where);
      else if (act === 'more') { this.listOpen = !this.listOpen; this.p.redraw(); }
      else if (act === 'begin') await this.begin(el.dataset.task);
      else if (act === 'begin-smalls') await this.begin(SMALLS);
      else if (act === 'smalls') { this.smallsOpen = !this.smallsOpen; this.p.redraw(); }
      else if (act === 'ctx') { if (this.m?.cur?.item.notes) { this.ctxOpen = !this.ctxOpen; this.p.redraw(); } }
      else if (act === 'over' || act === 'missed') await this.eventDone(el.dataset.event, act === 'over');
      else if (act === 'where') await this.openWhere();
      else if (act === 'mic') await this.p.hooks.mic?.();
      else if (act === 'talkday') this.openTalk();
      else if (act === 'talk-send') await this.sendTalk();
      else if (act === 'talk-cancel' || act === 'close-cancel') this.endMode();
      else if (act === 'talk-mic') await this.p.hooks.mic?.('day');
      else if (act === 'talk-again') { this.talk.note = ''; this.mode = 'talk'; this.p.redraw(); this.focusIn('.now-say'); }
      else if (act === 'heard-begin') { const m = this.model(); this.mode = null; if (m.cand) await this.begin(m.cand.group ? SMALLS : m.cand.item.row.id); else this.p.redraw(); }
      else if (act === 'closeday') this.openClose();
      else if (act === 'close-add') this.addAlso(this.forms.close?.querySelector('.now-addin'));
      else if (act === 'close-save') await this.saveClose();
      else if (/^np-/.test(act)) await this.pageAct(act, el);
      else if (act === 'plan') this.p.goTab('plan');
      else if (act === 'page') this.p.goTab('page');
    } finally { this.busy = false; }
    return true;
  }

  // A row's words in Now's list: make it the one thing, or open it.
  rowMenu(i, anchor) {
    popMenu(anchor, [
      { label: 'Do this now', run: () => this.begin(i.row.id) },
      { label: 'Open it', run: () => this.p.open(i) }
    ]);
  }

  // Into the work: where the one thing lives (the strip keeps it in view there).
  async openWhere() {
    const cur = this.m?.cur || this.model().cur;
    const w = cur && !cur.smalls ? whereOf(cur.item) : null;
    if (!w) return;
    await this.p.hooks.openEntry(w.id);
  }

  // ---------- the page (the zoom, Part 2) ----------

  target() { return pageTarget(this, this.m || this.model()); }

  async pageAct(act, el) {
    const t = this.target();
    const i = t?.item;
    if (act === 'np-today') return zoomTo({ stop: 'today' });
    if (act === 'np-home') return zoomTo({ stop: 'now' });
    if (!i) return undefined;
    if (act === 'np-done') {
      if (!t.visit) return this.done();
      if (isLight(i.row) && !i.row.fields?.done) return this.light.read();
      const on = !i.row.fields?.done;
      await this.p.wrote(await tickTask(i.row.id, on));
      this.p.hooks.toast?.(on ? `“${clip(i.row.text, 40)}” done` : 'Not done', { label: 'Undo', run: async () => { await this.p.wrote(await tickTask(i.row.id, !on)); } });
      return undefined;
    }
    if (act === 'np-bring') return this.bring(i);
    if (act === 'np-proj') return i.world ? zoomTo({ place: { view: 'world', id: i.world.id }, way: 'next' }) : undefined;
    if (act === 'np-door') return this.p.hooks.writeHere?.(el.dataset.id || forOf(i));
    if (act === 'np-tie') return tieMenu(this, i, el);
    return undefined;
  }

  // Bring to today: after the one thing, and he is on it.
  async bring(i) {
    const today = this.p.today;
    const was = { ...this.st };
    const cur = this.m?.cur;
    const order = cur && !cur.smalls && cur.item.task.day === today ? (cur.item.task.order || 0) + 0.5 : this.p.lastOrder(today);
    const back = async () => { await this.save({ task: was.task, since: was.since, skipped: was.skipped, last: was.last }); };
    await this.p.applyWhen([i.row.id], { day: today }, 'today', { undo: back, extra: () => ({ order }) });
    await this.save({ task: i.row.id, since: Date.now(), last: null });
    this.p.hooks.toast?.('Brought to today, and you’re on it');
    return zoomTo({ stop: 'now' });
  }

  async tie(id, pieceId) {
    await this.p.wrote(await setTask(id, { for: pieceId }));
    this.p.hooks.toast?.('Tied. Its page opens on that piece', { label: 'Undo', run: async () => { await this.p.wrote(await setTask(id, { for: null })); } });
  }

  pageKey(k, e, m) {
    const t = pageTarget(this, m);
    const i = t?.item;
    const t0 = e.target;
    if (m.active && !t?.visit) return null;
    if (i && !t.visit && isLight(i.row) && !i.row.fields?.done) { const g = this.light.key(k, e); if (g) return g; }
    if (k === 'd' && i) return () => this.pageAct('np-done');
    if (k === 'b' && t?.visit && !(i.task.day && i.task.day <= this.p.today) && !i.row.fields?.done) return () => this.bring(i);
    if (k === 'n' && !t?.visit && m.cur) return () => { this.asking = true; this.p.redraw(); this.focusFirst('.now-choice'); };
    if (k === 's' && m.cur?.smalls && !t?.visit) return () => this.skip();
    if (k === 's' && this.train.active(m.cur) && !this.train.ask && !t?.visit) return () => this.train.move(1, null);
    if (k === 't' && !m.cur && this.morning(m)) return () => this.openTalk();
    if (k === 'c' && !m.cur && this.evening()) return () => this.openClose();
    const into = (e.key === 'Enter' && !t0?.closest?.('button, a')) || e.key === 'ArrowRight' || k === 'o';
    if (into && i) {
      const f = forOf(i);
      if (f) return () => this.p.hooks.writeHere?.(f);
      if (k === 'o' && whereOf(i)) return () => this.p.hooks.openEntry(whereOf(i).id);
    }
    return null;
  }

  focusFirst(sel) { if (hover.matches) requestAnimationFrame(() => this.p.sheet.querySelector(sel)?.focus()); }

  async begin(id) {
    if (!id) return;
    this.asking = false;
    this.listOpen = false;
    this.ctxOpen = false;
    this.train.reset();
    await this.save({ task: id, since: Date.now(), skipped: id === SMALLS ? [] : this.st.skipped, last: null });
    this.p.redraw();
  }

  // After the gate: with "Decide before the next thing" off, the next one starts by itself.
  async after(last) {
    this.asking = false;
    this.ctxOpen = false;
    await this.save({ task: null, since: 0, last });
    await this.p.refresh();
    if (this.off('nowgate')) {
      const m = this.model();
      if (m.cand && !m.active) await this.begin(m.cand.group ? SMALLS : m.cand.item.row.id);
    }
  }

  async done() {
    const m = this.model();
    const cur = m.cur;
    if (!cur) return;
    if (this.train.active(cur)) { await this.train.done(); return; }
    if (!cur.smalls && isLight(cur.item.row)) { await this.light.read(); return; }
    const was = { ...this.st };
    const id = cur.item.row.id;
    await this.p.wrote(await tickTask(id, true));
    const undo = { label: 'Undo', run: async () => { await this.p.wrote(await tickTask(id, false)); await this.save({ task: was.task, since: was.since, skipped: was.skipped, last: was.last }); this.p.redraw(); } };
    if (cur.smalls) {
      const left = cur.items.length - 1;
      if (left > 0) { this.p.hooks.toast?.(`“${clip(cur.name, 40)}” done`, undo); return this.p.redraw(); }
      const skipped = this.st.skipped.length;
      await this.after({ k: 'done', t: 'The small things', left: skipped });
      this.p.hooks.toast?.(`“${clip(cur.name, 40)}” done`, undo);
      return undefined;
    }
    await this.after({ k: 'done', t: cur.name });
    this.p.hooks.toast?.(`“${clip(cur.name, 40)}” done`, undo);
    return undefined;
  }

  async skip() {
    const cur = this.model().cur;
    if (!cur?.smalls) return;
    const skipped = [...this.st.skipped, cur.item.row.id];
    if (cur.items.length > 1) { await this.save({ skipped }); return this.p.redraw(); }
    this.st.skipped = skipped;
    await this.after({ k: 'done', t: 'The small things', left: skipped.length });
    return undefined;
  }

  // Not now: later today, enough for today (worked on, back tomorrow), or another day.
  async aside(where) {
    const m = this.model();
    const cur = m.cur;
    if (!cur) return;
    if (this.train.active(cur) && where !== 'later') { await this.train.aside(where); return; }
    const today = this.p.today;
    const ids = cur.smalls ? cur.items.map((i) => i.row.id) : [cur.item.row.id];
    const was = { ...this.st };
    const last = { k: 'set', t: cur.smalls ? 'The small things' : cur.name, where };
    const back = async () => { await this.save({ task: was.task, since: was.since, skipped: was.skipped, last: was.last }); this.p.redraw(); };
    this.asking = false;
    await this.save({ task: null, since: 0, last });
    if (where === 'later') await this.p.applyWhen(ids, { day: today }, 'later today', { undo: back });
    else if (where === 'tomorrow') {
      await this.p.applyWhen(ids, { day: addDays(today, 1) }, 'tomorrow (worked on today)', {
        undo: back,
        extra: (t) => ({ worked: [...new Set([...(Array.isArray(t?.worked) ? t.worked : []), today])] })
      });
    } else if (where === 'week') {
      const mon = weekOf(today)[0];
      await this.p.applyWhen(ids, { span: { kind: 'week', start: mon } }, 'any day this week', { undo: back });
    } else await this.p.applyWhen(ids, null, '', { undo: back });
    await this.after(last);
  }

  async eventDone(id, happened) {
    const m = this.model();
    const e = m.active;
    if (!e || e.id !== id) return;
    const prev = this.st.task || this.st.last?.prev || null;
    await this.save({ events: { ...this.st.events, [id]: happened ? 'over' : 'missed' }, task: null, since: 0, last: { k: 'event', t: e.title, happened, prev } });
    this.p.redraw();
  }

  // ---------- the two ends of the day (Part 4) ----------

  // Morning: nothing laid out yet (nothing begun or done today, not talked through).
  morning(m) {
    const st = this.st;
    return !this.off('nowtalk') && !st.laid && !st.task && !st.last && !m.dp.done.length;
  }
  // From 5 pm, until the day is closed.
  evening() { return !this.off('nowclose') && new Date().getHours() >= 17 && !this.st.closed; }

  focusIn(sel) { requestAnimationFrame(() => this.p.sheet.querySelector(sel)?.focus()); }

  openTalk() {
    this.mode = 'talk';
    this.talk.note = '';
    this.listOpen = false;
    if (!this.shown) this.p.goTab('now');
    this.p.redraw();
    this.focusIn('.now-say');
  }

  openClose() {
    this.mode = 'close';
    if (!this.shown) this.p.goTab('now');
    this.p.redraw();
    if (hover.matches) this.focusIn('.now-addin');
  }

  endMode() {
    this.mode = null;
    this.talk.note = '';
    this.p.redraw();
  }

  // Words said into the morning mic, once written out: into the box.
  heardWords(text) {
    const t = String(text || '').trim();
    if (!t) return;
    this.talk.text = this.talk.text.trim() ? `${this.talk.text.trim()}\n${t}` : t;
    const box = this.forms.talk?.querySelector('textarea');
    if (box) box.value = this.talk.text;
    if (this.mode !== 'talk') { this.mode = 'talk'; this.p.redraw(); }
  }

  async sendTalk() {
    const words = this.talk.text.trim();
    if (!words || this.talk.busy) return;
    this.talk.busy = true;
    this.talk.note = '';
    this.p.redraw();
    let got = null;
    try { got = await this.p.hooks.talkDay?.(words); } finally { this.talk.busy = false; }
    if (!got || got.error) {
      this.talk.note = got?.error || 'That didn’t go through. Your words are still here.';
      this.p.redraw();
      return;
    }
    this.talk.text = '';
    if (this.forms.talk) this.forms.talk.querySelector('textarea').value = '';
    this.heard = got;
    this.mode = 'heard';
    await this.save({ laid: true });
    this.p.redraw();
  }

  addAlso(input) {
    const t = input?.value.trim();
    if (!t) return;
    this.close.also.push(t);
    input.value = '';
    this.p.redraw();
    input.focus();
  }

  async saveClose() {
    if (this.close.busy) return;
    const c = this.close;
    const pending = this.forms.close?.querySelector('.now-addin')?.value.trim();
    if (pending) c.also.push(pending);
    c.busy = true;
    try {
      await this.p.hooks.closeDay?.({ also: c.also, alive: c.alive, drained: c.drained, first: c.first });
    } finally { c.busy = false; }
    this.close = { also: [], alive: '', drained: '', first: '', busy: false };
    this.forms.close = null;
    this.mode = null;
    await this.save({ closed: true });
    this.p.redraw();
  }

  // ---------- keys (no caret in text) ----------

  key(e) {
    if (!this.shown || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target;
    if (t?.closest?.('input, textarea, select, [contenteditable="true"], .palette, .pop-menu, .ask, .page-settings')) return;
    if (document.querySelector('.ask-backdrop, .pop-menu') || !document.querySelector('.palette')?.hidden) return;
    const m = this.m || this.model();
    const k = e.key.toLowerCase();
    let go = null;
    if (!this.asking && !this.mode) { go = this.pageKey(k, e, m); if (!go) return; }
    else if (this.asking && ['1', '2', '3'].includes(k)) go = () => this.aside(['later', 'tomorrow', 'week'][Number(k) - 1]);
    else if (this.asking && k === '4' && this.train.active(m.cur)) go = () => this.aside('own');
    else if (this.asking && e.key === 'Escape') go = () => { this.asking = false; this.p.redraw(); };
    else if (m.active) return;
    else if (this.light.due(m)) go = this.light.key(k, e);
    else if (this.mode === 'heard' && k === 'b' && m.cand) go = () => { this.mode = null; return this.begin(m.cand.group ? SMALLS : m.cand.item.row.id); };
    else if (this.mode && e.key === 'Escape') go = () => this.endMode();
    else if (this.mode) return;
    else if (k === 't' && !m.cur && this.morning(m)) go = () => this.openTalk();
    else if (k === 'c' && !m.cur && this.evening()) go = () => this.openClose();
    else if (k === 'd' && m.cur) go = () => this.done();
    else if (k === 'n' && m.cur && !this.asking) go = () => { this.asking = true; this.p.redraw(); this.focusFirst('.now-choice'); };
    else if (k === 's' && m.cur?.smalls) go = () => this.skip();
    else if (k === 's' && this.train.active(m.cur) && !this.train.ask) go = () => this.train.move(1, null);
    else if (k === 'b' && !m.cur && m.cand) go = () => this.begin(m.cand.group ? SMALLS : m.cand.item.row.id);
    else if ((k === 'o' || (e.key === 'Enter' && !t?.closest?.('button, a'))) && m.cur && !m.cur.smalls && !this.asking && whereOf(m.cur.item)) go = () => this.openWhere();
    else if (e.key === ' ' && !t?.closest?.('button')) go = () => { this.listOpen = !this.listOpen; this.p.redraw(); };
    if (!go) return;
    e.preventDefault();
    if (this.busy) return;
    this.busy = true;
    Promise.resolve(go()).finally(() => { this.busy = false; });
  }
}

// ---------- Five big things at most ----------

// Something new on today, from Now, the one box or the morning talk: a sixth
// big thing goes to Not planned, with a toast that says so and offers Undo.
// It never blocks a drag in Plan and never shows a count or a warning.
export async function fiveAtMost(plan, row, { off, toast }) {
  if (!row || off('fivebig')) return false;
  const t = taskOf(row);
  const today = isoOf();
  if (!t || t.day !== today || t.small || t.habit || isTraining(row)) return false;
  const big = plan.items.filter((i) => i.mine && !i.row.fields?.done && i.task.day === today && !i.ghost && !isSmall(i) && !isTraining(i.row) && i.row.id !== row.id);
  if (big.length < 5) return false;
  await plan.wrote(await setTask(row.id, { day: null, order: 0 }));
  toast(`Five big things are on today already, so “${clip(row.text, 40)}” waits in Plan under Not planned`, {
    label: 'Undo',
    run: async () => { await plan.wrote(await setTask(row.id, { day: today, order: plan.lastOrder(today) })); toast('It’s on today'); }
  });
  return true;
}
