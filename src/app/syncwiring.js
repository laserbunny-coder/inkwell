// Sync between devices: signing in, bringing things up to date, what's not sent yet.
import { record as recordProgress } from '../stats.js';
import { getMeta, setMeta, putEntries, getEntry, byKind, onLocalWrites } from '../db.js';
import { searchChanged } from '../search.js';
import { toast } from '../menu.js';
import { Sync } from '../sync.js';
import { ensureSeed, hasWriting, outline } from '../model.js';
import { foldKey, replaceDoc } from '../outline.js';
import { retitleLinks, freshenRefs } from '../links.js';
import { oldestUnsent, unsentLabel, unsentFilesLabel, spaceWarning, STALE_AFTER } from '../keep.js';
import { setMoveHooks } from '../move.js';
import { Conflicts } from '../conflicts.js';
import { SPACE, spaceUsed, unsentFiles } from '../files.js';
import { vaultFiles } from '../vault.js';
import { dayId } from '../notebook.js';
import { DESK_ID } from '../desk.js';
import { PLAN_ID } from '../tasks.js';
import { draftHolding } from '../drafts.js';
import { inPane, sendChanged, onChanged } from '../panes.js';
import { redrawTidy } from '../tidypass.js';
import { ensureWorlds, setOwnWorkflows } from '../library.js';
import { isoToday } from '../dates.js';
import { $, blankOnce, body, dayReview, deskPage, editor, frame, gone, grid, inNotebook, looseSoon, notes, openAsked, plan, production, renderLibrary, renderProject, renderWorld, reviewAsked, scribeKept, sideNotes, stagePage, state, store, tagsPage, tidyNudge, todayPanel, view, writeOut } from '../main.js';
import { notebook } from './notebookview.js';
import { go, lastChapterAnywhere } from './routing.js';
import { openChapter, refreshWords, renderChapterLinks } from './manuscript.js';
import { renderCrumb, renderRail, scheduleScenes } from './rail.js';
import { leaveChapter, refreshViews } from './tidying.js';

// ---------- sync between devices ----------

let syncEl; // set in wireSync()
const SYNC_LABELS = { 'signed-out': 'Sign in to sync', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline · will sync' };
// Books become worlds once this device has heard from the cloud (or found it
// can't), so the change is made on the newest copy of each book.
// The starter novel (see start): made once this device has the whole account
// and it holds nothing yet. Decided once per device.
async function seedNow() {
  await ensureSeed(sync.user?.id || null);
  await setMeta('seedDecided', true);
}
let seeding = null;
function seedIfEmpty() {
  seeding = seeding || (async () => {
    if (await getMeta('seedDecided')) return;
    if (!sync.pulled) return;
    if (await hasWriting()) { await setMeta('seedDecided', true); return; }
    await seedNow();
    // Opened before there was anything to write in: go to it now.
    if (view() === 'library' || (view() === 'write' && !state.chapterId)) await go({ view: 'write' });
    else renderRail();
  })().catch((e) => console.error(e)).finally(() => { seeding = null; });
  return seeding;
}
let migrated = false;
function migrateOnce() {
  if (migrated) return;
  migrated = true;
  migrateWorlds().catch((e) => console.error(e));
}
let sync; // set in wireSync()
// Changes that have waited a day or more for the cloud are called out on the
// sync button, and the top bar peeks out once so it's seen.
let warnedUnsent = false;
async function checkUnsent() {
  const state = syncEl.dataset.state;
  if (state === 'syncing' || state === 'off') return;
  const since = await oldestUnsent();
  let label = null;
  if (since && Date.now() - since >= STALE_AFTER && state !== 'synced') label = state === 'signed-out' ? `${unsentLabel(since)} · Sign in` : unsentLabel(since);
  else {
    // Pictures go up after the words, so they can be stuck while the words are synced.
    const files = await unsentFiles();
    if (files.since && Date.now() - files.since >= STALE_AFTER) label = `${unsentFilesLabel(files.count, files.since)}${state === 'signed-out' ? ' · Sign in' : ''}`;
  }
  if (!label) return;
  syncEl.hidden = false;
  syncEl.textContent = label;
  syncEl.dataset.stale = 'true';
  if (!warnedUnsent) {
    warnedUnsent = true;
    body.classList.add('show-top');
    setTimeout(() => { if (!document.querySelector('.topbar:hover')) body.classList.remove('show-top'); }, 6000);
  }
}
// The cloud's file space: a notice once it's 80% full, and again at 95%.
async function checkSpace() {
  const { bytes } = await spaceUsed();
  let warned = 0;
  try { warned = Number(localStorage.getItem('spaceWarned')) || 0; } catch { /* private window */ }
  const w = spaceWarning(bytes, SPACE, warned);
  if (bytes < SPACE * 0.8 && warned) try { localStorage.removeItem('spaceWarned'); } catch { /* ignore */ }
  if (!w) return;
  try { localStorage.setItem('spaceWarned', String(w.level)); } catch { /* ignore */ }
  toast(w.text);
}
let conflicts; // set in wireSync()
// Progress keeps a small daily tally; it's noted a little after you stop typing.
let tallyTimer = null;
// It counts everything, so while you keep writing it's noted at most every ten
// minutes (and whenever the app is put away), not after every pause.
let tallyAt = 0;
const tallySoon = (ms = 20000) => {
  clearTimeout(tallyTimer);
  const wait = Math.max(ms, tallyAt + 10 * 60000 - Date.now());
  tallyTimer = setTimeout(() => { tallyAt = Date.now(); recordProgress().catch((e) => console.error(e)); }, wait);
};
// Written here or in a pane: off to the cloud, counted, and links to a renamed page follow.
function wrote(rows) {
  sync.soon();
  searchChanged(rows);
  if (rows.some((r) => r.kind !== 'tally')) tallySoon();
  if (rows.some((r) => r.kind === 'file')) checkSpace().catch(() => {});
  retitleLinks(rows).then((changed) => { if (changed) { freshenRefs(editor); freshenRefs(notebook.editor); } }).catch((e) => console.error(e));
}

// An untouched starter book on a new device gives way to the real one from the cloud.
async function dropEmptySeed(keep) {
  for (const p of await byKind('project')) {
    if (p.id === keep.id || p.deleted || p.title !== 'Untitled novel') continue;
    const acts = await outline(p.id);
    const chapters = acts.flatMap((a) => a.chapters);
    if (!chapters.every((c) => !c.fields?.words)) continue;
    const now = Date.now();
    const world = p.parent_id ? await getEntry(p.parent_id) : null;
    const wrap = world?.kind === 'world' && world.id === `wd-${p.id}` ? [world] : [];
    await putEntries([p, ...acts, ...chapters, ...wrap].map((e) => ({ ...e, deleted: true, updated_at: now })));
  }
}

// Books from before worlds (or from a device still on an older version) become worlds.
async function migrateWorlds() {
  setOwnWorkflows(await byKind('workflow'));
  if (await ensureWorlds()) await refreshViews();
}

async function applyRemote(rows) {
  searchChanged(rows);
  if (rows.some((r) => r.kind === 'tidy' || r.kind === 'change')) { redrawTidy(); tidyNudge(); }
  if (view() === 'tags' && tagsPage && rows.some((r) => r.tags?.length || r.id === 'settings-tag-groups')) tagsPage.refresh();
  if (view() === 'desk' && rows.some((r) => r.kind === 'world' || r.kind === 'area' || r.id === DESK_ID)) deskPage?.refresh();
  // Projects come in your Desk order everywhere: the rail follows a drag there.
  if (rows.some((r) => r.id === DESK_ID || r.kind === 'world')) frame.drawProjects();
  // Where a project sits changed somewhere else (the Desk beside, a talk with Claude).
  if (view() === 'world' && rows.some((r) => r.id === DESK_ID) && !rows.some((r) => r.kind === 'world')) renderWorld();
  if (rows.some((r) => r.kind === 'line' || r.id === PLAN_ID)) { plan?.soon(); looseSoon(); }
  if (rows.some((r) => r.kind === 'settings')) await notes.reloadTypes();
  if (rows.some((r) => r.kind === 'workflow')) setOwnWorkflows(await byKind('workflow'));
  if (state.chapterId && rows.some((r) => r.links?.includes(state.chapterId))) renderChapterLinks();
  const structural = rows.some((r) => ['project', 'world', 'act', 'chapter', 'area', 'page', 'draft'].includes(r.kind));
  if (structural) {
    const remoteProject = rows.find((r) => r.kind === 'project' && !r.deleted);
    if (remoteProject) await dropEmptySeed(remoteProject);
    if (migrated && rows.some((r) => r.kind === 'project' && !r.deleted && !r.parent_id)) await ensureWorlds();
    if (state.project) {
      const p = await getEntry(state.project.id);
      state.project = gone(p) ? null : p;
    }
    const ch = state.chapterId && (await getEntry(state.chapterId));
    if (state.chapterId && gone(ch)) await leaveChapter();
    // The other device started a new draft: this chapter is now in the kept one.
    if (view() === 'write' && ch && !gone(ch) && (await draftHolding(ch))) {
      await store.close(editor.state.doc);
      state.chapterId = null;
      const first = state.project && (await outline(state.project.id)).flatMap((a) => a.chapters)[0];
      if (first) await openChapter(first.id);
      toast('A new draft was started on your other device; the earlier one is kept whole');
    }
    if (view() === 'write' && (!state.project || gone(ch))) {
      state.chapterId = null;
      const id = await lastChapterAnywhere();
      if (id) await openChapter(id);
      else await go({ view: 'library' });
    } else if (state.project) state.acts = await outline(state.project.id);
    if (inNotebook() && notebook.page && !notebook.isDay && gone(await getEntry(notebook.page.id))) await go({ view: 'notebook', pageId: dayId(isoToday()) });
    if (view() === 'library') await renderLibrary();
    if (view() === 'project') await renderProject();
    if (view() === 'world') await renderWorld();
    renderRail();
    renderCrumb();
  }
  if (rows.some((r) => r.parent_id === state.chapterId && ['para', 'scene', 'heading'].includes(r.kind))) await applyRemoteChapter();
  if (rows.some((r) => r.kind === 'note' && r.fields?.chapter_id === state.chapterId)) await notes.load(state.chapterId);
  if (view() === 'sidenotes' && rows.some((r) => ['note', 'para', 'scene', 'heading', 'chapter', 'settings'].includes(r.kind))) sideNotes.soon();
  if (view() === 'grid' && rows.some((r) => ['note', 'thread', 'para', 'scene', 'chapter', 'act', 'project', 'world'].includes(r.kind))) grid.refresh();
  if ((view() === 'production' || view() === 'deliver') && rows.some((r) => ['shot', 'breakdown', 'shootday', 'file', 'page', 'note', 'para', 'scene', 'chapter', 'act', 'project', 'world', 'share'].includes(r.kind))) production?.refresh();
  if (stagePage?.isOpen && rows.some((r) => ['line', 'page', 'project', 'world', 'event', 'tie', 'shootday', 'note', 'share'].includes(r.kind))) stagePage.refresh();
  if (todayPanel.isOpen && rows.some((r) => r.kind === 'line' || r.kind === 'day')) todayPanel.refresh();
  await notebook.applyRemote(rows);
  if (inNotebook() && notebook.isDay && rows.some((r) => r.kind === 'review' || r.parent_id === notebook.page.id || r.parent_id === 'pg_mulling')) dayReview?.refresh();
}

let caretAfter = null;
function setCaretAfter(value) { return (caretAfter = value); }
async function applyRemoteChapter(tries = 0) {
  // Never replace text that's still being saved; wait for this device to settle.
  if (!store.idle) { if (tries < 20) setTimeout(() => applyRemoteChapter(tries + 1), 800); return; }
  const doc = await store.refresh();
  if (JSON.stringify(doc) === JSON.stringify(editor.state.doc.toJSON())) return;
  const { $from } = editor.state.selection;
  const block = $from.node(1);
  // Words you talked in land where the caret was: it moves to the end of them.
  const anchor = caretAfter ? { eid: caretAfter, offset: Infinity } : block ? { eid: block.attrs.eid, offset: $from.parentOffset } : null;
  caretAfter = null;
  const focused = editor.isFocused;
  replaceDoc(editor, doc);
  if (anchor?.eid) {
    editor.state.doc.forEach((node, pos) => {
      if (node.attrs.eid === anchor.eid) {
        const at = Math.min(pos + 1 + anchor.offset, pos + node.nodeSize - 1);
        editor.commands.setTextSelection(at);
      }
    });
  }
  if (focused) editor.view.focus();
  refreshWords();
  scheduleScenes();
  notes.layout();
}

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireSync() {
  syncEl = $('#sync');
  sync = new Sync({
    onStatus: (s) => {
      if (s !== 'syncing') migrateOnce();
      syncEl.hidden = s === 'off';
      syncEl.textContent = SYNC_LABELS[s] || '';
      syncEl.dataset.state = s;
      delete syncEl.dataset.stale;
      document.body.dataset.sync = s;
      if (s === 'synced') { seedIfEmpty(); conflicts.count(); checkSpace().catch(() => {}); blankOnce().then(writeOut); scribeKept(); openAsked(); reviewAsked(); }
      if (s !== 'syncing') checkUnsent().catch(() => {});
    },
    // What came from the cloud goes to the panes too.
    onRemote: (rows) => { sendChanged(rows); return applyRemote(rows); }
  });
  if (!inPane) setInterval(() => checkUnsent().catch(() => {}), 36e5);
  setMoveHooks({
    open: () => [
      { rootId: state.chapterId, editor, store },
      { rootId: notebook.page?.id, editor: notebook.editor, store: notebook.store }
    ],
    refresh: (rows) => applyRemote(rows)
  });
  conflicts = new Conflicts({ onApplied: (rows) => applyRemote(rows) });
  onLocalWrites((rows) => {
    // The other windows (panes, or the main one) show it too.
    sendChanged(rows);
    if (inPane) { searchChanged(rows); return; }
    wrote(rows);
  });
  // Another window of this family wrote: show it here, the way changes from
  // another device show. The main window also sends the pane's writes on.
  onChanged(async (ids) => {
    const rows = (await Promise.all(ids.map((id) => getEntry(id)))).filter(Boolean);
    if (!rows.length) return;
    if (!inPane) wrote(rows);
    else retitleLinks(rows).then((changed) => { if (changed) { freshenRefs(editor); freshenRefs(notebook.editor); } }).catch(() => {});
    await applyRemote(rows);
  });
  window.__sync = sync;
  window.__notebook = notebook;
  window.__foldKey = foldKey;
  window.__vaultFiles = vaultFiles;
  syncEl.addEventListener('click', () => { if (syncEl.dataset.state === 'signed-out') sync.signIn(); else sync.soon(0); });
}

export { applyRemote, applyRemoteChapter, caretAfter, conflicts, migrateOnce, seedIfEmpty, seedNow, setCaretAfter, sync, wireSync };
