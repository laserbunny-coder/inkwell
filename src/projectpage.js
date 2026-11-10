// A project's page, the part that comes from the Desk: where it sits (on
// stage, in the wings, backstage), its north star, where it stands now, its
// next date, what needs you, who's working on it (crew) and how it got here
// (turns). The pieces and the steps are drawn by main.js and plan.js; this
// fills the rest. Signed out, it shows what Inkwell knows by itself.

import './project.css';
import { getEntry, putEntries } from './db.js';
import { popMenu } from './menu.js';
import { seatsFor, deskSettings, saveDeskSettings, STAGES, when, shortDay, web } from './desk.js';

const DAY = 864e5;
// How far back Turns looks.
const TURN_DAYS = 60;
const TURNS = 5;
// The Desk's data is asked for again after this long.
const FRESH = 60000;

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};

export class ProjectPage {
  // els: { seat, facts, calls, crew, turns }. hooks: fetch(sinceIso) →
  // { needs, updates } or null; call(c, now) → the row for one thing that
  // needs you (the Desk's own); go(place); changed(rows); showing(id) → is
  // this project's page the one on screen.
  constructor(els, hooks) {
    this.els = els;
    this.hooks = hooks;
    this.data = null;
    this.at = 0;
    this.world = null;
    this.facts = {};
  }

  // facts: { color, edited, last: { title, at, run } | null,
  //   date: { word, text, run } | null }
  async show(world, facts = {}) {
    this.world = world;
    this.facts = facts;
    await this.draw();
    if (Date.now() - this.at < FRESH) return;
    const id = world.id;
    let data = null;
    try { data = await this.hooks.fetch(new Date(Date.now() - TURN_DAYS * DAY).toISOString()); } catch (e) { console.warn(e); return; }
    if (!data) { if (this.data) { this.data = null; if (this.world?.id === id && this.hooks.showing(id)) await this.draw(); } return; }
    this.data = { needs: data.needs || [], updates: (data.updates || []).map((u) => ({ ...u, at: Date.parse(u.created_at) })).sort((a, b) => a.at - b.at) };
    this.at = Date.now();
    if (this.world?.id === id && this.hooks.showing(id)) await this.draw();
  }

  // A step moved to another day or got ticked: the next date may be another.
  setDate(date) {
    if ((this.facts.date?.iso || '') + (this.facts.date?.text || '') === (date?.iso || '') + (date?.text || '')) return;
    this.facts = { ...this.facts, date };
    if (this.seat) this.drawFacts(this.seat, Date.now());
  }

  // A call was answered, or the project moved on the Desk: ask again.
  stale() { this.at = 0; }

  async draw() {
    const w = this.world;
    if (!w) return;
    const now = Date.now();
    const settings = await deskSettings();
    const data = this.data || { needs: [], updates: [] };
    const info = { id: w.id, title: w.title, color: this.facts.color, edited: this.facts.edited || w.updated_at || 0, star: w.fields?.star || '' };
    const seat = seatsFor({ worlds: [info], needs: data.needs, updates: data.updates, settings, now }).find((s) => s.key === `w:${w.id}`);
    if (!seat || this.world !== w) return;
    this.seat = seat;
    this.settings = settings;
    this.drawSeat(seat);
    this.drawFacts(seat, now);
    this.drawCalls(seat, now);
    this.drawCrew(seat, now);
    this.drawTurns(seat, now);
  }

  // Where it sits on the Desk; a click moves it.
  drawSeat(seat) {
    const b = this.els.seat;
    b.textContent = STAGES[seat.stage];
    b.title = 'Where it sits on the Desk';
    b.onclick = () => {
      const put = (stage) => async () => {
        const next = { ...this.settings.stage };
        if (stage) next[seat.key] = stage; else delete next[seat.key];
        const row = await saveDeskSettings({ stage: next });
        await this.draw();
        this.hooks.changed?.([row]);
      };
      const items = Object.entries(STAGES).map(([id, label]) => ({ label, current: seat.stage === id, run: put(id) }));
      if (seat.pinned) items.push({ label: 'Let Inkwell decide', run: put(null) });
      popMenu(b, items);
    };
  }

  // A line of the project's own that you write right on the page. save(said,
  // row) → the fields to change (null: nothing to save); by default the
  // words go in fields[key].
  field(key, text, ph, label, { tag = 'dd', save = null } = {}) {
    const w = this.world;
    const el = make(tag, 'wp-edit', text);
    el.contentEditable = 'plaintext-only';
    el.spellcheck = false;
    el.dataset.ph = ph;
    el.dataset.field = key;
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-label', label);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); el.blur(); } });
    el.addEventListener('blur', async () => {
      const said = el.textContent.replace(/\s+/g, ' ').trim();
      if (!said) el.textContent = '';
      const row = await getEntry(w.id);
      if (!row) return;
      const patch = save ? save(said, row) : said === (row.fields?.[key] || '') ? null : { [key]: said };
      if (patch) {
        const next = { ...row, fields: { ...row.fields, ...patch }, updated_at: Date.now() };
        await putEntries([next]);
        if (this.world?.id === w.id) this.world = next;
        this.hooks.changed?.([next]);
      }
      // What shows may be something else now (Claude's line again, say).
      if (save && this.world?.id === w.id && this.seat) this.drawFacts(this.seat, Date.now());
    });
    return el;
  }

  // Now: where it stands. Your own words, or the last thing a Claude thread
  // said, whichever is newer; with neither, where you last wrote.
  nowRow(seat, now) {
    const w = this.world;
    const mine = w.fields?.now ? { text: w.fields.now, at: w.fields.now_at || 0 } : null;
    const theirs = seat.last || null;
    const yours = mine && (!theirs || mine.at >= theirs.at);
    const shown = yours ? mine.text : theirs?.text || '';
    const dd = make('dd', 'wp-now');
    const words = () => this.field('now', shown, 'Where does it stand?', `Where ${w.title || 'this project'} stands now`, {
      tag: 'span',
      // Claude's line left as it is stays Claude's; your own words carry the time you wrote them.
      save: (said, row) => (said === shown ? null : said ? { now: said, now_at: Date.now() } : row.fields?.now ? { now: '', now_at: 0 } : null)
    });
    if (shown) {
      if (!yours) { const mark = make('span', 'wp-claude', '✦'); mark.title = 'Written by a Claude thread. Type over it to say it your way.'; dd.append(mark); }
      dd.append(words(), document.createTextNode(' '));
      if (yours) dd.append(make('span', 'wp-when', when(mine.at, now)));
      else {
        const a = make('a', 'wp-when', when(theirs.at, now));
        a.href = web(theirs.link); a.target = '_blank'; a.rel = 'noopener';
        a.title = theirs.thread ? `Open “${theirs.thread}” in Claude` : 'Open the thread in Claude';
        dd.append(a);
      }
      return dd;
    }
    const last = this.facts.last;
    if (!last) { dd.append(words()); return dd; }
    const b = make('button', 'wp-inline', last.title);
    b.addEventListener('click', (e) => { e.stopPropagation(); last.run(); });
    dd.append(document.createTextNode('Last written in '), b, document.createTextNode(' '), make('span', 'wp-when', when(last.at, now)));
    // A click on the line itself is the way to say it in your own words.
    dd.title = 'Click to write where it stands';
    dd.addEventListener('click', () => {
      if (dd.querySelector('.wp-edit')) return;
      const el = words();
      dd.title = '';
      dd.replaceChildren(el);
      el.focus();
    });
    return dd;
  }

  drawFacts(seat, now) {
    const dl = this.els.facts;
    // Someone is writing in it: don't pull the words out from under them.
    if (dl.querySelector('.wp-edit:focus')) return;
    const w = this.world;
    const rows = [];
    rows.push(make('dt', '', 'North star'), this.field('star', w.fields?.star || '', 'What is this for?', `North star for ${w.title || 'this project'}`));
    rows.push(make('dt', '', 'Now'), this.nowRow(seat, now));
    const date = this.facts.date;
    if (date) {
      const dd = make('dd');
      const b = make('button', 'wp-inline', `${date.word} · ${date.text}`);
      b.addEventListener('click', date.run);
      dd.append(b);
      rows.push(make('dt', '', 'Next date'), dd);
    }
    if (seat.stage === 'back') rows.push(make('dt', '', 'Backstage'), this.field('back', w.fields?.back || '', 'When does it come back?', `When ${w.title || 'this project'} comes back`));
    dl.replaceChildren(...rows);
  }

  head(text, more) {
    const h = make('h2', 'wp-sec', text);
    if (more) h.append(make('span', 'wp-more', more));
    return h;
  }

  drawCalls(seat, now) {
    const el = this.els.calls;
    el.hidden = !seat.calls.length;
    if (el.hidden) { el.replaceChildren(); return; }
    const box = make('div', 'wp-rows');
    for (const c of seat.calls) box.append(this.hooks.call(c, now));
    el.replaceChildren(this.head('Needs you'), box);
  }

  drawCrew(seat, now) {
    const el = this.els.crew;
    el.hidden = !seat.crew.length;
    if (el.hidden) { el.replaceChildren(); return; }
    const box = make('div', 'wp-rows');
    for (const c of seat.crew) {
      const row = make('a', 'dk-crew');
      row.href = web(c.link); row.target = '_blank'; row.rel = 'noopener';
      row.title = 'Open the thread in Claude';
      row.append(make('i', `dk-pulse${c.quiet ? ' off' : ''}`), make('span', 'dk-crew-t', c.title), make('span', 'dk-crew-s', c.quiet ? `quiet since ${shortDay(c.at)}` : when(c.at, now)));
      box.append(row);
    }
    el.replaceChildren(this.head('Crew', 'Claude threads working on it'), box);
  }

  drawTurns(seat) {
    const el = this.els.turns;
    el.hidden = !seat.turns.length;
    if (el.hidden) { el.replaceChildren(); return; }
    const h = this.head('Turns', 'how this project got here');
    const all = make('button', 'wp-link wp-r', 'All in History');
    all.addEventListener('click', () => this.hooks.history(seat.claude[0] || seat.name));
    h.append(all);
    const box = make('div', 'wp-rows');
    for (const u of seat.turns.slice(0, TURNS)) {
      const row = make('a', 'wp-turn');
      row.href = web(u.link); row.target = '_blank'; row.rel = 'noopener';
      row.title = u.thread ? `Open “${u.thread}” in Claude` : 'Open the thread in Claude';
      row.append(make('span', 'wp-date', shortDay(u.at)), make('span', '', u.text));
      if (u.state === 'live') row.append(make('span', 'wp-live', 'Live'));
      box.append(row);
    }
    el.replaceChildren(h, box);
  }
}
