// One way to rearrange any list (Nov 19 2026, "add, move and delete
// everywhere"). With a mouse a row drags from anywhere on it (a click still
// clicks), on a phone a hold lifts it, as on the Desk, in the day plan and in
// the outline. No six dots (one way everywhere, Nov 26 2026): a right-click,
// or a hold let go without moving, opens the row's own ⋯ menu. Its ⋯ menu has
// Move up, Move down, Move to the top, Move to… and Delete. On a computer the
// row takes the outline's keys: Alt + Shift + Up / Down moves it, Ctrl + Shift
// + Backspace deletes it.
import { popMenu } from './menu.js';
import { deskDrags } from './deskdrag.js';

const wired = new WeakMap(); // root → { kind → onOrder }

// Make `ul` rearrangeable. kind names its rows; onOrder(key, keys) hears a drop.
// The drag listeners sit once on `root`, a part of the page that stays while
// the lists inside it are redrawn.
export function arrangeable(root, ul, kind, onOrder) {
  ul.dataset.drop = kind;
  let fns = wired.get(root);
  if (!fns) {
    fns = new Map();
    wired.set(root, fns);
    deskDrags(root, {
      drop: ({ kind: k, key, keys }) => fns.get(k)?.(key, keys),
      busy: () => {}
    });
    // A right-click, or a hold let go, on a row: its own ⋯ menu, where you are.
    const rowMenu = async (row, x, y) => {
      const b = ownMore(row);
      if (!b?.menuItems) return false;
      popMenu(b, await b.menuItems(), { left: x, top: y });
      return true;
    };
    root.addEventListener('contextmenu', (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      const row = e.target.closest?.('[data-drag]');
      if (!row || !root.contains(row) || !ownMore(row)?.menuItems) return;
      e.preventDefault();
      rowMenu(row, e.clientX, e.clientY);
    });
    root.addEventListener('row-held', (e) => {
      const row = e.target.closest?.('[data-drag]');
      if (row && root.contains(row)) rowMenu(row, e.detail.x, e.detail.y);
    });
  }
  fns.set(kind, onOrder);
  return ul;
}

// The row's own ⋯ (not one on a line inside it).
const ownMore = (row) => row.querySelector(':scope > .more-btn, :scope > .menu-btn, :scope > .wo-row > .more-btn, :scope > * > .more-btn');

// A row that moves: its key, its kind, and the keys (no dots any more).
// acts: { up(), down(), del() } — any may be left out.
export function movableRow(li, kind, key, acts = {}) {
  li.dataset.drag = kind;
  li.dataset.key = key;
  li.classList.add('lk-row');
  li.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
    const k = e.key;
    if (e.altKey && e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      const run = k === 'ArrowUp' ? acts.up : acts.down;
      if (!run) return;
      e.preventDefault();
      e.stopPropagation();
      run();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'Backspace' && acts.del) {
      e.preventDefault();
      e.stopPropagation();
      acts.del();
    }
  });
  return li;
}

// After a redraw, put the cursor back on the row that just moved, so the keys
// can keep moving it.
export function refocus(root, key) {
  const el = [...root.querySelectorAll(`[data-key="${CSS.escape(key)}"]`)].find((x) => x.offsetParent !== null);
  (el?.querySelector('button') || el)?.focus({ preventScroll: false });
}
