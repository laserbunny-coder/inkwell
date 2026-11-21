// Chapters of a manuscript, and Woven (a script written as flowing prose).
import { setMeta, putEntries, children, getEntry } from '../db.js';
import { ask, showCopy, toast } from '../menu.js';
import { outline, entry, docWords } from '../model.js';
import { loadDoc } from '../outline.js';
import { freshenRefs } from '../links.js';
import { scriptPages, assignCodes } from '../script.js';
import { renderLinkedFrom } from '../notebook.js';
import { ScenePop, guessAll, redraw as redrawWoven, placeList, sceneAt, scenesOf, ensureHeading, setMarker, lineKey, KINDS as SCENE_KINDS } from '../woven.js';
import { ScenePlan } from '../sceneplan.js';
import { NovelPlan } from '../novelplan.js';
import { shotsUnder } from '../production.js';
import { applyLook, renderLook, renderNames, nameColour, cleanLook, DEFAULT_LOOK } from '../wovenlook.js';
import { elementsIn, plainPages, newElement } from '../production.js';
import { threadsOf } from '../grid.js';
import { bookType, bookOf, worldOf } from '../library.js';
import { addCommands } from './commandlist.js';
import { $, editor, isScript, isWoven, notes, root, state, statusEl, store, view } from '../main.js';
import { placeScriptBar } from './scriptbar.js';
import { toggleSections } from './pagesettings.js';
import { go, openEntry, remember } from './routing.js';
import { sync } from './syncwiring.js';
import { renderCrumb, renderRail, renderScenes } from './rail.js';
import { nameOf, refreshViews } from './tidying.js';
import { beside, talk } from './revising.js';
import { writing } from './commands.js';
import { currentBook } from './quickinserts.js';
import { askServer, canAskServer } from './talking.js';
import { planLinesFocus } from './notebookview.js';
// The scene numbers in the numbered script's other chapters, around the one open.
let numbering = { before: null, after: null, used: [] };
// The world's places (bible pages that are locations), for guessing where a scene is.
let biblePlaces = [];

// ---------- chapters ----------

async function openChapter(id) {
  if (state.chapterId === id) return;
  if (state.chapterId) await store.close(editor.state.doc);
  const { doc, recovered } = await store.load(id);
  state.chapterId = id;
  const book = await bookOf(store.chapter);
  if (book && book.id !== state.project?.id) state.project = book;
  root.classList.toggle('script', bookType(book) === 'screenplay');
  root.classList.toggle('numbered', !!book?.fields?.numbered);
  await syncWoven(book);
  numbering = book?.fields?.numbered ? await numberingAround(book, id) : { before: null, after: null, used: [] };
  requestAnimationFrame(placeScriptBar);
  scenePlan?.load(book?.id);
  novelPlan?.load(book?.id);
  steadyPad(0);
  loadDoc(editor, doc);
  if (isWoven()) guessAll(editor);
  if (recovered) store.change(editor.state.doc);
  else statusEl.textContent = 'Saved';
  freshenRefs(editor);
  if (state.project) state.acts = await outline(state.project.id);
  notes.threads = await threadsOf(book && (await worldOf(book)));
  await notes.load(id);
  // The threads and notes under the scene lines are known now.
  if (isWoven()) redrawWoven(editor);
  novelPlan?.redrawDoc();
  await renderChapterLinks();
  await setMeta('lastChapter', id);
  if (state.project) await setMeta(`lastChapter:${state.project.id}`, id);
  if (view() === 'write') remember({ view: 'write', chapterId: id });
  if (beside.isOpen) beside.follow(id);
  if (talk.isOpen) talk.open(id);
  refreshWords();
  renderRail();
  renderCrumb();
  editor.commands.focus('end');
}

// Scene numbers already given in a script's other chapters: the last one
// before this chapter, the first after it, and all of them.
async function numberingAround(piece, chapterId) {
  const chapters = (await outline(piece.id)).flatMap((a) => a.chapters);
  const i = chapters.findIndex((c) => c.id === chapterId);
  const codesIn = async (ch) => (await children(ch.id)).filter((r) => r.fields?.el === 'scene' && r.fields?.code).map((r) => r.fields.code);
  const before = [];
  const after = [];
  for (const [j, ch] of chapters.entries()) if (j !== i) (j < i ? before : after).push(...(await codesIn(ch)));
  return { before: before.at(-1) || null, after: after[0] || null, used: [...before, ...after] };
}

// Number a script's scenes, for production. Once on, every scene keeps its
// number for good and new ones slot in (3A); turning it off only hides them.
// ---------- Woven ----------

// The script open is Woven or Classic (a per-script switch, kept with the
// script so every device shows it the same way), and Woven wears its look.
async function syncWoven(book) {
  const on = isScript() && !!book?.fields?.woven;
  root.classList.toggle('woven', on);
  applyLook(root, on ? (book.fields.look || DEFAULT_LOOK) : null);
  classicNames(isScript() && !on ? book?.fields?.classicNames : null);
  if (on) await loadPlaces(book);
  if (!on) scenePop?.close();
  wovenPick();
}

async function loadPlaces(book) {
  const world = book ? await worldOf(book) : null;
  if (!world) { biblePlaces = []; return; }
  const pages = [
    ...(await elementsIn(world)).filter((p) => p.fields?.element?.type === 'location'),
    ...(await plainPages(world)).filter((x) => x.guess === 'location').map((x) => x.page)
  ];
  biblePlaces = pages.filter((p) => (p.title || '').trim() && !/^(places|locations|sets)$/i.test(p.title.trim())).map((p) => ({
    name: p.title.trim(), ie: p.fields?.place?.ie || '', also: p.fields?.place?.also || [], notime: !!p.fields?.place?.notime, page: p.id
  }));
}

async function setWoven(on) {
  const b = await currentBook();
  if (!b || bookType(b) !== 'screenplay') return;
  const fresh = await getEntry(b.id);
  if (!!fresh.fields?.woven === on) return;
  const next = { ...fresh, fields: { ...fresh.fields, woven: on }, updated_at: Date.now() };
  await putEntries([next]);
  if (state.project?.id === b.id) state.project = next;
  await syncWoven(next);
  if (on) guessAll(editor); else redrawWoven(editor);
  notes.layout();
  toast(on ? 'Woven: the scene headings are hidden as faint lines. Classic shows them again.' : 'Classic: the standard screenplay page. Your Woven titles stay as sections.');
}

// Classic's name colour: plain ink unless picked (its own, so Woven's blue
// names don't come along). Only the screen: the PDF and Fountain stay black.
function classicNames(c) {
  if (c && c !== 'ink') root.style.setProperty('--classic-name-c', nameColour(c));
  else root.style.removeProperty('--classic-name-c');
}

async function saveNames(c) {
  const b = await currentBook();
  if (!b) return;
  const fresh = await getEntry(b.id);
  const fields = isWoven()
    ? { ...fresh.fields, look: { ...cleanLook(fresh.fields?.look || DEFAULT_LOOK), names: c } }
    : { ...fresh.fields, classicNames: c };
  const next = { ...fresh, fields, updated_at: Date.now() };
  await putEntries([next]);
  if (state.project?.id === b.id) state.project = next;
  if (isWoven()) applyLook(root, next.fields.look); else classicNames(c);
  wovenPick();
}

async function saveLook(look) {
  const b = await currentBook();
  if (!b) return;
  const fresh = await getEntry(b.id);
  const next = { ...fresh, fields: { ...fresh.fields, look: cleanLook(look) }, updated_at: Date.now() };
  await putEntries([next]);
  if (state.project?.id === b.id) state.project = next;
  if (isWoven()) applyLook(root, next.fields.look);
}

// The Aa panel's part for the script that's open: Woven or Classic, and its look.
function wovenPick() {
  const box = $('.woven-pick');
  if (!box) return;
  const script = writing() && isScript();
  box.hidden = !script;
  if (!script) return;
  box.querySelectorAll('[data-sv]').forEach((b) => {
    const cur = (b.dataset.sv === 'woven') === isWoven();
    b.classList.toggle('current', cur);
    b.setAttribute('aria-checked', String(cur));
  });
  const names = box.querySelector('.woven-names');
  names.dataset.prop = isWoven() ? '--wv-name-c' : '--classic-name-c';
  renderNames(names, isWoven() ? cleanLook(state.project?.fields?.look || DEFAULT_LOOK).names : (state.project?.fields?.classicNames || 'ink'), (c) => saveNames(c));
  const look = box.querySelector('.woven-look');
  look.hidden = !isWoven();
  if (isWoven()) renderLook(look, {
    look: () => state.project?.fields?.look || DEFAULT_LOOK,
    save: (l) => saveLook(l),
    canAsk: canAskServer,
    toast,
    ask: async (text) => {
      const got = await askServer({ mode: 'woven', task: 'look', describe: text, piece: state.project?.title || '' });
      if (got?.error) throw new Error(got.error);
      return got?.look || null;
    }
  });
}

let scenePop; // set in wireManuscript()
let scenePlan; // the plan under the scene line, set in wireManuscript()
let novelPlan; // a novel's: under the chapter's name and each scene break (novelplan.js)
// A novel (any book that isn't a script) has its chapter open in Write.
const novelOn = () => !isScript() && !!store.chapter && !!state.project;
// The plan for what's open: a Woven script's, a novel's, or none.
const activePlan = () => (isWoven() ? scenePlan : novelOn() ? novelPlan : null);

// ---------- keeping a line still (Michael, Nov 20 2026) ----------

// "I don't want the screen jumping around on me and things moving underneath
// my mouse": when titles or plans come and go, the line you tapped (or the
// one under the pointer, or the caret's scene) stays at the same height on
// the screen. The scroll follows it, with room added at the very top when the
// page can't scroll up far enough.
let pad = 0;
let pointerY = null;
function steadyPad(px) {
  pad = Math.max(0, px);
  editor.view.dom.style.marginTop = pad ? `${pad}px` : '';
}
const lineEl = (k) => editor.view.dom.querySelector(`.wv-line[data-key="${CSS.escape(k)}"]`);
function anchorKey() {
  const lines = [...editor.view.dom.querySelectorAll('.wv-line')].filter((l) => { const r = l.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  if (pointerY !== null && lines.length) return lines.sort((a, b) => Math.abs(a.getBoundingClientRect().top - pointerY) - Math.abs(b.getBoundingClientRect().top - pointerY))[0].dataset.key;
  const s = sceneAt(editor.state.doc, editor.state.selection.from);
  const k = s ? lineKey(s) : null;
  if (k && lines.some((l) => l.dataset.key === k)) return k;
  return lines[0]?.dataset.key || k;
}
function steady(change, key) {
  const k = key || anchorKey();
  const before = k && lineEl(k)?.getBoundingClientRect().top;
  change();
  const el = k && lineEl(k);
  if (before == null || !el) return;
  document.dispatchEvent(new CustomEvent('inkwell:calm-scroll'));
  const off = () => lineEl(k).getBoundingClientRect().top - before;
  let d = off();
  if (Math.abs(d) < 0.5) return;
  window.scrollBy(0, d);
  d = off();
  // Above where it was and the page is at its top: room at the top.
  if (d < -0.5) { steadyPad(pad - d); window.scrollBy(0, off()); }
  // Below where it was with room at the top to give back.
  else if (d > 0.5 && pad > 0) { steadyPad(pad - Math.min(pad, d)); window.scrollBy(0, off()); }
}
// Titles on or off, the line under the pointer (or the caret's scene) kept still.
function steadyTitles() { scenePlan.titlesFrom({ key: null }); }
const titlesShowing = () => (root.classList.contains('focus') ? root.classList.contains('focus-sections') : !root.classList.contains('hide-sections'));

// The card for the scene the caret is in (the same one a tap on the scene line opens).
function sceneDetails() {
  const s = sceneAt(editor.state.doc, editor.state.selection.from);
  if (!s) return;
  const dom = s.eid ? editor.view.dom.querySelector(`.wv-line[data-eid="${s.eid}"] .wv-bar`) : editor.view.dom.querySelector('.wv-line.wv-top .wv-bar');
  scenePop.open({ eid: s.eid, at: s.at }, dom);
}

// /continuous, /intercut, /flashback, /montage: the scene you're in becomes one.
function markScene(kind) {
  let s = sceneAt(editor.state.doc, editor.state.selection.from);
  if (!s) return;
  const pos = s.node ? s.pos : ensureHeading(editor, s);
  s = sceneAt(editor.state.doc, pos + 1);
  const m = { ...s.marker, kind };
  if (kind === 'continuous' && !m.place) {
    // Straight on: the same place as the scene before.
    const all = scenesOf(editor.state.doc);
    const prev = all[all.findIndex((x) => x.pos === pos) - 1];
    if (prev?.marker.place) { m.place = prev.marker.place; m.ie ||= prev.marker.ie; }
  }
  if (kind !== 'continuous' && s.marker.kind === 'continuous') m.time = '';
  setMarker(editor, pos, m);
  toast(`Scene ${s.node?.attrs.code || s.n}: ${SCENE_KINDS.find((k) => k.id === kind)?.label.toLowerCase()}`);
}

async function prepareShoot() {
  if (!isWoven()) return;
  const world = state.project ? await worldOf(state.project) : null;
  const { prepareForShoot } = await import('../wovenprep.js');
  await prepareForShoot({
    editor,
    places: (doc) => placeList(biblePlaces, doc),
    biblePlaces: () => biblePlaces,
    piece: () => state.project?.title || '',
    canAsk: canAskServer,
    ask: async (body) => { const got = await askServer(body); if (got?.error) throw new Error(got.error); return got; },
    toast,
    makePlaces: async (list) => {
      if (!world) throw new Error('This script isn’t in a world yet, so there’s no bible to add places to.');
      for (const p of list) {
        const page = await newElement(world, 'location', p.name);
        if (p.ie) await putEntries([{ ...page, fields: { ...page.fields, place: { ie: p.ie } }, updated_at: Date.now() }]);
      }
      await loadPlaces(state.project);
      redrawWoven(editor);
      await refreshViews();
      toast(`${list.length === 1 ? 'A place page' : `${list.length} place pages`} made in ${world.title || 'the world'}’s bible`);
    }
  });
}

async function toggleNumbering(piece) {
  const b = await getEntry(piece.id);
  const on = !b.fields?.numbered;
  if (on) {
    const ok = await ask({
      title: `Number the scenes in “${nameOf(b)}”?`,
      body: 'Each scene heading gets a number that never changes, so file names, shot lists and notes keep pointing at the right scene. A scene you add later between 3 and 4 becomes 3A. Do this when the script is heading into production; nothing else about the script changes, and you can hide the numbers any time.',
      ok: 'Number the scenes'
    });
    if (!ok) return;
  }
  const open = state.project?.id === b.id && state.chapterId;
  if (open) await store.close(editor.state.doc);
  const next = { ...b, fields: { ...b.fields, numbered: on }, updated_at: Date.now() };
  const rows = [next];
  if (on) {
    // Every chapter of the script in order, as one run of scenes.
    const scenes = [];
    for (const ch of (await outline(b.id)).flatMap((a) => a.chapters)) scenes.push(...(await children(ch.id)).filter((r) => r.kind === 'para' && r.fields?.el === 'scene' && (r.text || '').trim()));
    const codes = assignCodes(scenes.map((r) => r.fields?.code || null));
    scenes.forEach((r, i) => { if (r.fields?.code !== codes[i]) rows.push({ ...r, fields: { ...r.fields, code: codes[i] }, updated_at: Date.now() }); });
  }
  await putEntries(rows);
  if (state.project?.id === b.id) {
    state.project = next;
    root.classList.toggle('numbered', on);
    if (open) {
      numbering = on ? await numberingAround(next, state.chapterId) : { before: null, after: null, used: [] };
      editor.commands.setContent(await store.refresh(), { emitUpdate: false });
      renderScenes();
    }
  }
  await refreshViews();
  toast(on ? `Scenes numbered in “${nameOf(b)}”` : 'Scene numbers are hidden. They come back as they were if you turn them on again.');
}

// The Inkwell connector: an address that lets Claude, in any Claude chat,
// read Inkwell and add to it (new lines and pages, marked as Claude's). Only a
// fingerprint of it is kept, so it's shown once; making a new one turns the
// old one off.
async function connectClaude() {
  if (!sync.user || !sync.backend?.rpc) { toast('Sign in to sync first: the connector reaches Inkwell through your cloud copy.'); return; }
  const ok = await ask({
    title: 'Connect Claude to Inkwell?',
    body: 'You get an address to add in Claude as a custom connector (Settings, then Connectors, then Add custom connector). Claude can then read your worlds, pages and drafts from any chat, and add lines and pages, marked as written by Claude. It never changes or deletes what you wrote. Anyone with the address can do the same, so keep it private. Making a new address turns off the old one.',
    ok: 'Make my address'
  });
  if (!ok) return;
  let token;
  try { token = await sync.backend.rpc('new_inkwell_mcp_token'); } catch (e) { console.error(e); toast('Couldn’t make an address. Check your connection and try again.'); return; }
  const got = await showCopy({
    title: 'Your Inkwell connector address',
    body: 'It’s only shown this once, so copy it now and paste it into Claude.',
    value: `${sync.backend.functionsUrl}/inkwell-mcp/${token}`,
    extra: { label: 'Turn off Claude’s access', danger: true }
  });
  if (got === 'extra') {
    try { await sync.backend.rpc('revoke_inkwell_mcp_token'); toast('Claude’s access to Inkwell is off'); } catch { toast('Couldn’t turn it off. Try again.'); }
  }
}

// Scribe, the dictation app: Scribe opens Inkwell at ?connect=scribe, and this
// makes a secret for that device and hands it back to the app. Each device
// has its own; connecting the same one again replaces its old secret.
async function connectScribe() {
  const user = sync.user || await sync.backend?.user?.().catch(() => null);
  if (!user || !sync.backend?.rpc) { toast('Sign in to sync first: Scribe connects through your Inkwell account.'); return; }
  const android = /Android/i.test(navigator.userAgent);
  const ok = await ask({
    title: android ? 'Connect Scribe on this phone?' : 'Connect Scribe?',
    body: 'Scribe, your dictation keyboard, can then write out what you say and have Claude tidy it. It only uses your account for that; it can’t read your writing.',
    ok: 'Connect'
  });
  if (!ok) return;
  let token;
  try { token = await sync.backend.rpc('new_scribe_token', { device: android ? 'phone' : 'computer' }); } catch (e) { console.error(e); toast('Couldn’t connect Scribe. Check your connection and try again.'); return; }
  const query = `token=${token}&url=${encodeURIComponent(sync.backend.functionsUrl)}`;
  if (android) {
    // Opening the app needs a tap, so it's its own button.
    const go = await ask({ title: 'Scribe is connected', body: 'Go back to Scribe to finish.', ok: 'Open Scribe' });
    if (go) location.href = `intent://connect?${query}#Intent;scheme=scribe;package=com.laserbunny.scribe;end`;
    return;
  }
  await showCopy({ title: 'Scribe connection link', body: 'Paste this into Scribe on your computer. It’s only shown once.', value: `scribe://connect?${query}` });
}

// What links to this chapter, shown after its last paragraph.
async function renderChapterLinks() {
  if (!state.chapterId) return;
  const n = await renderLinkedFrom(state.chapterId, $('.chapter-links'), $('#chapter-links-list'), openEntry);
  const chip = $('#chapter-links-chip');
  chip.hidden = !n || view() !== 'write';
  chip.textContent = `Linked from ${n}`;
}

function refreshWords() {
  if (view() !== 'write') { $('#words').textContent = ''; return; }
  if (isScript()) { const n = scriptPages(editor.state.doc); $('#words').textContent = `About ${n} page${n === 1 ? '' : 's'}`; return; }
  $('#words').textContent = `${docWords(editor.state.doc).toLocaleString()} words`;
}

async function newChapter() {
  if (!state.project) return;
  const act = state.acts.find((a) => a.chapters.some((c) => c.id === state.chapterId)) || state.acts.at(-1);
  if (!act) return newAct();
  const level = state.project.fields?.levels?.[1] || 'Chapter';
  const count = state.acts.reduce((n, a) => n + a.chapters.length, 0);
  const ch = entry('chapter', { parent_id: act.id, title: `${level} ${count + 1}`, sort: (act.chapters.at(-1)?.sort || 0) + 1 });
  await putEntries([ch]);
  state.acts = await outline(state.project.id);
  await openChapter(ch.id);
}

async function newAct() {
  if (!state.project) return;
  const level = state.project.fields?.levels?.[0] || 'Act';
  const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  const act = entry('act', { parent_id: state.project.id, title: `${level} ${names[state.acts.length] || state.acts.length + 1}`, sort: (state.acts.at(-1)?.sort || 0) + 1 });
  const chLevel = state.project.fields?.levels?.[1] || 'Chapter';
  const count = state.acts.reduce((n, a) => n + a.chapters.length, 0);
  const ch = entry('chapter', { parent_id: act.id, title: `${chLevel} ${count + 1}`, sort: 1 });
  await putEntries([act, ch]);
  state.acts = await outline(state.project.id);
  await openChapter(ch.id);
}

// Its commands in the box (Ctrl + K); commandinfo.js has their hints and words.
addCommands(() => [
  { group: 'write', label: 'Script view: Woven (flowing, scene headings hidden)', keys: '', words: ['woven', 'flowing', 'prose', 'quiet', 'view'], run: () => setWoven(true), when: () => writing() && isScript() && !isWoven() },
  { group: 'write', label: 'Script view: Classic (the standard screenplay page)', keys: '', words: ['woven', 'classic', 'standard', 'view', 'courier'], run: () => setWoven(false), when: () => writing() && isWoven() },
  { group: 'write', label: 'Woven: this scene’s place, time and title…', keys: '/scene', words: ['scene', 'place', 'time', 'slug', 'heading', 'title'], run: sceneDetails, when: () => writing() && isWoven() },
  { group: 'write', label: 'Plan under every scene (open or fold them all)', keys: '⌘⇧,', words: ['plan', 'summary', 'summaries', 'threads', 'outline', 'unfold', 'fold', 'beats'], run: () => activePlan()?.toggleAll(), when: () => writing() && !!activePlan() },
  { group: 'write', label: 'Woven: prepare for shoot (fill in every scene’s place and time)', keys: '', words: ['shoot', 'production', 'slug', 'headings', 'breakdown', 'claude'], run: prepareShoot, when: () => writing() && isWoven() },
  { group: 'write', label: 'Scene numbers: turn off', keys: '', run: async () => toggleNumbering(await currentBook()), when: () => writing() && isScript() && !!state.project?.fields?.numbered },
  { group: 'sync', label: 'Connect Claude to Inkwell (a connector address)…', keys: '', run: () => connectClaude() },
  { group: 'sync', label: 'Connect Scribe, the dictation keyboard…', keys: '', run: () => connectScribe() }
]);

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireManuscript() {
  document.querySelectorAll('.woven-pick [data-sv]').forEach((b) => b.addEventListener('click', () => setWoven(b.dataset.sv === 'woven')));
  scenePop = new ScenePop({ editor: () => editor, places: () => placeList(biblePlaces, editor.state.doc), toast: (m, a) => toast(m, a), touch: () => matchMedia('(pointer: coarse)').matches });
  scenePlan = new ScenePlan({
    editor: () => editor,
    notes,
    project: () => state.project,
    world: async () => (state.project ? worldOf(state.project) : null),
    toast: (m, a) => toast(m, a),
    scenePop,
    touch: () => matchMedia('(pointer: coarse)').matches,
    titles: titlesShowing,
    toggleTitles: () => toggleSections(),
    openShots: async (eid) => { const list = await shotsUnder(eid); if (state.project) go({ view: 'production', id: state.project.id, tab: 'shots', ...(list[0] ? { shot: list[0].id } : {}) }); },
    steady,
    openRef: (id) => openEntry(id),
    onLines: (ed) => planLinesFocus(ed, scenePlan.lines)
  });
  novelPlan = new NovelPlan({
    editor: () => editor,
    notes,
    project: () => state.project,
    world: async () => (state.project ? worldOf(state.project) : null),
    toast: (m, a) => toast(m, a),
    touch: () => matchMedia('(pointer: coarse)').matches,
    titles: titlesShowing,
    toggleTitles: () => toggleSections(),
    openRef: (id) => openEntry(id),
    onLines: (ed) => planLinesFocus(ed, novelPlan.lines),
    on: novelOn,
    chapter: () => store.chapter,
    chapterN: () => state.acts.flatMap((a) => a.chapters).findIndex((c) => c.id === store.chapter?.id) + 1,
    chapterWord: () => state.project?.fields?.levels?.[1] || 'Chapter',
    head: () => $('.nv-head'),
    saveChapter: async (fn) => {
      const ch = store.chapter;
      if (!ch) return;
      const fresh = (await getEntry(ch.id)) || ch;
      const change = fn(fresh);
      // The store keeps this same chapter object: change it in place.
      Object.assign(ch, fresh, change, { updated_at: Date.now() });
      await putEntries([{ ...ch }]);
      // A new name shows at the top; a summary is already where it was typed.
      if (change.title) { state.acts = await outline(state.project.id); renderRail(); renderCrumb(); novelPlan.drawHead(); }
    }
  });
  notes.inPlan = (n) => novelPlan.inPlan(n);
  document.addEventListener('inkwell:note-lines', (e) => { activePlan()?.showNoteLines(e.detail); });
  editor.view.dom.addEventListener('mousemove', (e) => { pointerY = e.clientY; });
  editor.view.dom.addEventListener('mouseleave', () => { pointerY = null; });
  $('#chapter-links-chip').addEventListener('click', () => $('.chapter-links').scrollIntoView({ behavior: 'smooth', block: 'center' }));
}

export { activePlan, biblePlaces, novelPlan, scenePlan, steadyTitles, connectScribe, markScene, newAct, newChapter, numbering, openChapter, refreshWords, renderChapterLinks, sceneDetails, scenePop, syncWoven, toggleNumbering, wireManuscript, wovenPick };
