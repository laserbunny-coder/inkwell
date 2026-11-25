// A double tap zooms in, on a phone (Michael, Nov 25 2026): one tap puts the
// cursor in a line's words, a second tap on the same line within DOUBLE ms
// zooms into it. Android's own double-tap window is 300 ms.
export const DOUBLE = 300;

// Hears quick taps on root; when two land on the same key in time, run(key).
// keyOf(target) → the line's key, or null where a tap means nothing here.
export function doubleTaps(root, keyOf, run) {
  let down = null; // { x, y, at, key }
  let last = null; // { key, at } of the last tap
  const start = (e) => {
    down = null;
    if (e.touches.length !== 1) { last = null; return; }
    const key = keyOf(e.target);
    if (!key) { last = null; return; }
    const { clientX: x, clientY: y } = e.touches[0];
    down = { x, y, at: Date.now(), key };
  };
  const end = (e) => {
    const d = down;
    down = null;
    if (!d) return;
    const c = e.changedTouches?.[0];
    const now = Date.now();
    // A tap: short and still. A hold or a slide is something else.
    if (!c || now - d.at > 250 || Math.hypot(c.clientX - d.x, c.clientY - d.y) > 10) { last = null; return; }
    if (last && last.key === d.key && now - last.at <= DOUBLE) {
      last = null;
      if (e.cancelable) e.preventDefault(); // no second click, no word picked
      run(d.key);
      return;
    }
    last = { key: d.key, at: now };
  };
  const cancel = () => { down = null; last = null; };
  root.addEventListener('touchstart', start, { passive: true, capture: true });
  root.addEventListener('touchend', end, { passive: false, capture: true });
  root.addEventListener('touchcancel', cancel, true);
  return () => {
    root.removeEventListener('touchstart', start, { capture: true });
    root.removeEventListener('touchend', end, { capture: true });
    root.removeEventListener('touchcancel', cancel, true);
  };
}
