import { byKind, putEntries } from './db.js';
import { entry, newId, noteTypes, saveNoteTypes, tagsIn } from './model.js';

// Notes sit beside the text, each lined up with the top of its paragraph.
// A note is its own entry whose parent is the paragraph it belongs to, so it
// can be tagged, linked and filtered like anything else.
export class NotesLayer {
  constructor(layerEl, editor) {
    this.el = layerEl;
    this.editor = editor;
    this.notes = [];
    this.types = [];
    // The threads of the plot grid this chapter's world follows; a note can
    // belong to one, and then it's in that thread's column on the grid.
    this.threads = [];
    this.chapterId = null;
    this.visible = false;
    this.saveTimers = new Map();
    this.frame = 0;
    // Notes left out of the margin: resolved comments, and categories switched
    // off (Claude's notes, readers' comments). Set by the app.
    this.skip = () => false;
    // Answering and resolving a reader's comment (src/sharelink.js).
    this.comments = null;
    window.addEventListener('resize', () => this.layout());
    // Turning notes on narrows the text column over a quarter second, and the
    // paragraphs rewrap as it goes; lining up once at the start left cards
    // sitting low. Line up again whenever the text changes size.
    new ResizeObserver(() => this.layout()).observe(editor.view.dom);
    layerEl.closest('.sheet')?.addEventListener('transitionend', () => this.layout());
    // A quiet gutter just right of the text: a dot where a paragraph has notes.
    this.gutter = document.createElement('div');
    this.gutter.className = 'note-gutter';
    this.gutter.setAttribute('aria-label', 'Notes');
    layerEl.parentElement.append(this.gutter);
  }

  async load(chapterId) {
    this.chapterId = chapterId;
    this.types = await noteTypes();
    this.notes = (await byKind('note')).filter((n) => n.fields?.chapter_id === chapterId);
    this.render();
  }

  setVisible(on) {
    this.visible = on;
    document.body.classList.toggle('notes-on', on);
    document.dispatchEvent(new CustomEvent('notes-visibility'));
    this.render();
  }

  paragraphEl(eid) {
    return this.editor.view.dom.querySelector(`[data-eid="${CSS.escape(eid)}"]`);
  }

  currentParagraphId() {
    // Read the browser's selection first: right after a click it can be ahead of the editor's own state.
    const anchor = document.getSelection()?.anchorNode;
    const el = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement)?.closest('[data-eid]');
    if (el && this.editor.view.dom.contains(el)) return el.dataset.eid;
    const { $from } = this.editor.state.selection;
    const node = $from.node(1);
    return node ? node.attrs.eid : null;
  }

  async add(eid = this.currentParagraphId(), typeId) {
    if (!eid) return;
    if (!this.visible) this.setVisible(true);
    const note = entry('note', {
      parent_id: eid,
      type: typeId || this.types[0]?.id || null,
      fields: { chapter_id: this.chapterId }
    });
    this.notes.push(note);
    await putEntries([note]);
    this.render();
    this.el.querySelector(`[data-note="${note.id}"] textarea`)?.focus();
  }

  save(note) {
    clearTimeout(this.saveTimers.get(note.id));
    this.saveTimers.set(note.id, setTimeout(() => {
      note.tags = tagsIn(note.text);
      note.updated_at = Date.now();
      putEntries([note]);
    }, 300));
  }

  async remove(note) {
    note.deleted = true;
    note.updated_at = Date.now();
    this.notes = this.notes.filter((n) => n !== note);
    await putEntries([note]);
    this.render();
  }

  render() {
    this.el.replaceChildren();
    this.gutter.replaceChildren();
    if (!this.visible) {
      for (const eid of new Set(this.notes.filter((n) => n.text && !this.hides(n)).map((n) => n.parent_id))) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'note-dot';
        dot.dataset.for = eid;
        dot.title = 'This paragraph has notes. Show notes';
        dot.addEventListener('click', () => this.setVisible(true));
        this.gutter.append(dot);
      }
    } else for (const note of this.notes) if (!this.hides(note)) this.el.append(note.fields?.comment ? this.commentCard(note) : this.card(note));
    this.layout();
  }

  hides(note) { return !!note.fields?.resolved || this.skip(note); }

  // A reader's comment from a share link: their words (not editable), the
  // replies, and a way to answer or resolve it.
  commentCard(note) {
    const type = this.types.find((t) => t.id === note.type);
    const c = note.fields.comment;
    const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const card = make('div', 'note note-comment');
    card.dataset.note = note.id;
    card.style.setProperty('--hat', type?.color || '#2E8B7A');
    const head = make('div', 'note-head');
    head.append(make('span', 'nc-who', c.owner ? 'You, on the link' : c.name || 'A reader'), make('span', 'nc-when', new Date(c.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
    const hide = make('button', 'note-hide', 'Hide notes');
    hide.type = 'button';
    hide.addEventListener('click', () => { this.setVisible(false); this.editor.commands.focus(); });
    head.append(hide);
    card.append(head);
    if (c.quote) card.append(make('div', 'nc-quote', `“${c.quote}”`));
    card.append(make('div', 'nc-text', note.text));
    for (const r of note.fields.replies || []) {
      const d = make('div', `nc-reply${r.owner ? ' nc-mine' : ''}`);
      d.append(make('b', '', r.owner ? 'You' : r.name || 'A reader'), document.createTextNode(` ${r.text}`));
      card.append(d);
    }
    const actions = make('div', 'nc-actions');
    const reply = make('button', 'ghost-btn', 'Reply');
    reply.type = 'button';
    const resolve = make('button', 'ghost-btn', 'Resolve');
    resolve.type = 'button';
    resolve.title = 'Done with it: it leaves the margin, and the reader sees it as resolved';
    resolve.addEventListener('click', async () => {
      const next = await this.comments?.resolve(note);
      if (next) { note.fields = next.fields; this.render(); }
    });
    reply.addEventListener('click', () => {
      const box = make('textarea');
      box.rows = 2;
      box.placeholder = 'Your reply (they see it under their comment)…';
      box.setAttribute('aria-label', 'Reply');
      const send = make('button', 'pill', 'Send');
      send.type = 'button';
      send.addEventListener('click', async () => {
        const text = box.value.trim();
        if (!text) return;
        send.disabled = true;
        try {
          const next = await this.comments?.reply(note, text);
          if (next) { note.fields = next.fields; this.render(); }
        } catch (e) { send.disabled = false; this.comments?.toast?.(e.message || 'Couldn’t send that'); }
      });
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send.click(); if (e.key === 'Escape') { e.preventDefault(); this.render(); } });
      actions.replaceWith(box, send);
      box.focus();
      this.layout();
    });
    actions.append(reply, resolve);
    card.append(actions);
    const hl = (on) => this.paragraphEl(note.parent_id)?.classList.toggle('noted', on);
    card.addEventListener('mouseenter', () => hl(true));
    card.addEventListener('mouseleave', () => hl(false));
    requestAnimationFrame(() => this.layout());
    return card;
  }

  card(note) {
    const type = this.types.find((t) => t.id === note.type) || this.types[0];
    const card = document.createElement('div');
    card.className = 'note';
    card.dataset.note = note.id;
    card.style.setProperty('--hat', type?.color || '#888');

    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Note type');
    for (const t of this.types) select.add(new Option(t.name, t.id, false, t.id === note.type));
    select.add(new Option('Edit categories…', '__edit'));
    select.addEventListener('change', () => {
      if (select.value === '__edit') { select.value = note.type || this.types[0]?.id; this.editTypes(); return; }
      note.type = select.value;
      card.style.setProperty('--hat', this.types.find((t) => t.id === note.type)?.color || '#888');
      this.save(note);
    });

    const text = document.createElement('textarea');
    text.rows = 1;
    text.value = note.text;
    text.placeholder = 'Note…';
    text.setAttribute('aria-label', 'Note text');
    const grow = () => { text.style.height = 'auto'; text.style.height = `${text.scrollHeight}px`; };
    text.addEventListener('input', () => { note.text = text.value; grow(); this.save(note); this.layout(); });
    text.addEventListener('blur', () => { if (!note.text.trim()) this.remove(note); });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.editor.commands.focus(); }
    });
    requestAnimationFrame(() => { grow(); this.layout(); });

    const hl = (on) => this.paragraphEl(note.parent_id)?.classList.toggle('noted', on);
    card.addEventListener('mouseenter', () => hl(true));
    card.addEventListener('mouseleave', () => hl(false));
    text.addEventListener('focus', () => hl(true));
    text.addEventListener('blur', () => hl(false));

    // Right beside the notes, a quick way to tuck them all away again.
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'note-hide';
    hide.textContent = 'Hide notes';
    hide.title = 'Hide notes (⌘2). The dots bring them back.';
    hide.addEventListener('click', () => { this.setVisible(false); this.editor.commands.focus(); });
    const head = document.createElement('div');
    head.className = 'note-head';
    head.append(select);
    if (this.threads.length || note.fields?.thread) {
      const thread = document.createElement('select');
      thread.className = 'note-thread';
      thread.setAttribute('aria-label', 'Thread on the plot grid');
      thread.title = 'Which thread of the plot grid this belongs to';
      thread.add(new Option('No thread', ''));
      for (const t of this.threads) thread.add(new Option(t.title || 'Untitled', t.id, false, t.id === note.fields?.thread));
      thread.value = note.fields?.thread && this.threads.some((t) => t.id === note.fields.thread) ? note.fields.thread : '';
      thread.addEventListener('change', () => {
        const { thread: _t, beat: _b, ...rest } = note.fields || {};
        note.fields = thread.value ? { ...rest, thread: thread.value, ...(note.fields?.beat ? { beat: note.fields.beat } : {}) } : rest;
        this.save(note);
      });
      head.append(thread);
    }
    head.append(hide);

    card.append(head, text);
    return card;
  }

  async reloadTypes() {
    this.types = await noteTypes();
    this.render();
  }

  // Add, rename, recolour or remove note categories.
  editTypes() {
    document.querySelector('.note-types')?.remove();
    const types = this.types.map((t) => ({ ...t }));
    const box = document.createElement('div');
    box.className = 'note-types';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Note categories');
    const list = document.createElement('div');
    const draw = () => {
      list.replaceChildren(...types.map((t, i) => {
        const row = document.createElement('div');
        row.className = 'nt-row';
        const color = document.createElement('input');
        color.type = 'color';
        color.value = t.color;
        color.setAttribute('aria-label', `Colour for ${t.name}`);
        color.addEventListener('input', () => { t.color = color.value; });
        const name = document.createElement('input');
        name.value = t.name;
        name.setAttribute('aria-label', 'Category name');
        name.addEventListener('input', () => { t.name = name.value; });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ghost-btn';
        del.textContent = 'Remove';
        del.disabled = types.length < 2;
        del.addEventListener('click', () => { types.splice(i, 1); draw(); });
        row.append(color, name, del);
        return row;
      }));
    };
    draw();
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'ghost-btn';
    add.textContent = '+ Add a category';
    add.addEventListener('click', () => {
      const colors = ['#2F5DA8', '#A84E17', '#1F7A6E', '#6B4BB8', '#A83A5B', '#6E7A1F', '#8C6A2E'];
      types.push({ id: newId('nt'), name: 'New category', color: colors[types.length % colors.length] });
      draw();
      list.lastChild?.querySelector('input:not([type=color])')?.select();
    });
    const actions = document.createElement('div');
    actions.className = 'actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ghost-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => box.remove());
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'pill';
    done.textContent = 'Save';
    done.addEventListener('click', async () => {
      const clean = types.map((t) => ({ ...t, name: t.name.trim() || 'Untitled' }));
      await saveNoteTypes(clean);
      box.remove();
      await this.reloadTypes();
    });
    actions.append(cancel, done);
    const title = document.createElement('div');
    title.className = 'panel-label';
    title.textContent = 'Note categories';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Shared across your devices. Notes in a removed category move to the first one.';
    box.append(title, list, add, actions, hint);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); box.remove(); } });
    document.body.append(box);
    list.querySelector('input:not([type=color])')?.focus();
  }

  // Line each note up with its paragraph, pushing down any that would overlap.
  layout() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.visible) {
        const base = this.gutter.getBoundingClientRect().top;
        for (const dot of this.gutter.children) {
          const p = this.paragraphEl(dot.dataset.for);
          dot.hidden = !p;
          if (p) dot.style.transform = `translateY(${p.getBoundingClientRect().top - base}px)`;
        }
        return;
      }
      const base = this.el.getBoundingClientRect().top;
      let bottom = -Infinity;
      const cards = [...this.el.children].map((card) => {
        const note = this.notes.find((n) => n.id === card.dataset.note);
        // A note on the chapter as a whole (from the plot grid) sits at the top.
        if (note && note.parent_id === this.chapterId) return { card, top: 0 };
        const p = note && this.paragraphEl(note.parent_id);
        return { card, top: p ? p.getBoundingClientRect().top - base : null };
      }).sort((a, b) => (a.top ?? Infinity) - (b.top ?? Infinity));
      for (const { card, top } of cards) {
        if (top === null) { card.hidden = true; continue; }
        card.hidden = false;
        const y = Math.max(top, bottom + 10);
        card.style.transform = `translateY(${y}px)`;
        bottom = y + card.offsetHeight;
      }
    });
  }
}
