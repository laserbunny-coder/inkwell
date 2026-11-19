// Go to… inside a project (Alt + G on a computer; the search button at the
// top right on a phone while you're in a project): its pieces, bible pages,
// looks, open steps and its parts, by name. Type a few letters, Enter opens
// the top one, Esc closes.
import { getEntry } from '../db.js';
import { make } from '../dom.js';
import { worldTree, worldStats, kindName, stageOf } from '../library.js';
import { partsFor } from '../pages.js';
import { go, openEntry } from './routing.js';
import { currentWorldId, nav } from './workpages.js';
import { plan } from './talking.js';

let bg = null;
let sel = 0;
let hits = [];
let all = [];
let back = null;
let loading = null;

function build() {
  bg = make('div', 'gt-bg');
  bg.hidden = true;
  const sheet = make('div', 'gt-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Go to in this project');
  const input = make('input', 'gt-q');
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('enterkeyhint', 'go');
  input.setAttribute('aria-label', 'Go to');
  const res = make('div', 'gt-res');
  res.setAttribute('role', 'listbox');
  const hint = make('div', 'gt-hint', 'Type a few letters · Enter opens the top one · Esc closes');
  sheet.append(input, res, hint);
  bg.append(sheet);
  bg.addEventListener('pointerdown', (e) => { if (e.target === bg) closeGoTo(); });
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeGoTo(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(hits.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); mark(); return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (loading) loading.then(() => pick(hits[sel])); else pick(hits[sel]); }
  });
  document.body.append(bg);
}

async function gather(worldId) {
  const w = await getEntry(worldId);
  if (!w) return { w: null, list: [] };
  const list = [];
  const { pieces } = await worldStats(w);
  for (const { row } of pieces) list.push({ label: row.title || 'Untitled', kind: `${kindName(row)} · ${stageOf(row, w)}`, run: () => go({ view: 'project', id: row.id }) });
  const { pages } = await worldTree(w.id);
  const life = !!w.fields?.life;
  for (const { row } of pages) {
    if (row.id === `steps-${w.id}`) continue;
    list.push({ label: row.title || 'Untitled page', kind: life ? 'Notes' : 'Bible', run: () => go({ view: 'notebook', pageId: row.id }) });
  }
  if (!life) {
    const { elementsIn, lookOf } = await import('../production.js');
    for (const e of await elementsIn(w)) {
      if (!lookOf(e.fields?.element || {}).refs.length) continue;
      list.push({ label: `${e.title || 'Untitled'}’s looks`, kind: 'Make · Looks', run: () => go({ view: 'stage', id: w.id, page: 'make', sub: 'looks' }) });
    }
  }
  for (const i of (plan?.items || []).filter((x) => x.world?.id === w.id && !x.row.fields?.done)) list.push({ label: i.row.text || 'Untitled', kind: 'Step', run: () => openEntry(i.row.id) });
  for (const p of partsFor(w)) list.push({ label: p.label, kind: 'Part', run: () => go({ view: 'stage', id: w.id, page: p.page }) });
  list.push({ label: 'Steps', kind: 'Part', run: () => go({ view: 'world', id: w.id, part: 'steps' }) });
  list.push({ label: 'Project home', kind: 'Part', run: () => go({ view: 'world', id: w.id }) });
  return { w, list };
}

function draw() {
  const q = bg.querySelector('.gt-q').value.trim().toLowerCase();
  const score = (x) => { const t = x.label.toLowerCase(); if (!q) return 1; if (t.startsWith(q)) return 3; if (t.split(/[^a-z0-9’']+/).some((wd) => wd.startsWith(q))) return 2; return t.includes(q) ? 1 : 0; };
  hits = all.map((x, i) => ({ x, s: score(x), i })).filter((h) => h.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 12).map((h) => h.x);
  const found = hits.length;
  // Always last: the same letters in the whole of Inkwell (the box, Ctrl + K),
  // so a phone in a project still reaches every command.
  const text = bg.querySelector('.gt-q').value.trim();
  hits.push({ label: text ? `Search all of Inkwell for “${text}”` : 'Search all of Inkwell and every command', kind: 'Go', all: true, run: () => openBox(text) });
  const res = bg.querySelector('.gt-res');
  res.replaceChildren(...hits.map((h, i) => {
    const b = make('button', 'gt-hit');
    b.setAttribute('role', 'option');
    b.append(make('span', 'gt-name', h.label), make('span', 'gt-kind', h.kind));
    b.addEventListener('click', () => pick(h));
    b.addEventListener('pointermove', () => { if (sel !== i) { sel = i; mark(); } });
    if (h.all) b.classList.add('gt-all');
    return b;
  }));
  if (!found) res.prepend(make('p', 'gt-none', 'Nothing by that name here.'));
  mark();
}

function mark() {
  bg.querySelectorAll('.gt-hit').forEach((b, i) => { b.classList.toggle('sel', i === sel); b.setAttribute('aria-selected', String(i === sel)); if (i === sel) b.scrollIntoView({ block: 'nearest' }); });
}

function openBox(text) {
  if (!nav.isOpen) nav.toggle();
  const input = document.querySelector('#palette-input');
  if (text && input) { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); }
}

async function pick(h) {
  if (!h) return;
  closeGoTo(false);
  await h.run();
}

export const goToOpen = () => !!bg && !bg.hidden;

// Opens it for the project you're in. Returns false when you're not in one.
export async function openGoTo() {
  if (goToOpen()) { bg.querySelector('.gt-q').focus(); return true; }
  if (!bg) build();
  back = document.activeElement;
  // Up and ready to type at once, before anything is looked up; what's in the
  // project fills in a moment later (letters typed meanwhile are kept, and
  // Enter waits for the list).
  const input = bg.querySelector('.gt-q');
  input.value = '';
  input.placeholder = 'Go to in this project…';
  all = [];
  hits = [];
  sel = 0;
  bg.querySelector('.gt-res').replaceChildren();
  bg.hidden = false;
  document.body.classList.add('goto-on');
  input.focus();
  let ready;
  loading = new Promise((r) => { ready = r; });
  const id = await currentWorldId();
  const { w, list } = id ? await gather(id) : { w: null, list: [] };
  ready();
  loading = null;
  if (!w) { closeGoTo(); return false; }
  all = list;
  input.placeholder = `Go to in ${w.title || 'this project'}…`;
  draw();
  return true;
}

export function closeGoTo(refocus = true) {
  if (!bg || bg.hidden) return;
  bg.hidden = true;
  document.body.classList.remove('goto-on');
  if (refocus && back?.isConnected) back.focus?.();
}
