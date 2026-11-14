// The Desk: every project on one page, with what needs you and who is
// working on it. Its second view, History, is every Claude thread there has
// ever been, newest first, so a closed one is never lost.
//
// Two things feed it besides your own projects, both kept in Daybook's side of
// the shared database:
// - Needs you items ("calls"), which every Claude thread raises when it needs
//   a decision, is blocked on you, or has something ready to try.
// - Updates: one line a thread logs each time it posts a result, with whether
//   it's done, live or still working, and where it lives.
// A Claude project and an Inkwell project with the same name share a seat; any
// other pair can be tied by hand. Where a project sits (on stage, in the
// wings, backstage) is worked out from what's happening unless you say.

import { getEntry, putEntries, byKind } from './db.js';
import { entry } from './model.js';
import { areas, areaColor, editedAt } from './library.js';
import { popMenu } from './menu.js';
import { deskDrags, inOrder, mergeOrder } from './deskdrag.js';

export const DESK_ID = 'settings-desk';
const KIND = { decision: 'Decide', blocked: 'Do', review: 'Try' };
// A rough guess at what a call costs you, so the total means something.
const MINUTES = { decision: 2, blocked: 5, review: 10 };
const SPANS = { today: 'Today', two: 'Since yesterday', week: 'This week' };
export const STAGES = { on: 'On stage', wings: 'In the wings', back: 'Backstage' };
const FILTERS = [['all', 'Everything'], ['waiting', 'Waiting on you'], ['loose', 'Closed with loose ends'], ['working', 'Working'], ['quiet', 'Gone quiet'], ['finished', 'Finished']];
const STATUS = { waiting: 'Waiting on you', loose: 'Closed, still open', working: 'Working', quiet: 'Gone quiet', finished: 'Finished' };
// A thread is closed when its latest Catch-up line starts "Closed:"; any later line reopens it.
export const closedLine = (text) => /^\s*closed:/i.test(String(text || ''));
// The "thread closed" tag and the filter can be switched off under Look.
const showClosed = () => !root.classList.contains('hide-closedtag');
const PACIFIC = 'America/Los_Angeles';
const DAY = 864e5;
// A thread that said "working" and then nothing for this long has gone quiet.
const QUIET_AFTER = 3 * DAY;
// How far back the stage looks for crew and for what's moving.
const WINDOW_DAYS = 14;
// More things to try than this on one project fold into one line.
const FOLD_TRIES = 3;

const root = document.documentElement;
const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const ls = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* full or blocked */ } }
};
const low = (s) => String(s || '').trim().toLowerCase();

// Times as the person reads them.
const tz = () => (globalThis.__deskTz || Intl.DateTimeFormat().resolvedOptions().timeZone || PACIFIC);
const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz() }).toLowerCase().replace(/\s/g, ' ');
const dayLabel = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz() });
export const shortDay = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz() });
const localDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz() });
// Midnight where the person is, n days back, as a time.
function midnight(now, daysBack = 0) {
  const d = localDate(now - daysBack * DAY);
  // Walk back from noon UTC that day to the local midnight: exact across clock changes.
  let t = Date.parse(`${d}T12:00:00Z`);
  const hour = Number(new Date(t).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz() })) % 24;
  t -= hour * 36e5;
  const min = Number(new Date(t).toLocaleString('en-US', { minute: 'numeric', timeZone: tz() }));
  return t - min * 6e4;
}
// Tomorrow at 7 am local: where Later puts something.
export function tomorrowMorning(now = Date.now()) { return midnight(now) + DAY + 7 * 36e5; }

// "today", "1 day", "4 days": how long something has waited.
const waited = (ms, now) => {
  const days = Math.floor((now - ms) / DAY);
  return days >= 1 ? (days === 1 ? '1 day' : `${days} days`) : 'today';
};
// "12 min ago", "3 h ago", "yesterday", "Nov 5".
export function when(ms, now) {
  const mins = Math.round((now - ms) / 6e4);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (localDate(ms) === localDate(now)) return `${Math.round(mins / 60)} h ago`;
  if (localDate(ms) === localDate(now - DAY)) return 'yesterday';
  return shortDay(ms);
}
export const minutes = (m) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);

// "Inkwell" for an Inkwell link, "Daybook" for Daybook's, else the site's name.
function placeName(url) {
  try {
    const u = new URL(url);
    if (/claude\.ai$/.test(u.hostname) && /artifact/.test(u.pathname)) return 'Guide';
    if (/inkwell/i.test(u.hostname + u.pathname) || u.searchParams.has('open')) return 'Inkwell';
    if (/daybook/i.test(u.hostname + u.pathname)) return 'Daybook';
    return u.hostname.replace(/^www\./, '');
  } catch { return 'Open'; }
}
// Only ever a web address: what a thread logged is data, not something to run.
export const web = (url) => (/^https?:\/\//i.test(String(url || '')) ? url : '#');
const linksIn = (text) => [...new Set((text || '').match(/https?:\/\/[^\s)>\]]+/g) || [])];

// ---------- working it out (no page, so it can be checked on its own) ----------

// The Desk's own settings: where you've put things, and which Claude project
// belongs with which Inkwell project.
export async function deskSettings() {
  const row = await getEntry(DESK_ID);
  const f = row && !row.deleted ? row.fields || {} : {};
  return { stage: f.stage || {}, ties: f.ties || {}, order: f.order || {} };
}
export async function saveDeskSettings(next) {
  const prev = await getEntry(DESK_ID);
  const row = { ...(prev || entry('settings', { id: DESK_ID, title: 'Desk' })), fields: { ...((!prev?.deleted && prev?.fields) || {}), ...next }, deleted: false, updated_at: Date.now() };
  await putEntries([row]);
  return row;
}

// Each thread's lines, oldest first, keyed by the thread's address.
function threadsOf(updates) {
  const by = new Map();
  for (const u of updates) { if (!by.has(u.link)) by.set(u.link, []); by.get(u.link).push(u); }
  return by;
}

// The seats at the desk: one per project, yours and Claude's joined where
// they're the same thing. worlds: [{ id, title, color, edited, star }].
export function seatsFor({ worlds, needs, updates, settings, now }) {
  const seats = new Map();
  const byTitle = new Map(worlds.map((w) => [low(w.title), w]));
  const byId = new Map(worlds.map((w) => [w.id, w]));
  const blank = (key) => ({ key, world: null, name: '', color: '', claude: [], link: '', calls: [], later: [], crew: [], turns: [], finished: 0, last: null, at: 0 });
  for (const w of worlds) seats.set(`w:${w.id}`, { ...blank(`w:${w.id}`), world: w, name: w.title || 'Untitled', color: w.color, at: w.edited || 0 });
  // The seat a Claude project's things go to.
  const seatOf = (project, link) => {
    const name = String(project || '').trim() || 'Claude';
    const world = byId.get(settings.ties[low(name)]) || byTitle.get(low(name));
    const key = world ? `w:${world.id}` : `c:${low(name)}`;
    if (!seats.has(key)) seats.set(key, { ...blank(key), name });
    const seat = seats.get(key);
    if (!seat.claude.includes(name)) seat.claude.push(name);
    if (link && !seat.link) seat.link = link;
    return seat;
  };
  for (const n of needs) {
    if (n.resolved_at) continue;
    const seat = seatOf(n.project, n.project_link);
    const call = { ...n, at: Date.parse(n.created_at) };
    if (n.snoozed_until && Date.parse(n.snoozed_until) > now) seat.later.push(call);
    else seat.calls.push(call);
  }
  for (const [link, lines] of threadsOf(updates)) {
    const last = lines.at(-1);
    const seat = seatOf(last.project, last.project_link);
    if (last.state === 'working') seat.crew.push({ link, title: last.thread || last.text, at: last.at, quiet: now - last.at > QUIET_AFTER });
    else if (now - last.at < 7 * DAY) seat.finished += 1;
    if (!seat.last || last.at > seat.last.at) seat.last = last;
    // Turns: what got finished or went live, for the project's own page.
    for (const u of lines) if (u.state !== 'working') seat.turns.push(u);
  }
  const out = [];
  for (const seat of seats.values()) {
    seat.calls.sort((a, b) => (a.kind === 'review') - (b.kind === 'review') || a.at - b.at);
    seat.crew.sort((a, b) => b.at - a.at);
    // Where you've dragged them to, inside the card.
    const order = settings.order || {};
    seat.calls = inOrder(seat.calls, (c) => c.id, order.calls?.[seat.key]);
    seat.crew = inOrder(seat.crew, (c) => c.link, order.crew?.[seat.key]);
    seat.turns.sort((a, b) => b.at - a.at);
    seat.at = Math.max(seat.at, seat.last?.at || 0, ...seat.calls.map((c) => c.at));
    const busy = seat.calls.length > 0 || seat.crew.some((c) => !c.quiet) || (seat.last && now - seat.last.at < 3 * DAY);
    // Where it sits unless you've said: busy things on stage, things touched this month in the wings.
    seat.auto = busy || (seat.world && now - seat.world.edited < 3 * DAY) ? 'on' : now - seat.at < 30 * DAY ? 'wings' : 'back';
    seat.pinned = settings.stage[seat.key] in STAGES ? settings.stage[seat.key] : null;
    seat.stage = seat.pinned || seat.auto;
    out.push(seat);
  }
  // Whatever needs you comes first, then whatever moved last, until you
  // arrange them yourself: then as you left them, anything new first.
  out.sort((a, b) => (b.calls.length > 0) - (a.calls.length > 0) || b.at - a.at || a.name.localeCompare(b.name));
  return inOrder(out, (s) => s.key, settings.order?.seats);
}

// Every thread there has been, newest activity first.
export function historyFor({ needs, updates, now }) {
  const threads = new Map();
  const at = (link) => {
    if (!threads.has(link)) threads.set(link, { link, project: '', title: '', line: '', at: 0, open: [], last: null, places: new Set(), words: [] });
    return threads.get(link);
  };
  for (const u of updates) {
    const t = at(u.link);
    t.words.push(u.text, u.thread || '');
    if (u.place) t.places.add(u.place);
    if (!t.last || u.at >= t.last.at) { t.last = u; t.project = u.project || t.project; if (u.thread) t.title = u.thread; }
    t.at = Math.max(t.at, u.at);
  }
  for (const n of needs) {
    const t = at(n.link);
    const made = Date.parse(n.created_at);
    const end = n.resolved_at ? Date.parse(n.resolved_at) : 0;
    t.words.push(n.title);
    for (const url of linksIn(n.body)) if (url !== n.link) t.places.add(url);
    if (!n.resolved_at) t.open.push({ ...n, at: made });
    if (!t.project) t.project = n.project || '';
    if (!t.title) t.title = n.title;
    if (!t.last && (!t.need || made > t.need.at)) t.need = { title: n.title, at: made };
    t.at = Math.max(t.at, made, end);
  }
  const list = [...threads.values()].map((t) => {
    const closed = closedLine(t.last?.text);
    const status = t.open.length ? (closed ? 'loose' : 'waiting') : t.last?.state === 'working' ? (now - t.at > QUIET_AFTER ? 'quiet' : 'working') : 'finished';
    return { ...t, status, closed, line: t.last?.text || t.need?.title || '', places: [...t.places], search: low([t.title, t.project, ...t.words].join(' \n ')) };
  });
  return list.sort((a, b) => b.at - a.at);
}

// ---------- the page ----------

export class DeskPage {
  // fetch(sinceIso) → { needs, updates } (null when signed out) for the stage;
  // fetchAll() → the same, all time, for History; done(id), later(id, iso)
  // change a Needs you item; ask(body) reaches Claude when canAsk(); open(id)
  // opens a place in Inkwell; go(place) moves around; base() is Inkwell's
  // address; changed(rows) tells sync a row was written; onCount(n) hears how
  // many calls are waiting.
  constructor(hooks) {
    Object.assign(this, hooks);
    this.tab = 'stage';
    this.data = null;
    this.all = null;
    this.timer = 0;
    this.filter = 'all';
    this.query = '';
    this.triesOpen = new Set();
    // Everything on stage can be dragged into place (held first on a phone).
    deskDrags(this.sheet, { drop: (m) => this.moved(m), busy: (on) => { this.dragging = on; if (!on && this.redraw) { this.redraw = false; this.render({ now: this.now, failed: false }); } } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.showing()) this.load({ quiet: true }); });
  }

  showing() { return root.dataset.view === 'desk'; }
  get span() { const s = ls.get('deskSpan', 'today'); return s in SPANS ? s : 'today'; }
  set span(v) { ls.set('deskSpan', v); }

  async show(place = {}) {
    this.tab = place.tab === 'history' ? 'history' : 'stage';
    await this.load();
  }

  // Projects changed underneath (a rename, a sync): draw again without asking Daybook.
  async refresh() { if (this.showing() && this.tab === 'stage' && this.now) await this.render({ now: this.now, failed: false }); }

  // How many calls are waiting, for the number beside Desk, without opening it.
  async peek() {
    if (this.showing()) return;
    try {
      const data = await this.fetch(new Date(Date.now() - DAY).toISOString());
      if (data) this.count(data.needs, Date.now());
    } catch (e) { console.warn(e); }
  }
  count(needs, now) {
    this.onCount?.((needs || []).filter((n) => !n.resolved_at && !(n.snoozed_until && Date.parse(n.snoozed_until) > now)).length);
  }

  async load({ quiet = false } = {}) {
    const now = Date.now();
    // What was new since last time is marked; this visit becomes "last time".
    if (!quiet || this.seen == null) {
      this.seen = Number(ls.get('deskSeen', '0')) || 0;
      ls.set('deskSeen', String(now));
    }
    const token = (this.token = {});
    const tab = this.tab;
    if (!quiet || !this.sheet.firstChild || this.sheet.dataset.tab !== tab) this.renderLoading();
    let data = null, failed = false;
    try {
      data = tab === 'history' ? await this.fetchAll() : await this.fetch(new Date(midnight(now, WINDOW_DAYS - 1)).toISOString());
    } catch (e) { console.warn(e); failed = true; }
    if (token !== this.token) return;
    if (data) {
      data = { needs: data.needs || [], updates: (data.updates || []).map((u) => ({ ...u, at: Date.parse(u.created_at) })).sort((a, b) => a.at - b.at) };
      this.count(data.needs, now);
    }
    if (tab === 'history') this.all = data; else this.data = data;
    if (tab !== 'history' && data) this.closed = await this.closedThreads(data);
    if (token !== this.token) return;
    this.now = now;
    await this.render({ now, failed });
    // Just opened and not signed in yet: sync may still be starting, so look again soon.
    if (!data && !failed && (this.retries = (this.retries || 0) + 1) <= 5) setTimeout(() => { if (this.showing()) this.load({ quiet: true }); }, 2500);
    if (data) this.retries = 0;
    clearInterval(this.timer);
    // Threads keep working while it's open: look again every two minutes.
    this.timer = setInterval(() => { if (this.showing() && !document.hidden) this.load({ quiet: true }); else clearInterval(this.timer); }, 120000);
  }

  // The threads that were closed while one of their calls is still open. The
  // stage only reads a week of updates, so a thread whose latest line is older
  // is looked up in all of history (at most every ten minutes).
  async closedThreads(data) {
    const open = new Set(data.needs.filter((n) => !n.resolved_at).map((n) => n.link));
    if (!open.size) return new Set();
    const last = new Map();
    const note = (u) => { if (open.has(u.link) && (!last.has(u.link) || u.at >= last.get(u.link).at)) last.set(u.link, u); };
    if ([...open].some((l) => !data.updates.some((u) => u.link === l))) {
      if (!this.older || Date.now() - this.olderAt > 10 * 60000) {
        try {
          const all = await this.fetchAll?.();
          if (all) { this.older = (all.updates || []).map((u) => ({ ...u, at: Date.parse(u.created_at) })); this.olderAt = Date.now(); }
        } catch (e) { console.warn(e); }
      }
      for (const u of this.older || []) note(u);
    }
    for (const u of data.updates) note(u);
    return new Set([...last].filter(([, u]) => closedLine(u.text)).map(([link]) => link));
  }

  renderLoading() {
    this.sheet.dataset.tab = this.tab;
    this.sheet.replaceChildren(this.head(this.tab === 'history' ? 'Every thread, newest first' : 'On stage', this.tab === 'history' ? 'History' : 'Desk'), make('p', 'hint dk-wait', 'Looking…'));
  }

  // The title, and on a phone or in a pane the switch between the two views.
  head(eyebrow, title, right) {
    const head = make('header', 'dk-head');
    const titles = make('div', 'dk-titles');
    titles.append(make('div', 'dk-eyebrow', eyebrow), make('h1', '', title));
    const side = make('div', 'dk-side');
    if (right) side.append(right);
    const sw = make('div', 'dk-switch');
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', 'Views of the Desk');
    for (const [tab, label] of [['stage', 'On stage'], ['history', 'History']]) {
      const b = make('button', '', label);
      if (tab === this.tab) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', () => this.go({ view: 'desk', tab }));
      sw.append(b);
    }
    side.append(sw);
    head.append(titles, side);
    return head;
  }

  async render({ now, failed }) {
    const main = this.sheet.closest('main');
    const keep = this.sheet.dataset.tab === this.tab ? main?.scrollTop || 0 : 0;
    const typing = document.activeElement?.closest?.('.dk-search') ? document.activeElement.selectionStart : null;
    this.sheet.dataset.tab = this.tab;
    // Something is being dragged: draw again once it's let go.
    if (this.dragging) { this.redraw = true; return; }
    const parts = this.tab === 'history' ? this.historyParts({ now, failed }) : await this.stageParts({ now, failed });
    // Someone is writing a north star: don't pull the page out from under them.
    if (this.sheet.querySelector('.dk-star:focus')) return;
    if (this.dragging) { this.redraw = true; return; }
    this.sheet.replaceChildren(...parts);
    if (main) main.scrollTop = keep;
    if (typing != null) { const i = this.sheet.querySelector('.dk-search input'); i?.focus(); i?.setSelectionRange(typing, typing); }
  }

  note(failed) {
    return make('p', 'hint dk-note', failed
      ? 'Couldn’t reach your Claude threads just now. It’ll look again in a couple of minutes.'
      : 'Sign in (the sync button at the top) to see what your Claude threads did and what needs you.');
  }

  // ---- On stage ----

  // Your projects as the Desk seats them, and how you've arranged it.
  async seating() {
    const [list, all, settings] = [await byKind('world'), await areas(), await deskSettings()];
    const areaById = new Map(all.map((a) => [a.id, a]));
    const worlds = list.filter((w) => !w.deleted && !w.fields?.trashed)
      .map((w) => ({ id: w.id, title: w.title, color: areaColor(areaById.get(w.area_id)), edited: editedAt(w), star: w.fields?.star || '' }));
    return { worlds, settings };
  }

  // The calls waiting right now, for "Go through": decisions first, then
  // things to do, then things to try, the longest wait first in each. null
  // when they can't be read (signed out, offline).
  async waiting() {
    const now = Date.now();
    const data = await this.fetch(new Date(midnight(now, WINDOW_DAYS - 1)).toISOString());
    if (!data) return null;
    const { worlds, settings } = await this.seating();
    const seats = seatsFor({ worlds, needs: data.needs || [], updates: [], settings, now });
    const rank = { decision: 0, blocked: 1, review: 2 };
    return seats.flatMap((s) => s.calls.map((c) => ({ c, seat: s })))
      .sort((a, b) => (rank[a.c.kind] ?? 3) - (rank[b.c.kind] ?? 3) || a.c.at - b.c.at)
      .map(({ c, seat }) => {
        const w = waited(c.at, now);
        const why = String(c.body || '').replace(/https?:\/\/\S+/g, '').replace(/\b(Guide|Thread|Link)s?:\s*/gi, '').split('\n').map((x) => x.trim()).find(Boolean) || '';
        return { id: c.id, title: c.title, kind: KIND[c.kind] || 'Look', project: seat.name, mins: MINUTES[c.kind] || 5, waited: w === 'today' ? 'since today' : w, link: web(c.link) !== '#' ? c.link : '', why: why.length > 180 ? `${why.slice(0, 178)}…` : why };
      });
  }
  // An answer given in "Go through": off the list, or back tomorrow morning.
  async callDone(id) { await this.done(id); if (this.showing()) this.load({ quiet: true }); }
  async callLater(id) { await this.later(id, new Date(tomorrowMorning(Date.now())).toISOString()); if (this.showing()) this.load({ quiet: true }); }

  async stageParts({ now, failed }) {
    const { worlds, settings } = await this.seating();
    const data = this.data || { needs: [], updates: [] };
    const seats = seatsFor({ worlds, needs: data.needs, updates: data.updates, settings, now });
    this.settings = settings;
    this.worlds = worlds;
    const isNew = (ms) => !!this.seen && ms > this.seen;
    const calls = seats.flatMap((s) => s.calls);
    const later = seats.flatMap((s) => s.later);

    const sum = make('div', 'dk-calls');
    // How many of them come from threads already closed (when the tag is on).
    const fromClosed = showClosed() ? calls.filter((c) => this.closed?.has(c.link)).length : 0;
    if (calls.length) sum.append(make('i', 'dk-sig'), document.createTextNode(`${calls.length === 1 ? '1 call' : `${calls.length} calls`} waiting · about ${minutes(calls.reduce((m, c) => m + (MINUTES[c.kind] || 5), 0))}${fromClosed ? ` · ${fromClosed} from closed threads` : ''}`));
    else if (this.data) sum.textContent = 'Nothing needs you';
    // More than one: walk them one at a time.
    if (calls.length > 1 && this.through) {
      const b = make('button', 'dk-through', 'Go through them');
      b.type = 'button';
      b.addEventListener('click', () => this.through());
      sum.append(b);
    }
    // Beside the count: talk the whole stage through with Claude.
    const say = this.talk?.();
    if (say) {
      const b = make('button', 'dk-talk', '✦ Talk it through');
      b.title = 'Talk it through with Claude, beside the Desk (Alt + T)';
      b.addEventListener('click', say);
      sum.append(b);
    }
    const parts = [this.head(dayLabel(now), 'Desk', sum)];

    if (this.data) {
      const read = make('p', 'dk-read');
      parts.push(read);
      const since = midnight(now, this.span === 'week' ? 6 : this.span === 'two' ? 1 : 0);
      this.fillRead(read, calls, data.updates.filter((u) => u.at >= since), now);
    } else parts.push(this.note(failed));

    const on = seats.filter((s) => s.stage === 'on');
    const chairs = make('div', 'dk-chairs');
    chairs.dataset.drop = 'seat';
    chairs.dataset.stage = 'on';
    chairs.dataset.n = String(Math.min(on.length, 3));
    for (const s of on) chairs.append(this.chair(s, now, isNew));
    if (on.length) parts.push(chairs);
    else parts.push(make('p', 'hint dk-empty', 'Nothing is on stage. A project comes on stage when a Claude thread is working on it, when something needs you, or when you put it here from its ⋯ menu below.'));

    if (later.length) {
      const l = make('p', 'hint dk-later', `${later.length} set aside until tomorrow morning. `);
      const back = make('button', 'dk-link', 'Bring back');
      back.addEventListener('click', async () => {
        for (const n of later) await this.later(n.id, null).catch((e) => console.warn(e));
        this.load({ quiet: true });
      });
      l.append(back);
      parts.push(l);
    }

    for (const [stage, label] of [['wings', 'In the wings'], ['back', 'Backstage']]) {
      const rows = seats.filter((s) => s.stage === stage);
      if (!rows.length) continue;
      const sec = make('section', `dk-sec dk-${stage}`);
      sec.append(make('h2', 'dk-label', label));
      const box = make('div', 'dk-rows');
      box.dataset.drop = 'seat';
      box.dataset.stage = stage;
      for (const s of rows) box.append(this.row(s, now));
      sec.append(box);
      parts.push(sec);
    }

    if (this.data) parts.push(this.catchup(data.updates, now, isNew));
    return parts;
  }

  // One project on stage: what it's for, where it stands, what needs you, who's on it.
  chair(seat, now, isNew) {
    const el = make('section', 'dk-chair');
    el.dataset.key = seat.key;
    el.dataset.drag = 'seat';
    const h = make('h3');
    const dot = make('i', 'dk-dot');
    if (seat.color) dot.style.background = seat.color;
    h.append(dot, this.nameLink(seat), this.more(seat));
    el.append(h);
    // The north star shows on the card once it's written; the prompt to write
    // it lives on the project's own page.
    if (seat.world?.star) el.append(this.star(seat));
    const nowLine = make('p', 'dk-now');
    if (seat.last) {
      nowLine.append(document.createTextNode(`${seat.last.text} `), make('span', 'dk-when', when(seat.last.at, now)));
    } else if (seat.world) nowLine.textContent = `Last touched ${when(seat.world.edited, now)}`;
    if (nowLine.textContent) el.append(nowLine);

    if (seat.calls.length) {
      el.append(make('div', 'dk-sub', 'Needs you'));
      // Answers first. A pile of things to try folds into one line, so it never buries them.
      const tries = seat.calls.filter((c) => c.kind === 'review');
      const fold = tries.length > FOLD_TRIES;
      const list = make('div', 'dk-list');
      list.dataset.drop = 'call';
      for (const c of seat.calls) if (!fold || c.kind !== 'review') list.append(this.call(c, now, isNew));
      el.append(list);
      if (fold) {
        const box = make('details', 'dk-tries');
        box.open = this.triesOpen.has(seat.key);
        box.addEventListener('toggle', () => { if (box.open) this.triesOpen.add(seat.key); else this.triesOpen.delete(seat.key); });
        const sum = make('summary');
        sum.append(make('i', 'dk-sig'), make('span', 'dk-tries-t', `${tries.length} to try, about 10 minutes each`));
        const fresh = tries.filter((c) => isNew(c.at)).length;
        if (fresh) sum.append(make('span', 'dk-call-m', `${fresh} new`));
        box.append(sum);
        const inner = make('div', 'dk-list');
        inner.dataset.drop = 'call';
        for (const c of tries) inner.append(this.call(c, now, isNew));
        box.append(inner);
        el.append(box);
      }
    }
    if (seat.crew.length || seat.finished) {
      el.append(make('div', 'dk-sub', 'Crew'));
      const list = make('div', 'dk-list');
      list.dataset.drop = 'crew';
      for (const c of seat.crew) {
        const row = make('a', 'dk-crew');
        row.href = web(c.link); row.target = '_blank'; row.rel = 'noopener';
        row.dataset.drag = 'crew';
        row.dataset.key = c.link;
        row.append(make('i', `dk-pulse${c.quiet ? ' off' : ''}`), make('span', 'dk-crew-t', c.title), make('span', 'dk-crew-s', c.quiet ? `quiet since ${shortDay(c.at)}` : when(c.at, now)));
        list.append(row);
      }
      if (seat.crew.length) el.append(list);
      if (seat.finished) {
        const f = make('button', 'dk-crew dk-done', seat.finished === 1 ? '1 thread finished this week' : `${seat.finished} threads finished this week`);
        f.addEventListener('click', () => { this.filter = 'finished'; this.query = seat.claude[0] || ''; this.go({ view: 'desk', tab: 'history' }); });
        el.append(f);
      }
    }
    return el;
  }

  // A project's name: yours opens in Inkwell, a Claude project opens in Claude.
  nameLink(seat) {
    if (seat.world) {
      const b = make('button', 'dk-name', seat.name);
      b.addEventListener('click', () => this.go({ view: 'world', id: seat.world.id }));
      return b;
    }
    const a = make(seat.link ? 'a' : 'span', 'dk-name', seat.name);
    if (seat.link) { a.href = web(seat.link); a.target = '_blank'; a.rel = 'noopener'; a.title = 'A Claude project. Opens in Claude.'; }
    return a;
  }

  // What the project is for, in your words. Click to write it.
  star(seat) {
    const p = make('p', 'dk-star', seat.world.star);
    p.contentEditable = 'plaintext-only';
    p.spellcheck = false;
    p.dataset.ph = 'North star: what is this for?';
    p.setAttribute('aria-label', `North star for ${seat.name}`);
    p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); p.blur(); } });
    p.addEventListener('blur', async () => {
      const text = p.textContent.replace(/\s+/g, ' ').trim();
      if (!text) p.textContent = '';
      if (text === (seat.world.star || '')) return;
      const row = await getEntry(seat.world.id);
      if (!row) return;
      const next = { ...row, fields: { ...row.fields, star: text }, updated_at: Date.now() };
      await putEntries([next]);
      seat.world.star = text;
      this.changed?.([next]);
    });
    return p;
  }

  // One thing that needs you. A click offers the thread, its guide, Done and Later.
  call(c, now, isNew) {
    const a = make('a', 'dk-call');
    a.href = web(c.link); a.target = '_blank'; a.rel = 'noopener';
    a.dataset.id = c.id;
    a.dataset.drag = 'call';
    a.dataset.key = c.id;
    const text = make('span', 'dk-call-t');
    text.append(make('span', 'dk-kind', KIND[c.kind] || 'Look'), document.createTextNode(c.title));
    // Its thread was closed with this still open: say so, so it isn't mistaken for live work.
    if (this.closed?.has(c.link) && showClosed()) text.append(make('span', 'dk-closed', 'thread closed'));
    a.append(make('i', `dk-sig${isNew(c.at) ? ' fresh' : ''}`), text, make('span', 'dk-call-m', `${MINUTES[c.kind] || 5} min · ${waited(c.at, now)}`));
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      const open = (url) => () => { if (web(url) !== '#') window.open(url, '_blank', 'noopener'); };
      popMenu(a, [
        { label: 'Open the thread', run: open(c.link) },
        ...linksIn(c.body).filter((u) => u !== c.link).slice(0, 4).map((u) => ({ label: `Open ${placeName(u) === 'Guide' ? 'the guide' : placeName(u)}`, run: this.inkwellId(u) ? () => this.open(this.inkwellId(u)) : open(u) })),
        'sep',
        { label: 'Done: take it off the list', run: () => this.act(a, () => this.done(c.id), 'Off your list') },
        { label: 'Later: back tomorrow morning', run: () => this.act(a, () => this.later(c.id, new Date(tomorrowMorning(now)).toISOString()), 'Back tomorrow morning') }
      ], { left: e.clientX, top: e.clientY });
    });
    return a;
  }

  async act(row, fn, said) {
    row.classList.add('going');
    try { await fn(); this.toast?.(said); } catch (e) { console.warn(e); row.classList.remove('going'); this.toast?.('Couldn’t reach your list just now. Try again.'); return; }
    // Answered from somewhere else (a project's own page): only the count needs to keep up.
    if (this.showing()) this.load({ quiet: true }); else this.peek();
    this.acted?.();
  }

  // The ⋯ beside a project: where it sits, and which Claude project it belongs with.
  more(seat) {
    const b = make('button', 'dk-more', '⋯');
    b.setAttribute('aria-label', `Where ${seat.name} sits`);
    b.title = 'Where it sits on the Desk';
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const put = (stage) => async () => {
        const next = { ...this.settings.stage };
        if (stage) next[seat.key] = stage; else delete next[seat.key];
        this.changed?.([await saveDeskSettings({ stage: next })]);
        await this.render({ now: this.now, failed: false });
      };
      const tie = (name, worldId) => async () => {
        const next = { ...this.settings.ties };
        if (worldId) next[low(name)] = worldId; else delete next[low(name)];
        this.changed?.([await saveDeskSettings({ ties: next })]);
        await this.render({ now: this.now, failed: false });
      };
      const items = Object.entries(STAGES).map(([id, label]) => ({ label, current: seat.stage === id, run: put(id) }));
      if (seat.pinned) items.push({ label: 'Let Inkwell decide', run: put(null) });
      // Arranging by hand, without a drag.
      items.push('sep', { label: 'Move to the top', run: () => this.toTop(seat) });
      const o = this.settings.order || {};
      if (o.seats?.length || Object.keys(o.calls || {}).length || Object.keys(o.crew || {}).length) {
        items.push({ label: 'Let Inkwell order the Desk', run: () => this.arrange({ seats: [], calls: {}, crew: {} }, 'Back in Inkwell’s order') });
      }
      if (!seat.world && this.worlds.length) {
        items.push('sep', { label: 'This is one of my projects…', sub: [...this.worlds].sort((a, b) => (a.title || '').localeCompare(b.title || '')).map((w) => ({ label: w.title || 'Untitled', run: tie(seat.claude[0] || seat.name, w.id) })) });
      }
      for (const name of seat.world ? seat.claude : []) {
        if (this.settings.ties[low(name)] === seat.world.id) items.push('sep', { label: `Separate from “${name}” in Claude`, run: tie(name, null) });
      }
      popMenu(b, items);
    });
    return b;
  }

  // Something was dragged to a new place: keep it there, on every device.
  async moved({ kind, key, from, to, keys }) {
    const o = this.settings?.order || {};
    if (kind === 'seat') {
      const shown = [...this.sheet.querySelectorAll('[data-drag="seat"]')].map((x) => x.dataset.key);
      const next = { ...o, seats: mergeOrder(shown, o.seats) };
      // Into another list: it sits there now, until you say otherwise.
      const stage = to.dataset.stage;
      if (stage && stage !== from?.dataset.stage) {
        const pins = { ...this.settings.stage, [key]: stage };
        this.changed?.([await saveDeskSettings({ stage: pins })]);
        return this.arrange(next, `Now ${STAGES[stage].toLowerCase()}`);
      }
      return this.arrange(next);
    }
    const card = to.closest('.dk-chair')?.dataset.key;
    if (!card) return;
    const shown = [...to.closest('.dk-chair').querySelectorAll(`[data-drag="${kind}"]`)].map((x) => x.dataset.key);
    const field = kind === 'call' ? 'calls' : 'crew';
    return this.arrange({ ...o, [field]: { ...(o[field] || {}), [card]: mergeOrder(shown, o[field]?.[card]) } });
  }
  async toTop(seat) {
    const o = this.settings?.order || {};
    const shown = [...this.sheet.querySelectorAll('[data-drag="seat"]')].map((x) => x.dataset.key).filter((k) => k !== seat.key);
    return this.arrange({ ...o, seats: mergeOrder([seat.key, ...shown], o.seats) });
  }
  async arrange(order, said) {
    this.changed?.([await saveDeskSettings({ order })]);
    if (said) this.toast?.(said);
    await this.render({ now: this.now, failed: false });
  }

  // A project waiting in the wings or backstage: one line.
  row(seat, now) {
    const row = make('div', `dk-row s-${seat.stage}`);
    row.dataset.key = seat.key;
    row.dataset.drag = 'seat';
    const name = make('span', 'dk-rn');
    const dot = make('i', 'dk-dot');
    if (seat.color) dot.style.background = seat.color;
    name.append(dot, this.nameLink(seat));
    const says = seat.last ? seat.last.text : seat.world?.star || '';
    const right = make('span', 'dk-rr', seat.at ? when(seat.at, now) : '');
    right.append(this.more(seat));
    row.append(name, make('span', 'dk-rd', says), right);
    return row;
  }

  // What your threads did, underneath, so there's no separate page to remember.
  catchup(updates, now, isNew) {
    const sec = make('section', 'dk-sec dk-catchup');
    const h = make('h2', 'dk-label', 'Catch-up');
    h.append(make('span', 'dk-label-more', 'what your Claude threads did'));
    const sel = make('select', 'dk-span');
    sel.setAttribute('aria-label', 'How far back');
    for (const [v, label] of Object.entries(SPANS)) { const o = make('option', '', label); o.value = v; sel.append(o); }
    sel.value = this.span;
    sel.addEventListener('change', () => { this.span = sel.value; this.render({ now: this.now, failed: false }); });
    h.append(sel);
    sec.append(h);
    const since = midnight(now, this.span === 'week' ? 6 : this.span === 'two' ? 1 : 0);
    const list = updates.filter((u) => u.at >= since).sort((a, b) => b.at - a.at);
    if (!list.length) {
      sec.append(make('p', 'hint', this.span === 'today'
        ? 'Nothing logged yet today. Claude threads add a line here each time they finish something, go live, or start on something.'
        : 'Nothing logged in that time.'));
      return sec;
    }
    const box = make('div', 'dk-cu');
    for (const u of list) {
      const row = make('div', `dk-ev s-${u.state}`);
      const time = make('span', 'dk-time', localDate(u.at) === localDate(now) ? clock(u.at) : `${new Date(u.at).toLocaleDateString('en-US', { weekday: 'short', timeZone: tz() })} ${clock(u.at)}`);
      const text = make('span', 'dk-evt');
      if (isNew(u.at)) text.append(make('i', 'dk-new'));
      const a = make('a', '', u.text);
      a.href = web(u.link); a.target = '_blank'; a.rel = 'noopener';
      a.title = u.thread ? `Open “${u.thread}” in Claude` : 'Open the thread in Claude';
      text.append(a);
      if (u.place) text.append(document.createTextNode(' '), this.placeLink(u.place));
      row.append(time, make('span', 'dk-proj', u.project || ''), text, make('span', 'dk-state', u.state === 'live' ? 'Live' : u.state === 'working' ? 'Working' : 'Done'));
      box.append(row);
    }
    sec.append(box);
    return sec;
  }

  // The id a link opens, when it's a link into this Inkwell.
  inkwellId(url) {
    try {
      const u = new URL(url, location.href), mine = new URL(this.base(), location.href);
      return u.origin === mine.origin && u.pathname === mine.pathname ? u.searchParams.get('open') : null;
    } catch { return null; }
  }

  // A link to where something lives: an Inkwell place opens right here.
  placeLink(url) {
    const a = make('a', 'dk-place', placeName(url));
    a.href = web(url);
    const id = this.inkwellId(url);
    if (id) a.addEventListener('click', (e) => { e.preventDefault(); this.open(id); });
    else { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }

  // ---- Claude's read ----
  fillRead(el, calls, updates, now) {
    el.hidden = true;
    if (!calls.length && !updates.length) return;
    // Switched off in Look: no line, and Claude isn't asked.
    if (root.classList.contains('hide-deskread')) return;
    const body = {
      mode: 'catchup',
      now: `${dayLabel(now)}, ${clock(now)}`,
      updates: updates.slice(-80).map((u) => ({ project: u.project, thread: u.thread || '', text: u.text, state: u.state, at: clock(u.at) })),
      needs: calls.slice(0, 60).map((n) => ({ project: n.project || '', title: n.title, kind: n.kind, days: Math.floor((now - n.at) / DAY) }))
    };
    const key = JSON.stringify([body.updates.map((u) => [u.text, u.state]), body.needs.map((n) => [n.title, n.kind, n.days])]);
    let cached = null;
    try { cached = JSON.parse(ls.get('deskRead', 'null')); } catch { /* old */ }
    if (cached?.key === key && cached.line) { el.textContent = cached.line; el.hidden = false; return; }
    if (cached?.line) { el.textContent = cached.line; el.classList.add('stale'); el.hidden = false; }
    if (!this.canAsk() || this.asking === key) return;
    this.asking = key;
    Promise.resolve(this.ask(body)).then((got) => {
      const line = (got?.line || '').trim();
      if (!line) return;
      ls.set('deskRead', JSON.stringify({ key, line }));
      if (root.classList.contains('hide-deskread')) return;
      const now2 = this.sheet.querySelector('.dk-read');
      if (now2) { now2.textContent = line; now2.classList.remove('stale'); now2.hidden = false; }
    }).catch((e) => console.warn(e)).finally(() => { if (this.asking === key) this.asking = null; });
  }

  // ---- History ----

  historyParts({ now, failed }) {
    const parts = [this.head('Every thread, newest first', 'History')];
    if (!this.all) { parts.push(this.note(failed)); return parts; }
    const all = historyFor({ needs: this.all.needs, updates: this.all.updates, now });

    const search = make('label', 'dk-search');
    const input = make('input');
    input.type = 'search';
    input.placeholder = 'Search every thread and every update';
    input.setAttribute('aria-label', 'Search history');
    input.autocomplete = 'off';
    input.value = this.query;
    search.append(input);
    const filters = make('div', 'dk-filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Show');
    const box = make('div', 'dk-rows dk-threads');
    const draw = () => {
      const q = low(this.query);
      const hits = all.filter((t) => !q || t.search.includes(q));
      // "Waiting on you" counts the closed ones too; their own chip goes when the tag is switched off.
      const is = (t, id) => t.status === id || (id === 'waiting' && t.status === 'loose');
      if (this.filter === 'loose' && !showClosed()) this.filter = 'waiting';
      filters.replaceChildren(...FILTERS.filter(([id]) => id !== 'loose' || showClosed()).map(([id, label]) => {
        const n = id === 'all' ? hits.length : hits.filter((t) => is(t, id)).length;
        const b = make('button', this.filter === id ? 'on' : '', label);
        b.append(make('span', 'dk-n', String(n)));
        b.setAttribute('aria-pressed', String(this.filter === id));
        b.dataset.f = id;
        b.addEventListener('click', () => { this.filter = id; draw(); });
        return b;
      }));
      const list = hits.filter((t) => this.filter === 'all' || is(t, this.filter));
      box.replaceChildren(...list.slice(0, 400).map((t) => this.thread(t, now)));
      if (!list.length) box.append(make('p', 'hint dk-none', all.length ? 'Nothing matches. Finished threads are searched too.' : 'No threads yet. A thread shows here from the first time it logs an update or needs you.'));
    };
    input.addEventListener('input', () => { this.query = input.value; draw(); });
    draw();
    parts.push(search, filters, box);
    return parts;
  }

  thread(t, now) {
    const status = t.status === 'loose' && !showClosed() ? 'waiting' : t.status;
    const row = make('div', `dk-row dk-thread s-${status}`);
    const name = make('span', 'dk-rn');
    const a = make('a', 'dk-name', t.title || 'A thread');
    a.href = web(t.link); a.target = '_blank'; a.rel = 'noopener';
    a.title = 'Open the thread in Claude';
    name.append(a);
    const says = make('span', 'dk-rd');
    says.append(make('span', 'dk-proj', t.project || 'Claude'), document.createTextNode(t.line && t.line !== t.title ? ` · ${t.line}` : ''));
    for (const n of t.open) {
      const w = make('span', 'dk-waits');
      // A thread known only by what it asked for doesn't say it twice.
      w.append(make('i', 'dk-sig'), document.createTextNode(n.title === t.title ? `${KIND[n.kind] || 'Look'} · waiting ${waited(n.at, now) === 'today' ? 'since today' : waited(n.at, now)}` : `${KIND[n.kind] || 'Look'}: ${n.title}`));
      says.append(w);
    }
    if (t.places.length) {
      const links = make('span', 'dk-links');
      t.places.slice(0, 4).forEach((url, i) => { if (i) links.append(document.createTextNode(' · ')); links.append(this.placeLink(url)); });
      says.append(links);
    }
    row.append(name, says, make('span', 'dk-rr', `${STATUS[status]} · ${when(t.at, now)}`));
    return row;
  }
}
