// Names you can rename in place, the library sidebar (left edge) and the
// breadcrumb that shows where you are.
import { sectionName } from '../schema.js';
import { putEntries, getEntry, topTags } from '../db.js';
import { onContextMenu } from '../menu.js';
import { outline } from '../model.js';
import { titleOf, dayId } from '../notebook.js';
import { inPane, PANE_ID, host as paneHost } from '../panes.js';
import { areas, books, bookType, hasManuscript, areaColor, pagesIn, loosePages, bookOf, worlds, worldOf, worldTree } from '../library.js';
import { make } from '../dom.js';
import { isoToday } from '../dates.js';
import { $, editor, inNotebook, isScript, root, sectionNames, state, view } from '../main.js';
import { notebook } from './notebookview.js';
import { go, lastPlace } from './routing.js';
import { refreshWords } from './manuscript.js';
import { actMenu, areaMenu, bookMenu, chapterMenu, pageMenu, worldMenu } from './tidying.js';
import { PAGE_NAMES, frame, nav, renderStrip } from './workpages.js';
import { partName, partOfPage } from '../pages.js';
import { openPalette } from './quickinserts.js';
import { nowStrip, plan, tagsPage } from './talking.js';
import { openBeside, openProjectBeside, sideNotes } from './beside.js';

// ---------- names you can rename in place ----------

function renameable(el, row, after) {
  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    el.contentEditable = 'true';
    el.classList.add('renaming');
    el.focus();
    document.getSelection().selectAllChildren(el);
  });
  const finish = async (save) => {
    if (el.contentEditable !== 'true') return;
    el.contentEditable = 'false';
    el.classList.remove('renaming');
    const title = el.textContent.trim();
    if (save && title && title !== row.title) {
      row.title = title;
      row.updated_at = Date.now();
      await putEntries([row]);
      if (row.id === state.project?.id) state.project.title = title;
      renderCrumb();
      after?.();
    } else {
      el.textContent = row.title;
    }
  };
  el.addEventListener('keydown', (e) => {
    if (el.contentEditable !== 'true') return;
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  el.addEventListener('blur', () => finish(true));
}

const dot = (color) => { const d = make('span', 'dot'); d.style.background = color; return d; };

async function areaPath(areaId, all) {
  const list = all || (await areas());
  const out = [];
  for (let a = list.find((x) => x.id === areaId), i = 0; a && i < 20; a = list.find((x) => x.id === a.parent_id), i++) out.unshift(a);
  return out;
}

const subtree = (areaId, all) => {
  const ids = new Set([areaId]);
  let grew = true;
  while (grew) { grew = false; for (const a of all) if (a.parent_id && ids.has(a.parent_id) && !ids.has(a.id)) { ids.add(a.id); grew = true; } }
  return ids;
};

// ---------- the library sidebar (left edge) ----------

let railBusy; // set in wireRail()
function renderRail() { railBusy = railBusy.then(drawRail).catch((e) => console.error(e)); return railBusy; }

async function drawRail() {
  let [allAreas, allWorlds, allBooks, loose] = await Promise.all([areas(), worlds(), books(), loosePages()]);
  // Where you are: the piece being written or shown, the world it's in, the page open.
  let piece = null;
  if (view() === 'write') piece = state.project;
  else if (view() === 'project') piece = await getEntry(state.bookId);
  else if (view() === 'grid') { const g = await getEntry(state.gridId); if (g?.kind === 'project') piece = g; }
  else if (inNotebook() && notebook.page && !notebook.isDay) piece = await bookOf(notebook.page);
  let world = null;
  if (view() === 'world') world = await getEntry(state.worldId);
  else if (view() === 'grid' && !piece) world = await getEntry(state.gridId);
  else if (piece) world = await worldOf(piece);
  else if (inNotebook() && notebook.page && !notebook.isDay) world = await worldOf(notebook.page);
  const pageId = inNotebook() ? notebook.page?.id : null;
  // The world you're in, for the commands that act on it. On a project's own
  // page go() has already said which one: a rail drawn a moment too early
  // mustn't take that away.
  if (view() !== 'world') state.worldId = world?.id || null;
  else if (state.worldId && world?.id !== state.worldId) world = await getEntry(state.worldId);

  const tree = $('#outline-tree');
  const out = [];

  const manuscript = async (b, pad) => {
    const acts = b.id === state.project?.id ? state.acts : await outline(b.id);
    for (const act of acts) {
      const a = make('div', 'tree-act', act.title);
      a.style.paddingLeft = `${pad}px`;
      renameable(a, act);
      onContextMenu(a, () => actMenu(act));
      out.push(a);
      for (const ch of act.chapters) {
        const c = make('button', 'tree-chapter' + (ch.id === state.chapterId && view() === 'write' ? ' current' : ''), ch.title);
        c.style.paddingLeft = `${pad + 14}px`;
        c.addEventListener('click', () => { if (c.contentEditable !== 'true') go({ view: 'write', chapterId: ch.id }); });
        renameable(c, ch);
        onContextMenu(c, () => chapterMenu(ch));
        out.push(c);
        if (ch.id === state.chapterId && view() === 'write') {
          const scenes = make('div');
          scenes.id = 'outline-scenes';
          scenes.style.setProperty('--pad', `${pad + 30}px`);
          out.push(scenes);
        }
      }
    }
  };
  const pageNode = (p, pad) => {
    const c = make('button', 'tree-page' + (pageId === p.id ? ' current' : ''), p.title || 'Untitled page');
    c.style.paddingLeft = `${pad}px`;
    c.addEventListener('click', (e) => ((e.ctrlKey || e.metaKey) ? openBeside({ view: 'notebook', pageId: p.id }) : go({ view: 'notebook', pageId: p.id })));
    onContextMenu(c, () => pageMenu(p));
    out.push(c);
  };
  // The world you're in opens up: its pieces (the one you're in shows its
  // chapters), then its bible pages, nested.
  const worldNode = async (w, depth) => {
    const area = allAreas.find((a) => a.id === w.area_id);
    const btn = make('button', 'tree-book tree-world' + (w.id === world?.id && view() === 'world' ? ' current' : ''));
    btn.style.paddingLeft = `${10 + depth * 14}px`;
    const name = make('span', 'name', w.title || 'Untitled');
    btn.append(dot(areaColor(area)), name);
    btn.addEventListener('click', (e) => { if (name.contentEditable !== 'true') { if (e.ctrlKey || e.metaKey) openProjectBeside(w.id); else go({ view: 'world', id: w.id }); } });
    renameable(name, w, renderRail);
    onContextMenu(btn, () => worldMenu(w));
    out.push(btn);
    if (w.id !== world?.id) return;
    const base = 26 + depth * 14;
    const { pieces, pages } = await worldTree(w.id);
    for (const { row: b, depth: d } of pieces) {
      const pad = base + d * 14;
      const pb = make('button', 'tree-page tree-piece' + (b.id === piece?.id && view() !== 'write' ? ' current' : ''), b.title || 'Untitled');
      pb.style.paddingLeft = `${pad}px`;
      pb.addEventListener('click', () => go({ view: 'project', id: b.id }));
      onContextMenu(pb, () => bookMenu(b));
      out.push(pb);
      if (b.id === piece?.id && hasManuscript(b)) await manuscript(b, pad + 12);
      if (b.id === piece?.id) for (const p of await pagesIn(b.id)) pageNode(p, pad + 12);
    }
    for (const { row: p, depth: d } of pages) pageNode(p, base + d * 14);
  };

  const areaNode = async (area, depth) => {
    const label = make('button', 'tree-area', area.title);
    label.style.paddingLeft = `${10 + depth * 14}px`;
    label.addEventListener('click', () => { if (label.contentEditable !== 'true') go({ view: 'library', area: area.id }); });
    renameable(label, area, renderRail);
    onContextMenu(label, () => areaMenu(area));
    out.push(label);
    for (const w of allWorlds.filter((x) => x.area_id === area.id).sort((x, y) => x.title.localeCompare(y.title))) await worldNode(w, depth);
    for (const sub of allAreas.filter((a) => a.parent_id === area.id)) await areaNode(sub, depth + 1);
  };

  // Finished projects are put away (on the Library's Finished shelf), unless you're in one.
  allWorlds = allWorlds.filter((w) => !w.fields?.finished || w.id === world?.id);
  for (const area of allAreas.filter((a) => !a.parent_id || !allAreas.some((x) => x.id === a.parent_id))) await areaNode(area, 0);
  const orphans = allWorlds.filter((w) => !allAreas.some((a) => a.id === w.area_id));
  if (orphans.length) { out.push(make('div', 'tree-area', 'Other')); for (const w of orphans) await worldNode(w, 0); }
  // A piece open on its own, outside any world (only while an older device catches up).
  if (piece && !world && allBooks.some((b) => b.id === piece.id)) {
    const pb = make('button', 'tree-page tree-piece current', piece.title || 'Untitled');
    pb.style.paddingLeft = '10px';
    out.push(pb);
    if (hasManuscript(piece)) await manuscript(piece, 24);
  }
  if (loose.length) {
    out.push(make('div', 'tree-area', 'Loose pages'));
    for (const p of loose.slice(0, 12)) pageNode(p, 10);
    if (loose.length > 12) {
      const more = make('button', 'tree-page tree-more', `All ${loose.length} loose pages ›`);
      more.style.paddingLeft = '10px';
      more.addEventListener('click', async () => { await go({ view: 'library', area: null }); $('#lib-loose-box').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      out.push(more);
    }
  }
  tree.replaceChildren(...out);
  renderScenes();

  const tags = await topTags(30);
  $('#shelves-tags').replaceChildren(...tags.map((t) => {
    const b = make('button', 'tag-chip', `#${t}`);
    b.addEventListener('click', () => notebook.showTag(t));
    return b;
  }));
  if (tags.length) {
    const all = make('button', 'tag-chip all-tags', 'All tags…');
    all.addEventListener('click', () => go({ view: 'tags' }));
    $('#shelves-tags').append(all);
  }
  $('#shelves-tags-label').hidden = !tags.length;
}

let scenesTimer;
function scheduleScenes() {
  clearTimeout(scenesTimer);
  scenesTimer = setTimeout(renderScenes, 400);
}

function renderScenes() {
  const box = $('#outline-scenes');
  if (!box) return;
  box.replaceChildren();
  // In a script, sections are your story's own headings, nested (act,
  // sequence, scene…), and the INT./EXT. scene headings sit under them.
  let depth = 0;
  const pad = box.style.getPropertyValue('--pad');
  editor.state.doc.forEach((node, pos) => {
    const slug = isScript() && node.type.name === 'paragraph' && node.attrs.el === 'scene' && node.textContent.trim();
    if (node.type.name !== 'sceneBreak' && !slug) return;
    const level = node.type.name === 'sceneBreak' ? node.attrs.level || 1 : 0;
    if (level) depth = level;
    const code = slug && root.classList.contains('numbered') && node.attrs.code ? `${node.attrs.code}  ` : '';
    const b = make('button', slug ? 'tree-scene tree-slug' : 'tree-scene', slug ? code + slug.toUpperCase() : node.attrs.title || (isScript() ? `Untitled ${sectionName(level, sectionNames()).toLowerCase()}` : 'Untitled scene'));
    if (level) b.dataset.level = level;
    b.style.paddingLeft = `calc(${pad} + ${(slug ? depth : level - 1) * 12}px)`;
    b.addEventListener('click', () => {
      editor.view.nodeDOM(pos)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      editor.commands.focus(pos + node.nodeSize + 1);
    });
    box.append(b);
  });
}

// ---------- breadcrumb: where you are ----------

let crumbBusy; // set in wireRail()
function renderCrumb() { crumbBusy = crumbBusy.then(drawCrumb).catch((e) => console.error(e)); return crumbBusy; }

async function drawCrumb() {
  const parts = [];
  const link = (label, run, cls = '') => { const b = make('button', 'crumb-part ' + cls, label); b.addEventListener('click', run); return b; };
  const all = await areas();
  const lib = link('Library', () => go({ view: 'library', area: null }));
  const areaParts = async (areaId) => (await areaPath(areaId, all)).map((a) => link(a.title, () => go({ view: 'library', area: a.id })));
  const bookPart = (b) => link(`${b.title || 'Untitled'} ▾`, () => openPalette('go', 'books'), 'book');
  // Library › areas › world › pieces and pages it sits in. A world with one
  // piece of the same name shows once.
  const within = async (row) => {
    const chain = [];
    let w = null;
    for (let r = row.parent_id && (await getEntry(row.parent_id)), i = 0; r && i < 40; r = r.parent_id && (await getEntry(r.parent_id)), i++) {
      if (r.kind === 'world') { w = r; break; }
      if (r.kind === 'project' || r.kind === 'page') chain.unshift(r);
    }
    if (!w) return null;
    const out = [lib, ...(await areaParts(w.area_id)), link(w.title || 'Untitled', () => go({ view: 'world', id: w.id }), 'book')];
    for (const r of chain) out.push(link(r.title || 'Untitled', () => (r.kind === 'page' ? go({ view: 'notebook', pageId: r.id }) : go({ view: 'project', id: r.id }))));
    return { out, world: w };
  };
  if (view() === 'library') {
    parts.push(lib, ...(state.libArea ? await areaParts(state.libArea) : []));
  } else if (view() === 'world') {
    const w = await getEntry(state.worldId);
    if (w) parts.push(lib, ...(await areaParts(w.area_id)), bookPart(w));
  } else if (view() === 'grid') {
    const g = await getEntry(state.gridId);
    if (g?.kind === 'world') parts.push(lib, ...(await areaParts(g.area_id)), bookPart(g));
    else if (g) { const up = await within(g); parts.push(...(up ? up.out : [lib]), bookPart(g)); }
    parts.push(link('Plot grid', () => {}, 'here'));
  } else if (view() === 'production' || view() === 'deliver') {
    const g = await getEntry(state.prodId);
    if (g) { const up = await within(g); parts.push(...(up ? up.out : [lib]), bookPart(g)); }
    parts.push(link(prodScreen(), () => {}, 'here'));
  } else if (view() === 'stage' && state.stage) {
    const g = await getEntry(state.stage.id);
    if (g?.kind === 'world') parts.push(lib, ...(await areaParts(g.area_id)), bookPart(g));
    else if (g) { const up = await within(g); parts.push(...(up ? up.out : [lib]), bookPart(g)); }
    // A project's parts go by their plain names (Ideas, Bible, Pieces…).
    const plain = g?.kind === 'world' ? (state.stage.page === 'revise' ? 'Continuity and comments' : partName(partOfPage(state.stage.page))) : '';
    parts.push(link(plain || PAGE_NAMES[state.stage.page] || '', () => {}, 'here'));
  } else if (view() === 'drawer') {
    parts.push(lib, link('Drawer', () => {}, 'here'));
  } else if (view() === 'plan') {
    // The ruler says which stop this is: no crumb. A pane has no ruler, so
    // its head names the stop.
    if (inPane) {
      const NAMES = { now: 'Now', day: 'Today', week: 'Week', calday: 'Today by the hour', month: 'Month', year: 'Year' };
      parts.push(link(NAMES[lastPlace?.tab] || 'Today', () => {}, 'here'));
    }
  } else if (view() === 'sidenotes') {
    parts.push(link(sideNotes.title || 'No draft open', () => {}, 'here'));
  } else if (view() === 'talk') {
    parts.push(link('Talk it through', () => {}, 'here'));
  } else if (view() === 'desk') {
    const history = lastPlace?.tab === 'history';
    parts.push(link('Desk', () => go({ view: 'desk' }), history ? '' : 'here'));
    if (history) parts.push(link('History', () => {}, 'here'));
  } else if (view() === 'compare') {
    const g = await getEntry(state.compareId);
    if (g) { const up = await within(g); parts.push(...(up ? up.out : [lib]), bookPart(g)); }
    parts.push(link('Compare', () => {}, 'here'));
  } else if (view() === 'project') {
    const b = await getEntry(state.bookId);
    const up = b && (await within(b));
    if (b) parts.push(...(up ? up.out : [lib, ...(await areaParts(b.area_id))]), bookPart(b));
  } else if (view() === 'write' && state.project) {
    const ch = state.chapterId && (await getEntry(state.chapterId));
    const up = await within(state.project);
    if (up) parts.push(...up.out);
    else parts.push(lib, ...(await areaParts(state.project.area_id)));
    // A novel that is its world's only piece doesn't need saying twice.
    const same = up && state.project.parent_id === up.world.id && (state.project.title || '') === (up.world.title || '');
    // The book you're writing in is a switcher: it lists every world and piece.
    if (same) parts.pop();
    parts.push(bookPart(state.project), link(ch?.title || '', () => {}, 'here'));
  } else if (view() === 'journal') {
    parts.push(lib, link('Journal', () => {}, 'here'));
  } else if (view() === 'tags') {
    const at = tagsPage?.place || {};
    parts.push(lib, link('Tags', () => go({ view: 'tags' }), at.tag ? '' : 'here'));
    if (at.tag) parts.push(link(`#${at.tag}`, () => go({ view: 'tags', tag: at.tag }), at.walk == null ? 'here' : ''));
  } else if (inNotebook() && notebook.page) {
    const p = notebook.page;
    if (p.kind === 'day') parts.push(link('Daily pages', () => go({ view: 'notebook', pageId: dayId(isoToday()) })), link(titleOf(p), () => {}, 'here'));
    else {
      const up = await within(p);
      if (up) parts.push(...up.out);
      else parts.push(lib, link('Loose pages', () => go({ view: 'library', area: null })));
      parts.push(link(p.title || 'Untitled page', () => {}, 'here'));
    }
  }
  // Inside a piece (One home, Nov 20 2026) the crumb is the way back to its
  // project, and names the piece's own page when it's one of them.
  const shown = (await pieceCrumb(link)) || parts;
  const crumb = $('#crumb');
  crumb.replaceChildren();
  shown.forEach((p, i) => { if (i) crumb.append(make('span', 'sep', '›')); crumb.append(p); });
  refreshWords();
  await renderStrip();
  const isToday = lastPlace?.view === 'notebook' && lastPlace.pageId === dayId(isoToday());
  // The top bar's buttons stay put; the one for where you are is lit.
  const here = { 'view-toggle': view() === 'plan' || (inNotebook() && !!notebook.page && notebook.page.kind === 'day'), 'library-toggle': view() === 'library', 'drawer-toggle': view() === 'drawer', 'tags-toggle': view() === 'tags', 'desk-toggle': view() === 'desk' };
  for (const [id, on] of Object.entries(here)) { const b = document.getElementById(id); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  const names = isToday ? ['Today'] : parts.map((p) => p.textContent.replace(/\s*▾\s*$/, '').trim()).filter(Boolean);
  // A pane's name shows in its header; the main window's in the place bar and recent places.
  if (inPane) {
    // Zoomed into a line: the line is its name.
    const z = inNotebook() && notebook.zoom && notebook.editor.view.dom.querySelector(`.line-gutter[data-eid="${notebook.zoom}"]`)?.parentElement?.querySelector(':scope > p')?.textContent?.trim();
    paneHost()?.here(PANE_ID, lastPlace, z ? [...names, z.length > 60 ? `${z.slice(0, 58)}…` : z] : names);
  }
  else nav.here(lastPlace, names);
  frame.here(lastPlace);
  nowStrip?.soon();
}

// The piece you're in and its project, if you're inside one.
async function pieceHere() {
  const v = view();
  let id = null;
  if (v === 'write') id = state.project?.id;
  else if (v === 'grid') id = state.gridId;
  else if (v === 'production' || v === 'deliver') id = state.prodId;
  else if (v === 'stage') id = state.stage?.id;
  else if (v === 'compare') id = state.compareId;
  else if (v === 'project') id = state.bookId;
  else if (inNotebook() && notebook.page && notebook.page.kind !== 'day') id = notebook.page.kind === 'project' ? notebook.page.id : (await bookOf(notebook.page))?.id;
  const piece = id && (await getEntry(id));
  if (!piece || piece.kind !== 'project') return null;
  const world = await worldOf(piece);
  return world ? { piece, world } : null;
}
// The crumb names the screen you're on in Make (Shots, Storyboard, Cast and
// places, Shoot days); Deliver is one place.
function prodScreen() {
  if (view() === 'deliver') return 'Deliver';
  return document.querySelector('.prod-view .gv-levels .chip[aria-selected="true"]')?.textContent?.trim() || 'Shots';
}
async function pieceCrumb(link) {
  if (inPane) return null;
  const at = await pieceHere();
  if (!at) return null;
  const back = link(`‹ ${at.world.title || 'Untitled'}`, () => go({ view: 'world', id: at.world.id }), 'back');
  back.title = 'Back to the project page (Alt + 0)';
  const v = view();
  const here = v === 'stage' ? { gather: 'Ideas for this', revise: 'Drafts and notes', shape: 'Develop' }[state.stage?.page] || PAGE_NAMES[state.stage?.page] || ''
    : v === 'production' || v === 'deliver' ? prodScreen() : v === 'compare' ? 'Compare'
    : inNotebook() && notebook.page?.kind === 'page' ? notebook.page.title || 'Untitled page'
    // A novel's chapter names where you are in it (a script's one chapter needn't).
    : v === 'write' && bookType(at.piece) !== 'screenplay' && state.chapterId ? (await getEntry(state.chapterId))?.title || '' : '';
  return here ? [back, link(here, () => {}, 'here')] : [back];
}

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireRail() {
  railBusy = Promise.resolve();
  crumbBusy = Promise.resolve();
}

export { areaPath, dot, pieceHere, renameable, renderCrumb, renderRail, renderScenes, scheduleScenes, subtree, wireRail };
