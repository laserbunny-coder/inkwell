// Pulling lines in from a project beside a planning view, side by side, and
// dropping a line dragged from another window.
import { getEntry, byKind } from '../db.js';
import { ask, toast } from '../menu.js';
import { entry } from '../model.js';
import { dropLineAt, setLineDragOut } from '../outline.js';
import { moveEntries } from '../move.js';
import { SAVE_CHANNEL } from '../inbox.js';
import { LISTS, listOf, setList, fillList } from '../lists.js';
import { tabFor } from '../plan.js';
import { Pull } from '../pull.js';
import { loadTasks } from '../tasks.js';
import { inPane, PANE_ID, PaneHost, host as paneHost, BESIDE_PLACES } from '../panes.js';
import { SideNotes } from '../sidenotes.js';
import { Talk } from '../talk.js';
import { forgetCalendar } from '../calendar.js';
import { areas, areaColor, worldOf } from '../library.js';
import { addCommands, mod } from './commandlist.js';
import { $, blocks, editor, gone, inNotebook, notes, root, state, store, view } from '../main.js';
import { touch } from './scriptbar.js';
import { currentEditor, notebook } from './notebookview.js';
import { go, lastPlace, paneStep, placeOf, setBesideUntil } from './routing.js';
import { applyRemote, sync } from './syncwiring.js';
import { renderCrumb } from './rail.js';
import { projectOrder, railProjects } from './workpages.js';
import { writing } from './commands.js';
import { askServer, canAskServer, deskBackend, deskPage, landShares, plan } from './talking.js';
let pull = null; // a project's lines next to the plan, to drag in (pull.js, below)

// ---------- pulling lines in from a project, beside a planning view ----------

// Today (a day's page with its plan), Plan, and Calendar's Week and Six weeks.
function planningView() {
  if (view() === 'plan') return ['plan', 'week', 'ahead', 'day'].includes(tabFor(lastPlace?.tab));
  return inNotebook() && !!notebook.page && notebook.isDay && !notebook.zoom;
}
async function pullFromProject(id = null) {
  if (!pull) return;
  if (!planningView()) await go({ view: 'plan', tab: 'plan' });
  if (pull.isOpen && !id) pull.close(); else await pull.start(id);
}
// Ctrl + click on a project in the rail: beside the plan in a planning view
// (to drag from), in a pane beside anything else.
async function openProjectBeside(id) {
  if (planningView()) return pullFromProject(id);
  if (paneHost()) return openBeside({ view: 'world', id });
  return pullFromProject(id);
}
// The lines a When is for, in the outline: the ones the selection touches.
function selectedLineIds() {
  const ed = notebook.editor;
  const { from, to, empty } = ed.state.selection;
  if (empty) { const one = notebook.currentLine(); return one ? [one] : []; }
  const out = [];
  ed.state.doc.nodesBetween(from, to, (n) => { if (n.type.name === 'listItem' && n.attrs.eid) out.push(n.attrs.eid); return true; });
  return out.length ? [...new Set(out)] : [notebook.currentLine()].filter(Boolean);
}
// Alt + W: When for what's under the keyboard (tasks picked in a plan, lines
// picked in the project pane, or the line or lines in the outline).
async function whenHere() {
  if (plan.whenKey()) return true;
  if (pull?.isOpen && pull.picked.size) { plan.pickWhenFor([...pull.picked], { anchor: pull.pickWhen }); return true; }
  if (inNotebook() && notebook.page) {
    const ids = selectedLineIds();
    if (!ids.length) return false;
    await notebook.store.flush(notebook.editor.state.doc);
    let at = null;
    try { const c = notebook.editor.view.coordsAtPos(notebook.editor.state.selection.head); at = { left: c.left, top: c.bottom }; } catch { /* not drawn */ }
    await plan.pickWhenFor(ids, { at });
    return true;
  }
  return false;
}

// Google Calendar, connected from Inkwell itself.
async function connectCalendar() {
  const b = sync.backend;
  if (!b?.connectCalendar || !sync.user) { toast('Sign in first (Ctrl + K, “Sign in”), then connect your calendar.'); return; }
  let has = null;
  try { has = await b.hasCalendar(); } catch {}
  const yes = await ask(has
    ? { title: 'Your Google Calendar is connected', body: 'Its events show on Today and the week. Connect again if they stopped showing, or to use another Google account.', ok: 'Connect again' }
    : { title: 'Connect your Google Calendar', body: 'Your events show on Today and the week, and “left today” counts them. Inkwell only reads your calendar and never changes it. Google asks you to allow this.', ok: 'Connect' });
  if (yes) b.connectCalendar();
}

// The number beside Desk keeps up without the Desk being open.
let deskPeeked = 0;
const peekDesk = () => { if (inPane || document.hidden || Date.now() - deskPeeked < 120000) return; deskPeeked = Date.now(); deskPage.peek(); };
// Watch and read lists: once typing pauses, Claude links the titles you've
// moved on from (never the line you're on).
let listTimer;
function listSoon(ms = 4000) {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => {
    if (!inNotebook() || !listOf(notebook.page)) return;
    fillList(notebook.page, { ask: askServer, canAsk: canAskServer, onRows: (rows) => applyRemote(rows), skip: notebook.editor.isFocused ? notebook.currentLine() : null });
  }, ms);
}
async function makeList(list) {
  if (!notebook.page) return;
  await notebook.close();
  const page = await setList(notebook.page.id, list);
  if (!page) return;
  notebook.page = notebook.store.page = page;
  toast(list ? `Claude will link each title on this ${LISTS[list].toLowerCase()}` : 'Claude won’t link titles on this page');
  listSoon(500);
}

// ---------- side by side ----------

// Other places open in panes beside the main view (panes.js). The main window
// keeps them; a pane asks it.
let panes; // set in wireBeside()

// Beside (Ctrl + \): with nothing beside, today's plan opens there; otherwise
// what's beside is put away, or brought back. From a pane it's the same.
function toggleBesidePane() {
  const h = paneHost();
  if (!h) return;
  if (h.hooks.isOff()) { toast('Beside is switched off (Look → Beside)'); return; }
  if (!inPane && root.classList.contains('focus') && !h.sheet) { toast('Focus is only the words. Leave it (⌘.) to see what’s beside.'); return; }
  if (!h.toggle()) openBeside(BESIDE_PLACES.plan);
}
function syncBeside() {
  const b = $('#beside-toggle');
  if (!b || !panes) return;
  b.setAttribute('aria-pressed', String(panes.showing));
  b.title = panes.count ? (panes.showing ? 'Put away what’s beside (⌘\\)' : 'Bring back what’s beside (⌘\\)') : 'Beside: today’s plan, notes or another page next to this one (⌘\\)';
}
// Talk it through (Alt + T): Claude beside where you are, about the project
// you're in, or everything on stage from anywhere else.
function openTalk() {
  const h = paneHost();
  if (!h) return;
  if (h.hooks.isOff()) { toast('Beside is switched off (Look → Beside)'); return; }
  if (inPane) { go(BESIDE_PLACES.claude); return; }
  if (root.classList.contains('focus') && !h.sheet) { toast('Focus is only the words. Leave it (⌘.) to talk it through.'); return; }
  openBeside(BESIDE_PLACES.claude, { focus: true });
}
// The project a place belongs to, if any: { id, title }.
async function projectOfPlace(place) {
  const id = !place ? null
    : place.view === 'write' ? place.chapterId
      : place.view === 'notebook' ? (place.pageId && !place.pageId.startsWith('day-') ? place.pageId : null)
        : ['world', 'stage', 'project', 'grid', 'production', 'deliver'].includes(place.view) ? place.id : null;
  const row = id ? await getEntry(id) : null;
  const w = row && !gone(row) ? await worldOf(row) : null;
  return w && !gone(w) ? { id: w.id, title: w.title || 'Untitled' } : null;
}
// From a pane: somewhere opens in the main window, and the pane stays as it is.
async function openInMain(id) {
  const place = await placeOf(id);
  if (place) await paneHost()?.hooks.goMain(place);
}
// The notes of the draft in the main window, listed beside (sidenotes.js).
let sideNotes; // set in wireBeside()

// Talk it through (talk.js), in the Beside pane.
let talkThrough; // set in wireBeside()

async function openBeside(place, opts = {}) {
  if (!place?.view) return;
  // Beside a planning view, a project or a page opens where its lines can be dragged onto the plan.
  if (!inPane && pull && planningView()) {
    if (place.view === 'world' && place.id) return pullFromProject(place.id);
    if (place.view === 'notebook' && place.pageId && !place.pageId.startsWith('day-') && !place.zoom && !place.line) return pullFromProject(place.pageId);
  }
  const h = paneHost();
  if (!h) return;
  await h.open(place, { from: inPane ? PANE_ID : null, ...opts });
}
async function openEntryBeside(id) { await openBeside(await placeOf(id)); }

// "Open beside" in a handle menu (Peek beside on a phone).
function besideItem(place) {
  if (!paneHost()) return null;
  return touch.matches
    ? { label: 'Peek beside', run: () => openBeside(place()) }
    : { label: 'Open beside', keys: 'Middle-click', run: () => openBeside(place()) };
}
// "Move to <a page open beside>", one for each pane showing a page, day or chapter.
function paneMoves(ids, here) {
  const roots = (paneHost()?.roots() || []).filter((r) => r.id !== here && !(inPane && r.pane === PANE_ID));
  // The main window counts too, from a pane.
  if (inPane && lastMainRoot() && lastMainRoot().id !== here) roots.unshift(lastMainRoot());
  const seen = new Set();
  return roots.filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, 3).map((r) => ({
    label: `Move to ${r.title}`,
    run: async () => {
      const fallback = r.id.startsWith('day-') ? entry('day', { id: r.id, title: r.id.slice(4) }) : null;
      const n = await moveEntries(ids, r.id, { fallback });
      if (n) toast(`Moved to ${r.title}`);
    }
  }));
}
// From a pane: the page or chapter open in the main window.
function lastMainRoot() {
  try {
    const main = window.parent;
    const pl = main.__panes?.hooks.mainPlace();
    const id = pl?.view === 'notebook' ? pl.pageId : pl?.view === 'write' ? pl.chapterId : null;
    if (!id) return null;
    const title = main.document.querySelector('#crumb .here')?.textContent || 'the main view';
    return { id, title };
  } catch { return null; }
}

// Ctrl + Alt + → / ←: the next or previous pane (the main view counts).
// Ctrl + Alt + W closes the pane you're in; Ctrl + Alt + Enter makes it the main view.
function paneKeys(e, m) {
  const h = paneHost();
  if (inPane && e.altKey && !m && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest?.('input, textarea, [contenteditable="true"]')) {
    e.preventDefault();
    paneStep(e.key === 'ArrowLeft' ? -1 : 1);
    return true;
  }
  if (!h || !m || !e.altKey || e.shiftKey) return false;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    if (!h.count) return false;
    e.preventDefault();
    if (inPane) h.focused(PANE_ID); else h.focused('');
    h.cycle(e.key === 'ArrowRight' ? 1 : -1);
    return true;
  }
  if (e.code === 'KeyW' && h.count) {
    e.preventDefault();
    if (inPane) h.close(PANE_ID); else toast('Click into a pane to close it (or its ×)');
    return true;
  }
  if (e.key === 'Enter' && inPane) { e.preventDefault(); h.swap(PANE_ID); return true; }
  return false;
}

// Middle-click opens it beside, the way a browser opens a link in a new tab:
// a line's or paragraph's six dots, a [[link]], a #tag, a card in the Library
// or a world, a chapter in the outline, a part of the path, a row or chip in the box.
const BESIDE = 'a[data-ref], .line-gutter, .block-handle, .tag[data-tag], [data-id], .tree-chapter, .crumb-part, #palette-list > li:not(.box-chips), #palette-list .box-chip, .past-list [data-line]';
const besideTarget = (e) => (e.button === 1 && paneHost() ? e.target.closest?.(BESIDE) : null);
async function middleBeside(el) {
  if (el.matches('a[data-ref]')) return openEntryBeside(el.getAttribute('data-ref'));
  if (el.matches('.line-gutter')) {
    const eid = el.dataset.eid;
    if (eid && notebook.page) return openBeside({ view: 'notebook', pageId: notebook.page.id, zoom: eid });
    return;
  }
  if (el.matches('.block-handle')) {
    const eid = editor.view.dom.children[blocks.index]?.getAttribute('data-eid');
    if (state.chapterId) return openBeside({ view: 'write', chapterId: state.chapterId, ...(eid ? { focus: eid } : {}) });
    return;
  }
  if (el.matches('.tag[data-tag]')) return openBeside({ view: 'tags', tag: el.dataset.tag });
  if (el.matches('.past-list [data-line]')) return openBeside({ view: 'notebook', pageId: el.dataset.day, line: el.dataset.line });
  if (el.dataset.id && (await placeOf(el.dataset.id))) return openEntryBeside(el.dataset.id);
  // Anything else that takes you somewhere: where its click would go.
  setBesideUntil(Date.now() + 1500);
  el.click();
}

// ---------- dropping a line dragged from another window ----------

// The spot under (x, y) in this window: a line on the page open here, or a
// paragraph in the chapter open here.
function dropSpotAt(x, y) {
  if (inNotebook() && notebook.page) {
    const dom = notebook.editor.view.dom;
    let li = document.elementFromPoint(x, y)?.closest?.('li');
    if (li && !dom.contains(li)) li = null;
    let after = true;
    const box = dom.getBoundingClientRect();
    if (!li) {
      // Beside or below the lines: at the end of the page (or zoomed line).
      if (x < box.left - 80 || x > box.right + 80 || y < box.top) return null;
      const shown = [...dom.querySelectorAll('li')].filter((l) => l.getClientRects().length && !l.classList.contains('zoom-root') && !l.classList.contains('zoom-path'));
      li = shown.filter((l) => !l.parentElement.closest('li') || l.parentElement.closest('li').classList.contains('zoom-root')).at(-1) || shown.at(-1);
      if (!li) return null;
    } else {
      const r = (li.querySelector(':scope > p') || li).getBoundingClientRect();
      after = y > r.top + r.height / 2;
    }
    const eid = li.querySelector(':scope > .line-gutter')?.dataset.eid;
    if (!eid) return null;
    let top = li;
    while (top.parentElement?.closest('li') && dom.contains(top.parentElement.closest('li'))) top = top.parentElement.closest('li');
    const r = (li.querySelector(':scope > p') || li).getBoundingClientRect();
    return { kind: 'line', rootId: notebook.page.id, eid, after, top: top.querySelector(':scope > .line-gutter')?.dataset.eid || eid, mark: { left: r.left, width: r.width, top: after ? r.bottom : r.top } };
  }
  if (writing() && state.chapterId) {
    const dom = editor.view.dom;
    let el = document.elementFromPoint(x, y);
    while (el && el.parentElement !== dom) el = el.parentElement;
    if (!el) {
      const box = dom.getBoundingClientRect();
      if (x < box.left - 80 || x > box.right + 80 || y < box.bottom) return null;
      el = dom.lastElementChild;
      if (!el) return null;
    }
    const r = el.getBoundingClientRect();
    const after = y > r.top + r.height / 2 || !el.previousElementSibling;
    const prev = after ? el : el.previousElementSibling;
    const pr = prev.getBoundingClientRect();
    return { kind: 'para', rootId: state.chapterId, after: prev.getAttribute('data-eid'), mark: { left: pr.left, width: pr.width, top: pr.bottom } };
  }
  return null;
}
let dropMark = null;
function showDrop(spot) {
  if (!spot) { dropMark?.remove(); dropMark = null; return false; }
  if (!dropMark) { dropMark = document.createElement('div'); dropMark.className = 'line-drop'; document.body.append(dropMark); }
  Object.assign(dropMark.style, { left: `${spot.mark.left}px`, width: `${spot.mark.width}px`, top: `${spot.mark.top - 1}px` });
  return true;
}
// Alt + drop: a link to the line, where it was dropped.
async function addLinkAt(eid, spot) {
  showDrop(null);
  const row = await getEntry(eid);
  if (!row || gone(row)) return false;
  const title = (row.text || row.title || 'Untitled').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
  const ed = spot.kind === 'line' ? notebook.editor : editor;
  const s = ed.schema.nodes;
  const ref = s.entryRef.create({ id: eid, title });
  let at = -1;
  let size = 0;
  ed.state.doc.descendants((n, pos) => {
    if (at >= 0) return false;
    const match = spot.kind === 'line' ? n.type.name === 'listItem' && n.attrs.eid === spot.eid : n.attrs?.eid === spot.after && n.isBlock;
    if (match) { at = pos; size = n.nodeSize; }
    return at < 0;
  });
  if (at < 0) return false;
  const node = spot.kind === 'line' ? s.listItem.create(null, s.paragraph.create(null, ref)) : s.paragraph.create(null, ref);
  const to = spot.kind === 'line' && !spot.after ? at : at + size;
  ed.view.dispatch(ed.state.tr.insert(to, node));
  ed.commands.focus();
  return true;
}
// The window it was dragged from moves it (so its own editor lets go of it).
async function moveOutTo(eid, spot) {
  const row = await getEntry(eid);
  if (!row || gone(row)) return false;
  const here = inNotebook() ? notebook.page?.id : state.chapterId;
  // The same page in both windows: the one it was dropped in moves it there.
  if (here === spot.rootId) return true;
  const fallback = spot.rootId.startsWith('day-') ? entry('day', { id: spot.rootId, title: spot.rootId.slice(4) }) : null;
  const n = await moveEntries([eid], spot.rootId, { after: spot.kind === 'line' ? spot.top : spot.after, fallback });
  return n > 0;
}
// Once the line has arrived here, it goes exactly where it was dropped.
async function settleAt(eid, spot) {
  showDrop(null);
  if (spot.kind !== 'line') return true;
  for (let i = 0; i < 40; i++) {
    if (!notebook.store.idle) await notebook.store.flush(notebook.editor.state.doc);
    let has = false;
    notebook.editor.state.doc.descendants((n) => { if (n.attrs?.eid === eid) has = true; return !has; });
    if (has) return dropLineAt(notebook.editor.view, eid, spot.eid, spot.after);
    if (i % 5 === 4) await notebook.applyRemote([await getEntry(eid)].filter(Boolean));
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// Its commands in the box (Ctrl + K); commandinfo.js has their hints and words.
addCommands(() => [
  { group: 'write', label: 'When: plan this line (today, this week, next week, later…)', keys: 'Alt+W', words: ['when', 'schedule', 'plan', 'day', 'week', 'month', 'later', 'task'], run: () => setTimeout(() => whenHere(), 60) },
  { group: 'go', label: 'From a project: open one next to the plan, to drag its steps in', keys: '', words: ['pull', 'project', 'beside', 'plan', 'drag', 'split', 'steps'], run: () => pullFromProject() },
  { group: 'sync', label: 'Google Calendar: show your events on Today and the week…', keys: '', words: ['calendar', 'google', 'connect', 'events'], run: () => connectCalendar() },
  { group: 'view', label: 'Beside: today’s plan next to this page (again: put it away)', keys: `${mod}\\`, words: ['pane', 'side by side', 'split', 'beside', 'plan', 'tasks', 'today'], when: () => !!paneHost(), run: () => toggleBesidePane() },
  { group: 'view', label: 'Talk it through with Claude, beside where you are', keys: '⌥T', words: ['claude', 'talk', 'think', 'plan', 'week', 'moves', 'ask', 'beside', 'overwhelmed', 'too much'], when: () => !!paneHost(), run: () => openTalk() },
  { group: 'view', label: 'In the Beside pane: this draft’s notes, listed next to it', words: ['pane', 'side by side', 'beside', 'notes', 'margin', 'comments'], when: () => !inPane && !!panes && writing(), run: () => openBeside(BESIDE_PLACES.notes) },
  { group: 'view', label: 'Open where you are in a pane beside (middle-click opens anything beside)', words: ['pane', 'side by side', 'split', 'beside', 'two', 'compare'], when: () => !!paneHost(), run: () => openBeside(lastPlace) },
  { group: 'view', label: 'Show the panes beside', words: ['pane', 'peek', 'side by side'], when: () => !!panes?.count && panes.sheet && !panes.sheetOpen, run: () => panes.showSheet() },
  { group: 'view', label: 'Close all the panes beside', words: ['pane', 'side by side', 'close'], when: () => !!panes?.count, run: () => panes.closeAll() },
  ...Object.entries(LISTS).map(([list, name]) => ({ group: 'page', label: `Make this page a ${name.toLowerCase()} (Claude links each title)`, keys: '', run: () => makeList(list), when: () => inNotebook() && notebook.page?.kind === 'page' && listOf(notebook.page) !== list })),
  { group: 'page', label: 'Stop Claude linking titles on this page', keys: '', run: () => makeList(null), when: () => inNotebook() && !!listOf(notebook.page) }
]);

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireBeside() {
  pull = inPane ? null : new Pull({
    sources: async () => {
      const [all, worldsSorted, pages] = [await areas(), await projectOrder(), (await byKind('page')).filter((p) => !gone(p))];
      const byId = new Map(all.map((a) => [a.id, a]));
      const worldList = worldsSorted;
      const titles = new Map(worldList.map((w) => [w.id, w.title || 'Untitled']));
      const out = worldsSorted.map((w) => ({ id: w.id, title: w.title || 'Untitled', kind: 'world', color: areaColor(byId.get(w.area_id)), hint: 'project' }));
      for (const pg of pages.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))) {
        if (/^steps-/.test(pg.id)) continue;
        out.push({ id: pg.id, title: pg.title || 'Untitled page', kind: 'page', hint: titles.get(pg.parent_id) || 'page' });
      }
      return out;
    },
    // The project you last pulled from is remembered by the pane itself; the
    // first time, the first project in your Desk order that has open steps
    // (never an empty one), else the project you were last in.
    first: async () => {
      const open = new Set((await loadTasks()).filter((i) => i.world && !i.row.fields?.done).map((i) => i.world.id));
      for (const w of await projectOrder()) if (open.has(w.id)) return w.id;
      let id = null;
      try { id = localStorage.getItem('lastWorld'); } catch { /* none */ }
      if (id && !gone(await getEntry(id))) return id;
      return (await railProjects())[0]?.id || null;
    },
    start: () => { if (root.classList.contains('pulling-phone')) plan.pullZones(true); },
    over: (x, y) => plan.pullShow(plan.pullSpot(x, y)),
    drop: async (x, y, ids) => { const spot = plan.pullSpot(x, y); plan.pullZones(false); await plan.pullDrop(spot, ids); },
    end: () => { plan.pullZones(false); plan.pullShow(null); },
    when: (ids, anchor) => plan.pickWhenFor(ids, { anchor }),
    changed: () => plan.redraw(),
    toast
  });
  window.addEventListener('calendar-connected', (e) => {
    forgetCalendar();
    toast(e.detail?.ok ? 'Your Google Calendar is connected. Its events show on Today and the week.' : 'Google said yes, but the calendar couldn’t be saved. Try again from Ctrl + K, “Google Calendar”.');
    plan.refresh?.();
  });
  // Sync may still be signing in when the app opens, so look twice early on.
  if (!inPane) for (const ms of [4000, 20000]) setTimeout(() => { deskPeeked = Date.now(); deskPage.peek(); }, ms);
  setInterval(peekDesk, 300000);
  document.addEventListener('visibilitychange', peekDesk);
  // Sharing again while Inkwell is already open brings it to the front.
  if (!inPane) document.addEventListener('visibilitychange', () => { if (!document.hidden) landShares(); });
  // The Save to Inkwell bookmark (save.html) asks whether Inkwell is already
  // open in this browser: this window answers, and the link lands here quietly
  // (or once this window has finished opening).
  if (!inPane && 'BroadcastChannel' in window) {
    const saves = new BroadcastChannel(SAVE_CHANNEL);
    saves.onmessage = (e) => {
      if (!e.data?.save) return;
      saves.postMessage({ heard: e.data.save });
      if (root.dataset.started) landShares({ quiet: true });
    };
  }
  panes = inPane ? null : new PaneHost({
    mainPlace: () => lastPlace,
    goMain: (place) => go(place),
    focusMain: () => { window.focus(); try { currentEditor().commands.focus(); } catch { /* nothing to type in */ } },
    isOff: () => false,
    many: () => localStorage.getItem('manyPanes') === '1',
    focus: () => root.classList.contains('focus'),
    changed: () => syncBeside(),
    toast
  });
  if (panes) window.__panes = panes;
  sideNotes = new SideNotes($('#side-notes'), {
    mainPlace: () => paneHost()?.hooks.mainPlace() || null,
    open: async (chapterId, paraId) => { const h = paneHost(); if (!h) return; await h.hooks.goMain({ view: 'write', chapterId, focus: paraId }); h.focused(''); h.hooks.focusMain(); },
    skip: (n) => notes.skip(n),
    shown: () => view() === 'sidenotes',
    named: () => { if (view() === 'sidenotes') renderCrumb(); }
  });
  talkThrough = new Talk($('#talk-sheet'), {
    scope: () => projectOfPlace(paneHost()?.hooks.mainPlace() || null),
    fetch: (since) => { const b = deskBackend(); return b ? b.desk(since) : null; },
    ask: (body) => askServer(body),
    canAsk: () => canAskServer(),
    later: (id, until) => deskBackend().laterNeed(id, until),
    // What it changed shows wherever it's open, here and in the main window.
    changed: async (rows, { calls = false } = {}) => { await applyRemote(rows); if (calls) { try { window.parent.__callsChanged?.(); } catch { /* on its own */ } } },
    shown: () => view() === 'talk',
    named: () => { if (view() === 'talk') renderCrumb(); },
    toast
  });
  // (No auto-scroll from the middle button on these.)
  document.addEventListener('mousedown', (e) => { if (besideTarget(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('auxclick', (e) => { if (besideTarget(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('pointerdown', (e) => {
    const el = besideTarget(e);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    middleBeside(el).catch((err) => console.error(err));
  }, true);
  window.__pane = {
    go: (place) => go(place),
    mainMoved: () => { if (view() === 'sidenotes') sideNotes.soon(); if (view() === 'talk') talkThrough.mainMoved(); },
    focus: () => { try { currentEditor().commands.focus(); } catch { /* nothing to type in */ } },
    closing: () => { store.close(editor.state.doc); notebook.close(); },
    dropOver: (x, y) => showDrop(dropSpotAt(x, y)),
    dropClear: () => showDrop(null),
    dropSpot: (x, y) => dropSpotAt(x, y),
    addLink: (eid, spot) => addLinkAt(eid, spot),
    moveOut: (eid, spot) => moveOutTo(eid, spot),
    settle: (eid, spot) => settleAt(eid, spot)
  };
  // A line dragged by its dots out of this window, over another one.
  setLineDragOut({
    over: (e) => !!paneHost()?.dragOver(inPane ? PANE_ID : '', e.clientX, e.clientY),
    drop: (e, eid) => paneHost()?.drop(inPane ? PANE_ID : '', e.clientX, e.clientY, { eid, alt: e.altKey }) || false
  });
}

export { besideItem, listSoon, openBeside, openEntryBeside, openInMain, openProjectBeside, openTalk, paneKeys, paneMoves, panes, planningView, pull, pullFromProject, sideNotes, syncBeside, talkThrough, toggleBesidePane, whenHere, wireBeside };
