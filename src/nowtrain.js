// Training in Now (Part 6): when the one thing is the day's "Training" line,
// Now shows ONE exercise at a time. A quiet line ("Training · Hard A · 3 of
// 13"), the name large, "Notes and video" when it has a link, one quiet line
// of what to do and what happened last time, then only the controls it
// needs: a dot per set (all filled; tap to bring it down), minutes (minus, a
// number, plus) and one number to record. Done, Skip this one, Back, Not now.
// A ladder asks once "Ready to move up?" when the mark is reached with every
// set done. A pair (superset) is one step: two names, one row of round
// dots, one number each and one Done. After the last exercise, the session goes on today's page and
// the usual gate shows.

import { make } from './dom.js';
import { readTraining, sessionAt, nextSession, exName, saveState, finishSession, isTraining, resultLine, bothNums, ladderSteps } from './training.js';
import { gateLine } from './trainstats.js';
import { getEntry, putEntries } from './db.js';

export class TrainNow {
  constructor(now) {
    this.now = now;
    this.tr = null;
    this.reset();
  }

  reset() { this.cur = null; this.cur2 = null; this.sets = null; this.min = null; this.ask = null; this.askv = null; this.askq = []; this.pending = null; }
  get p() { return this.now.p; }
  active(cur) { return !!cur && !cur.smalls && isTraining(cur.item?.row); }
  async load() { this.tr = await readTraining(); }

  // Where he is in today's session: { i, res }.
  place() {
    const at = this.tr?.state.at;
    return at && at.day === this.p.today
      ? { i: at.i || 0, res: Array.isArray(at.res) ? at.res : [], nums: at.nums || {}, st: at.st || {} }
      : { i: 0, res: [], nums: {}, st: {} };
  }
  session() { return this.tr ? sessionAt(this.tr, this.tr.state.round, this.p.today) : null; }
  ex() { const s = this.session(); return s ? s.x[Math.min(this.place().i, s.x.length - 1)] : null; }

  // ---------- drawing ----------

  view(cur) {
    const mid = make('div', 'now-mid now-train');
    const s = this.session();
    if (!this.tr || !s || !s.x.length) {
      mid.append(make('h1', 'now-thing', cur.name), make('p', 'now-ref', 'The Training page has no sessions yet.'));
      mid.append(this.acts(false));
      return mid;
    }
    const st = this.tr.state;
    if (this.ask) {
      const ex = s.x.flatMap((x) => (x.pair ? x.pair : [x])).find((x) => x.lad === this.ask);
      const i = st.step?.[this.ask] || 0;
      const nextStep = ex?.steps?.[i + 1] || 'next step';
      mid.append(make('p', 'now-eyebrow', `Training · ${s.name}`));
      mid.append(make('p', 'now-thing sm', `${this.askv} ${ex?.u || ''}. Ready to move up to the ${nextStep.toLowerCase()}?`.replace(/ {2,}/g, ' ')));
      mid.append(make('p', 'now-ref', `One step closer to the ${ex?.goal || 'goal'}. You decide.`));
      const acts = make('div', 'now-acts');
      const up = this.now.btn('tup', 'Move up', 'go');
      up.dataset.v = '1';
      const no = this.now.btn('tup', 'Not yet', 'quiet');
      no.dataset.v = '0';
      acts.append(up, no);
      mid.append(acts);
      return mid;
    }
    const { i } = this.place();
    const x = this.ex();
    if (x.pair) return this.pairView(mid, s, i, x, st);
    const last = st.last?.[x.k];
    const ls = st.lastSets?.[x.k];
    const lm = st.lastMin?.[x.k];
    const short = x.n && ls != null && ls < x.n;
    const shortM = x.m && lm != null && lm < x.m;
    if (x.m && this.min == null) this.min = x.m;
    if (x.n && this.sets == null) this.sets = x.n;
    if (this.cur == null) this.cur = last != null ? last : 0;
    mid.append(make('p', 'now-eyebrow', `Training · ${s.name} · ${i + 1} of ${s.x.length}`));
    const name = make('h1', 'now-thing', exName(x, st));
    mid.append(name);
    if (x.link) {
      const a = make('a', 'now-where now-video');
      a.href = x.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.append(make('span', '', 'Notes and video'), make('span', 'now-where-go', ' ›'));
      mid.append(a);
    }
    const was = x.u
      ? (last != null ? ` Last time ${last} ${x.u}${short ? `, ${ls} of ${x.n} ${x.w || 'sets'}` : ''}${shortM ? `, ${lm} of ${x.m} minutes` : ''}.` : x.lad ? ' First time at this step.' : '')
      : short ? ` Last time ${ls} of ${x.n}.` : shortM ? ` Last time ${lm} of ${x.m} minutes.` : '';
    const say = `${x.m ? `${x.m} ${x.mw || 'minutes'}.` : ''}${x.n ? ` ${x.n} ${x.w || 'sets'}.` : ''}${x.d ? ` ${x.d}.` : ''}${was}${x.lad && x.goal ? ` On the way to the ${x.goal}.` : ''}`.trim();
    if (say) mid.append(make('p', 'now-ref now-tsay', say));
    if (x.n) mid.append(this.dots(x));
    if (x.m) mid.append(this.numRow('tmin', 'now-tmin', this.min, 'minutes', 'Minutes done', 'Fewer minutes', 'More minutes'));
    if (x.u) mid.append(this.numRow('tnum', 'now-tnum', this.cur, x.u, `${x.q || 'Your number'}, ${x.u}`, 'Less', 'More'));
    if (this.now.asking) mid.append(this.now.choices(this.now.m.cur));
    else mid.append(this.acts(i > 0));
    return mid;
  }

  // A superset: two names taking turns, one row of round dots, one number each.
  pairView(mid, s, i, x, st) {
    const [a, b] = x.pair;
    mid.classList.add('now-pair');
    const la = st.last?.[a.k];
    const lb = st.last?.[b.k];
    const ls = st.lastSets?.[x.k];
    const short = x.n && ls != null && ls < x.n;
    if (x.n && this.sets == null) this.sets = x.n;
    if (this.cur == null) this.cur = la != null ? la : 0;
    if (this.cur2 == null) this.cur2 = lb != null ? lb : 0;
    mid.append(make('p', 'now-eyebrow', `Training · ${s.name} · ${i + 1} of ${s.x.length}`));
    mid.append(make('h1', 'now-thing sm', exName(a, st)), make('p', 'now-with', 'taking turns with'), make('p', 'now-thing sm', exName(b, st)));
    const link = x.link || a.link || b.link;
    if (link) {
      const el = make('a', 'now-where now-video');
      el.href = link;
      el.target = '_blank';
      el.rel = 'noopener';
      el.append(make('span', '', 'Notes and video'), make('span', 'now-where-go', ' ›'));
      mid.append(el);
    }
    const nums = bothNums(x.pair, [a.u ? la : null, b.u ? lb : null]);
    const was = nums ? ` Last time ${nums}${short ? `, ${ls} of ${x.n} ${x.w || 'rounds'}` : ''}.` : short ? ` Last time ${ls} of ${x.n}.` : '';
    const goals = x.pair.filter((m) => m.lad && m.goal).map((m) => m.goal);
    const say = `${x.n ? `${x.n} ${x.w || 'rounds'}.` : ''}${x.d ? ` ${x.d}.` : ''}${was}${goals.length ? ` On the way to the ${goals.join(' and the ')}.` : ''}`.trim();
    if (say) mid.append(make('p', 'now-ref now-tsay', say));
    if (x.n) mid.append(this.dots(x));
    if (a.u) mid.append(this.numRow('tnum', 'now-tnum', this.cur, a.u, a.lab || `${a.t}, ${a.u}`, 'Less', 'More', a.lab));
    if (b.u) mid.append(this.numRow('tnum2', 'now-tnum2', this.cur2, b.u, b.lab || `${b.t}, ${b.u}`, 'Less', 'More', b.lab));
    if (this.now.asking) mid.append(this.now.choices(this.now.m.cur));
    else mid.append(this.acts(i > 0));
    return mid;
  }

  dots(x) {
    const g = make('div', 'now-sets');
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', 'How many you did');
    for (let k = 1; k <= x.n; k++) {
      const d = make('button', `now-dot${k <= this.sets ? ' on' : ''}`);
      d.type = 'button';
      d.dataset.now = 'tset';
      d.dataset.v = String(k);
      d.setAttribute('aria-pressed', String(k <= this.sets));
      d.setAttribute('aria-label', `${k} of ${x.n}`);
      g.append(d);
    }
    g.append(make('span', 'now-setn', `${this.sets} of ${x.n} ${x.w || 'sets'}`));
    return g;
  }

  numRow(act, id, value, unit, label, less, more, word = unit) {
    const row = make('div', 'now-num');
    const minus = this.now.btn(act, '−', 'quiet now-step');
    minus.dataset.v = '-1';
    minus.setAttribute('aria-label', less);
    const plus = this.now.btn(act, '+', 'quiet now-step');
    plus.dataset.v = '1';
    plus.setAttribute('aria-label', more);
    const lab = make('label', 'now-numl');
    const input = make('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.id = id;
    input.value = String(value);
    input.setAttribute('aria-label', label);
    input.enterKeyHint = 'done';
    input.addEventListener('input', () => this.read());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.read(); this.now.run(() => this.done()); } });
    lab.append(input, make('span', '', word));
    row.append(minus, lab, plus);
    return row;
  }

  acts(back) {
    const acts = make('div', 'now-acts');
    acts.append(this.now.btn('done', 'Done', 'go', 'D'), this.now.btn('tskip', 'Skip this one', '', 'S'));
    if (back) acts.append(this.now.btn('tback', 'Back'));
    acts.append(this.now.btn('notnow', 'Not now', '', 'N'));
    return acts;
  }

  // The numbers typed in, before anything acts on them.
  read() {
    const sheet = this.p.sheet;
    const a = sheet.querySelector('#now-tnum');
    const b = sheet.querySelector('#now-tmin');
    const c = sheet.querySelector('#now-tnum2');
    if (a) this.cur = Math.max(0, Number(a.value) || 0);
    if (c) this.cur2 = Math.max(0, Number(c.value) || 0);
    if (b) this.min = Math.max(0, Number(b.value) || 0);
  }

  // ---------- doing ----------

  async click(act, el) {
    this.read();
    const v = Number(el.dataset.v);
    if (act === 'tset') { this.sets = this.sets === v ? v - 1 : v; this.p.redraw(); return true; }
    if (act === 'tmin') { this.min = Math.max(0, (this.min || 0) + v); this.p.redraw(); return true; }
    if (act === 'tnum') { this.cur = Math.max(0, (this.cur || 0) + v); this.p.redraw(); return true; }
    if (act === 'tnum2') { this.cur2 = Math.max(0, (this.cur2 || 0) + v); this.p.redraw(); return true; }
    if (act === 'tskip') { await this.move(1, null); return true; }
    if (act === 'tback') { await this.move(-1, null); return true; }
    if (act === 'tup') { await this.moveUp(v === 1); return true; }
    return false;
  }

  // Done with this exercise: its numbers kept for next time, then the next.
  // A ladder at its mark with every set done asks first (a pair can ask twice).
  async done() {
    this.read();
    const s = this.session();
    const x = this.ex();
    if (!s || !x) return;
    const st = this.tr.state;
    const patch = {};
    const mems = x.pair ? x.pair.map((m, j) => [m, j ? this.cur2 : this.cur]) : [[x, this.cur]];
    if (x.n) patch.lastSets = { ...st.lastSets, [x.k]: this.sets };
    if (x.m) patch.lastMin = { ...st.lastMin, [x.k]: this.min };
    const last = { ...st.last };
    for (const [m, v] of mems) if (m.u) last[m.k] = v;
    if (mems.some(([m]) => m.u)) patch.last = last;
    // For the log (Part 7): each number, and a ladder's step when it was recorded.
    const { nums, st: steps } = this.place();
    for (const [m, v] of mems) if (m.u && v != null) { nums[m.k] = v; if (m.lad) steps[m.lad] = st.step?.[m.lad] || 0; }
    this.got = { nums, st: steps };
    const cur = x.pair ? mems.map(([m, v]) => (m.u ? v : null)) : (x.u ? this.cur : null);
    const line = resultLine(x, exName(x, st), { cur, sets: x.n ? this.sets : null, min: x.m ? this.min : null });
    const allSets = !x.n || this.sets >= x.n;
    const q = mems.filter(([m, v]) => m.lad && m.u && m.mark != null && v >= m.mark && allSets && (st.step?.[m.lad] || 0) < (m.steps?.length || 1) - 1).map(([m, v]) => ({ lad: m.lad, v }));
    await this.write(patch);
    if (q.length) { this.pending = line; this.askq = q.slice(1); this.ask = q[0].lad; this.askv = q[0].v; this.p.redraw(); return; }
    await this.move(1, line);
  }

  async moveUp(yes) {
    const lad = this.ask;
    if (yes && lad) await this.write({ step: { ...this.tr.state.step, [lad]: (this.tr.state.step?.[lad] || 0) + 1 } });
    const nxt = this.askq?.shift();
    if (nxt) { this.ask = nxt.lad; this.askv = nxt.v; this.p.redraw(); return; }
    const line = this.pending;
    this.ask = null;
    this.pending = null;
    await this.move(1, line);
  }

  // To the next exercise (or back one); past the last, the session is over.
  async move(d, line) {
    const s = this.session();
    const { i, res, nums, st } = this.place();
    const got = this.got || { nums, st };
    this.got = null;
    const kept = line ? [...res, line] : res;
    this.reset();
    const to = Math.max(0, i + d);
    if (to >= s.x.length) return this.finish(kept, { nums: got.nums, st: got.st });
    await this.write({ at: { day: this.p.today, i: to, res: kept, nums: got.nums, st: got.st } });
    this.p.redraw();
    return undefined;
  }

  async write(patch) {
    const row = await saveState(patch);
    if (row) { this.tr.state = { ...this.tr.state, ...patch }; await this.p.hooks.changed?.([row]); }
  }

  async finish(res, { own = false, nums = {}, st = {} } = {}) {
    const s = this.session();
    const lineId = this.now.m?.cur?.item.row.id || null;
    const got = await finishSession({ name: s?.name || '', hard: !!(s?.hard || s?.once), nums, st, res, lineId, today: this.p.today, own });
    this.reset();
    await this.p.wrote(got.rows);
    await this.load();
    const t = own ? 'Training on your own' : `Training: ${s?.name || ''}`;
    // At most one quiet line under "Done.": a best yet and the streak, each by its switch.
    const off = (id) => document.documentElement.classList.contains(`hide-${id}`);
    const note = got.entry ? gateLine(this.tr?.state.log || [], got.entry, this.p.today, { charts: !off('traincharts'), streak: !off('trainstreak'), steps: ladderSteps(this.tr) }) : '';
    await this.now.after({ k: 'done', t, ...(note ? { note } : {}) });
    this.p.hooks.toast?.(`${t}, on today’s page`, { label: 'Show', run: () => this.p.hooks.go?.({ view: 'notebook', pageId: `day-${this.p.today}`, line: got.line.id }) });
  }

  // Not now, for training: later keeps his place inside the session;
  // enough for today and another day take today's line off (tomorrow brings
  // its own) and the place in the round doesn't move; "I trained on my own"
  // counts as a session.
  async aside(where) {
    const cur = this.now.m?.cur;
    if (!cur) return;
    if (where === 'own') { await this.finish([], { own: true }); return; }
    const id = cur.item.row.id;
    const r = await getEntry(id);
    const was = { ...this.now.st };
    const at = this.tr?.state.at || null;
    this.now.asking = false;
    if (r) {
      const gone = { ...r, deleted: true, updated_at: Date.now() };
      await putEntries([gone]);
      await this.p.wrote([gone]);
    }
    await this.write({ at: null });
    this.reset();
    const next = nextSession(this.tr, this.p.today, { after: true }).s?.name;
    await this.now.after({ k: 'set', t: 'Training', where: 'training' });
    this.p.hooks.toast?.(`Training is off today. Next time is ${next || 'the same session'}`, {
      label: 'Undo',
      run: async () => {
        const back = await getEntry(id);
        if (back) { const kept = { ...back, deleted: false, updated_at: Date.now() }; await putEntries([kept]); await this.p.wrote([kept]); }
        await this.write({ at });
        await this.now.save({ task: was.task, since: was.since, skipped: was.skipped, last: was.last });
        this.p.redraw();
      }
    });
  }
}
