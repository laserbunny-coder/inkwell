// One way to rearrange any list (Nov 19 2026, "add, move and delete
// everywhere"). Every row that can move carries faint six dots; with a mouse
// it drags from anywhere on the row (a click still clicks), on a phone a hold
// lifts it, as on the Desk, in the day plan and in the outline. Its ⋯ menu has
// Move up, Move down, Move to the top, Move to… and Delete. On a computer the
// row takes the outline's keys: Alt + Shift + Up / Down moves it, Ctrl + Shift
// + Backspace deletes it.
import { make } from './dom.js';
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
  }
  fns.set(kind, onOrder);
  return ul;
}

// A row that moves: its key, its kind, the dots, and the keys.
// acts: { up(), down(), del() } — any may be left out.
export function movableRow(li, kind, key, acts = {}) {
  li.dataset.drag = kind;
  li.dataset.key = key;
  li.classList.add('lk-row');
  const dots = make('span', 'lk-dots', '⠿');
  dots.setAttribute('aria-hidden', 'true');
  dots.title = 'Drag to move (on a phone: hold the line)';
  li.prepend(dots);
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
