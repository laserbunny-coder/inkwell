// Getting around: always show where you are, and one tap on it gets you
// anywhere.
//
// The ruler at the bottom (zoom.js) goes between the stops. Go opens the one
// box (box.js): Jump back (the first is Back), this piece's or world's pages,
// Right here and All commands.
// On a computer the top bar names the place, with the last place as its first
// button, and Ctrl + K (or Ctrl + O) opens the same box (Enter flips straight back).

const RECENT = 'recentPlaces';
const KEEP = 8;


// One key per place, so the same chapter or page shows once in the list.
export function placeKey(p) {
  if (!p?.view) return '';
  return [p.view, p.chapterId || p.pageId || p.id || p.area || '', p.page || p.tab || p.tag || ''].join(':');
}

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
    // The computer's back button, at the start of the top bar. (The phone's
    // bottom bar went with the old layout on Nov 17 2026: the ruler is there now.)
    this.lineBack = document.getElementById('tb-back');
    this.lineBack.addEventListener('click', () => this.jumpBack());
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
    const b = this.lineBack;
    b.hidden = !last;
    b.textContent = last ? `‹ ${last.name}` : '';
    b.title = last ? `Back to ${last.context ? `${last.name} · ${last.context}` : last.name}` : '';
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
