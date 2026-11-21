// The top of a piece (Michael, Nov 20 2026: "it's important that we have
// those views accessible"): Write · Grid (Outline joins in Part 2) in the top
// bar whenever a script or novel is open, the same place on Windows and
// Android, and in a Woven script's Write the Plan button, which opens or
// folds the plan under every scene (Ctrl + Shift + Comma).
//
// And the bars step aside while reading: in Write, scrolling down slides the
// top bar (and the ruler) out of the way; scrolling up a little, reaching the
// top of the page, or the mouse at the top edge brings them back. Scrolls
// the page makes itself (keeping a line still) don't count.
import { make } from '../dom.js';
import { getEntry } from '../db.js';
import { hasManuscript } from '../library.js';
import { body, isWoven, root, state, view } from '../main.js';
import { toggleGrid } from './productionwiring.js';
import { scenePlan } from './manuscript.js';

let box = null;
let write = null;
let grid = null;
let plan = null;

function build() {
  box = make('span', 'pv-switch');
  const seg = make('span', 'pv-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'View');
  write = make('button', '', 'Write');
  write.type = 'button';
  write.title = 'The text';
  write.addEventListener('click', () => { if (view() === 'grid') toggleGrid(); });
  grid = make('button', '', 'Grid');
  grid.type = 'button';
  grid.title = 'The plot grid: scenes down, threads across (Ctrl + Shift + G)';
  grid.addEventListener('click', () => { if (view() !== 'grid') toggleGrid(); });
  seg.append(write, grid);
  plan = make('button', 'pv-plan', 'Plan');
  plan.type = 'button';
  plan.title = 'The plan under every scene: open or fold them all (Ctrl + Shift + Comma)';
  plan.addEventListener('click', () => scenePlan?.toggleAll());
  box.append(seg, plan);
}

// Where it goes: right before the glass (Go), Aa and ⋯.
export async function syncPieceSwitch() {
  if (!box) build();
  const v = view();
  let piece = null;
  if (v === 'write') piece = state.project;
  else if (v === 'grid' && state.gridId) piece = await getEntry(state.gridId);
  const on = !!piece && piece.kind === 'project' && hasManuscript(piece);
  const glass = document.querySelector('.topbar .zm-go');
  if (on && glass && box.nextElementSibling !== glass) glass.before(box);
  box.hidden = !on;
  document.querySelector('.topbar')?.classList.toggle('has-switch', on);
  if (!on) return;
  write.setAttribute('aria-pressed', String(v === 'write'));
  grid.setAttribute('aria-pressed', String(v === 'grid'));
  plan.hidden = !(v === 'write' && isWoven());
  plan.setAttribute('aria-pressed', String(!!scenePlan?.all));
}

// ---------- stepping aside while reading ----------

let last = 0;
let calmUntil = 0;
const reading = () => !root.dataset.view && body.classList.contains('in-piece');
function away(on) { body.classList.toggle('scroll-away', on); }

export function wirePieceSwitch() {
  document.addEventListener('inkwell:plan-all', () => syncPieceSwitch());
  document.addEventListener('inkwell:calm-scroll', () => { calmUntil = performance.now() + 250; });
  last = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    // The page moving itself: not reading.
    if (performance.now() < calmUntil || !reading()) { last = y; if (!reading()) away(false); return; }
    // Scrolling back up (or reaching the top) brings everything back, after typing too.
    if (y <= 4 || y < last - 6) { away(false); if (!body.classList.contains('kb-up')) body.classList.remove('typing'); }
    // Going down while typing is the caret pulling the page along.
    else if (body.classList.contains('typing')) { last = y; return; }
    else if (y > last + 6 && y > 48) away(true);
    else return;
    last = y;
  }, { passive: true });
  document.addEventListener('mousemove', (e) => {
    if (body.classList.contains('scroll-away') && !e.sourceCapabilities?.firesTouchEvents && e.clientY < 56) away(false);
  });
  // A new place starts with everything showing.
  new MutationObserver(() => { if (!reading()) away(false); }).observe(root, { attributes: true, attributeFilter: ['data-view'] });
}
