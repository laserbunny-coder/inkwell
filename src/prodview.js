import { media } from './device.js';
import { getEntry, getMany, putEntries, byKind } from './db.js';
import { tagsIn, entry, newId } from './model.js';
import { loadStructure, rowsAt } from './grid.js';
import { bookType, hasManuscript, worldOf, stageSetOf, toolsOf, toolsIn } from './library.js';
import { addFile, fileUrl, fileBlob, thumbUrl, isImage } from './files.js';
import { zip } from './vault.js';
import { download } from './export.js';
import {
  ELEMENT_TYPES, typeOf, elementsIn, newElement, setElement, namesOf,
  findElements, sceneElements, changeBreakdown, sceneSig, shotCode, newShot, shotStage, SHOT_STAGES, stillOf,
  withRenders, withPrompts, isVideo, shotForName, shootDays, newShootDay, shootDayTask, toCsv, toSrt, speechesIn, PLATFORMS,
  MADE_BY, madeBy, isFilmed, gotIt, shotStatus, needsFootage, AUDIO, audioOf, toPlan,
  viewSlots, toolIdsOf, rulesOf, genOf, secsOf, runsOf,
  PRICES_ID, priceList, priceOf, pricesChecked, estimate, spent, money, toEdl, cutEvents, lookOf
} from './production.js';
import { make } from './dom.js';
import { resolve as linesOf, linesIn } from './shotlines.js';
import { sceneTitle } from './scenename.js';
import { picturesOnScene, picturesText } from './picturesin.js';

// The production view of a piece (Ctrl + Shift + S): its scenes, each with
// the elements it uses and its shots; a storyboard of the stills picked;
// the world's kit; shoot days and their call sheets; and posting. Like the
// plot grid, nothing here is a copy: a scene is the scene heading in the
// script, the kit is the world's bible pages.

const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* full */ } };
// Make: the shots and what they need. Deliver: what goes out (files, a share
// link, posting). Both are this view, with different tabs.
export const TABS = [
  { id: 'shots', label: 'Shots' },
  { id: 'board', label: 'Storyboard' },
  { id: 'kit', label: 'Cast and places' },
  { id: 'days', label: 'Shoot days' }
];
// Deliver is one page (Studio polish, build 5): the script to readers, the
// film to the edit, the finished film out. These ids are where a door or an
// old saved place lands on it: share is The script, files For the edit, post Out.
export const DELIVER_TABS = [
  { id: 'share', label: 'The script', group: 'script' },
  { id: 'files', label: 'For the edit', group: 'edit' },
  { id: 'post', label: 'Out', group: 'out' }
];
const PROD_NOTES = ['production', 'ai'];
const initials = (t) => (t || '').split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w) && !/^(the|a|an|of|and|vs\.?)$/i.test(w)).map((w) => w[0]).join('').toUpperCase().slice(0, 4);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// "07:30" as people say it: "7:30 am".
const clock = (hm) => { const [h, m] = String(hm).split(':').map(Number); return Number.isFinite(h) ? `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` : hm; };
const extOf = (name, type) => (/\.([a-z0-9]{1,5})$/i.exec(name || '')?.[1] || (type || '').split('/')[1] || 'bin').toLowerCase();

export class ProductionView {
  // hooks: open(row), openPage(id), leave(piece), changed(rows), menu,
  // menuButton, ask, askText, toast, askServer, canAsk, numberScenes(piece), go(place),
  // base().
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.piece = null;
    this.open = new Set();
    this.busy = Promise.resolve();
    this.timers = new Map();
    this.touch = media('touch');
    this.dayId = null;
    el.addEventListener('dragover', (e) => { if (this.isOpen && [...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
    el.addEventListener('drop', (e) => this.dropAnywhere(e));
  }

  get isOpen() { return !!this.piece && ['production', 'deliver'].includes(document.documentElement.dataset.view); }
  get tabs() {
    if (this.mode === 'deliver') return DELIVER_TABS;
    const on = TABS.filter((t) => !this.tools || this.tools.includes(t.id));
    return on.length ? on : TABS;
  }
  get tabKey() { return this.mode === 'deliver' ? 'deliverTab' : 'prodTab'; }
  get tab() { const t = pref(this.tabKey, this.tabs[0].id); return this.tabs.some((x) => x.id === t) ? t : this.tabs[0].id; }

  async show(pieceId, opts = {}) {
    this.piece = await getEntry(pieceId);
    this.healed = null;
    this.mode = opts.mode === 'deliver' || DELIVER_TABS.some((t) => t.id === opts.tab) ? 'deliver' : 'make';
    if (opts.tab && this.mode !== 'deliver') setPref(this.tabKey, opts.tab);
    this.landAt = this.mode === 'deliver' ? DELIVER_TABS.find((t) => t.id === opts.tab)?.group || null : null;
    if (opts.shot) this.open.add(opts.shot);
    if (opts.day) { this.dayId = opts.day; setPref('prodTab', 'days'); }
    await this.render();
    if (opts.shot) this.el.querySelector(`[data-shot="${CSS.escape(opts.shot)}"]`)?.scrollIntoView({ block: 'center' });
    this.el.dataset.land = this.landAt || '';
    if (this.landAt) this.el.querySelector(`.pd-group[data-group="${this.landAt}"]`)?.scrollIntoView({ block: 'start' });
  }

  // Again after a change here or from another device, unless something is
  // being typed: that waits until it's done.
  refresh() {
    if (!this.piece) return this.busy;
    const a = document.activeElement;
    if (this.el.contains(a) && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) { this.stale = true; return this.busy; }
    return this.render();
  }

  render() {
    this.busy = this.busy.then(() => this.draw()).catch((e) => console.error(e));
    return this.busy;
  }

  // ---------- reading ----------

  async load() {
    const piece = (this.piece = await getEntry(this.piece.id));
    if (!piece || piece.deleted) return false;
    this.world = await worldOf(piece);
    // A show gets a code from its name the first time (Ninja Bunch is NB);
    // change it before any files are named.
    if (this.world && !this.world.fields?.production?.code && initials(this.world.title)) {
      const w = await getEntry(this.world.id);
      this.world = { ...w, fields: { ...w.fields, production: { ...(w.fields?.production || {}), code: initials(w.title) } }, updated_at: Date.now() };
      await putEntries([this.world]);
    }
    this.script = bookType(piece) === 'screenplay';
    // Your own workflow behaves like the set it came from (shots in one made
    // from Live action start as live action).
    const set = stageSetOf(piece, this.world);
    this.set = set.own ? set.base : set.id;
    const st = hasManuscript(piece) ? await loadStructure(piece) : { acts: [], pieces: [] };
    this.items = st.acts.length ? rowsAt(this.script ? 'slug' : 'scene', st, piece) : [];
    // A script's scenes go by their own names (the Woven title, or the first
    // words), never their slug lines; the slug stays as a faint aside. A
    // scene's title section is part of its name, not a group of its own.
    if (this.script && st.acts.length) {
      const named = new Map(rowsAt('wscene', st, piece).filter((r) => r.type === 'row' && r.kind === 'scene').map((r) => [r.id, r]));
      this.items = this.items.filter((x) => x.type !== 'group' || (x.depth || 1) < 3);
      let n = 0;
      for (const x of this.items) {
        if (x.type !== 'row') continue;
        n += 1;
        const w = named.get(x.id);
        x.slug = x.kind === 'slug' ? x.title : '';
        x.n = String(x.code || w?.n || n);
        x.title = sceneTitle({ title: w?.name || '', first: w?.first || '' }) || (x.kind === 'slug' ? `Scene ${x.n}` : x.title);
      }
    } else {
      let n = 0;
      for (const x of this.items) if (x.type === 'row') { n += 1; x.slug = ''; x.n = String(x.code || n); }
    }
    const scenes = this.items.filter((x) => x.type === 'row');
    const texts = new Map();
    for (const act of st.acts) for (const ch of act.chapters) for (const r of ch.rows) texts.set(r.id, r);
    this.texts = texts;
    this.elements = await elementsIn(this.world);
    this.elById = new Map(this.elements.map((e) => [e.id, e]));
    const ids = new Set(scenes.map((s) => s.id));
    const members = new Map();
    for (const s of scenes) for (const m of s.members) members.set(m, s.id);
    const shots = (await byKind('shot')).sort((a, b) => a.sort - b.sort);
    // Once each time the piece is opened (it reads every file's entry).
    if (this.healed !== piece.id) { this.healed = piece.id; await this.heal(shots, piece); }
    this.allShots = shots;
    this.pricesRow = await getEntry(PRICES_ID);
    this.prices = priceList(this.pricesRow);
    this.shotsOf = new Map();
    this.lost = [];
    for (const sh of shots) {
      if (ids.has(sh.parent_id)) { if (!this.shotsOf.has(sh.parent_id)) this.shotsOf.set(sh.parent_id, []); this.shotsOf.get(sh.parent_id).push(sh); }
      else if (sh.fields?.piece === piece.id) this.lost.push(sh);
    }
    this.bds = new Map((await byKind('breakdown')).filter((b) => ids.has(b.parent_id)).map((b) => [b.parent_id, b]));
    this.notesOf = new Map();
    for (const n of await byKind('note')) {
      const s = members.get(n.parent_id);
      if (!s || !PROD_NOTES.includes(n.type) || !(n.text || '').trim()) continue;
      if (!this.notesOf.has(s)) this.notesOf.set(s, []);
      this.notesOf.get(s).push(n);
    }
    // Each scene's words, its elements and whether it changed since its shots.
    for (const s of scenes) {
      const rows = s.members.map((id) => texts.get(id)).filter(Boolean);
      s.rows = rows;
      s.text = rows.map((r) => (r.kind === 'scene' ? r.title || '' : r.text || '')).filter((t) => t.trim()).join('\n');
      s.sig = sceneSig(rows.map((r) => r.text || r.title || ''));
      const cues = rows.filter((r) => r.fields?.el === 'character').map((r) => r.text || '');
      s.found = findElements(s.text + '\n' + (this.notesOf.get(s.id) || []).map((n) => n.text).join('\n'), cues, this.elements);
      s.bd = this.bds.get(s.id) || null;
      s.uses = sceneElements(s.found, s.bd).filter((id) => this.elById.has(id));
      s.shots = this.shotsOf.get(s.id) || [];
      s.audio = audioOf(s.bd, this.world);
      s.talk = this.script ? speechesIn(rows).length > 0 : false;
      s.changed = s.shots.length > 0 && !!s.bd?.fields?.sig && s.bd.fields.sig !== s.sig;
    }
    // The tools on Make come from the workflow; a piece that already has
    // shots keeps them even if its workflow has none.
    this.setTools = toolsIn(stageSetOf(piece, this.world), this.world);
    this.tools = toolsOf(piece, this.world);
    if (!this.tools.length && (scenes.some((s) => s.shots.length) || this.lost.length)) this.tools = TABS.map((t) => t.id);
    // Which renders are videos, for the storyboard's stills.
    const fileIds = new Set();
    for (const sh of shots) for (const t of sh.fields?.tries || []) for (const id of t.files || []) fileIds.add(id);
    this.kindOf = new Map((await getMany([...fileIds])).filter(Boolean).map((f) => [f.id, isVideo(f.fields?.type) ? 'video' : 'still']));
    // Every shot's code, for finding the shot a file name belongs to.
    this.codes = new Map();
    for (const s of scenes) for (const sh of s.shots) this.codes.set(this.codeOf(sh, s), sh.id);
    this.scenes = scenes;
    // How this film is made decides what shows (no switches): generation
    // details, cost and Claude's prompts only where something is generated.
    for (const sc of scenes) sc.gen = sc.shots.some((sh) => !isFilmed(sh, this.set));
    this.anyGen = scenes.some((sc) => sc.gen) || this.lost.some((sh) => !isFilmed(sh, this.set));
    this.aiFilm = this.set !== 'live';
    return true;
  }

  // A render whose shot lost it (the shot was saved on another device at the
  // same moment, and that copy won) goes back on its shot as a try of its own.
  async heal(shots, piece) {
    const mine = new Map(shots.filter((sh) => sh.fields?.piece === piece.id || !sh.fields?.piece).map((sh) => [sh.id, sh]));
    if (!mine.size) return;
    const lost = new Map();
    for (const f of await byKind('file')) {
      const sh = mine.get(f.fields?.shot);
      if (!sh || f.deleted || f.fields?.trashed) continue;
      if ((sh.fields?.tries || []).some((t) => (t.files || []).includes(f.id))) continue;
      if (!lost.has(sh.id)) lost.set(sh.id, []);
      lost.get(sh.id).push(f);
    }
    const rows = [];
    for (const [id, files] of lost) {
      const fresh = await getEntry(id);
      if (!fresh || fresh.deleted) continue;
      const tries = [...(fresh.fields?.tries || []), { id: newId('tr'), at: Math.min(...files.map((f) => f.created_at || Date.now())), by: files[0].fields?.by || 'me', still: '', video: '', files: files.map((f) => f.id), healed: true }];
      rows.push({ ...fresh, fields: { ...fresh.fields, tries }, updated_at: Date.now() });
    }
    if (!rows.length) return;
    await putEntries(rows);
    this.hooks.changed(rows);
    for (const r of rows) { const i = shots.findIndex((x) => x.id === r.id); if (i >= 0) shots[i] = r; }
  }

  codeOf(shot, scene) {
    return shotCode({ show: this.world?.fields?.production?.code, piece: this.piece.fields?.code, scene: scene?.code, shot: shot.fields?.n });
  }

  // ---------- drawing ----------

  async draw() {
    this.stale = false;
    if (!(await this.load())) return;
    const piece = this.piece;
    const head = make('div', 'gv-head');
    head.append(make('h1', 'gv-title', piece.title || 'Untitled'));
    const tools = make('div', 'gv-tools');
    const back = make('button', 'ghost-btn gv-write', 'Write');
    back.title = this.mode === 'deliver' ? 'Back to the text' : 'Back to the text (Ctrl + Shift + S)';
    back.addEventListener('click', () => this.hooks.leave(piece));
    tools.append(back);
    if (this.mode !== 'deliver' && this.videoTools()) tools.append(this.hooks.menuButton(() => this.moreMenu(), 'More for production'));
    head.append(tools);
    if (this.mode !== 'deliver' && !this.videoTools()) { this.el.replaceChildren(head, this.notVideo()); return; }
    const sub = make('div', 'gv-sub');
    const tabs = make('div', 'gv-levels');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', this.mode === 'deliver' ? 'Deliver' : 'Make');
    for (const t of this.mode === 'deliver' ? [] : this.tabs) {
      const b = make('button', 'chip' + (t.id === this.tab ? ' on' : ''), t.label);
      b.setAttribute('role', 'tab');
      b.dataset.tab = t.id;
      b.setAttribute('aria-selected', String(t.id === this.tab));
      b.addEventListener('click', async () => { setPref(this.tabKey, t.id); await this.render(); this.hooks.moved?.(this.place()); });
      tabs.append(b);
    }
    if (this.mode !== 'deliver') sub.append(tabs);
    const body = make('div', 'pd-body');
    body.dataset.tab = this.mode === 'deliver' ? 'deliver' : this.tab;
    if (this.tab === 'shots') await this.drawShots(body);
    if (this.tab === 'board') await this.drawBoard(body);
    if (this.tab === 'kit') await this.drawKit(body);
    if (this.tab === 'days') await this.drawDays(body);
    if (this.mode === 'deliver') await this.drawDeliver(body);
    const panel = this.mode === 'deliver' ? null : this.claudePanel();
    this.el.replaceChildren(...[head, this.mode === 'deliver' ? null : sub, panel, body].filter(Boolean));
  }

  // Shots, storyboards and shoot days are for video. A book, a stage piece
  // or short writing doesn't get them unless it asks, or already has shots.
  videoTools() {
    return this.tools.length > 0;
  }

  notVideo() {
    const box = make('div', 'pd-notvideo');
    const set = stageSetOf(this.piece, this.world);
    const next = {
      book: 'A book’s own Make page is on the way: beta readers, edit, cover and formatting, then publish. Until then, Ctrl + P prints a clean copy for readers.',
      short: 'Short writing goes straight from Polished to Deliver, where you can share it or copy it out.',
      stage: 'A stage piece’s own Make page (cast, rehearsals, cues) is on the way.'
    }[set.id] || '';
    box.append(make('p', 'pd-notvideo-what', (set.tools || []).length
      ? `The tools on Make are turned off in this project’s workflow. Turn them back on from the project’s ⋯ menu, Workflow….`
      : `${this.piece.title || 'This piece'} goes through ${set.name} stages, so the video tools (shots, storyboard, shoot days) are put away.`));
    if (next) box.append(make('p', 'hint', next));
    const acts = make('div', 'pd-add');
    const stages = make('button', 'pill', 'Deliver');
    stages.addEventListener('click', () => this.hooks.go?.({ view: 'deliver', id: this.piece.id }));
    const show = make('button', 'ghost-btn', 'Use the video tools anyway');
    show.title = 'For a book trailer, say. Turn them off again from Make’s ⋯ menu.';
    show.addEventListener('click', () => this.setVideoTools(true));
    if (this.hooks.go) acts.append(stages);
    acts.append(show);
    box.append(acts);
    return box;
  }

  async setVideoTools(on) {
    const fresh = await getEntry(this.piece.id);
    const fields = { ...fresh.fields };
    if (on) fields.videoTools = true; else delete fields.videoTools;
    const row = { ...fresh, fields, updated_at: Date.now() };
    await putEntries([row]);
    this.hooks.changed([row]);
    await this.render();
    this.hooks.toast(on ? 'Video tools on for this piece' : 'Video tools put away', { label: 'Undo', run: () => this.setVideoTools(!on) });
  }

  // ---------- shots ----------

  async drawShots(body) {
    if (!this.scenes.length) {
      body.append(make('p', 'hint gv-empty', hasManuscript(this.piece) ? 'No scenes yet. Scene headings in the script (INT. / EXT.) become scenes here, each with its shots.' : 'Production works on a script or prose draft. This piece is an outline.'));
      return;
    }
    // Shot codes are set once, from ⋯ (Shot codes…); they show here only then.
    if (this.codesOpen) body.append(this.codesEl());
    body.append(this.summaryEl());
    if (this.script && !this.piece.fields?.numbered) {
      const note = make('div', 'pd-banner');
      note.append(make('span', '', 'Number the scenes so every shot gets a code that never changes.'));
      const b = make('button', 'pill', 'Number the scenes');
      b.addEventListener('click', () => this.hooks.numberScenes(this.piece));
      note.append(b);
      body.append(note);
    }
    for (const item of this.items) {
      if (item.type === 'group') { const g = make('div', 'pd-group', item.title); g.dataset.depth = item.depth || 1; body.append(g); continue; }
      body.append(this.sceneEl(item));
    }
    if (this.lost.length) {
      const box = make('section', 'pd-scene pd-lost');
      box.append(make('div', 'pd-scene-title', 'Shots whose scene is gone'), make('p', 'hint', 'Their scene heading was deleted or moved to another piece. Move each one to a scene, or delete it.'));
      const list = make('div', 'pd-shots');
      for (const sh of this.lost) list.append(this.shotEl(sh, null));
      box.append(list);
      body.append(box);
    }
    // What it costs: one quiet line at the bottom, only when something is generated.
    if (this.anyGen) body.append(this.costEl());
  }

  // "Shot with a camera · 5 shots · 2 still to get", or "AI video · 5 shots · 1 take picked".
  summaryEl() {
    const shots = this.scenes.flatMap((x) => x.shots);
    const filmed = shots.filter((sh) => isFilmed(sh, this.set));
    const left = filmed.filter((sh) => !gotIt(sh)).length;
    const takes = shots.filter((sh) => !isFilmed(sh, this.set) && sh.fields?.star?.video).length;
    const bits = this.aiFilm
      ? ['AI video', plural(shots.length, 'shot'), `${takes} ${takes === 1 ? 'take' : 'takes'} picked`]
      : ['Shot with a camera', plural(shots.length, 'shot'), filmed.length ? (left ? `${left} still to get` : 'all got') : ''];
    return make('p', 'pd-summary-line', bits.filter(Boolean).join(' · '));
  }

  codesEl() {
    const codes = make('div', 'pd-codes');
    codes.append(make('span', 'panel-label', 'Shot codes'));
    const show = this.codeInput(this.world?.fields?.production?.code || '', 'Show', 'NB', (v) => this.saveWorldProd({ code: v }));
    const pc = this.codeInput(this.piece.fields?.code || '', 'Piece', 'E01', (v) => this.savePiece({ code: v || null }));
    codes.append(show, make('span', 'pd-dash', '-'), pc, make('span', 'pd-dash', this.script ? '-S03-04' : '-04'));
    const done = make('button', 'ghost-btn', 'Done');
    done.addEventListener('click', () => { this.codesOpen = false; this.render(); });
    codes.append(done);
    codes.title = 'Shot codes go in file names on the NAS and clip names in Resolve. Set them before files are named; after that, leave them.';
    return codes;
  }

  codeInput(value, label, placeholder, save) {
    const i = make('input', 'pd-code-input');
    i.value = value;
    i.placeholder = placeholder;
    i.setAttribute('aria-label', `${label} code`);
    i.size = 4;
    i.addEventListener('change', () => save(i.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')));
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
    return i;
  }

  sceneEl(s) {
    const box = make('section', 'pd-scene' + (s.shots.length ? '' : ' empty'));
    box.dataset.scene = s.id;
    const head = make('div', 'pd-scene-head');
    // Its number, its name (opens the scene in the script with Shots on), and
    // the slug line small and faint beside it.
    head.append(make('span', 'pd-scene-n', s.n || ''));
    const title = make('button', 'pd-scene-title', s.title);
    title.title = 'Open this scene in the script, with its shots';
    title.addEventListener('click', () => this.openScene(s));
    head.append(title);
    if (s.slug) head.append(make('span', 'pd-slugline', s.slug));
    if (s.changed) {
      const ch = make('button', 'pd-changed', 'Changed since shots');
      ch.title = 'The scene was rewritten after its shots were planned. Check the shots, then mark them as matching.';
      ch.addEventListener('click', () => this.hooks.menu(ch, [
        { label: 'Open the scene', run: () => this.hooks.open(s) },
        { label: 'The shots still match', run: () => this.matched(s) }
      ]));
      head.append(ch);
    }
    const left = this.leftText(s);
    if (left) head.append(make('span', 'pd-left', left));
    if (s.talk && s.gen) {
      const au = make('button', 'pd-audio', AUDIO.find((a) => a.id === s.audio).label);
      au.title = 'How this scene’s voices are made';
      au.addEventListener('click', () => this.hooks.menu(au, this.audioMenu(s)));
      head.append(au);
    }
    head.append(this.hooks.menuButton(() => this.sceneMenu(s), `More for ${s.title}`));
    box.append(head);
    if (s.synopsis) box.append(make('p', 'pd-summary', s.synopsis));
    box.append(this.chipsEl(s));
    const notes = this.notesOf.get(s.id) || [];
    if (notes.length) {
      const ul = make('ul', 'pd-notes');
      for (const n of notes) ul.append(make('li', '', n.text));
      box.append(ul);
    }
    const list = make('div', 'pd-shots');
    for (const sh of s.shots) list.append(this.shotEl(sh, s));
    box.append(list);
    const add = make('div', 'pd-add');
    const plus = make('button', 'ghost-btn', '+ Shot');
    plus.addEventListener('click', () => this.addShot(s));
    const pics = make('label', 'ghost-btn pd-addpics', '+ Pictures');
    pics.title = 'Several at once: they fill this scene’s shots without a picture, in order, then make new shots';
    const pin = make('input');
    pin.type = 'file';
    pin.accept = 'image/*';
    pin.multiple = true;
    pin.hidden = true;
    pin.addEventListener('change', async () => {
      const files = [...(pin.files || [])];
      pin.value = '';
      if (!files.length) return;
      const r = await picturesOnScene(s.id, files, { pieceId: this.piece.id });
      await this.render();
      this.hooks.toast(picturesText(r), r.filled + r.made ? { label: 'Undo', run: async () => { await r.undo(); await this.render(); } } : undefined);
    });
    pics.append(pin);
    add.append(plus, pics);
    if (this.hooks.canAsk()) {
      const sug = make('button', 'ghost-btn', s.shots.length ? 'Claude: more shots' : 'Claude: suggest shots');
      sug.addEventListener('click', () => this.suggestShots(s));
      add.append(sug);
      if (s.gen) {
        const pr = make('button', 'ghost-btn', 'Claude: write prompts');
        pr.addEventListener('click', () => this.writePrompts(s));
        add.append(pr);
      }
    }
    box.append(add);
    return box;
  }

  // What is left in a scene: "2 of 3 still to get" (filmed), "1 of 2 takes picked" (generated).
  leftText(s) {
    if (!s.shots.length) return '';
    const filmed = s.shots.filter((sh) => isFilmed(sh, this.set));
    if (filmed.length) {
      const left = filmed.filter((sh) => !gotIt(sh)).length;
      return left ? `${left} of ${filmed.length} still to get` : 'All got';
    }
    return `${s.shots.filter((sh) => sh.fields?.star?.video).length} of ${s.shots.length} takes picked`;
  }

  // The scene in the script, with Shots on there.
  openScene(s) {
    try { localStorage.setItem(`shotsOn:${this.piece.id}`, '1'); } catch { /* private window */ }
    this.hooks.open(s);
  }

  chipsEl(s) {
    const row = make('div', 'pd-chips');
    const byType = [...s.uses].sort((a, b) => ELEMENT_TYPES.findIndex((t) => t.id === this.elById.get(a).fields.element.type) - ELEMENT_TYPES.findIndex((t) => t.id === this.elById.get(b).fields.element.type));
    for (const id of byType) {
      const el = this.elById.get(id);
      const t = el.fields.element.type || 'other';
      const c = make('button', 'pd-chip');
      c.dataset.type = t;
      c.textContent = el.title || 'Untitled';
      c.title = `${typeOf(t).label}${s.found.includes(id) ? ' · found in the scene' : ' · added'}`;
      c.addEventListener('click', () => this.hooks.menu(c, [
        { label: `Open “${el.title}”`, run: () => this.hooks.openPage(el.id) },
        { label: 'Take out of this scene', run: () => this.dropElement(s, id) }
      ]));
      row.append(c);
    }
    const add = make('button', 'pd-chip add', '+');
    add.title = 'Add an element to this scene';
    add.setAttribute('aria-label', 'Add an element to this scene');
    add.addEventListener('click', () => this.hooks.menu(add, this.addElementMenu(s)));
    row.append(add);
    if (!s.uses.length) row.append(make('span', 'hint pd-chips-hint', this.elements.length ? 'No elements found in this scene' : 'Characters, places and props from Cast and places show here'));
    return row;
  }

  addElementMenu(s) {
    const items = [];
    for (const t of ELEMENT_TYPES) {
      const els = this.elements.filter((e) => (e.fields.element.type || 'other') === t.id && !s.uses.includes(e.id));
      if (els.length) items.push({ label: t.plural, sub: els.map((e) => ({ label: e.title || 'Untitled', run: () => this.addElement(s, e.id) })) });
    }
    items.push({ label: 'New element…', run: async () => { const el = await this.askNewElement(); if (el) await this.addElement(s, el.id); } });
    return items;
  }

  async askNewElement(type = null, name = '') {
    const title = await this.hooks.askText({ title: 'New element', body: 'A character, location, prop or piece of wardrobe. It becomes a page in the world’s bible.', placeholder: 'Mom', value: name, ok: 'Next' }) || (name || null);
    if (!title) return null;
    const kind = type || await new Promise((resolve) => {
      const anchor = this.el.querySelector('.gv-title') || this.el;
      this.hooks.menu(anchor, ELEMENT_TYPES.map((t) => ({ label: t.label, run: () => resolve(t.id) })));
      setTimeout(() => { if (!document.querySelector('.pop-menu')) resolve(null); }, 0);
    });
    if (!kind || !this.world) return null;
    const el = await newElement(this.world, kind, title);
    this.hooks.changed([el]);
    return el;
  }

  async addElement(s, id) {
    await changeBreakdown(s.id, { add: [id], pieceId: this.piece.id });
    await this.render();
  }

  async dropElement(s, id) {
    await changeBreakdown(s.id, { drop: [id], pieceId: this.piece.id });
    await this.render();
    this.hooks.toast('Taken out of this scene', { label: 'Undo', run: () => this.addElement(s, id) });
  }

  async matched(s) {
    await changeBreakdown(s.id, { sig: s.sig, pieceId: this.piece.id });
    await this.render();
  }

  sceneMenu(s) {
    return [
      { label: 'Open in the text', run: () => this.hooks.open(s) },
      { label: '+ Shot', run: () => this.addShot(s) },
      this.hooks.canAsk() && { label: 'Find this scene’s elements, with Claude', run: () => this.breakdown([s]) },
      this.hooks.canAsk() && { label: s.shots.length ? 'Suggest more shots, with Claude' : 'Suggest shots, with Claude', run: () => this.suggestShots(s) },
      this.hooks.canAsk() && s.shots.length && { label: 'Write the prompts, with Claude', run: () => this.writePrompts(s) },
      s.shots.length && { label: 'All its shots are made…', sub: MADE_BY.map((m) => ({ label: m.label, run: () => this.setMade(s.shots, m.id) })) },
      { label: 'Voices…', sub: this.audioMenu(s) },
      s.changed && { label: 'The shots still match the scene', run: () => this.matched(s) }
    ].filter(Boolean);
  }

  audioMenu(s) {
    const own = s.bd?.fields?.audio;
    const items = AUDIO.map((a) => ({ label: `${a.id === s.audio ? '✓ ' : ''}${a.label}`, run: () => this.setAudio(s, a.id) }));
    if (own) items.push({ label: 'Same as the rest of the project', run: () => this.setAudio(s, null) });
    items.push({ label: 'For the whole project…', sub: AUDIO.map((a) => ({ label: `${a.id === audioOf(null, this.world) ? '✓ ' : ''}${a.label}`, run: () => this.setProjectAudio(a.id) })) });
    return items;
  }

  async setAudio(s, audio) {
    const was = s.bd?.fields?.audio ?? null;
    await changeBreakdown(s.id, { audio, pieceId: this.piece.id });
    await this.render();
    this.hooks.toast(audio ? `${s.title}: ${AUDIO.find((a) => a.id === audio).label.toLowerCase()}` : `${s.title} follows the project`, { label: 'Undo', run: async () => { await changeBreakdown(s.id, { audio: was, pieceId: this.piece.id }); await this.render(); } });
  }

  async setProjectAudio(audio) {
    if (!this.world) return;
    const w = await getEntry(this.world.id);
    const was = w.fields?.production?.audio;
    const put = async (v) => {
      const fresh = await getEntry(w.id);
      const production = { ...(fresh.fields?.production || {}) };
      if (v) production.audio = v; else delete production.audio;
      const row = { ...fresh, fields: { ...fresh.fields, production }, updated_at: Date.now() };
      await putEntries([row]);
      this.hooks.changed([row]);
      await this.render();
    };
    await put(audio);
    this.hooks.toast(`Voices in ${w.title || 'this project'}: ${AUDIO.find((a) => a.id === audio).label.toLowerCase()}`, { label: 'Undo', run: () => put(was) });
  }

  async setMade(shots, made) {
    const before = shots.map((sh) => [sh.id, sh.fields?.made]);
    const apply = async (pairs) => {
      const t = Date.now();
      const rows = [];
      for (const [id, m] of pairs) {
        const fresh = await getEntry(id);
        if (!fresh) continue;
        const fields = { ...fresh.fields };
        // The usual for this kind of piece isn't stored, so a piece that
        // changes kind takes its shots with it.
        if (!m || m === madeBy({}, this.set)) delete fields.made; else fields.made = m;
        rows.push({ ...fresh, fields, updated_at: t });
      }
      await putEntries(rows);
      this.hooks.changed(rows);
      await this.render();
    };
    await apply(shots.map((sh) => [sh.id, made]));
    const label = MADE_BY.find((m) => m.id === made).label.toLowerCase();
    this.hooks.toast(shots.length === 1 ? `Shot made: ${label}` : `${plural(shots.length, 'shot')} made: ${label}`, { label: 'Undo', run: () => apply(before) });
  }

  // ---------- a shot ----------

  shotEl(sh, s) {
    const f = sh.fields || {};
    const box = make('div', 'pd-shot' + (this.open.has(sh.id) ? ' open' : ''));
    box.dataset.shot = sh.id;
    const stage = shotStage(sh);
    box.dataset.stage = stage;
    const filmed = isFilmed(sh, this.set);
    box.dataset.filmed = String(filmed);
    const run = s ? runsOf(s.shots).find((r) => r.shots.includes(sh)) : null;
    if (run && run.shots.length > 1) {
      box.classList.add('grouped');
      if (run.shots[0] === sh) box.classList.add('group-first');
      if (run.shots.at(-1) === sh) box.classList.add('group-last');
    }
    const row = make('div', 'pd-shot-row');
    // The short code on the row; the full one stays in file names, exports and ⋯.
    const full = s ? this.codeOf(sh, s) : '';
    const code = make('span', 'pd-code', f.n || '');
    code.dataset.code = full;
    if (full) code.title = full;
    const what = this.editable('pd-what' + (filmed && gotIt(sh) ? ' done' : ''), sh.text || '', 'What happens', (v) => this.saveShot(sh.id, { text: v, tags: tagsIn(v) }));
    const framing = this.editable('pd-framing', f.framing || '', 'Framing', (v) => this.saveShotFields(sh.id, { framing: v }));
    const toggle = make('button', 'pd-toggle', this.open.has(sh.id) ? '▾' : '▸');
    const opens = filmed ? 'Note and reference frame' : 'Prompts and tries';
    toggle.setAttribute('aria-label', this.open.has(sh.id) ? `Hide ${opens.toLowerCase()}` : opens);
    toggle.setAttribute('aria-expanded', String(this.open.has(sh.id)));
    toggle.addEventListener('click', () => { if (this.open.has(sh.id)) this.open.delete(sh.id); else this.open.add(sh.id); this.render(); });
    const made = madeBy(sh, this.set);
    box.dataset.made = made;
    const state = make('span', 'pd-state');
    // How it's made shows only where it differs from the film (a generated
    // insert in a filmed film, footage-based shots).
    const usual = this.set === 'live' ? 'live' : 'gen';
    if (made !== usual) {
      const m = make('button', 'pd-made', MADE_BY.find((x) => x.id === made).label);
      m.title = MADE_BY.find((x) => x.id === made).about || '';
      m.addEventListener('click', () => this.hooks.menu(m, this.madeMenu(sh)));
      state.append(m);
    }
    // The lines it covers in the script (Write > Shots), said quietly.
    const paras = s ? (s.rows || []).filter((r) => r.kind === 'para' && r.fields?.el !== 'scene').map((r) => ({ id: r.id, el: r.fields?.el, text: r.text || '' })) : [];
    const span = linesOf(sh, paras);
    if (span) state.append(make('span', 'pd-covers', `covers ${linesIn(paras, span.from, span.to)} line${linesIn(paras, span.from, span.to) === 1 ? '' : 's'}`));
    if (!filmed) state.append(make('span', 'pd-stage', shotStatus(sh, this.set)));
    row.append(toggle, what, framing, state, code);
    // A filmed shot: one tap says it's in the can.
    if (filmed) row.append(this.gotEl(sh));
    row.append(this.hooks.menuButton(() => this.shotMenu(sh, s), 'More for this shot'));
    box.append(row);
    if (this.open.has(sh.id)) box.append(this.shotDetail(sh, s));
    // Renders dropped on a shot go to it.
    box.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); box.classList.add('drop'); } });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); box.classList.remove('drop'); this.addRenders(sh.id, [...(e.dataTransfer?.files || [])]); });
    return box;
  }

  gotEl(sh) {
    const on = gotIt(sh);
    const b = make('button', 'pd-got', '✓');
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Got it (tap to mark it still to get)' : 'Got it');
    b.title = on ? 'Got it. Tap again if it still needs shooting.' : 'Got it: this shot is in the can';
    b.addEventListener('click', () => this.setGot(sh.id, !on));
    return b;
  }

  async setGot(id, on) {
    const fresh = await getEntry(id);
    if (!fresh) return;
    const fields = { ...fresh.fields };
    if (on) fields.got = Date.now(); else delete fields.got;
    await this.saveShot(id, { fields });
    await this.render();
  }

  shotDetail(sh, s) {
    return isFilmed(sh, this.set) ? this.filmedDetail(sh) : this.genDetail(sh, s);
  }

  // A filmed shot: its framing, one note for the day, and a reference frame
  // (the picture the storyboard shows); takes can be dropped and starred.
  // Nothing about models, seconds or prompts.
  filmedDetail(sh) {
    const f = sh.fields || {};
    const d = make('div', 'pd-detail filmed');
    const chips = make('div', 'pd-framings');
    for (const w of ['Wide', 'Medium', 'Close-up', 'Two-shot', 'Insert']) {
      const c = make('button', 'chip' + ((f.framing || '').toLowerCase() === w.toLowerCase() ? ' on' : ''), w);
      c.addEventListener('click', async () => { await this.saveShotFields(sh.id, { framing: w }); this.render(); });
      chips.append(c);
    }
    d.append(chips);
    const wrap = make('label', 'pd-prompt');
    wrap.append(make('span', 'panel-label', 'Note for the day: lens, move, sound'));
    const ta = make('textarea', 'pd-ta pd-note');
    ta.value = f.note || '';
    ta.rows = 2;
    ta.setAttribute('aria-label', 'Note for the day');
    const fit = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
    ta.addEventListener('input', () => { fit(); this.later(`${sh.id}:note`, () => this.saveShotFields(sh.id, { note: ta.value })); });
    ta.addEventListener('blur', () => this.now(`${sh.id}:note`));
    requestAnimationFrame(fit);
    wrap.append(ta);
    d.append(wrap, this.rendersEl(sh, 'Reference frame or takes: drop them here, star the one you use'));
    return d;
  }

  // The pictures and takes of a shot, newest first, with the star.
  rendersEl(sh, hint) {
    const f = sh.fields || {};
    const tries = (f.tries || []).filter((t) => t.files?.length);
    const strip = make('div', 'pd-renders');
    for (const t of [...tries].reverse()) for (const id of [...t.files].reverse()) strip.append(this.renderEl(sh, id));
    const add = make('label', 'pd-render add');
    add.title = hint;
    add.append(make('span', '', '+'));
    const input = make('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*';
    input.hidden = true;
    input.addEventListener('change', () => this.addRenders(sh.id, [...input.files]));
    add.append(input);
    strip.append(add);
    return strip;
  }

  // A generated shot: prompts and tries first; the settings fold into one
  // line ("Kling 3.0 · 5 s · starts on the starred still") with Change.
  genDetail(sh, s) {
    const f = sh.fields || {};
    const d = make('div', 'pd-detail');
    for (const [k, label] of [['still', 'Still prompt'], ['video', 'Video prompt']]) {
      const wrap = make('div', 'pd-prompt');
      const top = make('div', 'pd-prompt-head');
      top.append(make('span', 'panel-label', label));
      const copy = make('button', 'ghost-btn', 'Copy');
      copy.addEventListener('click', () => this.copy(ta.value, `${label} copied`));
      top.append(copy);
      const ta = make('textarea', 'pd-ta');
      ta.value = f[k] || '';
      ta.rows = 3;
      ta.placeholder = k === 'still' ? 'The first frame, as one picture' : 'How it moves';
      ta.setAttribute('aria-label', label);
      const fit = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
      ta.addEventListener('input', () => { fit(); this.later(`${sh.id}:${k}`, () => this.saveShotFields(sh.id, { [k]: ta.value, prompt_by: 'me' })); });
      ta.addEventListener('blur', () => this.now(`${sh.id}:${k}`));
      requestAnimationFrame(fit);
      wrap.append(top, ta);
      d.append(wrap);
    }
    d.append(this.rendersEl(sh, 'Add renders: stills or video takes. Or drop them on the shot.'));
    // Results kept as links (too big to keep, or on the NAS).
    const links = (f.tries || []).flatMap((t) => (t.links || []).map((url) => ({ url, t })));
    if (links.length) {
      const ul = make('div', 'pd-links');
      for (const { url, t } of links.reverse()) {
        const a = make('a', 'pd-link', this.tryLabel(t) || url);
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = url;
        ul.append(a);
      }
      d.append(ul);
    }
    const genOpen = this.genOpen?.has(sh.id);
    if (genOpen) d.append(this.genEl(sh, s));
    const acts = make('div', 'pd-add pd-genline');
    acts.append(make('span', 'pd-gen-sum', this.genSummary(sh)));
    const change = make('button', 'ghost-btn', genOpen ? 'Done' : 'Change');
    change.title = 'Model, seconds, first and last frame, and the line it is timed to';
    change.addEventListener('click', () => { this.genOpen ||= new Set(); if (genOpen) this.genOpen.delete(sh.id); else this.genOpen.add(sh.id); this.render(); });
    acts.append(change);
    const kit = make('button', 'ghost-btn', 'Download kit');
    kit.title = 'The prompts and the reference pictures of everything in the shot, in one .zip, for PixAI, Seedance or any tool on the web';
    kit.addEventListener('click', () => this.kit(sh, s));
    acts.append(kit);
    const earlier = (f.tries || []).filter((t) => (t.still || t.video) && !((t.still || '') === (f.still || '') && (t.video || '') === (f.video || '')));
    if (earlier.length) {
      const b = make('button', 'ghost-btn', `Earlier prompts (${earlier.length})`);
      b.addEventListener('click', () => { box.hidden = !box.hidden; });
      acts.append(b);
      const box = make('div', 'pd-earlier');
      box.hidden = true;
      for (const t of [...earlier].reverse()) {
        const item = make('div', 'pd-try');
        const starred = (t.files || []).some((x) => x === f.star?.still || x === f.star?.video);
        item.append(make('div', 'pd-try-head', `${this.tryLabel(t)}${t.files?.length ? ` · ${plural(t.files.length, 'render')}` : ''}${starred ? ' · ★' : ''}`));
        if (t.still) item.append(make('p', 'pd-try-text', t.still));
        if (t.video) item.append(make('p', 'pd-try-text muted', t.video));
        const use = make('button', 'ghost-btn', 'Use these prompts again');
        use.addEventListener('click', () => this.usePrompts(sh.id, t));
        item.append(use);
        box.append(item);
      }
      d.append(acts, box);
    } else d.append(acts);
    return d;
  }

  // "Kling 3.0 · 5 s · starts on the starred still"
  genSummary(sh) {
    const g = genOf(sh);
    const model = g.model || this.piece.fields?.gen?.model || 'Model not set';
    const first = g.first ? 'starts on a chosen still' : sh.fields?.star?.still ? 'starts on the starred still' : 'no first frame yet';
    return [model, `${g.secs || secsOf(sh)} s`, first, g.sync ? 'timed to a line' : ''].filter(Boolean).join(' · ');
  }

  renderEl(sh, id) {
    const f = sh.fields || {};
    const tile = make('div', 'pd-render');
    tile.dataset.file = id;
    const starred = f.star?.still === id || f.star?.video === id;
    tile.classList.toggle('starred', starred);
    (async () => {
      const meta = await getEntry(id);
      const url = await fileUrl(id);
      if (!url || !meta) { tile.classList.add('missing'); tile.title = 'Still on its way from another device'; return; }
      const t = (f.tries || []).find((x) => (x.files || []).includes(id));
      tile.title = [meta.title || '', t && this.tryLabel(t)].filter(Boolean).join('\n');
      if (isVideo(meta.fields?.type)) {
        const v = make('video');
        v.src = url;
        v.muted = true;
        v.preload = 'metadata';
        v.playsInline = true;
        tile.prepend(v);
        tile.addEventListener('pointerenter', () => v.play().catch(() => {}));
        tile.addEventListener('pointerleave', () => v.pause());
      } else {
        const img = make('img');
        img.src = url;
        img.alt = meta.title || 'Render';
        tile.prepend(img);
      }
      tile.dataset.kind = isVideo(meta.fields?.type) ? 'video' : 'still';
    })();
    const star = make('button', 'pd-star', starred ? '★' : '☆');
    star.setAttribute('aria-label', starred ? 'The one that worked (click to unstar)' : 'Star: this is the one');
    star.title = star.getAttribute('aria-label');
    star.addEventListener('click', (e) => { e.stopPropagation(); this.star(sh.id, id); });
    tile.append(star);
    tile.addEventListener('click', () => this.viewer(sh, id));
    return tile;
  }

  async viewer(sh, id) {
    const meta = await getEntry(id);
    const url = await fileUrl(id);
    if (!url) return;
    const back = make('div', 'pd-viewer');
    const media = isVideo(meta?.fields?.type) ? Object.assign(make('video'), { src: url, controls: true, autoplay: true, loop: true, playsInline: true }) : Object.assign(make('img'), { src: url, alt: meta?.title || '' });
    const bar = make('div', 'pd-viewer-bar');
    bar.append(make('span', 'pd-viewer-name', meta?.title || ''));
    const fresh = await getEntry(sh.id);
    const tr = (fresh?.fields?.tries || []).find((x) => (x.files || []).includes(id));
    if (tr) {
      const what = [tr.model, tr.secs && `${tr.secs} s`, tr.settings].filter(Boolean).join(' · ');
      if (what) bar.append(make('span', 'pd-viewer-name', what));
      const cost = make('input', 'pd-cost-input');
      cost.type = 'number';
      cost.min = '0';
      cost.step = '0.01';
      cost.placeholder = 'Cost $';
      cost.value = tr.cost ?? '';
      cost.setAttribute('aria-label', 'What this try cost, in dollars');
      cost.title = 'What this try cost, in dollars (adds to the spend on Make)';
      cost.addEventListener('change', () => this.setTryCost(sh.id, tr.id, cost.value));
      bar.append(cost);
    }
    const starred = fresh?.fields?.star?.still === id || fresh?.fields?.star?.video === id;
    const star = make('button', 'pill', starred ? '★ Starred' : '☆ Star');
    star.addEventListener('click', async () => { await this.star(sh.id, id); close(); });
    const save = make('button', 'pill', 'Save file');
    save.addEventListener('click', async () => { const b = await fileBlob(id); if (b) download(meta?.title || 'render', b); });
    const del = make('button', 'pill', 'Remove');
    del.addEventListener('click', async () => { close(); await this.removeRender(sh.id, id); });
    const shut = make('button', 'pill', 'Close');
    const close = () => { back.remove(); document.removeEventListener('keydown', esc, true); };
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    shut.addEventListener('click', close);
    bar.append(star, save, del, shut);
    back.append(media, bar);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', esc, true);
    document.body.append(back);
    shut.focus();
  }

  shotMenu(sh, s) {
    const list = s ? s.shots : this.lost;
    const i = list.findIndex((x) => x.id === sh.id);
    return [
      s && { label: 'Add a shot after this one', run: () => this.addShot(s, sh.id) },
      s && i > 0 && { label: 'Move up', run: () => this.nudge(sh, list, i, -1) },
      s && i < list.length - 1 && { label: 'Move down', run: () => this.nudge(sh, list, i, 1) },
      { label: s ? 'Move to another scene…' : 'Move to a scene…', run: () => this.hooks.menu(this.el.querySelector(`[data-shot="${CSS.escape(sh.id)}"] .pd-code`) || this.el, this.scenes.filter((x) => x.id !== s?.id).map((x) => ({ label: `${x.n ? `${x.n} ` : ''}${x.title}`, run: () => this.moveShot(sh, x) }))) },
      s && i < list.length - 1 && (!sh.fields?.group || sh.fields.group !== list[i + 1].fields?.group) && { label: 'Make with the next shot, in one generation', run: () => this.joinNext(sh, list[i + 1]) },
      sh.fields?.group && { label: 'Make on its own again', run: () => this.leaveGroup(sh, list) },
      { label: 'Made by…', sub: this.madeMenu(sh) },
      { label: 'Copy the shot code', run: () => this.copy(s ? this.codeOf(sh, s) : '', 'Shot code copied') },
      { label: 'Delete the shot', danger: true, run: () => this.deleteShot(sh) }
    ].filter(Boolean);
  }

  madeMenu(sh) {
    const now = madeBy(sh, this.set);
    return MADE_BY.map((m) => ({ label: `${m.id === now ? '✓ ' : ''}${m.label}`, run: () => this.setMade([sh], m.id) }));
  }

  // ---------- how it's generated ----------

  // "Nov 3 · Claude · Kling 3.0 · 5 s · $0.40"
  tryLabel(t) {
    const cost = Number(t.cost);
    return [
      t.at && new Date(t.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      t.by === 'claude' && 'Claude',
      t.model,
      t.secs && `${t.secs} s`,
      Number.isFinite(cost) && t.cost !== '' && t.cost !== null && t.cost !== undefined && `${t.cost_est ? '~' : ''}${money(cost)}`
    ].filter(Boolean).join(' · ');
  }

  // The model, length, first and last frame, and the line it's timed to.
  genEl(sh, s) {
    const g = genOf(sh);
    const box = make('div', 'pd-gen');
    const field = (label, el) => { const w = make('label', 'pd-field'); w.append(make('span', 'pd-field-label', label), el); return w; };
    const save = (patch) => this.saveGen(sh.id, patch);
    const model = make('input', 'pd-input');
    model.value = g.model || '';
    model.placeholder = this.piece.fields?.gen?.model || 'Kling 3.0';
    model.setAttribute('list', 'pd-models');
    model.setAttribute('aria-label', 'Model');
    model.addEventListener('change', () => save({ model: model.value.trim() }));
    const secs = make('input', 'pd-input');
    secs.type = 'number';
    secs.min = '1';
    secs.max = '120';
    secs.step = '0.5';
    secs.value = g.secs || '';
    secs.placeholder = String(secsOf({}));
    secs.setAttribute('aria-label', 'Length in seconds');
    secs.addEventListener('change', () => save({ secs: Number(secs.value) > 0 ? Number(secs.value) : null }));
    const stills = [];
    for (const t of sh.fields?.tries || []) for (const id of t.files || []) if (this.kindOf?.get(id) === 'still') stills.push(id);
    const frame = (key, label) => {
      const sel = make('select', 'pd-input');
      sel.setAttribute('aria-label', label);
      sel.append(new Option(key === 'first' ? 'The starred still' : 'None', ''));
      stills.forEach((id, i) => sel.append(new Option(`Still ${i + 1}${sh.fields?.star?.still === id ? ' ★' : ''}`, id)));
      sel.value = stills.includes(g[key]) ? g[key] : '';
      sel.addEventListener('change', () => save({ [key]: sel.value || null }));
      return sel;
    };
    const lines = s ? speechesIn(s.rows || []) : [];
    const sync = make('select', 'pd-input');
    sync.setAttribute('aria-label', 'Timed to');
    sync.append(new Option('Nothing', ''));
    for (const l of lines) {
      const text = `${l.who ? `${l.who}: ` : ''}${l.text}`;
      sync.append(new Option(text.length > 70 ? `${text.slice(0, 69)}…` : text, text));
    }
    if (g.sync && !lines.some((l) => `${l.who ? `${l.who}: ` : ''}${l.text}` === g.sync)) sync.append(new Option(g.sync, g.sync));
    sync.value = g.sync || '';
    sync.addEventListener('change', () => save({ sync: sync.value || null }));
    box.append(field('Model', model), field('Seconds', secs), field('First frame', frame('first', 'First frame')), field('Last frame', frame('last', 'Last frame')));
    if (lines.length || g.sync) box.append(field('Timed to', sync));
    const run = s ? runsOf(s.shots).find((r) => r.shots.includes(sh)) : null;
    if (run && run.shots.length > 1) {
      const total = run.shots.reduce((n, x) => n + secsOf(x), 0);
      const codes = run.shots.map((x) => x.fields?.n).filter(Boolean);
      box.append(make('p', 'pd-gen-run', `Made in one generation with shots ${codes[0]} to ${codes.at(-1)} (${total} s). Each keeps its own code; star the take on any one of them.`));
    }
    return box;
  }

  async saveGen(id, patch) {
    const fresh = await getEntry(id);
    if (!fresh) return;
    const gen = { ...(fresh.fields?.gen || {}), ...patch };
    for (const k of Object.keys(gen)) if (gen[k] === null || gen[k] === '') delete gen[k];
    const fields = { ...fresh.fields, gen };
    if (!Object.keys(gen).length) delete fields.gen;
    await this.saveShot(id, { fields });
    this.render();
  }

  async setTryCost(shotId, tryId, value) {
    const fresh = await getEntry(shotId);
    if (!fresh) return;
    const n = Number(value);
    const tries = (fresh.fields?.tries || []).map((t) => {
      if (t.id !== tryId) return t;
      const { cost_est: _e, ...rest } = t;
      if (value === '' || !Number.isFinite(n) || n < 0) { delete rest.cost; return rest; }
      return { ...rest, cost: Math.round(n * 100) / 100 };
    });
    await this.saveShotFields(shotId, { tries });
    this.render();
  }

  // Shots next to each other made in one generation share a group.
  async joinNext(sh, next) {
    const a = await getEntry(sh.id);
    const b = await getEntry(next.id);
    const g = a.fields?.group || b.fields?.group || newId('gr');
    const t = Date.now();
    const rows = [{ ...a, fields: { ...a.fields, group: g }, updated_at: t }];
    // The next shot's whole group comes along.
    const s = this.scenes.find((x) => x.shots.some((y) => y.id === sh.id));
    const theirs = b.fields?.group ? (s?.shots || []).filter((x) => x.fields?.group === b.fields.group && x.id !== a.id) : [b];
    for (const x of theirs) { const f = await getEntry(x.id); if (f) rows.push({ ...f, fields: { ...f.fields, group: g }, updated_at: t }); }
    await putEntries(rows);
    this.hooks.changed(rows);
    await this.render();
    this.hooks.toast('Made in one generation', { label: 'Undo', run: async () => { await putEntries([a, b, ...theirs].map((x) => ({ ...x, updated_at: Date.now() }))); this.render(); } });
  }

  async leaveGroup(sh, list) {
    const g = sh.fields?.group;
    const rest = list.filter((x) => x.id !== sh.id && x.fields?.group === g);
    const t = Date.now();
    const off = async (x) => { const f = await getEntry(x.id); const fields = { ...f.fields }; delete fields.group; return { ...f, fields, updated_at: t }; };
    const rows = [await off(sh)];
    if (rest.length === 1) rows.push(await off(rest[0]));
    await putEntries(rows);
    this.hooks.changed(rows);
    await this.render();
  }

  // ---------- cost ----------

  costEl() {
    const box = make('div', 'pd-cost');
    const shots = this.scenes.flatMap((s) => s.shots);
    const pg = this.piece.fields?.gen || {};
    const tries = Number(pg.tries) > 0 ? Number(pg.tries) : 3;
    const est = estimate(shots, this.prices, { model: pg.model || '', tries, live: (sh) => madeBy(sh, this.set) === 'live' });
    const now = new Date();
    const month = { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() };
    const here = spent([...shots, ...this.lost]);
    const thisMonth = spent(this.allShots || [], month);
    const e = make('span', 'pd-cost-est');
    e.append(make('strong', '', `About ${money(est.usd)}`), document.createTextNode(` to make ${plural(est.shots, 'generated shot')}, ${Math.round(est.secs)} s, at `));
    const model = make('input', 'pd-cost-input wide');
    model.value = pg.model || '';
    model.placeholder = 'Kling 3.0';
    model.setAttribute('list', 'pd-models');
    model.setAttribute('aria-label', 'Model for finals, where a shot doesn’t say');
    model.title = 'The model for finals, where a shot doesn’t name its own';
    model.addEventListener('change', async () => { await this.savePiece({ gen: { ...(this.piece.fields?.gen || {}), model: model.value.trim() } }); this.render(); });
    const n = make('input', 'pd-cost-input');
    n.type = 'number';
    n.min = '1';
    n.max = '20';
    n.value = String(tries);
    n.setAttribute('aria-label', 'Tries per shot');
    n.addEventListener('change', async () => { await this.savePiece({ gen: { ...(this.piece.fields?.gen || {}), tries: Math.max(1, Math.min(20, Number(n.value) || 3)) } }); this.render(); });
    e.append(model, document.createTextNode(' × '), n, document.createTextNode(' tries'));
    box.append(e);
    if (est.unpriced.length) {
      const u = make('span', 'pd-cost-warn', `No price for ${est.unpriced.join(', ')}`);
      u.title = 'Add it in Prices so the estimate counts it';
      box.append(u);
    }
    box.append(make('span', 'pd-cost-spent', `Spent ${money(here.usd)} here · ${money(thisMonth.usd)} in ${now.toLocaleDateString(undefined, { month: 'long' })}`));
    const checked = pricesChecked(this.prices);
    const p = make('button', 'ghost-btn pd-cost-prices', checked ? `Prices from ${new Date(`${checked}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Prices');
    p.title = 'See or change what each model costs. Claude keeps them up to date.';
    p.addEventListener('click', () => this.pricesDialog());
    box.append(p, this.modelList());
    return box;
  }

  modelList() {
    const dl = make('datalist');
    dl.id = 'pd-models';
    for (const x of this.prices) dl.append(new Option(x.model, x.model));
    return dl;
  }

  async pricesDialog() {
    const back = make('div', 'pd-modal');
    const box = make('div', 'pd-modal-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Prices');
    box.append(make('h2', '', 'Prices'));
    box.append(make('p', 'hint', 'What each model costs, per second of video or per picture, in US dollars. The estimate on Make uses these. Claude checks them each week and updates them; anything you change here is kept.'));
    const table = make('div', 'pd-price-table');
    const head = make('div', 'pd-price-row head');
    for (const h of ['Model', 'Where', 'Per', 'USD', 'Checked', '']) head.append(make('span', '', h));
    table.append(head);
    const rows = [];
    const addRow = (p = {}) => {
      const r = make('div', 'pd-price-row');
      const m = Object.assign(make('input', 'pd-input'), { value: p.model || '', placeholder: 'Model' });
      m.setAttribute('aria-label', 'Model');
      const t = Object.assign(make('input', 'pd-input'), { value: p.tool || '', placeholder: 'Higgsfield' });
      t.setAttribute('aria-label', 'Where');
      const u = make('select', 'pd-input');
      u.append(new Option('second', 'second'), new Option('picture', 'picture'));
      u.value = p.unit === 'picture' ? 'picture' : 'second';
      u.setAttribute('aria-label', 'Per');
      const usd = Object.assign(make('input', 'pd-input'), { type: 'number', min: '0', step: '0.01', value: p.usd ?? '' });
      usd.setAttribute('aria-label', 'Dollars');
      const when = make('span', 'pd-price-when', p.checked ? `${p.checked}${p.by === 'claude' ? ' · Claude' : ''}` : '');
      if (p.source) when.title = p.source;
      const del = make('button', 'ghost-btn', '×');
      del.setAttribute('aria-label', 'Remove this price');
      const item = { p, m, t, u, usd };
      del.addEventListener('click', () => { r.remove(); rows.splice(rows.indexOf(item), 1); });
      r.append(m, t, u, usd, when, del);
      rows.push(item);
      table.append(r);
    };
    for (const p of this.prices) addRow(p);
    box.append(table);
    const acts = make('div', 'pd-add');
    const more = make('button', 'ghost-btn', '+ Model');
    more.addEventListener('click', () => { addRow(); rows.at(-1).m.focus(); });
    const save = make('button', 'pill', 'Save');
    const cancel = make('button', 'ghost-btn', 'Cancel');
    const close = () => { back.remove(); document.removeEventListener('keydown', esc, true); };
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    cancel.addEventListener('click', close);
    save.addEventListener('click', async () => {
      const today = new Date().toLocaleDateString('en-CA');
      const list = rows.filter((x) => x.m.value.trim()).map(({ p, m, t, u, usd }) => {
        const next = { model: m.value.trim(), tool: t.value.trim(), unit: u.value, usd: Math.max(0, Number(usd.value) || 0), ...(p.local ? { local: true } : {}) };
        const same = p.model === next.model && (p.tool || '') === next.tool && (p.unit || 'second') === next.unit && Number(p.usd) === next.usd;
        return same ? p : { ...next, checked: today, by: 'me' };
      });
      await this.savePrices(list);
      close();
    });
    acts.append(more, save, cancel);
    box.append(acts);
    back.append(box);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', esc, true);
    document.body.append(back);
    save.focus();
  }

  async savePrices(list) {
    const fresh = await getEntry(PRICES_ID);
    const row = fresh ? { ...fresh, deleted: false, fields: { ...fresh.fields, list }, updated_at: Date.now() } : entry('prices', { id: PRICES_ID, title: 'Prices', fields: { list } });
    await putEntries([row]);
    this.hooks.changed([row]);
    await this.render();
    this.hooks.toast('Prices saved');
  }

  // ---------- writing shots ----------

  editable(cls, value, placeholder, save) {
    const t = make('div', `gv-text ${cls}`, value);
    t.contentEditable = 'plaintext-only';
    t.dataset.placeholder = placeholder;
    t.setAttribute('aria-label', placeholder);
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); t.blur(); } if (e.key === 'Escape') { t.textContent = value; t.blur(); } });
    t.addEventListener('blur', async () => { const v = t.textContent.trim(); if (v !== value) { value = v; await save(v); } if (this.stale) this.render(); });
    return t;
  }

  later(key, fn) { clearTimeout(this.timers.get(key)?.t); this.timers.set(key, { fn, t: setTimeout(() => this.now(key), 500) }); }
  async now(key) { const x = this.timers.get(key); if (!x) return; clearTimeout(x.t); this.timers.delete(key); await x.fn(); if (this.stale && !this.timers.size) this.refresh(); }

  async saveShot(id, patch) {
    const fresh = await getEntry(id);
    if (!fresh) return;
    const row = { ...fresh, ...patch, updated_at: Date.now() };
    delete row._by;
    await putEntries([row]);
    this.hooks.changed([row]);
  }
  async saveShotFields(id, patch) {
    const fresh = await getEntry(id);
    if (fresh) await this.saveShot(id, { fields: { ...fresh.fields, ...patch } });
  }

  async addShot(s, after = null, focus = true) {
    // The first shot of a scene is planned against the scene as it is now.
    if (!s.shots.length) await changeBreakdown(s.id, { sig: s.sig, pieceId: this.piece.id });
    const sh = await newShot(s.id, { after, pieceId: this.piece.id });
    this.hooks.changed([sh]);
    await this.render();
    if (focus) this.el.querySelector(`[data-shot="${CSS.escape(sh.id)}"] .pd-what`)?.focus();
    return sh;
  }

  async nudge(sh, list, i, dir) {
    const other = list[i + dir];
    const beyond = list[i + dir * 2];
    const sort = beyond ? (other.sort + beyond.sort) / 2 : other.sort + dir * 1024;
    await this.saveShot(sh.id, { sort });
    await this.render();
  }

  async moveShot(sh, to) {
    const there = this.shotsOf.get(to.id) || [];
    if (!there.length) await changeBreakdown(to.id, { sig: to.sig, pieceId: this.piece.id });
    // It keeps its number unless that's taken in its new scene.
    const taken = new Set(there.map((x) => x.fields?.n));
    const fresh = await getEntry(sh.id);
    let n = fresh.fields?.n;
    if (!n || taken.has(n)) { let k = there.length + 1; while (taken.has(String(k))) k++; n = String(k); }
    await this.saveShot(sh.id, { parent_id: to.id, sort: (there.at(-1)?.sort || 0) + 1024, fields: { ...fresh.fields, n } });
    await this.render();
    this.hooks.toast(`Moved to ${to.title}`);
  }

  async deleteShot(sh) {
    const fresh = await getEntry(sh.id);
    if (!fresh) return;
    await putEntries([{ ...fresh, deleted: true, updated_at: Date.now() }]);
    this.hooks.changed([fresh]);
    await this.render();
    this.hooks.toast('Shot deleted', { label: 'Undo', run: async () => { await putEntries([{ ...fresh, deleted: false, updated_at: Date.now() }]); this.render(); } });
  }

  async usePrompts(id, t) {
    const fresh = await getEntry(id);
    await this.saveShot(id, { fields: withPrompts(fresh.fields || {}, { still: t.still || '', video: t.video || '' }, 'me') });
    await this.render();
  }

  // ---------- renders ----------

  async addRenders(shotId, files, quiet = false) {
    const media = files.filter((f) => isImage(f.type) || isVideo(f.type));
    if (!media.length) { if (!quiet) this.hooks.toast('Only pictures and videos can be renders.'); return 0; }
    const ids = [];
    let big = 0;
    for (const f of media) {
      const row = await addFile(f, { shot: shotId });
      if (row) ids.push(row.id); else big += 1;
    }
    if (ids.length) {
      const fresh = await getEntry(shotId);
      await this.saveShot(shotId, { fields: withRenders(fresh.fields || {}, ids) });
      this.open.add(shotId);
      await this.render();
    }
    if (big) this.hooks.toast(`${plural(big, 'file')} over 50 MB stayed out. Keep big takes on the NAS; the shot code in the name finds them.`);
    else if (!quiet) this.hooks.toast(`${plural(ids.length, 'render')} added`);
    return ids.length;
  }

  // Files dropped anywhere on the page find their shot by the code in their name.
  async dropAnywhere(e) {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length || !this.isOpen) return;
    e.preventDefault();
    if (!this.codes?.size) { this.hooks.toast('Drop renders on a shot, or name them with its shot code.'); return; }
    const groups = new Map();
    const left = [];
    for (const f of files) { const id = shotForName(f.name, this.codes); if (id) { if (!groups.has(id)) groups.set(id, []); groups.get(id).push(f); } else left.push(f); }
    let n = 0;
    for (const [id, fs] of groups) n += await this.addRenders(id, fs, true);
    this.hooks.toast(left.length ? `${plural(n, 'render')} found their shot; ${plural(left.length, 'file')} had no shot code in the name. Drop those on their shot.` : `${plural(n, 'render')} added to ${plural(groups.size, 'shot')}`);
  }

  async star(shotId, fileId) {
    const fresh = await getEntry(shotId);
    const meta = await getEntry(fileId);
    const k = isVideo(meta?.fields?.type) ? 'video' : 'still';
    const star = { ...(fresh.fields?.star || {}) };
    if (star[k] === fileId) delete star[k]; else star[k] = fileId;
    await this.saveShotFields(shotId, { star });
    await this.render();
  }

  async removeRender(shotId, fileId) {
    const fresh = await getEntry(shotId);
    const f = fresh.fields || {};
    const tries = (f.tries || []).map((t) => ({ ...t, files: (t.files || []).filter((x) => x !== fileId) }));
    const star = Object.fromEntries(Object.entries(f.star || {}).filter(([, v]) => v !== fileId));
    await this.saveShotFields(shotId, { tries, star });
    const file = await getEntry(fileId);
    if (file) await putEntries([{ ...file, deleted: true, updated_at: Date.now() }]);
    await this.render();
    this.hooks.toast('Render removed', { label: 'Undo', run: async () => { await putEntries([{ ...file, deleted: false, updated_at: Date.now() }]); await this.saveShotFields(shotId, { tries: f.tries, star: f.star }); this.render(); } });
  }

  // Everything a web tool needs for one shot, in one .zip: the prompts, and
  // the reference pictures of the elements in it (and the still, if picked).
  async kit(sh, s) {
    const f = sh.fields || {};
    const code = s ? this.codeOf(sh, s) : 'shot';
    const els = (s?.uses || []).map((id) => this.elById.get(id)).filter(Boolean);
    const g = genOf(sh);
    const rules = rulesOf(this.world);
    const idsText = (e) => Object.entries(toolIdsOf(e)).map(([k, v]) => `${{ soul: 'Higgsfield Soul', element: 'Higgsfield Element', lora: 'LoRA', kling: 'Kling' }[k] || k}: ${v}`).join('; ');
    const lines = [
      code, s ? `Scene: ${s.title}` : '', sh.text ? `Shot: ${sh.text}` : '', f.framing ? `Framing: ${f.framing}` : '',
      g.model || g.secs ? `Generate: ${[g.model, `${secsOf(sh)} s`].filter(Boolean).join(', ')}` : '', g.sync ? `Timed to: ${g.sync}` : '', '',
      'STILL PROMPT', f.still || '(none yet)', '', 'VIDEO PROMPT', f.video || '(none yet)', '',
      ...(els.length ? ['ELEMENTS', ...els.map((e) => [
        `${e.title} (${typeOf(e.fields.element.type).label})${idsText(e) ? ` [${idsText(e)}]` : ''}: ${e.fields.element.snippet || ''}`,
        e.fields.element.lighting ? `  Lighting: ${e.fields.element.lighting}` : ''
      ].filter(Boolean).join('\n'))] : []),
      this.world?.fields?.production?.style ? `\nSTYLE\n${this.world.fields.production.style}` : '',
      rules.aspect || rules.constraints ? `\nSHOW RULES\n${[rules.aspect && `Frame ${rules.aspect}, ${rules.fps} fps`, rules.constraints].filter(Boolean).join('\n')}` : ''
    ].filter((x) => x !== null);
    const files = [{ path: `${code} prompts.txt`, text: lines.join('\n').replace(/\n{3,}/g, '\n\n') }];
    for (const e of els) {
      for (const slot of viewSlots(e.fields.element.type)) {
        const id = e.fields.element.views?.[slot.id];
        const b = id && await fileBlob(id);
        const meta = id && await getEntry(id);
        if (b) files.push({ path: `References/${e.title.replace(/[\\/:*?"<>|]/g, '-')} ${slot.label.toLowerCase()}.${extOf(meta?.title, meta?.fields?.type)}`, bytes: new Uint8Array(await b.arrayBuffer()) });
      }
      const look = lookOf(e);
      if (look.pick) {
        const b = await fileBlob(look.pick);
        const meta = await getEntry(look.pick);
        if (b) files.push({ path: `References/${e.title.replace(/[\\/:*?"<>|]/g, '-')} pick.${extOf(meta?.title, meta?.fields?.type)}`, bytes: new Uint8Array(await b.arrayBuffer()) });
      }
      // The rest still in the running; what was set aside stays home.
      for (const [i, id] of look.kept.filter((r) => r !== look.pick).entries()) {
        const b = await fileBlob(id);
        const meta = await getEntry(id);
        if (b) files.push({ path: `References/${e.title.replace(/[\\/:*?"<>|]/g, '-')} ${i + 1}.${extOf(meta?.title, meta?.fields?.type)}`, bytes: new Uint8Array(await b.arrayBuffer()) });
      }
    }
    if (g.last) {
      const b = await fileBlob(g.last);
      const meta = await getEntry(g.last);
      if (b) files.push({ path: `${code} last frame.${extOf(meta?.title, meta?.fields?.type)}`, bytes: new Uint8Array(await b.arrayBuffer()) });
    }
    if (g.first || f.star?.still) {
      const b = await fileBlob(g.first || f.star.still);
      const meta = await getEntry(g.first || f.star.still);
      if (b) files.push({ path: `${code} still.${extOf(meta?.title, meta?.fields?.type)}`, bytes: new Uint8Array(await b.arrayBuffer()) });
    }
    download(`${code} kit.zip`, zip(files));
  }

  async copy(text, said) {
    try { await navigator.clipboard.writeText(text || ''); this.hooks.toast(said); } catch { this.hooks.toast('Couldn’t copy. Select the text and copy it instead.'); }
  }

  // ---------- Claude, only when asked ----------

  sceneBody(s, withShots = false) {
    const notes = (this.notesOf.get(s.id) || []).map((n) => n.text);
    return {
      id: s.id, code: s.code || '', heading: s.slug || s.title, ...(s.slug ? { name: s.title } : {}), summary: s.synopsis || '',
      text: s.rows.map((r) => (r.kind === 'scene' ? `[${r.title || 'section'}]` : r.fields?.el === 'character' ? (r.text || '').toUpperCase() : r.text || '')).filter((t) => t.trim()).join('\n'),
      notes, elements: s.uses,
      ...(withShots ? { shots: s.shots.map((sh) => ({ id: sh.id, code: this.codeOf(sh, s), what: sh.text || '', framing: sh.fields?.framing || '', still: sh.fields?.still || '', video: sh.fields?.video || '', model: genOf(sh).model || this.piece.fields?.gen?.model || '', secs: secsOf(sh), sync: genOf(sh).sync || '', group: sh.fields?.group || '' })) } : {})
    };
  }

  kitBody(only = null) {
    return this.elements.filter((e) => !only || only.includes(e.id)).map((e) => ({
      id: e.id, type: e.fields.element.type || 'other', name: e.title || '', also: e.fields.element.also || [], snippet: e.fields.element.snippet || '', look: e.fields.element.look || '',
      lighting: e.fields.element.lighting || '', ids: toolIdsOf(e), views: viewSlots(e.fields.element.type).filter((v) => e.fields.element.views?.[v.id]).map((v) => v.label.toLowerCase())
    }));
  }

  base(task) {
    const r = rulesOf(this.world);
    return { mode: 'production', task, piece: this.piece.title || '', world: this.world?.title || '', style: this.world?.fields?.production?.style || '', rules: [r.aspect && `Frame ${r.aspect}`, r.constraints].filter(Boolean).join('\n') };
  }

  async ask(label, body) {
    if (!this.hooks.canAsk()) { this.hooks.toast('Claude needs you signed in and online.'); return null; }
    this.reading = label;
    await this.render();
    try { return await this.hooks.askServer(body); } catch (e) { this.hooks.toast(e.message || 'Claude couldn’t do that just now.'); return null; } finally { this.reading = null; }
  }

  async breakdown(scenes = this.scenes) {
    if (!this.elements.length) {
      const ok = await this.hooks.ask({ title: 'The kit is empty', body: 'Claude matches scenes to the world’s elements (characters, locations, props). With none yet, it can only suggest what to add. Go on?', ok: 'Ask Claude' });
      if (!ok) return;
    }
    const out = await this.ask(scenes.length === 1 ? `Claude is reading “${scenes[0].title}”…` : `Claude is reading ${plural(scenes.length, 'scene')}…`, { ...this.base('breakdown'), scenes: scenes.map((s) => this.sceneBody(s)), elements: this.kitBody() });
    if (!out) { await this.render(); return; }
    let added = 0;
    const missing = [];
    for (const r of out.scenes || []) {
      const s = this.scenes.find((x) => x.id === r.scene);
      if (!s) continue;
      const fresh = (r.elements || []).filter((id) => this.elById.has(id) && !s.uses.includes(id) && !(s.bd?.fields?.drop || []).includes(id));
      if (fresh.length) { await changeBreakdown(s.id, { add: fresh, pieceId: this.piece.id }); added += fresh.length; }
      for (const m of r.missing || []) if (!this.elements.some((e) => namesOf(e).some((n) => n.toLowerCase() === m.name.toLowerCase()))) missing.push({ ...m, scene: s.id });
    }
    this.missing = missing.length ? missing : null;
    await this.render();
    this.hooks.toast(added ? `Claude added ${plural(added, 'element')} to the breakdown` : 'Claude found nothing more to add from the kit');
  }

  async suggestShots(s) {
    const out = await this.ask(`Claude is planning shots for “${s.title}”…`, { ...this.base('shots'), scene: s.id, scenes: [this.sceneBody(s, true)], elements: this.kitBody(s.uses.length ? s.uses : null) });
    if (!out) { await this.render(); return; }
    if (!s.shots.length) await changeBreakdown(s.id, { sig: s.sig, pieceId: this.piece.id });
    const made = [];
    let last = null;
    for (const x of out.shots || []) {
      const after = x.after === 'start' ? null : x.after || last || s.shots.at(-1)?.id || null;
      const sh = await newShot(s.id, { what: x.what, framing: x.framing, after: x.after === 'start' && !made.length ? null : after, pieceId: this.piece.id, by: 'claude' });
      if (x.after === 'start' && !made.length && s.shots.length) {
        // First of the scene: before the existing first shot.
        const first = s.shots[0];
        await putEntries([{ ...sh, sort: first.sort - 1024, updated_at: Date.now() }]);
      }
      made.push(sh);
      last = sh.id;
    }
    this.hooks.changed(made);
    await this.render();
    this.hooks.toast(made.length ? `Claude planned ${plural(made.length, 'shot')}` : 'Claude had no more shots for this scene', made.length ? { label: 'Undo', run: async () => { await putEntries(made.map((m) => ({ ...m, deleted: true, updated_at: Date.now() }))); this.render(); } } : undefined);
  }

  // Prompts that worked before in this world (their render was starred), for Claude to learn from.
  async examples() {
    const pieces = new Set([this.piece.id]);
    const out = [];
    for (const sh of await byKind('shot')) {
      const f = sh.fields || {};
      if (!f.star?.still && !f.star?.video) continue;
      if (f.piece && !pieces.has(f.piece) && this.world && (await worldOf(await getEntry(f.piece)))?.id !== this.world.id) continue;
      const t = (f.tries || []).find((x) => (x.files || []).includes(f.star.still) || (x.files || []).includes(f.star.video));
      if (t) out.push({ still: t.still || '', video: t.video || '' });
    }
    return out.slice(-8);
  }

  async writePrompts(s, only = null) {
    const ids = only || s.shots.map((x) => x.id);
    const out = await this.ask(`Claude is writing prompts for “${s.title}”…`, { ...this.base('prompts'), scene: s.id, shots: ids, scenes: [this.sceneBody(s, true)], elements: this.kitBody(s.uses.length ? s.uses : null), examples: await this.examples() });
    if (!out) { await this.render(); return; }
    const before = [];
    for (const x of out.shots || []) {
      const fresh = await getEntry(x.shot);
      if (!fresh || !ids.includes(fresh.id)) continue;
      before.push(fresh);
      await putEntries([{ ...fresh, fields: { ...withPrompts(fresh.fields || {}, { still: x.still, video: x.video }, 'claude'), ...(x.elements?.length ? { elements: x.elements } : {}) }, _by: 'claude', updated_at: Date.now() }]);
      this.open.add(fresh.id);
    }
    this.hooks.changed(before);
    await this.render();
    this.hooks.toast(before.length ? `Claude wrote prompts for ${plural(before.length, 'shot')}. The ones before are under Earlier prompts.` : 'No prompts came back', before.length ? { label: 'Undo', run: async () => { await putEntries(before.map((b) => ({ ...b, updated_at: Date.now() }))); this.render(); } } : undefined);
  }

  claudePanel() {
    if (!this.reading && !this.missing) return null;
    const box = make('section', 'gv-claude');
    const head = make('div', 'gv-claude-head');
    head.append(make('span', 'panel-label', this.reading ? 'Claude' : 'Claude suggests adding to the kit'));
    if (!this.reading) {
      const close = make('button', 'ghost-btn', 'Close');
      close.addEventListener('click', () => { this.missing = null; this.render(); });
      head.append(close);
    }
    box.append(head);
    if (this.reading) { box.append(make('p', 'hint', this.reading)); return box; }
    const list = make('ul', 'gv-findings');
    for (const m of this.missing) {
      const li = make('li');
      const b = make('button');
      const s = this.scenes.find((x) => x.id === m.scene);
      b.append(make('span', 'from', [typeOf(m.type).label, s?.title].filter(Boolean).join(' · ')), make('span', 'line', `Add “${m.name}”`));
      b.addEventListener('click', async () => {
        const el = await newElement(this.world, m.type, m.name);
        // Every scene that asked for it gets it.
        for (const x of this.missing.filter((y) => y.name.toLowerCase() === m.name.toLowerCase())) await changeBreakdown(x.scene, { add: [el.id], pieceId: this.piece.id });
        this.missing = this.missing.filter((y) => y.name.toLowerCase() !== m.name.toLowerCase());
        if (!this.missing.length) this.missing = null;
        this.hooks.changed([el]);
        await this.render();
        this.hooks.toast(`“${m.name}” is in the cast and places. Add its look on Cast and places.`);
      });
      li.append(b);
      list.append(li);
    }
    box.append(list);
    return box;
  }

  // ---------- storyboard ----------

  async drawBoard(body) {
    const cards = [];
    for (const s of this.scenes) for (const sh of s.shots) cards.push({ s, sh });
    if (!cards.length) { body.append(make('p', 'hint gv-empty', 'The storyboard is every shot in order, showing the still you starred. Add shots on the Shots tab.')); return; }
    const tools = make('div', 'pd-add');
    const play = make('button', 'pill', '▶ Play');
    play.title = 'Every still in order, two seconds each: a rough animatic';
    play.addEventListener('click', () => this.play(cards));
    tools.append(play);
    body.append(tools);
    const grid = make('div', 'pd-board');
    for (const { s, sh } of cards) {
      const c = make('button', 'pd-card');
      c.dataset.shot = sh.id;
      const pic = make('div', 'pd-pic');
      const still = this.stillOf(sh);
      if (still) fileUrl(still).then((url) => { if (url) { const img = make('img'); img.src = url; img.alt = ''; pic.append(img); } });
      else pic.append(make('span', 'pd-nopic', sh.fields?.framing || ''));
      c.append(pic, make('span', 'pd-card-code', this.codeOf(sh, s)), make('span', 'pd-card-what', sh.text || ''));
      c.addEventListener('click', () => { this.open.add(sh.id); setPref('prodTab', 'shots'); this.render().then(() => this.el.querySelector(`[data-shot="${CSS.escape(sh.id)}"]`)?.scrollIntoView({ block: 'center' })); });
      grid.append(c);
    }
    body.append(grid);
  }

  // The still to show for a shot: the starred one, or the newest.
  stillOf(sh) { return stillOf(sh, (id) => this.kindOf?.get(id)); }

  async play(cards) {
    const back = make('div', 'pd-viewer pd-play');
    const img = make('img');
    const cap = make('div', 'pd-viewer-bar');
    back.append(img, cap);
    document.body.append(back);
    let i = 0;
    let timer = null;
    const close = () => { clearTimeout(timer); back.remove(); document.removeEventListener('keydown', key, true); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } if (e.key === 'ArrowRight') { clearTimeout(timer); step(); } };
    const step = async () => {
      if (i >= cards.length) { close(); return; }
      const { s, sh } = cards[i++];
      const still = this.stillOf(sh);
      const url = still ? await fileUrl(still) : null;
      img.hidden = !url;
      if (url) img.src = url;
      cap.textContent = `${this.codeOf(sh, s)}  ${sh.text || ''}`;
      timer = setTimeout(step, 2000);
    };
    back.addEventListener('click', close);
    document.addEventListener('keydown', key, true);
    step();
  }

  // ---------- cast and places ----------

  // The same wall as on the project's Make, with only who and what is in
  // this film. Each name opens what's written about them.
  async drawKit(body) {
    if (!this.world) { body.append(make('p', 'hint gv-empty', 'This piece isn’t in a world, so it has no cast and places. Move it into a world from the Library.')); return; }
    if (!this.lookWall) {
      const { LookWall } = await import('./lookwall.js');
      this.lookWall ||= new LookWall({
        changed: (rows) => this.hooks.changed(rows.filter(Boolean)),
        toast: (t, a) => this.hooks.toast(t, a),
        menu: (anchor, items) => this.hooks.menu(anchor, items),
        askText: (o) => this.hooks.askText(o),
        openPage: (id) => this.hooks.go({ view: 'notebook', pageId: id })
      });
    }
    await this.lookWall.draw(body, this.world, { piece: this.piece.id, ai: this.aiFilm || this.anyGen, view: 'production' });
  }

  // ---------- shoot days and call sheets ----------

  async drawDays(body) {
    const days = await shootDays(this.piece.id);
    if (this.dayId && !days.some((d) => d.id === this.dayId)) this.dayId = null;
    const list = make('div', 'pd-days');
    for (const d of days) {
      const date = d.fields?.date ? new Date(`${d.fields.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date';
      const b = make('button', 'chip' + (d.id === this.dayId ? ' on' : ''), d.fields?.type === 'voice' ? `Voices · ${date}` : date);
      if (d.fields?.type === 'voice') b.dataset.type = 'voice';
      b.addEventListener('click', () => { this.dayId = d.id; this.render(); });
      list.append(b);
    }
    const add = make('button', 'chip add', '+ Shoot day');
    add.addEventListener('click', () => this.addDay());
    list.append(add);
    // Voices are recorded for generated shots; a film shot with a camera
    // records its sound on the day.
    if (this.anyGen || days.some((d) => d.fields?.type === 'voice')) {
      const addVoice = make('button', 'chip add', '+ Voice session');
      addVoice.title = 'A day for recording voices';
      addVoice.addEventListener('click', () => this.addDay('voice'));
      list.append(addVoice);
    }
    body.append(list);
    if (!this.dayId) this.drawPlan(body, days);
    const day = days.find((d) => d.id === this.dayId);
    if (!day) { body.append(make('p', 'hint gv-hint', 'A shoot day turns into a one-page call sheet: when and where, the scenes and shots, who’s needed, and the props and wardrobe from the breakdown. It can go to Daybook as a task on that day.')); return; }
    body.append(this.dayForm(day), this.callSheet(day));
  }

  async addDay(type = null, scenes = []) {
    const d = await newShootDay(this.piece.id, new Date(Date.now() + 86400000).toISOString().slice(0, 10), { type, scenes });
    this.dayId = d.id;
    this.hooks.changed([d]);
    await this.render();
    return d;
  }

  // What still needs a day, so nothing filmed or recorded is forgotten.
  drawPlan(body, days) {
    const { shoot, voice } = toPlan(this.scenes, days, this.set);
    if (!shoot.length && !voice.length) return;
    const box = make('section', 'pd-plan');
    box.append(make('h3', 'panel-label', 'To plan'));
    if (shoot.length) {
      const n = shoot.reduce((a, x) => a + x.shots.length, 0);
      box.append(make('p', 'pd-plan-what', `${plural(n, 'shot')} to film, not on a shoot day yet`));
      const ul = make('ul', 'pd-plan-list');
      for (const { scene, shots } of shoot) {
        const li = make('li');
        li.append(make('strong', '', `${scene.n ? `${scene.n} ` : ''}${scene.title}`));
        if (scene.slug) li.append(make('span', 'pd-sheet-slug', ` ${scene.slug}`));
        li.append(make('span', 'pd-sheet-sub', ` ${shots.map((sh) => `${this.codeOf(sh, scene)} ${MADE_BY.find((m) => m.id === madeBy(sh, this.set)).label.toLowerCase()}`).join(', ')}`));
        ul.append(li);
      }
      const go = make('button', 'pill', 'Put them on a new shoot day');
      go.addEventListener('click', () => this.addDay(null, shoot.map((x) => x.scene.id)));
      box.append(ul, go);
    }
    if (voice.length) {
      box.append(make('p', 'pd-plan-what', `${plural(voice.length, 'scene')} with voices to record, not on a voice session yet`));
      const ul = make('ul', 'pd-plan-list');
      for (const s of voice) { const li = make('li', '', `${s.n ? `${s.n} ` : ''}${s.title}`); if (s.slug) li.append(make('span', 'pd-sheet-slug', ` ${s.slug}`)); ul.append(li); }
      const go = make('button', 'pill', 'Put them on a new voice session');
      go.addEventListener('click', () => this.addDay('voice', voice.map((s) => s.id)));
      box.append(ul, go);
    }
    body.append(box);
  }

  dayForm(day) {
    const f = day.fields || {};
    const form = make('div', 'pd-dayform');
    const save = (patch) => this.saveShotFields(day.id, patch);
    const input = (type, key, label) => {
      const i = make('input', 'pd-input');
      i.type = type;
      i.value = f[key] || '';
      i.setAttribute('aria-label', label);
      i.addEventListener('change', async () => { await save({ [key]: i.value }); this.render(); });
      const w = make('label', 'pd-field');
      w.append(make('span', 'pd-field-label', label), i);
      return w;
    };
    const row = make('div', 'pd-dayrow');
    row.append(input('date', 'date', 'Date'), input('time', 'call', 'Call'), input('time', 'wrap', 'Wrap'), input('text', 'place', 'Where'));
    form.append(row);
    const pick = make('div', 'pd-daypick');
    pick.append(make('span', 'pd-field-label', 'Scenes'));
    const chosen = new Set(f.scenes || []);
    for (const s of this.scenes) {
      const c = make('button', 'chip' + (chosen.has(s.id) ? ' on' : ''), `${s.n ? `${s.n} ` : ''}${s.title}`);
      if (s.slug) c.title = s.slug;
      c.setAttribute('aria-pressed', String(chosen.has(s.id)));
      c.addEventListener('click', async () => {
        if (chosen.has(s.id)) chosen.delete(s.id); else chosen.add(s.id);
        await save({ scenes: this.scenes.map((x) => x.id).filter((id) => chosen.has(id)) });
        this.render();
      });
      pick.append(c);
    }
    form.append(pick, this.whoForm(day));
    const notes = make('textarea', 'pd-ta');
    notes.value = f.notes || '';
    notes.rows = 2;
    notes.placeholder = 'Anything else for the day: parking, food, weather backup…';
    notes.setAttribute('aria-label', 'Notes for the day');
    notes.addEventListener('input', () => this.later(`${day.id}:notes`, () => save({ notes: notes.value })));
    notes.addEventListener('blur', async () => { await this.now(`${day.id}:notes`); this.render(); });
    form.append(notes);
    const acts = make('div', 'pd-add');
    const print = make('button', 'pill', 'Print or save as PDF');
    print.addEventListener('click', () => { document.documentElement.classList.add('printing-sheet'); window.print(); setTimeout(() => document.documentElement.classList.remove('printing-sheet'), 500); });
    const send = make('button', 'pill', f.task ? 'Update the task' : 'Make it a task');
    send.title = 'A task on that day, at call time, linking back here';
    send.addEventListener('click', async () => {
      await this.now(`${day.id}:notes`);
      const rows = await shootDayTask((await getEntry(day.id)) || day, this.piece);
      this.hooks.changed(rows);
      this.render();
      this.hooks.toast(f.date ? `On your plan for ${new Date(`${f.date}T12:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${f.call ? ` at ${clock(f.call)}` : ''}` : 'Made a task, on the Tasks page');
    });
    const del = make('button', 'ghost-btn', f.type === 'voice' ? 'Delete the session' : 'Delete the day');
    del.addEventListener('click', async () => {
      const fresh = await getEntry(day.id);
      await putEntries([{ ...fresh, deleted: true, updated_at: Date.now() }]);
      this.dayId = null;
      this.render();
      this.hooks.toast(f.type === 'voice' ? 'Voice session deleted' : 'Shoot day deleted', { label: 'Undo', run: async () => { await putEntries([{ ...fresh, deleted: false, updated_at: Date.now() }]); this.dayId = fresh.id; this.render(); } });
    });
    acts.append(print, send, del);
    form.append(acts);
    return form;
  }

  // Who comes on a day: the cast in its scenes (who plays them comes from
  // Cast and places) and the film's crew, typed once and kept on the film.
  // Each can have their own call time that day; without one, the day's call.
  dayCast(day) {
    const ids = new Set(this.scenes.filter((s) => (day.fields?.scenes || []).includes(s.id)).flatMap((s) => s.uses));
    return [...ids].map((id) => this.elById.get(id)).filter((e) => e && e.fields.element.type === 'character');
  }
  crewOf() { return (this.piece.fields?.crew || []).filter((c) => c && c.id); }
  async saveCrew(crew) {
    const fresh = await getEntry(this.piece.id);
    const row = { ...fresh, fields: { ...fresh.fields, crew }, updated_at: Date.now() };
    await putEntries([row]);
    this.piece = row;
    this.hooks.changed([row]);
  }
  whoForm(day) {
    const f = day.fields || {};
    const box = make('div', 'pd-who');
    box.append(make('span', 'pd-field-label', 'Who’s coming'));
    const grid = make('div', 'pd-who-grid');
    const callIn = (key, label) => {
      const t = make('input', 'pd-input pd-who-call');
      t.type = 'time';
      t.value = f.calls?.[key] || '';
      t.setAttribute('aria-label', `Call time for ${label}`);
      t.title = f.call ? `Leave empty for the day’s call (${clock(f.call)})` : 'Their call time';
      t.addEventListener('change', async () => {
        const fresh = await getEntry(day.id);
        const calls = { ...(fresh.fields?.calls || {}) };
        if (t.value) calls[key] = t.value; else delete calls[key];
        await this.saveShotFields(day.id, { calls });
        this.render();
      });
      return t;
    };
    for (const e of this.dayCast(day)) {
      const by = (e.fields.element.playedBy || '').trim();
      const who = make('span', 'pd-who-name');
      who.append(make('strong', '', by || 'Not cast yet'), make('span', 'pd-sheet-sub', ` as ${e.title || 'Untitled'}`));
      if (!by) who.title = 'Who plays them goes on Cast and places: tap their name there';
      const row = make('div', 'pd-who-row cast');
      row.append(who, callIn(e.id, e.title || 'them'));
      grid.append(row);
    }
    const crew = this.crewOf();
    crew.forEach((c, i) => {
      const field = (key, ph) => {
        const t = make('input', 'pd-input');
        t.value = c[key] || '';
        t.placeholder = ph;
        t.setAttribute('aria-label', `${ph}, crew ${i + 1}`);
        t.addEventListener('change', async () => { const list = this.crewOf().map((x) => (x.id === c.id ? { ...x, [key]: t.value.trim() } : x)); await this.saveCrew(list); this.render(); });
        return t;
      };
      const del = make('button', 'pd-who-x', '×');
      del.type = 'button';
      del.setAttribute('aria-label', `Remove ${c.name || 'this person'} from the crew`);
      del.addEventListener('click', async () => {
        const before = this.crewOf();
        await this.saveCrew(before.filter((x) => x.id !== c.id));
        this.render();
        this.hooks.toast(`${c.name || 'Crew member'} removed from the crew`, { label: 'Undo', run: async () => { await this.saveCrew(before); this.render(); } });
      });
      const row = make('div', 'pd-who-row crew');
      row.append(field('name', 'Name'), field('job', 'Job'), callIn(c.id, c.name || c.job || 'crew'), del);
      grid.append(row);
    });
    box.append(grid);
    const add = make('button', 'ghost-btn', '+ Person');
    add.title = 'Someone on the crew: kept on the film for every day';
    add.addEventListener('click', async () => {
      await this.saveCrew([...this.crewOf(), { id: newId('cr'), name: '', job: '' }]);
      await this.render();
      [...this.el.querySelectorAll('.pd-who-grid input[placeholder="Name"]')].at(-1)?.focus();
    });
    box.append(add);
    return box;
  }

  // One page: everything on it already exists somewhere else.
  callSheet(day) {
    const f = day.fields || {};
    const sheet = make('article', 'pd-sheet');
    const voice = f.type === 'voice';
    const scenes = this.scenes.filter((s) => (f.scenes || []).includes(s.id));
    sheet.append(make('p', 'pd-sheet-kind', voice ? 'Voice session' : 'Call sheet'));
    sheet.append(make('h2', '', `${this.piece.title || 'Untitled'}${this.world && this.world.title !== this.piece.title ? ` · ${this.world.title}` : ''}`));
    const when = [f.date && new Date(`${f.date}T12:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), f.call && `Call ${clock(f.call)}`, f.wrap && `Wrap ${clock(f.wrap)}`].filter(Boolean).join(' · ');
    sheet.append(make('p', 'pd-sheet-when', when || 'No date yet'));
    if (f.place) sheet.append(make('p', 'pd-sheet-where', f.place));
    const uses = (type) => [...new Set(scenes.flatMap((s) => s.uses))].map((id) => this.elById.get(id)).filter((e) => e && (e.fields.element.type || 'other') === type);
    const section = (title, items) => {
      if (!items.length) return;
      sheet.append(make('h3', '', title));
      const ul = make('ul');
      for (const it of items) ul.append(typeof it === 'string' ? make('li', '', it) : it);
      sheet.append(ul);
    };
    section('Scenes', scenes.map((s) => {
      const li = make('li');
      li.append(make('strong', '', `${s.n ? `${s.n}  ` : ''}${s.title}`));
      // The crew needs the place and time: the slug, small, beside the name.
      if (s.slug) li.append(make('span', 'pd-sheet-slug', ` ${s.slug}`));
      if (s.synopsis) li.append(make('span', 'pd-sheet-sub', ` ${s.synopsis}`));
      if (voice) {
        // The lines to record, in order, with who says them.
        const lines = speechesIn(s.rows);
        if (lines.length) {
          const ul = make('ul', 'pd-sheet-shots');
          for (const l of lines) ul.append(make('li', '', `${l.who ? `${l.who}: ` : ''}${l.text}`));
          li.append(ul);
        }
      } else if (s.shots.length) {
        // A generated shot needs nothing from the day, so it isn't listed.
        // Each can be ticked on the day: the same Got it as on Shots.
        const filmed = s.shots.filter((sh) => needsFootage(madeBy(sh, this.set)));
        const ul = make('ul', 'pd-sheet-shots');
        for (const sh of filmed.length ? filmed : s.shots) {
          const m = madeBy(sh, this.set);
          const it = make('li', 'pd-sheet-shot');
          const words = `${this.codeOf(sh, s)}  ${sh.text || ''}`;
          const extra = [sh.fields?.framing, sh.fields?.note].filter(Boolean).join('. ');
          if (needsFootage(m)) {
            const lab = make('label');
            const box = make('input');
            box.type = 'checkbox';
            box.checked = gotIt(sh);
            box.setAttribute('aria-label', `Got it: ${sh.text || this.codeOf(sh, s)}`);
            box.addEventListener('change', () => this.setGot(sh.id, box.checked));
            lab.append(box, make('span', '', ` ${words}`));
            if (extra) lab.append(make('span', 'pd-sheet-sub', ` (${extra})`));
            if (m === 'ref') lab.append(make('span', 'pd-sheet-sub', ' · reference'));
            it.append(lab);
          } else it.textContent = `${words}${extra ? ` (${extra})` : ''}`;
          ul.append(it);
        }
        li.append(ul);
      }
      const notes = this.notesOf.get(s.id) || [];
      for (const n of notes) li.append(make('div', 'pd-sheet-note', n.text));
      return li;
    }));
    // Who's coming: the actor beside the character, then the crew, each
    // with their call time (the day's call unless they have their own).
    const callOf = (key) => { const v = f.calls?.[key] || f.call; return v ? clock(v) : ''; };
    const cast = uses('character');
    const crew = this.crewOf().filter((c) => c.name || c.job);
    if (cast.length || crew.length) {
      sheet.append(make('h3', '', 'Who’s coming'));
      const t = make('table', 'pd-sheet-who');
      const tr = (a, b, c) => { const r = make('tr'); r.append(make('td', 'pd-sheet-person', a), make('td', '', b), make('td', 'pd-sheet-call', c)); t.append(r); };
      for (const e of cast) tr(e.fields.element.playedBy?.trim() || 'Not cast yet', e.title || 'Untitled', callOf(e.id));
      if (!voice) for (const c of crew) tr(c.name || 'To find', c.job || '', callOf(c.id));
      sheet.append(t);
    }
    if (!voice) {
      section('Locations', uses('location').map((e) => e.title));
      section('Props', uses('prop').map((e) => e.title));
      section('Wardrobe', uses('wardrobe').map((e) => `${e.title}${e.fields.element.snippet ? `: ${e.fields.element.snippet}` : ''}`));
      section('Also', uses('other').map((e) => e.title));
    }
    if (f.notes) { sheet.append(make('h3', '', 'Notes')); sheet.append(make('p', '', f.notes)); }
    if (!scenes.length) sheet.append(make('p', 'hint', 'Pick the scenes for this day above.'));
    return sheet;
  }

  // ---------- posting ----------

  // Where this is, for remembering.
  place() { return { view: this.mode === 'deliver' ? 'deliver' : 'production', id: this.piece?.id, tab: this.tab }; }

  // ---------- Deliver: one page, in the order things go out ----------

  async drawDeliver(body) {
    const piece = this.piece;
    const ms = hasManuscript(piece);
    const shots = this.scenes.length > 0;
    const group = (id, title) => {
      const g = make('section', 'pd-group');
      g.dataset.group = id;
      g.append(make('h2', 'pd-group-h', title));
      body.append(g);
      return g;
    };
    if (!ms) body.append(make('p', 'hint gv-empty', 'This piece is an outline: open it and use Export from Ctrl + K.'));

    // The script, to readers.
    if (ms) {
      const g = group('script', this.script ? 'The script' : 'The text');
      const row = make('div', 'pd-row');
      const print = make('button', 'pill', 'Print or PDF');
      print.title = this.script ? 'The script in standard format, ready to print or save as a PDF' : 'As a manuscript, ready to print or save as a PDF';
      print.addEventListener('click', () => this.hooks.files('print', piece));
      const share = await this.hooks.shareOf(piece);
      const link = make('button', 'pill', share ? 'Link and comments…' : 'Link to read and comment');
      link.title = 'A link anyone can read (and comment on, if you like) without an account. Nothing else of yours is shared.';
      link.addEventListener('click', () => this.hooks.share(piece));
      const other = make('button', 'ghost-btn', 'Other formats');
      other.title = this.script ? 'Fountain, for WriterDuet, Highland or Final Draft; or Markdown' : 'Markdown: the words as plain text with headings';
      other.addEventListener('click', (e) => this.hooks.menu(e.currentTarget, [
        this.script && { label: 'Fountain (.fountain)', run: () => this.hooks.files('fountain', piece) },
        { label: 'Markdown (.md)', run: () => this.hooks.files('markdown', piece) }
      ].filter(Boolean)));
      row.append(print, link, other);
      g.append(row);
      if (share) {
        const url = make('input', 'pd-input share-url');
        url.readOnly = true;
        url.value = share.url;
        url.setAttribute('aria-label', 'The link');
        url.addEventListener('focus', () => url.select());
        g.append(make('p', 'hint', share.comments ? 'Shared: anyone with the link can read it and comment.' : 'Shared: anyone with the link can read it.'), url);
      }
    }

    // The film, to the edit: one button, the single files folded.
    if (shots) {
      const g = group('edit', 'For the edit');
      const row = make('div', 'pd-row');
      const hand = make('button', 'pill pd-handoff', 'Hand-off for Resolve (.zip)');
      hand.addEventListener('click', () => this.exportHandoff());
      const at = piece.fields?.handoff;
      row.append(hand, make('span', 'hint', `The rough cut, each picked take named by its shot, the shot list and subtitles.${at ? ` Last made ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.` : ''}`));
      g.append(row);
      const open = pref('deliverOne', '') === '1';
      const fold = make('button', 'ghost-btn pd-fold', `${open ? '▾' : '▸'} One file at a time`);
      fold.setAttribute('aria-expanded', String(open));
      const files = make('div', 'pd-row pd-onefile');
      files.hidden = !open;
      fold.addEventListener('click', () => {
        files.hidden = !files.hidden;
        setPref('deliverOne', files.hidden ? '' : '1');
        fold.setAttribute('aria-expanded', String(!files.hidden));
        fold.textContent = `${files.hidden ? '▸' : '▾'} One file at a time`;
      });
      const file = (label, about, run, ok = true) => {
        if (!ok) return;
        const b = make('button', 'chip pd-file', label);
        b.title = about;
        b.addEventListener('click', run);
        files.append(b);
      };
      file('Shot list (.csv)', 'Every shot with its code, scene, framing, prompts and the take you picked', async () => { await this.loadNames(); this.exportCsv(); });
      file('Rough cut (.edl)', 'The picked takes in script order, each named by its shot code. Picked stills stand in for shots with no take yet', () => this.exportEdl());
      file('Subtitles (.srt)', 'Every line of dialogue in order, two seconds each: fix the timing in Resolve', () => this.exportSrt(), this.script);
      g.append(fold, files, make('p', 'hint', 'A shot’s kit (its prompts and reference pictures, as a .zip) is on each shot in Make.'));
    } else if (ms && this.script) {
      const g = group('edit', 'For the edit');
      const srt = make('button', 'ghost-btn pd-file', 'Subtitles (.srt)');
      srt.title = 'Every line of dialogue in order, two seconds each: import into Resolve and fix the timing there';
      srt.addEventListener('click', () => this.exportSrt());
      g.append(srt);
    }

    // Out: only the places it goes.
    const g = group('out', 'Out');
    const posting = piece.fields?.posting || {};
    const places = this.placesOf();
    const list = make('div', 'pd-post');
    for (const p of places) {
      const x = posting[p.id] || {};
      const card = make('div', 'pd-post-card');
      card.dataset.platform = p.id;
      const head = make('div', 'pd-prompt-head');
      head.append(make('span', 'panel-label', p.label));
      const copy = make('button', 'ghost-btn', 'Copy');
      copy.addEventListener('click', () => this.copy(cap.value, `${p.label} caption copied`));
      const del = make('button', 'ghost-btn pd-post-x', '×');
      del.title = `Not posting to ${p.label}`;
      del.setAttribute('aria-label', `Remove ${p.label}`);
      del.addEventListener('click', async () => {
        const before = this.placesOf().map((q) => q.id);
        await this.savePlaces(before.filter((id) => id !== p.id));
        await this.render();
        this.hooks.toast(`${p.label} taken off (its caption is kept)`, { label: 'Undo', run: async () => { await this.savePlaces(before); await this.render(); } });
      });
      head.append(copy, del);
      const cap = make('textarea', 'pd-ta');
      cap.value = x.caption || '';
      cap.rows = 3;
      cap.placeholder = 'Caption';
      cap.setAttribute('aria-label', `${p.label} caption`);
      cap.addEventListener('input', () => this.later(`post:${p.id}:caption`, () => this.savePost(p.id, { caption: cap.value })));
      cap.addEventListener('blur', () => this.now(`post:${p.id}:caption`));
      const link = make('input', 'pd-input');
      link.type = 'url';
      link.value = x.url || '';
      link.placeholder = 'Link to the post, once it’s up';
      link.setAttribute('aria-label', `${p.label} post link`);
      link.addEventListener('change', () => this.savePost(p.id, { url: link.value.trim() }));
      card.append(head, cap, link);
      list.append(card);
    }
    if (places.length) g.append(list);
    else g.append(make('p', 'hint', 'Where is it going? Add the places you post to.'));
    const add = make('div', 'pd-row pd-places');
    for (const p of PLATFORMS.filter((q) => !places.includes(q))) {
      const b = make('button', 'chip quiet', `+ ${p.label}`);
      b.dataset.platform = p.id;
      b.addEventListener('click', async () => { await this.savePlaces([...places.map((q) => q.id), p.id]); await this.render(); this.el.querySelector(`.pd-post-card[data-platform="${p.id}"] textarea`)?.focus(); });
      add.append(b);
    }
    g.append(add);
    if (places.length && this.hooks.canAsk()) {
      const draft = make('button', 'pill', 'Draft captions with Claude');
      draft.addEventListener('click', () => this.captions());
      g.append(draft);
    }
  }

  // The places this piece goes out to: picked ones, else the ones that
  // already have a caption or a link.
  placesOf() {
    const f = this.piece.fields || {};
    const ids = Array.isArray(f.postTo) ? f.postTo : Object.keys(f.posting || {}).filter((id) => f.posting[id]?.caption || f.posting[id]?.url);
    return ids.map((id) => PLATFORMS.find((p) => p.id === id)).filter(Boolean);
  }

  async savePlaces(ids) {
    const fresh = await getEntry(this.piece.id);
    const row = { ...fresh, fields: { ...fresh.fields, postTo: ids }, updated_at: Date.now() };
    await putEntries([row]);
    this.piece = row;
    this.hooks.changed([row]);
  }

  async savePost(platform, patch) {
    const fresh = await getEntry(this.piece.id);
    const posting = { ...(fresh.fields?.posting || {}) };
    posting[platform] = { ...(posting[platform] || {}), ...patch };
    const row = { ...fresh, fields: { ...fresh.fields, posting }, updated_at: Date.now() };
    await putEntries([row]);
    this.piece = row;
    this.hooks.changed([row]);
  }

  async captions() {
    const posting = this.piece.fields?.posting || {};
    const places = this.placesOf();
    const empty = places.filter((p) => !(posting[p.id]?.caption || '').trim());
    let wanted = empty;
    if (!empty.length) {
      const ok = await this.hooks.ask({ title: 'Replace every caption?', body: 'Each place already has a caption. Claude’s drafts would replace them.', ok: 'Replace them' });
      if (!ok) return;
      wanted = places;
    }
    const text = [this.piece.fields?.synopsis || '', ...this.scenes.map((s) => `${s.title}\n${s.text}`)].join('\n\n').slice(0, 20000);
    const out = await this.ask('Claude is drafting captions…', { ...this.base('captions'), platforms: wanted.map((p) => p.label), text });
    if (!out) { await this.render(); return; }
    let n = 0;
    for (const c of out.captions || []) {
      const p = PLATFORMS.find((x) => x.id === c.platform || x.label.toLowerCase() === c.platform);
      if (!p || !wanted.includes(p)) continue;
      await this.savePost(p.id, { caption: c.text });
      n += 1;
    }
    await this.render();
    this.hooks.toast(n ? `Claude drafted ${plural(n, 'caption')}` : 'No captions came back');
  }

  // ---------- out to the edit ----------

  csvText() {
    const rows = [['Shot', 'Scene', 'Scene heading', 'What happens', 'Framing', 'Stage', 'Model', 'Seconds', 'Still prompt', 'Video prompt', 'Still', 'Take']];
    const name = (id) => this.fileNames.get(id) || '';
    for (const s of this.scenes) for (const sh of s.shots) {
      const f = sh.fields || {};
      rows.push([this.codeOf(sh, s), s.code || '', s.slug || s.title, sh.text || '', f.framing || '', shotStatus(sh, this.set), genOf(sh).model || '', genOf(sh).secs || '', f.still || '', f.video || '', name(f.star?.still), name(f.star?.video)]);
    }
    return toCsv(rows);
  }

  exportCsv() {
    download(`${this.piece.title || 'Shots'} shot list.csv`, new Blob(['﻿' + this.csvText()], { type: 'text/csv' }));
  }

  // ---------- the Resolve hand-off ----------

  // The rough cut's events, with each file's name and real length.
  async cut({ stills = true } = {}) {
    const ids = new Set();
    for (const s of this.scenes) for (const sh of s.shots) for (const id of Object.values(sh.fields?.star || {})) ids.add(id);
    const files = new Map();
    for (const id of ids) {
      const meta = await getEntry(id);
      if (!meta || meta.deleted) continue;
      files.set(id, { name: meta.title || id, type: meta.fields?.type || '', secs: isVideo(meta.fields?.type) ? (meta.fields?.ms ? meta.fields.ms / 1000 : await this.videoSecs(id)) : 0 });
    }
    const scenes = this.scenes.map((s) => ({ shots: s.shots, code: (sh) => this.codeOf(sh, s) }));
    return { events: cutEvents(scenes, files, { stills }), files };
  }

  // How long a video is, read from the file itself.
  async videoSecs(id) {
    const url = await fileUrl(id);
    if (!url) return 0;
    return new Promise((resolve) => {
      const v = document.createElement('video');
      const done = (n) => { clearTimeout(t); v.removeAttribute('src'); resolve(n); };
      const t = setTimeout(() => done(0), 8000);
      v.preload = 'metadata';
      v.muted = true;
      v.addEventListener('loadedmetadata', () => done(Number.isFinite(v.duration) ? Math.round(v.duration * 1000) / 1000 : 0));
      v.addEventListener('error', () => done(0));
      v.src = url;
    });
  }

  // The file name a take goes by in the hand-off: its shot code. A run made
  // in one generation is one file, named by its first shot.
  handoffName(ev, files) {
    const f = files.get(ev.file_id);
    return `${ev.code}.${extOf(f?.name, f?.type)}`;
  }

  edlText(events, files) {
    const named = events.map((e) => ({ ...e, file: this.handoffName(this.leadOf(events, e), files) }));
    // Each event's reel is the file's name without its extension.
    return toEdl(named.map((e) => ({ ...e, reel: e.file.replace(/\.[^.]+$/, '') })), { title: this.piece.title || 'Rough cut', fps: rulesOf(this.world).fps });
  }

  // The first event that uses the same file (the shot a shared take is named by).
  leadOf(events, e) { return events.find((x) => x.file_id === e.file_id) || e; }

  async exportEdl() {
    const { events, files } = await this.cut();
    if (!events.length) { this.hooks.toast('Star a take (or a still) on a shot first, then the rough cut has something to lay out.'); return; }
    download(`${this.piece.title || 'Rough cut'}.edl`, new Blob([this.edlText(events, files)], { type: 'text/plain' }));
    const takes = events.filter((e) => !e.still).length;
    this.hooks.toast(`${plural(events.length, 'shot')} in the rough cut${takes < events.length ? `, ${events.length - takes} as stills` : ''}. Name each take by its shot code so Resolve finds it.`);
  }

  async exportHandoff() {
    const { events, files } = await this.cut();
    if (!events.length) { this.hooks.toast('Star a take (or a still) on a shot first, then there’s something to hand off.'); return; }
    const out = [{ path: 'Rough cut.edl', text: this.edlText(events, files) }];
    const seen = new Set();
    let bytes = 0;
    const missing = [];
    for (const e of events) {
      if (seen.has(e.file_id)) continue;
      seen.add(e.file_id);
      const b = await fileBlob(e.file_id);
      if (!b) { missing.push(e.code); continue; }
      bytes += b.size;
      out.push({ path: `Takes/${this.handoffName(e, files)}`, bytes: new Uint8Array(await b.arrayBuffer()) });
    }
    if (bytes > 1.5 * 1024 * 1024 * 1024) { this.hooks.toast('The takes are over 1.5 GB, too big for one download. Use the rough cut (.edl) and the takes on the NAS instead.'); return; }
    await this.loadNames();
    out.push({ path: 'Shot list.csv', text: '﻿' + this.csvText() });
    if (this.script) {
      const rows = [];
      for (const s of this.scenes) rows.push(...s.rows.filter((r) => r.kind === 'para'));
      const speeches = speechesIn(rows);
      if (speeches.length) out.push({ path: 'Subtitles.srt', text: toSrt(speeches) });
    }
    out.push({ path: 'Read me.txt', text: [
      `${this.piece.title || 'Rough cut'}: hand-off for DaVinci Resolve`,
      '',
      '1. In Resolve, open Project Settings (Shift + 9), General Options, Conform Options, and set "Assist using reel names from the" to "Source clip filename".',
      '2. Drag the Takes folder into the Media Pool.',
      `3. File, Import, Timeline, then pick "Rough cut.edl". Keep the frame rate at ${rulesOf(this.world).fps} fps.`,
      '4. The timeline lays out every starred take in script order. Clips named by a shot code (like NB-E01-S03-04) are the takes; a still stands in where no take is starred yet.',
      missing.length ? `\nNot on this device yet (open them once in Inkwell, then hand off again): ${missing.join(', ')}` : ''
    ].join('\r\n') });
    download(`${this.piece.title || 'Rough cut'} for Resolve.zip`, zip(out));
    // The path's Editing stage says when the hand-off was made.
    const fresh = await getEntry(this.piece.id);
    if (fresh) { const row = { ...fresh, fields: { ...fresh.fields, handoff: Date.now() }, updated_at: Date.now() }; await putEntries([row]); this.piece = row; this.hooks.changed([row]); }
    this.hooks.toast(missing.length ? `Hand-off saved. ${plural(missing.length, 'take')} weren’t on this device yet.` : 'Hand-off saved for Resolve');
  }

  async exportSrt() {
    const rows = [];
    for (const s of this.scenes) rows.push(...s.rows.filter((r) => r.kind === 'para'));
    const speeches = speechesIn(rows);
    if (!speeches.length) { this.hooks.toast('No dialogue in the script yet.'); return; }
    download(`${this.piece.title || 'Script'} subtitles.srt`, new Blob([toSrt(speeches)], { type: 'text/plain' }));
  }

  // ---------- settings ----------

  async saveWorldProd(patch) {
    if (!this.world) return;
    const fresh = await getEntry(this.world.id);
    const row = { ...fresh, fields: { ...fresh.fields, production: { ...(fresh.fields?.production || {}), ...patch } }, updated_at: Date.now() };
    await putEntries([row]);
    this.world = row;
    this.hooks.changed([row]);
    if (!this.timers.size) this.refresh();
  }

  async savePiece(patch) {
    const fresh = await getEntry(this.piece.id);
    const fields = { ...fresh.fields, ...patch };
    for (const k of Object.keys(patch)) if (patch[k] === null) delete fields[k];
    const row = { ...fresh, fields, updated_at: Date.now() };
    await putEntries([row]);
    this.piece = row;
    this.hooks.changed([row]);
    this.refresh();
  }

  moreMenu() {
    return [
      this.hooks.canAsk() && { label: 'Break down every scene, with Claude', run: () => this.breakdown() },
      { label: 'Shot list for Resolve (.csv)', run: async () => { await this.loadNames(); this.exportCsv(); } },
      { label: 'Rough cut for Resolve (.edl)', run: () => this.exportEdl() },
      this.script && { label: 'Dialogue for subtitles (.srt)', run: () => this.exportSrt() },
      this.script && !this.piece.fields?.numbered && { label: 'Number the scenes', run: () => this.hooks.numberScenes(this.piece) },
      'sep',
      { label: 'Shot codes…', run: () => { this.codesOpen = true; setPref('prodTab', 'shots'); this.render().then(() => this.el.querySelector('.pd-code-input')?.focus()); } },
      { label: 'Prices…', run: () => this.pricesDialog() },
      this.piece.fields?.videoTools && !this.setTools.length && 'sep',
      this.piece.fields?.videoTools && !this.setTools.length && { label: 'Put the video tools away', run: () => this.setVideoTools(false) }
    ].filter(Boolean);
  }

  async loadNames() {
    this.fileNames = new Map();
    for (const s of this.scenes) for (const sh of s.shots) for (const id of Object.values(sh.fields?.star || {})) { const f = await getEntry(id); if (f) this.fileNames.set(id, f.title || ''); }
  }
}

