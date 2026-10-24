import { putEntries, getEntry, children, getMeta, setMeta, CLAUDE } from './db.js';
import { entry } from './model.js';
import { GAP, bySort } from './order.js';
import { descendants } from './outline.js';
import { queueTask } from './daybook.js';

// The day review. Claude reads a day's page and writes a few sentences on what
// the day was like, then sorts what's on it into threads, each with a
// suggestion. You decide each one: make it a task in Daybook (you can change
// its words and area first), keep thinking about it (it goes on the "Still
// thinking about" page and comes back in later reviews), split it into its
// parts, or let it go. Nothing goes to Daybook until you say.
//
// A review is kept with its day, as an entry of its own (review-<date>) under
// the day page, so it syncs, and every choice made in it is kept there too.

export const reviewId = (iso) => `review-${iso}`;
export const MULLING = 'pg_mulling';
const MULLING_TITLE = 'Still thinking about';

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const shortDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

// The day's lines, in order, with how deeply each sits.
export async function dayLines(iso) {
  const day = `day-${iso}`;
  const rows = (await descendants(day)).filter((r) => !r.deleted);
  const depth = new Map([[day, -1]]);
  return rows.map((r) => {
    const d = (depth.get(r.parent_id) ?? -1) + 1;
    depth.set(r.id, d);
    return { id: r.id, text: (r.text || '').trim(), depth: d };
  }).filter((l) => l.text);
}

// What's on the "Still thinking about" page and not yet let go.
export async function mullingItems() {
  return (await children(MULLING)).filter((r) => r.kind === 'line' && !r.deleted && !r.fields?.done && (r.text || '').trim())
    .sort(bySort).map((r) => ({ id: r.id, text: r.text.trim(), since: r.fields?.mull?.from || isoOf(r.created_at) }));
}

export async function getReview(iso) {
  const row = await getEntry(reviewId(iso));
  return row && !row.deleted && row.fields?.review ? row : null;
}

// Asks Claude for the day's review and keeps it. Asked again, threads already
// decided stay as they were (with their lines left out of the new ask) and
// the rest are replaced.
export async function makeReview(iso, { ask, areas = [] }) {
  const prev = await getReview(iso);
  const kept = (prev?.fields.review.threads || []).filter((t) => t.choice);
  const used = new Set(kept.flatMap((t) => [...t.lines, ...(t.parts || []).flatMap((p) => p.lines)]));
  const lines = (await dayLines(iso)).filter((l) => !used.has(l.id));
  const all = await dayLines(iso);
  if (!all.length) { const e = new Error('There’s nothing on this day to look back over yet.'); e.status = 400; throw e; }
  const answer = lines.length
    ? await ask({ mode: 'review', day: iso, title: shortDay(iso), lines, mulling: await mullingItems(), areas: areas.map(({ id, title }) => ({ id, title })) })
    : { summary: prev?.fields.review.summary || '', threads: [], still: [] };
  const fresh = (answer.threads || []).map((t) => ({ ...t, choice: null, parts: (t.parts || []).map((p) => ({ ...p, choice: null })) }));
  const review = {
    at: Date.now(),
    summary: answer.summary || '',
    threads: [...kept, ...fresh],
    still: (answer.still || []).map((s) => ({ ...s, choice: null }))
  };
  const row = {
    ...(prev || entry('review', { id: reviewId(iso), title: 'Day review' })),
    parent_id: `day-${iso}`, kind: 'review', text: review.summary,
    fields: { ...(prev?.fields || {}), review }, deleted: false, updated_at: Date.now(), _by: CLAUDE
  };
  await putEntries([row]);
  return row;
}

// A card's place in the review: [thread], [thread, part] or ['still', n].
export function itemAt(review, path) {
  if (path[0] === 'still') return review.still[path[1]];
  const t = review.threads[path[0]];
  return path.length > 1 ? t?.parts?.[path[1]] : t;
}

// What's still to decide: threads and parts with no choice, and things from
// earlier days brought back.
export function waiting(review) {
  let n = review.still.filter((s) => !s.choice).length;
  for (const t of review.threads) {
    if (!t.choice) n += 1;
    else if (t.choice === 'split') n += t.parts.filter((p) => !p.choice).length;
  }
  return n;
}

async function saveChoice(iso, path, change) {
  const row = await getReview(iso);
  if (!row) return null;
  const review = structuredClone(row.fields.review);
  const it = itemAt(review, path);
  if (!it) return null;
  Object.assign(it, change);
  const next = { ...row, fields: { ...row.fields, review }, updated_at: Date.now() };
  await putEntries([next]);
  return next;
}

const taskId = (iso, path) => `inkwell-review-${iso}-${path.join('-')}`;

// The task for a card, as it'll go to Daybook: its words (yours if you
// changed them), the gist as its notes, its area, and a link back to the
// first line it came from.
export function taskOf(iso, path, it, base, { title, area_id } = {}) {
  const back = it.lines?.[0] || it.id || `day-${iso}`;
  return {
    id: taskId(iso, path),
    title: (title ?? it.task?.title ?? it.title ?? '').trim() || 'From Inkwell',
    notes: it.gist || it.note || null,
    link: `${base}?open=${encodeURIComponent(back)}`,
    area_id: area_id === undefined ? (it.task?.area_id || null) : (area_id || null),
    deleted: false
  };
}

// Each choice. They return the rows changed, for the open page to show.
export async function decide(iso, path, choice, { base, title, area_id, text } = {}) {
  const review = (await getReview(iso))?.fields.review;
  const it = review && itemAt(review, path);
  if (!it) return [];
  const rows = [];
  const still = path[0] === 'still';
  const mulled = still ? await getEntry(it.id) : null;
  if (choice === 'daybook') {
    const task = taskOf(iso, path, still ? { ...it, title: mulled?.fields?.mull?.words || mulled?.text, lines: [it.id] } : it, base, { title, area_id });
    await queueTask(task);
    const ids = still ? [it.id] : it.lines;
    for (const id of ids) {
      const line = await getEntry(id);
      if (line && !line.deleted) rows.push({ ...line, fields: { ...line.fields, daybook: { id: task.id, at: Date.now() }, ...(still ? { done: true } : {}) }, updated_at: Date.now() });
    }
    if (rows.length) await putEntries(rows);
    rows.push(await saveChoice(iso, path, { choice, sent: { title: task.title, area_id: task.area_id } }));
  } else if (choice === 'mull' && still) {
    if (mulled) { const r = { ...mulled, fields: { ...mulled.fields, mull: { ...(mulled.fields?.mull || {}), asked: iso } }, updated_at: Date.now() }; await putEntries([r]); rows.push(r); }
    rows.push(await saveChoice(iso, path, { choice }));
  } else if (choice === 'mull') {
    rows.push(...await addMulling(iso, path, it, text));
    rows.push(await saveChoice(iso, path, { choice, mulling: rows[rows.length - 1]?.id || null }));
  } else if (choice === 'let_go' && still) {
    if (mulled) { const r = { ...mulled, fields: { ...mulled.fields, done: true }, updated_at: Date.now() }; await putEntries([r]); rows.push(r); }
    rows.push(await saveChoice(iso, path, { choice }));
  } else if (choice === 'let_go' || choice === 'split') {
    rows.push(await saveChoice(iso, path, { choice }));
  }
  return rows.filter(Boolean);
}

// Takes a choice back: a line added to "Still thinking about" goes again, a
// thing let go comes back. (A task already in Daybook stays there.)
export async function undo(iso, path) {
  const review = (await getReview(iso))?.fields.review;
  const it = review && itemAt(review, path);
  if (!it || it.choice === 'daybook') return [];
  const rows = [];
  if (path[0] === 'still') {
    const m = await getEntry(it.id);
    if (m) { const r = { ...m, fields: { ...m.fields, done: false }, updated_at: Date.now() }; await putEntries([r]); rows.push(r); }
  } else if (it.choice === 'mull' && it.mulling) {
    const m = await getEntry(it.mulling);
    if (m && !m.deleted) { const r = { ...m, deleted: true, updated_at: Date.now() }; await putEntries([r]); rows.push(r); }
  }
  rows.push(await saveChoice(iso, path, { choice: null, mulling: null }));
  return rows.filter(Boolean);
}

// The "Still thinking about" page, made the first time something goes there.
async function mullingPage() {
  const page = await getEntry(MULLING);
  if (page && !page.deleted) return [page, []];
  const row = { ...(page || entry('page', { id: MULLING })), title: page?.title || MULLING_TITLE, deleted: false, updated_at: Date.now() };
  return [row, [row]];
}

async function addMulling(iso, path, it, text) {
  const [page, rows] = await mullingPage();
  const kids = (await children(page.id)).filter((r) => r.kind === 'line');
  const id = `li_mull_${iso}_${path.join('_')}`;
  const prev = kids.find((k) => k.id === id);
  const words = (text ?? it.title).trim();
  const content = [{ type: 'text', text: `${words} ` }];
  if (it.lines?.[0]) content.push({ type: 'entryRef', attrs: { id: it.lines[0], title: shortDay(iso) } });
  const sort = prev?.sort ?? (kids.length ? Math.max(...kids.map((k) => k.sort || 0)) + GAP : GAP);
  const line = {
    ...(prev || entry('line', { id })), kind: 'line', parent_id: page.id, sort,
    text: `${words} ${it.lines?.[0] ? shortDay(iso) : ''}`.trim(), content, tags: [], links: it.lines?.[0] ? [it.lines[0]] : [],
    fields: { ...(prev?.fields || {}), done: false, gather: null, gathered: null, mirror: null, mull: { from: iso, words, lines: it.lines || [], gist: it.gist || '' } },
    deleted: false, updated_at: Date.now()
  };
  rows.push(line);
  await putEntries(rows);
  return rows;
}

// Daybook's areas, kept from the last time they could be read so a review
// works offline too.
export async function loadAreas(read) {
  try {
    const fresh = await read();
    if (Array.isArray(fresh)) { await setMeta('daybookAreas', fresh); return fresh; }
  } catch (e) { console.warn(e); }
  return (await getMeta('daybookAreas')) || [];
}

// ---------- on the day page ----------

const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const LABEL = { daybook: 'Add to Daybook', mull: 'Keep thinking', split: 'Split', let_go: 'Let go' };

export class DayReview {
  // ask/canAsk reach Claude; send/canSend reach Daybook; areas() lists
  // Daybook's areas; onRows(rows) shows changed rows; onOpen(id) opens a line.
  constructor(box, opts) {
    this.box = box;
    this.o = opts;
    this.iso = null;
    this.folded = new Map();
    this.busy = false;
    box.querySelector('.dr-toggle').addEventListener('click', () => {
      this.folded.set(this.iso, !this.isFolded());
      this.render();
    });
    box.querySelector('.dr-start').addEventListener('click', () => this.run());
    box.querySelector('.dr-again').addEventListener('click', () => this.run());
  }

  isFolded() {
    if (this.folded.has(this.iso)) return this.folded.get(this.iso);
    return !this.row || !waiting(this.row.fields.review);
  }

  // Shows the review for a day page (or nothing, on any other page).
  async show(page) {
    this.iso = page?.kind === 'day' ? (page.title || page.id.slice(4)) : null;
    if (!this.iso) { this.box.hidden = true; return; }
    await this.refresh();
  }

  // Lines were saved on the day: a day without a review may now offer one.
  soon() {
    if (this.row) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 800);
  }

  // On a day without a review, a quiet "Review the day" once there's a bit on
  // it and the day is nearly over (or past).
  offer() {
    const h = new Date().getHours();
    const today = this.iso === isoOf(Date.now());
    return this.lineCount >= 2 && (!today || h >= 18);
  }

  render() {
    const box = this.box;
    const row = this.row;
    box.classList.toggle('busy', this.busy);
    const start = box.querySelector('.dr-start');
    const toggle = box.querySelector('.dr-toggle');
    const body = box.querySelector('.dr-body');
    if (!row) {
      toggle.hidden = true;
      body.hidden = true;
      start.hidden = !(this.busy || this.offer());
      start.textContent = this.busy ? 'Claude is reading the day…' : 'Review the day';
      start.disabled = this.busy;
      box.hidden = start.hidden;
      return;
    }
    const review = row.fields.review;
    const left = waiting(review);
    const folded = this.isFolded() && !this.busy;
    box.hidden = false;
    start.hidden = true;
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', String(!folded));
    toggle.querySelector('.dr-left').textContent = this.busy ? ' · Claude is reading the day…' : left ? ` · ${left} to sort` : '';
    body.hidden = folded;
    box.classList.toggle('open', !folded);
    if (folded) return;
    body.querySelector('.dr-summary').replaceChildren(...review.summary.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t) => make('p', '', t)));
    const cards = body.querySelector('.dr-cards');
    cards.replaceChildren();
    review.still.forEach((s, i) => cards.append(this.card(['still', i], s, true)));
    review.threads.forEach((t, i) => {
      if (t.choice === 'split') {
        const group = make('div', 'dr-split');
        group.append(make('div', 'dr-split-title', t.title));
        t.parts.forEach((p, j) => group.append(this.card([i, j], p)));
        const back = make('button', 'ghost-btn dr-unsplit', 'Put back together');
        back.type = 'button';
        back.addEventListener('click', () => this.undo([i]));
        group.append(back);
        cards.append(group);
      } else cards.append(this.card([i], t));
    });
    body.querySelector('.dr-quiet').hidden = !!(review.threads.length || review.still.length);
    body.querySelector('.dr-again').disabled = this.busy;
  }

  card(path, it, still = false) {
    const c = make('div', `dr-card${it.choice ? ' decided' : ''}`);
    const mulled = still ? (this.mulled?.get(it.id) || '') : '';
    if (still) c.append(make('div', 'dr-label', 'Still on your mind?'));
    c.append(make('div', 'dr-title', still ? mulled : it.title));
    if (it.choice) {
      const done = make('div', 'dr-outcome');
      const area = it.sent?.area_id ? (this.areas || []).find((a) => a.id === it.sent.area_id)?.title : null;
      done.append(make('span', '', it.choice === 'daybook' ? `In Daybook${area ? ` · ${area}` : '’s Inbox'}` : it.choice === 'mull' ? (still ? 'Still thinking about it' : 'On “Still thinking about”') : 'Let go'));
      if (it.choice !== 'daybook') {
        const u = make('button', 'ghost-btn', 'Undo');
        u.type = 'button';
        u.addEventListener('click', () => this.undo(path));
        done.append(u);
      }
      c.append(done);
      return c;
    }
    const gist = still ? it.note : it.gist;
    if (gist) c.append(make('div', 'dr-gist', gist));
    if (!still && it.lines?.length) {
      const from = make('div', 'dr-from');
      for (const id of it.lines.slice(0, 4)) {
        const b = make('button', 'dr-line', this.lineText?.get(id) || '…');
        b.type = 'button';
        b.addEventListener('click', () => this.o.onOpen(id));
        from.append(b);
      }
      c.append(from);
    }
    const acts = make('div', 'dr-actions');
    const choices = still ? ['daybook', 'mull', 'let_go'] : ['daybook', 'mull', ...(it.parts?.length > 1 ? ['split'] : []), 'let_go'];
    for (const ch of choices) {
      const b = make('button', ch === (it.suggest || (still ? 'mull' : '')) ? 'pill dr-suggested' : 'pill', LABEL[ch]);
      b.type = 'button';
      b.dataset.choice = ch;
      b.addEventListener('click', () => (ch === 'daybook' ? this.taskForm(c, path, it, still ? mulled : null) : this.choose(path, ch)));
      acts.append(b);
    }
    c.append(acts);
    return c;
  }

  // Before a task goes, its words and area, to change if you like.
  taskForm(card, path, it, mulled) {
    if (card.querySelector('.dr-task')) { card.querySelector('.dr-task input').focus(); return; }
    const f = make('form', 'dr-task');
    const input = make('input');
    input.value = mulled || it.task?.title || it.title;
    input.setAttribute('aria-label', 'Task');
    const pick = make('select');
    pick.setAttribute('aria-label', 'Area in Daybook');
    pick.append(new Option('Inbox', ''));
    for (const a of this.areas || []) pick.append(new Option(a.title, a.id));
    pick.value = it.task?.area_id && (this.areas || []).some((a) => a.id === it.task.area_id) ? it.task.area_id : '';
    const send = make('button', 'pill dr-send', 'Send to Daybook');
    send.type = 'submit';
    const cancel = make('button', 'ghost-btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => f.remove());
    f.append(input, pick, send, cancel);
    f.addEventListener('submit', (e) => { e.preventDefault(); this.choose(path, 'daybook', { title: input.value, area_id: pick.value || null }); });
    f.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); f.remove(); } });
    card.append(f);
    input.focus();
    input.select();
  }

  async choose(path, choice, extra = {}) {
    const iso = this.iso;
    const rows = await decide(iso, path, choice, { base: this.o.base(), ...extra });
    await this.o.onRows(rows);
    if (choice === 'daybook') {
      const sent = await this.o.sendPending();
      this.o.toast(sent ? 'Sent to Daybook' : 'It’ll go to Daybook once you’re online and signed in');
    }
    if (iso === this.iso) await this.refresh();
  }

  async undo(path) {
    const rows = await undo(this.iso, path);
    await this.o.onRows(rows);
    await this.refresh();
  }

  // Reads what the cards show: the lines' words, what's being mulled, the areas.
  async refresh() {
    const iso = this.iso;
    const row = await getReview(iso);
    if (iso !== this.iso) return;
    this.row = row;
    if (row) {
      const review = row.fields.review;
      const ids = review.threads.flatMap((t) => [...t.lines, ...(t.parts || []).flatMap((p) => p.lines)]);
      this.lineText = new Map();
      for (const id of ids) { const l = await getEntry(id); if (l) this.lineText.set(id, (l.text || '').replace(/\s+/g, ' ').slice(0, 90)); }
      this.mulled = new Map();
      for (const s of review.still) { const m = await getEntry(s.id); this.mulled.set(s.id, m?.fields?.mull?.words || m?.text || ''); }
      this.areas = await loadAreas(this.o.areas);
    } else {
      this.lineCount = (await dayLines(iso)).length;
    }
    this.render();
  }

  // Asks Claude for this day's review (again, if there is one).
  async run(iso = this.iso) {
    if (this.busy || !iso) return;
    if (!this.o.canAsk()) { this.o.toast('The day review needs you online and signed in'); return; }
    this.iso = iso;
    this.busy = true;
    this.folded.delete(iso);
    this.render();
    try {
      this.areas = await loadAreas(this.o.areas);
      const row = await makeReview(iso, { ask: this.o.ask, areas: this.areas });
      await this.o.onRows([row]);
    } catch (e) {
      console.error(e);
      this.o.toast(e.message || 'Couldn’t review the day. Try again.');
    } finally {
      this.busy = false;
      await this.refresh();
    }
  }

  // Opens this day's review and brings it into view.
  async reveal() {
    this.folded.set(this.iso, false);
    await this.refresh();
    this.box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}
