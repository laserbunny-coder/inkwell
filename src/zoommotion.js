// The zoom's motion (Nov 25 2026, "Quick": 280 ms). Michael never saw the
// Nov 17 zoom: it faded the whole window while it grew or shrank by 4%, which
// reads as a cut. Now a zoom grows out of the thing you tapped and shrinks
// back into it, and a line you zoom into lifts into the title.
//
// Playground he picked from: https://claude.ai/artifact/EScE9L1nejQMWJ8sAA187z
// The motion itself is CSS (zoom.css, "the motion of a zoom"); this file says
// where it starts (--zx, --zy) and how far it goes (--zs, --zi).

const root = document.documentElement;
const calm = matchMedia('(prefers-reduced-motion: reduce)');

export const ZOOM_MS = 280;
// Off with the Look's motion Off, or when the device asks for reduced motion.
export const zoomMotion = () => (calm.matches ? 'off' : root.dataset.motion || 'full');

// What was last pressed, so the zoom knows where it came from.
let press = null;
document.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  press = { el: e.target, x: e.clientX, y: e.clientY, at: Date.now() };
}, true);

const TAP = 'button, a, li, [role="button"], [data-day], [data-id], [data-stop], .tile, .card, .row';
// The box the zoom grows out of: what was just tapped (not the ruler, which stays put).
export function tappedBox() {
  if (!press || Date.now() - press.at > 1500 || !press.el?.isConnected) return null;
  if (press.el.closest?.('.zm-ruler, .topbar')) return null;
  const el = press.el.closest?.(TAP) || press.el;
  const r = el.getBoundingClientRect?.();
  if (!r || !r.width || !r.height) return { x: press.x, y: press.y, w: 0, h: 0 };
  // A box nearly as big as the window says little: grow from the finger instead.
  if (r.width * r.height > innerWidth * innerHeight * 0.5) return { x: press.x, y: press.y, w: 0, h: 0 };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

// Point the zoom at a box (in the window's own pixels), or the middle when none.
export function aimAt(box) {
  if (!box) {
    root.style.setProperty('--zx', '50%');
    root.style.setProperty('--zy', '42%');
    root.style.setProperty('--zs', '1.5');
    root.style.setProperty('--zi', '.7');
    return null;
  }
  // How far it grows: further from something small, never wildly.
  const s = box.w ? Math.max(1.35, Math.min(2.2, (innerWidth / box.w) * 0.55)) : 1.6;
  root.style.setProperty('--zx', `${Math.round(box.x)}px`);
  root.style.setProperty('--zy', `${Math.round(box.y)}px`);
  root.style.setProperty('--zs', s.toFixed(2));
  root.style.setProperty('--zi', (1 / s).toFixed(2));
  return box;
}

let turn = 0;
let running = null;
// Run a change of what's on screen as a zoom. way: in, out, next, prev, rise,
// or line (a line lifting into its title: name the two ends 'zm-anchor').
// update() changes the page; it may return a promise. Resolves when the page
// has changed (not when the motion ends).
export function zoomRun(way, update, { before, after } = {}) {
  const m = zoomMotion();
  if (m === 'off' || !document.startViewTransition || document.hidden) return Promise.resolve(update());
  const mine = ++turn;
  try { running?.skipTransition(); } catch { /* already over */ }
  root.dataset.zt = m === 'gentle' ? 'fade' : way;
  before?.();
  let done;
  try {
    const t = document.startViewTransition(() => {
      done = Promise.resolve(update()).then((v) => { after?.(); return v; });
      return done;
    });
    running = t;
    const end = () => {
      if (mine !== turn) return;
      running = null;
      delete root.dataset.zt;
      for (const el of document.querySelectorAll('[data-zm-anchor]')) { el.style.viewTransitionName = ''; delete el.dataset.zmAnchor; }
    };
    t.finished.then(end, end);
    // A quick second step skips this one: that's fine, not an error.
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(() => {});
    return t.updateCallbackDone.then(() => done, () => done);
  } catch {
    delete root.dataset.zt;
    return Promise.resolve(update());
  }
}

// Mark one end of a lift (the line, then its title).
export function anchor(el) {
  for (const old of document.querySelectorAll('[data-zm-anchor]')) { old.style.viewTransitionName = ''; delete old.dataset.zmAnchor; }
  if (!el) return;
  el.style.viewTransitionName = 'zm-anchor';
  el.dataset.zmAnchor = '1';
}
