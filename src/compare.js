import { getEntry } from './db.js';
import { draftsOf, sideDoc, sourceLabel, pairChapters, alignBlocks, changeCount, sideText } from './drafts.js';

// Comparing versions of a piece: two drafts, or the text then and now, side
// by side with the scenes lined up and the changes softly marked; Claude can
// say which works better (only when asked). And the same reading, one side
// only, beside the text you're writing: the old draft open while you write
// the new one.

const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const DAY = 864e5;

// What can be picked as a side, as <select> options.
export async function sourceOptions(pieceId, { now = true } = {}) {
  const drafts = await draftsOf(pieceId);
  const opts = [];
  if (now) opts.push(['now', 'Now']);
  for (const d of [...drafts].reverse()) opts.push([`draft:${d.id}`, `${d.title || `Draft ${d.fields?.n}`} · kept ${new Date(d.fields?.at || d.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`]);
  opts.push(['at:1', 'Yesterday'], ['at:7', 'A week ago'], ['at:30', 'A month ago'], ['pick', 'On a date…']);
  if (now) opts.push(['said', 'Now, with talked-in paragraphs as you said them']);
  return { opts, drafts };
}

export function parseSource(v, at) {
  if (!v || v === 'now') return { type: 'now' };
  if (v === 'said') return { type: 'said' };
  if (v.startsWith('draft:')) return { type: 'draft', id: v.slice(6) };
  if (v.startsWith('at:')) {
    // A preset: that many days back, at the end of that day.
    const d = new Date(Date.now() - Number(v.slice(3)) * DAY);
    d.setHours(23, 59, 59, 999);
    return { type: 'at', at: at || d.getTime() };
  }
  return { type: 'now' };
}

export const sourceValue = (src) => (!src || src.type === 'now' ? 'now' : src.type === 'said' ? 'said' : src.type === 'draft' ? `draft:${src.id}` : 'date');

// One block, as it reads (scene headings, script elements), with word marks.
function cell(b, words, side, markClaude) {
  const div = make('div', `cmp-b cmp-${b.kind}${b.el ? ` el-${b.el}` : ''}${markClaude && b.by === 'claude' ? ' by-claude' : ''}`);
  if (markClaude && b.by === 'claude') div.title = 'Claude’s words';
  if (b.kind === 'scene') { div.textContent = b.text ? `§ ${b.text}` : '* * *'; return div; }
  if (words) {
    for (const w of words) {
      if (w.op === '=') div.append(document.createTextNode(w.t));
      else if ((w.op === '-' && side === 'a') || (w.op === '+' && side === 'b')) div.append(make(w.op === '-' ? 'del' : 'ins', '', w.t));
      else if (side === 'i') div.append(make(w.op === '-' ? 'del' : 'ins', '', w.t));
    }
  } else div.textContent = b.text || ' ';
  return div;
}

export class CompareView {
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.pieceId = null;
    this.a = null;
    this.b = null;
    this.onlyChanges = true;
    this.markClaude = true;
    this.pairs = [];
  }

  async show(pieceId, place = {}) {
    this.pieceId = pieceId;
    const { drafts } = await sourceOptions(pieceId);
    // Unless asked for: the newest kept draft against now, or else a week ago.
    this.a = place.a || (drafts.length ? { type: 'draft', id: drafts.at(-1).id } : parseSource('at:7'));
    this.b = place.b || { type: 'now' };
    this.focus = place.focus || null;
    this.claude = null;
    await this.render();
  }

  get place() { return { view: 'compare', id: this.pieceId, a: this.a, b: this.b }; }

  async render() {
    const piece = await getEntry(this.pieceId);
    if (!piece) return;
    const { opts, drafts } = await sourceOptions(this.pieceId);
    this.drafts = drafts;
    const el = this.el;
    el.replaceChildren();
    const head = make('div', 'cmp-head');
    const back = make('button', 'ghost-btn', '← Back to writing');
    back.type = 'button';
    back.addEventListener('click', () => this.hooks.back(piece));
    const title = make('h1', 'cmp-title', piece.title || 'Untitled');
    const picker = (src, set) => {
      const sel = make('select', 'cmp-pick');
      sel.setAttribute('aria-label', 'Version');
      for (const [v, label] of opts) sel.add(new Option(label, v));
      if (src.type === 'at') sel.add(new Option(sourceLabel(src), 'date'));
      sel.value = sourceValue(src);
      sel.addEventListener('change', async () => {
        if (sel.value === 'pick') {
          const got = await this.hooks.pickDate();
          if (!got) { sel.value = sourceValue(src); return; }
          set({ type: 'at', at: got });
        } else set(parseSource(sel.value));
        this.claude = null;
        this.hooks.remember(this.place);
        await this.render();
      });
      return sel;
    };
    const sides = make('div', 'cmp-sides');
    sides.append(picker(this.a, (s) => { this.a = s; }), make('span', 'cmp-vs', 'and'), picker(this.b, (s) => { this.b = s; }));
    const tools = make('div', 'cmp-tools');
    const toggle = (label, on, set) => {
      const l = make('label', 'switch');
      const c = make('input');
      c.type = 'checkbox';
      c.checked = on;
      c.addEventListener('change', () => { set(c.checked); this.draw(); });
      l.append(c, document.createTextNode(` ${label}`));
      return l;
    };
    tools.append(toggle('Only what changed', this.onlyChanges, (v) => { this.onlyChanges = v; }), toggle('Mark Claude’s words', this.markClaude, (v) => { this.markClaude = v; }));
    const ask = make('button', 'ghost-btn', 'Ask Claude which works better');
    ask.type = 'button';
    ask.addEventListener('click', () => this.askClaude(ask));
    tools.append(ask);
    head.append(back, title, sides, tools);
    this.body = make('div', 'cmp-body');
    this.panel = make('aside', 'cmp-claude');
    this.panel.hidden = !this.claude;
    el.append(head, this.panel, this.body);
    this.body.append(make('p', 'hint', 'Lining them up…'));
    const [A, B] = await Promise.all([sideDoc(this.pieceId, this.a), sideDoc(this.pieceId, this.b)]);
    this.A = A;
    this.B = B;
    this.pairs = pairChapters(A, B).map((p) => ({ ...p, rows: alignBlocks(p.a?.blocks || [], p.b?.blocks || []) }));
    this.draw();
    if (this.claude) this.drawClaude();
  }

  draw() {
    const body = this.body;
    body.replaceChildren();
    const la = sourceLabel(this.a, this.drafts);
    const lb = sourceLabel(this.b, this.drafts);
    const labels = make('div', 'cmp-row cmp-labels');
    labels.append(make('div', 'cmp-a', la), make('div', 'cmp-b-col', lb));
    body.append(labels);
    let changed = 0;
    for (const p of this.pairs) {
      const { added, cut } = changeCount(p.rows);
      const ch = make('div', 'cmp-chapter');
      if (p.a?.id || p.b?.id) ch.dataset.chapter = p.b?.id || p.a?.id;
      const t = make('div', 'cmp-row cmp-ch-head');
      t.append(make('div', 'cmp-a', p.a ? p.a.title : '(not in this version)'), make('div', 'cmp-b-col', p.b ? p.b.title : '(not in this version)'));
      const count = make('div', 'cmp-count', added || cut ? `${added ? `+${added.toLocaleString()}` : ''}${added && cut ? ' · ' : ''}${cut ? `−${cut.toLocaleString()}` : ''} words` : 'No changes');
      ch.append(t, count);
      if (added || cut) changed++;
      const rows = p.rows;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (this.onlyChanges && r.op === 'same') {
          let j = i;
          while (j < rows.length && rows[j].op === 'same') j++;
          const n = j - i;
          // Keep a paragraph of context either side; fold the rest.
          const keepStart = i === 0 ? 0 : 1;
          const keepEnd = j === rows.length ? 0 : 1;
          if (n > keepStart + keepEnd + 1) {
            for (let k = i; k < i + keepStart; k++) ch.append(this.row(rows[k]));
            const fold = make('button', 'cmp-fold', `${n - keepStart - keepEnd} paragraphs the same`);
            fold.type = 'button';
            const hiddenRows = rows.slice(i + keepStart, j - keepEnd);
            fold.addEventListener('click', () => fold.replaceWith(...hiddenRows.map((x) => this.row(x))));
            ch.append(fold);
            for (let k = j - keepEnd; k < j; k++) ch.append(this.row(rows[k]));
            i = j - 1;
            continue;
          }
        }
        ch.append(this.row(r));
      }
      body.append(ch);
    }
    if (!this.pairs.length) body.append(make('p', 'hint', 'Neither version has any writing yet.'));
    else if (!changed) body.append(make('p', 'hint cmp-same', 'These two are the same.'));
    if (this.focus) { body.querySelector(`[data-chapter="${CSS.escape(this.focus)}"]`)?.scrollIntoView({ block: 'start' }); this.focus = null; }
  }

  row(r) {
    const row = make('div', `cmp-row op-${r.op}`);
    const a = make('div', 'cmp-a');
    const b = make('div', 'cmp-b-col');
    if (r.a) a.append(cell(r.a, r.op === 'chg' ? r.words : null, 'a', this.markClaude));
    if (r.b) b.append(cell(r.b, r.op === 'chg' ? r.words : null, 'b', this.markClaude));
    // On a phone, one column: both versions' words in one place.
    const inline = make('div', 'cmp-i');
    inline.append(cell(r.b || r.a, r.op === 'chg' ? r.words : null, 'i', this.markClaude));
    row.append(a, b, inline);
    return row;
  }

  async askClaude(btn) {
    if (!this.hooks.canAsk()) { this.hooks.toast('Sign in and go online to ask Claude'); return; }
    btn.disabled = true;
    btn.textContent = 'Claude is reading both…';
    try {
      const piece = await getEntry(this.pieceId);
      this.claude = await this.hooks.ask({
        mode: 'revise', task: 'compare', piece: piece.title || '', type: piece.fields?.type || '',
        a: { label: sourceLabel(this.a, this.drafts), chapters: sideText(this.A) },
        b: { label: sourceLabel(this.b, this.drafts), chapters: sideText(this.B) }
      });
      this.drawClaude();
    } catch (e) {
      this.hooks.toast(e.message || 'Couldn’t ask Claude. Try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ask Claude which works better';
    }
  }

  drawClaude() {
    const p = this.panel;
    p.replaceChildren();
    p.hidden = false;
    const head = make('div', 'cmp-claude-head');
    const close = make('button', 'ghost-btn', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => { p.hidden = true; this.claude = null; });
    head.append(make('span', 'panel-label', 'Claude on these two'), close);
    p.append(head);
    const la = sourceLabel(this.a, this.drafts);
    const lb = sourceLabel(this.b, this.drafts);
    for (const pt of this.claude.points || []) {
      const d = make('div', 'cmp-point');
      const which = pt.better === 'a' ? `${la} is stronger` : pt.better === 'b' ? `${lb} is stronger` : 'Each has something';
      d.append(make('div', 'cmp-where', `${pt.where} · ${which}`), make('div', '', pt.why));
      p.append(d);
    }
    if (this.claude.overall) p.append(make('p', 'cmp-overall', this.claude.overall));
  }
}

// The beside pane: an earlier draft (or the text as it was) to read while you write.
export class BesidePane {
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.pieceId = null;
    this.src = null;
    this.chapterId = null;
  }

  get isOpen() { return !this.el.hidden; }

  async open(pieceId, chapterId, src) {
    this.pieceId = pieceId;
    const { drafts } = await sourceOptions(pieceId, { now: false });
    this.src = src || this.src?.pieceId === pieceId && this.src || (drafts.length ? { type: 'draft', id: drafts.at(-1).id } : parseSource('at:7'));
    this.src.pieceId = pieceId;
    this.chapterId = chapterId;
    this.el.hidden = false;
    document.body.classList.add('beside-on');
    await this.render();
  }

  close() {
    this.el.hidden = true;
    document.body.classList.remove('beside-on');
  }

  // The writing moved to another chapter: follow it, if the other side has it.
  async follow(chapterId) {
    if (!this.isOpen || chapterId === this.chapterId) return;
    this.chapterId = chapterId;
    await this.render();
  }

  async render() {
    const { opts, drafts } = await sourceOptions(this.pieceId, { now: false });
    const el = this.el;
    el.replaceChildren();
    const head = make('div', 'bs-head');
    const sel = make('select', 'cmp-pick');
    sel.setAttribute('aria-label', 'Which version to read');
    for (const [v, label] of opts) sel.add(new Option(label, v));
    if (this.src.type === 'at') sel.add(new Option(sourceLabel(this.src), 'date'));
    sel.value = sourceValue(this.src);
    sel.addEventListener('change', async () => {
      if (sel.value === 'pick') {
        const got = await this.hooks.pickDate();
        if (!got) { sel.value = sourceValue(this.src); return; }
        this.src = { type: 'at', at: got, pieceId: this.pieceId };
      } else this.src = { ...parseSource(sel.value), pieceId: this.pieceId };
      await this.render();
    });
    const close = make('button', 'ghost-btn', 'Close');
    close.type = 'button';
    close.title = 'Close (Ctrl + Shift + B)';
    close.addEventListener('click', () => { this.close(); this.hooks.focus(); });
    head.append(sel, close);
    const chapters = await sideDoc(this.pieceId, this.src);
    const now = await sideDoc(this.pieceId, { type: 'now' });
    // The matching chapter on the other side: the same one, the same title, or the same place.
    const pairs = pairChapters(now, chapters);
    const mine = pairs.find((p) => p.a?.id === this.chapterId)?.b;
    let shown = mine || chapters[0] || null;
    const chSel = make('select', 'cmp-pick bs-chapter');
    chSel.setAttribute('aria-label', 'Chapter');
    chapters.forEach((c, i) => chSel.add(new Option(c.title, String(i))));
    if (shown) chSel.value = String(chapters.indexOf(shown));
    chSel.hidden = chapters.length < 2;
    const text = make('div', 'bs-text');
    const fill = () => {
      text.replaceChildren();
      if (!shown) { text.append(make('p', 'hint', drafts.length || this.src.type === 'at' ? 'Nothing written in this version.' : 'No earlier draft yet. Start one from the piece’s menu, or pick a date.')); return; }
      for (const b of shown.blocks) text.append(cell(b, null, 'a', false));
    };
    chSel.addEventListener('change', () => { shown = chapters[Number(chSel.value)]; fill(); });
    fill();
    el.append(head, chSel, text);
  }
}
