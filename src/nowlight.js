// First light in Now (Part 5): the first time Today is opened each day, before
// anything else, "Today's reading": six chapters by name, then Read here, I
// read it on paper, Set where I am, Not this morning. Read here shows one
// chapter per screen in the reading face and nothing else, then Next chapter,
// then "Amen. Show me the day". Without the ESV key (Crossway's approval can
// take weeks), the names link to esv.org, Read here is hidden and "I read it
// on paper" is "I read it". The plan and places are in firstlight.js.

import { make } from './dom.js';
import { autoOn } from './auto.js';
import { TRACKS, posOf, placeOf, readReading, saveReading, todays, advanced, readYesterday, missedYesterday, esvLink, keyState, kept, chapter, tickBibleHabit } from './firstlight.js';
import { readStreak, doneLine } from './readstats.js';
import { tickLight, lightToday, dropLine } from './firstlight.js';

export class LightNow {
  constructor(now) {
    this.now = now;
    this.st = null;
    this.rd = -1; // the chapter on screen, or -1 for the list
    this.setting = false;
    this.forced = false; // opened again from the commands
    this.got = {}; // ref → { text, notice } | { error } | 'loading'
  }

  get p() { return this.now.p; }
  async load() { this.st = await readReading(); }

  // Showing now? Before anything else, once a day, unless something is begun.
  due() {
    if (!this.st || !autoOn('firstlight')) return false;
    // On the zoom First light is a line of the day, opened like any line (Part 2):
    // it only takes over Now when asked for from the commands.
    return this.forced;
  }

  noKey() { return keyState(this.p.today) !== false; }

  // Ask once for the first chapter: it tells whether the text can show here.
  probe(refs) {
    if (keyState(this.p.today) !== null || this.probed === this.p.today) return;
    const ask = this.p.hooks.bible;
    if (!ask) return;
    this.probed = this.p.today;
    chapter(refs[0], ask, this.p.today).then((got) => {
      if (!got.nokey && !got.error) this.got[refs[0]] = got;
      if (!got.error) this.p.redraw();
    });
  }

  // bare: inside First light's own page (the zoom), under its heading.
  view({ bare = false } = {}) {
    const mid = make('div', `now-mid now-ends now-light${bare ? ' bare' : ''}`);
    const refs = todays(this.st);
    if (this.setting) return this.setView(mid);
    if (this.rd >= 0) return this.readView(mid, refs);
    this.probe(refs);
    const nokey = this.noKey();
    if (!bare) mid.append(make('p', 'now-eyebrow', 'Bible reading'), make('h1', 'now-thing sm', 'Today’s reading'));
    const list = make('ul', 'now-reading');
    for (const r of refs) {
      const li = make('li');
      if (nokey) {
        const a = make('a', 'now-ref-link', r);
        a.href = esvLink(r);
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = `${r} on esv.org`;
        li.append(a);
      } else li.append(make('span', '', r));
      list.append(li);
    }
    mid.append(list);
    const acts = make('div', 'now-acts');
    if (!nokey) acts.append(this.now.btn('lread', 'Read here', 'go', 'R'));
    acts.append(this.now.btn('ldone', nokey ? 'I read it' : 'I read it on paper', nokey ? 'go' : '', 'I'));
    mid.append(acts);
    const quiet = make('div', 'now-endsrow');
    quiet.append(this.now.btn('lset', 'Set where I am', 'link'));
    // The morning after a day with no mark (Part 8): only there to be tapped.
    if (missedYesterday(this.st, this.p.today)) quiet.append(this.now.btn('lyest', 'I read yesterday too', 'link'));
    quiet.append(this.now.btn('lskip', 'Not this morning', 'link', 'Esc'));
    mid.append(quiet);
    mid.append(make('p', 'now-hint', nokey
      ? 'Tap a chapter to read it on esv.org. Your place only moves when you have read. A missed day changes nothing.'
      : 'Your place only moves when you have read. A missed day changes nothing.'));
    return mid;
  }

  readView(mid, refs) {
    const ref = refs[this.rd];
    const last = this.rd >= refs.length - 1;
    mid.classList.add('reading');
    mid.append(make('p', 'now-eyebrow', `Bible reading · ${this.rd + 1} of ${refs.length}`), make('h1', 'now-thing sm', ref));
    const got = this.got[ref] || kept(ref, this.p.today);
    const body = make('article', 'now-scripture');
    body.setAttribute('aria-label', ref);
    if (!got || got === 'loading') {
      body.append(make('p', 'now-ref', 'Opening the chapter…'));
      if (got !== 'loading') this.fetch(ref);
    } else if (got.error || got.nokey) {
      const p = make('p', 'now-ref', `${got.nokey ? 'The text can’t show here yet.' : got.error} `);
      const a = make('a', 'now-ref-link', `Read ${ref} on esv.org`);
      a.href = esvLink(ref);
      a.target = '_blank';
      a.rel = 'noopener';
      p.append(a);
      body.append(p);
    } else {
      body.append(...scripture(got.text));
      const foot = make('footer', 'now-esv');
      if (got.notice) foot.append(make('p', '', got.notice));
      const a = make('a', '', 'ESV · www.esv.org');
      a.href = 'https://www.esv.org/';
      a.target = '_blank';
      a.rel = 'noopener';
      foot.append(a);
      body.append(foot);
    }
    mid.append(body);
    const acts = make('div', 'now-acts');
    acts.append(this.now.btn(last ? 'ldone' : 'lnext', last ? 'Amen. Show me the day' : 'Next chapter', 'go', last ? '' : 'Right arrow'));
    if (this.rd > 0) acts.append(this.now.btn('lback', 'Back', 'quiet', 'Left arrow'));
    acts.append(this.now.btn('llist', 'The list', 'quiet'));
    mid.append(acts);
    return mid;
  }

  fetch(ref) {
    this.got[ref] = 'loading';
    chapter(ref, this.p.hooks.bible, this.p.today).then((got) => { this.got[ref] = got; this.p.redraw(); });
  }

  setView(mid) {
    mid.append(make('p', 'now-eyebrow', 'Bible reading'), make('h1', 'now-thing sm', 'Where are you in each?'));
    const form = make('form', 'now-tracks');
    for (const t of TRACKS) {
      const [b, ch] = posOf(t.books, this.st[t.k] || 0);
      const row = make('div', 'now-track');
      const lab = make('span', 'now-trk', t.name);
      const sel = make('select');
      sel.dataset.trk = t.k;
      sel.setAttribute('aria-label', `${t.name}: book`);
      t.books.forEach(([name], i) => { const o = make('option', '', name); o.value = String(i); if (i === b) o.selected = true; sel.append(o); });
      const num = make('input');
      num.type = 'number';
      num.inputMode = 'numeric';
      num.min = '1';
      num.max = String(t.books[b][1]);
      num.value = String(ch);
      num.dataset.trk = t.k;
      num.setAttribute('aria-label', `${t.name}: chapter`);
      sel.addEventListener('change', () => { num.max = String(t.books[Number(sel.value)][1]); num.value = '1'; });
      row.append(lab, sel, num);
      form.append(row);
    }
    const acts = make('div', 'now-acts');
    const ok = this.now.btn('lsetok', 'That is where I am', 'go');
    ok.type = 'submit';
    acts.append(ok, this.now.btn('llist', 'Cancel', 'quiet'));
    form.append(acts);
    form.addEventListener('submit', (e) => { e.preventDefault(); this.now.run(() => this.saveSet()); });
    mid.append(form, make('p', 'now-hint', 'Each one goes round by itself and starts over when it reaches the end.'));
    return mid;
  }

  // ---------- doing ----------

  async click(act) {
    if (act === 'lread') { this.rd = 0; this.p.redraw(); this.top(); return; }
    if (act === 'lnext') { this.rd += 1; this.p.redraw(); this.top(); return; }
    if (act === 'lback') { this.rd = Math.max(0, this.rd - 1); this.p.redraw(); this.top(); return; }
    if (act === 'llist') { this.rd = -1; this.setting = false; this.p.redraw(); return; }
    if (act === 'lset') { this.setting = true; this.p.redraw(); return; }
    if (act === 'lsetok') { await this.saveSet(); return; }
    if (act === 'ldone') { await this.read(); return; }
    if (act === 'lyest') { await this.yesterday(); return; }
    if (act === 'lskip') await this.skip();
  }

  top() { requestAnimationFrame(() => { this.p.sheet.scrollTop = 0; window.scrollTo(0, 0); }); }

  // He has read: the places move on, his Bible habit is ticked, the day shows.
  async read() {
    const was = { ...this.st };
    const today = this.p.today;
    this.st = advanced(this.st, today);
    await saveReading(this.st);
    // One quiet line on the next screen (Part 8), with the streak switch on.
    const root = document.documentElement;
    this.note = doneLine(readStreak(this.st.days, today));
    const habit = await tickBibleHabit(this.p.items, today);
    if (habit) await this.p.wrote(habit.rows);
    const line = await tickLight(this.p.items || [], today, true);
    if (line.length) await this.p.wrote(line);
    this.leave();
    this.p.hooks.toast?.('Read. Tomorrow’s chapters are next', {
      label: 'Undo',
      run: async () => {
        this.st = was;
        this.note = '';
        await saveReading(was);
        if (habit) { const { tickTask } = await import('./tasks.js'); await this.p.wrote(await tickTask(habit.id, false)); }
        if (line.length) await this.p.wrote(await tickLight(this.p.items || [], today, false));
        await this.p.refresh();
      }
    });
    await this.p.refresh();
  }

  // "I read yesterday too": yesterday is marked and the places move on.
  async yesterday() {
    const was = { ...this.st };
    this.st = readYesterday(this.st, this.p.today);
    await saveReading(this.st);
    this.p.redraw();
    this.p.hooks.toast?.('Yesterday is marked as read, and your place has moved on', { label: 'Undo', run: async () => { this.st = was; await saveReading(was); this.p.redraw(); } });
  }

  async skip() {
    this.st = { ...this.st, skip: this.p.today };
    await saveReading(this.st);
    // Its line for today goes too: a reading set aside never piles up.
    const line = lightToday(this.p.items || [], this.p.today);
    if (line && !line.row.fields?.done) await this.p.wrote(await dropLine(line.row.id));
    this.leave();
    this.p.redraw();
  }

  async saveSet() {
    const was = { ...this.st };
    const next = { ...this.st };
    const form = this.p.sheet.querySelector('.now-tracks');
    for (const t of TRACKS) {
      const sel = form?.querySelector(`select[data-trk="${t.k}"]`);
      const num = form?.querySelector(`input[data-trk="${t.k}"]`);
      if (!sel || !num) continue;
      next[t.k] = placeOf(t.books, Number(sel.value) || 0, Number(num.value) || 1);
    }
    this.st = next;
    await saveReading(next);
    this.setting = false;
    this.p.redraw();
    this.p.hooks.toast?.('Your places are set', { label: 'Undo', run: async () => { this.st = was; await saveReading(was); this.p.redraw(); } });
  }

  leave() { this.rd = -1; this.setting = false; this.forced = false; }

  // Opened again (a command): the list, whatever the day.
  open() { this.forced = true; this.rd = -1; this.setting = false; }

  key(k, e) {
    if (this.setting) return null;
    if (this.rd >= 0) {
      if (e.key === 'ArrowRight') return () => (this.rd < 5 ? this.click('lnext') : null);
      if (e.key === 'ArrowLeft') return () => this.click('lback');
      if (e.key === 'Escape') return () => this.click('llist');
      return null;
    }
    if (k === 'r' && !this.noKey()) return () => this.click('lread');
    if (k === 'i') return () => this.click('ldone');
    if (e.key === 'Escape') return () => this.click('lskip');
    return null;
  }
}

// The chapter as sent, in the reading face: headings, paragraphs, poetry
// lines kept, verse numbers small. Built as text, never as markup.
function scripture(text) {
  const out = [];
  for (const block of String(text).split(/\n\s*\n/)) {
    const raw = block.replace(/\s+$/, '');
    if (!raw.trim()) continue;
    const heading = !/\[\d+\]/.test(raw) && !raw.includes('\n') && raw.trim().length < 80;
    if (heading) { out.push(make('h2', 'sc-h', raw.trim())); continue; }
    const p = make('p', `sc-p${/^ {2,}/m.test(raw) ? ' poetry' : ''}`);
    const parts = raw.split(/(\[\d+\])/);
    for (const part of parts) {
      const v = /^\[(\d+)\]$/.exec(part);
      if (v) p.append(make('sup', 'sc-v', v[1]));
      else if (part) p.append(document.createTextNode(part));
    }
    out.push(p);
  }
  return out;
}
