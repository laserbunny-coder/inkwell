// The command box (Ctrl + K) and go-to (Ctrl + O).
import { dayOff } from '../edition.js';
import { media } from '../device.js';
import { SECTION_NAMES } from '../schema.js';
import { keyLabel, showKeysForThisComputer } from '../keys.js';
import { flip, newParagraphVersion } from '../alts.js';
import { bySort } from '../order.js';
import { putEntries, chapterText, getEntry, byKind } from '../db.js';
import { askText, askScript, toast } from '../menu.js';
import { chapterMarkdown, bookMarkdown, download } from '../export.js';
import { mb } from '../keep.js';
import { SPACE, spaceUsed, unsentFiles } from '../files.js';
import { vaultZip } from '../vault.js';
import { ELEMENTS, toFountain, fromFountain, fromOutline, looksLikeOutline } from '../script.js';
import { titleOf } from '../notebook.js';
import { newScene } from '../woven.js';
import { showSaveButton } from '../savebutton.js';
import { toggleLight } from '../frame.js';
import { addLine } from '../capture.js';
import { tabFor } from '../plan.js';
import { Box } from '../box.js';
import { describe } from '../commandinfo.js';
import { SHOWS } from '../shows.js';
import { dayWord, loadTasks, addTask } from '../tasks.js';
import { inPane, PANE_ID, host as paneHost } from '../panes.js';
import { areas, books, hasManuscript, kindName, newBook, ago, worlds, newPiece } from '../library.js';
import { isoToday } from '../dates.js';
import { addCommands, allCommands, mod } from './commandlist.js';
import { $, alts, body, editor, gone, inNotebook, insertSection, isScript, isWoven, notes, root, setElement, state, store, view } from '../main.js';
import { touch } from './scriptbar.js';
import { notebook } from './notebookview.js';
import { go, lastPlace, openBook, openEntry } from './routing.js';
import { applyRemote } from './syncwiring.js';
import { openChapter } from './manuscript.js';
import { plural, refreshViews } from './tidying.js';
import { goCatchup, goPage, nav, projectOrder, railProjects, strip } from './workpages.js';
import { hidden, lookTab, setShown, toggleFocus, togglePageSettings } from './pagesettings.js';
import { closePalette, openHit, openPalette } from './quickinserts.js';
import { searchIndex } from '../search.js';
import { deskPage, plan } from './talking.js';
// The one box (box.js), made once the commands are listed.
let box = null;

function toggleTheme() { toggleLight(); }

// Opens the Aa panel at the script's look.
function openLook() {
  if ($('.page-settings').hidden) togglePageSettings('text'); else lookTab('text');
  $('.woven-pick')?.scrollIntoView({ block: 'start' });
  $('.woven-pick .wv-preset.current')?.focus({ preventScroll: true });
}

// Opens the Aa panel at its font list, on the current font, so a font is picked, not guessed.
function openFontPicker() {
  if ($('.page-settings').hidden) togglePageSettings('text'); else lookTab('text');
  const pick = $('.font-pick');
  pick.scrollIntoView({ block: 'start' });
  (pick.querySelector('.font-list button.current') || pick.querySelector('.font-list button'))?.focus({ preventScroll: true });
}

async function exportChapter() {
  await store.close(editor.state.doc);
  const ch = await getEntry(state.chapterId);
  download(`${ch.title}.md`, chapterMarkdown(ch, await chapterText(ch.id)));
}

async function exportVault() {
  await store.close(editor.state.doc);
  await notebook.close();
  download(`Inkwell vault ${isoToday()}.zip`, await vaultZip());
}

async function exportFountain() {
  await store.close(editor.state.doc);
  const rows = [];
  for (const act of state.acts) for (const ch of act.chapters) rows.push(...(await chapterText(ch.id)));
  download(`${state.project.title}.fountain`, toFountain(state.project.title, rows));
}

// What a script calls its section levels, top down, in your own words.
async function nameSectionLevels() {
  const b = await getEntry(state.project.id);
  const now = b.fields?.sections || SECTION_NAMES.slice(0, 4);
  const got = await askText({ title: 'Section levels', body: 'Top level first, separated by commas. For example: Act, Sequence, Scene.', value: now.join(', '), ok: 'Save' });
  if (!got) return;
  const names = got.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6);
  if (!names.length) return;
  const next = { ...b, fields: { ...b.fields, sections: names }, updated_at: Date.now() };
  await putEntries([next]);
  state.project = next;
  await store.close(editor.state.doc);
  const id = state.chapterId;
  state.chapterId = null;
  await openChapter(id);
}

// Bring in a script: a .fountain file, or Fountain pasted from an outliner.
// It becomes a new screenplay piece in the world you're in (or another, or a
// world of its own), sections nested as they were.
async function importFountain() {
  const here = state.worldId && (await getEntry(state.worldId));
  const others = (await worlds()).filter((w) => w.id !== here?.id && !w.fields?.finished).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const places = [...(here && !gone(here) ? [[here.id, here.title || 'Untitled']] : []), ['', 'A new world of its own'], ...others.map((w) => [w.id, w.title || 'Untitled'])];
  const got = await askScript({ places });
  if (!got) return;
  const { title, lines } = looksLikeOutline(got.text) ? fromOutline(got.text) : fromFountain(got.text);
  if (!lines.length) { toast('That doesn’t look like a script: nothing came in.'); return; }
  const name = title || got.name || 'Untitled script';
  let book;
  if (got.into) book = await newPiece(got.into, 'screenplay', name, lines);
  else book = await newBook('screenplay', name, (await areas())[0]?.id || null, lines);
  await refreshViews();
  await openBook(book.id);
  const sections = lines.filter((l) => l.el === 'section').length;
  const scenes = lines.filter((l) => l.el === 'scene').length;
  toast(`“${name}” is in: ${plural(scenes, 'scene')}${sections ? `, ${plural(sections, 'section')}` : ''}`);
}

async function exportBook() {
  await store.close(editor.state.doc);
  download(`${state.project.title}.md`, await bookMarkdown(state.project, state.acts));
}

const writing = () => view() === 'write';
let commands; // set in wireCommands()

// Where you are, as the rooms commands say they fit (commandinfo.js).
function roomTags() {
  const v = view();
  if (v === 'plan') return tabFor(lastPlace?.tab) === 'now' ? ['today', 'plan'] : ['plan', 'when', 'day'].includes(tabFor(lastPlace?.tab)) ? ['plan'] : ['calendar'];
  if (inNotebook() && notebook.page) return notebook.isDay ? ['today'] : ['page'];
  if (v === 'desk') return ['desk'];
  if (['library', 'drawer', 'tags', 'journal'].includes(v)) return ['library'];
  if (writing()) return isScript() ? ['script', 'write'] : ['write'];
  if (['world', 'project', 'grid', 'production', 'deliver', 'stage'].includes(v)) return ['world'];
  return [];
}
// Every place to go, for typing in the box: projects, pieces, areas,
// chapters, pages and the last month of days, each saying what it is.
async function boxPlaces() {
  const [allAreas, allBooks, allWorlds, allPages] = await Promise.all([areas(), books(), worlds(), byKind('page')]);
  const out = [];
  const worldName = new Map(allWorlds.map((w) => [w.id, w.title || 'Untitled']));
  for (const w of await projectOrder()) out.push({ label: w.title || 'Untitled', what: 'project', run: () => go({ view: 'world', id: w.id }) });
  for (const w of allWorlds.filter((x) => x.fields?.finished)) out.push({ label: w.title || 'Untitled', what: 'finished project', run: () => go({ view: 'world', id: w.id }) });
  for (const b of allBooks.sort((a, c) => c.updated_at - a.updated_at)) {
    const w = worldName.get(b.parent_id);
    if (w === (b.title || 'Untitled') && allBooks.filter((x) => x.parent_id === b.parent_id).length === 1) continue;
    out.push({ label: b.title || 'Untitled', what: w ? `piece · ${w}` : kindName(b).toLowerCase(), run: () => go({ view: 'project', id: b.id }) });
  }
  for (const a of allAreas) out.push({ label: a.title, what: 'area', run: () => go({ view: 'library', area: a.id }) });
  const [allActs, allChapters] = await Promise.all([byKind('act'), byKind('chapter')]);
  const under = new Map();
  for (const r of [...allActs, ...allChapters]) (under.get(r.parent_id) || under.set(r.parent_id, []).get(r.parent_id)).push(r);
  const inOrder = (id) => (under.get(id) || []).sort(bySort);
  for (const b of allBooks.filter(hasManuscript)) {
    for (const act of inOrder(b.id)) if (act.kind === 'act') for (const ch of inOrder(act.id)) out.push({ label: ch.title || 'Untitled', what: `chapter · ${b.title || 'Untitled'}`, run: () => go({ view: 'write', chapterId: ch.id }) });
  }
  for (const p of allPages.filter((x) => !gone(x))) out.push({ label: p.title || 'Untitled page', what: worldName.get(p.parent_id) ? `page · ${worldName.get(p.parent_id)}` : 'page', run: () => go({ view: 'notebook', pageId: p.id }) });
  const days = (await byKind('day')).filter((d) => !d.deleted).sort((a, c) => (a.title < c.title ? 1 : -1)).slice(0, 30);
  for (const d of days) out.push({ label: titleOf(d), what: 'day', run: () => go({ view: 'notebook', pageId: d.id }) });
  return out;
}
// Every open task (from the task index), saying when and where it is.
async function boxTasks() {
  const today = isoToday();
  const list = (await loadTasks(today)).filter((i) => !i.row.fields?.done && i.mine);
  return list.map((i) => {
    const day = i.task.day ? (i.task.day < today ? 'from earlier' : dayWord(i.task.day, today).toLowerCase()) : '';
    return { id: i.row.id, label: i.row.text || 'Untitled task', what: ['task', day, i.world?.title].filter(Boolean).join(' · '), run: () => openEntry(i.row.id) };
  });
}
// The Desk's Catch-up lines, once the Desk has read them.
function boxCatchup() {
  const ups = deskPage?.data?.updates || [];
  const now = Date.now();
  return ups.slice(-60).reverse().map((u) => ({ label: u.text, what: `Catch-up · ${ago(u.at, now)}`, run: () => goCatchup() }));
}
// A task typed into the box: on its day (or week, month, later), like one
// typed into the plan. A toast offers Undo and Open it.
async function boxAddTask(title, choice) {
  if (!title.trim()) return;
  const when = choice?.when || { day: isoToday() };
  const day = when.day || null;
  // Added from inside a piece (or one of its pages): the step is for it (the zoom, Part 2).
  const v = view();
  const forId = v === 'write' ? state.project?.id : v === 'project' ? state.bookId : inNotebook() && notebook?.page && !notebook.isDay && notebook.page.kind !== 'world' ? notebook.page.id : null;
  const rows = await addTask({ text: title.trim(), day, span: when.span || null, order: plan?.lastOrder?.(day) ?? 0, for: forId || null });
  await applyRemote(rows);
  const line = rows.at(-1);
  const said = !day ? choice.label.toLowerCase() : day === isoToday() ? 'today' : dayWord(day, isoToday()) === 'Tomorrow' ? 'tomorrow' : new Date(`${day}T12:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  toast(`Task added for ${said}: “${title.trim()}”`, { label: 'Undo', run: async () => { const row = await getEntry(line.id); if (row) { const gone = { ...row, deleted: true, updated_at: Date.now() }; await putEntries([gone]); await applyRemote([gone]); } } }, { label: 'Open it', run: () => openEntry(line.id) });
}
// Shift + Enter in the box: the words as a line at the end of today's page.
async function boxAddLine(text) {
  if (!text.trim()) return;
  const { line, rows } = await addLine([{ type: 'text', text: text.trim() }], {});
  await applyRemote(rows);
  toast('Added to today’s page', { label: 'Undo', run: async () => { const row = await getEntry(line.id); if (row) { const gone = { ...row, deleted: true, updated_at: Date.now() }; await putEntries([gone]); await applyRemote([gone]); } } }, { label: 'Open it', run: () => openEntry(line.id) });
}

// The command menu opens on these, so the phone doesn't need a long scroll; typing searches everything.
async function showSpace() {
  const { bytes, count } = await spaceUsed();
  const { count: waiting } = await unsentFiles();
  toast(`Pictures and files: ${mb(bytes)} of ${mb(SPACE)} used · ${count === 1 ? '1 file' : `${count} files`}${waiting ? ` · ${waiting} still to upload from here` : ''}`);
}

// Its commands in the box (Ctrl + K); commandinfo.js has their hints and words.
addCommands(() => [
  { group: 'new', label: 'Bring in a script (Fountain file or pasted text)…', keys: '', run: importFountain },
  ...ELEMENTS.map((x) => ({ group: 'write', label: `Script: ${x.label}`, keys: 'Tab', run: () => setElement(x.id), when: () => writing() && isScript() && !(x.id === 'scene' && isWoven()) })),
  { group: 'write', label: 'Woven: new scene here', keys: `${mod}⇧↵`, words: ['scene', 'cut', 'line', 'break'], run: () => { editor.commands.focus(); newScene(editor); }, when: () => writing() && isWoven() },
  { group: 'view', label: 'Woven: this script’s look (line, names, title font)…', keys: '', words: ['look', 'genre', 'style', 'font', 'colour', 'color', 'kung fu'], run: openLook, when: () => writing() && isWoven() },
  { group: 'write', label: 'Script: Section (your own heading)', keys: '# ', run: () => { insertSection(editor.state.selection.$from.before(1)); }, when: () => writing() && isScript() },
  { group: 'write', label: 'Add a note to this paragraph', keys: `${mod}⇧N`, run: () => notes.add(), when: writing },
  { group: 'write', label: 'Alternates for this word (or the selection)', keys: `${mod}⇧E`, run: () => alts.open({ scope: 'word', focusAdd: true }), when: writing },
  { group: 'write', label: 'Versions of this paragraph', keys: '', run: () => alts.open({ scope: 'para' }), when: writing },
  { group: 'write', label: 'New version of this paragraph to rewrite', keys: `${mod}⇧D`, run: () => newParagraphVersion(editor), when: writing },
  { group: 'write', label: 'Next alternate (word, or else paragraph)', keys: '⌥↓', run: () => flip(editor, 1), when: writing },
  { group: 'write', label: 'Previous alternate', keys: '⌥↑', run: () => flip(editor, -1), when: writing },
  { group: 'write', label: 'Scene break', keys: `${mod}⇧↵`, run: () => editor.chain().focus().insertSceneBreak().run(), when: writing },
  { group: 'write', label: 'Note categories: add, rename, recolour', keys: '', run: () => notes.editTypes() },
  { group: 'page', label: 'Light / dark', keys: `${mod}⇧L`, run: toggleTheme },
  { group: 'page', label: 'Change the writing font', keys: '', words: ['typeface', 'mono', 'serif'], run: () => setTimeout(openFontPicker, 60) },
  { group: 'sync', label: 'Export this chapter as Markdown', keys: '', run: exportChapter, when: () => writing() && !isScript() },
  { group: 'sync', label: 'Export the whole book as Markdown', keys: '', run: exportBook, when: () => writing() && !!state.project && !isScript() },
  { group: 'sync', label: 'Export this script as Fountain', keys: '', run: exportFountain, when: () => writing() && isScript() },
  { group: 'sync', label: 'Back up everything (download all as files)', keys: '', run: exportVault },
  { group: 'sync', label: 'Pictures and files: space used', keys: '', run: showSpace },
  { group: 'page', label: 'Name the section levels (Act, Sequence, Scene…)', keys: '', run: nameSectionLevels, when: () => writing() && isScript() },
  { group: 'view', label: 'Close the pane you’re in', keys: `${mod}⌥W`, words: ['pane', 'side by side', 'close'], when: () => inPane, run: () => paneHost()?.close(PANE_ID) },
  { group: 'new', label: 'Save links from your browser (Save to Inkwell button)…', keys: '', words: ['bookmark', 'bookmarklet', 'share', 'save link', 'twitter', 'x', 'web page', 'computer', 'desktop'], run: () => showSaveButton(), when: () => !media('finger').matches }
]);

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireCommands() {
  showKeysForThisComputer();
  commands = allCommands();
  // Each one's group, its one line, more words that find it, the rooms it fits
  // and why it can't run (commandinfo.js).
  // The "Show or hide …" commands come from the same list as the Show tab
  // (shows.js); the ones written above by hand keep their own.
  for (const sh of SHOWS) {
    if (!sh.cmd || commands.some((c) => c.label === sh.cmd)) continue;
    commands.push({ group: 'view', label: sh.cmd, keys: sh.keys || '', hint: sh.hint, words: sh.words, run: () => { setShown(sh.id, hidden().has(sh.id)); toast(`${sh.label}: ${hidden().has(sh.id) ? 'off' : 'on'}`); }, when: sh.phone ? () => touch.matches : undefined, needs: sh.phone ? 'On a phone only' : undefined });
  }
  commands.forEach(describe);
  // In the order commandinfo.js lists them (the box's order), whichever file
  // added them.
  commands.sort((a, b) => (a.rank ?? 900) - (b.rank ?? 900));
  // For the tests: every command as the box lists it.
  window.__commandList = () => commands.map((c) => ({ label: c.label, group: c.group, hint: c.hint, words: c.words, where: c.where || [], needs: c.needs || '' }));
  box = new Box($('.palette'), {
    // Studio without the day tools: the day's commands leave the box (edition.js).
    commands: () => (dayOff() ? commands.filter((c) => c.group !== 'plan') : commands),
    usable: (c) => !c.when || c.when(),
    recent: () => nav.recent,
    jump: (place) => go(place),
    tabs: () => {
      if (!strip.tabs.some((t) => t.n != null)) return null;
      const active = strip.ctx?.active || null;
      return { title: nav.titleOfOwner(), tabs: strip.tabs.map((t) => ({ label: t.label, keys: t.n != null ? keyLabel(`⌥${t.n}`) : '', on: t.id === active, run: () => goPage(t.id) })) };
    },
    here: () => roomTags(),
    projects: () => railProjects(),
    openProject: (id) => go({ view: 'world', id }),
    places: () => boxPlaces(),
    tasks: () => boxTasks(),
    catchup: () => boxCatchup(),
    addTask: (title, choice) => boxAddTask(title, choice),
    addLine: (text) => boxAddLine(text),
    search: (text) => openPalette('search', text),
    writing: () => searchIndex(),
    openHit: (row) => openHit(row),
    runCommand: (c) => c.run(),
    focusOn: () => root.classList.contains('focus'),
    toggleFocus: () => { toggleFocus(); toast(root.classList.contains('focus') ? 'Focus on' : 'Focus off'); },
    look: () => { if ($('.page-settings').hidden) togglePageSettings(); },
    close: (refocus = true) => closePalette(refocus),
    isTouch: () => touch.matches,
    keyLabel: (t) => keyLabel(t),
    toast: (t) => toast(t)
  });
}

export { box, commands, roomTags, toggleTheme, wireCommands, writing };
