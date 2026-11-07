// Catch-up: a quick look at what your Claude threads did today, across every
// Claude project, and what still needs you. Not a planning page.
//
// Two things feed it, both kept in Daybook's side of the shared database:
// - Needs you items, which every Claude thread already raises when it needs a
//   decision, is blocked on you, or has something ready to try.
// - Updates: one line a thread logs (log_update) each time it posts a result,
//   with whether it's done, live or still working, and where it lives.
// Every line opens its Claude thread; a line with a home in Inkwell or
// Daybook opens that too. Done takes a Needs you item off the list
// everywhere; Later sets it aside until tomorrow morning (Daybook hides it
// too). Claude writes one or two sentences at the top, from what's shown.

const KIND = { decision: 'Decide', blocked: 'Do', review: 'Try' };
const STATE = { live: 'Live', done: 'Done', working: 'Working' };
const SPANS = { today: 'Today', two: 'Today and yesterday', week: 'This week' };
const PACIFIC = 'America/Los_Angeles';

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const ls = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* full or blocked */ } }
};

// Times as the person reads them: Pacific, like everything else here.
const tz = () => (globalThis.__catchupTz || Intl.DateTimeFormat().resolvedOptions().timeZone || PACIFIC);
const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz() }).toLowerCase().replace(/\s/g, ' ');
const dayLabel = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz() });
const localDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz() });
// Midnight where the person is, n days back, as a time.
function midnight(now, daysBack = 0) {
  const d = localDate(now - daysBack * 864e5);
  // Walk back from noon UTC that day until the local date changes: exact across DST.
  let t = Date.parse(`${d}T12:00:00Z`);
  const hour = Number(new Date(t).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz() })) % 24;
  t -= hour * 36e5;
  const min = Number(new Date(t).toLocaleString('en-US', { minute: 'numeric', timeZone: tz() }));
  return t - min * 6e4;
}
// Tomorrow at 7 am local: where Later puts something.
export function tomorrowMorning(now = Date.now()) { return midnight(now) + 864e5 + 7 * 36e5; }

const waited = (ms, now) => {
  const days = Math.floor((now - ms) / 864e5);
  if (days >= 1) return days === 1 ? '1 day' : `${days} days`;
  const h = Math.floor((now - ms) / 36e5);
  return h >= 1 ? (h === 1 ? '1 hour' : `${h} hours`) : 'just now';
};

// "Inkwell" for an Inkwell link, "Daybook" for Daybook's, else the site's name.
function placeName(url) {
  try {
    const u = new URL(url);
    if (/inkwell/i.test(u.pathname) || u.searchParams.has('open')) return 'Inkwell';
    if (/daybook/i.test(u.hostname + u.pathname)) return 'Daybook';
    if (/claude\.ai$/.test(u.hostname) && /artifact/.test(u.pathname)) return 'Guide';
    return u.hostname.replace(/^www\./, '');
  } catch { return 'Open'; }
}

export class CatchupPage {
  // fetch(sinceIso) → { needs, updates } or null when signed out; done(id),
  // later(id, iso) change a Needs you item; ask(body) reaches Claude when
  // canAsk(); open(id) opens a place in Inkwell; base() is Inkwell's address.
  constructor({ sheet, fetch, done, later, ask, canAsk, open, base, toast }) {
    Object.assign(this, { sheet, fetchData: fetch, doneNeed: done, laterNeed: later, ask, canAsk, openEntry: open, base, toast });
    this.data = null;
    this.timer = 0;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.showing()) this.show({ quiet: true }); });
  }

  showing() { return document.documentElement.dataset.view === 'catchup'; }
  get span() { const s = ls.get('catchupSpan', 'today'); return s in SPANS ? s : 'today'; }
  set span(v) { ls.set('catchupSpan', v); }
  get tryOpen() { return ls.get('catchupTryOpen', '') === '1'; }
  set tryOpen(v) { ls.set('catchupTryOpen', v ? '1' : ''); }

  async show({ quiet = false } = {}) {
    const now = Date.now();
    // What was new since last time is marked; this visit becomes "last time".
    if (!quiet || this.seen == null) {
      this.seen = Number(ls.get('catchupSeen', '0')) || 0;
      ls.set('catchupSeen', String(now));
    }
    const since = midnight(now, this.span === 'week' ? 6 : this.span === 'two' ? 1 : 0);
    const token = this.token = {};
    if (!quiet || !this.data) this.renderLoading();
    let data = null, failed = false;
    try { data = await this.fetchData(new Date(since).toISOString()); } catch (e) { console.warn(e); failed = true; }
    if (token !== this.token) return;
    this.data = data;
    this.render({ now, since, failed });
    // Just opened and not signed in yet: sync may still be starting, so look again soon.
    if (!data && !failed && (this.retries = (this.retries || 0) + 1) <= 5) setTimeout(() => { if (this.showing()) this.show({ quiet: true }); }, 2500);
    if (data) this.retries = 0;
    clearInterval(this.timer);
    // Threads keep working while it's open: look again every two minutes.
    this.timer = setInterval(() => { if (this.showing() && !document.hidden) this.show({ quiet: true }); else clearInterval(this.timer); }, 120000);
  }

  renderLoading() {
    if (this.sheet.querySelector('.cu-head')) return;
    this.sheet.replaceChildren(make('div', 'cu-head', null));
    this.sheet.firstChild.append(make('h1', '', 'Catch-up'));
    this.sheet.append(make('p', 'hint', 'Looking…'));
  }

  render({ now, since, failed }) {
    const sheet = this.sheet;
    const keepScroll = sheet.closest('main')?.scrollTop || 0;
    const parts = [];

    const head = make('div', 'cu-head');
    const titles = make('div', 'cu-titles');
    titles.append(make('div', 'cu-date', `${dayLabel(now)} · ${clock(now)}`), make('h1', '', 'Catch-up'));
    const tools = make('div', 'cu-tools');
    if (this.seen) {
      const n = make('span', 'cu-seen');
      n.append(make('i', 'cu-new'), document.createTextNode(` new since you last looked (${localDate(this.seen) === localDate(now) ? clock(this.seen) : dayLabel(this.seen)})`));
      tools.append(n);
    }
    const sel = make('select', 'cu-span');
    sel.setAttribute('aria-label', 'How far back');
    for (const [v, label] of Object.entries(SPANS)) { const o = make('option', '', label); o.value = v; sel.append(o); }
    sel.value = this.span;
    sel.addEventListener('change', () => { this.span = sel.value; this.show({ quiet: true }); });
    tools.append(sel);
    head.append(titles, tools);
    parts.push(head);

    if (!this.data) {
      parts.push(make('p', 'hint cu-empty', failed
        ? 'Couldn’t reach Daybook just now. It’ll look again in a couple of minutes, or reopen Catch-up.'
        : 'Sign in (the sync button at the top) to see what your Claude threads did and what needs you. It comes from Daybook, so it’s the same on every device.'));
      sheet.replaceChildren(...parts);
      return;
    }

    const isNew = (ms) => this.seen && ms > this.seen;
    const needs = (this.data.needs || [])
      .filter((n) => !n.resolved_at && !(n.snoozed_until && Date.parse(n.snoozed_until) > now))
      .map((n) => ({ ...n, at: Date.parse(n.created_at) }))
      .sort((a, b) => a.at - b.at);
    const later = (this.data.needs || []).filter((n) => !n.resolved_at && n.snoozed_until && Date.parse(n.snoozed_until) > now);
    const updates = (this.data.updates || [])
      .map((u) => ({ ...u, at: Date.parse(u.created_at) }))
      .filter((u) => u.at >= since)
      .sort((a, b) => a.at - b.at);

    // Claude's read of it all, kept until what's shown changes.
    const read = make('p', 'cu-read');
    parts.push(read);
    this.fillRead(read, needs, updates, now);

    const cols = make('div', 'cu-cols');
    cols.append(this.needsColumn(needs, later, now, isNew), this.happenedColumn(updates, since, now, isNew));
    parts.push(cols);
    sheet.replaceChildren(...parts);
    const main = sheet.closest('main');
    if (main) main.scrollTop = keepScroll;
  }

  // ---- what needs you ----
  needsColumn(needs, later, now, isNew) {
    const col = make('section', 'cu-col cu-needs');
    col.setAttribute('aria-label', 'Needs you');
    col.append(make('div', 'cu-label', needs.length ? `Needs you · ${needs.length}` : 'Needs you'));
    const real = needs.filter((n) => n.kind !== 'review');
    const tries = needs.filter((n) => n.kind === 'review');
    if (!needs.length) col.append(make('p', 'hint', 'Nothing is waiting on you. When a thread needs a decision, is blocked on you, or has something to try, it shows here.'));
    for (const n of real) col.append(this.needRow(n, now, isNew));
    if (tries.length) {
      const box = make('details', 'cu-tries');
      box.open = this.tryOpen;
      box.addEventListener('toggle', () => { this.tryOpen = box.open; });
      const sum = make('summary');
      sum.append(make('span', 'cu-tries-t', 'Try when you have 10 minutes'), make('span', 'cu-count', String(tries.length)));
      const fresh = tries.filter((n) => isNew(n.at)).length;
      if (fresh) sum.append(make('span', 'cu-tries-new', `${fresh} new`));
      box.append(sum);
      for (const n of tries) box.append(this.needRow(n, now, isNew));
      col.append(box);
    }
    if (later.length) {
      const l = make('p', 'hint cu-later-note', `${later.length} set aside until tomorrow morning. `);
      const back = make('button', 'cu-btn quiet', 'Bring back');
      back.addEventListener('click', async () => {
        for (const n of later) await this.laterNeed(n.id, null).catch((e) => console.warn(e));
        this.show({ quiet: true });
      });
      l.append(back);
      col.append(l);
    }
    return col;
  }

  needRow(n, now, isNew) {
    const row = make('div', 'cu-item');
    row.dataset.id = n.id;
    const text = make('div', 'cu-text');
    const t = make('a', 'cu-t');
    t.href = n.link; t.target = '_blank'; t.rel = 'noopener';
    if (isNew(n.at)) t.append(make('i', 'cu-new'));
    if (n.kind !== 'review') t.append(make('span', `cu-chip k-${n.kind}`, KIND[n.kind] || 'Look'));
    t.append(document.createTextNode(n.title));
    text.append(t);
    const meta = make('div', 'cu-m', `${n.project || 'Claude'} · waiting ${waited(n.at, now)}`);
    text.append(meta);
    // Links in the details (a guide, a page) come along as buttons.
    for (const url of new Set((n.body || '').match(/https?:\/\/[^\s)>\]]+/g) || [])) {
      if (url === n.link) continue;
      meta.append(document.createTextNode(' · '), this.placeLink(url));
    }
    const acts = make('div', 'cu-acts');
    const done = make('button', 'cu-btn', 'Done');
    done.title = 'Takes it off your Needs you list, here and in Daybook';
    done.addEventListener('click', () => this.act(row, () => this.doneNeed(n.id), 'Off your list'));
    const later = make('button', 'cu-btn quiet', 'Later');
    later.title = 'Sets it aside until tomorrow morning, here and in Daybook';
    later.addEventListener('click', () => this.act(row, () => this.laterNeed(n.id, new Date(tomorrowMorning(now)).toISOString()), 'Back tomorrow morning'));
    acts.append(done, later);
    row.append(text, acts);
    return row;
  }

  async act(row, fn, said) {
    row.classList.add('going');
    try { await fn(); this.toast?.(said); } catch (e) { console.warn(e); row.classList.remove('going'); this.toast?.('Couldn’t reach Daybook. Try again.'); return; }
    this.show({ quiet: true });
  }

  // ---- what happened ----
  happenedColumn(updates, since, now, isNew) {
    const col = make('section', 'cu-col cu-happened');
    col.setAttribute('aria-label', 'Happened');
    col.append(make('div', 'cu-label', this.span === 'today' ? 'Happened today' : 'Happened'));
    if (!updates.length) {
      col.append(make('p', 'hint', 'Nothing logged yet. Claude threads add a line here each time they finish something, go live, or start on something.'));
      return col;
    }
    // By project, the busiest first; inside, oldest first.
    const by = new Map();
    for (const u of updates) { if (!by.has(u.project)) by.set(u.project, []); by.get(u.project).push(u); }
    const groups = [...by].sort((a, b) => b[1].at(-1).at - a[1].at(-1).at);
    const multiDay = this.span !== 'today';
    for (const [project, list] of groups) {
      const g = make('div', 'cu-group');
      const name = make('div', 'cu-proj');
      if (list[0].project_link) { const a = make('a', '', project); a.href = list[0].project_link; a.target = '_blank'; a.rel = 'noopener'; name.append(a); } else name.textContent = project;
      g.append(name);
      for (const u of list) {
        const ev = make('div', `cu-ev s-${u.state}`);
        const when = make('span', 'cu-time', multiDay && localDate(u.at) !== localDate(now) ? `${new Date(u.at).toLocaleDateString('en-US', { weekday: 'short', timeZone: tz() })} ${clock(u.at)}` : clock(u.at));
        const body = make('div', 'cu-evb');
        const line = make('div', 'cu-evt');
        if (isNew(u.at)) line.append(make('i', 'cu-new'));
        if (u.state !== 'done') line.append(make('span', `cu-chip s-${u.state}`, STATE[u.state]));
        line.append(document.createTextNode(u.text));
        const links = make('div', 'cu-m');
        const th = make('a', '', u.thread || 'Open the thread');
        th.href = u.link; th.target = '_blank'; th.rel = 'noopener';
        links.append(th);
        if (u.place) links.append(document.createTextNode(' · '), this.placeLink(u.place));
        body.append(line, links);
        ev.append(when, body);
        g.append(ev);
      }
      col.append(g);
    }
    // Threads whose last word today is that they're still on it.
    const last = new Map();
    for (const u of updates) last.set(u.link, u);
    const working = [...last.values()].filter((u) => u.state === 'working');
    if (working.length) {
      const w = make('div', 'cu-working');
      w.append(make('div', 'cu-label', `Still working · ${working.length}`));
      const names = make('div', 'cu-m');
      working.forEach((u, i) => {
        if (i) names.append(document.createTextNode(' · '));
        const a = make('a', '', u.thread || u.project); a.href = u.link; a.target = '_blank'; a.rel = 'noopener';
        names.append(a);
      });
      w.append(names);
      col.append(w);
    }
    return col;
  }

  // A link to where something lives: an Inkwell place opens right here.
  placeLink(url) {
    const a = make('a', 'cu-place', placeName(url));
    a.href = url;
    let id = null;
    try {
      const u = new URL(url, location.href), mine = new URL(this.base(), location.href);
      if (u.origin === mine.origin && u.pathname === mine.pathname) id = u.searchParams.get('open');
    } catch { /* not a link we can read */ }
    if (id) a.addEventListener('click', (e) => { e.preventDefault(); this.openEntry(id); });
    else { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }

  // ---- Claude's read ----
  fillRead(el, needs, updates, now) {
    el.hidden = true;
    if (!needs.length && !updates.length) return;
    // Switched off in Aa: no line, and Claude isn't asked.
    if (document.documentElement.classList.contains('hide-cuclaude')) return;
    const body = {
      mode: 'catchup',
      now: `${dayLabel(now)}, ${clock(now)}`,
      updates: updates.slice(-80).map((u) => ({ project: u.project, thread: u.thread || '', text: u.text, state: u.state, at: clock(u.at) })),
      needs: needs.slice(0, 60).map((n) => ({ project: n.project || '', title: n.title, kind: n.kind, days: Math.floor((now - n.at) / 864e5) }))
    };
    const key = JSON.stringify([body.updates.map((u) => [u.text, u.state]), body.needs.map((n) => [n.title, n.kind, n.days])]);
    let cached = null;
    try { cached = JSON.parse(ls.get('catchupRead', 'null')); } catch { /* old */ }
    if (cached?.key === key && cached.line) { el.textContent = cached.line; el.hidden = false; return; }
    if (cached?.line) { el.textContent = cached.line; el.classList.add('stale'); el.hidden = false; }
    if (!this.canAsk() || this.asking === key) return;
    this.asking = key;
    Promise.resolve(this.ask(body)).then((got) => {
      const line = (got?.line || '').trim();
      if (!line) return;
      ls.set('catchupRead', JSON.stringify({ key, line }));
      if (document.documentElement.classList.contains('hide-cuclaude')) return;
      const now2 = this.sheet.querySelector('.cu-read');
      if (now2) { now2.textContent = line; now2.classList.remove('stale'); now2.hidden = false; }
    }).catch((e) => console.warn(e)).finally(() => { if (this.asking === key) this.asking = null; });
  }
}
