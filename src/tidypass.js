import { getEntry, children, putEntries, byKind } from './db.js';
import { GAP, bySort } from './order.js';
import { tagsIn } from './model.js';
import { trash, restore } from './trash.js';
import { fileInto, unfile, intoDrawer, outOfDrawer } from './stages.js';
import { renameTag, tagIndex, cleanTag } from './tags.js';

// Claude's tidy pass. Early each Monday Claude looks over how things are kept
// and suggests a few tidy-ups (two Christmas worlds that are one, a line that
// belongs on a bible page, an idea for the Drawer, two tags that mean the
// same). Nothing changes until you tick yes, and every yes can be undone.
// Claude can also suggest some from a chat, and you can ask for a pass now.
//
// The same place lists what Claude changed itself through the connector
// (ticked a line done, moved a line, made a world a life project), each with
// an Undo. Nothing here ever removes writing: merging moves everything across
// and puts the emptied world in the Trash, where Restore brings it back.
//
// Suggestions come in batches, entries of kind 'tidy' made by the server;
// yes, no and how to undo are kept on them, so every device agrees. Claude's
// changes are entries of kind 'change'.

const WRITTEN = ['line', 'para', 'heading', 'scene', 'note'];
const gone = (r) => !r || r.deleted || r.fields?.trashed;
const shown = (s, n = 70) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const DAY = 864e5;
const fail = (message) => Object.assign(new Error(message), { quiet: true });

// ---------- reading ----------

/** Live batches, newest first. */
export async function batches() {
  return (await byKind('tidy')).filter((b) => !b.deleted && Array.isArray(b.fields?.tidy?.items))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/**
 * What the pass shows: every suggestion still waiting (from the last eight
 * weeks), and ones decided in the last two weeks (so they can be undone).
 */
export async function suggestions(now = Date.now()) {
  const out = [];
  const seen = new Set();
  for (const b of await batches()) {
    const at = Date.parse(b.fields.tidy.at) || b.created_at || now;
    b.fields.tidy.items.forEach((item, i) => {
      if (seen.has(item.key)) return;
      seen.add(item.key);
      const fresh = item.choice ? now - (item.at || at) < 14 * DAY : now - at < 56 * DAY;
      if (fresh) out.push({ batch: b.id, i, item });
    });
  }
  return out;
}

export const waiting = (list) => list.filter((s) => !s.item.choice).length;

/** What Claude changed itself, newest first (the last 60 days). */
export async function claudeChanges(now = Date.now()) {
  return (await byKind('change')).filter((r) => !r.deleted && r.fields?.change && now - (Date.parse(r.fields.change.at) || 0) < 60 * DAY)
    .sort((a, b) => (a.fields.change.at < b.fields.change.at ? 1 : -1));
}

// ---------- doing and undoing ----------

async function live(id, what = 'That') {
  const r = await getEntry(id);
  if (gone(r)) throw fail(`${what} isn’t there any more (it may be in the Trash).`);
  return r;
}

async function hasWords(id) {
  let level = [id];
  for (let d = 0; level.length && d < 40; d++) {
    const kids = [];
    for (const pid of level) kids.push(...(await children(pid)).filter((r) => !gone(r)));
    if (kids.some((r) => WRITTEN.includes(r.kind) && (r.text || '').trim())) return true;
    level = kids.map((r) => r.id);
  }
  return false;
}

const tagRe = (tag) => new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'giu');
// Swaps one tag for another in these rows' words, and only that.
function swapTag(row, from, to) {
  const re = tagRe(from);
  const swap = (s) => (typeof s === 'string' ? s.replace(re, `$1#${to}`) : s);
  const nodes = (ns) => (ns || []).map((n) => ({ ...n, ...(n.text != null ? { text: swap(n.text) } : {}), ...(n.content ? { content: nodes(n.content) } : {}) }));
  const text = swap(row.text || '');
  return { ...row, text, content: row.content ? nodes(row.content) : row.content, tags: tagsIn(text), updated_at: Date.now() };
}

// Each kind of suggestion: what yes does, returning the rows it changed and
// what undo needs; and what undo does.
const DO = {
  async merge(it) {
    const a = await live(it.a, 'The one to empty');
    const b = await live(it.b, 'The one to keep');
    if (a.kind !== b.kind) throw fail('Those two aren’t the same kind of thing any more.');
    const kids = (await children(a.id)).filter((r) => !gone(r)).sort(bySort);
    const there = (await children(b.id)).filter((r) => !gone(r));
    let sort = there.reduce((m, r) => Math.max(m, r.sort || 0), 0);
    const now = Date.now();
    const moved = kids.map((r) => ({ ...r, parent_id: b.id, sort: (sort += GAP), ...(r.kind === 'project' && b.kind === 'world' ? { area_id: b.area_id } : {}), updated_at: now }));
    await putEntries(moved);
    await trash(await getEntry(a.id));
    return { rows: [...moved, await getEntry(a.id)], undo: { moved: kids.map((r) => ({ id: r.id, parent_id: r.parent_id, sort: r.sort, area_id: r.area_id ?? null })) } };
  },
  async unmerge(it, undo) {
    await restore(it.a);
    const now = Date.now();
    const rows = [];
    for (const m of undo.moved || []) {
      const r = await getEntry(m.id);
      if (r && !r.deleted && r.parent_id === it.b) rows.push({ ...r, parent_id: m.parent_id, sort: m.sort, ...(r.kind === 'project' ? { area_id: m.area_id } : {}), updated_at: now });
    }
    await putEntries(rows);
    return [...rows, await getEntry(it.a)];
  },
  async trash_empty(it) {
    const a = await live(it.a);
    if (await hasWords(a.id)) throw fail(`“${shown(a.title)}” has writing in it now, so it stays.`);
    await trash(a);
    return { rows: [await getEntry(a.id)], undo: {} };
  },
  async untrash_empty(it) { await restore(it.a); return [await getEntry(it.a)]; },
  async file(it) {
    await live(it.a, 'The line');
    await live(it.b, 'Where it was going');
    const rows = await fileInto(it.a, it.b);
    if (!rows.length) throw fail('It’s filed there already.');
    return { rows, undo: { page: rows[2]?.id || it.b } };
  },
  async unfile(it, undo) { return unfile(it.a, undo.page || it.b); },
  async drawer(it) {
    await live(it.a, 'The line');
    return { rows: await intoDrawer(it.a), undo: {} };
  },
  async undrawer(it) { return outOfDrawer(it.a); },
  async tags(it) {
    const from = cleanTag(it.a), to = cleanTag(it.b);
    const by = await tagIndex();
    if (!by.get(from)?.length) throw fail(`Nothing carries #${from} any more.`);
    const rows = await renameTag(from, to, by);
    return { rows, undo: { ids: rows.map((r) => r.id) } };
  },
  async untags(it, undo) {
    const from = cleanTag(it.a), to = cleanTag(it.b);
    const rows = [];
    for (const id of undo.ids || []) {
      const r = await getEntry(id);
      if (r && !r.deleted && (r.tags || []).includes(to)) rows.push(swapTag(r, to, from));
    }
    await putEntries(rows);
    return rows;
  },
  async life(it, _undo, hooks) {
    const w = await live(it.a, 'The world');
    if (w.fields?.life) return { rows: [], undo: { was: true } };
    await hooks.setLife(w, true);
    const now = await getEntry(w.id);
    if (!now.fields?.life) throw fail('Left as it is.');
    return { rows: [now], undo: { was: false } };
  },
  async unlife(it, undo, hooks) {
    if (undo.was) return [];
    const w = await getEntry(it.a);
    if (w && !gone(w)) await hooks.setLife(w, false);
    return [await getEntry(it.a)];
  },
  async area(it) {
    const w = await live(it.a, 'The world');
    await live(it.b, 'The area');
    const row = { ...w, area_id: it.b, updated_at: Date.now() };
    await putEntries([row]);
    return { rows: [row], undo: { area_id: w.area_id ?? null } };
  },
  async unarea(it, undo) {
    const w = await getEntry(it.a);
    if (!w || w.area_id !== it.b) return [];
    const row = { ...w, area_id: undo.area_id, updated_at: Date.now() };
    await putEntries([row]);
    return [row];
  },
  async rename(it) {
    const r = await live(it.a);
    const row = { ...r, title: it.text, updated_at: Date.now() };
    await putEntries([row]);
    return { rows: [row], undo: { title: r.title } };
  },
  async unrename(it, undo) {
    const r = await getEntry(it.a);
    if (!r || r.title !== it.text) return [];
    const row = { ...r, title: undo.title, updated_at: Date.now() };
    await putEntries([row]);
    return [row];
  }
};
const UNDO = { merge: 'unmerge', trash_empty: 'untrash_empty', file: 'unfile', drawer: 'undrawer', tags: 'untags', life: 'unlife', area: 'unarea', rename: 'unrename' };

async function saveItem(batchId, i, change) {
  const b = await getEntry(batchId);
  if (!b?.fields?.tidy?.items?.[i]) return null;
  const items = b.fields.tidy.items.map((x, j) => (j === i ? { ...x, ...change } : x));
  const row = { ...b, fields: { ...b.fields, tidy: { ...b.fields.tidy, items } }, updated_at: Date.now() };
  await putEntries([row]);
  return row;
}

/** Yes (does it) or no (leaves it, and Claude won't suggest it again). Returns the rows changed. */
export async function decide(batchId, i, choice, hooks) {
  const b = await getEntry(batchId);
  const it = b?.fields?.tidy?.items?.[i];
  if (!it || it.choice) return [];
  await hooks.flush?.();
  let rows = [];
  let undo = null;
  if (choice === 'yes') {
    const did = await DO[it.type](it, null, hooks);
    rows = did.rows;
    undo = did.undo;
  }
  const saved = await saveItem(batchId, i, { choice, at: Date.now(), undo });
  return [...rows, saved].filter(Boolean);
}

/** Takes a yes or a no back: what yes did is undone, and the suggestion waits again. */
export async function takeBack(batchId, i, hooks) {
  const b = await getEntry(batchId);
  const it = b?.fields?.tidy?.items?.[i];
  if (!it?.choice) return [];
  await hooks.flush?.();
  const rows = it.choice === 'yes' ? await DO[UNDO[it.type]](it, it.undo || {}, hooks) : [];
  const saved = await saveItem(batchId, i, { choice: null, at: null, undo: null });
  return [...rows, saved].filter(Boolean);
}

/** Undoes one of Claude's own changes, unless you've changed that thing since. */
export async function undoChange(id, hooks) {
  const cx = await getEntry(id);
  const c = cx?.fields?.change;
  if (!c || c.undone_at) return [];
  await hooks.flush?.();
  const r = await getEntry(c.target);
  if (gone(r)) throw fail('What it changed is in the Trash now.');
  const rows = [];
  if (c.type === 'done') {
    if (!!r.fields?.done !== !!c.after.done) throw fail('You’ve changed it since, so it stays as you have it.');
    rows.push({ ...r, fields: { ...r.fields, done: !!c.before.done }, updated_at: Date.now() });
  } else if (c.type === 'move') {
    if (r.parent_id !== c.after.parent_id) throw fail('You’ve moved it since, so it stays where it is.');
    const home = await getEntry(c.before.parent_id);
    if (gone(home)) throw fail('Where it came from is in the Trash now.');
    rows.push({ ...r, parent_id: c.before.parent_id, sort: c.before.sort ?? r.sort, updated_at: Date.now() });
  } else if (c.type === 'life') {
    if (!!r.fields?.life !== !!c.after.life) throw fail('You’ve changed it since, so it stays as you have it.');
    await hooks.setLife(r, !!c.before.life);
    rows.push(await getEntry(r.id));
  }
  if (rows.length && c.type !== 'life') await putEntries(rows);
  const mark = { ...cx, fields: { ...cx.fields, change: { ...c, undone_at: new Date().toISOString(), undone_by: 'me' } }, updated_at: Date.now() };
  await putEntries([mark]);
  return [...rows, mark];
}

// ---------- the panel ----------

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (tag === 'button') el.type = 'button';
  return el;
};
const when = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / DAY);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
  return days === 0 ? `Today ${time}` : days === 1 ? `Yesterday ${time}` : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const DONE = { merge: 'Merged', trash_empty: 'In the Trash', file: 'Filed', drawer: 'In the Drawer', tags: 'Folded in', life: 'A life project now', area: 'Moved', rename: 'Renamed' };

const SEEN = 'tidySeen';
const seenAt = () => { try { return Number(localStorage.getItem(SEEN)) || 0; } catch { return 0; } };

/** How many suggestions wait, and how many changes by Claude came since the pass was last opened here. */
export async function counts() {
  const list = await suggestions();
  const since = seenAt();
  const fresh = (await claudeChanges()).filter((r) => !r.fields.change.undone_at && Date.parse(r.fields.change.at) > since).length;
  return { waiting: waiting(list), changes: fresh };
}

/**
 * Opens the pass. hooks: flush() saves anything being typed; setLife(world, on);
 * onRows(rows) shows changed rows; open(id) opens a line or page; ask() asks
 * for a pass now (resolves when its batch is here); canAsk(); toast(text).
 */
export async function openTidy(hooks) {
  document.querySelector('.tp-backdrop')?.remove();
  try { localStorage.setItem(SEEN, String(Date.now())); } catch { /* full */ }
  const back = make('div', 'ask-backdrop tp-backdrop');
  const box = make('div', 'ask ck tp');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Tidy pass');
  back.append(box);
  document.body.append(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); hooks.onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  let busy = false;

  const act = async (fn) => {
    if (busy) return;
    busy = true;
    box.classList.add('busy');
    try {
      const rows = await fn();
      if (rows?.length) await hooks.onRows(rows);
    } catch (e) {
      if (!e.quiet) console.error(e);
      hooks.toast(e.message || 'Couldn’t do that. Try again.');
    } finally {
      busy = false;
      box.classList.remove('busy');
      await draw();
    }
  };

  const draw = async () => {
    const list = await suggestions();
    const changes = await claudeChanges();
    const scroll = box.scrollTop;
    box.replaceChildren();
    const head = make('div', 'ck-head');
    head.append(make('h2', '', 'Tidy pass'), Object.assign(make('button', 'ghost-btn ck-close', '✕'), { title: 'Close (Esc)', onclick: close }));
    box.append(head);
    const left = waiting(list);
    box.append(make('p', 'ck-lead', left
      ? `Claude has ${left === 1 ? 'one tidy-up' : `${left} tidy-ups`} for you. Nothing changes until you say yes, and anything can be undone.`
      : 'Nothing waiting. Claude looks things over early each Monday.'));

    if (list.length) {
      const sec = make('section', 'tp-list');
      for (const { batch, i, item } of list) {
        const card = make('div', `tp-card${item.choice ? ' decided' : ''}`);
        card.dataset.key = item.key;
        card.append(make('div', 'tp-title', item.title));
        if (item.choice) {
          const row = make('div', 'tp-outcome');
          row.append(make('span', '', item.choice === 'yes' ? DONE[item.type] || 'Done' : 'Left as it is'));
          const u = make('button', 'ghost-btn tp-undo', 'Undo');
          u.onclick = () => act(() => takeBack(batch, i, hooks));
          row.append(u);
          card.append(row);
        } else {
          if (item.why) card.append(make('div', 'tp-why', item.why));
          const row = make('div', 'tp-actions');
          const yes = make('button', 'pill primary tp-yes', 'Yes');
          yes.onclick = () => act(() => decide(batch, i, 'yes', hooks));
          const no = make('button', 'pill tp-no', 'No');
          no.title = 'Leave it; Claude won’t suggest it again';
          no.onclick = () => act(() => decide(batch, i, 'no', hooks));
          row.append(yes, no);
          if (['file', 'drawer'].includes(item.type) && item.a) {
            const see = make('button', 'ghost-btn tp-see', 'See the line');
            see.onclick = () => { close(); hooks.open(item.a); };
            row.append(see);
          }
          card.append(row);
        }
        sec.append(card);
      }
      box.append(sec);
    }

    const ask = make('div', 'ck-actions tp-ask');
    const more = make('button', 'ghost-btn', 'Ask Claude to look things over now');
    more.disabled = !hooks.canAsk();
    more.title = hooks.canAsk() ? 'Claude reads how things are kept and suggests tidy-ups (a minute or so)' : 'Needs you online and signed in';
    more.onclick = async () => {
      if (busy) return;
      busy = true;
      more.textContent = 'Claude is looking things over…';
      more.disabled = true;
      try {
        const n = await hooks.ask();
        hooks.toast(n ? `Claude has ${n === 1 ? 'one more tidy-up' : `${n} more tidy-ups`}` : 'Claude found nothing more to tidy');
      } catch (e) {
        console.error(e);
        hooks.toast(e.message || 'Couldn’t reach Claude. Try again.');
      } finally {
        busy = false;
        await draw();
      }
    };
    ask.append(more);
    box.append(ask);

    if (changes.length) {
      const sec = make('section', 'tp-changes');
      sec.append(make('h3', '', 'What Claude changed'));
      for (const r of changes) {
        const c = r.fields.change;
        const row = make('div', `tp-change${c.undone_at ? ' undone' : ''}`);
        const words = make('div', 'tp-ch-words');
        words.append(make('span', 'tp-ch-title', c.title), make('span', 'tp-ch-when', ` · ${when(c.at)}`));
        if (c.why) words.append(make('div', 'tp-why', c.why));
        row.append(words);
        if (c.undone_at) row.append(make('span', 'tp-ch-state', c.undone_by === 'claude' ? 'Undone by Claude' : 'Undone'));
        else {
          const u = make('button', 'ghost-btn tp-undo', 'Undo');
          u.onclick = () => act(() => undoChange(r.id, hooks));
          row.append(u);
        }
        sec.append(row);
      }
      box.append(sec);
    }
    box.scrollTop = scroll;
  };
  box.redraw = draw;
  await draw();
  box.querySelector('.tp-yes, button')?.focus();
  return box;
}

/** Redraws an open pass (rows came from another device). */
export function redrawTidy() { document.querySelector('.tp-backdrop .tp')?.redraw?.(); }
