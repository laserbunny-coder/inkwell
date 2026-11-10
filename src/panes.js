// Side by side: other places open in panes beside the main view.
//
// A pane is Inkwell itself, loaded again in a frame (index.html?pane=<id>)
// with its chrome hidden, so any view works in a pane and can be written in.
// Only the main window syncs. Every window shares the same storage on this
// device, and tells the others which entries it changed (a BroadcastChannel),
// so each one refreshes what it shows the same way it does for changes made
// on another device.
//
// Beside is one pane by default: opening something else beside takes its
// place (the pane's own Back returns to what was there). Ctrl + \ puts it
// away and brings it back, and its head has two shortcuts: Plan (today's
// plan) and Notes (the notes on the draft in the main window). With "More
// than one pane beside" switched on under Look, panes stand in a row on the
// right (three at most; more fold into thin spines). On a phone a pane opens
// in a sheet over what you're doing.
//
// The main window keeps the panes (PaneHost, window.__panes). Each window,
// the main one included, answers the host about drops (window.__pane).

const params = new URLSearchParams(location.search);
export const PANE_ID = params.get('pane') || '';
export const inPane = !!PANE_ID && window.parent !== window;
// Writes not yet saved are kept per window, so two windows on the same page
// never pick up each other's.
export const walKey = (id) => (inPane ? `wal:${PANE_ID}:${id}` : `wal:${id}`);

const MAX_SHOWN = 3;
const ALONE = 0.62;
const SPINE = 38;
const LAYOUT = 'panes';
const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };

// The host, from any window of this family (null when there's none).
export function host() {
  try { return (inPane ? window.parent : window).__panes || null; } catch { return null; }
}

// ---------- telling the other windows what changed ----------

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('inkwell-panes') : null;
// Only windows of one family (a main window and its panes) listen to each other.
const family = () => host()?.family || '';
export function sendChanged(rows) {
  const ids = [...new Set(rows.map((r) => r.id).filter(Boolean))];
  if (!channel || !ids.length || !family()) return;
  channel.postMessage({ family: family(), from: PANE_ID, ids });
}
export function onChanged(fn) {
  channel?.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.family !== family() || m.from === PANE_ID || !Array.isArray(m.ids)) return;
    fn(m.ids, m.from);
  });
}

// ---------- names ----------

export function kindOf(place, names = []) {
  switch (place?.view) {
    case 'notebook': return place.zoom ? 'Line' : place.pageId?.startsWith('day-') ? 'Day' : 'Page';
    case 'write': return 'Writing';
    case 'world': case 'stage': return 'World';
    case 'project': return 'Piece';
    case 'library': return 'Library';
    case 'tags': return 'Tags';
    case 'production': return 'Make';
    case 'deliver': return 'Deliver';
    case 'grid': return 'Grid';
    case 'drawer': return 'Drawer';
    case 'compare': return 'Compare';
    case 'plan': return 'Plan';
    case 'sidenotes': return 'Notes';
    default: return names.length ? '' : 'Pane';
  }
}

// The two places the pane's own switch leads to, and which one a place is.
export const BESIDE_PLACES = { plan: { view: 'plan', tab: 'day' }, notes: { view: 'sidenotes' } };
export const tabOf = (place) => (place?.view === 'plan' ? 'plan' : place?.view === 'sidenotes' ? 'notes' : '');
// These only make sense beside something, so they never trade places with it.
const stays = (place) => place?.view === 'sidenotes' || (place?.view === 'plan' && place.tab === 'day');

// ---------- the host, in the main window ----------

export class PaneHost {
  // hooks: mainPlace(), goMain(place), focusMain(), isOff(), many() → more
  // than one pane allowed, focus() → Focus is on, toast(text), changed()
  constructor(hooks) {
    this.hooks = hooks;
    this.away = false; // put away with Ctrl + \, still there
    this.family = Math.random().toString(36).slice(2);
    this.panes = [];
    this.focusedId = '';
    this.seq = 0;
    this.mainWeight = 1.5;
    this.sheetOpen = false;
    this.sheetFull = false;
    this.sheetAt = 0;
    this.narrow = matchMedia('(max-width: 899px), (hover: none)');
    this.build();
    this.narrow.addEventListener('change', () => this.layout());
    window.addEventListener('resize', () => this.layout());
    window.visualViewport?.addEventListener('resize', () => this.fitSheet());
    window.visualViewport?.addEventListener('scroll', () => this.fitSheet());
    // The bar at the bottom comes and goes (it hides while you type).
    const bar = document.querySelector('.placebar');
    if (bar && window.ResizeObserver) new ResizeObserver(() => this.fitSheet()).observe(bar);
    // Clicking back into the main window makes it the one you're in.
    window.addEventListener('focus', () => this.focused(''));
    document.addEventListener('pointerdown', () => this.focused(''), true);
  }

  get count() { return this.panes.length; }
  get sheet() { return this.narrow.matches; }
  // Is something beside in view right now?
  get showing() { return !!this.panes.length && !this.hooks.isOff() && (this.sheet ? this.sheetOpen : !this.away && !this.hooks.focus?.()); }

  // Ctrl + \: puts what's beside away, or brings it back. False when there's nothing beside.
  toggle() {
    if (!this.panes.length || this.hooks.isOff()) return false;
    if (this.sheet) { if (this.sheetOpen) this.hideSheet(); else this.showSheet(); return true; }
    this.away = !this.away;
    this.layout();
    this.save();
    if (this.away) { this.focused(''); this.hooks.focusMain(); }
    this.hooks.changed?.();
    return true;
  }

  // Plan or Notes in a pane's head: the pane goes there.
  async tab(id, which) {
    const pane = this.get(id) || this.panes[this.sheetAt];
    const place = BESIDE_PLACES[which];
    if (!pane || !place || tabOf(pane.place) === which) return;
    await pane.ready;
    try { await pane.frame.contentWindow.__pane.go(place); } catch { /* the pane went away */ }
  }
  tabs(run) {
    const el = make('span', 'pane-tabs');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'What is beside');
    for (const [which, label, title] of [['plan', 'Plan', 'Today’s plan beside'], ['notes', 'Notes', 'The notes on the draft in the main view']]) {
      const b = make('button', 'pane-tab', label);
      b.type = 'button';
      b.dataset.tab = which;
      b.title = title;
      b.addEventListener('click', () => run(which));
      el.append(b);
    }
    return el;
  }
  lightTabs(el, place) { for (const b of el.children) b.setAttribute('aria-pressed', String(tabOf(place) === b.dataset.tab)); }

  // The main window went somewhere: a pane that follows it (Notes) hears.
  mainMoved(place) {
    for (const p of this.panes) { try { p.frame.contentWindow?.__pane?.mainMoved?.(place); } catch { /* still starting */ } }
  }

  build() {
    // One set of frames for both layouts (a frame moved in the page would
    // load again): beside on a computer, or inside the sheet on a phone.
    this.row = make('div', 'panes');
    this.row.setAttribute('aria-label', 'Panes beside');
    this.sheetEl = make('div', 'pane-sheet');
    this.sheetEl.setAttribute('role', 'dialog');
    this.sheetEl.setAttribute('aria-label', 'Peek beside');
    const grab = make('div', 'ps-grab');
    const head = make('div', 'ps-head');
    this.sheetTitle = make('span', 'ps-title');
    const prev = this.sheetBtn('‹', 'Previous pane', () => this.flip(-1));
    this.sheetCount = make('span', 'ps-count');
    const next = this.sheetBtn('›', 'Next pane', () => this.flip(1));
    this.sheetSize = this.sheetBtn('⤢', 'Full height', () => { this.sheetFull = !this.sheetFull; this.fitSheet(); });
    const close = this.sheetBtn('×', 'Close this pane', () => this.close(this.panes[this.sheetAt]?.id));
    this.sheetNav = [prev, this.sheetCount, next];
    this.sheetTabs = this.tabs((which) => this.tab(this.panes[this.sheetAt]?.id, which));
    head.append(this.sheetTabs, this.sheetTitle, make('span', 'ps-space'), prev, this.sheetCount, next, this.sheetSize, close);
    this.sheetEl.append(grab, head, this.row);
    // Swipe the sheet down to put it away (the panes stay; ⋯ brings them back).
    let y0 = null;
    for (const el of [grab, head]) {
      el.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) y0 = e.clientY; });
    }
    window.addEventListener('pointerup', (e) => {
      if (y0 == null) return;
      const dy = e.clientY - y0;
      y0 = null;
      if (dy > 60) { if (this.sheetFull) { this.sheetFull = false; this.fitSheet(); } else this.hideSheet(); } else if (dy < -60) { this.sheetFull = true; this.fitSheet(); }
    });
    document.body.append(this.sheetEl);
    this.layout();
  }

  sheetBtn(label, title, run) {
    const b = make('button', 'ps-btn', label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', run);
    return b;
  }

  save() {
    try { localStorage.setItem(LAYOUT, JSON.stringify({ main: this.mainWeight, away: this.away, panes: this.panes.map((p) => ({ id: p.id, place: p.place, w: p.w, title: p.title, spine: p.spine })) })); } catch { /* full */ }
  }

  // Panes open when the app last closed come back (on a computer; on a phone
  // they wait in the sheet until asked for).
  restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LAYOUT) || 'null'); } catch { /* ignore */ }
    if (!saved?.panes?.length || this.hooks.isOff()) return;
    this.mainWeight = saved.main || 1.5;
    this.away = !!saved.away;
    for (const p of saved.panes.slice(this.hooks.many?.() ? -6 : -1)) if (p.place?.view) this.add(p.place, { w: p.w, title: p.title, spine: p.spine, quiet: true, show: false });
    this.layout();
  }

  // Opens a place in a new pane. From a pane, the new one goes right after it.
  async open(place, { from = null, focus = false } = {}) {
    if (!place?.view) return null;
    if (this.hooks.isOff()) { this.hooks.toast('Panes are switched off (Aa → Panes)'); return null; }
    const keep = document.activeElement;
    this.away = false;
    const one = this.hooks.many?.() ? null : this.panes.at(-1);
    if (one) {
      // One pane beside: what's there makes way (the pane's Back returns to it).
      for (const p of this.panes.slice(0, -1)) this.close(p.id);
      one.spine = false;
      this.layout();
      if (this.sheet) this.showSheet(this.panes.indexOf(one));
      await one.ready;
      try { await one.frame.contentWindow.__pane.go(place); } catch { /* the pane went away */ }
      if (focus || this.sheet) one.frame.contentWindow?.focus();
      this.save();
      this.hooks.changed?.();
      return one;
    }
    // On its own the pane is a narrow column; in a row they share the room evenly.
    const pane = this.add(place, { after: from, show: true, w: this.hooks.many?.() ? 1 : ALONE });
    this.layout();
    if (this.sheet) this.showSheet(this.panes.indexOf(pane));
    pane.ready.then(() => {
      if (focus || this.sheet) pane.frame.contentWindow?.focus();
      // Opening beside leaves you where you were.
      else if (!from && keep && document.contains(keep)) { keep.focus?.({ preventScroll: true }); this.focused(''); }
    });
    return pane;
  }

  add(place, { after = null, w = 1, title = '', spine = false, show = true } = {}) {
    const id = `p${Date.now().toString(36)}${(this.seq += 1)}`;
    const pane = { id, place, w: w || 1, title, names: [], spine, el: null, frame: null };
    pane.ready = new Promise((r) => { pane.readyNow = r; });
    const el = make('section', 'pane');
    el.dataset.pane = id;
    const head = make('div', 'pane-head');
    const kind = make('span', 'pane-kind', kindOf(place));
    const name = make('span', 'pane-title', title || ' ');
    const swap = make('button', 'pane-btn pane-swap', '⇤');
    swap.type = 'button';
    swap.title = 'Make this the main view (Ctrl + Alt + Enter)';
    swap.setAttribute('aria-label', 'Make this the main view');
    swap.addEventListener('click', () => this.swap(id));
    const close = make('button', 'pane-btn pane-close', '×');
    close.type = 'button';
    close.title = 'Close this pane (Ctrl + Alt + W)';
    close.setAttribute('aria-label', 'Close this pane');
    close.addEventListener('click', () => this.close(id));
    const tabs = this.tabs((which) => this.tab(id, which));
    this.lightTabs(tabs, place);
    el.classList.toggle('stays', stays(place));
    head.append(tabs, kind, name, make('span', 'pane-space'), swap, close);
    const frame = document.createElement('iframe');
    frame.className = 'pane-frame';
    frame.title = 'Pane';
    frame.src = `${location.pathname}?pane=${id}`;
    frame.addEventListener('load', () => {
      // Clicking into a pane makes it the one you're in.
      try { frame.contentWindow.addEventListener('focus', () => this.focused(id)); frame.contentDocument.addEventListener('pointerdown', () => this.focused(id), true); } catch { /* not ready */ }
    });
    const divider = make('div', 'pane-divider');
    divider.title = 'Drag to resize; double-click to make them equal';
    divider.addEventListener('pointerdown', (e) => this.resize(e, id));
    divider.addEventListener('dblclick', () => { this.panes.forEach((p) => { p.w = 1; }); this.mainWeight = 1.5; this.layout(); this.save(); });
    const spineEl = make('button', 'pane-spine');
    spineEl.type = 'button';
    spineEl.addEventListener('click', () => this.unfold(id));
    el.append(divider, head, frame, spineEl);
    Object.assign(pane, { el, frame, kindEl: kind, nameEl: name, spineEl, tabsEl: tabs });
    const at = after ? this.panes.findIndex((p) => p.id === after) + 1 : this.panes.length;
    this.panes.splice(at || this.panes.length, 0, pane);
    this.row.append(el);
    // A new pane shows; the oldest fold away to keep three.
    if (show) { pane.spine = false; this.fold(pane); }
    this.order();
    this.save();
    this.hooks.changed?.();
    return pane;
  }

  // Keeps at most three panes open, folding the ones opened longest ago.
  fold(keep) {
    const open = this.panes.filter((p) => !p.spine);
    let extra = open.length - MAX_SHOWN;
    for (const p of open) {
      if (extra <= 0) break;
      if (p === keep || p.id === this.focusedId) continue;
      p.spine = true;
      extra -= 1;
    }
  }

  unfold(id) {
    const pane = this.get(id);
    if (!pane) return;
    pane.spine = false;
    this.fold(pane);
    this.layout();
    this.save();
    pane.frame.contentWindow?.focus();
  }

  order() { this.panes.forEach((p) => this.row.append(p.el)); }

  get(id) { return this.panes.find((p) => p.id === id) || null; }

  // The frame's own window calls these.
  placeFor(id) { return this.get(id)?.place || null; }
  started(id) { this.get(id)?.readyNow(); }

  // Where a pane is now, and what it's called (its crumb).
  here(id, place, names) {
    const pane = this.get(id);
    if (!pane) return;
    pane.place = place;
    pane.names = names || [];
    pane.title = (names || []).at(-1) || '';
    pane.kindEl.textContent = kindOf(place, names);
    this.lightTabs(pane.tabsEl, place);
    pane.el.classList.toggle('stays', stays(place));
    if (this.panes[this.sheetAt] === pane) this.lightTabs(this.sheetTabs, place);
    pane.nameEl.textContent = pane.title;
    pane.nameEl.title = (names || []).join(' › ');
    pane.spineEl.textContent = pane.title || kindOf(place) || 'Pane';
    pane.spineEl.title = `${pane.title} (click to open it again)`;
    pane.frame.title = pane.title || 'Pane';
    if (this.sheet && this.panes[this.sheetAt] === pane) this.sheetTitle.textContent = pane.title;
    this.save();
    this.hooks.changed?.();
  }

  focused(id) {
    if (this.focusedId === id) return;
    this.focusedId = id;
    for (const p of this.panes) p.el.classList.toggle('focus', p.id === id);
    document.documentElement.classList.toggle('pane-focus', !!id);
  }

  close(id) {
    const pane = this.get(id || this.focusedId);
    if (!pane) return;
    const i = this.panes.indexOf(pane);
    try { pane.frame.contentWindow?.__pane?.closing?.(); } catch { /* gone */ }
    pane.el.remove();
    this.panes.splice(i, 1);
    if (!this.panes.length) this.away = false;
    // A folded pane comes back into the room the closed one leaves.
    const folded = this.panes.filter((p) => p.spine);
    if (folded.length && this.panes.filter((p) => !p.spine).length < MAX_SHOWN) folded.at(-1).spine = false;
    if (this.focusedId === pane.id) {
      this.focused('');
      const next = this.panes.filter((p) => !p.spine)[Math.min(i, this.panes.length - 1)];
      if (next && !this.sheet) next.frame.contentWindow?.focus();
      else this.hooks.focusMain();
    }
    if (this.sheet) { if (!this.panes.length) this.hideSheet(); else this.showSheet(Math.min(this.sheetAt, this.panes.length - 1)); }
    this.layout();
    this.save();
    this.hooks.changed?.();
  }

  closeAll() { for (const p of [...this.panes]) this.close(p.id); }

  // Main and the pane trade places.
  async swap(id) {
    const pane = this.get(id || this.focusedId);
    if (!pane || stays(pane.place)) return;
    const mine = this.hooks.mainPlace();
    const theirs = pane.place;
    try { await pane.frame.contentWindow.__pane.go(mine); } catch { /* the pane was still starting */ }
    await this.hooks.goMain(theirs);
    this.focused('');
    this.hooks.focusMain();
  }

  // Ctrl + Alt + → / ←: the next or previous window (main, then each pane).
  cycle(dir) {
    const shown = ['', ...this.panes.filter((p) => !p.spine).map((p) => p.id)];
    if (shown.length < 2) return;
    const i = Math.max(0, shown.indexOf(this.focusedId));
    const next = shown[(i + dir + shown.length) % shown.length];
    this.focused(next);
    if (!next) { window.focus(); this.hooks.focusMain(); } else {
      const pane = this.get(next);
      pane.frame.focus();
      pane.frame.contentWindow?.__pane?.focus();
    }
  }

  // ---------- sizes ----------

  layout() {
    const root = document.documentElement;
    const off = this.hooks.isOff();
    const none = off || !this.panes.length;
    root.classList.toggle('panes-sheet', this.sheet && !none);
    // Put away with Ctrl + \, or out of the way while Focus is on.
    const put = (this.away || !!this.hooks.focus?.()) && !this.sheet;
    root.classList.toggle('has-panes', !this.sheet && !none && !put);
    if (this.sheet || none || put) {
      root.classList.remove('beside-tight');
      root.style.setProperty('--panes-w', '0px');
      for (const p of this.panes) p.el.classList.remove('spine');
      if (none) this.hideSheet();
      else if (!put) this.showSheet(this.sheetAt, { open: this.sheetOpen });
      return;
    }
    this.sheetOpen = false;
    root.classList.remove('sheet-peek');
    for (const p of this.panes) p.el.classList.remove('off');
    const open = this.panes.filter((p) => !p.spine);
    const spines = this.panes.length - open.length;
    const total = this.mainWeight + open.reduce((s, p) => s + p.w, 0);
    const room = window.innerWidth - spines * SPINE;
    const panesW = Math.round(room * (1 - this.mainWeight / total) + spines * SPINE);
    root.style.setProperty('--panes-w', `${panesW}px`);
    // Little room left for the main view: its top bar drops what it can spare.
    root.classList.toggle('beside-tight', window.innerWidth - panesW < 1010);
    for (const p of this.panes) {
      p.el.classList.toggle('spine', p.spine);
      // Times ten, so a pane on its own (a weight under 1) still fills the room it was given.
      p.el.style.flex = p.spine ? `0 0 ${SPINE}px` : `${p.w * 10} 1 0`;
    }
  }

  resize(e, id) {
    e.preventDefault();
    const i = this.panes.findIndex((p) => p.id === id);
    const pane = this.panes[i];
    const left = this.panes.slice(0, i).reverse().find((p) => !p.spine) || null;
    const x0 = e.clientX;
    const start = { a: left ? left.w : this.mainWeight, b: pane.w };
    const px = pane.el.getBoundingClientRect().width / pane.w;
    document.documentElement.classList.add('pane-resizing');
    const move = (ev) => {
      const d = (ev.clientX - x0) / px;
      const a = Math.max(0.35, start.a + d);
      const b = Math.max(0.35, start.b - d);
      if (left) left.w = a; else this.mainWeight = a;
      pane.w = b;
      this.layout();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.documentElement.classList.remove('pane-resizing');
      this.save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------- the phone's sheet ----------

  showSheet(i = this.sheetAt, { open = true } = {}) {
    if (!this.panes.length) return;
    this.sheetAt = Math.max(0, Math.min(i, this.panes.length - 1));
    this.sheetOpen = open;
    this.panes.forEach((p, j) => p.el.classList.toggle('off', j !== this.sheetAt));
    const pane = this.panes[this.sheetAt];
    this.sheetTitle.textContent = pane.title || kindOf(pane.place);
    this.lightTabs(this.sheetTabs, pane.place);
    this.sheetCount.textContent = `${this.sheetAt + 1} of ${this.panes.length}`;
    for (const b of this.sheetNav) b.hidden = this.panes.length < 2;
    document.documentElement.classList.toggle('sheet-peek', open);
    this.fitSheet();
    this.hooks.changed?.();
  }

  hideSheet() {
    if (!this.sheetOpen) return;
    this.sheetOpen = false;
    document.documentElement.classList.remove('sheet-peek');
    this.hooks.changed?.();
  }

  flip(dir) { this.showSheet((this.sheetAt + dir + this.panes.length) % this.panes.length); }

  // The sheet sits above the keyboard, so what you type in it stays in view.
  fitSheet() {
    if (!this.sheetOpen) return;
    const vv = window.visualViewport;
    const keyboard = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    // Above the phone's bar at the bottom (it never moves), or above the keyboard.
    const bar = document.querySelector('.placebar');
    const under = keyboard || (bar?.getBoundingClientRect().height || 0);
    this.sheetEl.style.bottom = `${under}px`;
    this.sheetEl.classList.toggle('full', this.sheetFull || keyboard > 0);
    this.sheetSize.textContent = this.sheetFull ? '⤡' : '⤢';
    this.sheetSize.title = this.sheetFull ? 'Half height' : 'Full height';
  }

  // ---------- dragging a line from one window into another ----------

  // The window under a point given in the coordinates of window `fromId`.
  target(fromId, x, y) {
    const off = fromId ? this.get(fromId)?.frame.getBoundingClientRect() : { left: 0, top: 0 };
    if (!off) return null;
    const gx = off.left + x;
    const gy = off.top + y;
    for (const p of this.panes) {
      if (p.spine || p.el.classList.contains('off')) continue;
      const r = p.frame.getBoundingClientRect();
      if (gx >= r.left && gx < r.right && gy >= r.top && gy < r.bottom) return { id: p.id, win: p.frame.contentWindow, x: gx - r.left, y: gy - r.top };
    }
    const mainRight = window.innerWidth - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panes-w')) || 0);
    if (!this.sheet && gx >= 0 && gx < mainRight && gy >= 0 && gy < window.innerHeight) return { id: '', win: window, x: gx, y: gy };
    return null;
  }

  winOf(id) { return id ? this.get(id)?.frame.contentWindow : window; }

  // While dragging: shows where it would land in another window. True if
  // the pointer is over another window (the one it came from does nothing).
  dragOver(fromId, x, y) {
    const t = this.target(fromId, x, y);
    if (this.overId != null && this.overId !== t?.id) { try { this.winOf(this.overId)?.__pane?.dropClear(); } catch { /* gone */ } this.overId = null; }
    if (!t || t.id === fromId) return false;
    this.overId = t.id;
    try { return !!t.win.__pane?.dropOver(t.x, t.y); } catch { return false; }
  }

  // Let go over another window: move the line there (with Alt, leave a link).
  async drop(fromId, x, y, { eid, alt }) {
    const t = this.target(fromId, x, y);
    if (this.overId != null) { try { this.winOf(this.overId)?.__pane?.dropClear(); } catch { /* gone */ } this.overId = null; }
    if (!t || t.id === fromId) return false;
    const there = t.win.__pane;
    const spot = there?.dropSpot(t.x, t.y);
    if (!spot) return false;
    if (alt) return !!(await there.addLink(eid, spot));
    const ok = await this.winOf(fromId).__pane.moveOut(eid, spot);
    if (ok) await there.settle(eid, spot);
    return ok;
  }

  // The roots open in panes, for Move to… (pages, days and chapters).
  roots() {
    return this.panes.map((p) => {
      const pl = p.place || {};
      const id = pl.view === 'notebook' ? pl.pageId : pl.view === 'write' ? pl.chapterId : null;
      return id ? { id, title: p.title || kindOf(pl), pane: p.id } : null;
    }).filter(Boolean);
  }
}
