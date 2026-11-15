// Getting around: go() and the places you can be, back and forward.
import { media } from '../device.js';
import { getMeta, getEntry } from '../db.js';
import { closeMenu } from '../menu.js';
import { outline, entry } from '../model.js';
import { rootOf, dayId } from '../notebook.js';
import { tabFor } from '../plan.js';
import { closeWhen } from '../when.js';
import { draftHolding } from '../drafts.js';
import { inPane } from '../panes.js';
import { books, bookType, hasManuscript, bookOf, worldOf } from '../library.js';
import { isoOf, isoToday } from '../dates.js';
import { $, beside, body, box, comparer, deskPage, editor, frame, gone, grid, gridTouched, hstrip, inNotebook, loadProduction, loadStagePage, looseFoot, openBeside, pageOfPlace, panes, plan, planningView, pull, renderCrumb, renderLibrary, renderProject, renderRail, renderWorld, root, setGridTouched, sideNotes, state, store, tagsPage, talk, talkThrough, view } from '../main.js';
import { touch } from './scriptbar.js';
import { notebook } from './notebookview.js';
import { openChapter } from './manuscript.js';

// ---------- getting around ----------

// The phone opens on Today when you've been away a while (see the start).
let PHONE; // set in wireRouting()
const AWAY = 3 * 60 * 60 * 1000;
function phoneAway(now = Date.now()) {
  if (!PHONE.matches || inPane) return false;
  let at = 0;
  try { at = Number(localStorage.getItem('placeAt')) || 0; } catch { /* ignore */ }
  if (!at) return false;
  return now - at > AWAY || isoToday() !== isoOf(new Date(at));
}

// Where you are, kept per device so the app opens back there.
// Each place also goes in the browser's history, so Back and Forward (mouse
// buttons, Alt+← →, ⌘[ ]) step through where you've been.
let historyMode = 'replace';
function setHistoryMode(value) { return (historyMode = value); }
let lastPlace = null; // where you are, for the place bar (named once the crumb is drawn)
function remember(place) {
  lastPlace = place;
  if (inPane) { paneTrailAdd(place); return; }
  try { localStorage.setItem('place', JSON.stringify(place)); localStorage.setItem('placeAt', String(Date.now())); } catch { /* full */ }
  if (JSON.stringify(history.state) === JSON.stringify(place)) return;
  if (historyMode === 'push') history.pushState(place, '');
  else history.replaceState(place, '');
}

// A pane keeps its own Back and Forward: the browser's belong to the main window.
const paneTrail = { back: [], fwd: [], at: null, stepping: false };
function paneTrailAdd(place) {
  const was = paneTrail.at;
  if (was && JSON.stringify(was) !== JSON.stringify(place) && historyMode === 'push' && !paneTrail.stepping) {
    paneTrail.back.push(was);
    paneTrail.fwd = [];
  }
  paneTrail.at = place;
}
async function paneStep(dir) {
  const from = dir < 0 ? paneTrail.back : paneTrail.fwd;
  const place = from.pop();
  if (!place) return;
  if (paneTrail.at) (dir < 0 ? paneTrail.fwd : paneTrail.back).push(paneTrail.at);
  paneTrail.stepping = true;
  try { await go(place); } finally { paneTrail.stepping = false; }
}

// Shift + Enter in Go, or a middle-click on something that takes you
// somewhere: the next place opens beside instead.
let besideUntil = 0;
function setBesideUntil(value) { return (besideUntil = value); }

async function go(place) {
  if (besideUntil > Date.now()) { besideUntil = 0; return openBeside(place); }
  // A menu left open belongs to the place you're leaving.
  closeMenu();
  closeWhen();
  if (hstrip?.isOpen) hstrip.close({ stay: true });
  // Somewhere that has since gone to the Trash (Back can lead there): go nearby instead.
  if (place.view === 'write' && place.chapterId && gone(await getEntry(place.chapterId))) place = { view: 'library' };
  // Posting moved from Make to Deliver: an old place with its tab goes there.
  if (place.view === 'production' && ['files', 'share', 'post'].includes(place.tab)) place = { ...place, view: 'deliver' };
  if (place.view === 'project' && gone(await getEntry(place.id))) place = { view: 'library' };
  // A book saved as a place before worlds: if it became a world, show that.
  if (place.view === 'project' && (await getEntry(place.id))?.kind === 'world') place = { view: 'world', id: place.id };
  if (place.view === 'world' && gone(await getEntry(place.id))) place = { view: 'library' };
  if (place.view === 'grid' && gone(await getEntry(place.id))) place = { view: 'library' };
  if (place.view === 'production' && gone(await getEntry(place.id))) place = { view: 'library' };
  if (place.view === 'compare' && gone(await getEntry(place.id))) place = { view: 'library' };
  if ((place.view === 'stage' || place.view === 'deliver') && gone(await getEntry(place.id))) place = { view: 'library' };
  // A chapter of a kept draft reads beside the draft you're writing, rather than opening to write in.
  if (place.view === 'write' && place.chapterId) {
    const ch = await getEntry(place.chapterId);
    const kept = ch?.kind === 'chapter' && (await draftHolding(ch));
    if (kept) place = { view: 'compare', id: kept.parent_id, a: { type: 'draft', id: kept.id }, b: { type: 'now' }, focus: ch.id };
  }
  if (place.view === 'notebook' && place.pageId && !place.pageId.startsWith('day-') && gone(await getEntry(place.pageId))) place = { view: 'notebook', pageId: dayId(isoToday()) };
  if (place.view === 'notebook' && !place.pageId && notebook.page && !notebook.isDay && gone(await getEntry(notebook.page.id))) place = { view: 'notebook', pageId: dayId(isoToday()) };
  // Today's plan on its own, and the notes of the draft next door, only live
  // beside something: in the main window they'd be the day's page.
  if (!inPane && ((place.view === 'plan' && place.tab === 'day') || place.view === 'sidenotes' || place.view === 'talk')) place = { view: 'notebook', pageId: dayId(isoToday()) };
  const from = view();
  // Switch at once so the next keystroke lands in the right place; saving catches up.
  if (from === 'write' && place.view !== 'write') store.close(editor.state.doc);
  // The grid reads the manuscript as saved, so the last words go first.
  if (['grid', 'production', 'deliver', 'compare', 'stage'].includes(place.view)) await store.close(editor.state.doc);
  if (place.view !== 'write') { if (beside.isOpen) beside.close(); if (talk.isOpen) talk.close(); }
  if (from === 'notebook' && place.view !== 'notebook') notebook.close();
  frame.turn(from, place.view, pageOfPlace(place), place.view === 'desk' ? place.tab || 'stage' : place.view === 'plan' ? place.tab || 'week' : null);
  if (place.view === 'write') delete root.dataset.view;
  else root.dataset.view = place.view;
  // Which project, in the same breath as the view: anything that looks in
  // between (the rail, the project page's Desk data) must see both.
  if (place.view === 'world') state.worldId = place.id;
  body.classList.remove('show-outline');
  // Notes beside the text belong to a draft: elsewhere the button stays in its
  // place, dimmed.
  const notesBtn = $('#notes-toggle');
  notesBtn.disabled = place.view !== 'write';
  notesBtn.title = notesBtn.disabled ? 'Notes beside the text: open a draft to use them' : 'Notes beside the text (⌘2)';

  if (place.view === 'write') {
    // On a phone, arriving leaves the keyboard down (and the bar at the bottom
    // up): the cursor goes in when you tap into the text.
    if (!touch.matches) editor.commands.focus();
    const id = place.chapterId || state.chapterId || (await lastChapterAnywhere());
    if (!id) return go({ view: 'library' });
    // Back from the grid after it changed things: read the chapter afresh.
    if (gridTouched && id === state.chapterId) state.chapterId = null;
    setGridTouched(false);
    if (id !== state.chapterId) await openChapter(id);
    else remember({ view: 'write', chapterId: id });
    if (place.focus) focusParagraph(place.focus);
  } else if (place.view === 'notebook') {
    if (!touch.matches) notebook.editor.commands.focus();
    const id = place.pageId;
    if (id && id !== notebook.page?.id) {
      const fallback = id.startsWith('day-') ? entry('day', { id, title: id.slice(4) }) : null;
      await notebook.open(id, fallback, place.line);
    } else if (!notebook.page) await notebook.openDay();
    else {
      if (place.line) notebook.focusLine(place.line);
      remember({ view: 'notebook', pageId: notebook.page.id });
      // Back on a page that stayed open: its count may have been put away
      // meanwhile, and its plan may have changed in Plan or Calendar.
      looseFoot();
      plan?.showDay(notebook.page);
    }
    if ((place.zoom || null) !== notebook.zoom) {
      const mode = historyMode;
      historyMode = 'replace';
      notebook.zoomTo(place.zoom || null);
      historyMode = mode;
    }
  } else if (place.view === 'library') {
    if ('area' in place) state.libArea = place.area;
    remember({ view: 'library', area: state.libArea });
    await renderLibrary();
  } else if (place.view === 'project') {
    state.bookId = place.id;
    remember(place);
    await renderProject();
  } else if (place.view === 'world') {
    state.worldId = place.id;
    remember(place);
    await renderWorld();
  } else if (place.view === 'tags') {
    remember(place);
    await tagsPage?.show(place);
  } else if (place.view === 'plan') {
    // What's when is Plan now; Day, Week, Weeks ahead and Pace are zooms of Calendar.
    remember({ view: 'plan', tab: tabFor(place.tab), ...(place.week ? { week: place.week } : {}) });
    await plan?.showPage(place);
  } else if (place.view === 'sidenotes') {
    remember({ view: 'sidenotes' });
    await sideNotes.show();
  } else if (place.view === 'talk') {
    remember({ view: 'talk' });
    await talkThrough.show();
  } else if (place.view === 'desk') {
    remember({ view: 'desk', ...(place.tab === 'history' ? { tab: 'history' } : {}) });
    await deskPage?.show(place);
  } else if (place.view === 'grid') {
    state.gridId = place.id;
    remember(place);
    await grid.show(place.id);
  } else if (place.view === 'production' || place.view === 'deliver') {
    state.prodId = place.id;
    remember({ view: place.view, id: place.id });
    await (await loadProduction()).show(place.id, { ...place, mode: place.view === 'deliver' ? 'deliver' : 'make' });
  } else if (place.view === 'stage' || place.view === 'drawer') {
    state.stage = place;
    remember(place);
    await (await loadStagePage()).show(place);
  } else if (place.view === 'compare') {
    state.compareId = place.id;
    await comparer.show(place.id, place);
    remember(comparer.place);
  }
  renderCrumb();
  renderRail();
  // Notes beside follow the main window.
  if (!inPane) panes?.mainMoved(lastPlace);
  // The project pane stays with the planning views (and comes back with them).
  pull?.setShown(planningView());
  if (place.view === 'world' && place.id) { try { localStorage.setItem('lastWorld', place.id); } catch { /* full */ } }
}

async function openBook(projectId) {
  const book = await getEntry(projectId);
  if (book && bookType(book) === 'lines') return go({ view: 'notebook', pageId: book.id });
  if (!book || !hasManuscript(book)) return go({ view: 'project', id: projectId });
  const acts = await outline(projectId);
  const chapters = acts.flatMap((a) => a.chapters);
  const last = await getMeta(`lastChapter:${projectId}`);
  const id = chapters.some((c) => c.id === last) ? last : chapters[0]?.id;
  if (id) return go({ view: 'write', chapterId: id });
  return go({ view: 'project', id: projectId });
}

async function lastChapterAnywhere() {
  const last = await getMeta('lastChapter');
  const ch = last && (await getEntry(last));
  if (!gone(ch)) {
    const book = await bookOf(ch);
    if (!gone(book)) return ch.id;
  }
  const novels = (await books()).filter(hasManuscript).sort((a, b) => a.created_at - b.created_at);
  for (const b of novels) {
    const first = (await outline(b.id)).flatMap((a) => a.chapters)[0];
    if (first) return first.id;
  }
  return null;
}

function focusParagraph(eid) {
  editor.state.doc.forEach((node, pos) => {
    if (node.attrs.eid === eid) { editor.commands.setTextSelection(pos + node.nodeSize - 1); editor.view.nodeDOM(pos)?.scrollIntoView({ block: 'center' }); }
  });
}

// Follow a link: pages and days open in the notebook, chapters in the
// manuscript, books on their home page, and a single line or paragraph opens
// where it lives.
async function openEntry(id) {
  const place = await placeOf(id);
  if (place) return go(place);
}
// Where following a link to `id` leads (null: nowhere to go).
async function placeOf(id) {
  const row = await getEntry(id);
  // A link to a day that hasn't been written on yet still opens that day.
  if (!row && id?.startsWith('day-')) return { view: 'notebook', pageId: id };
  if (gone(row)) return null;
  if (row.kind === 'project') return { view: 'project', id: row.id };
  if (row.kind === 'world') return { view: 'world', id: row.id };
  if (row.kind === 'area') return { view: 'library', area: row.id };
  if (row.kind === 'shootday') return { view: 'production', id: row.parent_id, day: row.id };
  if (row.kind === 'shot') { const piece = row.fields?.piece || (await bookOf(row))?.id; if (piece) return { view: 'production', id: piece, tab: 'shots', shot: row.id }; }
  const home = await rootOf(row);
  if (!home) return null;
  const focus = home.id === row.id ? null : row.id;
  if (home.kind === 'day' || home.kind === 'page') return { view: 'notebook', pageId: home.id, line: focus };
  if (home.kind === 'project') return focus ? { view: 'notebook', pageId: home.id, line: focus } : { view: 'project', id: home.id };
  if (home.kind === 'chapter') return { view: 'write', chapterId: home.id, focus };
  return null;
}

// A new page goes in the bible of the world you're in (or the piece whose page is open).
async function newPageHere() {
  let parent = null;
  if (view() === 'project') parent = state.bookId;
  else if (view() === 'world') parent = state.worldId;
  else if (view() === 'write') parent = (state.project && (await worldOf(state.project))?.id) || state.project?.id || null;
  else if (inNotebook() && notebook.page && !notebook.isDay) {
    const p = notebook.page;
    const up = p.parent_id ? await getEntry(p.parent_id) : null;
    parent = p.kind === 'project' ? p.id : up && !gone(up) ? up.id : null;
  }
  if (!inNotebook()) await go({ view: 'notebook' });
  await notebook.newPage(parent);
}

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireRouting() {
  PHONE = media('phone');
  // The app left open in the background counts too: it comes back on Today.
  if (!inPane) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { try { localStorage.setItem('placeAt', String(Date.now())); } catch { /* full */ } return; }
      if (!root.dataset.started || !phoneAway() || document.querySelector('dialog[open], .ask-backdrop')) return;
      if (lastPlace?.view === 'notebook' && lastPlace.pageId === dayId(isoToday())) return;
      go({ view: 'notebook', pageId: dayId(isoToday()) });
    });
  }
  window.addEventListener('popstate', async (e) => {
    // Back on a phone while All commands is open: back to the short box.
    if (box?.popped()) return;
    if (!e.state?.view) return;
    historyMode = 'replace';
    try { await go(e.state); } finally { historyMode = 'push'; }
  });
}

export { besideUntil, go, historyMode, lastChapterAnywhere, lastPlace, newPageHere, openBook, openEntry, paneStep, phoneAway, placeOf, remember, setBesideUntil, setHistoryMode, wireRouting };
