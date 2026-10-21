// The six-dot handle beside each paragraph: drag it to move the paragraph,
// click or tap it for that paragraph's actions.

const GRIP = '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></g></svg>';

export class BlockHandle {
  constructor(editor, sheet, { actions }) {
    this.editor = editor;
    this.sheet = sheet;
    this.actions = actions;
    this.index = -1;

    this.handle = document.createElement('button');
    this.handle.type = 'button';
    this.handle.className = 'block-handle';
    this.handle.innerHTML = GRIP;
    this.handle.setAttribute('aria-label', 'Move this paragraph, or show its actions');
    this.handle.hidden = true;
    this.line = document.createElement('div');
    this.line.className = 'drop-line';
    this.line.hidden = true;
    this.menu = document.createElement('div');
    this.menu.className = 'block-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
    sheet.append(this.handle, this.line, this.menu);

    // The whole row counts, margin included, so the handle stays put while
    // you move from the text over to it.
    const zone = sheet.closest('.page') || sheet;
    zone.addEventListener('mousemove', (e) => {
      if (this.dragging || !this.menu.hidden) return;
      if (e.target === this.handle || this.handle.contains(e.target)) return;
      const box = sheet.getBoundingClientRect();
      if (e.clientX < box.left - 80 || e.clientX > box.right + 20) { this.hide(); return; }
      const i = this.blockIndexAtY(e.clientY);
      if (i >= 0) this.show(i);
      else this.hide();
    });
    zone.addEventListener('mouseleave', () => this.hide());
    // On a phone, the handle shows for the paragraph you're typing in.
    editor.on('selectionUpdate', () => {
      if (this.dragging || !this.menu.hidden) return;
      const i = editor.state.selection.$from.index(0);
      if (matchMedia('(hover: none)').matches) this.show(i);
    });
    this.handle.addEventListener('pointerdown', (e) => this.startDrag(e));
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target) && e.target !== this.handle && !this.handle.contains(e.target)) this.closeMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.menu.hidden) { e.stopPropagation(); this.closeMenu(); } }, true);
  }

  blockIndexAt(target) {
    const dom = this.editor.view.dom;
    let el = target;
    while (el && el.parentElement !== dom) el = el.parentElement;
    return el ? [...dom.children].indexOf(el) : -1;
  }

  // The block whose row (from its top to the next block's top) holds y.
  blockIndexAtY(y) {
    const kids = [...this.editor.view.dom.children];
    if (!kids.length) return -1;
    const first = kids[0].getBoundingClientRect();
    const last = kids[kids.length - 1].getBoundingClientRect();
    if (y < first.top - 8 || y > last.bottom + 24) return -1;
    for (let i = kids.length - 1; i >= 0; i--) if (y >= kids[i].getBoundingClientRect().top - 8) return i;
    return 0;
  }

  hide() {
    if (this.dragging || !this.menu.hidden) return;
    this.handle.classList.remove('visible');
  }

  blockEl(i) { return this.editor.view.dom.children[i]; }

  show(i) {
    const el = this.blockEl(i);
    if (!el) return;
    this.index = i;
    const top = el.getBoundingClientRect().top - this.sheet.getBoundingClientRect().top;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 30;
    this.handle.style.top = `${top + Math.max(0, (lh - 26) / 2)}px`;
    this.handle.hidden = false;
    this.handle.classList.add('visible');
  }

  // Positions of the top-level block at index i.
  range(i) {
    const doc = this.editor.state.doc;
    let pos = 0;
    for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
    return { from: pos, to: pos + doc.child(i).nodeSize, node: doc.child(i) };
  }

  move(from, to) {
    const doc = this.editor.state.doc;
    if (from === to || from + 1 === to || from < 0 || from >= doc.childCount || to < 0 || to > doc.childCount) return;
    const { from: a, to: b, node } = this.range(from);
    let tr = this.editor.state.tr.delete(a, b);
    const target = to > from ? to - 1 : to;
    let pos = 0;
    for (let k = 0; k < target; k++) pos += tr.doc.child(k).nodeSize;
    tr = tr.insert(pos, node);
    tr.setSelection(this.editor.state.selection.constructor.near(tr.doc.resolve(pos + 1)));
    this.editor.view.dispatch(tr.scrollIntoView());
    this.editor.view.focus();
  }

  startDrag(e) {
    e.preventDefault();
    const startY = e.clientY;
    const from = this.index;
    let to = from;
    this.dragging = false;
    const onMove = (ev) => {
      if (!this.dragging && Math.abs(ev.clientY - startY) < 5) return;
      this.dragging = true;
      this.closeMenu();
      document.body.classList.add('block-dragging');
      to = this.dropIndex(ev.clientY);
      const count = this.editor.view.dom.children.length;
      const ref = to < count ? this.blockEl(to).getBoundingClientRect().top : this.blockEl(count - 1).getBoundingClientRect().bottom;
      this.line.style.top = `${ref - this.sheet.getBoundingClientRect().top - 4}px`;
      this.line.hidden = false;
      this.handle.style.top = `${ev.clientY - this.sheet.getBoundingClientRect().top - 13}px`;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      this.line.hidden = true;
      document.body.classList.remove('block-dragging');
      if (this.dragging) { this.dragging = false; this.move(from, to); this.handle.hidden = true; }
      else this.toggleMenu();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  dropIndex(y) {
    const kids = [...this.editor.view.dom.children];
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return kids.length;
  }

  toggleMenu() {
    if (!this.menu.hidden) return this.closeMenu();
    const i = this.index;
    const { node } = this.range(i);
    const count = this.editor.state.doc.childCount;
    this.menu.replaceChildren();
    for (const a of this.actions) {
      if (a.when && !a.when(node, i, count)) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = '<span></span><span class="keys"></span>';
      b.firstChild.textContent = a.label;
      b.lastChild.textContent = a.keys || '';
      b.addEventListener('click', () => { this.closeMenu(); a.run({ node, index: i, handle: this }); });
      this.menu.append(b);
    }
    this.menu.style.top = `${parseFloat(this.handle.style.top) + 30}px`;
    this.menu.hidden = false;
    this.handle.classList.add('open');
    this.menu.querySelector('button')?.focus();
  }

  closeMenu() {
    this.menu.hidden = true;
    this.handle.classList.remove('open');
  }

  // Keyboard: move the paragraph the cursor is in.
  moveCurrent(dir) {
    const i = this.editor.state.selection.$from.index(0);
    const offset = this.editor.state.selection.from - this.range(i).from;
    this.move(i, dir < 0 ? i - 1 : i + 2);
    const j = dir < 0 ? Math.max(0, i - 1) : Math.min(this.editor.state.doc.childCount - 1, i + 1);
    const pos = this.range(j).from + offset;
    this.editor.commands.setTextSelection(Math.min(pos, this.range(j).to - 1));
  }
}
