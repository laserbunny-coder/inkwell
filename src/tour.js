// A short click-through (Nov 23 2026, Studio's First steps). One step at a
// time: the place opens, one thing on the screen is ringed, and a small tip
// says what it is. Next (or a tap on the ringed thing, where the step asks
// for it) moves on; Stop ends it. Nothing is changed by the tour itself.
//
// A step: { go?: place, sel?: CSS selector (the first one showing),
//   text?: its words exactly, when several match, say: words, tap?: true (the ringed thing is tapped to go on),
//   before?: async () => {} }.
import { make } from './dom.js';

let live = null;

export const touring = () => !!live;

export function runTour(steps, { go, onDone, title = '' } = {}) {
  stopTour();
  live = { steps, i: 0, go, onDone, title };
  document.documentElement.classList.add('touring');
  return show();
}

export function stopTour() {
  if (!live) return;
  clear();
  live = null;
  document.documentElement.classList.remove('touring');
}

function clear() {
  document.querySelectorAll('[data-tour-target]').forEach((e) => e.removeAttribute('data-tour-target'));
  document.querySelector('.tour-ring')?.remove();
  document.querySelector('.tour-tip')?.remove();
  if (live?.off) live.off();
}

const showing = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

async function show() {
  if (!live) return;
  clear();
  const s = live.steps[live.i];
  live.el = null;
  if (s.go && live.go) await live.go(s.go);
  if (s.before) await s.before();
  // The place may draw a moment later.
  let el = null;
  for (let k = 0; k < 20 && s.sel; k++) {
    el = [...document.querySelectorAll(s.sel)].find((e) => showing(e) && (!s.text || e.textContent.trim() === s.text)) || null;
    if (el) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!live) return;
  const last = live.i === live.steps.length - 1;
  const tip = make('div', 'tour-tip');
  tip.setAttribute('role', 'dialog');
  tip.setAttribute('aria-label', live.title || 'A short tour');
  tip.append(make('p', 'tour-say', s.say));
  const acts = make('div', 'tour-acts');
  acts.append(make('span', 'tour-n', `${live.i + 1} of ${live.steps.length}`));
  const btns = make('span', 'tour-btns');
  // Folded (after a tap elsewhere, so what opened can be seen): the words come back here.
  const more = make('button', 'tour-more', 'Show tip');
  more.type = 'button';
  more.addEventListener('click', () => {
    tip.classList.remove('small');
    // Back to the thing it rings, if the page moved away from it.
    const el = current();
    if (el) { const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > window.innerHeight) try { el.scrollIntoView({ block: narrow() ? 'start' : 'nearest' }); } catch { /* old browser */ } }
    refit();
  });
  btns.append(more);
  const stop = make('button', 'tour-stop', 'Stop');
  stop.type = 'button';
  stop.addEventListener('click', () => stopTour());
  btns.append(stop);
  if (!(s.tap && el)) {
    const next = make('button', 'tour-next', last ? 'Done' : 'Next');
    next.type = 'button';
    next.addEventListener('click', () => advance());
    btns.append(next);
  }
  acts.append(btns);
  tip.append(acts);
  document.body.append(tip);
  if (el) {
    // A ring drawn over it (the editor redraws its own lines, so nothing is
    // added to the thing itself but a marker the tests can find).
    // On a phone the thing goes near the top, so what it opens below has room
    // and the tip can sit at the bottom, out of the way (Nov 23 2026: on his
    // phone the tip covered the lines that opened under the Bible).
    try { el.scrollIntoView({ block: narrow() ? 'start' : 'nearest' }); } catch { /* old browser */ }
    el.setAttribute('data-tour-target', '');
    const ring = make('div', 'tour-ring');
    ring.setAttribute('aria-hidden', 'true');
    document.body.append(ring);
    live.el = el;
    fit(ring, el);
    if (s.tap) {
      const on = () => setTimeout(advance, 300);
      el.addEventListener('click', on, { once: true, capture: true });
      live.off = () => el.removeEventListener('click', on, { capture: true });
    }
  }
  place(tip, el);
  tip.querySelector('.tour-next, .tour-stop')?.focus({ preventScroll: true });
}

function fit(ring, el) {
  const r = el.getBoundingClientRect();
  Object.assign(ring.style, { top: `${r.top - 4}px`, left: `${r.left - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
}

const narrow = () => window.innerWidth <= 700;

function place(tip, el) {
  const pad = 12;
  if (narrow()) {
    // A phone: the tip spans the screen at the edge away from the ringed
    // thing, never over it.
    const r = el?.getBoundingClientRect();
    const low = !!r && r.top + r.height / 2 > window.innerHeight / 2;
    tip.classList.add('dock');
    tip.classList.toggle('dock-top', low);
    tip.classList.toggle('dock-bottom', !low);
    tip.style.top = ''; tip.style.left = ''; tip.style.width = '';
    return;
  }
  const w = Math.min(320, window.innerWidth - 2 * pad);
  tip.style.width = `${w}px`;
  if (!el) { tip.classList.add('mid'); return; }
  const r = el.getBoundingClientRect();
  const h = tip.offsetHeight;
  let top = r.bottom + 10;
  if (top + h > window.innerHeight - pad) top = Math.max(pad, r.top - h - 10);
  const left = Math.min(Math.max(pad, r.left), window.innerWidth - w - pad);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

async function advance() {
  if (!live) return;
  if (live.i < live.steps.length - 1) { live.i += 1; return show(); }
  const done = live.onDone;
  stopTour();
  await done?.();
}

// A tap anywhere but the tip (opening the thing it points at, say) folds the
// tip to one small line, so nothing it shows is hidden; Show tip unfolds it.
addEventListener('pointerdown', (e) => {
  const tip = document.querySelector('.tour-tip');
  if (!live || !tip || tip.contains(e.target)) return;
  tip.classList.add('small');
  setTimeout(refit, 60); setTimeout(refit, 400);
}, true);
addEventListener('keydown', (e) => { if (live && e.key === 'Escape') { e.preventDefault(); stopTour(); } }, true);
// The page may redraw what's ringed (opening a fold does): find it again.
function current() {
  if (!live) return null;
  if (live.el?.isConnected && showing(live.el)) return live.el;
  const s = live.steps[live.i];
  if (!s?.sel || !live.el) return null;
  const el = [...document.querySelectorAll(s.sel)].find((e) => showing(e) && (!s.text || e.textContent.trim() === s.text)) || null;
  if (el) { el.setAttribute('data-tour-target', ''); live.el = el; }
  return el;
}
const refit = () => { if (!live) return; const el = current(); const r0 = document.querySelector('.tour-ring'); if (r0) r0.hidden = !el; const ring = document.querySelector('.tour-ring'); if (ring && el) fit(ring, el); const tip = document.querySelector('.tour-tip'); if (tip) place(tip, el); };
addEventListener('resize', refit);
addEventListener('scroll', refit, true);
