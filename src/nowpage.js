// Now as a page (the zoom, Part 2, Nov 17 2026). On the ruler's middle stop
// the one thing is drawn the way any line looks when it is opened: a small
// where-line above (the project, which leads out to it), the line as the
// heading with a quiet circle for done, the piece it is for (the door), its
// notes and "Write a note". At the foot: "Not now" and "N more today".
//
// Whatever he clicks in Today, Week, Month or Year opens here. A line on today
// becomes the one thing; one from anywhere else is only visited (the place
// carries `line`): nothing moves until "Bring to today", and "Back to: the one
// thing" (or 4) comes home. The Now dot on the ruler is hollow while visiting.
//
// First light and Training are daily lines (fields.firstlight, fields.training):
// opened, they show the reading list or run the session, as before.

import { make } from './dom.js';
import { media } from './device.js';
import { popMenu } from './menu.js';
import { isTraining } from './training.js';
import { isLight, lineName } from './firstlight.js';

const hover = media('mouse');

// Ask the zoom to go somewhere, with its motion (zoom.js listens).
export const zoomTo = (detail) => document.dispatchEvent(new CustomEvent('inkwell:zoomto', { detail }));

// The first link in a line's words (what `whereOf` follows).
function firstLink(nodes) {
  for (const n of nodes || []) {
    if (n.type === 'entryRef' && n.attrs?.id) return n.attrs;
    const in_ = firstLink(n.content);
    if (in_) return in_;
  }
  return null;
}
// What a step is for: fields.task.for, else the first link that isn't its project.
export function forOf(i) {
  if (!i) return null;
  if (i.task?.for) return i.task.for;
  const link = firstLink(i.row.content);
  return link && link.id !== i.world?.id ? link.id : null;
}

// What the page shows: the line being visited, else the one thing.
export function pageTarget(now, m) {
  const id = now.p.lineId;
  const vis = id ? (now.p.items || []).find((i) => i.row.id === id && !i.ghost && !i.occ) : null;
  if (vis && !(m.cur && m.cur.item.row.id === id)) return { item: vis, visit: true };
  if (m.cur) return { item: m.cur.item, visit: false };
  return null;
}

const onToday = (i, today) => !i.row.fields?.done && !!i.task?.day && i.task.day <= today;

export function pageView(now, m) {
  const p = now.p;
  const t = pageTarget(now, m);
  const page = make('div', 'np');
  if (!t) {
    page.append(make('div', 'np-crumb', 'Today'));
    const hero = make('div', 'np-hero');
    hero.append(make('h1', 'np-tx quiet', m.dp.done.length ? 'Nothing else is lined up.' : 'Nothing is waiting today.'));
    page.append(hero);
    const foot = make('div', 'np-foot');
    if (now.morning(m)) foot.append(now.btn('talkday', 'Talk the day through', 'np-f', 'T'));
    if (now.evening()) foot.append(now.btn('closeday', 'Close the day', 'np-f', 'C'));
    foot.append(make('span', 'np-sp'), now.btn('np-today', 'See the day', 'np-f'));
    return [page, foot];
  }
  const i = t.item;
  const done = !!i.row.fields?.done;
  const light = isLight(i.row);
  const train = isTraining(i.row);
  const cur = !t.visit ? m.cur : null;

  // Where it lives: the project leads out to it.
  if (i.world) {
    const c = make('button', 'np-crumb go', i.world.title || 'Untitled');
    c.type = 'button';
    c.dataset.now = 'np-proj';
    c.title = 'Out to the project';
    page.append(c);
  } else {
    const at = light ? 'Every day' : train ? 'Every day but Sunday' : i.root?.kind === 'day' ? (i.task.day === p.today ? 'Today’s page' : 'A day page') : i.root?.title || 'Tasks';
    page.append(make('div', 'np-crumb', at));
  }

  const hero = make('div', 'np-hero');
  const tick = make('button', `np-tick${done ? ' on' : ''}`);
  tick.type = 'button';
  tick.dataset.now = 'np-done';
  tick.setAttribute('aria-label', done ? 'Not done' : 'Done');
  if (hover.matches) tick.title = done ? 'Not done (D)' : 'Done (D)';
  const tx = make('h1', `np-tx${done ? ' isdone' : ''}`, lineName(i.row));
  tx.dataset.task = i.row.id;
  hero.append(tick, tx);
  page.append(hero);

  // First light and Training: what they hold, run here as before.
  if (light && !done) {
    const k = make('div', 'np-kind');
    k.append(now.light.view({ bare: true }));
    page.append(k);
  } else if (train && cur && now.train.active(cur)) {
    // (The session draws its own Not now choices.)
    const k = make('div', 'np-kind');
    k.append(now.train.view(cur));
    page.append(k);
  } else if (!light && !train) page.append(doorBox(now, i));

  // Its notes, and one more.
  const notes = make('div', 'np-notes');
  if (i.notes) notes.append(p.kidsBox(i.row.id));
  if (!light && !train) notes.append(noteForm(now, i.row.id));
  if (notes.childElementCount) page.append(notes);

  if (now.asking && cur && !(train && now.train.active(cur))) page.append(now.choices(cur));

  const foot = make('div', 'np-foot');
  if (t.visit) {
    if (!onToday(i, p.today) && !done && !light && !train) foot.append(now.btn('np-bring', 'Bring to today', 'np-f strong', 'B'));
    foot.append(make('span', 'np-at', onToday(i, p.today) ? 'On today' : whenSaid(p, i)));
    foot.append(make('span', 'np-sp'));
    if (m.cur) {
      const b = now.btn('np-home', `Back to: ${clip(m.cur.name, 40)}`, 'np-f');
      if (hover.matches) b.title = 'Back to the one thing (4)';
      foot.append(b);
    }
  } else {
    if (!now.asking) {
      const nn = now.btn('notnow', 'Not now', 'np-f', 'N');
      foot.append(nn);
    }
    foot.append(make('span', 'np-sp'));
    const ev = m.upcoming || null;
    const more = now.btn('np-today', `${m.more ? `${m.more} more today` : 'Nothing else today'}${ev ? ` · ${evWord(ev)}` : ''}`, 'np-f');
    if (hover.matches) more.title = 'The rest of today (Esc)';
    foot.append(more);
  }
  return [page, foot];
}

const clip = (t, n = 60) => { const s = String(t || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled'; return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
function evWord(e) {
  const mins = Math.round((e.start - Date.now()) / 6e4);
  if (mins <= 45) return `${e.title} in ${mins} minute${mins === 1 ? '' : 's'}`;
  const d = new Date(e.start);
  return `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, ' ')} ${e.title}`;
}
// Where a visited line is in time, in words.
function whenSaid(p, i) {
  const d = i.task?.day;
  if (i.row.fields?.done) return 'Done';
  if (d) {
    const dt = new Date(`${d}T12:00`);
    return d < p.today ? 'From an earlier day' : dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }
  const sp = i.task?.span;
  if (sp?.kind === 'week') return 'Any day that week';
  if (sp?.kind === 'month') return 'Sometime that month';
  if (sp?.kind === 'later') return 'Sometime this year';
  return 'Not planned';
}

// The door: the piece or page a step is for, by its last lines. Click, Enter
// or Right arrow: into the text with the cursor at the end.
function doorBox(now, i) {
  const p = now.p;
  const box = make('div', 'np-doorbox');
  const id = forOf(i);
  if (id) {
    const door = make('button', 'np-door');
    door.type = 'button';
    door.dataset.now = 'np-door';
    door.dataset.id = id;
    door.title = hover.matches ? 'Into the text (Enter)' : 'Into the text';
    const h = make('span', 'np-door-h');
    const name = make('b', '', '…');
    const kind = make('em', '', '');
    h.append(name, kind);
    const words = make('span', 'np-door-tx');
    const go = make('span', 'np-door-go', 'Write here');
    if (hover.matches) go.append(make('kbd', '', 'Enter'));
    door.append(h, words, go);
    box.append(door);
    p.hooks.doorOf?.(id).then((d) => {
      if (!d) { box.replaceChildren(); return; }
      name.textContent = d.name;
      kind.textContent = [d.kind, d.size].filter(Boolean).join(' · ');
      if (d.last.length) for (const l of d.last) words.append(make('span', l.head ? 'h' : '', clip(l.text, 140)));
      else { words.append(make('span', 'empty', 'Not started yet.')); go.firstChild.textContent = 'Begin'; }
    }).catch(() => box.replaceChildren());
    return box;
  }
  // Nothing tied: in a project with pieces, a quiet way to tie it.
  if (i.world && !i.row.fields?.done) {
    const tie = make('button', 'np-tie', '+ Tie to a piece');
    tie.type = 'button';
    tie.dataset.now = 'np-tie';
    tie.hidden = true;
    box.append(tie);
    p.hooks.piecesOf?.(i.world.id).then((list) => { if (list?.length) tie.hidden = false; }).catch(() => {});
  }
  return box;
}

export async function tieMenu(now, i, anchor) {
  const list = (await now.p.hooks.piecesOf?.(i.world?.id)) || [];
  if (!list.length) return;
  popMenu(anchor, list.map((pc) => ({ label: pc.name, sub: pc.kind, run: () => now.tie(i.row.id, pc.id) })));
}

// "Write a note": a line under it, and the box stays for the next.
function noteForm(now, id) {
  const form = make('form', 'np-noteform');
  const input = make('input', 'np-notein');
  input.type = 'text';
  input.placeholder = 'Write a note';
  input.setAttribute('aria-label', 'Write a note under it');
  input.autocomplete = 'off';
  input.enterKeyHint = 'done';
  input.id = `np-note-${id}`;
  form.append(input);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    now.run(async () => { await now.p.hooks.addNote?.(id, text); await now.p.refresh(); now.p.sheet.querySelector(`#np-note-${id}`)?.focus({ preventScroll: true }); });
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; input.blur(); e.stopPropagation(); } });
  return form;
}
