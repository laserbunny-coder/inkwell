import { byKind, putEntries } from './db.js';
import { entry, noteTypes, tagsIn } from './model.js';

// Notes sit beside the text, each lined up with the top of its paragraph.
// A note is its own entry whose parent is the paragraph it belongs to, so it
// can be tagged, linked and filtered like anything else.
export class NotesLayer {
  constructor(layerEl, editor) {
    this.el = layerEl;
    this.editor = editor;
    this.notes = [];
    this.types = [];
    this.chapterId = null;
    this.visible = false;
    this.saveTimers = new Map();
    this.frame = 0;
    window.addEventListener('resize', () => this.layout());
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
    if (!this.visible) return;
    for (const note of this.notes) this.el.append(this.card(note));
    this.layout();
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
    select.addEventListener('change', () => {
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
    requestAnimationFrame(grow);

    const hl = (on) => this.paragraphEl(note.parent_id)?.classList.toggle('noted', on);
    card.addEventListener('mouseenter', () => hl(true));
    card.addEventListener('mouseleave', () => hl(false));
    text.addEventListener('focus', () => hl(true));
    text.addEventListener('blur', () => hl(false));

    card.append(select, text);
    return card;
  }

  // Line each note up with its paragraph, pushing down any that would overlap.
  layout() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.visible) return;
      const base = this.el.getBoundingClientRect().top;
      let bottom = -Infinity;
      const cards = [...this.el.children].map((card) => {
        const note = this.notes.find((n) => n.id === card.dataset.note);
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
