import { keyLabel } from './keys.js';
// The menu behind every six-dot handle: paragraphs, script lines and notebook
// lines all use it, so it looks and reads the same everywhere. Each menu runs
// in the same order (work on this one, turn into, add above, move, delete).
// On a computer it drops from the handle; on a phone it rises from the bottom
// as a sheet, just above the keyboard, where a thumb can reach it.
//
// build() returns { title, sections }: lists of items, empty ones left out.
// An item is { label, keys, run, danger, stay, half } or a row of chips
// { chips: [{ label, current, run }], label }. On a phone, `stay` items keep
// the sheet open (so Move up can be tapped again) and `half` items with the
// same key sit two to a row. An `off` item can't be used just now: left out
// on a computer, greyed in its place on a phone so the pairs keep their spots.

const touch = matchMedia('(hover: none)');
let open = null;

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};

export const handleMenuIsOpen = () => !!open;

export function closeHandleMenu() {
  if (!open) return;
  const { el, onClose } = open;
  open = null;
  el.remove();
  onClose?.();
}

export function openHandleMenu({ anchor, at, build, onClose, editor }) {
  closeHandleMenu();
  const sheet = touch.matches;
  const el = make('div', sheet ? 'handle-menu as-sheet' : 'handle-menu');
  el.setAttribute('role', 'menu');
  // Taps on the sheet leave the keyboard (and the caret) where they are.
  if (sheet) el.addEventListener('pointerdown', (e) => e.preventDefault());
  open = { el, onClose, anchor };

  const choose = (run, stay) => {
    if (sheet && stay) { run(); render(); return; }
    closeHandleMenu();
    run();
  };
  const render = () => {
    const { title, sections } = build();
    el.replaceChildren();
    if (sheet) el.append(make('div', 'grab'));
    if (title) el.append(make('div', 'head', title));
    sections.map((s) => s.filter(Boolean)).filter((s) => s.length).forEach((items, k) => {
      if (k) el.append(make('div', 'sep'));
      let pair = null;
      for (const it of items) {
        if (it.chips) {
          el.append(make('div', 'turn-label', it.label || 'Turn into'));
          const row = make('div', 'hm-chips');
          for (const c of it.chips) {
            const b = make('button', c.current ? 'hm-chip current' : 'hm-chip', c.label);
            b.setAttribute('role', 'menuitemradio');
            b.setAttribute('aria-checked', c.current ? 'true' : 'false');
            b.addEventListener('click', () => choose(c.run, false));
            row.append(b);
          }
          el.append(row);
          pair = null;
          continue;
        }
        if (it.off && !sheet) continue;
        const b = make('button', it.danger ? 'item danger' : 'item');
        b.disabled = !!it.off;
        b.setAttribute('role', 'menuitem');
        b.append(make('span', '', it.label), make('span', 'keys', keyLabel(it.keys || '') || ''));
        b.addEventListener('click', () => choose(it.run, it.stay));
        if (sheet && it.half) {
          if (!pair || pair.dataset.key !== it.half || pair.children.length === 2) { pair = make('div', 'pair'); pair.dataset.key = it.half; el.append(pair); }
          pair.append(b);
        } else {
          pair = null;
          el.append(b);
        }
      }
    });
    place();
  };
  const place = () => {
    if (sheet) {
      const vv = window.visualViewport;
      const bottom = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
      el.style.bottom = `${bottom}px`;
      el.style.maxHeight = `${Math.max(200, (vv ? vv.height : window.innerHeight) - 24)}px`;
      return;
    }
    const r = at || anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    const below = at ? r.top : r.bottom + 4;
    el.style.left = `${left}px`;
    el.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, (at ? r.top : r.top - 4) - h) : below}px`;
  };

  document.body.append(el);
  render();
  open.place = place;
  if (!sheet) el.querySelector('button')?.focus({ preventScroll: true });
  el.addEventListener('keydown', (e) => {
    const btns = [...el.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const row = document.activeElement?.parentElement;
      if (row?.classList.contains('hm-chips') || row?.classList.contains('pair')) { e.preventDefault(); btns[i + (e.key === 'ArrowRight' ? 1 : -1)]?.focus(); }
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeHandleMenu(); editor?.commands.focus(); }
  });
}

// A press anywhere else closes it (the handle itself toggles it).
document.addEventListener('pointerdown', (e) => {
  if (!open || open.el.contains(e.target) || open.anchor?.contains?.(e.target)) return;
  closeHandleMenu();
}, true);
document.addEventListener('keydown', (e) => {
  if (open && e.key === 'Escape' && !open.el.contains(document.activeElement)) { e.stopPropagation(); closeHandleMenu(); }
}, true);
window.addEventListener('resize', () => { if (open && !touch.matches) closeHandleMenu(); });
window.visualViewport?.addEventListener('resize', () => open?.place?.());
// The menu floats over the page, so it goes when the page scrolls under it.
document.addEventListener('scroll', (e) => { if (open && !touch.matches && !open.el.contains(e.target)) closeHandleMenu(); }, true);
