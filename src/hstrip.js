import { DOMSerializer, Node as PMNode } from '@tiptap/pm/model';
import { versionsOf, blocks as docBlocks, words as wordDiff, changedWords, nameVersion, keep, withBlockBack } from './history.js';
import { alignBlocks } from './drafts.js';
import { wordCount } from './model.js';
import { popMenu } from './menu.js';

// The history strip: hidden until asked for (the page's ⋯ menu, or
// Ctrl + Shift + H). A line of marks, one for every kept version of the page
// or chapter, sits under the page's top line. Drag along it (or press Left
// and Right) and the page shows itself as it was then, read-only. Pick two
// marks to see them side by side. Bring back one paragraph or line, or the
// whole page, each with Undo. Looking writes nothing.

const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (tag === 'button') e.type = 'button'; return e; };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const startOf = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const time = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
function dayName(ms, now = Date.now()) {
  const days = Math.round((startOf(now) - startOf(ms)) / 864e5);
  const d = new Date(ms);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return DAYS[d.getDay()];
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}
function ago(ms, now = Date.now()) {
  const m = Math.round((now - ms) / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'a day ago' : `${d} days ago`;
}
const kindOf = (b) => (b.scene ? 'scene' : b.line ? 'line' : b.node?.type === 'heading' ? 'heading' : 'para');

export class HistoryStrip {
  constructor(hooks) {
    this.hooks = hooks;
    this.t = null;
    this.marks = [];
    this.cache = new Map();
    this.onKey = this.onKey.bind(this);
  }

  get isOpen() { return !!this.t; }

  async toggle() { if (this.isOpen) this.close(); else await this.open(); }

  async open() {
    if (this.isOpen) return;
    const t = this.hooks.target();
    if (!t) { this.hooks.toast('Open a chapter or a page to see its history'); return; }
    await t.save();
    this.t = t;
    this.scrollY = window.scrollY;
    this.a = 0;
    this.b = null;
    this.picking = false;
    this.marksOn = false;
    this.picked = null;
    this.wasEditable = t.ed.isEditable;
    t.ed.setEditable(false, false);
    this.mount = t.ed.options.element;
    this.build();
    await this.load();
    this.a = this.marks.length - 1;
    document.documentElement.classList.add('hs-open');
    this.draw();
    document.addEventListener('keydown', this.onKey, true);
    this.track.focus({ preventScroll: true });
  }

  close({ stay = false } = {}) {
    if (!this.t) return;
    document.removeEventListener('keydown', this.onKey, true);
    document.documentElement.classList.remove('hs-open');
    this.wrap?.remove();
    this.past?.remove();
    this.cmp?.remove();
    this.mount?.classList.remove('hs-hide');
    this.t.ed.setEditable(this.wasEditable !== false, false);
    this.cache.clear();
    const y = this.scrollY;
    const ed = this.t.ed;
    this.t = null;
    clearTimeout(this.warmTimer);
    clearTimeout(this.sizeTimer);
    if (!stay) { window.scrollTo(0, y); ed.commands.focus(null, { scrollIntoView: false }); }
  }

  // ---------- marks ----------

  async load() {
    const t = this.t;
    const nowDoc = t.ed.getJSON();
    const kept = (await versionsOf(t.root.id)).reverse();
    const nowKey = JSON.stringify(nowDoc);
    const last = kept.at(-1);
    if (last && JSON.stringify(last.doc) === nowKey) { last.now = true; last.doc = nowDoc; } else kept.push({ at: Date.now(), doc: nowDoc, words: wordCount(t.ed.getText()), label: '', now: true });
    this.marks = kept;
    this.nowDoc = nowDoc;
    this.nowBlocks = new Map(docBlocks(nowDoc).filter((b) => b.eid).map((b) => [b.eid, b]));
    this.cache.clear();
    this.sizeMarks();
  }

  // How tall each mark is: how many words changed since the one before. Worked
  // out a few at a time, so the strip is there at once.
  sizeMarks() {
    clearTimeout(this.sizeTimer);
    const marks = this.marks;
    let i = 0;
    const step = () => {
      if (marks !== this.marks) return;
      const until = Math.min(marks.length, i + 12);
      for (; i < until; i++) marks[i].changed = i ? changedWords(marks[i - 1].doc, marks[i].doc) : marks[i].words || 0;
      this.drawTicks();
      if (i < marks.length) this.sizeTimer = setTimeout(step, 0);
    };
    step();
  }

  label(i) {
    const m = this.marks[i];
    if (m.now) return 'Now';
    return `${dayName(m.at)}, ${time(m.at)}`;
  }

  // ---------- drawing ----------

  build() {
    const wrap = make('section', 'hstrip');
    wrap.setAttribute('aria-label', 'History');
    const track = make('div', 'hs-track');
    track.tabIndex = 0;
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', 'Versions, oldest on the left');
    const ticks = make('div', 'hs-ticks');
    const days = make('div', 'hs-days');
    track.append(ticks);
    const when = make('div', 'hs-when');
    wrap.append(track, days, when);
    this.wrap = wrap;
    this.track = track;
    this.ticksEl = ticks;
    this.daysEl = days;
    this.whenEl = when;
    this.past = make('div', 'ProseMirror hs-past');
    this.past.setAttribute('aria-label', 'The page as it was');
    this.cmp = make('div', 'hs-cmp');
    // Under the page's top line: after a page's title, at the top of a chapter.
    const head = this.mount.closest('.nb-sheet')?.querySelector('.nb-head');
    if (head) head.after(wrap); else this.mount.before(wrap);
    this.mount.append(this.past);
    this.mount.after(this.cmp);
    track.addEventListener('pointerdown', (e) => this.pointer(e));
    new ResizeObserver(() => this.isOpen && this.drawDays()).observe(track);
  }

  x(i) { const n = this.marks.length; return n === 1 ? 50 : 1 + (i * 98) / (n - 1); }

  drawTicks() {
    if (!this.ticksEl) return;
    const n = this.marks.length;
    const max = Math.max(1, ...this.marks.slice(1).map((m) => m.changed || 0));
    const frag = document.createDocumentFragment();
    this.tickEls = this.marks.map((m, i) => {
      const t = make('span', `hs-tick${m.label ? ' named' : ''}${m.now ? ' now' : ''}`);
      t.style.left = `${this.x(i)}%`;
      t.title = `${this.label(i)}${m.label ? ` · ${m.label}` : ''}`;
      const bar = make('i');
      bar.style.height = `${i && m.changed != null ? 6 + Math.round(26 * Math.min(1, m.changed / max)) : 18}px`;
      t.append(bar);
      frag.append(t);
      return t;
    });
    this.ticksEl.replaceChildren(frag);
    this.ticksEl.style.setProperty('--w', `${Math.max(2, Math.min(5, (this.track.offsetWidth || 600) / Math.max(1, n) - 1))}px`);
    this.markPicked();
  }

  markPicked() {
    (this.tickEls || []).forEach((t, i) => { t.classList.toggle('a', i === this.a); t.classList.toggle('b', i === this.b); });
    const tr = this.track;
    tr.setAttribute('aria-valuemin', '0');
    tr.setAttribute('aria-valuemax', String(this.marks.length - 1));
    tr.setAttribute('aria-valuenow', String(this.a));
    tr.setAttribute('aria-valuetext', this.label(this.a));
  }

  // Day names under the strip, leaving out any that would bump into another.
  drawDays() {
    const w = this.track.offsetWidth || 600;
    const gap = w < 500 ? 70 : 56;
    const frag = document.createDocumentFragment();
    let lastX = -1e9;
    let lastDay = '';
    const n = this.marks.length;
    this.marks.forEach((m, i) => {
      if (m.now) return;
      const d = dayName(m.at);
      if (d === lastDay) return;
      lastDay = d;
      const px = (this.x(i) / 100) * w;
      if (px - lastX < gap || w - px < (n > 1 ? 46 : 0) + 30) return;
      lastX = px;
      const s = make('span', '', d);
      s.style.left = `${px}px`;
      frag.append(s);
    });
    const nowLabel = make('span', 'now', 'Now');
    frag.append(nowLabel);
    this.daysEl.replaceChildren(frag);
  }

  draw() {
    this.drawTicks();
    this.drawDays();
    this.drawWhen();
    this.drawPage();
  }

  drawWhen() {
    const w = this.whenEl;
    w.replaceChildren();
    const m = this.marks[this.a];
    const btn = (label, cls, run, pressed) => {
      const b = make('button', `hs-btn${cls ? ` ${cls}` : ''}`, label);
      if (pressed != null) b.setAttribute('aria-pressed', String(pressed));
      b.addEventListener('click', run);
      return b;
    };
    const more = make('button', 'hs-btn hs-more', '⋯');
    more.setAttribute('aria-label', 'More history');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', (e) => { e.stopPropagation(); popMenu(more, this.moreItems()); });
    const done = btn('Done', 'hs-done', () => this.close());
    done.title = 'Back to today’s page (Esc or Ctrl + Shift + H)';
    if (this.b != null) {
      const [lo, hi] = [Math.min(this.a, this.b), Math.max(this.a, this.b)];
      const t = make('span', 'hs-t', `${this.label(lo)} beside ${this.label(hi)}`);
      w.append(t, make('span', 'hs-sp'), btn('Stop comparing', '', () => { this.b = null; this.markPicked(); this.drawWhen(); this.drawPage(); }), more, done);
      return;
    }
    const day = m.now ? 'Now' : `${dayName(m.at)}${/^(Today|Yesterday|[A-Z][a-z]+day)$/.test(dayName(m.at)) ? `, ${new Date(m.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}, ${time(m.at)}`;
    const t = make('span', 'hs-t', day);
    const sub = make('span', 'hs-sub', `${m.now ? 'today’s page' : ago(m.at)} · ${(m.words || 0).toLocaleString()} words${m.label ? ` · “${m.label}”` : ''}`);
    const name = make('button', 'hs-name', m.label ? 'Rename' : 'Name this version');
    name.addEventListener('click', () => this.name(this.a));
    w.append(t, sub, name, make('span', 'hs-sp'));
    if (!m.now) w.append(btn('Show changes', '', () => { this.marksOn = !this.marksOn; this.drawWhen(); this.drawPage(); }, this.marksOn));
    const c = btn(this.picking ? 'Pick a second mark…' : 'Compare', '', () => { this.picking = !this.picking; this.drawWhen(); }, this.picking);
    c.title = 'Then pick a second mark (or Shift + click one)';
    w.append(c);
    if (!m.now) w.append(btn('Go back to this version', 'go', () => this.goBack(this.a)));
    w.append(more, done);
  }

  moreItems() {
    const kind = this.t.root.kind === 'chapter' ? 'paragraphs' : 'lines';
    return [
      { label: `Deleted ${kind}…`, run: () => { this.close({ stay: true }); this.hooks.openList('deleted'); } },
      { label: 'Every version as a list…', run: () => { this.close({ stay: true }); this.hooks.openList(); } },
      { label: 'Copy this version’s text', run: () => this.copy(docBlocks(this.marks[this.a].doc).map((b) => b.text).join('\n\n')) }
    ];
  }

  drawPage() {
    const m = this.marks[this.a];
    this.mount.classList.toggle('hs-hide', this.b != null || !m.now);
    this.cmp.hidden = this.b == null;
    this.past.hidden = this.b != null || m.now;
    if (this.b != null) { this.drawCompare(); return; }
    if (m.now) return;
    this.past.replaceChildren(this.rendered(this.a));
    this.warm();
  }

  // One version as the page shows it, kept for a moment so dragging back and forth is instant.
  rendered(i) {
    const key = `${i}:${this.marksOn ? 1 : 0}`;
    let node = this.cache.get(key);
    if (!node) {
      node = this.render(this.marks[i], this.marksOn);
      this.cache.set(key, node);
      if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
    }
    return node;
  }

  // The neighbours of the shown mark, made ready while nothing else is happening.
  warm() {
    clearTimeout(this.warmTimer);
    this.warmTimer = setTimeout(() => {
      if (!this.isOpen) return;
      for (const k of [this.a - 1, this.a + 1, this.a - 2, this.a + 2]) if (k >= 0 && k < this.marks.length && !this.marks[k].now) this.rendered(k);
    }, 30);
  }

  render(mark, marksOn) {
    const frag = document.createDocumentFragment();
    const blocks = docBlocks(mark.doc);
    try {
      const schema = this.t.ed.schema;
      frag.append(DOMSerializer.fromSchema(schema).serializeFragment(PMNode.fromJSON(schema, mark.doc).content));
    } catch {
      // Written before a kind of paragraph this version of Inkwell knows: plain text.
      for (const b of blocks) { const p = make('p', '', b.text); if (b.eid) p.dataset.eid = b.eid; if (b.line) p.style.paddingLeft = `${b.depth * 1.4}em`; frag.append(p); }
    }
    const holder = make('div');
    holder.append(frag);
    // Each block that differs from today's page gets its tools (and, asked for, its changes).
    for (const b of blocks) {
      if (!b.eid) continue;
      const el = holder.querySelector(`[data-eid="${CSS.escape(b.eid)}"]`);
      if (!el) continue;
      const box = el.tagName === 'LI' ? el.querySelector(':scope > p') || el : el;
      const now = this.nowBlocks.get(b.eid);
      if (now && now.text === b.text) continue;
      if (marksOn) {
        if (!now) box.classList.add('hs-gone');
        else {
          box.classList.add('hs-diff');
          box.replaceChildren(...wordDiff(b.text, now.text).filter((w) => w.op !== '+').map((w) => (w.op === '=' ? document.createTextNode(w.t) : make('del', '', w.t))));
        }
      }
      this.tools(box, mark, b);
    }
    holder.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
    const out = document.createDocumentFragment();
    if (marksOn) out.append(make('p', 'hs-note', 'Struck words are in this version but not in today’s page. An edge marks a paragraph today’s page no longer has.'));
    out.append(...holder.childNodes);
    // A fragment empties when shown, so keep a copy to show again.
    const keepEl = make('div', 'hs-v');
    keepEl.append(out);
    return keepEl;
  }

  tools(box, mark, b) {
    box.classList.add('hs-can');
    box.tabIndex = 0;
    const tools = make('span', 'hs-tools');
    tools.contentEditable = 'false';
    const back = make('button', '', 'Bring this back');
    back.addEventListener('click', (e) => { e.stopPropagation(); this.bringBack(mark, b); });
    const copy = make('button', '', 'Copy');
    copy.addEventListener('click', (e) => { e.stopPropagation(); this.copy(b.text); });
    tools.append(back, copy);
    box.append(tools);
    // On a phone there's no hover: a tap shows the tools.
    box.addEventListener('click', () => {
      const was = box.classList.contains('picked');
      box.closest('.hs-past, .hs-cmp')?.querySelectorAll('.picked').forEach((x) => x.classList.remove('picked'));
      box.classList.toggle('picked', !was);
    });
  }

  // Two marks side by side, lined up by paragraph or line. One column on a phone.
  drawCompare() {
    const [lo, hi] = [Math.min(this.a, this.b), Math.max(this.a, this.b)];
    const A = this.marks[lo];
    const B = this.marks[hi];
    const asBlocks = (doc) => docBlocks(doc).map((b) => ({ eid: b.eid, kind: kindOf(b), text: b.text, depth: b.depth, src: b }));
    const rows = alignBlocks(asBlocks(A.doc), asBlocks(B.doc));
    const phone = matchMedia('(max-width: 700px)').matches;
    const c = this.cmp;
    c.replaceChildren();
    c.classList.toggle('one', phone);
    const head = (i, which) => { const h = make('div', 'hs-ch'); h.append(make('span', `hs-dot ${which}`), document.createTextNode(`${this.label(i)} · ${(this.marks[i].words || 0).toLocaleString()} words${this.marks[i].label ? ` · “${this.marks[i].label}”` : ''}`)); return h; };
    const which = (i) => (i === this.a ? 'a' : 'b');
    if (phone) c.append(make('p', 'hs-note', `${this.label(hi)}, with what changed since ${this.label(lo)} marked in place.`));
    else c.append(head(lo, which(lo)), head(hi, which(hi)));
    const cell = (blk, words, side, mark) => {
      const p = make('p', `hs-cb${blk.kind === 'scene' ? ' scene' : ''}${blk.kind === 'heading' ? ' heading' : ''}`);
      if (blk.kind === 'line') p.style.paddingLeft = `${(blk.depth || 0) * 1.4 + 0.2}em`;
      if (blk.kind === 'scene') p.textContent = blk.text ? `§ ${blk.text}` : '* * *';
      else if (words) for (const w of words) {
        if (w.op === '=') p.append(document.createTextNode(w.t));
        else if (w.op === '-' && (side === 'a' || side === 'i')) p.append(make('del', '', w.t));
        else if (w.op === '+' && (side === 'b' || side === 'i')) p.append(make('ins', '', w.t));
      } else p.textContent = blk.text || ' ';
      const now = blk.eid && this.nowBlocks.get(blk.eid);
      if (mark && !mark.now && blk.eid && (!now || now.text !== blk.text)) this.tools(p, mark, blk.src);
      return p;
    };
    const none = (t) => make('div', 'hs-none', t);
    let same = [];
    const flush = (last) => {
      if (!same.length) return;
      const keepStart = rowsShown ? 1 : 0;
      const keepEnd = last ? 0 : 1;
      if (same.length > keepStart + keepEnd + 1) {
        same.slice(0, keepStart).forEach((r) => put(r));
        const hidden = same.slice(keepStart, same.length - keepEnd);
        const fold = make('button', 'hs-fold', `${hidden.length} ${this.t.root.kind === 'chapter' ? 'paragraphs' : 'lines'} the same`);
        fold.addEventListener('click', () => { const at = fold; hidden.forEach((r) => put(r, at)); fold.remove(); });
        c.append(fold);
        same.slice(same.length - keepEnd).forEach((r) => put(r));
      } else same.forEach((r) => put(r));
      same = [];
    };
    let rowsShown = 0;
    const put = (r, before) => {
      const els = [];
      if (phone) {
        if (r.op === 'del') { const p = cell(r.a, null, 'i', A); p.classList.add('hs-gone'); p.replaceChildren(make('del', '', r.a.text), ...p.querySelectorAll('.hs-tools')); els.push(p); } else els.push(cell(r.b, r.op === 'chg' ? r.words : null, 'i', B));
        if (r.op === 'chg') els[0].classList.add('hs-diff');
        if (r.op === 'ins') els[0].classList.add('hs-new');
      } else {
        els.push(r.a ? cell(r.a, r.op === 'chg' ? r.words : null, 'a', A) : none('Not written yet'));
        els.push(r.b ? cell(r.b, r.op === 'chg' ? r.words : null, 'b', B) : none('Cut'));
        if (r.op !== 'same') els.forEach((e) => e.classList.add('hs-diff'));
      }
      if (before) before.before(...els); else c.append(...els);
      rowsShown++;
    };
    for (const r of rows) {
      if (r.op === 'same') { same.push(r); continue; }
      flush(false);
      put(r);
    }
    flush(true);
    if (rows.every((r) => r.op === 'same')) c.append(make('p', 'hs-note', 'These two are the same.'));
  }

  // ---------- moving along the strip ----------

  nearest(clientX) {
    const r = this.track.getBoundingClientRect();
    const f = ((clientX - r.left) / r.width) * 100;
    const n = this.marks.length;
    return Math.max(0, Math.min(n - 1, Math.round(((f - 1) / 98) * (n - 1))));
  }

  show(i) {
    if (i === this.a && this.b == null) return;
    this.a = i;
    this.b = null;
    this.markPicked();
    this.drawWhen();
    this.drawPage();
  }

  pointer(e) {
    if (e.button > 0) return;
    const i = this.nearest(e.clientX);
    if (e.shiftKey || this.picking) {
      e.preventDefault();
      this.picking = false;
      this.b = i === this.a ? null : i;
      this.markPicked();
      this.drawWhen();
      this.drawPage();
      return;
    }
    e.preventDefault();
    this.track.focus({ preventScroll: true });
    this.track.setPointerCapture?.(e.pointerId);
    this.show(i);
    let frame = 0;
    let x = e.clientX;
    const move = (ev) => {
      x = ev.clientX;
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; this.show(this.nearest(x)); });
    };
    const up = () => { this.track.removeEventListener('pointermove', move); this.track.removeEventListener('pointerup', up); this.track.removeEventListener('pointercancel', up); };
    this.track.addEventListener('pointermove', move);
    this.track.addEventListener('pointerup', up);
    this.track.addEventListener('pointercancel', up);
  }

  onKey(e) {
    if (!this.isOpen) return;
    const tag = document.activeElement?.tagName || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.querySelector('.ask, .pop-menu')) return;
    const m = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.picking) { this.picking = false; this.drawWhen(); } else if (this.b != null) { this.b = null; this.markPicked(); this.drawWhen(); this.drawPage(); } else this.close();
    } else if (!m && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      this.show(Math.max(0, Math.min(this.marks.length - 1, this.a + step)));
    } else if (!m && !e.altKey && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      this.show(e.key === 'Home' ? 0 : this.marks.length - 1);
    }
  }

  // ---------- changes made from the strip (each with Undo, each a new mark) ----------

  async change(doc, message) {
    const t = this.t;
    const before = t.ed.getJSON();
    t.replace(doc);
    await t.save();
    await keep(t.root.id, t.ed.getJSON(), t.ed.getText());
    await this.reload();
    this.hooks.toast(message, { label: 'Undo', run: async () => {
      const tt = this.t || this.hooks.target();
      if (!tt) return;
      tt.replace(before);
      await tt.save();
      await keep(tt.root.id, tt.ed.getJSON(), tt.ed.getText());
      if (this.isOpen) await this.reload();
    } });
  }

  async reload() {
    await this.load();
    this.a = this.marks.length - 1;
    this.b = null;
    this.picking = false;
    this.draw();
  }

  async bringBack(mark, b) {
    const doc = withBlockBack(this.t.ed.getJSON(), mark.doc, b.eid);
    if (!doc) return;
    const what = this.t.root.kind === 'chapter' ? 'paragraph' : 'line';
    await this.change(doc, `That ${what} is back in today’s page.`);
  }

  async goBack(i) {
    const t = this.t;
    const m = this.marks[i];
    const label = this.label(i);
    await t.save();
    await keep(t.root.id, t.ed.getJSON(), t.ed.getText(), { force: true, label: 'Before going back' });
    await this.change(structuredClone(m.doc), `Today’s page is the version from ${label} now. Where you were is kept as “Before going back”.`);
  }

  async name(i) {
    const m = this.marks[i];
    const label = await this.hooks.askText({ title: m.label ? 'Rename this version' : 'Name this version', value: m.label || '', ok: 'Save', placeholder: 'Before the rewrite' });
    if (label == null || !this.isOpen) return;
    if (m.now) await keep(this.t.root.id, this.t.ed.getJSON(), this.t.ed.getText(), { force: true, label: label.trim() });
    else await nameVersion(m, label.trim());
    const at = m.now ? null : m.at;
    await this.load();
    this.a = at == null ? this.marks.length - 1 : Math.max(0, this.marks.findIndex((x) => x.at === at));
    this.draw();
  }

  copy(text) {
    try { navigator.clipboard.writeText(text).catch(() => {}); } catch { /* an older phone view */ }
    this.hooks.toast('Copied');
  }
}

