// The zoom, Part 4 (Nov 2026): where a project sits. Four seats: on stage,
// in the wings, backstage and finished. A bar with the four seats comes up
// right above the ruler:
// - while a project is carried (a Desk box, a wings chip, a Library row):
//   drop it on a seat;
// - as a menu: right-click a project (on a phone: hold and let go), click
//   its seat word (a Library row, the project's own page), or Alt + S on a
//   project; then a click, or 1 to 4.
// On stage, in the wings and backstage are the Desk's own seats (settings-desk
// fields.stage). Finished is the finish flow he already has (the closing
// question, the Finished shelf), and taking a project off the shelf reopens
// it. Every move says so, with Undo.
import { make } from '../dom.js';
import { getEntry } from '../db.js';
import { deskSettings, saveDeskSettings, seatsFor } from '../desk.js';
import { toast } from '../menu.js';
import { isFinished } from '../library.js';
import { zoomOn } from '../zoomstate.js';
import { finishWorld, setFinished, refreshViews } from './tidying.js';
import { deskPage, projectPage } from './talking.js';
import { $, state, view } from '../main.js';
import { applyRemote } from './syncwiring.js';

export const SEATS = [['on', 'On stage'], ['wings', 'In the wings'], ['back', 'Backstage'], ['done', 'Finished']];
export const seatWord = (s) => (SEATS.find(([k]) => k === s) || SEATS[2])[1];

// Every project's seat: id → 'on' | 'wings' | 'back' | 'done'.
export async function seatMap() {
  const { worlds, settings } = await deskPage.seating();
  const data = deskPage.data || { needs: [], updates: [] };
  const seats = seatsFor({ worlds, needs: data.needs, updates: data.updates, settings, now: Date.now(), keepDone: true });
  const map = new Map();
  for (const s of seats) if (s.world) map.set(s.world.id, s.world.done ? 'done' : s.stage);
  return map;
}
export async function seatOf(id) { return (await seatMap()).get(id) || 'back'; }

// Put a project in a seat. Finished goes through the finish flow (it asks).
export async function setSeat(id, seat, { quiet = false } = {}) {
  const w = await getEntry(id);
  if (!w) return;
  const name = w.title || 'Untitled';
  const was = await seatOf(id);
  if (was === seat) { if (!quiet) toast(`“${name}” is already ${seat === 'done' ? 'finished' : seatWord(seat).toLowerCase()}`); return; }
  if (seat === 'done') { await finishWorld(w); await after(); return; }
  const settings = await deskSettings();
  const key = `w:${id}`;
  const before = { pin: settings.stage[key] ?? null, finished: isFinished(w) ? w.fields.finished : null };
  if (before.finished) await setFinished(w, null);
  const rows = [await saveDeskSettings({ stage: { ...settings.stage, [key]: seat } })];
  await applyRemote(rows);
  await after();
  if (quiet) return;
  toast(`“${name}” is ${seat === 'on' ? 'on stage' : seatWord(seat).toLowerCase()}${before.finished ? ', open again' : ''}`, {
    label: 'Undo',
    run: async () => {
      const now = await deskSettings();
      const stage = { ...now.stage };
      if (before.pin) stage[key] = before.pin; else delete stage[key];
      await applyRemote([await saveDeskSettings({ stage })]);
      if (before.finished) await setFinished(await getEntry(id), before.finished);
      await after();
    }
  });
}
// Everything that shows a seat draws again.
async function after() {
  projectPage?.stale?.();
  deskPage.ordered?.();
  if (view() === 'desk') await deskPage.refresh();
  await refreshViews();
  bar.refresh();
}

// Put a project just before another one on the Desk, in that one's seat.
export async function placeBefore(id, beforeId) {
  if (id === beforeId) return;
  const [settings, map] = [await deskSettings(), await seatMap()];
  const seat = map.get(beforeId) || 'on';
  const shown = [...document.querySelectorAll('.zd-proj[data-pid], .zd-wings [data-pid]')].map((x) => x.dataset.pid);
  const keys = [...new Set([...shown, ...(settings.order?.seats || []).map((k) => k.replace(/^w:/, ''))])].filter((x) => x !== id);
  keys.splice(Math.max(0, keys.indexOf(beforeId)), 0, id);
  const order = { ...(settings.order || {}), seats: keys.map((x) => (x.includes(':') ? x : `w:${x}`)) };
  const next = { order };
  if (map.get(id) !== seat && seat !== 'done') next.stage = { ...settings.stage, [`w:${id}`]: seat };
  await applyRemote([await saveDeskSettings(next)]);
  await after();
}

// ---------- the bar ----------

class SeatBar {
  constructor() {
    this.el = null;
    this.id = null; // the project the bar is for
    this.carrying = null; // the project being dragged
  }
  build() {
    if (this.el) return this.el;
    const el = make('div', 'zm-seatbar');
    el.hidden = true;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Where this project sits');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-seat]');
      if (b && this.id) { const id = this.id; this.close(); setSeat(id, b.dataset.seat); return; }
      if (e.target.closest('[data-sb="x"]')) this.close();
    });
    // While carrying: a seat lights up under the pointer, and takes the drop.
    el.addEventListener('dragover', (e) => {
      const b = e.target.closest('[data-seat]');
      if (!b || !this.carrying) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
      b.classList.add('over');
    });
    el.addEventListener('dragleave', (e) => e.target.closest?.('[data-seat]')?.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      const b = e.target.closest('[data-seat]');
      const id = this.carrying || e.dataTransfer.getData('text/x-project');
      if (!b || !id) return;
      e.preventDefault();
      this.carrying = null;
      this.close();
      setSeat(id, b.dataset.seat);
    });
    document.body.append(el);
    this.el = el;
    return el;
  }
  async draw(id, { carrying = false } = {}) {
    const el = this.build();
    const w = await getEntry(id);
    if (!w) return;
    const seat = await seatOf(id);
    const name = make('b', 'zm-sb-name', w.title || 'Untitled');
    const btns = SEATS.map(([k, label], i) => {
      const b = make('button', 'zm-sb', label);
      b.type = 'button';
      b.dataset.seat = k;
      b.title = `${label} (${i + 1})`;
      if (k === seat) b.setAttribute('aria-current', 'true');
      return b;
    });
    const x = make('button', 'zm-sb zm-sb-x', '✕');
    x.type = 'button';
    x.dataset.sb = 'x';
    x.setAttribute('aria-label', 'Close (Esc)');
    el.replaceChildren(name, ...btns, x);
    el.classList.toggle('carrying', carrying);
    el.hidden = false;
    document.documentElement.classList.add('zm-seating');
  }
  async open(id) {
    if (!zoomOn() || !id) return;
    this.id = id;
    await this.draw(id);
    this.el.querySelector('[aria-current]')?.focus({ preventScroll: true });
  }
  close() {
    this.id = null;
    if (!this.el) return;
    this.el.hidden = true;
    this.el.classList.remove('carrying');
    this.el.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
    document.documentElement.classList.remove('zm-seating');
  }
  refresh() { if (this.id && this.el && !this.el.hidden) this.draw(this.id); }
  carry(id) { this.carrying = id; this.id = id; this.draw(id, { carrying: true }); }
  dropped() { if (!this.carrying) return; this.carrying = null; setTimeout(() => { if (!this.carrying) this.close(); }, 0); }
  key(e) {
    if (!this.el || this.el.hidden || !this.id) return false;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return true; }
    const n = Number(e.key);
    if (n >= 1 && n <= 4 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      const id = this.id;
      this.close();
      setSeat(id, SEATS[n - 1][0]);
      return true;
    }
    return false;
  }
}
export const bar = new SeatBar();

// The project a key or a menu is about: the one on screen, else the one the
// pointer or the focus is on.
let hovered = null;
function projectHere() {
  const el = document.activeElement?.closest?.('[data-pid]') || hovered;
  if (el?.isConnected && el.dataset.pid) return el.dataset.pid;
  if (['world', 'project', 'write', 'grid', 'production', 'deliver', 'stage', 'compare'].includes(view())) return state.worldId || null;
  return null;
}

export function wireSeats() {
  bar.build();
  document.addEventListener('pointerover', (e) => { const el = e.target.closest?.('[data-pid]'); if (el) hovered = el; }, true);
  // Alt + S: this project's seat. Then 1 to 4.
  document.addEventListener('keydown', (e) => {
    if (bar.key(e)) return;
    if (!zoomOn() || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyS') return;
    const id = projectHere();
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    bar.open(id);
  }, true);
  // A seat word anywhere opens the bar.
  document.addEventListener('click', (e) => {
    const w = e.target.closest?.('[data-seatfor]');
    if (w && zoomOn()) { e.preventDefault(); e.stopPropagation(); bar.open(w.dataset.seatfor); return; }
    if (bar.el && !bar.el.hidden && !bar.carrying && !e.target.closest('.zm-seatbar')) bar.close();
  }, true);
  // Right-click a project (a phone's hold sends the same): the bar as a menu.
  document.addEventListener('contextmenu', (e) => {
    if (!zoomOn()) return;
    const el = e.target.closest?.('[data-pid]');
    if (!el || e.target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    e.preventDefault();
    e.stopPropagation();
    bar.open(el.dataset.pid);
  }, true);
  // Carrying a project: the bar comes up to take it.
  document.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.('[data-pid][draggable="true"]');
    if (!el || !zoomOn()) return;
    e.dataTransfer.setData('text/x-project', el.dataset.pid);
    e.dataTransfer.effectAllowed = 'move';
    bar.carry(el.dataset.pid);
  });
  document.addEventListener('dragend', () => { bar.dropped(); clearOver(); }, true);
  // On the Desk: dropped on another project, it goes just before that one,
  // in its seat; dropped on the stage or the wings row, it sits there.
  const target = (e) => {
    const zone = e.target.closest?.('.zd-projs, .zd-wings, .zl-stage, .zl-area');
    if (!zone || !bar.carrying) return null;
    const on = e.target.closest('[data-pid]');
    return { zone, on: on && on.dataset.pid !== bar.carrying ? on : null };
  };
  const clearOver = () => document.querySelectorAll('.zm-dropon-p').forEach((x) => x.classList.remove('zm-dropon-p'));
  document.addEventListener('dragover', (e) => {
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearOver();
    (t.on || t.zone).classList.add('zm-dropon-p');
  });
  document.addEventListener('drop', (e) => {
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    const id = bar.carrying;
    bar.carrying = null;
    bar.close();
    clearOver();
    if (t.on && t.zone.matches('.zd-projs, .zd-wings')) placeBefore(id, t.on.dataset.pid);
    else if (t.zone.dataset.seat) setSeat(id, t.zone.dataset.seat);
  });
  document.addEventListener('inkwell:layout', () => bar.close());
}

export const seatBar = () => $('.zm-seatbar');
