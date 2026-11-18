import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { byKind, topTags, putEntries, children } from './db.js';
import { entry, newId } from './model.js';
import { titleOf } from './notebook.js';
import { guessType } from './production.js';

// Autocomplete while typing, one list for three triggers (Nov 18 2026):
//  #     his tags, most used first, narrowing as he types (matches anywhere);
//  [[    pages, days and chapters, then projects and pieces (a piece shows
//        its project faintly, so two "Episode 1"s can be told apart);
//  @     the characters and places of the project he is in (bible pages);
//        outside a project, characters only.
// The caret never leaves the text (like the / menu). Up and Down move, Enter
// or Tab takes, Esc closes and leaves what he typed. A space ends a # or @
// word, so typing on always makes a new tag or plain words. On a phone the
// matches sit in one row above the keyboard instead of a box over the text.
// Works in the editors (the Suggest extension) and in the one-line boxes
// that take a line: the thought box and Add a task (watchInputs).

export const suggestKey = new PluginKey('suggest');

const TRIGGERS = [
  // [[ first: its text may hold spaces, and a # or @ inside it is part of a title.
  { kind: 'link', re: /\[\[([^\]\n[]{0,60})$/u, len: 2 },
  { kind: 'tag', re: /(?:^|\s)#([\p{L}\p{N}_-]{0,40})$/u, len: 1 },
  { kind: 'who', re: /(?:^|\s)@([\p{L}\p{N}_'’-]{0,40})$/u, len: 1 }
];

// Which project he is in, for @ (app/quickinserts.js sets it): () => world row | null.
let worldNow = async () => null;
export function setSuggestWorld(fn) { worldNow = fn; }

const phone = () => matchMedia('(pointer: coarse) and (max-width: 760px)').matches;

// ---------- what each trigger offers ----------

const norm = (s) => (s || '').toLowerCase();
const cache = { at: 0, tags: null, links: null };
// A short-lived copy, so each key typed doesn't read the whole store again.
// A list just opening (nothing typed after the trigger yet) always reads afresh.
async function fresh(again = false) {
  if (!again && Date.now() - cache.at < 4000 && cache.tags?.length) return cache;
  const [tags, pages, days, chapters, pieces, worlds] = await Promise.all([topTags(400), byKind('page'), byKind('day'), byKind('chapter'), byKind('project'), byKind('world')]);
  const live = (r) => !r.deleted;
  const byId = new Map([...pieces, ...worlds].map((r) => [r.id, r]));
  const worldName = (r) => {
    let p = byId.get(r.parent_id);
    for (let i = 0; p && i < 40; i++) { if (p.kind === 'world') return p.title || ''; p = byId.get(p.parent_id); }
    return '';
  };
  const firstThree = [
    ...pages.filter(live).map((e) => ({ id: e.id, title: titleOf(e), kind: 'page' })).sort((a, b) => a.title.localeCompare(b.title)),
    ...days.filter(live).sort((a, b) => (a.id < b.id ? 1 : -1)).map((e) => ({ id: e.id, title: titleOf(e), kind: 'day' })),
    ...chapters.filter(live).map((e) => ({ id: e.id, title: titleOf(e), kind: 'chapter' })).sort((a, b) => a.title.localeCompare(b.title))
  ];
  const more = [
    ...worlds.filter(live).map((e) => ({ id: e.id, title: e.title || 'Untitled', kind: 'project' })).sort((a, b) => a.title.localeCompare(b.title)),
    ...pieces.filter(live).map((e) => ({ id: e.id, title: e.title || 'Untitled', kind: 'piece', faint: worldName(e) })).sort((a, b) => a.title.localeCompare(b.title))
  ];
  Object.assign(cache, { at: Date.now(), tags, links: [...firstThree, ...more], pages: pages.filter(live) });
  return cache;
}
export function forgetSuggestions() { cache.at = 0; }

// Bible pages of one world, each with what it is (character, location…).
async function biblePages(world) {
  const out = [];
  const walk = async (pid, parentTitle) => {
    for (const r of await children(pid)) {
      if (r.kind !== 'page') continue;
      out.push({ row: r, type: r.fields?.element?.type || guessType(parentTitle) });
      await walk(r.id, r.title);
    }
  };
  await walk(world.id, '');
  return out;
}

async function itemsFor(kind, q) {
  const c = await fresh(!q);
  const query = norm(q);
  const hit = (s) => !query || norm(s).includes(query);
  // Words that start with what he typed come first.
  const rank = (list, get) => [...list.filter((x) => norm(get(x)) === query), ...list.filter((x) => norm(get(x)) !== query && norm(get(x)).startsWith(query)), ...list.filter((x) => !norm(get(x)).startsWith(query))];
  if (kind === 'tag') {
    const tags = rank(c.tags.filter(hit), (t) => t);
    // Nothing when what he typed is already the whole tag: Enter makes the line.
    if (tags.length === 1 && norm(tags[0]) === query) return [];
    return tags.slice(0, 8).map((t) => ({ label: `#${t}`, insert: { text: `#${t}` } }));
  }
  if (kind === 'link') {
    const found = rank(c.links.filter((e) => hit(e.title)), (e) => e.title).slice(0, 8)
      .map((e) => ({ label: e.title, hint: e.kind === 'piece' ? e.faint : e.kind === 'project' ? 'project' : e.kind, faint: e.kind === 'piece', insert: { ref: { id: e.id, title: e.title } } }));
    const typed = q.trim();
    if (typed && !c.links.some((e) => norm(e.title) === norm(typed))) found.push({ label: `New page “${typed}”`, hint: '', insert: { create: typed } });
    return found;
  }
  // who
  const world = await worldNow().catch(() => null);
  let people;
  if (world) {
    people = (await biblePages(world)).filter((p) => p.type === 'character' || p.type === 'location');
    // Characters before places, each alphabetical.
    people.sort((a, b) => (a.type === b.type ? (a.row.title || '').localeCompare(b.row.title || '') : a.type === 'character' ? -1 : 1));
  } else {
    people = c.pages.filter((r) => r.fields?.element?.type === 'character').map((row) => ({ row, type: 'character' }));
    people.sort((a, b) => (a.row.title || '').localeCompare(b.row.title || ''));
  }
  return rank(people.filter((p) => hit(p.row.title)), (p) => p.row.title || '').slice(0, 8)
    .map((p) => ({ label: p.row.title || 'Untitled', hint: p.type === 'location' ? 'place' : 'character', insert: { ref: { id: p.row.id, title: p.row.title || 'Untitled' } } }));
}

// A new page made from [[: an ordinary page on its own, as the link picker did.
function made(title) {
  const page = entry('page', { id: newId('pg'), title });
  putEntries([page]);
  forgetSuggestions();
  return { id: page.id, title: page.title };
}

// ---------- the list ----------

const box = document.createElement('div');
box.className = 'suggest';
box.setAttribute('role', 'listbox');
box.setAttribute('aria-label', 'Suggestions');
box.hidden = true;
const list = document.createElement('ul');
box.append(list);
document.body.append(box);

// { host, items, index, kind, query, pick(item), anchor() → {left, top, bottom} }
let shown = null;
let turn = 0;
export const suggestOpen = (host) => !!shown && (!host || shown.host === host) && !box.hidden;

function render() {
  list.replaceChildren(...shown.items.map((it, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === shown.index));
    li.innerHTML = '<span class="label"></span><span class="hint"></span>';
    li.querySelector('.label').textContent = it.label;
    li.querySelector('.hint').textContent = it.hint || '';
    // Held back so the caret (and a phone's keyboard) stays in the text.
    li.addEventListener('pointerdown', (e) => e.preventDefault());
    li.addEventListener('mousedown', (e) => e.preventDefault());
    li.addEventListener('click', () => take(i));
    return li;
  }));
  list.children[shown.index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function place() {
  const vv = window.visualViewport;
  const bottom = vv ? vv.offsetTop + vv.height : innerHeight;
  const bar = [...document.querySelectorAll('.script-bar')].find((b) => !b.hidden);
  const barH = bar ? bar.offsetHeight : 0;
  box.classList.toggle('row', phone());
  if (phone()) {
    // One row right above the keyboard (and above the outline or script bar).
    box.style.left = '0px';
    box.style.top = `${bottom - barH - box.offsetHeight}px`;
    return;
  }
  const at = shown.anchor();
  const floor = bottom - barH - 8;
  box.style.left = `${Math.max(8, Math.min(at.left, innerWidth - 328))}px`;
  const h = box.offsetHeight;
  box.style.top = `${at.bottom + 6 + h > floor ? Math.max(8, at.top - 6 - h) : at.bottom + 6}px`;
}

function hide() {
  box.hidden = true;
  shown = null;
  turn++;
}

function take(i) {
  const s = shown;
  const it = s?.items[i];
  if (!it) return;
  hide();
  s.pick(it);
}

// Shows what fits `kind`/`query` for `host`, unless something newer came first.
async function offer(host, kind, query, pick, anchor) {
  const mine = ++turn;
  const items = await itemsFor(kind, query).catch(() => []);
  if (mine !== turn) return;
  if (!items.length) { if (shown?.host === host) hide(); return; }
  const same = shown?.host === host && shown.kind === kind && shown.query === query;
  shown = { host, items, index: same ? Math.min(shown.index, items.length - 1) : 0, kind, query, pick, anchor };
  box.hidden = false;
  render();
  place();
}

// The keys while the list shows. True when the key was used.
function keyed(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const n = shown.items.length;
    shown.index = (shown.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    render();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') { take(shown.index); return true; }
  if (e.key === 'Escape') { hide(); return true; }
  return false;
}

function triggerIn(text) {
  for (const t of TRIGGERS) {
    const m = t.re.exec(text);
    if (m) return { kind: t.kind, query: m[1], len: m[1].length + t.len };
  }
  return null;
}

// ---------- in the editors ----------

export const Suggest = Extension.create({
  name: 'suggest',
  // Before the outline's own Enter and Tab, so a pick wins while the list shows.
  priority: 1000,
  addOptions() { return { isScript: () => false }; },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const isScript = this.options.isScript;
    return [new Plugin({
      key: suggestKey,
      state: {
        init: () => ({ from: null, kind: null, query: '', dismissed: null }),
        apply(tr, prev, _old, state) {
          const { $from, empty } = state.selection;
          if (!empty || !$from.parent.isTextblock) return { from: null, kind: null, query: '', dismissed: null };
          const before = $from.parent.textBetween(0, $from.parentOffset, null, '￼');
          const m = triggerIn(before);
          if (!m) return { from: null, kind: null, query: '', dismissed: null };
          const el = $from.parent.attrs?.el;
          // A script's scene heading takes #3# for its number; a line that starts
          // with @ in a script is Fountain's forced character name.
          if (isScript() && ((m.kind === 'tag' && el === 'scene') || (m.kind === 'who' && /^@/.test(before)))) return { from: null, kind: null, query: '', dismissed: null };
          const from = $from.pos - m.len;
          const dismissed = tr.getMeta(suggestKey) === 'dismiss' ? from : prev.dismissed === from ? from : null;
          // Opens as he types the trigger, not when the caret wanders past an old
          // one; moving the caret without typing (a click, an arrow) closes it.
          const typed = tr.docChanged && !tr.getMeta('preventUpdate');
          const stays = prev.from === from && (typed || !tr.selectionSet);
          const open = dismissed == null && (stays || (typed && m.query === ''));
          return { from: open ? from : null, kind: m.kind, query: m.query, dismissed };
        }
      },
      view: (view) => ({
        update(v) {
          const st = suggestKey.getState(v.state);
          if (st.from == null || !v.hasFocus()) { if (shown?.host === v) hide(); return; }
          const from = st.from;
          const to = v.state.selection.from;
          offer(v, st.kind, st.query, (it) => {
            const chain = editor.chain().focus().deleteRange({ from, to });
            if (it.insert.text) chain.insertContent(`${it.insert.text} `).run();
            else {
              const ref = it.insert.create ? made(it.insert.create) : it.insert.ref;
              chain.insertContent([{ type: 'entryRef', attrs: { id: ref.id, title: ref.title } }, { type: 'text', text: ' ' }]).run();
            }
          }, () => v.coordsAtPos(from));
        },
        destroy() { if (shown?.host === view) hide(); }
      }),
      props: {
        handleKeyDown(view, e) {
          if (!shown || shown.host !== view || box.hidden) return false;
          if (!keyed(e)) return false;
          if (e.key === 'Escape') { view.dispatch(view.state.tr.setMeta(suggestKey, 'dismiss')); e.stopPropagation(); }
          return true;
        },
        handleDOMEvents: {
          blur(view) { setTimeout(() => { if (shown?.host === view && !view.hasFocus()) hide(); }, 100); return false; }
        }
      }
    })];
  }
});

// ---------- in one-line boxes ----------

// The thought box and Add a task (any input with data-add).
const INPUTS = '#zm-thought-in, input[data-add]';
const dismissedAt = new WeakMap();
const openAt = new WeakMap();

function inputCaret(input) {
  const r = input.getBoundingClientRect();
  return { left: r.left + 8, top: r.top, bottom: r.bottom };
}

function check(input, typed) {
  const at = input.selectionStart;
  if (at == null || at !== input.selectionEnd) { if (shown?.host === input) hide(); return; }
  const m = triggerIn(input.value.slice(0, at));
  if (!m) { dismissedAt.delete(input); openAt.delete(input); if (shown?.host === input) hide(); return; }
  const from = at - m.len;
  if (dismissedAt.get(input) === from) return;
  // Open from the moment the trigger is typed (the list may still be on its way).
  if (typed && m.query === '') openAt.set(input, from);
  if (openAt.get(input) !== from) return;
  offer(input, m.kind, m.query, (it) => {
    const end = input.selectionStart;
    const ref = it.insert.text || `[[${(it.insert.create ? made(it.insert.create) : it.insert.ref).title}]]`;
    const text = `${ref} `;
    input.value = input.value.slice(0, from) + text + input.value.slice(end);
    const caret = from + text.length;
    input.setSelectionRange(caret, caret);
    input.focus();
  }, () => inputCaret(input));
}

document.addEventListener('input', (e) => { if (e.target.matches?.(INPUTS)) check(e.target, true); });
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t.matches?.(INPUTS) || !suggestOpen(t) || e.isComposing) return;
  if (!keyed(e)) return;
  if (e.key === 'Escape') {
    const m = triggerIn(t.value.slice(0, t.selectionStart));
    if (m) dismissedAt.set(t, t.selectionStart - m.len);
  }
  e.preventDefault();
  e.stopPropagation();
}, true);
document.addEventListener('selectionchange', () => {
  const t = document.activeElement;
  if (shown && shown.host === t && t.matches?.(INPUTS)) check(t, false);
});
document.addEventListener('focusout', (e) => { if (shown?.host === e.target) setTimeout(() => { if (shown?.host === e.target && document.activeElement !== e.target) hide(); }, 100); });
window.visualViewport?.addEventListener('resize', () => { if (shown && !box.hidden) place(); });
