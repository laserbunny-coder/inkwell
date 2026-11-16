// The look wall (a world's Make page, "Looks"): every version of every
// character and place, side by side. Star the one that stays, set the rest
// aside, then look at the picks together. Not a canvas: nothing is dragged
// about or arranged. A picture belongs to its character's or place's row
// before it is ever starred, so the star always knows where it goes.
//
// The rows are the world's elements; a row's pictures are the element's
// refs (the Kit's "Other references"). element.pick is the star, element.aside
// the pictures set aside. Pictures dropped outside any row find their row by
// a name in the file name, or wait in Unsorted.
import { getEntry, putEntries, byKind } from './db.js';
import { addFile, fileUrl, thumbUrl, isImage } from './files.js';
import { isTouch } from './device.js';
import { make } from './dom.js';
import {
  elementsIn, newElement, setElement, typeOf, lookOf, starPatch, asidePatch, standIn, nextPick,
  elementForName, lostLooks, worldScenes, ELEMENT_TYPES
} from './production.js';
import './lookwall.css';

const PREF = 'lookwall';
const DEFAULTS = { view: 'wall', scope: 'all', zoom: 150, caps: true, showOut: true, more: true };
const readPrefs = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { ...DEFAULTS }; } };
const VIEWS = [{ id: 'wall', label: 'Wall' }, { id: 'side', label: 'Side by side' }, { id: 'together', label: 'Together' }];
const kindLabel = (type) => (type === 'location' ? 'Place' : typeOf(type).label);
const bare = (name) => String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
const UNSORTED = 'unsorted';

export class LookWall {
  // hooks: changed(rows), toast(text, action), menu(anchor, items), askText(opts), openPage(id)
  constructor(hooks) {
    this.hooks = hooks;
    this.p = readPrefs();
    this.gid = null; // the row in front (One at a time, Side by side), and the focused picture's row
    this.f = null; // the focused picture
    this.scene = null;
    this.healed = new Set();
    this.lb = null;
    this.seen = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((list) => { for (const x of list) if (x.isIntersecting) { this.seen.unobserve(x.target); this.paint(x.target); } }, { rootMargin: '600px 0px' })
      : null;
    document.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('paste', (e) => this.paste(e));
  }

  get isOpen() { return !!this.root?.isConnected && document.documentElement.dataset.view === 'stage'; }
  save() { try { localStorage.setItem(PREF, JSON.stringify(this.p)); } catch { /* full */ } }

  // ---------- reading ----------

  async load(world) {
    this.world = await getEntry(world.id) || world;
    let els = await elementsIn(this.world);
    const files = (await byKind('file')).filter((f) => !f.deleted && !f.fields?.trashed);
    // Once a visit: pictures their row lost go back on it.
    if (!this.healed.has(world.id)) {
      this.healed.add(world.id);
      const lost = lostLooks(els, files);
      const rows = [];
      for (const [id, ids] of Object.entries(lost)) {
        const fresh = await getEntry(id);
        rows.push(await setElement(id, { refs: [...(fresh.fields?.element?.refs || []), ...ids] }));
      }
      if (rows.length) { await this.hooks.changed(rows); els = await elementsIn(this.world); }
    }
    this.els = els;
    const ids = new Set(els.flatMap((e) => lookOf(e).refs));
    this.files = new Map(files.filter((f) => ids.has(f.id) || f.fields?.unsorted === world.id).map((f) => [f.id, f]));
    for (const id of ids) if (!this.files.has(id)) this.files.set(id, { id, title: '', fields: {}, missing: true });
    this.unsorted = files.filter((f) => f.fields?.unsorted === world.id && !f.fields?.element).map((f) => f.id);
    this.scenes = await worldScenes(this.world, els).catch(() => []);
  }

  // The rows, in order: characters, places, then the rest (which can be
  // hidden), and Unsorted when anything waits there.
  rows() {
    const out = [];
    const order = ['character', 'location', ...ELEMENT_TYPES.map((t) => t.id).filter((t) => !['character', 'location'].includes(t))];
    for (const t of order) {
      if (!['character', 'location'].includes(t) && !this.p.more) continue;
      for (const e of this.els.filter((x) => (x.fields.element.type || 'other') === t)) out.push({ id: e.id, el: e, name: e.title || 'Untitled', type: t });
    }
    if (this.unsorted.length) out.push({ id: UNSORTED, el: null, name: 'Unsorted', type: UNSORTED });
    return out;
  }
  items(r) {
    if (r.id === UNSORTED) return this.unsorted;
    const { refs, aside } = lookOf(r.el);
    return this.p.showOut ? refs : refs.filter((id) => !aside.has(id));
  }
  rowOf(id) { return this.rows().find((r) => r.id === id) || null; }

  // ---------- drawing ----------

  async draw(body, world) {
    await this.load(world);
    const root = make('div', 'lw');
    root.dataset.view = this.p.view;
    this.root = root;
    root.append(this.controls());
    if (!isTouch()) {
      const keys = make('p', 'lw-keys');
      keys.innerHTML = 'Keys: <kbd>1</kbd> Wall, <kbd>2</kbd> Side by side, <kbd>3</kbd> Together. Arrow keys move between pictures and rows. <kbd>S</kbd> stars, <kbd>X</kbd> sets aside, <kbd>Enter</kbd> opens it large, <kbd>Escape</kbd> closes. <kbd>Minus</kbd> and <kbd>Equals</kbd> change the size. <kbd>Ctrl</kbd> + <kbd>V</kbd> pastes a picture onto the row you’re on.';
      keys.hidden = !this.p.caps;
      root.append(keys);
    }
    this.main = make('div', 'lw-main');
    root.append(this.main);
    const add = make('div', 'lw-add');
    for (const [type, label] of [['character', 'Add a character'], ['location', 'Add a place']]) {
      const b = make('button', 'ghost-btn', label);
      b.addEventListener('click', () => this.newRow(type));
      add.append(b);
    }
    root.append(add);
    // Dropped outside any row: found by name, or into Unsorted.
    root.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
    root.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      const sec = e.target.closest?.('.lw-row');
      if (sec && sec.dataset.row !== UNSORTED) this.addTo(sec.dataset.row, files); else this.route(files);
    });
    body.append(root);
    this.renderMain();
  }

  controls() {
    const ctl = make('div', 'lw-ctl');
    const seg = (label, list, cur, pick) => {
      const s = make('div', 'lw-seg');
      s.setAttribute('role', 'group');
      s.setAttribute('aria-label', label);
      for (const x of list) {
        const b = make('button', '', x.label);
        b.dataset.v = x.id;
        b.setAttribute('aria-pressed', String(x.id === cur));
        b.addEventListener('click', () => pick(x.id));
        s.append(b);
      }
      return s;
    };
    ctl.append(seg('View', VIEWS, this.p.view, (v) => this.setView(v)));
    const scope = seg('How much at once', [{ id: 'all', label: 'Everything' }, { id: 'one', label: 'One at a time' }], this.p.scope, (v) => { this.p.scope = v; this.save(); this.redraw(); });
    scope.classList.add('lw-scope');
    scope.hidden = this.p.view === 'side';
    ctl.append(scope);
    const zoom = make('label', 'lw-zoom');
    zoom.append('Size ');
    const range = make('input');
    range.type = 'range';
    range.min = '90';
    range.max = '320';
    range.step = '10';
    range.value = String(this.p.zoom);
    range.setAttribute('aria-label', 'Picture size');
    range.addEventListener('input', () => { this.p.zoom = Number(range.value); this.save(); this.sizeTiles(); });
    zoom.append(range);
    zoom.hidden = this.p.view !== 'wall';
    ctl.append(zoom);
    const tog = (label, key, after) => {
      const w = make('label', 'lw-tog');
      const i = make('input');
      i.type = 'checkbox';
      i.checked = !!this.p[key];
      i.addEventListener('change', () => { this.p[key] = i.checked; this.save(); after?.(); this.redraw(); });
      w.append(i, ` ${label}`);
      return w;
    };
    ctl.append(tog('Captions', 'caps', () => { const k = this.root?.querySelector('.lw-keys'); if (k) k.hidden = !this.p.caps; }), tog('Show set aside', 'showOut'), tog('Props and more', 'more'));
    return ctl;
  }

  setView(v) { this.p.view = v; this.save(); this.redraw(); }

  // Draws the wall again from what's saved, keeping the focused picture.
  async redraw({ reload = false } = {}) {
    if (!this.root?.isConnected) return;
    if (reload) await this.load(this.world);
    const fresh = this.controls();
    this.root.querySelector('.lw-ctl').replaceWith(fresh);
    this.root.dataset.view = this.p.view;
    this.renderMain();
  }

  sizeTiles() {
    if (!this.main) return;
    this.main.style.setProperty('--tile', `${this.p.zoom}px`);
    // On a phone the slider picks two or three across.
    this.main.style.setProperty('--cols', this.p.zoom <= 150 ? '3' : '2');
  }

  renderMain(keepFocus = false) {
    const m = this.main;
    if (!m) return;
    m.replaceChildren();
    this.sizeTiles();
    const rows = this.rows();
    if (!rows.length) {
      m.append(make('p', 'hint lw-empty', 'No characters or places yet. Add one below, then drop or pick pictures onto its row. Pictures dropped here with a name in the file name (“Kenji v3.png”) find their row.'));
      return;
    }
    if (!rows.some((r) => r.id === this.gid)) this.gid = rows[0].id;
    if (this.p.view === 'together') this.renderTogether(m);
    else if (this.p.view === 'side' || this.p.scope === 'one') {
      m.append(this.stepper(rows));
      m.append(this.rowEl(rows.find((r) => r.id === this.gid), this.p.view === 'side'));
    } else for (const r of rows) m.append(this.rowEl(r, false));
    if (keepFocus) this.focusTile();
  }

  stepper(rows) {
    const s = make('div', 'lw-seg lw-steps');
    s.setAttribute('role', 'group');
    s.setAttribute('aria-label', 'Row');
    for (const r of rows) {
      const b = make('button', '', r.name);
      b.setAttribute('aria-pressed', String(r.id === this.gid));
      b.addEventListener('click', () => { this.gid = r.id; this.f = null; this.renderMain(); });
      s.append(b);
    }
    return s;
  }

  label(id) {
    const f = this.files.get(id);
    const look = f?.fields?.look || {};
    return { name: bare(f?.title) || 'Picture', from: look.from || (look.by === 'claude' ? 'Claude' : 'Yours'), look };
  }

  inScenes(id) {
    const hit = this.scenes.filter((s) => s.place === id || s.cast.includes(id));
    if (!this.scenes.length) return '';
    if (!hit.length) return 'Not in a scene yet';
    const names = hit.map((s) => s.code || s.title);
    return `In scene${hit.length > 1 ? 's' : ''} ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` and ${names.length - 8} more` : ''}`;
  }

  rowEl(r, big) {
    const sec = make('section', 'lw-row');
    sec.dataset.row = r.id;
    sec.dataset.type = r.type;
    const h = make('div', 'lw-row-h');
    const name = make('h2', '', r.name);
    h.append(name);
    if (r.el) {
      h.append(make('span', 'lw-kind', kindLabel(r.type)));
      const { pick, kept } = lookOf(r.el);
      const p = make('span', 'lw-pick');
      if (pick) { p.append('Pick: '); p.append(make('b', '', this.label(pick).name)); } else p.textContent = kept.length ? `No pick yet, ${kept.length} in the running` : 'No pictures yet';
      h.append(p);
      const sc = this.inScenes(r.id);
      if (sc) h.append(make('span', 'lw-pick', sc));
    } else h.append(make('span', 'lw-pick', 'No name in the file name matched a row. Move each one to its row.'));
    h.append(make('span', 'lw-sp'));
    if (r.el) {
      const add = make('label', 'lw-addpics');
      add.append('Add pictures');
      const input = make('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.hidden = true;
      input.addEventListener('change', () => { const fs = [...input.files]; input.value = ''; this.addTo(r.id, fs); });
      add.append(input);
      const open = make('button', 'lw-plain', 'Page');
      open.title = `Open ${r.name}’s bible page`;
      open.addEventListener('click', () => this.hooks.openPage(r.id));
      h.append(add, open);
    }
    sec.append(h);
    const items = this.items(r);
    const tiles = make('div', 'lw-tiles' + (big ? ' big' : ''));
    if (big) tiles.style.setProperty('--n', String(Math.min(r.type === 'location' ? 2 : 5, Math.max(1, items.length))));
    for (const id of items) tiles.append(this.tile(r, id));
    if (items.length) sec.append(tiles);
    else sec.append(make('p', 'lw-none', r.el && lookOf(r.el).refs.length ? 'Everything here is set aside. Tick “Show set aside” to bring one back.' : 'Drop pictures here, or Add pictures.'));
    sec.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); sec.classList.add('over'); } });
    sec.addEventListener('dragleave', () => sec.classList.remove('over'));
    sec.addEventListener('drop', () => sec.classList.remove('over'));
    return sec;
  }

  art(id, type, cls = 'lw-art') {
    const a = make('span', `${cls} ${type === 'location' ? 'place' : 'char'}`);
    a.dataset.file = id;
    if (this.files.get(id)?.missing) a.classList.add('missing');
    else if (this.seen) this.seen.observe(a); else this.paint(a);
    return a;
  }

  paint(a) {
    thumbUrl(a.dataset.file).then((url) => {
      if (!url) { a.classList.add('missing'); return; }
      const img = make('img');
      img.src = url;
      img.alt = '';
      img.decoding = 'async';
      a.replaceChildren(img);
    });
  }

  tile(r, id) {
    const pick = r.el ? lookOf(r.el).pick : null;
    const out = r.el ? lookOf(r.el).aside.has(id) : false;
    const t = make('div', 'lw-tile');
    t.dataset.id = id;
    t.dataset.focus = String(this.f === id);
    t.dataset.star = String(pick === id);
    t.dataset.out = String(out);
    const pic = make('button', 'lw-pic');
    const { name, from } = this.label(id);
    pic.setAttribute('aria-label', `${r.name}, ${name}${pick === id ? ', the pick' : ''}${out ? ', set aside' : ''}`);
    pic.append(this.art(id, r.type));
    if (pick === id) pic.append(make('span', 'lw-badge', 'Pick'));
    if (this.p.caps) { const c = make('span', 'lw-cap'); c.append(make('span', '', name), make('small', '', from)); pic.append(c); }
    pic.addEventListener('click', (e) => {
      const again = this.f === id && this.gid === r.id;
      this.f = id;
      this.gid = r.id;
      if (again && e.detail === 2) { this.openLb(); return; }
      this.markFocus();
    });
    pic.addEventListener('dblclick', () => { this.f = id; this.gid = r.id; this.openLb(); });
    t.append(pic);
    const acts = make('div', 'lw-acts');
    const btn = (label, fn) => { const b = make('button', '', label); b.addEventListener('click', fn); acts.append(b); return b; };
    if (r.el) {
      btn(pick === id ? 'Unstar' : 'Star', () => this.star(r.id, id)).dataset.act = 'star';
      btn(out ? 'Bring back' : 'Set aside', () => this.aside(r.id, id)).dataset.act = 'aside';
    } else {
      const mv = btn('Move to…', () => this.hooks.menu(mv, this.moveItems(id))); mv.dataset.act = 'move';
    }
    btn('Open', () => { this.f = id; this.gid = r.id; this.openLb(); }).dataset.act = 'open';
    t.append(acts);
    return t;
  }

  // Just the focus marks, so a tap doesn't rebuild the wall.
  markFocus() {
    if (!this.main) return;
    for (const t of this.main.querySelectorAll('.lw-tile')) t.dataset.focus = String(t.dataset.id === this.f && t.closest('.lw-row')?.dataset.row === this.gid);
  }
  focusTile() {
    const t = this.main?.querySelector(`.lw-row[data-row="${CSS.escape(this.gid || '')}"] .lw-tile[data-id="${CSS.escape(this.f || '')}"] .lw-pic`);
    if (t) { t.focus({ preventScroll: true }); t.scrollIntoView?.({ block: 'nearest' }); }
  }

  // ---------- together ----------

  renderTogether(m) {
    const byId = new Map(this.els.map((e) => [e.id, e]));
    const h = make('div', 'lw-together-h');
    h.append(make('h2', '', 'The picks, together'));
    const chars = this.els.filter((e) => e.fields.element.type === 'character');
    const places = this.els.filter((e) => e.fields.element.type === 'location');
    if (this.scenes.length) {
      h.append(make('p', '', 'Each scene shows its own place and cast, from the script. Tap a picture to try the next version of it; that one becomes the pick.'));
      m.append(h);
      const sc = this.scenes.find((s) => s.id === this.scene) || this.scenes[0];
      this.scene = sc.id;
      const many = new Set(this.scenes.map((s) => s.piece)).size > 1;
      const pickScene = make('div', 'lw-seg lw-steps');
      pickScene.setAttribute('role', 'group');
      pickScene.setAttribute('aria-label', 'Scene');
      for (const s of this.scenes) {
        const b = make('button', '', `${many ? `${s.pieceTitle} · ` : ''}${s.code ? `${s.code} · ` : ''}${s.title}`);
        b.setAttribute('aria-pressed', String(s === sc));
        b.addEventListener('click', () => { this.scene = s.id; this.renderMain(); });
        pickScene.append(b);
      }
      m.append(pickScene);
      m.append(this.card(byId.get(sc.place), sc.cast.map((id) => byId.get(id)), true));
      if (this.p.scope === 'all' && this.scenes.length > 1) {
        const sec = make('div', 'lw-sec');
        sec.append(make('h3', '', 'Every scene'), make('p', '', 'The same picks, scene after scene, to judge the flow.'));
        const strip = make('div', 'lw-strip');
        for (const s of this.scenes) {
          const c = this.card(byId.get(s.place), s.cast.map((id) => byId.get(id)), false);
          c.prepend(make('h4', '', `${s.code ? `${s.code} · ` : ''}${s.title}`));
          strip.append(c);
        }
        sec.append(strip);
        m.append(sec);
      }
      return;
    }
    h.append(make('p', '', places.length ? 'No script yet, so every character’s pick stands beside each place. Tap a picture to try the next version; that one becomes the pick.' : 'Every character’s pick side by side. Add a place to see them in it. Tap a picture to try the next version.'));
    m.append(h);
    const list = places.length ? places : [null];
    const shown = this.p.scope === 'one' ? [list.find((p) => p?.id === this.gid) || list[0]] : list;
    if (this.p.scope === 'one' && places.length > 1) {
      const s = make('div', 'lw-seg lw-steps');
      for (const p of places) {
        const b = make('button', '', p.title || 'Untitled');
        b.setAttribute('aria-pressed', String(p === shown[0]));
        b.addEventListener('click', () => { this.gid = p.id; this.renderMain(); });
        s.append(b);
      }
      m.append(s);
    }
    const wrap = make('div', 'lw-cards');
    for (const p of shown) wrap.append(this.card(p, chars, true));
    m.append(wrap);
  }

  card(place, cast, main) {
    const card = make('div', 'lw-scene' + (main ? ' main' : ''));
    const cell = (el) => {
      const b = make('button', 'lw-cell');
      const { id, stand } = standIn(el);
      b.title = `Try the next ${el.title || 'version'}`;
      if (id) b.append(this.art(id, el.fields.element.type, 'lw-art'));
      else b.append(make('span', `lw-art ${el.fields.element.type === 'location' ? 'place' : 'char'} empty`));
      const who = make('span', 'lw-who', `${el.title || 'Untitled'}${id && main ? `: ${this.label(id).name}` : ''}`);
      b.append(who);
      if (stand && id) b.append(make('span', 'lw-stand', 'stand-in'));
      if (!id) b.append(make('span', 'lw-stand', 'no pictures'));
      b.addEventListener('click', () => this.cycle(el));
      return b;
    };
    if (place) card.append(cell(place));
    const row = make('div', 'lw-cast');
    row.style.setProperty('--n', String(Math.max(1, cast.length)));
    for (const c of cast.filter(Boolean)) row.append(cell(c));
    if (cast.length) card.append(row);
    return card;
  }

  async cycle(el) {
    const next = nextPick(el);
    if (!next) { this.hooks.toast(`${el.title} has no pictures to try yet. Add some on the Wall.`); return; }
    await this.patch(el.id, { pick: next });
  }

  // ---------- changing ----------

  async patch(id, patch) {
    const row = await setElement(id, patch);
    if (!row) return null;
    const i = this.els.findIndex((e) => e.id === id);
    if (i >= 0) this.els[i] = row;
    await this.hooks.changed([row]);
    this.renderMain(true);
    if (this.lb) this.renderLb();
    return row;
  }

  async star(rowId, fileId) {
    const el = this.els.find((e) => e.id === rowId);
    if (!el) return;
    this.f = fileId;
    this.gid = rowId;
    await this.patch(rowId, starPatch(el, fileId));
  }

  async aside(rowId, fileId) {
    const el = this.els.find((e) => e.id === rowId);
    if (!el) return;
    this.f = fileId;
    this.gid = rowId;
    await this.patch(rowId, asidePatch(el, fileId));
  }

  async addTo(rowId, files) {
    const pics = files.filter((f) => isImage(f.type));
    if (!pics.length) { this.hooks.toast('Only pictures go on the wall.'); return; }
    const ids = [];
    const rows = [];
    for (const f of pics) {
      const row = await addFile(f, { element: rowId, look: { by: 'me', at: Date.now() } });
      if (row) { ids.push(row.id); rows.push(row); this.files.set(row.id, row); }
    }
    if (pics.length > ids.length) this.hooks.toast(`${pics.length - ids.length} over 50 MB, left out.`);
    if (!ids.length) return;
    const fresh = await getEntry(rowId);
    await this.hooks.changed(rows);
    this.gid = rowId;
    this.f = ids[0];
    await this.patch(rowId, { refs: [...(fresh.fields?.element?.refs || []), ...ids] });
  }

  // Outside any row: each picture finds its row by name, or waits in Unsorted.
  async route(files) {
    const pics = files.filter((f) => isImage(f.type));
    if (!pics.length) return;
    const groups = new Map();
    const left = [];
    for (const f of pics) { const id = elementForName(f.name, this.els); if (id) { if (!groups.has(id)) groups.set(id, []); groups.get(id).push(f); } else left.push(f); }
    for (const [id, fs] of groups) await this.addTo(id, fs);
    for (const f of left) {
      const row = await addFile(f, { unsorted: this.world.id, look: { by: 'me', at: Date.now() } });
      if (row) { this.unsorted.push(row.id); this.files.set(row.id, row); await this.hooks.changed([row]); }
    }
    const n = pics.length - left.length;
    this.hooks.toast(left.length ? `${n ? `${n} found their row. ` : ''}${left.length} had no name to go by: they’re in Unsorted at the bottom.` : `${n} found their row by name.`);
    this.renderMain();
  }

  moveItems(fileId) {
    const items = this.els.map((e) => ({ label: `${e.title || 'Untitled'} (${kindLabel(e.fields.element.type)})`, run: () => this.moveTo(fileId, e.id) }));
    items.push({ label: 'Remove it', run: () => this.removeUnsorted(fileId) });
    return items;
  }

  async moveTo(fileId, elId) {
    const f = await getEntry(fileId);
    if (!f) return;
    const { unsorted: _u, ...rest } = f.fields || {};
    const file = { ...f, fields: { ...rest, element: elId }, updated_at: Date.now() };
    await putEntries([file]);
    this.files.set(fileId, file);
    this.unsorted = this.unsorted.filter((x) => x !== fileId);
    await this.hooks.changed([file]);
    const fresh = await getEntry(elId);
    this.gid = elId;
    this.f = fileId;
    await this.patch(elId, { refs: [...(fresh.fields?.element?.refs || []), fileId] });
  }

  async removeUnsorted(fileId) {
    const f = await getEntry(fileId);
    if (!f) return;
    await putEntries([{ ...f, deleted: true, updated_at: Date.now() }]);
    this.unsorted = this.unsorted.filter((x) => x !== fileId);
    this.renderMain();
    this.hooks.toast('Picture removed', { label: 'Undo', run: async () => { await putEntries([{ ...f, deleted: false, updated_at: Date.now() }]); this.unsorted.push(fileId); this.renderMain(); } });
  }

  async newRow(type) {
    const title = await this.hooks.askText({ title: type === 'location' ? 'Add a place' : 'Add a character', body: 'It becomes a page in the world’s bible, with its own row here.', placeholder: type === 'location' ? 'Kitchen' : 'Kenji', ok: 'Add' });
    if (!title?.trim()) return;
    const el = await newElement(this.world, type, title.trim());
    await this.hooks.changed([el]);
    this.gid = el.id;
    this.f = null;
    await this.redraw({ reload: true });
    this.main?.querySelector(`.lw-row[data-row="${CSS.escape(el.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- the large view ----------

  openLb() {
    if (!this.f) return;
    if (!this.lb) {
      const lb = make('div', 'lw-lb');
      lb.setAttribute('role', 'dialog');
      lb.setAttribute('aria-modal', 'true');
      lb.setAttribute('aria-label', 'Large view');
      lb.addEventListener('click', (e) => { if (e.target === lb) this.closeLb(); });
      // A finger swipes to the next or the one before.
      let x0 = null;
      lb.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') x0 = e.clientX; });
      lb.addEventListener('pointerup', (e) => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) this.step(dx < 0 ? 1 : -1, true); });
      document.body.append(lb);
      this.lb = lb;
    }
    this.renderLb();
    this.lb.querySelector('[data-act="close"]')?.focus();
  }

  closeLb() {
    this.lb?.remove();
    this.lb = null;
    this.focusTile();
  }

  renderLb() {
    const lb = this.lb;
    const r = this.rowOf(this.gid);
    if (!lb || !r || !this.f) { this.closeLb(); return; }
    const id = this.f;
    const el = r.el;
    const pick = el ? lookOf(el).pick : null;
    const out = el ? lookOf(el).aside.has(id) : false;
    const big = make('div', `lw-big ${r.type === 'location' ? 'place' : 'char'}`);
    fileUrl(id).then((url) => { if (url) { const img = make('img'); img.src = url; img.alt = `${r.name}, ${this.label(id).name}`; big.append(img); } });
    const { name, from, look } = this.label(id);
    const cap = make('div', 'lw-lb-cap', `${r.name}, ${name}`);
    const bits = [`Made in ${from}`, look.prompt ? `“${String(look.prompt).slice(0, 160)}${String(look.prompt).length > 160 ? '…' : ''}”` : '', look.settings || '', Number(look.cost_usd) > 0 ? `$${Number(look.cost_usd).toFixed(2)}` : '', pick === id ? 'the pick' : '', out ? 'set aside' : ''].filter(Boolean);
    cap.append(make('small', '', bits.join(' · ')));
    const bar = make('div', 'lw-lb-bar');
    const btn = (label, act, fn, pressed) => { const b = make('button', '', label); b.dataset.act = act; if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed)); b.addEventListener('click', fn); bar.append(b); };
    btn('Previous', 'prev', () => this.step(-1, true));
    if (el) {
      btn(pick === id ? 'Starred' : 'Star', 'star', () => this.star(r.id, id), pick === id);
      btn(out ? 'Bring back' : 'Set aside', 'aside', () => this.aside(r.id, id));
    }
    btn('Next', 'next', () => this.step(1, true));
    btn('Close', 'close', () => this.closeLb());
    lb.replaceChildren(big, cap, bar);
  }

  // ---------- moving about ----------

  step(d, inLb = false) {
    const r = this.rowOf(this.gid);
    if (!r) return;
    const items = this.items(r);
    if (!items.length) return;
    const i = items.indexOf(this.f);
    this.f = items[i < 0 ? 0 : (i + d + items.length) % items.length];
    if (inLb) { this.renderLb(); this.markFocus(); } else { this.markFocus(); this.focusTile(); }
  }

  stepRow(d) {
    const rows = this.rows();
    if (!rows.length) return;
    const i = Math.max(0, rows.findIndex((r) => r.id === this.gid));
    const r = rows[(i + d + rows.length) % rows.length];
    this.gid = r.id;
    this.f = this.items(r)[0] || null;
    if (this.p.view === 'side' || this.p.scope === 'one') this.renderMain(true);
    else { this.markFocus(); this.focusTile(); if (!this.f) this.main.querySelector(`.lw-row[data-row="${CSS.escape(r.id)}"]`)?.scrollIntoView({ block: 'nearest' }); }
  }

  key(e) {
    if (!this.isOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t?.closest?.('input:not([type="checkbox"]):not([type="range"]), textarea, select, [contenteditable="true"], .palette, .pop-menu, .ask')) return;
    if (document.querySelector('.ask-backdrop, .pop-menu')) return;
    const k = e.key;
    const r = this.rowOf(this.gid);
    if (this.lb) {
      if (k === 'Escape') this.closeLb();
      else if (k === 'ArrowLeft') this.step(-1, true);
      else if (k === 'ArrowRight') this.step(1, true);
      else if ((k === 's' || k === 'S') && r?.el) this.star(r.id, this.f);
      else if ((k === 'x' || k === 'X') && r?.el) this.aside(r.id, this.f);
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (k === '1' || k === '2' || k === '3') { e.preventDefault(); this.setView(VIEWS[Number(k) - 1].id); return; }
    if (k === '-' || k === '_') { e.preventDefault(); this.p.zoom = Math.max(90, this.p.zoom - 30); this.save(); this.sizeTiles(); const z = this.root.querySelector('.lw-zoom input'); if (z) z.value = String(this.p.zoom); return; }
    if (k === '=' || k === '+') { e.preventDefault(); this.p.zoom = Math.min(320, this.p.zoom + 30); this.save(); this.sizeTiles(); const z = this.root.querySelector('.lw-zoom input'); if (z) z.value = String(this.p.zoom); return; }
    if (this.p.view === 'together') return;
    if (k === 'ArrowRight') this.step(1);
    else if (k === 'ArrowLeft') this.step(-1);
    else if (k === 'ArrowDown') this.stepRow(1);
    else if (k === 'ArrowUp') this.stepRow(-1);
    else if ((k === 's' || k === 'S') && r?.el && this.f) this.star(r.id, this.f);
    else if ((k === 'x' || k === 'X') && r?.el && this.f) this.aside(r.id, this.f);
    else if (k === 'Enter' && this.f && t?.closest?.('.lw-pic')) this.openLb();
    else if (k === 'Escape' && this.f) { this.f = null; this.markFocus(); }
    else return;
    e.preventDefault();
  }

  // Ctrl + V with a row in front puts the picture on that row.
  paste(e) {
    if (!this.isOpen || this.p.view === 'together') return;
    const t = e.target;
    if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => isImage(f.type));
    if (!files.length) return;
    const r = this.rowOf(this.gid);
    e.preventDefault();
    if (r?.el) this.addTo(r.id, files); else this.route(files);
  }
}
