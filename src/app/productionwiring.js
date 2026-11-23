// Production: shots, the kit, shoot days, posting (the room loads on demand).
import { getEntry } from '../db.js';
import { popMenu, menuButton, ask, askText, toast } from '../menu.js';
import { linkFor } from '../sharelink.js';
import { hasManuscript, bookOf, worldOf, worldStats } from '../library.js';
import { addCommands, mod } from './commandlist.js';
import { $, inNotebook, state, view } from '../main.js';
import { notebook } from './notebookview.js';
import { go, openBook, remember } from './routing.js';
import { toggleNumbering } from './manuscript.js';
import { renderRail, renderCrumb } from './rail.js';
import { grid } from './libraryview.js';
import { openShare, sharing } from './sharing.js';
import { filesOut } from './workpages.js';
import { askServer, canAskServer } from './talking.js';

// ---------- production: shots, the kit, shoot days, posting ----------

// The Make and Deliver rooms load the first time one opens (prodview.js is
// big and most days don't need it); warmRooms() in app/sharing.js fetches
// it once the app has started, so it's there offline too.
let production = null;
async function loadProduction() {
  if (!production) {
    const { ProductionView } = await import('../prodview.js');
    production ||= new ProductionView($('#prod-view'), productionHooks);
    window.__production = production;
  }
  return production;
}
const productionHooks = {
  open: (r) => grid.hooks.open(r),
  openPage: (id) => go({ view: 'notebook', pageId: id }),
  go: (place) => go(place),
  leave: (piece) => openBook(piece.id),
  changed(rows) { if (rows.some((r) => r && ['project', 'world', 'page'].includes(r.kind))) renderRail(); },
  menu: (anchor, items) => popMenu(anchor, items),
  menuButton: (items, label) => menuButton(items, label),
  ask, askText, toast,
  askServer: (body) => askServer(body),
  canAsk: () => canAskServer(),
  numberScenes: async (piece) => { await toggleNumbering(piece); await production?.refresh(); },
  base: () => location.origin + location.pathname,
  files: (kind, piece) => filesOut(kind, piece),
  share: (piece) => openShare(piece),
  shareOf: async (piece) => { const sh = await sharing.current(piece); return sh ? { url: linkFor(sh.fields.token), comments: !!sh.fields.comments } : null; },
  moved: (place) => { remember(place); renderCrumb(); }
};

// The piece production is for, from where you are.
async function productionOwner() {
  if (view() === 'production' || view() === 'deliver') return state.prodId;
  if (view() === 'stage' && state.stage) { const g = await getEntry(state.stage.id); if (g?.kind === 'project') return g.id; if (g?.kind === 'world') return (await worldStats(g)).pieces.find((p) => hasManuscript(p.row))?.row.id || null; }
  if (view() === 'grid') { const g = await getEntry(state.gridId); return g?.kind === 'project' ? g.id : null; }
  if (view() === 'write') return state.project?.id || null;
  if (view() === 'project') return state.bookId;
  if (view() === 'world') { const w = await getEntry(state.worldId); return (await worldStats(w)).pieces.find((p) => hasManuscript(p.row))?.row.id || null; }
  return null;
}

// Ctrl+Shift+S: production, and back to the text.
async function toggleProduction() {
  if (view() === 'production') { const p = await getEntry(state.prodId); return p ? openBook(p.id) : go({ view: 'library' }); }
  const id = await productionOwner();
  if (!id) { toast('Open a script or draft to see its production'); return; }
  return go({ view: 'production', id });
}

// What the grid is for, from where you are: the piece you're writing or
// looking at, or the world.
async function gridOwner() {
  if (view() === 'write') return state.project?.id || null;
  if (view() === 'project') return state.bookId;
  if (view() === 'world') return state.worldId;
  if (view() === 'grid') return state.gridId;
  if (view() === 'stage' && state.stage) return state.stage.id;
  if (view() === 'production' || view() === 'deliver') return state.prodId;
  if (inNotebook() && notebook.page && !notebook.isDay) return (await bookOf(notebook.page))?.id || (await worldOf(notebook.page))?.id || null;
  return null;
}

// Ctrl+Shift+G: the grid, and back to the text.
async function toggleGrid() {
  if (view() === 'grid') { const g = await getEntry(state.gridId); return grid.hooks.leave(g); }
  const id = await gridOwner();
  if (!id) { toast('Open a piece or a world to see its plot grid'); return; }
  return go({ view: 'grid', id });
}

// Its commands in the box (Ctrl + K); commandinfo.js has their hints and words.
addCommands(() => [
  { group: 'view', label: 'Plot grid (the story as a table)', keys: `${mod}⇧G`, run: toggleGrid, when: () => view() !== 'grid' && view() !== 'library' },
  { group: 'view', label: 'Back to the text from the grid', keys: `${mod}⇧G`, run: toggleGrid, when: () => view() === 'grid' },
  { group: 'view', label: 'Production (shots, cast and places, shoot days, posting)', keys: `${mod}⇧S`, run: toggleProduction, when: () => view() !== 'production' && view() !== 'library' },
  { group: 'view', label: 'Back to the text from production', keys: `${mod}⇧S`, run: toggleProduction, when: () => view() === 'production' }
]);

export { loadProduction, production, productionOwner, toggleGrid, toggleProduction };
