// Keeping the screen still (Michael, Nov 20 and Nov 22 2026): when something
// folds or unfolds, the line you tapped stays at the same height on the screen,
// not only at once but while the page settles (a phone's keyboard closing as
// a field inside the fold goes away, a field growing to fit its words, fonts
// arriving). While it settles, nothing else scrolls to the caret.

let calmUntil = 0;
// Nothing else moves the page for a moment (the caret-in-view rule on a phone).
export function calm(ms = 800) {
  calmUntil = Math.max(calmUntil, performance.now() + ms);
  document.dispatchEvent(new CustomEvent('inkwell:calm-scroll'));
}
export const calmNow = () => performance.now() < calmUntil;

// Runs fix() on every frame (and when the visible area changes) for ms, so the
// line stays pinned while the page settles. A scroll of your own (wheel,
// finger, scroll keys) ends it at once.
export function settle(fix, ms = 800, done = null) {
  const end = performance.now() + ms;
  let stop = false;
  const off = () => {
    if (stop) return;
    stop = true;
    done?.();
    for (const t of ['wheel', 'touchmove']) window.removeEventListener(t, off, true);
    window.removeEventListener('keydown', key, true);
    window.visualViewport?.removeEventListener('resize', fix);
  };
  const key = (e) => { if (/^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown| )$/.test(e.key)) off(); };
  for (const t of ['wheel', 'touchmove']) window.addEventListener(t, off, { capture: true, passive: true });
  window.addEventListener('keydown', key, true);
  window.visualViewport?.addEventListener('resize', fix);
  const tick = () => {
    if (stop) return;
    if (performance.now() > end) { off(); return; }
    fix();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// The simple form: find() gives the element to keep still (looked up again
// each time, since folding often draws it anew); change() does the folding.
export function holdStill(find, change, ms = 800) {
  const before = find()?.getBoundingClientRect().top;
  change();
  if (before == null) return;
  calm(ms);
  const fix = () => {
    const el = find();
    if (!el?.isConnected) return;
    const d = el.getBoundingClientRect().top - before;
    if (Math.abs(d) > 0.5) window.scrollBy(0, d);
  };
  fix();
  settle(fix, ms);
}
