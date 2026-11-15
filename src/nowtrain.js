// Training in Now (Part 6): when the one thing is the day's "Training" line,
// Now shows ONE exercise at a time. A quiet line ("Training · Hard A · 3 of
// 13"), the name large, "Notes and video" when it has a link, one quiet line
// of what to do and what happened last time, then only the controls it
// needs: a dot per set (all filled; tap to bring it down), minutes (minus, a
// number, plus) and one number to record. Done, Skip this one, Back, Not now.
// A ladder asks once "Ready to move up?" when the mark is reached with every
// set done. After the last exercise, the session goes on today's page and
// the usual gate shows.

import { make } from './dom.js';
import { readTraining, sessionAt, exName, saveState, finishSession, isTraining, resultLine } from './training.js';
import { getEntry, putEntries } from './db.js';

export class TrainNow {
  constructor(now) {
    this.now = now;
    this.tr = null;
    this.reset();
  }

  reset() { this.cur = null; this.sets = null; this.min = null; this.ask = null; }
  get p() { return this.now.p; }
  active(cur) { return !!cur && !cur.smalls && isTraining(cur.item?.row); }
  async load() { this.tr = await readTraining(); }

  // Where he is in today's session: { i, res }.
  place() {
    const at = this.tr?.state.at;
    return at && at.day === this.p.today ? { i: at.i || 0, res: Array.isArray(at.res) ? at.res : [] } : { i: 0, res: [] };
  }
  session() { return this.tr ? sessionAt(this.tr) : null; }
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
      const ex = s.x.find((x) => x.lad === this.ask);
      const i = st.step?.[this.ask] || 0;
      const nextStep = ex?.steps?.[i + 1] || 'next step';
      mid.append(make('p', 'now-eyebrow', `Training · ${s.name}`));
      mid.append(make('p', 'now-thing sm', `${this.cur} ${ex?.u || ''}. Ready to move up to the ${nextStep.toLowerCase()}?`.replace(/ {2,}/g, ' ')));
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
    if (x.n) {
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
      mid.append(g);
    }
    if (x.m) mid.append(this.numRow('tmin', 'now-tmin', this.min, 'minutes', 'Minutes done', 'Fewer minutes', 'More minutes'));
    if (x.u) mid.append(this.numRow('tnum', 'now-tnum', this.cur, x.u, `${x.q || 'Your number'}, ${x.u}`, 'Less', 'More'));
    if (this.now.asking) mid.append(this.now.choices(this.now.m.cur));
    else mid.append(this.acts(i > 0));
    return mid;
  }

  numRow(act, id, value, unit, label, less, more) {
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
    lab.append(input, make('span', '', unit));
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
    if (a) this.cur = Math.max(0, Number(a.value) || 0);
    if (b) this.min = Math.max(0, Number(b.value) || 0);
  }

  // ---------- doing ----------

  async click(act, el) {
    this.read();
    const v = Number(el.dataset.v);
    if (act === 'tset') { this.sets = this.sets === v ? v - 1 : v; this.p.redraw(); return true; }
    if (act === 'tmin') { this.min = Math.max(0, (this.min || 0) + v); this.p.redraw(); return true; }
    if (act === 'tnum') { this.cur = Math.max(0, (this.cur || 0) + v); this.p.redraw(); return true; }
    if (act === 'tskip') { await this.move(1, null); return true; }
    if (act === 'tback') { await this.move(-1, null); return true; }
    if (act === 'tup') { await this.moveUp(v === 1); return true; }
    return false;
  }

  // Done with this exercise: its numbers kept for next time, then the next.
  async done() {
    this.read();
    const s = this.session();
    const x = this.ex();
    if (!s || !x) return;
    const st = this.tr.state;
    const patch = {};
    if (x.n) patch.lastSets = { ...st.lastSets, [x.k]: this.sets };
    if (x.m) patch.lastMin = { ...st.lastMin, [x.k]: this.min };
    if (x.u) patch.last = { ...st.last, [x.k]: this.cur };
    const line = resultLine(x, exName(x, st), { cur: x.u ? this.cur : null, sets: x.n ? this.sets : null, min: x.m ? this.min : null });
    const ready = x.lad && x.u && x.mark != null && this.cur >= x.mark && (!x.n || this.sets >= x.n) && (st.step?.[x.lad] || 0) < (x.steps?.length || 1) - 1;
    await this.write(patch);
    if (ready) { this.ask = x.lad; this.pending = line; this.p.redraw(); return; }
    await this.move(1, line);
  }

  async moveUp(yes) {
    const lad = this.ask;
    const line = this.pending;
    this.ask = null;
    this.pending = null;
    if (yes && lad) await this.write({ step: { ...this.tr.state.step, [lad]: (this.tr.state.step?.[lad] || 0) + 1 } });
    await this.move(1, line);
  }

  // To the next exercise (or back one); past the last, the session is over.
  async move(d, line) {
    const s = this.session();
    const { i, res } = this.place();
    const kept = line ? [...res, line] : res;
    this.reset();
    const to = Math.max(0, i + d);
    if (to >= s.x.length) return this.finish(kept);
    await this.write({ at: { day: this.p.today, i: to, res: kept } });
    this.p.redraw();
    return undefined;
  }

  async write(patch) {
    const row = await saveState(patch);
    if (row) { this.tr.state = { ...this.tr.state, ...patch }; await this.p.hooks.changed?.([row]); }
  }

  async finish(res, { own = false } = {}) {
    const s = this.session();
    const lineId = this.now.m?.cur?.item.row.id || null;
    const got = await finishSession({ name: s?.name || '', res, lineId, today: this.p.today, own });
    this.reset();
    await this.p.wrote(got.rows);
    await this.load();
    const t = own ? 'Training on your own' : `Training: ${s?.name || ''}`;
    await this.now.after({ k: 'done', t });
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
    const next = sessionAt(this.tr)?.name;
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
