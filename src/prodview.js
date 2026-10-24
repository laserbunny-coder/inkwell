import { getEntry, getMany, putEntries, byKind } from './db.js';
import { tagsIn } from './model.js';
import { loadStructure, rowsAt } from './grid.js';
import { bookType, hasManuscript, worldOf } from './library.js';
import { addFile, fileUrl, fileBlob, isImage } from './files.js';
import { zip } from './vault.js';
import { download } from './export.js';
import {
  ELEMENT_TYPES, typeOf, elementsIn, plainPages, newElement, setElement, namesOf,
  findElements, sceneElements, changeBreakdown, sceneSig, shotCode, newShot, shotStage, SHOT_STAGES,
  withRenders, withPrompts, isVideo, shotForName, shootDays, newShootDay, dayTask, toCsv, toSrt, speechesIn, PLATFORMS
} from './production.js';

// The production view of a piece (Ctrl + Shift + S): its scenes, each with
// the elements it uses and its shots; a storyboard of the stills picked;
// the world's kit; shoot days and their call sheets; and posting. Like the
// plot grid, nothing here is a copy: a scene is the scene heading in the
// script, the kit is the world's bible pages.

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* full */ } };
const hidden = () => new Set(JSON.parse(pref('prodHide', '[]')));
// Make: the shots and what they need. Deliver: what goes out (files, a share
// link, posting). Both are this view, with different tabs.
export const TABS = [
  { id: 'shots', label: 'Shots' },
  { id: 'board', label: 'Storyboard' },
  { id: 'kit', label: 'Kit' },
  { id: 'days', label: 'Shoot days' }
];
export const DELIVER_TABS = [
  { id: 'files', label: 'Files' },
  { id: 'share', label: 'Share' },
  { id: 'post', label: 'Posting' }
];
const PROD_NOTES = ['production', 'ai'];
const initials = (t) => (t || '').split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w) && !/^(the|a|an|of|and|vs\.?)$/i.test(w)).map((w) => w[0]).join('').toUpperCase().slice(0, 4);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// "07:30" as people say it: "7:30 am".
const clock = (hm) => { const [h, m] = String(hm).split(':').map(Number); return Number.isFinite(h) ? `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` : hm; };
const extOf = (name, type) => (/\.([a-z0-9]{1,5})$/i.exec(name || '')?.[1] || (type || '').split('/')[1] || 'bin').toLowerCase();

export class ProductionView {
  // hooks: open(row), openPage(id), leave(piece), changed(rows), menu,
  // menuButton, ask, askText, toast, askServer, canAsk, numberScenes(piece),
  // sendTask(task), base().
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.piece = null;
    this.open = new Set();
    this.busy = Promise.resolve();
    this.timers = new Map();
    this.touch = matchMedia('(hover: none)');
    this.dayId = null;
    el.addEventListener('dragover', (e) => { if (this.isOpen && [...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
    el.addEventListener('drop', (e) => this.dropAnywhere(e));
  }

  get isOpen() { return !!this.piece && ['production', 'deliver'].includes(document.documentElement.dataset.view); }
  get tabs() { return this.mode === 'deliver' ? DELIVER_TABS : TABS; }
  get tabKey() { return this.mode === 'deliver' ? 'deliverTab' : 'prodTab'; }
  get tab() { const t = pref(this.tabKey, this.tabs[0].id); return this.tabs.some((x) => x.id === t) ? t : this.tabs[0].id; }

  async show(pieceId, opts = {}) {
    this.piece = await getEntry(pieceId);
    this.mode = opts.mode === 'deliver' || DELIVER_TABS.some((t) => t.id === opts.tab) ? 'deliver' : 'make';
    if (opts.tab) setPref(this.tabKey, opts.tab);
    if (opts.shot) this.open.add(opts.shot);
    if (opts.day) { this.dayId = opts.day; setPref('prodTab', 'days'); }
    await this.render();
    if (opts.shot) this.el.querySelector(`[data-shot="${CSS.escape(opts.shot)}"]`)?.scrollIntoView({ block: 'center' });
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
    const st = hasManuscript(piece) ? await loadStructure(piece) : { acts: [], pieces: [] };
    this.items = st.acts.length ? rowsAt(this.script ? 'slug' : 'scene', st, piece) : [];
    this.scenes = this.items.filter((x) => x.type === 'row');
    const texts = new Map();
    for (const act of st.acts) for (const ch of act.chapters) for (const r of ch.rows) texts.set(r.id, r);
    this.texts = texts;
    this.elements = await elementsIn(this.world);
    this.elById = new Map(this.elements.map((e) => [e.id, e]));
    const ids = new Set(this.scenes.map((s) => s.id));
    const members = new Map();
    for (const s of this.scenes) for (const m of s.members) members.set(m, s.id);
    const shots = (await byKind('shot')).sort((a, b) => a.sort - b.sort);
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
    for (const s of this.scenes) {
      const rows = s.members.map((id) => texts.get(id)).filter(Boolean);
      s.rows = rows;
      s.text = rows.map((r) => (r.kind === 'scene' ? r.title || '' : r.text || '')).filter((t) => t.trim()).join('\n');
      s.sig = sceneSig(rows.map((r) => r.text || r.title || ''));
      const cues = rows.filter((r) => r.fields?.el === 'character').map((r) => r.text || '');
      s.found = findElements(s.text + '\n' + (this.notesOf.get(s.id) || []).map((n) => n.text).join('\n'), cues, this.elements);
      s.bd = this.bds.get(s.id) || null;
      s.uses = sceneElements(s.found, s.bd).filter((id) => this.elById.has(id));
      s.shots = this.shotsOf.get(s.id) || [];
      s.changed = s.shots.length > 0 && !!s.bd?.fields?.sig && s.bd.fields.sig !== s.sig;
    }
    // Which renders are videos, for the storyboard's stills.
    const fileIds = new Set();
    for (const sh of shots) for (const t of sh.fields?.tries || []) for (const id of t.files || []) fileIds.add(id);
    this.kindOf = new Map((await getMany([...fileIds])).filter(Boolean).map((f) => [f.id, isVideo(f.fields?.type) ? 'video' : 'still']));
    // Every shot's code, for finding the shot a file name belongs to.
    this.codes = new Map();
    for (const s of this.scenes) for (const sh of s.shots) this.codes.set(this.codeOf(sh, s), sh.id);
    return true;
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
    if (this.mode !== 'deliver') tools.append(this.hooks.menuButton(() => this.moreMenu(), 'More for production'));
    head.append(tools);
    const sub = make('div', 'gv-sub');
    const tabs = make('div', 'gv-levels');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', this.mode === 'deliver' ? 'Deliver' : 'Make');
    for (const t of this.tabs) {
      const b = make('button', 'chip' + (t.id === this.tab ? ' on' : ''), t.label);
      b.setAttribute('role', 'tab');
      b.dataset.tab = t.id;
      b.setAttribute('aria-selected', String(t.id === this.tab));
      b.addEventListener('click', () => { setPref(this.tabKey, t.id); this.hooks.moved?.(this.place()); this.render(); });
      tabs.append(b);
    }
    sub.append(tabs);
    const body = make('div', 'pd-body');
    body.dataset.tab = this.tab;
    const hide = hidden();
    for (const k of hide) body.classList.add(`no-${k}`);
    if (this.tab === 'shots') await this.drawShots(body);
    if (this.tab === 'board') await this.drawBoard(body);
    if (this.tab === 'kit') await this.drawKit(body);
    if (this.tab === 'days') await this.drawDays(body);
    if (this.tab === 'post') await this.drawPost(body);
    if (this.tab === 'files') await this.drawFiles(body);
    if (this.tab === 'share') await this.drawShare(body);
    const panel = this.mode === 'deliver' && this.tab !== 'post' ? null : this.claudePanel();
    this.el.replaceChildren(...[head, sub, panel, body].filter(Boolean));
  }

  // ---------- shots ----------

  async drawShots(body) {
    if (!this.scenes.length) {
      body.append(make('p', 'hint gv-empty', hasManuscript(this.piece) ? 'No scenes yet. Scene headings in the script (INT. / EXT.) become scenes here, each with its shots.' : 'Production works on a script or prose draft. This piece is an outline.'));
      return;
    }
    const codes = make('div', 'pd-codes');
    codes.append(make('span', 'panel-label', 'Shot codes'));
    const show = this.codeInput(this.world?.fields?.production?.code || '', 'Show', 'NB', (v) => this.saveWorldProd({ code: v }));
    const pc = this.codeInput(this.piece.fields?.code || '', 'Piece', 'E01', (v) => this.savePiece({ code: v || null }));
    codes.append(show, make('span', 'pd-dash', '-'), pc, make('span', 'pd-dash', this.script ? '-S03-04' : '-04'));
    codes.title = 'Shot codes go in file names on the NAS and clip names in Resolve. Set them before files are named; after that, leave them.';
    body.append(codes);
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
    const title = make('button', 'pd-scene-title');
    if (s.code) title.append(make('span', 'gv-code', s.code));
    title.append(make('span', '', s.title));
    title.title = 'Open it in the text';
    title.addEventListener('click', () => this.hooks.open(s));
    head.append(title);
    if (s.changed) {
      const ch = make('button', 'pd-changed', 'Changed since shots');
      ch.title = 'The scene was rewritten after its shots were planned. Check the shots, then mark them as matching.';
      ch.addEventListener('click', () => this.hooks.menu(ch, [
        { label: 'Open the scene', run: () => this.hooks.open(s) },
        { label: 'The shots still match', run: () => this.matched(s) }
      ]));
      head.append(ch);
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
    add.append(plus);
    if (this.hooks.canAsk()) {
      const sug = make('button', 'ghost-btn', s.shots.length ? 'Claude: more shots' : 'Claude: suggest shots');
      sug.addEventListener('click', () => this.suggestShots(s));
      add.append(sug);
      if (s.shots.length) {
        const pr = make('button', 'ghost-btn', 'Claude: write prompts');
        pr.addEventListener('click', () => this.writePrompts(s));
        add.append(pr);
      }
    }
    box.append(add);
    return box;
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
    if (!s.uses.length) row.append(make('span', 'hint pd-chips-hint', this.elements.length ? 'No elements found in this scene' : 'Characters, places and props from the Kit show here'));
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
      s.changed && { label: 'The shots still match the scene', run: () => this.matched(s) }
    ].filter(Boolean);
  }

  // ---------- a shot ----------

  shotEl(sh, s) {
    const f = sh.fields || {};
    const box = make('div', 'pd-shot' + (this.open.has(sh.id) ? ' open' : ''));
    box.dataset.shot = sh.id;
    const stage = shotStage(sh);
    box.dataset.stage = stage;
    const row = make('div', 'pd-shot-row');
    const code = make('button', 'pd-code', s ? this.codeOf(sh, s) : `#${f.n || ''}`);
    code.title = 'Copy the shot code (for the file name)';
    code.addEventListener('click', () => this.copy(code.textContent, 'Shot code copied'));
    const what = this.editable('pd-what', sh.text || '', 'What happens', (v) => this.saveShot(sh.id, { text: v, tags: tagsIn(v) }));
    const framing = this.editable('pd-framing', f.framing || '', 'Framing', (v) => this.saveShotFields(sh.id, { framing: v }));
    const dot = make('span', 'pd-stage', SHOT_STAGES.find((x) => x.id === stage).label);
    const toggle = make('button', 'pd-toggle', this.open.has(sh.id) ? '▾' : '▸');
    toggle.setAttribute('aria-label', this.open.has(sh.id) ? 'Hide prompts and renders' : 'Prompts and renders');
    toggle.setAttribute('aria-expanded', String(this.open.has(sh.id)));
    toggle.addEventListener('click', () => { if (this.open.has(sh.id)) this.open.delete(sh.id); else this.open.add(sh.id); this.render(); });
    row.append(toggle, code, what, framing, dot, this.hooks.menuButton(() => this.shotMenu(sh, s), 'More for this shot'));
    box.append(row);
    if (this.open.has(sh.id)) box.append(this.shotDetail(sh, s));
    // Renders dropped on a shot go to it.
    box.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); box.classList.add('drop'); } });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); box.classList.remove('drop'); this.addRenders(sh.id, [...(e.dataTransfer?.files || [])]); });
    return box;
  }

  shotDetail(sh, s) {
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
    // Renders: the try that made each one, newest first, with the star.
    const tries = (f.tries || []).filter((t) => t.files?.length);
    const strip = make('div', 'pd-renders');
    for (const t of [...tries].reverse()) for (const id of [...t.files].reverse()) strip.append(this.renderEl(sh, id));
    const add = make('label', 'pd-render add');
    add.title = 'Add renders: stills or video takes. Or drop them on the shot.';
    add.append(make('span', '', '+'));
    const input = make('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*';
    input.hidden = true;
    input.addEventListener('change', () => this.addRenders(sh.id, [...input.files]));
    add.append(input);
    strip.append(add);
    d.append(strip);
    const acts = make('div', 'pd-add');
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
        item.append(make('div', 'pd-try-head', `${new Date(t.at).toLocaleDateString()}${t.by === 'claude' ? ' · Claude' : ''}${t.files?.length ? ` · ${plural(t.files.length, 'render')}` : ''}${starred ? ' · ★' : ''}`));
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
      tile.title = meta.title || '';
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
      { label: s ? 'Move to another scene…' : 'Move to a scene…', run: () => this.hooks.menu(this.el.querySelector(`[data-shot="${CSS.escape(sh.id)}"] .pd-code`) || this.el, this.scenes.filter((x) => x.id !== s?.id).map((x) => ({ label: `${x.code ? `${x.code} ` : ''}${x.title}`, run: () => this.moveShot(sh, x) }))) },
      { label: 'Copy the shot code', run: () => this.copy(s ? this.codeOf(sh, s) : '', 'Shot code copied') },
      { label: 'Delete the shot', danger: true, run: () => this.deleteShot(sh) }
    ].filter(Boolean);
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
    const lines = [
      code, s ? `Scene: ${s.title}` : '', sh.text ? `Shot: ${sh.text}` : '', f.framing ? `Framing: ${f.framing}` : '', '',
      'STILL PROMPT', f.still || '(none yet)', '', 'VIDEO PROMPT', f.video || '(none yet)', '',
      ...(els.length ? ['ELEMENTS', ...els.map((e) => `${e.title} (${typeOf(e.fields.element.type).label})${e.fields.element.look ? ` [${e.fields.element.look}]` : ''}: ${e.fields.element.snippet || ''}`)] : []),
      this.world?.fields?.production?.style ? `\nSTYLE\n${this.world.fields.production.style}` : ''
    ].filter((x) => x !== null);
    const files = [{ path: `${code} prompts.txt`, text: lines.join('\n').replace(/\n{3,}/g, '\n\n') }];
    for (const e of els) {
      for (const [i, id] of (e.fields.element.refs || []).entries()) {
        const b = await fileBlob(id);
        const meta = await getEntry(id);
        if (b) files.push({ path: `References/${e.title.replace(/[\\/:*?"<>|]/g, '-')} ${i + 1}.${extOf(meta?.title, meta?.fields?.type)}`, bytes: new Uint8Array(await b.arrayBuffer()) });
      }
    }
    if (f.star?.still) {
      const b = await fileBlob(f.star.still);
      const meta = await getEntry(f.star.still);
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
      id: s.id, code: s.code || '', heading: s.title, summary: s.synopsis || '',
      text: s.rows.map((r) => (r.kind === 'scene' ? `[${r.title || 'section'}]` : r.fields?.el === 'character' ? (r.text || '').toUpperCase() : r.text || '')).filter((t) => t.trim()).join('\n'),
      notes, elements: s.uses,
      ...(withShots ? { shots: s.shots.map((sh) => ({ id: sh.id, code: this.codeOf(sh, s), what: sh.text || '', framing: sh.fields?.framing || '', still: sh.fields?.still || '', video: sh.fields?.video || '' })) } : {})
    };
  }

  kitBody(only = null) {
    return this.elements.filter((e) => !only || only.includes(e.id)).map((e) => ({ id: e.id, type: e.fields.element.type || 'other', name: e.title || '', also: e.fields.element.also || [], snippet: e.fields.element.snippet || '', look: e.fields.element.look || '' }));
  }

  base(task) {
    return { mode: 'production', task, piece: this.piece.title || '', world: this.world?.title || '', style: this.world?.fields?.production?.style || '' };
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
        this.hooks.toast(`“${m.name}” is in the kit. Add its look on the Kit tab.`);
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
  stillOf(sh) {
    const f = sh.fields || {};
    if (f.star?.still) return f.star.still;
    for (const t of [...(f.tries || [])].reverse()) for (const id of [...(t.files || [])].reverse()) if (this.kindOf?.get(id) === 'still') return id;
    return null;
  }

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

  // ---------- the kit ----------

  async drawKit(body) {
    if (!this.world) { body.append(make('p', 'hint gv-empty', 'This piece isn’t in a world, so it has no kit. Move it into a world from the Library.')); return; }
    const top = make('div', 'pd-kit-top');
    const style = make('textarea', 'pd-ta pd-style');
    style.value = this.world.fields?.production?.style || '';
    style.placeholder = 'The look of the whole show, used in every prompt: art style, palette, lens, lighting, what to avoid…';
    style.setAttribute('aria-label', 'Style rules');
    style.rows = 3;
    style.addEventListener('input', () => this.later('style', () => this.saveWorldProd({ style: style.value })));
    style.addEventListener('blur', () => this.now('style'));
    const label = make('div', 'pd-prompt-head');
    label.append(make('span', 'panel-label', `Style rules for ${this.world.title || 'this world'}`));
    top.append(label, style);
    body.append(top);
    for (const t of ELEMENT_TYPES) {
      const els = this.elements.filter((e) => (e.fields.element.type || 'other') === t.id);
      if (!els.length) continue;
      const sec = make('section', 'pd-kit-sec');
      sec.append(make('div', 'panel-label', t.plural));
      const list = make('div', 'pd-kit-list');
      for (const e of els) list.append(this.elementEl(e));
      sec.append(list);
      body.append(sec);
    }
    const acts = make('div', 'pd-add');
    const add = make('button', 'ghost-btn', '+ Element');
    add.addEventListener('click', async () => { const el = await this.askNewElement(); if (el) await this.render(); });
    const use = make('button', 'ghost-btn', 'Use a bible page…');
    use.addEventListener('click', async () => {
      const pages = await plainPages(this.world);
      if (!pages.length) { this.hooks.toast('Every bible page is already an element.'); return; }
      this.hooks.menu(use, pages.slice(0, 60).map(({ page, guess }) => ({ label: page.title || 'Untitled page', sub: ELEMENT_TYPES.map((x) => ({ label: `${x.label}${x.id === guess ? ' (likely)' : ''}`, run: async () => { this.hooks.changed([await setElement(page.id, { type: x.id })]); this.render(); } })) })));
    });
    acts.append(add, use);
    body.append(acts);
    if (!this.elements.length) body.append(make('p', 'hint gv-hint', 'Elements are the bible pages a production needs to keep consistent: each character, location, prop and outfit, with reference pictures, its locked look (a LoRA or reference pack) and a few words on how it looks that go into every prompt.'));
  }

  elementEl(e) {
    const x = e.fields.element;
    const card = make('div', 'pd-el');
    card.dataset.element = e.id;
    const head = make('div', 'pd-el-head');
    const name = make('button', 'pd-el-name', e.title || 'Untitled');
    name.title = 'Open its bible page';
    name.addEventListener('click', () => this.hooks.openPage(e.id));
    head.append(name, this.hooks.menuButton(() => [
      { label: 'Open the page', run: () => this.hooks.openPage(e.id) },
      { label: 'Type', sub: ELEMENT_TYPES.map((t) => ({ label: t.label, current: t.id === (x.type || 'other'), run: async () => { await setElement(e.id, { type: t.id }); this.render(); } })) },
      { label: 'Not an element', run: async () => { await setElement(e.id, null); this.render(); this.hooks.toast(`“${e.title}” is a plain page again`); } }
    ], `More for ${e.title}`));
    card.append(head);
    const refs = make('div', 'pd-renders pd-refs');
    for (const id of x.refs || []) {
      const tile = make('div', 'pd-render');
      fileUrl(id).then((url) => { if (url) { const img = make('img'); img.src = url; img.alt = ''; tile.prepend(img); } else tile.classList.add('missing'); });
      const del = make('button', 'pd-star', '×');
      del.setAttribute('aria-label', 'Remove this reference');
      del.addEventListener('click', async () => { await setElement(e.id, { refs: (x.refs || []).filter((r) => r !== id) }); this.render(); });
      tile.append(del);
      refs.append(tile);
    }
    const add = make('label', 'pd-render add');
    add.title = 'Add reference pictures';
    add.append(make('span', '', '+'));
    const input = make('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const ids = [];
      for (const f of input.files) { const row = await addFile(f, { element: e.id }); if (row) ids.push(row.id); }
      const fresh = await getEntry(e.id);
      await setElement(e.id, { refs: [...(fresh.fields?.element?.refs || []), ...ids] });
      this.render();
    });
    add.append(input);
    refs.append(add);
    card.append(refs);
    const field = (key, label, placeholder, multi = false) => {
      const i = make(multi ? 'textarea' : 'input', multi ? 'pd-ta' : 'pd-input');
      i.value = key === 'also' ? (x.also || []).join(', ') : x[key] || '';
      i.placeholder = placeholder;
      i.setAttribute('aria-label', label);
      if (multi) i.rows = 2;
      const save = () => setElement(e.id, { [key]: key === 'also' ? i.value.split(',').map((s) => s.trim()).filter(Boolean) : i.value });
      i.addEventListener('input', () => this.later(`${e.id}:${key}`, save));
      i.addEventListener('blur', () => this.now(`${e.id}:${key}`));
      const wrap = make('label', 'pd-field');
      wrap.append(make('span', 'pd-field-label', label), i);
      return wrap;
    };
    card.append(
      field('snippet', 'Looks', 'How it looks, in plain words a picture model follows. Goes into every prompt it’s in.', true),
      field('look', 'Locked look', 'LoRA or reference pack name'),
      field('also', 'Also called', 'Other names in the script, comma between')
    );
    return card;
  }

  // ---------- shoot days and call sheets ----------

  async drawDays(body) {
    const days = await shootDays(this.piece.id);
    if (this.dayId && !days.some((d) => d.id === this.dayId)) this.dayId = null;
    const list = make('div', 'pd-days');
    for (const d of days) {
      const b = make('button', 'chip' + (d.id === this.dayId ? ' on' : ''), d.fields?.date ? new Date(`${d.fields.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date');
      b.addEventListener('click', () => { this.dayId = d.id; this.render(); });
      list.append(b);
    }
    const add = make('button', 'chip add', '+ Shoot day');
    add.addEventListener('click', async () => {
      const d = await newShootDay(this.piece.id, new Date(Date.now() + 86400000).toISOString().slice(0, 10));
      this.dayId = d.id;
      this.hooks.changed([d]);
      this.render();
    });
    list.append(add);
    body.append(list);
    const day = days.find((d) => d.id === this.dayId);
    if (!day) { body.append(make('p', 'hint gv-hint', 'A shoot day turns into a one-page call sheet: when and where, the scenes and shots, who’s needed, and the props and wardrobe from the breakdown. It can go to Daybook as a task on that day.')); return; }
    body.append(this.dayForm(day), this.callSheet(day));
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
      const c = make('button', 'chip' + (chosen.has(s.id) ? ' on' : ''), `${s.code ? `${s.code} ` : ''}${s.title}`);
      c.setAttribute('aria-pressed', String(chosen.has(s.id)));
      c.addEventListener('click', async () => {
        if (chosen.has(s.id)) chosen.delete(s.id); else chosen.add(s.id);
        await save({ scenes: this.scenes.map((x) => x.id).filter((id) => chosen.has(id)) });
        this.render();
      });
      pick.append(c);
    }
    form.append(pick);
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
    const send = make('button', 'pill', f.daybook ? 'Update in Daybook' : 'Send to Daybook');
    send.title = 'A task on that day, at call time, linking back here';
    send.addEventListener('click', async () => {
      await this.hooks.sendTask(dayTask(day, this.piece, this.hooks.base()));
      await save({ daybook: Date.now() });
      this.render();
      this.hooks.toast(f.date ? `On your Daybook plan for ${new Date(`${f.date}T12:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${f.call ? ` at ${clock(f.call)}` : ''}` : 'Sent to Daybook');
    });
    const del = make('button', 'ghost-btn', 'Delete the day');
    del.addEventListener('click', async () => {
      const fresh = await getEntry(day.id);
      await putEntries([{ ...fresh, deleted: true, updated_at: Date.now() }]);
      this.dayId = null;
      this.render();
      this.hooks.toast('Shoot day deleted', { label: 'Undo', run: async () => { await putEntries([{ ...fresh, deleted: false, updated_at: Date.now() }]); this.dayId = fresh.id; this.render(); } });
    });
    acts.append(print, send, del);
    form.append(acts);
    return form;
  }

  // One page: everything on it already exists somewhere else.
  callSheet(day) {
    const f = day.fields || {};
    const sheet = make('article', 'pd-sheet');
    const scenes = this.scenes.filter((s) => (f.scenes || []).includes(s.id));
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
      li.append(make('strong', '', `${s.code ? `${s.code}  ` : ''}${s.title}`));
      if (s.synopsis) li.append(make('span', 'pd-sheet-sub', ` ${s.synopsis}`));
      if (s.shots.length) {
        const ul = make('ul', 'pd-sheet-shots');
        for (const sh of s.shots) ul.append(make('li', '', `${this.codeOf(sh, s)}  ${sh.text || ''}${sh.fields?.framing ? ` (${sh.fields.framing})` : ''}`));
        li.append(ul);
      }
      const notes = this.notesOf.get(s.id) || [];
      for (const n of notes) li.append(make('div', 'pd-sheet-note', n.text));
      return li;
    }));
    section('Who’s needed', uses('character').map((e) => `${e.title}${e.fields.element.snippet ? `: ${e.fields.element.snippet}` : ''}`));
    section('Locations', uses('location').map((e) => e.title));
    section('Props', uses('prop').map((e) => e.title));
    section('Wardrobe', uses('wardrobe').map((e) => `${e.title}${e.fields.element.snippet ? `: ${e.fields.element.snippet}` : ''}`));
    section('Also', uses('other').map((e) => e.title));
    if (f.notes) { sheet.append(make('h3', '', 'Notes')); sheet.append(make('p', '', f.notes)); }
    if (!scenes.length) sheet.append(make('p', 'hint', 'Pick the scenes for this day above.'));
    return sheet;
  }

  // ---------- posting ----------

  async drawPost(body) {
    const posting = this.piece.fields?.posting || {};
    const list = make('div', 'pd-post');
    for (const p of PLATFORMS) {
      const x = posting[p.id] || {};
      const card = make('div', 'pd-post-card');
      card.dataset.platform = p.id;
      const head = make('div', 'pd-prompt-head');
      head.append(make('span', 'panel-label', p.label));
      const copy = make('button', 'ghost-btn', 'Copy');
      copy.addEventListener('click', () => this.copy(cap.value, `${p.label} caption copied`));
      head.append(copy);
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
    const acts = make('div', 'pd-add');
    if (this.hooks.canAsk()) {
      const draft = make('button', 'pill', 'Draft captions with Claude');
      draft.addEventListener('click', () => this.captions());
      acts.append(draft);
    }
    if (this.script) {
      const srt = make('button', 'ghost-btn', 'Dialogue for subtitles (.srt)');
      srt.title = 'Every line of dialogue in order, two seconds each: import into Resolve and fix the timing there';
      srt.addEventListener('click', () => this.exportSrt());
      acts.append(srt);
    }
    body.append(acts, list);
  }

  // Where this is, for remembering.
  place() { return { view: this.mode === 'deliver' ? 'deliver' : 'production', id: this.piece?.id, tab: this.tab }; }

  // ---------- Deliver: files out ----------

  async drawFiles(body) {
    const piece = this.piece;
    const list = make('div', 'pd-files');
    const file = (label, about, run, ok = true) => {
      if (!ok) return;
      const b = make('button', 'st-tool pd-file');
      b.append(make('span', 'st-tool-name', label), make('span', 'st-tool-about', about));
      b.addEventListener('click', run);
      list.append(b);
    };
    const ms = hasManuscript(piece);
    file('Print or PDF', this.script ? 'The script in standard format, ready to print or save as a PDF' : 'As a manuscript, ready to print or save as a PDF', () => this.hooks.files('print', piece), ms);
    file('Fountain (.fountain)', 'The script as plain text, for WriterDuet, Highland, Final Draft', () => this.hooks.files('fountain', piece), this.script);
    file('Markdown (.md)', 'The words as plain text with headings', () => this.hooks.files('markdown', piece), ms);
    file('Shot list for Resolve (.csv)', 'Every shot with its code, scene, framing, prompts and the take you starred', async () => { await this.loadNames(); this.exportCsv(); }, this.scenes.length > 0);
    file('Dialogue for subtitles (.srt)', 'Every line of dialogue in order, two seconds each: fix the timing in Resolve', () => this.exportSrt(), this.script);
    body.append(list);
    if (!list.children.length) body.append(make('p', 'hint gv-empty', 'This piece is an outline: open it and use Export from Ctrl + K.'));
    else body.append(make('p', 'hint', 'A shot’s kit (its prompts and reference pictures, as a .zip) is on each shot in Make.'));
  }

  async drawShare(body) {
    const piece = this.piece;
    const box = make('div', 'pd-share');
    const share = await this.hooks.shareOf(piece);
    if (share) {
      box.append(make('p', '', share.comments ? 'Shared: anyone with the link can read it and comment.' : 'Shared: anyone with the link can read it.'));
      const url = make('input', 'pd-input share-url');
      url.readOnly = true;
      url.value = share.url;
      url.setAttribute('aria-label', 'The link');
      url.addEventListener('focus', () => url.select());
      box.append(url);
    } else box.append(make('p', 'hint', 'A link anyone can read (and comment on, if you like) without an account. Nothing else of yours is shared.'));
    const b = make('button', 'pill', share ? 'Link and comments…' : 'Share a link to read and comment…');
    b.addEventListener('click', () => this.hooks.share(piece));
    box.append(b);
    body.append(box);
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
    const empty = PLATFORMS.filter((p) => !(posting[p.id]?.caption || '').trim());
    let wanted = empty;
    if (!empty.length) {
      const ok = await this.hooks.ask({ title: 'Replace every caption?', body: 'Each platform already has a caption. Claude’s drafts would replace them.', ok: 'Replace them' });
      if (!ok) return;
      wanted = PLATFORMS;
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

  exportCsv() {
    const rows = [['Shot', 'Scene', 'Scene heading', 'What happens', 'Framing', 'Stage', 'Still prompt', 'Video prompt', 'Still', 'Take']];
    const name = (id) => this.fileNames.get(id) || '';
    for (const s of this.scenes) for (const sh of s.shots) {
      const f = sh.fields || {};
      rows.push([this.codeOf(sh, s), s.code || '', s.title, sh.text || '', f.framing || '', SHOT_STAGES.find((x) => x.id === shotStage(sh)).label, f.still || '', f.video || '', name(f.star?.still), name(f.star?.video)]);
    }
    download(`${this.piece.title || 'Shots'} shot list.csv`, new Blob(['﻿' + toCsv(rows)], { type: 'text/csv' }));
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
    const hide = hidden();
    const flip = (k) => { if (hide.has(k)) hide.delete(k); else hide.add(k); setPref('prodHide', JSON.stringify([...hide])); this.render(); };
    return [
      this.hooks.canAsk() && { label: 'Break down every scene, with Claude', run: () => this.breakdown() },
      { label: 'Shot list for Resolve (.csv)', run: async () => { await this.loadNames(); this.exportCsv(); } },
      this.script && { label: 'Dialogue for subtitles (.srt)', run: () => this.exportSrt() },
      this.script && !this.piece.fields?.numbered && { label: 'Number the scenes', run: () => this.hooks.numberScenes(this.piece) },
      'sep',
      { label: hide.has('elements') ? 'Show elements on scenes' : 'Hide elements on scenes', run: () => flip('elements') },
      { label: hide.has('notes') ? 'Show production notes' : 'Hide production notes', run: () => flip('notes') },
      { label: hide.has('summary') ? 'Show scene summaries' : 'Hide scene summaries', run: () => flip('summary') },
      { label: hide.has('empty') ? 'Show scenes with no shots' : 'Hide scenes with no shots', run: () => flip('empty') }
    ].filter(Boolean);
  }

  async loadNames() {
    this.fileNames = new Map();
    for (const s of this.scenes) for (const sh of s.shots) for (const id of Object.values(sh.fields?.star || {})) { const f = await getEntry(id); if (f) this.fileNames.set(id, f.title || ''); }
  }
}

