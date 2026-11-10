// Talk it through. Beside whatever you're on, say what's on your mind about
// a project (or everything on stage, from anywhere else) and Claude answers
// with moves you can tick: a task to another day, a step to add, a project
// to put backstage, a north star to change, a call to set aside until
// tomorrow. Nothing changes until you apply them, and applying can be undone.
// Each project a move touches gets a turn, with your words as the reason.
//
// What Claude is told is what the Desk, the project pages and the plan show:
// your projects with their north stars, calls, crew and open steps, this
// week's load against your free hours, and the conversation so far.

import './talk.css';
import { getEntry, putEntries, byKind, isTrashed } from './db.js';
import { editedAt } from './library.js';
import { seatsFor, deskSettings, saveDeskSettings, DESK_ID, STAGES, tomorrowMorning } from './desk.js';
import { loadTasks, planSettings, moveTask, addTask, stepsHome, isStretch, stretchWord, aheadPlan, isoOf, addDays, dateOf, dayWord, isRepeat, repeatWord } from './tasks.js';

const DAY = 864e5;
const KEEP = 30; // messages kept for each conversation
const TURNS_KEPT = 60;
const STARTERS = {
  all: ['What should give this week?', 'What needs me first?', 'What can go backstage for now?'],
  one: ['What’s the next step here?', 'Is this week’s part of it realistic?', 'What’s in the way?']
};

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
  drop(k) { try { localStorage.removeItem(k); } catch { /* blocked */ } }
};

// ---------- what Claude is told (no page, so it can be checked on its own) ----------

// scope: a project's id, or null for everything on stage. data: the Desk's
// { needs, updates } or null when signed out. Returns { body, known } where
// body goes to Claude and known is what its answer may point at.
export async function talkContext({ scope = null, data = null, now = Date.now(), today = isoOf() }) {
  const [list, settings, tasks, plan] = [await byKind('world'), await deskSettings(), await loadTasks(), await planSettings()];
  const rows = list.filter((w) => !w.deleted && !isTrashed(w));
  const byId = new Map(rows.map((w) => [w.id, w]));
  const worlds = rows.map((w) => ({ id: w.id, title: w.title, color: '', edited: editedAt(w), star: w.fields?.star || '' }));
  const updates = (data?.updates || []).map((u) => ({ ...u, at: u.at || Date.parse(u.created_at) })).sort((a, b) => a.at - b.at);
  const seats = seatsFor({ worlds, needs: data?.needs || [], updates, settings, now });
  const mine = seats.filter((s) => (scope ? s.world?.id === scope : s.stage === 'on' || s.calls.length)).slice(0, 12);
  const known = { tasks: new Map(), worlds: new Map(), calls: new Map(), settings };
  const open = tasks.filter((i) => !i.row.fields?.done && i.mine);
  // A stretch of work says its last day too; a date to hit says whether it can move.
  const step = (i) => {
    known.tasks.set(i.row.id, i);
    return { id: i.row.id, text: clip(i.row.text, 140), day: i.task.day || '', minutes: i.task.est || 0, ...(isStretch(i.task) ? { until: i.task.until } : {}), ...(i.task.mark ? { date_to_hit: i.task.mark === 'hard' ? 'cannot move' : 'can move' } : {}), ...(isRepeat(i.task) ? { repeats: repeatWord(i.task.repeat), ...(i.task.habit ? { habit: true } : {}) } : {}) };
  };
  const projects = mine.map((seat) => {
    const w = seat.world ? byId.get(seat.world.id) : null;
    if (w) known.worlds.set(w.id, { row: w, seat });
    for (const c of seat.calls) known.calls.set(c.id, c);
    const steps = w ? open.filter((i) => i.world?.id === w.id) : [];
    return {
      id: w?.id || '',
      name: clip(seat.name, 80),
      kind: w ? (w.fields?.life ? 'life project' : 'story project') : 'a Claude project with no page in Inkwell',
      sits: STAGES[seat.stage],
      north_star: clip(w?.fields?.star, 240),
      now: clip(w?.fields?.now || seat.last?.text, 240),
      comes_back: clip(w?.fields?.back, 120),
      needs_you: seat.calls.slice(0, 12).map((c) => ({ id: c.id, kind: c.kind === 'review' ? 'try it' : c.kind, title: clip(c.title, 140), waiting_days: Math.max(0, Math.floor((now - c.at) / DAY)) })),
      crew: seat.crew.slice(0, 6).map((c) => clip(c.title, 80)),
      steps: steps.slice(0, 40).map(step),
      steps_done: w ? tasks.filter((i) => i.world?.id === w.id && i.row.fields?.done).length : 0
    };
  });
  // Everything else that sits somewhere, by name only, so it can be weighed.
  const others = seats.filter((s) => !mine.includes(s)).slice(0, 30).map((s) => ({ name: clip(s.name, 80), sits: STAGES[s.stage] }));
  // Tasks that aren't in any project, for the next two weeks or not on a day.
  const loose = open.filter((i) => !i.world && (!i.task.day || i.task.day <= addDays(today, 14))).slice(0, 40).map(step);
  const week = [];
  for (let n = 0; n < 7; n++) {
    const day = addDays(today, n);
    const on = open.filter((i) => i.task.day === day && !isStretch(i.task));
    week.push({ day, weekday: dateOf(day).toLocaleDateString('en-US', { weekday: 'long' }), planned_minutes: on.reduce((m, i) => m + (i.task.habit ? 0 : i.task.est || 0), 0), tasks: on.length });
  }
  const overdue = open.filter((i) => i.task.day && i.task.day < today && !isStretch(i.task)).length;
  // The six weeks Weeks ahead shows, with the hours planned in each.
  const ahead = aheadPlan(tasks, { today, free: plan.free }).weeks.map((w) => ({ week_of: w.iso, planned_minutes: w.min }));
  const body = {
    mode: 'talk',
    now: new Date(now).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    today,
    about: scope ? clip(byId.get(scope)?.title, 80) || 'this project' : '',
    free_hours_a_week: plan.free,
    week,
    weeks_ahead: ahead,
    overdue_tasks: overdue,
    projects,
    other_projects: others,
    other_tasks: loose
  };
  return { body, known };
}

// What came back, kept only where it points at something real, with words
// of our own when Claude gave none. → [{ type, …, label, why, on }]
export function checkMoves(moves, known, today = isoOf()) {
  const out = [];
  const seen = new Set();
  const isDay = (d) => /^\d{4}-\d\d-\d\d$/.test(d || '');
  for (const m of Array.isArray(moves) ? moves.slice(0, 12) : []) {
    if (!m || typeof m !== 'object') continue;
    const say = (label) => clip(m.label, 160) || label;
    const base = { why: clip(m.why, 200), on: m.on !== false };
    let move = null;
    if (m.type === 'move_task') {
      const i = known.tasks.get(m.task);
      const day = isDay(m.day) ? m.day : null;
      // A date that can't move doesn't.
      if (!i || i.task.mark === 'hard' || (i.task.day || null) === day || (day && day < today)) continue;
      move = { type: 'move_task', task: m.task, day, label: say(day ? `Move “${clip(i.row.text, 80)}” to ${isStretch(i.task) ? `start ${dayWord(day, today)}` : dayWord(day, today)}` : `Take “${clip(i.row.text, 80)}” off its day`) };
    } else if (m.type === 'add_step') {
      const w = known.worlds.get(m.project);
      const text = clip(m.text, 200);
      const day = isDay(m.day) && m.day >= today ? m.day : null;
      if (!w || !text) continue;
      // With a last day it's a stretch of work: a bar in Weeks ahead.
      const until = day && isDay(m.until) && m.until > day && m.until <= addDays(day, 180) ? m.until : null;
      move = { type: 'add_step', project: m.project, text, day, until, est: until ? null : Number(m.minutes) > 0 ? Math.min(Math.round(Number(m.minutes)), 600) : null, label: say(until ? `Add “${text}” to ${w.row.title || 'the project'}, ${stretchWord({ day, until })}` : `Add “${text}” to ${w.row.title || 'the project'}`) };
    } else if (m.type === 'set_stage') {
      const w = known.worlds.get(m.project);
      if (!w || !(m.stage in STAGES) || w.seat.stage === m.stage) continue;
      move = { type: 'set_stage', project: m.project, stage: m.stage, text: m.stage === 'back' ? clip(m.text, 120) : '', label: say(`Put ${w.row.title || 'it'} ${STAGES[m.stage].toLowerCase()}`) };
    } else if (m.type === 'set_star') {
      const w = known.worlds.get(m.project);
      const text = clip(m.text, 240);
      if (!w || !text || text === (w.row.fields?.star || '')) continue;
      move = { type: 'set_star', project: m.project, text, label: say(`North star for ${w.row.title || 'it'}: ${text}`) };
    } else if (m.type === 'call_later') {
      const c = known.calls.get(m.call);
      if (!c) continue;
      move = { type: 'call_later', call: m.call, label: say(`Set “${clip(c.title, 80)}” aside until tomorrow morning`) };
    }
    if (!move) continue;
    const key = JSON.stringify([move.type, move.task, move.project, move.call, move.day, move.stage, move.text, move.until]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...move, ...base });
  }
  return out;
}

// Does the moves. → { rows, undo } where rows are what changed (for the
// pages that show them) and undo() puts every one of them back.
export async function applyMoves(moves, { words = '', later = null, now = Date.now() } = {}) {
  const before = new Map(); // id → the row as it was (null: it wasn't there)
  const touch = async (id) => { if (!before.has(id)) before.set(id, (await getEntry(id)) || null); };
  const calls = [];
  const turns = new Map(); // world id → what was done there
  const turn = (id, text) => { if (id) turns.set(id, [...(turns.get(id) || []), text]); };
  let done = 0;
  for (const m of moves) {
    try {
      if (m.type === 'move_task') {
        await touch(m.task);
        const all = await loadTasks();
        const me = all.find((i) => i.row.id === m.task);
        if (!me) continue;
        const order = Math.max(0, ...all.filter((i) => (i.task.day || null) === m.day).map((i) => i.task.order || 0)) + 1;
        await moveTask(m.task, m.day, order);
        turn(me.world?.id, m.label);
      } else if (m.type === 'add_step') {
        const w = await getEntry(m.project);
        if (!w || w.deleted) continue;
        const home = stepsHome(w);
        await touch(home.id);
        const order = Math.max(0, ...(await loadTasks()).filter((i) => (i.task.day || null) === m.day).map((i) => i.task.order || 0)) + 1;
        const rows = await addTask({ text: m.text, day: m.day, est: m.est, order, home, until: m.until || null });
        for (const r of rows) if (!before.has(r.id)) before.set(r.id, null);
        turn(w.id, m.label);
      } else if (m.type === 'set_stage') {
        await touch(DESK_ID);
        const s = await deskSettings();
        await saveDeskSettings({ stage: { ...s.stage, [`w:${m.project}`]: m.stage } });
        if (m.stage === 'back' && m.text) {
          await touch(m.project);
          const w = await getEntry(m.project);
          if (w) await putEntries([{ ...w, fields: { ...w.fields, back: m.text }, updated_at: Date.now() }]);
        }
        turn(m.project, m.label);
      } else if (m.type === 'set_star') {
        await touch(m.project);
        const w = await getEntry(m.project);
        if (!w) continue;
        await putEntries([{ ...w, fields: { ...w.fields, star: m.text }, updated_at: Date.now() }]);
        turn(m.project, m.label);
      } else if (m.type === 'call_later') {
        if (!later) continue;
        await later(m.call, new Date(tomorrowMorning(now)).toISOString());
        calls.push(m.call);
      }
      done += 1;
    } catch (e) { console.warn(e); }
  }
  // A turn on each project touched: what changed, and why in your words.
  for (const [id, texts] of turns) {
    await touch(id);
    const w = await getEntry(id);
    if (!w) continue;
    const mine = [...(w.fields?.turns || []), { at: now, text: texts.join('. ').slice(0, 400), why: clip(words, 300) }].slice(-TURNS_KEPT);
    await putEntries([{ ...w, fields: { ...w.fields, turns: mine }, updated_at: Date.now() }]);
  }
  const rows = (await Promise.all([...before.keys()].map((id) => getEntry(id)))).filter(Boolean);
  const undo = async () => {
    const back = [];
    for (const [id, was] of before) {
      const cur = await getEntry(id);
      if (was) back.push({ ...was, updated_at: Date.now() });
      else if (cur) back.push({ ...cur, deleted: true, updated_at: Date.now() });
    }
    if (back.length) await putEntries(back);
    for (const id of calls) { try { await later(id, null); } catch (e) { console.warn(e); } }
    return back;
  };
  return { rows, undo, done, calls };
}

// ---------- the page (in the Beside pane) ----------

export class Talk {
  // hooks: scope() → the project the main window is in ({ id, title }) or
  // null; fetch(sinceIso) → the Desk's data or null; ask(body) and canAsk();
  // later(id, iso); changed(rows); toast(text, action); shown(); named().
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.scope = null;
    this.msgs = [];
    this.busy = false;
    this.failed = '';
    this.known = null;
    el.addEventListener('click', (e) => this.click(e));
    el.addEventListener('change', (e) => {
      const box = e.target.closest?.('input[data-move]');
      if (!box) return;
      const [mi, i] = box.dataset.move.split(':').map(Number);
      const m = this.msgs[mi]?.moves?.[i];
      if (m) { m.on = box.checked; this.save(); this.drawApply(mi); }
    });
    el.addEventListener('keydown', (e) => {
      if (e.target.closest?.('.tt-ask textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
    });
    el.addEventListener('input', (e) => { const t = e.target.closest?.('.tt-ask textarea'); if (t) { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 160)}px`; } });
  }

  get key() { return `talk:${this.scope?.id || 'all'}`; }
  get title() { return this.scope ? this.scope.title || 'Untitled' : 'Everything on stage'; }
  save() { ls.set(this.key, this.msgs.slice(-KEEP)); }

  async show() {
    await this.place();
    this.render();
    this.el.querySelector('.tt-ask textarea')?.focus({ preventScroll: true });
  }

  // Which project this is about: the one the main window is in.
  async place() {
    const scope = (await this.hooks.scope()) || null;
    if ((scope?.id || null) === (this.scope?.id || null) && this.loaded) { this.scope = scope; return false; }
    this.scope = scope;
    this.loaded = true;
    this.failed = '';
    const kept = ls.get(this.key);
    this.msgs = Array.isArray(kept) ? kept.filter((m) => m && (m.who === 'me' || m.who === 'claude') && typeof m.text === 'string') : [];
    return true;
  }

  // The main window went somewhere else: the talk follows, unless Claude is mid-answer.
  async mainMoved() {
    if (this.busy || !this.hooks.shown()) return;
    const held = this.el.querySelector('.tt-ask textarea')?.value || '';
    if (await this.place()) { this.render(); const t = this.el.querySelector('.tt-ask textarea'); if (t && held) t.value = held; }
  }

  render() {
    const head = make('header', 'sn-head tt-head');
    const titles = make('div');
    titles.append(make('div', 'sn-eyebrow', 'Talk it through'), make('h1', '', this.title));
    head.append(titles);
    if (this.msgs.length) {
      const over = make('button', 'wp-link tt-over', 'Start over');
      over.dataset.act = 'over';
      head.append(over);
    }
    const thread = make('div', 'tt-thread');
    thread.setAttribute('aria-live', 'polite');
    if (!this.msgs.length) {
      thread.append(make('p', 'tt-hint', this.scope
        ? 'Say what’s on your mind about this project. Claude answers with moves you can tick; nothing changes until you apply them.'
        : 'Say what’s on your mind about the week or anything on stage. Claude answers with moves you can tick; nothing changes until you apply them.'));
      const starts = make('div', 'tt-starts');
      for (const s of STARTERS[this.scope ? 'one' : 'all']) { const b = make('button', 'tt-start', s); b.dataset.act = 'start'; starts.append(b); }
      thread.append(starts);
    }
    this.msgs.forEach((m, mi) => thread.append(...this.message(m, mi)));
    if (this.busy) thread.append(make('p', 'tt-wait', 'Thinking it through…'));
    if (this.failed) {
      const p = make('p', 'tt-fail', `${this.failed} `);
      const again = make('button', 'wp-link', 'Try again');
      again.dataset.act = 'again';
      p.append(again);
      thread.append(p);
    }
    const ask = make('form', 'tt-ask');
    const input = make('textarea');
    input.rows = 1;
    input.placeholder = 'Say or type what’s on your mind';
    input.setAttribute('aria-label', 'Say what’s on your mind');
    input.disabled = this.busy;
    ask.append(input);
    ask.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    this.el.replaceChildren(head, thread, ask);
    this.hooks.named?.();
    // The page itself scrolls. Go to the end once the Apply rows are drawn
    // (they come a moment after), so the newest answer's button is in view.
    if (this.msgs.length) queueMicrotask(() => {
      const page = document.scrollingElement;
      if (page && document.documentElement.dataset.view === 'talk') page.scrollTop = page.scrollHeight;
    });
  }

  message(m, mi) {
    if (m.who === 'me') return [make('p', 'tt-me', m.text)];
    const p = make('p', 'tt-cl');
    const mark = make('span', 'wp-claude', '✦');
    mark.title = 'Claude';
    p.append(mark, document.createTextNode(m.text));
    const out = [p];
    if (m.moves?.length) {
      const box = make('div', 'tt-moves');
      box.dataset.msg = String(mi);
      m.moves.forEach((mv, i) => {
        const row = make('label', `tt-move${m.applied ? ' applied' : ''}`);
        const tick = make('input');
        tick.type = 'checkbox';
        tick.checked = !!mv.on;
        tick.disabled = !!m.applied || !!m.gone;
        tick.dataset.move = `${mi}:${i}`;
        const words = make('span', 'tt-move-t', mv.label);
        if (mv.why) words.append(make('small', '', mv.why));
        row.append(tick, words);
        box.append(row);
      });
      const foot = make('div', 'tt-apply');
      foot.dataset.msg = String(mi);
      box.append(foot);
      out.push(box);
      queueMicrotask(() => this.drawApply(mi));
    }
    return out;
  }

  // The button under a set of moves: how many are ticked, or what happened.
  drawApply(mi) {
    const foot = this.el.querySelector(`.tt-apply[data-msg="${mi}"]`);
    const m = this.msgs[mi];
    if (!foot || !m) return;
    if (m.applied) { foot.replaceChildren(make('span', 'tt-note', m.applied)); return; }
    if (m.gone) { foot.replaceChildren(make('span', 'tt-note', 'These were for an earlier answer.')); return; }
    const n = m.moves.filter((x) => x.on).length;
    const b = make('button', 'pill primary tt-go', n === 1 ? 'Apply 1 move' : `Apply ${n} moves`);
    b.dataset.act = 'apply';
    b.dataset.msg = String(mi);
    b.disabled = !n || this.applying;
    foot.replaceChildren(b, make('span', 'tt-note', 'Nothing changes until you do. Each one can be undone.'));
  }

  click(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'start') { const t = this.el.querySelector('.tt-ask textarea'); t.value = el.textContent; this.send(); }
    if (act === 'over') { this.msgs = []; this.failed = ''; ls.drop(this.key); this.render(); this.el.querySelector('.tt-ask textarea')?.focus(); }
    if (act === 'again') this.answer();
    if (act === 'apply') this.apply(Number(el.dataset.msg));
  }

  async send() {
    const input = this.el.querySelector('.tt-ask textarea');
    const text = (input?.value || '').trim();
    if (!text || this.busy) return;
    // Moves from an earlier answer that were never applied no longer stand.
    for (const m of this.msgs) if (m.moves?.length && !m.applied) m.gone = true;
    this.msgs.push({ who: 'me', text: text.slice(0, 2000), at: Date.now() });
    this.save();
    await this.answer();
  }

  async answer() {
    if (this.busy) return;
    if (!this.hooks.canAsk()) { this.failed = 'Sign in (the sync button at the top) and Claude can talk it through with you.'; this.render(); return; }
    this.busy = true;
    this.failed = '';
    this.render();
    const scope = this.scope;
    try {
      let data = null;
      try { data = await this.hooks.fetch(new Date(Date.now() - 14 * DAY).toISOString()); } catch (e) { console.warn(e); }
      const { body, known } = await talkContext({ scope: scope?.id || null, data });
      body.said = this.msgs.slice(-12).map((m) => ({ who: m.who === 'me' ? 'me' : 'claude', text: clip(m.text, 2000) }));
      const got = await this.hooks.ask(body);
      if (got?.error) throw new Error(got.error);
      const say = clip(got?.say, 1600);
      if (!say) throw new Error('No answer came back.');
      this.known = known;
      if ((this.scope?.id || null) === (scope?.id || null)) {
        this.msgs.push({ who: 'claude', text: say, moves: checkMoves(got.moves, known), at: Date.now() });
        this.save();
      }
    } catch (e) {
      console.warn(e);
      const said = String(e?.message || '');
      // An older server doesn't know this yet and asks for a paragraph.
      this.failed = /paragraph|mode/i.test(said) ? 'Claude can’t talk it through yet: this arrives with the next update.' : /busy|minute|too much|wouldn|cut off|whole|try again/i.test(said) ? said : 'Couldn’t reach Claude just now.';
    }
    this.busy = false;
    this.render();
    if (!this.failed) this.el.querySelector('.tt-ask textarea')?.focus({ preventScroll: true });
  }

  async apply(mi) {
    const m = this.msgs[mi];
    if (!m || m.applied || m.gone || this.applying) return;
    const picked = m.moves.filter((x) => x.on);
    if (!picked.length) return;
    this.applying = true;
    this.drawApply(mi);
    const words = [...this.msgs.slice(0, mi)].reverse().find((x) => x.who === 'me')?.text || '';
    let got = null;
    try { got = await applyMoves(picked, { words, later: this.hooks.later }); } catch (e) { console.warn(e); }
    this.applying = false;
    if (!got || !got.done) { this.hooks.toast?.('Couldn’t apply those just now. Nothing changed.'); this.drawApply(mi); return; }
    const said = got.done === 1 ? 'Applied 1 move' : `Applied ${got.done} moves`;
    m.applied = `${said} · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
    m.moves = m.moves.map((x) => ({ ...x, on: picked.includes(x) }));
    this.save();
    this.render();
    await this.hooks.changed?.(got.rows, { calls: got.calls.length > 0 });
    this.hooks.toast?.(said, {
      label: 'Undo',
      run: async () => {
        const back = await got.undo();
        m.applied = '';
        this.save();
        if (this.hooks.shown()) this.render();
        await this.hooks.changed?.(back, { calls: got.calls.length > 0 });
        this.hooks.toast?.('Put back as it was');
      }
    });
  }
}
