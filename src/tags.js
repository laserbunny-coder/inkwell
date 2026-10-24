import { putEntries, getEntry, children, eachTagged, CLAUDE } from './db.js';
import { entry, tagsIn } from './model.js';
import { rootsOf, titleOf } from './notebook.js';
import { bySort, GAP } from './order.js';
import { ago } from './library.js';
import { fileUrl, isImage } from './files.js';

// The Tags page: every #tag you've used, with how many things carry it and
// when it was last used, sorted into groups (Claude suggests them; you can
// move tags, rename groups, add your own). Tags that look like the same thing
// (#stunt, #stunts) can be merged, and any tag renamed everywhere it's used.
// Open a tag to see what's in it, or go through it one thing at a time.
//
// The groups are one synced entry (settings-tag-groups), so they're the same
// on every device.

export const GROUPS_ID = 'settings-tag-groups';
const KINDS = ['line', 'para'];

const live = (r) => r && !r.deleted && !r.fields?.trashed && !r.fields?.mirror && KINDS.includes(r.kind);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const cleanTag = (t) => String(t || '').trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '');

// What's tagged, read once: every live line and paragraph per tag, newest first.
export async function tagIndex() {
  const by = new Map();
  await eachTagged((tag, row) => {
    if (!live(row)) return;
    if (!by.has(tag)) by.set(tag, []);
    by.get(tag).push(row);
  });
  for (const rows of by.values()) rows.sort((a, b) => b.updated_at - a.updated_at);
  return by;
}

export function statsOf(by) {
  return [...by].map(([tag, rows]) => ({ tag, count: rows.length, last: rows[0]?.updated_at || 0, rows }));
}

export async function getGroups() {
  const row = await getEntry(GROUPS_ID);
  const f = row && !row.deleted ? row.fields || {} : {};
  return { groups: f.groups || [], apart: f.apart || [], same: f.same || [] };
}

export async function saveGroups(next) {
  const prev = await getEntry(GROUPS_ID);
  const fields = { ...(prev?.fields || {}), ...next };
  const row = { ...(prev || entry('settings', { id: GROUPS_ID, title: 'Tag groups' })), fields, deleted: false, updated_at: Date.now() };
  await putEntries([row]);
  return row;
}

// A tag's group, or null.
export const groupOf = (groups, tag) => groups.find((g) => g.tags.includes(tag)) || null;

export async function moveTag(tag, groupId) {
  const { groups } = await getGroups();
  const next = groups.map((g) => ({ ...g, tags: g.tags.filter((t) => t !== tag) }));
  const to = next.find((g) => g.id === groupId);
  if (to) to.tags.push(tag);
  return saveGroups({ groups: next });
}

const newGroupId = () => `tg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function addGroup(name) {
  const { groups } = await getGroups();
  const g = { id: newGroupId(), name: name.trim() || 'New group', tags: [] };
  await saveGroups({ groups: [...groups, g] });
  return g;
}

export async function renameGroup(id, name) {
  const { groups } = await getGroups();
  return saveGroups({ groups: groups.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name } : g)) });
}

// A group goes; its tags go back to "Not in a group".
export async function removeGroup(id) {
  const { groups } = await getGroups();
  return saveGroups({ groups: groups.filter((g) => g.id !== id) });
}

// Claude's groups: yours stay as they were; new tags are placed, new groups added.
export async function askForGroups(ask, stats) {
  const { groups, apart } = await getGroups();
  const samples = (rows) => rows.slice(0, 3).map((r) => (r.text || '').replace(/#[\p{L}\p{N}_-]+/gu, '').trim().slice(0, 140)).filter(Boolean);
  const answer = await ask({
    mode: 'tags',
    tags: stats.map((s) => ({ tag: s.tag, count: s.count, samples: samples(s.rows) })),
    groups: groups.map((g) => ({ name: g.name, tags: g.tags })),
    apart
  });
  const byName = new Map(groups.map((g) => [g.name.toLowerCase(), g]));
  const placed = new Set();
  const next = [];
  for (const g of answer.groups || []) {
    const had = byName.get(String(g.name).toLowerCase());
    const tags = (g.tags || []).filter((t) => !placed.has(t));
    tags.forEach((t) => placed.add(t));
    if (had || tags.length) next.push({ id: had?.id || newGroupId(), name: had?.name || g.name, tags });
  }
  // A group of yours Claude left out (one you just emptied, say) stays.
  for (const g of groups) if (!next.some((n) => n.id === g.id)) next.push(g);
  return saveGroups({ groups: next, same: answer.same || [], sortedAt: Date.now() });
}

export async function notSame(tags) {
  const { apart, same } = await getGroups();
  const key = [...tags].sort().join('|');
  return saveGroups({ apart: [...apart, [...tags].sort()], same: same.filter((s) => [...s.tags].sort().join('|') !== key) });
}

// Renames a tag everywhere it's written, or merges it into another tag when
// the new name is already in use. Returns the rows it changed.
export async function renameTag(from, to, by) {
  from = cleanTag(from);
  to = cleanTag(to);
  if (!from || !to || from === to) return [];
  const re = new RegExp(`(^|\\s)#${esc(from)}(?![\\p{L}\\p{N}_-])`, 'giu');
  const swap = (s) => (typeof s === 'string' ? s.replace(re, `$1#${to}`) : s);
  const swapNodes = (nodes) => (nodes || []).map((n) => ({ ...n, ...(n.text != null ? { text: swap(n.text) } : {}), ...(n.content ? { content: swapNodes(n.content) } : {}) }));
  const rows = [...(by.get(from) || [])];
  const now = Date.now();
  const out = rows.map((r) => {
    const text = swap(r.text || '');
    const fields = { ...(r.fields || {}) };
    if (fields.claude_tag === from) fields.claude_tag = to;
    if (fields.gather === from) fields.gather = to;
    return { ...r, text, content: r.content ? swapNodes(r.content) : r.content, tags: tagsIn(text), fields, updated_at: now };
  });
  // Lines that gather the tag onto a page carry it too.
  await putEntries(out);
  const { groups, same } = await getGroups();
  const target = groupOf(groups, to);
  const next = groups.map((g) => {
    let tags = g.tags.filter((t) => t !== from);
    if (g.tags.includes(from) && !target && !tags.includes(to)) tags = [...tags, to];
    return { ...g, tags };
  });
  await saveGroups({ groups: next, same: same.map((s) => ({ ...s, tags: [...new Set(s.tags.map((t) => (t === from ? to : t)))], keep: s.keep === from ? to : s.keep })).filter((s) => s.tags.length > 1) });
  return out;
}

// Takes one tag off one line or paragraph; the words stay.
export function withoutTag(row, tag) {
  const re = new RegExp(`(^|\\s)#${esc(tag)}(?![\\p{L}\\p{N}_-])`, 'giu');
  const drop = (s) => (typeof s === 'string' ? s.replace(re, '$1').replace(/[ \t]{2,}/g, ' ') : s);
  const dropNodes = (nodes) => (nodes || []).map((n) => ({ ...n, ...(n.text != null ? { text: drop(n.text) } : {}), ...(n.content ? { content: dropNodes(n.content) } : {}) }))
    .filter((n) => n.text == null || n.text !== '');
  const text = drop(row.text || '').trim();
  const fields = { ...(row.fields || {}) };
  if (fields.claude_tag === tag) fields.claude_tag = null;
  return { ...row, text, content: row.content ? dropNodes(row.content) : row.content, tags: tagsIn(text), fields, updated_at: Date.now() };
}

// Where each row lives (its day, page or chapter), for showing beside it.
export async function homesOf(rows) {
  const roots = await rootsOf(rows);
  return new Map(rows.map((r) => [r.id, roots.get(r.id) ? titleOf(roots.get(r.id)) : '']));
}

// ---------- the page ----------

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const SORTS = { used: 'Most used', recent: 'Recently used', az: 'A to Z' };

export class TagsPage {
  // go(place) moves between the list, a tag and going through it; open(id)
  // opens a line where it lives; ask/canAsk reach Claude; changed(rows)
  // tells the rest of the app what was rewritten.
  constructor({ sheet, go, open, ask, canAsk, changed, toast }) {
    Object.assign(this, { sheet, go, ask, canAsk, changed, toast });
    this.open = async (id) => { await this.saveNote(); return open(id); };
    this.busy = false;
    document.addEventListener('keydown', (e) => this.key(e));
  }

  get sort() { try { return localStorage.getItem('tagSort') || 'used'; } catch { return 'used'; } }
  set sort(v) { try { localStorage.setItem('tagSort', v); } catch { /* full */ } }
  get skipDone() { try { return localStorage.getItem('tagSkipDone') !== 'no'; } catch { return true; } }
  set skipDone(v) { try { localStorage.setItem('tagSkipDone', v ? 'yes' : 'no'); } catch { /* full */ } }

  async show(place = {}) {
    await this.saveNote();
    this.note = null;
    this.place = place;
    const token = this.token = {};
    const [by, data] = await Promise.all([tagIndex(), getGroups()]);
    if (token !== this.token) return;
    this.by = by;
    this.data = data;
    if (place.tag && place.walk != null) return this.renderWalk(place.tag, place.walk);
    if (place.tag) return this.renderTag(place.tag);
    return this.renderList();
  }

  refresh() { if (this.place && document.documentElement.dataset.view === 'tags' && !this.sheet.contains(document.activeElement?.closest?.('input, select, textarea') || null)) this.show(this.place); }

  sorted(stats) {
    const s = this.sort;
    return [...stats].sort(s === 'az' ? (a, b) => a.tag.localeCompare(b.tag) : s === 'recent' ? (a, b) => b.last - a.last : (a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  // ---- all tags ----
  renderList() {
    this.walking = null;
    const stats = statsOf(this.by);
    const { groups, same } = this.data;
    const known = new Map(stats.map((s) => [s.tag, s]));
    const grouped = new Set(groups.flatMap((g) => g.tags));
    const loose = stats.filter((s) => !grouped.has(s.tag));
    const sheet = this.sheet;
    sheet.replaceChildren();

    const head = make('div', 'tg-head');
    head.append(make('h1', '', 'Tags'), make('span', 'hint', stats.length ? plural(stats.length, 'tag') : ''));
    sheet.append(head);
    if (!stats.length) {
      sheet.append(make('p', 'hint', 'No tags yet. Type # and a word on any line (#music, #stunts) and it shows up here. Claude adds one to what you capture and share.'));
      return;
    }

    const bar = make('div', 'tg-bar');
    const sortSel = make('select');
    sortSel.setAttribute('aria-label', 'Sort tags');
    for (const [v, label] of Object.entries(SORTS)) { const o = make('option', '', label); o.value = v; sortSel.append(o); }
    sortSel.value = this.sort;
    sortSel.addEventListener('change', () => { this.sort = sortSel.value; this.renderList(); });
    const sortLabel = make('label', 'lib-sort', 'Sort ');
    sortLabel.append(sortSel);
    const sortBtn = make('button', 'pill', !groups.length ? 'Sort into groups with Claude' : loose.length ? `Sort ${plural(loose.length, 'new tag')} with Claude` : 'Ask Claude again');
    sortBtn.dataset.act = 'sort';
    sortBtn.hidden = !this.ask;
    sortBtn.addEventListener('click', () => this.sortWithClaude(stats, sortBtn));
    const addBtn = make('button', 'ghost-btn', '+ Group');
    addBtn.addEventListener('click', async () => { const g = await addGroup('New group'); this.data = await getGroups(); this.renderList(); this.sheet.querySelector(`[data-group="${g.id}"] .tg-group-name`)?.select(); });
    bar.append(sortLabel, sortBtn, addBtn);
    sheet.append(bar);

    // Claude's "these look like the same tag".
    const sameNow = (same || []).map((s) => ({ ...s, tags: s.tags.filter((t) => known.has(t)) })).filter((s) => s.tags.length > 1);
    if (sameNow.length) {
      const box = make('section', 'tg-same');
      box.append(make('div', 'panel-label', 'These look like the same tag'));
      for (const s of sameNow) {
        const keep = s.tags.includes(s.keep) ? s.keep : s.tags[0];
        const row = make('div', 'tg-same-row');
        row.append(make('span', '', s.tags.map((t) => `#${t} (${known.get(t).count})`).join(' and ')));
        const merge = make('button', 'pill', `Merge into #${keep}`);
        merge.addEventListener('click', () => this.merge(s.tags.filter((t) => t !== keep), keep));
        const no = make('button', 'ghost-btn', 'Not the same');
        no.addEventListener('click', async () => { await notSame(s.tags); this.data = await getGroups(); this.renderList(); });
        row.append(merge, no);
        box.append(row);
      }
      sheet.append(box);
    }

    const section = (g, list) => {
      const sec = make('section', 'tg-group');
      if (g) sec.dataset.group = g.id;
      const top = make('div', 'tg-group-head');
      if (g) {
        const name = make('input', 'tg-group-name');
        name.value = g.name;
        name.setAttribute('aria-label', 'Group name');
        name.spellcheck = false;
        name.addEventListener('change', async () => { await renameGroup(g.id, name.value); this.data = await getGroups(); });
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
        top.append(name);
        const x = make('button', 'ghost-btn tg-group-x', 'Remove group');
        x.title = 'Its tags go back to “Not in a group”';
        x.addEventListener('click', async () => { await removeGroup(g.id); this.data = await getGroups(); this.renderList(); });
        top.append(x);
      } else top.append(make('div', 'panel-label', groups.length ? 'Not in a group' : 'All tags'));
      sec.append(top);
      const ul = make('ul', 'tg-tags');
      for (const s of this.sorted(list)) ul.append(this.tagRow(s));
      if (!list.length) ul.append(make('li', 'hint tg-empty', 'Drag tags here'));
      sec.append(ul);
      // Drag a tag onto a group to move it there.
      sec.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-tag')) { e.preventDefault(); sec.classList.add('drop'); } });
      sec.addEventListener('dragleave', (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('drop'); });
      sec.addEventListener('drop', async (e) => {
        e.preventDefault();
        sec.classList.remove('drop');
        const tag = e.dataTransfer.getData('text/x-tag');
        if (!tag) return;
        await moveTag(tag, g?.id || null);
        this.data = await getGroups();
        this.renderList();
      });
      return sec;
    };
    for (const g of groups) sheet.append(section(g, g.tags.map((t) => known.get(t)).filter(Boolean)));
    if (loose.length || !groups.length) sheet.append(section(null, loose));
  }

  tagRow(s) {
    const li = make('li', 'tg-tag');
    li.draggable = true;
    li.dataset.tag = s.tag;
    li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-tag', s.tag); e.dataTransfer.effectAllowed = 'move'; });
    const b = make('button', 'tg-name', `#${s.tag}`);
    b.addEventListener('click', () => this.go({ view: 'tags', tag: s.tag }));
    li.append(b, make('span', 'tg-count', s.count.toLocaleString()), make('span', 'tg-when', ago(s.last)));
    return li;
  }

  async sortWithClaude(stats, btn) {
    if (this.busy) return;
    if (!this.canAsk()) { this.toast('Sign in and connect to sort tags with Claude'); return; }
    this.busy = true;
    const was = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Claude is sorting your tags…';
    try {
      await askForGroups(this.ask, stats);
      this.data = await getGroups();
      if (this.place && !this.place.tag) this.renderList();
    } catch (e) {
      console.error(e);
      this.toast(e?.message && e.status ? e.message : 'Claude couldn’t sort your tags. Try again.');
      btn.disabled = false;
      btn.textContent = was;
    } finally { this.busy = false; }
  }

  async merge(froms, into) {
    const rows = [];
    for (const f of froms) {
      rows.push(...(await renameTag(f, into, this.by)));
      this.by = await tagIndex();
    }
    this.changed(rows);
    this.toast(`Merged into #${into}`);
    await this.show(this.place);
  }

  // ---- one tag ----
  async renderTag(tag) {
    this.walking = null;
    const rows = this.by.get(tag) || [];
    const token = this.token;
    const sheet = make('div');
    const back = make('button', 'crumb-part tg-back', '← All tags');
    back.addEventListener('click', () => this.go({ view: 'tags' }));
    sheet.append(back);
    const head = make('div', 'tg-head');
    head.append(make('h1', '', `#${tag}`), make('span', 'hint', rows.length ? `${plural(rows.length, 'thing')} · last used ${ago(rows[0].updated_at)}` : 'Nothing has this tag any more'));
    sheet.append(head);

    const bar = make('div', 'tg-bar');
    const walk = make('button', 'pill', 'Go through them one by one');
    walk.disabled = !rows.length;
    walk.addEventListener('click', () => this.go({ view: 'tags', tag, walk: 0 }));
    const renameBtn = make('button', 'ghost-btn', 'Rename or merge…');
    const groupSel = make('select');
    groupSel.setAttribute('aria-label', 'Group');
    const none = make('option', '', 'Not in a group');
    none.value = '';
    groupSel.append(none);
    for (const g of this.data.groups) { const o = make('option', '', g.name); o.value = g.id; groupSel.append(o); }
    groupSel.value = groupOf(this.data.groups, tag)?.id || '';
    groupSel.addEventListener('change', async () => { await moveTag(tag, groupSel.value || null); this.data = await getGroups(); });
    const groupLabel = make('label', 'lib-sort', 'Group ');
    groupLabel.append(groupSel);
    bar.append(walk, renameBtn, groupLabel);
    sheet.append(bar);

    // Rename, or merge when the new name is a tag already.
    const form = make('form', 'tg-rename');
    form.hidden = true;
    const input = make('input');
    input.setAttribute('aria-label', 'New name');
    input.placeholder = 'New name, or a tag to merge into';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('list', 'tg-all');
    const list = make('datalist');
    list.id = 'tg-all';
    for (const t of [...this.by.keys()].filter((t) => t !== tag).sort()) { const o = make('option'); o.value = t; list.append(o); }
    const go = make('button', 'pill', 'Rename');
    go.type = 'submit';
    const cancel = make('button', 'ghost-btn', 'Cancel');
    const say = () => { const t = cleanTag(input.value); go.textContent = t && this.by.has(t) && t !== tag ? `Merge into #${t}` : 'Rename'; go.disabled = !t || t === tag; };
    input.addEventListener('input', say);
    form.append(input, list, go, cancel);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const to = cleanTag(input.value);
      if (!to || to === tag) return;
      const merging = this.by.has(to);
      const changed = await renameTag(tag, to, this.by);
      this.changed(changed);
      this.toast(merging ? `Merged #${tag} into #${to}` : `Renamed #${tag} to #${to}`);
      this.go({ view: 'tags', tag: to }, { replace: true });
    });
    cancel.addEventListener('click', () => { form.hidden = true; });
    renameBtn.addEventListener('click', () => { form.hidden = false; input.value = tag; say(); input.focus(); input.select(); });
    sheet.append(form);

    const ul = make('ul', 'ref-list tg-items');
    const homes = await homesOf(rows.slice(0, 500));
    for (const r of rows.slice(0, 500)) {
      const li = make('li');
      const b = make('button', r.fields?.done ? 'done' : '');
      b.append(make('span', 'from', homes.get(r.id) || ''), make('span', 'line', r.text || ''));
      b.addEventListener('click', () => this.open(r.id));
      li.append(b);
      ul.append(li);
    }
    if (rows.length > 500) ul.append(make('li', 'hint', `and ${plural(rows.length - 500, 'more')}. Go through them to see every one.`));
    sheet.append(ul);
    if (token === this.token) this.sheet.replaceChildren(...sheet.childNodes);
  }

  // ---- going through a tag ----
  walkList(tag) {
    const rows = this.by.get(tag) || [];
    return this.skipDone ? rows.filter((r) => !r.fields?.done) : rows;
  }

  async renderWalk(tag, at) {
    const rows = this.walkList(tag);
    const i = Math.max(0, Math.min(at, rows.length));
    const token = this.token;
    const sheet = make('div');
    const commit = () => { if (token !== this.token) return; this.walking = { tag, i, rows }; this.sheet.replaceChildren(...sheet.childNodes); };
    const top = make('div', 'tg-walk-top');
    const back = make('button', 'crumb-part tg-back', `← #${tag}`);
    back.addEventListener('click', () => this.go({ view: 'tags', tag }));
    const skip = make('label', 'tg-skip');
    const box = make('input');
    box.type = 'checkbox';
    box.checked = this.skipDone;
    box.addEventListener('change', () => { this.skipDone = box.checked; this.go({ view: 'tags', tag, walk: 0 }, { replace: true }); });
    skip.append(box, document.createTextNode(' Skip ones marked done'));
    top.append(back, make('span', 'hint tg-progress', rows.length ? (i < rows.length ? `${i + 1} of ${rows.length}` : `${rows.length} of ${rows.length}`) : ''), skip);
    sheet.append(top);

    if (i >= rows.length) {
      const end = make('div', 'tg-card tg-end');
      end.append(make('h2', '', rows.length ? 'That’s all of them' : 'Nothing left to go through'), make('p', 'hint', rows.length ? `You’ve been through every #${tag}.` : this.skipDone ? 'Everything with this tag is marked done.' : ''));
      const again = make('button', 'ghost-btn', 'Start again');
      again.addEventListener('click', () => this.go({ view: 'tags', tag, walk: 0 }, { replace: true }));
      const done = make('button', 'pill', `Back to #${tag}`);
      done.addEventListener('click', () => this.go({ view: 'tags', tag }));
      end.append(again, done);
      sheet.append(end);
      return commit();
    }

    const r = rows[i];
    const card = make('article', 'tg-card' + (r.fields?.done ? ' done' : ''));
    const home = (await homesOf([r])).get(r.id);
    card.append(make('div', 'tg-from', [home, ago(r.updated_at)].filter(Boolean).join(' · ')));
    // A picture on the line shows big; the words and any link under it.
    const pic = (r.content || []).find((n) => n.type === 'file' && isImage(n.attrs?.type));
    if (pic) {
      const img = make('img', 'tg-pic');
      img.alt = '';
      fileUrl(pic.attrs.id).then((u) => { if (u) img.src = u; }).catch(() => img.remove());
      card.append(img);
    }
    card.append(make('p', 'tg-text', (r.text || '').trim()));
    const url = r.fields?.url;
    if (url) {
      const a = make('a', 'tg-link', url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80));
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      card.append(a);
    }
    // What's under it: Claude's summary, your notes.
    const kids = r.kind === 'line' ? (await children(r.id)).filter((k) => !k.deleted && (k.text || '').trim()).sort(bySort) : [];
    if (kids.length) {
      const ul = make('ul', 'tg-kids');
      for (const k of kids.slice(0, 12)) ul.append(make('li', k.fields?.by === CLAUDE || k._by === CLAUDE ? 'claude' : '', k.text.trim()));
      card.append(ul);
    }
    // Notes as you go: what you got from it, written as lines under it.
    let note = null;
    if (r.kind === 'line') {
      note = make('textarea', 'tg-note');
      note.rows = 3;
      note.placeholder = 'Notes on this… (they go under it, one line each)';
      note.setAttribute('aria-label', 'Notes on this');
      card.append(note);
      const base = Math.max(0, ...kids.map((k) => k.sort || 0));
      this.note = { el: note, parent: r.id, base, ids: [], timer: null };
      note.addEventListener('input', () => { note.style.height = 'auto'; note.style.height = `${note.scrollHeight + 2}px`; clearTimeout(this.note?.timer); if (this.note) this.note.timer = setTimeout(() => this.saveNote(), 600); });
      note.addEventListener('blur', () => this.saveNote());
    }
    sheet.append(card);

    const acts = make('div', 'tg-acts');
    const prev = make('button', 'ghost-btn', '← Back');
    prev.disabled = i === 0;
    prev.dataset.act = 'prev';
    prev.addEventListener('click', () => this.step(-1));
    const open = make('button', 'ghost-btn', 'Open it');
    open.addEventListener('click', () => this.open(r.id));
    acts.append(prev, open);
    if (r.kind === 'line') {
      const done = make('button', 'ghost-btn', r.fields?.done ? 'Not done' : 'Done ✓');
      done.dataset.act = 'done';
      done.addEventListener('click', () => this.toggleDone());
      acts.append(done);
    }
    const untag = make('button', 'ghost-btn', `Untag`);
    untag.title = `Take #${tag} off this one (it stays where it is)`;
    untag.dataset.act = 'untag';
    untag.addEventListener('click', () => this.untag());
    acts.append(untag);
    const next = make('button', 'pill', 'Keep, next →');
    next.dataset.act = 'next';
    next.addEventListener('click', () => this.step(1));
    acts.append(next);
    sheet.append(acts);
    sheet.append(make('p', 'hint tg-keys', 'Alt + Right arrow: next · Alt + Left arrow: back · Ctrl + Enter: done'));
    commit();
    if (note && token === this.token && !matchMedia('(hover: none)').matches) note.focus();
  }

  // The notes box, kept as lines under the item: one line per line typed.
  async saveNote() {
    const n = this.note;
    if (!n) return;
    clearTimeout(n.timer);
    const lines = n.el.value.split('\n').map((t) => t.trim()).filter(Boolean);
    const now = Date.now();
    const rows = [];
    lines.forEach((text, i) => {
      const id = n.ids[i] || (n.ids[i] = `${n.parent}-n${now.toString(36)}${i}`);
      rows.push({ ...entry('line', { id, parent_id: n.parent, sort: n.base + (i + 1) * GAP }), text, content: [{ type: 'text', text }], tags: tagsIn(text), fields: { done: false, gather: null, gathered: null, mirror: null }, updated_at: now });
    });
    for (const id of n.ids.slice(lines.length)) { const old = await getEntry(id); if (old && !old.deleted) rows.push({ ...old, deleted: true, updated_at: now }); }
    n.ids.length = lines.length;
    const key = JSON.stringify(lines);
    if (key === n.saved || !rows.length) { n.saved = key; return; }
    n.saved = key;
    await putEntries(rows);
    this.changed(rows);
  }

  step(by) {
    if (!this.walking) return;
    const { tag, i } = this.walking;
    this.go({ view: 'tags', tag, walk: Math.max(0, i + by) }, { replace: true });
  }

  async toggleDone() {
    const w = this.walking;
    const r = w?.rows[w.i];
    if (!r || r.kind !== 'line') return;
    const row = await getEntry(r.id);
    if (!row) return;
    const done = !row.fields?.done;
    const next = { ...row, fields: { ...row.fields, done }, updated_at: Date.now() };
    await putEntries([next]);
    this.changed([next]);
    // Marked done: on to the next one (when done ones are skipped, the next
    // one moves up into this place).
    this.go({ view: 'tags', tag: w.tag, walk: done && !this.skipDone ? w.i + 1 : w.i }, { replace: true });
  }

  async untag() {
    const w = this.walking;
    const r = w?.rows[w.i];
    const row = r && (await getEntry(r.id));
    if (!row) return;
    const next = withoutTag(row, w.tag);
    await putEntries([next]);
    this.changed([next]);
    this.toast(`Took #${w.tag} off`, { label: 'Undo', run: async () => { const back = { ...row, updated_at: Date.now() }; await putEntries([back]); this.changed([back]); this.go({ view: 'tags', tag: w.tag, walk: w.i }, { replace: true }); } });
    // It leaves this tag, so the next one moves up into its place.
    this.go({ view: 'tags', tag: w.tag, walk: w.i }, { replace: true });
  }

  key(e) {
    if (document.documentElement.dataset.view !== 'tags' || !this.walking || e.metaKey) return;
    const r = this.walking.rows[this.walking.i];
    // Alt + arrows and Ctrl + Enter work while writing notes; plain arrows and D when not.
    const typing = !!e.target.closest?.('input, select, textarea, [contenteditable="true"]');
    const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !typing;
    if (e.key === 'ArrowRight' && (e.altKey || plain)) { e.preventDefault(); this.step(1); }
    else if (e.key === 'ArrowLeft' && (e.altKey || plain)) { e.preventDefault(); this.step(-1); }
    else if (r && ((e.key === 'Enter' && e.ctrlKey && !e.altKey) || ((e.key === 'd' || e.key === 'D') && plain))) { e.preventDefault(); this.toggleDone(); }
  }
}
