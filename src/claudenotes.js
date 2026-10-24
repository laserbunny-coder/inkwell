import { children, getEntry, putEntries } from './db.js';
import { entry, newId } from './model.js';
import { ensureNoteType, CLAUDE_TYPE } from './sharelink.js';

// Claude's notes on a draft, in the three forms Michael asked for, and only
// when he asks: margin notes in their own Claude category (one switch hides
// them all), a list of fixes to tick off (a page under the piece), and a
// conversation about the chapter.

const GAP = 1024;

// The chapter's paragraphs, as Claude reads them.
export async function parasOf(chapterId) {
  return (await children(chapterId)).filter((r) => (r.kind === 'para' || r.kind === 'heading') && (r.text || '').trim())
    .map((r) => ({ id: r.id, text: r.text, ...(r.fields?.el ? { el: r.fields.el } : {}) }));
}

const snippet = (t) => { const w = (t || '').split(/\s+/).filter(Boolean); return w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : ''); };

// Ask, then put what comes back in place: the notes beside their paragraphs,
// the fixes on the chapter's fix list. Returns what was added.
export async function claudeNotes(chapter, piece, { ask, idea = '', focus = '' }) {
  const paras = await parasOf(chapter.id);
  if (!paras.length) throw new Error('There’s nothing in this chapter for Claude to read yet.');
  const got = await ask({ mode: 'revise', task: 'notes', piece: piece?.title || '', type: piece?.fields?.type || '', chapter: chapter.title || '', idea, paras, ...(focus ? { focus } : {}) });
  await ensureNoteType(CLAUDE_TYPE);
  const now = Date.now();
  const byId = new Map(paras.map((p) => [p.id, p]));
  const notes = (got.notes || []).filter((n) => byId.has(n.para)).map((n) => ({
    ...entry('note', { parent_id: n.para, type: CLAUDE_TYPE.id, text: n.text, fields: { chapter_id: chapter.id, claude: now } }), _by: 'claude'
  }));
  const page = got.fixes?.length || got.overall ? await addFixes(chapter, piece, got, byId, now) : null;
  if (notes.length) await putEntries(notes);
  return { notes, page, overall: got.overall || '' };
}

// The fix list: one page per chapter under the piece, the newest round on top
// of what's there, each fix a line you can strike through (Ctrl + Enter),
// with a link to the paragraph it's about.
async function addFixes(chapter, piece, got, byId, now) {
  const id = `pg_fix-${chapter.id}`;
  const prev = await getEntry(id);
  const page = prev && !prev.deleted ? prev : entry('page', { id, parent_id: piece?.id || null, title: `Claude’s fixes · ${chapter.title || 'Untitled'}`, sort: now / 1e9, fields: { fixesFor: chapter.id } });
  const kids = prev ? await children(id) : [];
  const start = (kids.at(-1)?.sort || 0) + GAP;
  const when = new Date(now).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const head = { ...entry('line', { id: newId('li'), parent_id: id, sort: start }), text: `Round of notes, ${when}`, content: [{ type: 'text', text: `Round of notes, ${when}` }], fields: { done: false, gather: null, gathered: null, mirror: null }, _by: 'claude' };
  const rows = [{ ...page, updated_at: now, deleted: false }, head];
  if (got.overall) rows.push({ ...entry('line', { id: newId('li'), parent_id: head.id, sort: GAP }), text: got.overall, content: [{ type: 'text', text: got.overall }], fields: { done: false, gather: null, gathered: null, mirror: null }, _by: 'claude' });
  (got.fixes || []).forEach((f, i) => {
    const para = f.para && byId.get(f.para);
    const content = [{ type: 'text', text: f.text }, ...(para ? [{ type: 'text', text: ' ' }, { type: 'entryRef', attrs: { id: para.id, title: snippet(para.text) } }] : [])];
    rows.push({ ...entry('line', { id: newId('li'), parent_id: head.id, sort: (i + 2) * GAP }), text: f.text + (para ? ` ${snippet(para.text)}` : ''), content, links: para ? [para.id] : [], fields: { done: false, gather: null, gathered: null, mirror: null }, _by: 'claude' });
  });
  await putEntries(rows);
  return page;
}

// ---------- talking it over ----------

const talkId = (chapterId) => `tk-${chapterId}`;

export async function talkOf(chapterId) {
  const t = await getEntry(talkId(chapterId));
  return t && !t.deleted ? t.fields?.msgs || [] : [];
}

async function saveTalk(chapterId, msgs) {
  const prev = await getEntry(talkId(chapterId));
  await putEntries([{ ...(prev || entry('talk', { id: talkId(chapterId) })), deleted: false, fields: { of: chapterId, msgs }, updated_at: Date.now() }]);
}

export class TalkPanel {
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.chapterId = null;
    this.msgs = [];
    this.busy = false;
  }

  get isOpen() { return !this.el.hidden; }

  async open(chapterId) {
    this.chapterId = chapterId;
    this.msgs = await talkOf(chapterId);
    this.el.hidden = false;
    document.body.classList.add('talk-on');
    this.render();
    this.el.querySelector('textarea')?.focus();
  }

  close() { this.el.hidden = true; document.body.classList.remove('talk-on'); }

  render() {
    const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const el = this.el;
    el.replaceChildren();
    const head = make('div', 'bs-head');
    const close = make('button', 'ghost-btn', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => { this.close(); this.hooks.focus(); });
    const clear = make('button', 'ghost-btn', 'Start over');
    clear.type = 'button';
    clear.hidden = !this.msgs.length;
    clear.addEventListener('click', async () => { this.msgs = []; await saveTalk(this.chapterId, []); this.render(); });
    head.append(make('span', 'panel-label', 'Talk it over with Claude'), clear, close);
    const list = make('div', 'tk-list');
    if (!this.msgs.length) list.append(make('p', 'hint', 'Claude has this chapter in front of it. Ask what’s working, where it drags, whether a choice lands…'));
    for (const m of this.msgs) {
      const d = make('div', `tk-msg tk-${m.who}`, m.text);
      list.append(d);
    }
    if (this.busy) list.append(make('div', 'tk-msg tk-claude tk-wait', 'Reading…'));
    const form = make('form', 'tk-form');
    const input = make('textarea');
    input.rows = 2;
    input.placeholder = 'Ask about this chapter…';
    input.setAttribute('aria-label', 'Your message to Claude');
    input.value = this.draft || '';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); this.hooks.focus(); }
    });
    const send = make('button', 'pill', 'Send');
    send.type = 'submit';
    send.disabled = this.busy;
    form.append(input, send);
    form.addEventListener('submit', (e) => { e.preventDefault(); this.send(input.value); });
    el.append(head, list, form);
    list.scrollTop = list.scrollHeight;
  }

  async send(text) {
    text = (text || '').trim();
    if (!text || this.busy) return;
    if (!this.hooks.canAsk()) { this.hooks.toast('Sign in and go online to talk with Claude'); return; }
    const chapterId = this.chapterId;
    this.msgs = [...this.msgs, { who: 'me', text, at: Date.now() }];
    this.draft = '';
    this.busy = true;
    this.render();
    try {
      await this.hooks.save();
      const chapter = await getEntry(chapterId);
      const ctx = await this.hooks.context();
      const got = await this.hooks.ask({ mode: 'revise', task: 'talk', piece: ctx.book || '', idea: ctx.idea || '', chapter: chapter?.title || '', paras: await parasOf(chapterId), msgs: this.msgs.map(({ who, text: t }) => ({ who, text: t })) });
      this.msgs = [...this.msgs, { who: 'claude', text: got.reply, at: Date.now() }];
      await saveTalk(chapterId, this.msgs);
    } catch (e) {
      this.hooks.toast(e.message || 'Couldn’t reach Claude. Try again.');
      this.msgs = this.msgs.slice(0, -1);
      this.draft = text;
    } finally {
      this.busy = false;
      if (this.chapterId === chapterId) this.render();
    }
  }
}
