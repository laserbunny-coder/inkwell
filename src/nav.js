// Getting around: always show where you are, and one tap on it gets you
// anywhere.
//
// On a phone a bar sits along the bottom (hidden while the keyboard is up):
// Back to the last place (named, so you know where it goes), the place you're
// in, Today, the mic and the menu. Tapping the place opens the Go sheet: the
// last few places, the path up, this piece's or world's pages, and the desk.
// On a computer a faint line at the top names the place, with the last place
// beside it, and Ctrl + O opens the same panel (Enter flips straight back).

const RECENT = 'recentPlaces';
const KEEP = 8;

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};

// One key per place, so the same chapter or page shows once in the list.
export function placeKey(p) {
  if (!p?.view) return '';
  return [p.view, p.chapterId || p.pageId || p.id || p.area || '', p.page || p.tab || p.tag || ''].join(':');
}

const MIC = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

export class Nav {
  // hooks: go(place), goPage(id), tabs() → [{id,label,n}], active() → tab id,
  // crumb() → the crumb's buttons, search(text), capture(), menu(), outline(),
  // isTouch(), keyLabel(text)
  constructor(hooks) {
    this.hooks = hooks;
    this.current = null;
    this.name = '';
    this.context = '';
    try { this.recent = JSON.parse(localStorage.getItem(RECENT) || '[]').filter((r) => r?.place?.view); } catch { this.recent = []; }
    this.build();
  }

  build() {
    // The phone's bar.
    const bar = make('nav', 'placebar');
    bar.setAttribute('aria-label', 'Getting around');
    this.back = make('button', 'pb-back');
    this.back.addEventListener('click', () => this.jumpBack());
    this.place = make('button', 'pb-place');
    this.place.addEventListener('click', () => this.toggle());
    const today = make('button', 'pb-today', 'Today');
    today.addEventListener('click', () => { this.close(false); this.hooks.goPage('today'); });
    const mic = make('button', 'pb-mic');
    mic.setAttribute('aria-label', 'Capture by voice');
    mic.innerHTML = MIC;
    mic.addEventListener('click', () => this.hooks.capture());
    const menu = make('button', 'pb-menu', '⋯');
    menu.setAttribute('aria-label', 'Menu');
    menu.addEventListener('click', () => this.hooks.menu());
    bar.append(this.back, this.place, today, mic, menu);
    // In focus mode the bar shrinks to a handle; a tap brings it back for a moment.
    const handle = make('button', 'pb-handle');
    handle.setAttribute('aria-label', 'Show the bar');
    handle.append(make('span'));
    handle.addEventListener('click', () => document.body.classList.add('bar-peek'));
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.placebar, .pb-handle, .go-panel')) document.body.classList.remove('bar-peek'); });

    // The computer's line at the top.
    const line = make('div', 'placeline');
    this.lineBack = make('button', 'pl-back');
    this.lineBack.addEventListener('click', () => this.jumpBack());
    this.linePlace = make('button', 'pl-place');
    this.linePlace.addEventListener('click', () => this.toggle());
    line.append(this.lineBack, this.linePlace);

    // The Go sheet (a panel on a computer).
    this.backdrop = make('div', 'go-backdrop');
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', () => this.close());
    this.panel = make('section', 'go-panel');
    this.panel.setAttribute('aria-label', 'Go');
    this.panel.hidden = true;
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    });

    document.body.append(line, bar, handle, this.backdrop, this.panel);
    this.bar = bar;
    this.line = line;
    // While the panel is open, only it takes the caret: a page that finishes
    // opening a moment later doesn't pull your typing back into its text.
    document.addEventListener('focusin', (e) => {
      if (!this.isOpen || this.panel.contains(e.target)) return;
      (this.find ? this.panel.querySelector('.go-find') : this.panel).focus();
    });
    // The keyboard is up while something on a touch screen is being typed in.
    document.addEventListener('focusin', (e) => { if (this.hooks.isTouch() && this.typingIn(e.target)) document.body.classList.add('kb-up'); });
    document.addEventListener('focusout', () => setTimeout(() => { if (!this.typingIn(document.activeElement)) document.body.classList.remove('kb-up'); }, 50));
  }

  typingIn(el) { return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && !el.closest('.go-panel'); }

  get isOpen() { return !this.panel.hidden; }

  // Where you are now, and what to call it. names: the crumb's words, outermost first.
  here(place, names) {
    if (!place?.view) return;
    const key = placeKey(place);
    const name = names.at(-1) || '';
    const context = names.length > 1 && names.at(-2) !== 'Library' && names.at(-2) !== 'Daily pages' ? names.at(-2) : '';
    // The place you were before this one goes to the top of the list.
    if (this.current && placeKey(this.current) !== key && this.name) {
      this.recent = [{ place: this.current, name: this.name, context: this.context }, ...this.recent.filter((r) => placeKey(r.place) !== placeKey(this.current))];
    }
    this.recent = this.recent.filter((r) => placeKey(r.place) !== key).slice(0, KEEP);
    try { localStorage.setItem(RECENT, JSON.stringify(this.recent)); } catch { /* full */ }
    this.current = place;
    this.name = name;
    this.context = context;
    this.draw();
    if (this.isOpen) {
      // Redrawn while open (a page finished opening): keep the caret and anything typed.
      const old = this.panel.querySelector('.go-find');
      const had = old && document.activeElement === old;
      const typed = old?.value || '';
      this.drawPanel();
      const find = this.panel.querySelector('.go-find');
      find.value = typed;
      if (had) find.focus();
    }
  }

  // A place's name was changed (a rename): keep the list's words fresh.
  rename(names) { if (this.current) this.here(this.current, names); }

  draw() {
    const last = this.recent[0];
    for (const b of [this.back, this.lineBack]) {
      b.hidden = !last;
      b.textContent = last ? `‹ ${last.name}` : '';
      b.title = last ? `Back to ${last.context ? `${last.name} · ${last.context}` : last.name}` : '';
    }
    this.place.replaceChildren(make('span', 'pb-name', this.context ? `${this.name} · ${this.context}` : this.name || 'Inkwell'), make('span', 'pb-up', '▴'));
    this.place.setAttribute('aria-label', `${this.name}. Go somewhere else`);
    const path = make('span', 'pl-path', this.context ? `${this.context} › ${this.name}` : this.name);
    this.linePlace.replaceChildren(path, make('span', 'keys', this.hooks.keyLabel('⌘O')));
    this.linePlace.title = 'Go somewhere else';
  }

  jumpBack() {
    const last = this.recent[0];
    this.close(false);
    if (last) this.hooks.go(last.place);
  }

  toggle(find) { if (this.isOpen) this.close(); else this.open(find); }

  // find: put the caret in the search box (always when opened from the keyboard).
  open(find = !this.hooks.isTouch()) {
    document.body.classList.remove('show-outline', 'show-top');
    this.drawPanel();
    this.panel.hidden = false;
    this.backdrop.hidden = false;
    document.body.classList.add('go-on');
    // On a phone the keyboard would cover the sheet, so nothing is focused there.
    this.find = find;
    if (find) this.panel.querySelector('.go-find')?.focus();
    else this.panel.focus?.();
  }

  close(refocus = true) {
    if (!this.isOpen) return;
    this.panel.hidden = true;
    this.backdrop.hidden = true;
    document.body.classList.remove('go-on');
    if (refocus) this.hooks.refocus?.();
  }

  drawPanel() {
    const p = this.panel;
    p.tabIndex = -1;
    const parts = [];
    if (this.hooks.isTouch()) { const grip = make('div', 'go-grip'); grip.setAttribute('aria-hidden', 'true'); parts.push(grip); }

    const find = make('input', 'go-find');
    find.type = 'text';
    find.placeholder = 'Go to anything…';
    find.setAttribute('aria-label', 'Go to anything');
    find.addEventListener('input', () => { const t = find.value; this.close(false); this.hooks.search(t); });
    find.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !find.value) { e.preventDefault(); this.jumpBack(); } });
    parts.push(find);

    const section = (label, body, cls = '') => {
      const s = make('div', 'go-section ' + cls);
      s.append(make('div', 'go-label', label), body);
      parts.push(s);
    };
    const go = (fn) => () => { this.close(false); fn(); };

    if (this.recent.length) {
      const list = make('div', 'go-recent');
      this.recent.slice(0, 5).forEach((r, i) => {
        const b = make('button', 'go-chip' + (i === 0 ? ' first' : ''));
        b.append(make('span', 'go-name', r.name));
        if (r.context) b.append(make('span', 'go-ctx', `· ${r.context}`));
        if (i === 0 && !this.hooks.isTouch()) b.append(make('span', 'keys', 'Enter'));
        b.addEventListener('click', go(() => this.hooks.go(r.place)));
        list.append(b);
      });
      section('Jump back', list);
    }

    // The path up, each step a way there.
    const crumb = this.hooks.crumb().filter((b) => b.textContent.trim());
    if (crumb.length > 1) {
      const path = make('div', 'go-path');
      crumb.forEach((c, i) => {
        if (i) path.append(make('span', 'sep', '›'));
        const here = i === crumb.length - 1;
        const b = make('button', 'go-step' + (here ? ' here' : ''), c.textContent.replace(/\s*▾\s*$/, ''));
        if (!here) b.addEventListener('click', go(() => c.click()));
        else b.disabled = true;
        path.append(b);
      });
      section('You’re in', path);
    }

    // This world's or piece's pages, all of them, with their keys.
    const tabs = this.hooks.tabs();
    const active = this.hooks.active();
    const inside = tabs.some((t) => t.n != null);
    if (inside) {
      const grid = make('div', 'go-tabs');
      for (const t of tabs) {
        const b = make('button', 'go-tab' + (t.id === active ? ' on' : ''));
        b.append(make('span', 'go-tab-name', t.label));
        if (!this.hooks.isTouch()) b.append(make('span', 'keys', this.hooks.keyLabel(`⌥${t.n}`)));
        if (t.id === active) b.setAttribute('aria-current', 'page');
        b.addEventListener('click', go(() => this.hooks.goPage(t.id)));
        grid.append(b);
      }
      if (this.hooks.isTouch()) {
        const o = make('button', 'go-tab quiet', 'Outline');
        o.addEventListener('click', go(() => this.hooks.outline()));
        grid.append(o);
      }
      section(this.titleOfOwner(), grid);
    }

    const desk = make('div', 'go-desk');
    for (const [id, label, keys] of [['today', 'Today', '⌘J'], ['drawer', 'Drawer', ''], ['library', 'Library', '⌘⇧O'], ['tags', 'Tags', '']]) {
      const b = make('button', 'go-tab desk' + (active === id && !inside ? ' on' : ''));
      b.append(make('span', 'go-tab-name', label));
      if (keys && !this.hooks.isTouch()) b.append(make('span', 'keys', this.hooks.keyLabel(keys)));
      b.addEventListener('click', go(() => this.hooks.goPage(id)));
      desk.append(b);
    }
    if (!inside && this.hooks.isTouch()) {
      const o = make('button', 'go-tab desk quiet', 'Outline');
      o.addEventListener('click', go(() => this.hooks.outline()));
      desk.append(o);
    }
    section('Desk', desk);
    if (!this.hooks.isTouch()) parts.push(make('p', 'go-hint', `${this.hooks.keyLabel('⌘O')}, then Enter, flips you back to where you just were. Typing finds anything.`));
    p.replaceChildren(...parts);
  }

  // The world or piece whose pages these are: the crumb's book part, else the world.
  titleOfOwner() {
    const crumb = this.hooks.crumb();
    const book = crumb.find((b) => b.classList.contains('book'));
    if (book) return book.textContent.replace(/\s*▾\s*$/, '');
    return this.context || this.name;
  }
}
