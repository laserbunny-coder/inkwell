// Small pieces shared by the Library, a book's home and the sidebar: a menu
// that drops from a ⋯ button (or a right-click, or a long press on a phone),
// a question to answer before anything big happens, and a note at the bottom
// of the screen with an Undo.

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};

let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }

// items: [{ label, run, danger, sub: [...items] }] or 'sep'.
export function popMenu(anchor, items, at) {
  closeMenu();
  const menu = make('div', 'pop-menu');
  menu.setAttribute('role', 'menu');
  const fill = (list, back) => {
    menu.replaceChildren();
    if (back) {
      const b = make('button', 'pop-back', `‹ ${back.label}`);
      b.addEventListener('click', () => fill(back.items));
      menu.append(b);
    }
    for (const it of list) {
      if (it === 'sep') { menu.append(make('div', 'pop-sep')); continue; }
      if (it.note) { menu.append(make('div', 'pop-note', it.note)); continue; }
      const b = make('button', 'pop-item' + (it.danger ? ' danger' : '') + (it.current ? ' current' : ''), it.label);
      b.setAttribute('role', 'menuitem');
      if (it.sub) b.append(make('span', 'pop-more', '›'));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.sub) return fill(it.sub, { label: it.label, items: list });
        closeMenu();
        it.run?.();
      });
      menu.append(b);
    }
    menu.querySelector('button')?.focus({ preventScroll: true });
  };
  fill(items);
  document.body.append(menu);
  openMenu = menu;
  const r = at || anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.min(Math.max(8, (at ? r.left : r.right - w)), window.innerWidth - w - 8);
  const below = (at ? r.top : r.bottom + 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, (at ? r.top : r.top - 4) - h) : below}px`;
  menu.addEventListener('keydown', (e) => {
    const btns = [...menu.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor?.focus?.(); }
  });
}
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
window.addEventListener('resize', closeMenu);

// A ⋯ button that opens a menu, and the same menu on right-click (a long
// press on a phone) anywhere on `target`.
export function menuButton(items, label = 'More') {
  const b = make('button', 'more-btn', '⋯');
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-haspopup', 'menu');
  b.addEventListener('click', async (e) => { e.stopPropagation(); e.preventDefault(); popMenu(b, await items()); });
  return b;
}
export function onContextMenu(target, items) {
  target.addEventListener('contextmenu', async (e) => {
    if (target.contentEditable === 'true') return;
    e.preventDefault();
    popMenu(target, await items(), { left: e.clientX, top: e.clientY });
  });
}

// Ask first. Resolves true for the main button, false for Cancel, Escape or a
// click outside. The safe choice (Cancel) has the focus, so Enter can't do harm.
export function ask({ title, body, ok = 'OK', danger = false, cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    const back = make('div', 'ask-backdrop');
    const box = make('div', 'ask');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const h = make('h2', '', title);
    const p = make('p', '', body);
    const row = make('div', 'ask-actions');
    const no = make('button', 'ghost-btn', cancel);
    const yes = make('button', 'pill' + (danger ? ' danger' : ' primary'), ok);
    row.append(no, yes);
    box.append(h, ...(body ? [p] : []), row);
    back.append(box);
    document.body.append(back);
    const done = (v) => { back.remove(); resolve(v); };
    no.addEventListener('click', () => done(false));
    yes.addEventListener('click', () => done(true));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done(false); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === no ? yes : no).focus(); }
    });
    no.focus();
  });
}

// A short note at the bottom, with one action (like Undo), gone after a while.
let toastTimer;
export function toast(text, action) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const t = make('div', 'toast');
  t.setAttribute('role', 'status');
  t.append(make('span', '', text));
  if (action) {
    const b = make('button', 'toast-action', action.label);
    b.addEventListener('click', () => { t.remove(); action.run(); });
    t.append(b);
  }
  document.body.append(t);
  toastTimer = setTimeout(() => t.remove(), 9000);
}

// Ask for a name. Resolves the new text, or null if left alone.
export function askText({ title, value = '', ok = 'Save', placeholder = '' }) {
  return new Promise((resolve) => {
    const back = make('div', 'ask-backdrop');
    const box = make('form', 'ask');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const input = make('input', 'ask-input');
    input.value = value;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', title);
    input.autocomplete = 'off';
    const row = make('div', 'ask-actions');
    const no = make('button', 'ghost-btn', 'Cancel');
    const yes = make('button', 'pill primary', ok);
    yes.type = 'submit';
    row.append(no, yes);
    box.append(make('h2', '', title), input, row);
    back.append(box);
    document.body.append(back);
    const done = (v) => { back.remove(); resolve(v); };
    no.addEventListener('click', () => done(null));
    box.addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); done(t && t !== value ? t : null); });
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done(null); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } });
    input.focus();
    input.select();
  });
}
