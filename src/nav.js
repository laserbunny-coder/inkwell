// Getting around: always show where you are, and one tap on it gets you
// anywhere.
//
// On a phone the bottom holds one thing: the writing row while the keyboard
// is up, else the bar (or, when it's quiet, a tab that brings the bar up):
// Today, Desk, the mic in the middle, Library and Go. Go opens the one box
// (box.js) as a sheet: Jump back (the first is Back), this piece's or
// world's pages, the rooms, Right here and All commands.
// On a computer the top bar names the place, with the last place as its first
// button, and Ctrl + K (or Ctrl + O) opens the same box (Enter flips straight back).

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

const ICONS = {
  today: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.7 5.7l1.5 1.5M16.8 16.8l1.5 1.5M5.7 18.3l1.5-1.5M16.8 7.2l1.5-1.5"/>',
  desk: '<path d="M12 4l8 4-8 4-8-4 8-4zM4 12.5l8 4 8-4M4 16.5l8 4 8-4"/>',
  library: '<path d="M5.5 4v16M10 4v16M14 6.5l4.5 13"/>',
  go: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.6-4.6"/>',
};
const MIC = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

export class Nav {
  // hooks: go(place), goPage(id), tabs() → [{id,label,n}], active() → tab id,
  // crumb() → the crumb's buttons, search(text), capture(), menu(), look(), outline(),
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
    // One word under one small drawing each, the mic in the middle.
    const item = (cls, name, word) => {
      const el = make('button', `pb-item ${cls}`);
      el.innerHTML = `<svg class="pb-ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
      el.append(make('span', 'pb-word', word));
      return el;
    };
    // Back lives in the Go sheet (Jump back) and on the phone's own back swipe.
    this.back = make('button', 'pb-back');
    this.back.addEventListener('click', () => this.jumpBack());
    this.today = item('pb-today', 'today', 'Today');
    this.today.addEventListener('click', () => { this.close(false); this.hooks.goPage('today'); });
    this.desk = item('pb-desk', 'desk', 'Desk');
    this.desk.addEventListener('click', () => { this.close(false); this.hooks.goPage('desk'); });
    this.lib = item('pb-lib', 'library', 'Library');
    this.lib.addEventListener('click', () => { this.close(false); this.hooks.goPage('library'); });
    const mic = make('button', 'pb-mic');
    mic.setAttribute('aria-label', 'Capture by voice');
    mic.innerHTML = MIC;
    mic.addEventListener('click', () => this.hooks.capture());
    this.place = item('pb-place', 'go', 'Go');
    this.place.addEventListener('click', () => this.toggle());
    bar.append(this.today, this.desk, mic, this.lib, this.place);
    // When it's quiet (Focus, or a draft) the bar rests as a small tab; a tap
    // brings it up until the next touch on the page. It's a button, so it
    // never brings up the keyboard. In Focus the bar comes with a way out.
    const tab = make('button', 'pb-tab');
    tab.setAttribute('aria-label', 'Show the bar');
    tab.innerHTML = '<span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 14 5-5 5 5"/></svg></span>';
    tab.addEventListener('click', () => document.body.classList.add('bar-peek'));
    const chip = make('div', 'pb-focus');
    chip.append(make('span', '', 'Focus is on'));
    const leave = make('button', 'pb-leave', 'Leave Focus');
    leave.addEventListener('click', () => { document.body.classList.remove('bar-peek'); this.hooks.leaveFocus?.(); });
    chip.append(leave);
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.placebar, .pb-tab, .pb-focus, .palette, .rail, .topbar')) document.body.classList.remove('bar-peek'); });
    this.tab = tab;

    // The computer's back button, at the start of the top bar.
    this.lineBack = document.getElementById('tb-back');
    this.lineBack.addEventListener('click', () => this.jumpBack());

    document.body.append(bar, tab, chip);
    this.bar = bar;
    // Whether the keyboard is up is keyboard.js's to say (body.kb-up).
  }

  typingIn(el) { return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && !el.closest('.palette.box'); }

  // Go is the one box now (box.js): the Go button opens it.
  get isOpen() { return !!this.hooks.boxOpen?.(); }

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
    this.place.setAttribute('aria-label', `${this.context ? `${this.name} · ${this.context}` : this.name || 'Inkwell'}. Go somewhere else`);
    // The room you're in is lit; inside a project neither is.
    const view = this.current?.view;
    const room = view === 'notebook' && (!this.current.pageId || this.current.pageId.startsWith('day-')) ? 'today' : view === 'desk' ? 'desk' : ['library', 'drawer', 'tags'].includes(view) ? 'library' : '';
    for (const [el, id] of [[this.today, 'today'], [this.desk, 'desk'], [this.lib, 'library']]) { if (room === id) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); }
  }

  // How many things need you, on the phone's Desk button.
  count(n) {
    if (n > 0) this.desk.dataset.n = String(n); else delete this.desk.dataset.n;
    this.desk.setAttribute('aria-label', n > 0 ? `Desk, ${n} waiting on you` : 'Desk');
  }

  jumpBack() {
    const last = this.recent[0];
    this.close(false);
    if (last) this.hooks.go(last.place);
  }

  toggle(find) { if (this.isOpen) this.close(); else this.open(find); }
  // find: put the caret in the box (always when opened from the keyboard).
  open(find = !this.hooks.isTouch()) { this.hooks.openBox?.({ find }); }
  close(refocus = true) { if (this.isOpen) this.hooks.closeBox?.(refocus); }

  // The world or piece whose pages these are: the crumb's book part, else the world.
  titleOfOwner() {
    const crumb = this.hooks.crumb();
    const book = crumb.find((b) => b.classList.contains('book'));
    if (book) return book.textContent.replace(/\s*▾\s*$/, '');
    return this.context || this.name;
  }
}
