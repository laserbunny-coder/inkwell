// The plan under the scene line (Nov 20 2026): a Woven scene's title,
// summary and story threads unfold in place under its line (the middle of
// the line), and its notes under the right end. Everything here belongs to
// the scene's hidden heading, its one anchor, so it moves with the scene and
// the plot grid shows the same rows:
//   - the title is the level-3 section right above the heading (as before);
//   - the summary is the heading paragraph's synopsis;
//   - a thread line is a note on the heading with fields.thread (and
//     fields.beat: promise, progress or payoff), the grid's cell.
// What's open is per script and per device (localStorage), never synced.
import { putEntries } from './db.js';
import { entry } from './model.js';
import { plain as make } from './dom.js';
import { BEATS, newThread } from './grid.js';
import { findScene, ensureHeading, setTitle, setSummary, lineKey, redraw, scenesOf } from './woven.js';
import { shotsUnder } from './production.js';
import { PlanLines, trashLinesUnder, restoreLines } from './planlines.js';

// Thread colours, by a thread's place in the world's list.
export const HUES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const MARK = { '': '·', promise: '◇', progress: '→', payoff: '◆' };
const ORDER = ['', 'promise', 'progress', 'payoff'];
const ABOUT = { '': 'No mark. Tap to make it a promise', ...Object.fromEntries(BEATS.map((b) => [b.id, `${b.label}: ${b.about.toLowerCase()}. Tap for the next mark`])) };
// Not yours to add to: readers' comments (share links) and Claude's notes.
const NOT_MINE = ['comment', 'claude'];

const PREF = (id) => `wvPlan:${id}`;

export class ScenePlan {
  // hooks: editor(), notes (NotesLayer), project(), world(), toast(text, action),
  // scenePop, touch(), titles(), toggleTitles(), openShots(eid), steady(change, key).
  constructor(hooks) {
    this.hooks = hooks;
    this.id = null;
    this.all = false;
    this.open = new Set();
    this.noted = new Set();
    this.adding = null; // the scene whose "+ thread" chips are showing
    this.versions = new Map();
    this.focusNext = null;
    // Lines under the summary, a thread line or a note (planlines.js).
    this.startLines = null; // the top line whose first line is on its way
    this.lines = new PlanLines({ openRef: (id) => hooks.openRef?.(id), onFocus: (ed) => hooks.onLines?.(ed) });
  }

  get editor() { return this.hooks.editor(); }
  get notes() { return this.hooks.notes; }

  // ---------- what's open (per script, per device) ----------

  load(projectId) {
    this.id = projectId || null;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PREF(this.id)) || 'null'); } catch {}
    this.all = !!saved?.all;
    this.open = new Set(saved?.open || []);
    this.noted = new Set(saved?.notes || []);
    this.adding = null;
    this.lines.dropAll();
    document.documentElement.classList.toggle('wv-plan-all', this.all);
  }
  save() {
    if (!this.id) return;
    try { localStorage.setItem(PREF(this.id), JSON.stringify({ all: this.all, open: [...this.open], notes: [...this.noted] })); } catch {}
  }
  isOpen(k) { return this.all !== this.open.has(k); }
  notesOpen(k) { return this.noted.has(k); }
  titles() { return this.hooks.titles(); }
  version(k) { return this.versions.get(k) || 0; }
  bump(k) { this.versions.set(k, this.version(k) + 1); }
  redraw() { this.redrawDoc(); this.afterDraw(); }

  // Where a scene's things are kept. Here a Woven scene (its hidden heading);
  // a novel's chapters and scene breaks override these (src/novelplan.js).
  find(ref) { return findScene(this.editor.state.doc, ref); }
  keyOf(s) { return lineKey(s); }
  putTitle(sc, v) { setTitle(this.editor, sc.pos, v); }
  putSummary(sc, v) { setSummary(this.editor, sc.pos, v); }
  redrawDoc() { redraw(this.editor); }
  words() { return { title: 'Name this scene (only you see it)', titleAria: 'Scene title (only you see it)', sum: 'What happens in this scene' }; }

  // Folding or unfolding keeps the line you tapped where it is on the screen,
  // both ways (src/steady.js), on a computer and a phone.
  toggle(ref) {
    this.hooks.steady(() => {
      if (this.open.has(ref.key)) this.open.delete(ref.key); else this.open.add(ref.key);
      if (!this.isOpen(ref.key) && this.adding === ref.key) this.adding = null;
      this.save();
      this.redrawDoc();
    }, ref.key);
    this.afterDraw();
  }
  toggleNotes(ref) {
    this.hooks.steady(() => {
      if (this.noted.has(ref.key)) this.noted.delete(ref.key); else this.noted.add(ref.key);
      this.save();
      this.redrawDoc();
    }, ref.key);
    this.afterDraw();
  }
  // A scene just made with "# ": its plan open, the caret in its title.
  openTitle(pos) {
    const eid = this.editor.state.doc.nodeAt(pos)?.attrs.eid;
    if (!eid) return;
    if (!this.isOpen(eid)) { if (this.all) this.open.delete(eid); else this.open.add(eid); }
    this.save();
    this.focusNext = `.wv-plan[data-key="${CSS.escape(eid)}"] .wv-p-title`;
    this.redraw();
  }

  // A search result in a scene's plan: that scene's plan unfolded, in view.
  showPlan(eid) {
    if (!this.isOpen(eid)) { if (this.all) this.open.delete(eid); else this.open.add(eid); }
    this.save();
    this.redraw();
    requestAnimationFrame(() => document.querySelector(`.wv-plan[data-key="${CSS.escape(eid)}"]`)?.scrollIntoView({ block: 'center' }));
  }

  // A margin note's "▸ N": its scene's notes (or plan, for a thread line) unfolded.
  showNoteLines(n) {
    const eid = n.parent_id;
    if (n.fields?.thread) return this.showPlan(eid);
    this.noted.add(eid);
    this.save();
    this.redraw();
    requestAnimationFrame(() => document.querySelector(`.wv-notes[data-key="${CSS.escape(eid)}"]`)?.scrollIntoView({ block: 'center' }));
  }

  // Every scene's plan at once (Ctrl + Shift + Comma, the Plan button).
  toggleAll(key = null) {
    this.hooks.steady(() => {
      this.all = !this.all;
      this.open.clear();
      this.adding = null;
      document.documentElement.classList.toggle('wv-plan-all', this.all);
      this.save();
      this.redrawDoc();
    }, key);
    this.afterDraw();
    document.dispatchEvent(new CustomEvent('inkwell:plan-all', { detail: this.all }));
  }
  // The left end of a line: titles on or off for the whole script, and the
  // line you tapped stays where it is.
  titlesFrom(ref) {
    this.hooks.steady(() => { this.hooks.toggleTitles(); this.redrawDoc(); }, ref.key);
  }

  // The opening stretch of a chapter has no heading yet; give it one the first
  // time something is kept on it, and keep its plan open under its new name.
  anchor(ref) {
    const s = findScene(this.editor.state.doc, ref);
    if (!s) return null;
    if (s.node) return s;
    const at = ensureHeading(this.editor, s);
    const eid = this.editor.state.doc.nodeAt(at)?.attrs.eid;
    if (!eid) return null;
    for (const set of [this.open, this.noted]) if (set.has('top')) { set.delete('top'); set.add(eid); }
    if (this.adding === 'top') this.adding = eid;
    ref.eid = eid; ref.key = eid; ref.at = at;
    this.save();
    return findScene(this.editor.state.doc, ref);
  }

  // After a redraw, the field that should have the caret gets it.
  afterDraw() {
    requestAnimationFrame(() => this.lines.sweep());
    const f = this.focusNext;
    this.focusNext = null;
    if (!f) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(f);
      if (el) { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); }
    });
  }

  threadNotes(eid) {
    if (!eid) return [];
    return this.notes.notes.filter((n) => n.parent_id === eid && !n.deleted && n.fields?.thread).sort((a, b) => (a.sort || a.created_at || 0) - (b.sort || b.created_at || 0));
  }
  // Every note in a scene (Part 4): the scene's own, then those on its
  // paragraphs in the order of the text. Nothing moves: a paragraph's note
  // stays in the margin too; this only gathers them.
  sceneNotes(s) {
    const own = s.eid ? this.notes.notes.filter((n) => n.parent_id === s.eid && this.gathered(n)).sort((a, b) => (a.created_at || 0) - (b.created_at || 0)) : [];
    const paras = this.parasIn(s);
    const where = new Map(paras.map((id, i) => [id, i]));
    const onParas = this.notes.notes.filter((n) => where.has(n.parent_id) && this.gathered(n)).sort((a, b) => where.get(a.parent_id) - where.get(b.parent_id) || (a.created_at || 0) - (b.created_at || 0));
    return [...own, ...onParas];
  }
  gathered(n) { return !n.deleted && !n.fields?.thread && !n.fields?.resolved && !this.notes.skip(n); }
  // The paragraphs a scene holds: from its heading to the next scene.
  parasIn(s) {
    const doc = this.editor.state.doc;
    const all = scenesOf(doc);
    const i = all.findIndex((x) => (s.eid ? x.eid === s.eid : !x.node));
    if (i < 0) return [];
    const from = all[i].at;
    const next = all[i + 1];
    const to = next ? (next.titlePos ?? next.at) : doc.content.size;
    const ids = [];
    doc.forEach((node, pos) => { if (pos > from && pos < to && node.attrs.eid && node.type.name === 'paragraph' && node.attrs.el !== 'scene') ids.push(node.attrs.eid); });
    return ids;
  }
  // A paragraph's note: the caret to its paragraph, in view.
  toParagraph(eid) {
    let at = null;
    this.editor.state.doc.forEach((node, pos) => { if (at === null && node.attrs.eid === eid) at = pos; });
    if (at === null) return;
    this.editor.commands.focus(at + 1);
    requestAnimationFrame(() => this.editor.view.dom.querySelector(`[data-eid="${CSS.escape(eid)}"]`)?.scrollIntoView({ block: 'center' }));
  }
  hue(threadId) {
    const i = this.notes.threads.findIndex((t) => t.id === threadId);
    return HUES[(i < 0 ? 0 : i) % HUES.length];
  }
  threadNoteType() {
    return this.notes.types.find((t) => !NOT_MINE.includes(t.id))?.id || this.notes.types[0]?.id || null;
  }
  myNoteType() {
    const last = localStorage.getItem('wvNoteType');
    const mine = this.notes.types.filter((t) => !NOT_MINE.includes(t.id));
    return (mine.find((t) => t.id === last) || mine[0] || this.notes.types[0])?.id || null;
  }

  // ---------- lines under a top line ----------

  // Enter at the end of a top line starts the first line under it.
  atEnd(field) { return field.selectionStart === field.value.length && field.selectionEnd === field.value.length; }
  startUnder(ref, ownerId) {
    this.startLines = ownerId;
    this.bump(ref.key);
    this.redraw();
  }
  under(ownerId, ref, field, summary = false) {
    const start = !!ownerId && this.startLines === ownerId;
    if (start) this.startLines = null;
    return this.lines.mount(ownerId, { summary, start, top: () => (field.isConnected ? field : document.querySelector(`[data-owner="${CSS.escape(ownerId)}"] .wv-topf`)), leave: () => this.backToText(ref) });
  }

  // ---------- the story plan (middle of the line) ----------

  planBlock(s) {
    const k = this.keyOf(s);
    const ref = { eid: s.eid, at: s.at, key: k };
    const box = make('div', 'wv-plan');
    const say = this.words(s);
    box.dataset.key = k;
    const title = make('input', 'wv-p-title');
    title.placeholder = say.title;
    title.setAttribute('aria-label', say.titleAria);
    title.value = s.title || '';
    title.enterKeyHint = 'next';
    const keepTitle = () => {
      const v = title.value.trim();
      const now = this.find(ref);
      if (!now || v === (now.title || '')) return;
      const sc = this.anchor(ref);
      if (sc) this.putTitle(sc, v);
    };
    title.addEventListener('change', keepTitle);
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); keepTitle(); document.querySelector(`.wv-plan[data-key="${CSS.escape(ref.key)}"] .wv-p-sum`)?.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); title.value = s.title || ''; this.backToText(ref); }
    });
    const sum = make('textarea', 'wv-p-sum');
    sum.rows = 1;
    sum.placeholder = say.sum;
    sum.setAttribute('aria-label', say.sum);
    sum.value = s.synopsis || '';
    sum.enterKeyHint = 'done';
    const grow = () => { sum.style.height = 'auto'; sum.style.height = `${sum.scrollHeight}px`; };
    requestAnimationFrame(grow);
    sum.addEventListener('input', grow);
    const keepSum = () => {
      const v = sum.value.replace(/\s*\n\s*/g, ' ').trim();
      const now = this.find(ref);
      if (!now || (v === (now.synopsis || '') && !now.oldSynopsis)) return;
      if (!v && !now.synopsis) return;
      const sc = this.anchor(ref);
      if (sc) this.putSummary(sc, v);
    };
    sum.addEventListener('change', keepSum);
    sum.classList.add('wv-topf');
    sum.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && this.atEnd(sum)) {
        e.preventDefault();
        keepSum();
        const sc = this.anchor(ref);
        if (sc?.eid) this.startUnder(ref, sc.eid);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); keepSum(); this.backToText(ref); }
      if (e.key === 'Escape') { e.preventDefault(); keepSum(); this.backToText(ref); }
    });
    const top = make('div', 'wv-item wv-sumi');
    if (s.eid) top.dataset.owner = s.eid;
    const { sub, fold } = this.under(s.eid, ref, sum, true);
    const line = make('div', 'wv-topl');
    line.append(sum, fold);
    top.append(line, sub);
    box.append(title, top);
    for (const n of this.threadNotes(s.eid)) box.append(this.beatRow(n, ref));
    box.append(this.addThreadRow(ref));
    return box;
  }

  beatRow(n, ref) {
    const t = this.notes.threads.find((x) => x.id === n.fields.thread);
    const row = make('div', `wv-beat hue-${this.hue(n.fields.thread)}`);
    row.dataset.note = n.id;
    const mark = make('button', 'wv-mk', MARK[n.fields.beat || '']);
    mark.type = 'button';
    const tip = () => { mark.title = ABOUT[n.fields.beat || '']; mark.setAttribute('aria-label', mark.title); };
    tip();
    mark.addEventListener('click', () => {
      const next = ORDER[(ORDER.indexOf(n.fields.beat || '') + 1) % ORDER.length];
      const { beat: _b, ...rest } = n.fields;
      n.fields = next ? { ...rest, beat: next } : rest;
      mark.textContent = MARK[next];
      tip();
      this.notes.save(n);
    });
    const name = make('span', 'wv-tn', t?.title || 'A thread');
    const text = make('input', 'wv-bt');
    text.value = n.text || '';
    text.placeholder = 'what happens for this thread';
    text.setAttribute('aria-label', `${t?.title || 'Thread'}: what happens`);
    text.enterKeyHint = 'done';
    text.addEventListener('input', () => { n.text = text.value; this.notes.save(n); });
    text.addEventListener('change', () => this.notes.render());
    text.classList.add('wv-topf');
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.atEnd(text)) { e.preventDefault(); this.notes.render(); this.startUnder(ref, n.id); return; }
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); this.backToText(ref); }
    });
    const x = make('button', 'wv-x', '×');
    x.type = 'button';
    x.title = 'Take this line away';
    x.setAttribute('aria-label', `Take the ${t?.title || 'thread'} line away`);
    x.addEventListener('click', () => this.removeNote(n, ref.key, 'Thread line'));
    const { sub, fold } = this.under(n.id, ref, text);
    row.append(mark, name, text, fold, x);
    const item = make('div', 'wv-item');
    item.dataset.owner = n.id;
    item.append(row, sub);
    return item;
  }

  addThreadRow(ref) {
    const foot = make('div', 'wv-p-foot');
    if (this.adding !== ref.key) {
      const add = make('button', 'wv-addb', '+ thread');
      add.type = 'button';
      add.title = 'Add a line for one of the story’s threads';
      add.addEventListener('click', () => { this.adding = ref.key; this.focusNext = `.wv-plan[data-key="${CSS.escape(ref.key)}"] .wv-tchip`; this.bump(ref.key); this.redraw(); });
      foot.append(add);
      return foot;
    }
    const chips = make('div', 'wv-chips-row');
    const there = new Set(this.threadNotes(ref.eid).map((n) => n.fields.thread));
    for (const t of this.notes.threads) {
      const b = make('button', `wv-tchip hue-${this.hue(t.id)}${there.has(t.id) ? ' there' : ''}`, t.title || 'Untitled');
      b.type = 'button';
      b.addEventListener('click', () => this.addBeat(ref, t.id));
      chips.append(b);
    }
    const nb = make('button', 'wv-tchip new', '+ New thread');
    nb.type = 'button';
    nb.addEventListener('click', () => {
      const input = make('input', 'wv-newth');
      input.placeholder = 'Name the new thread';
      input.setAttribute('aria-label', 'Name the new thread');
      input.enterKeyHint = 'done';
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') { e.preventDefault(); this.adding = null; this.bump(ref.key); this.redraw(); return; }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        const world = await this.hooks.world();
        if (!world) { this.hooks.toast('This script isn’t in a world yet, so it has no threads to follow.'); return; }
        const t = await newThread(world, name);
        this.notes.threads = [...this.notes.threads, t];
        await this.addBeat(ref, t.id);
      });
      nb.replaceWith(input);
      input.focus();
    });
    const done = make('button', 'wv-addb', 'Done');
    done.type = 'button';
    done.addEventListener('click', () => { this.adding = null; this.bump(ref.key); this.redraw(); });
    chips.append(nb, done);
    foot.append(chips);
    return foot;
  }

  async addBeat(ref, threadId) {
    const s = this.anchor(ref);
    if (!s?.eid) return;
    const n = entry('note', { parent_id: s.eid, type: this.threadNoteType(), sort: Date.now(), fields: { chapter_id: this.notes.chapterId, thread: threadId } });
    this.notes.notes.push(n);
    await putEntries([n]);
    this.adding = null;
    this.bump(ref.key);
    this.focusNext = `.wv-beat[data-note="${CSS.escape(n.id)}"] .wv-bt`;
    this.redraw();
    this.notes.render();
  }

  async removeNote(n, key, what) {
    await this.lines.drop(n.id);
    const under = await trashLinesUnder(n.id);
    await this.notes.remove(n);
    this.bump(key);
    this.redraw();
    this.hooks.toast(`${what} moved to the Trash`, { label: 'Undo', run: async () => {
      n.deleted = false;
      n.updated_at = Date.now();
      this.notes.notes.push(n);
      await putEntries([n]);
      await restoreLines(under);
      this.bump(key);
      this.redraw();
      this.notes.render();
    } });
  }

  backToText(ref) {
    const s = this.find(ref);
    if (this.hooks.touch()) { document.activeElement?.blur(); return; }
    if (!s) { this.editor.commands.focus(); return; }
    // The caret goes to the start of the scene's words.
    const doc = this.editor.state.doc;
    let pos = s.node ? s.pos + s.node.nodeSize : s.at;
    pos = Math.min(pos + 1, doc.content.size);
    this.editor.commands.focus(pos, { scrollIntoView: false });
  }

  // ---------- the notes (right end of the line) ----------

  notesBlock(s) {
    const k = this.keyOf(s);
    const ref = { eid: s.eid, at: s.at, key: k };
    const box = make('div', 'wv-notes');
    box.dataset.key = k;
    const head = make('div', 'wv-n-head');
    const slugText = s.node?.textContent?.trim();
    const slug = make('button', `wv-slug${slugText ? '' : ' unset'}`, slugText || 'Place and time not set yet');
    slug.type = 'button';
    slug.title = 'Place, time, inside or out: the scene card';
    slug.addEventListener('click', () => this.hooks.scenePop.open({ eid: s.eid, at: s.at }, slug));
    head.append(slug);
    if (s.eid) {
      const shots = make('button', 'wv-shots');
      shots.type = 'button';
      shots.hidden = true;
      shots.title = 'This scene’s shots, in Make';
      shots.addEventListener('click', () => this.hooks.openShots(s.eid));
      shotsUnder(s.eid).then((list) => { if (list.length) { shots.textContent = `${list.length} ${list.length === 1 ? 'shot' : 'shots'}`; shots.hidden = false; } }).catch(() => {});
      head.append(shots);
    }
    box.append(head);
    for (const n of this.sceneNotes(s)) box.append(this.noteRow(n, ref, n.parent_id !== s.eid));
    const foot = make('div', 'wv-p-foot');
    const add = make('button', 'wv-addb', '+ note');
    add.type = 'button';
    add.title = 'A note on this scene: directing, what to fix, anything';
    add.addEventListener('click', () => this.addNote(ref));
    foot.append(add);
    box.append(foot);
    return box;
  }

  noteRow(n, ref, onPara = false) {
    const type = this.notes.types.find((t) => t.id === n.type);
    const row = make('div', `wv-note${onPara ? ' on-para' : ''}`);
    row.dataset.note = n.id;
    row.style.setProperty('--h', type?.color || 'var(--muted)');
    // A note on one of the scene's paragraphs: a tap here goes to it.
    const go = () => {
      const b = make('button', 'wv-go', '↗');
      b.type = 'button';
      b.title = 'Go to its paragraph';
      b.setAttribute('aria-label', 'Go to its paragraph');
      b.addEventListener('click', () => this.toParagraph(n.parent_id));
      return b;
    };
    const c = n.fields?.comment;
    if (c) {
      row.classList.add('comment');
      row.append(make('span', 'wv-mk', '–'), make('span', 'wv-tn', c.owner ? 'You' : c.name || 'A reader'), make('span', 'wv-bt', n.text || ''));
      if (onPara) row.append(go());
      return row;
    }
    const pick = make('select', 'wv-ntype');
    pick.setAttribute('aria-label', 'Note category');
    for (const t of this.notes.types.filter((x) => !NOT_MINE.includes(x.id) || x.id === n.type)) pick.add(new Option(t.name, t.id, false, t.id === n.type));
    pick.addEventListener('change', () => {
      n.type = pick.value;
      localStorage.setItem('wvNoteType', pick.value);
      row.style.setProperty('--h', this.notes.types.find((t) => t.id === n.type)?.color || 'var(--muted)');
      this.notes.save(n);
      this.notes.render();
    });
    const text = make('textarea', 'wv-bt');
    text.rows = 1;
    text.value = n.text || '';
    text.placeholder = 'a note';
    text.setAttribute('aria-label', `${type?.name || 'Note'}`);
    const grow = () => { text.style.height = 'auto'; text.style.height = `${text.scrollHeight}px`; };
    requestAnimationFrame(grow);
    text.addEventListener('input', () => { n.text = text.value; grow(); this.notes.save(n); });
    text.addEventListener('change', () => this.notes.render());
    text.classList.add('wv-topf');
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && this.atEnd(text)) { e.preventDefault(); this.notes.render(); this.startUnder(ref, n.id); return; }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); this.notes.render(); this.backToText(ref); }
    });
    const x = make('button', 'wv-x', '×');
    x.type = 'button';
    x.title = 'Take this note away';
    x.setAttribute('aria-label', 'Take this note away');
    x.addEventListener('click', () => this.removeNote(n, ref.key, 'Note'));
    const { sub, fold } = this.under(n.id, ref, text);
    row.append(make('span', 'wv-mk', '–'), pick, text, fold, ...(onPara ? [go()] : []), x);
    const item = make('div', 'wv-item');
    item.dataset.owner = n.id;
    item.append(row, sub);
    return item;
  }

  async addNote(ref) {
    const s = this.anchor(ref);
    if (!s?.eid) return;
    const n = entry('note', { parent_id: s.eid, type: this.myNoteType(), fields: { chapter_id: this.notes.chapterId } });
    this.notes.notes.push(n);
    await putEntries([n]);
    this.bump(ref.key);
    this.focusNext = `.wv-note[data-note="${CSS.escape(n.id)}"] .wv-bt`;
    this.redraw();
    this.notes.render();
  }
}
