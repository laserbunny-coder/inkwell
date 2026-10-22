import { conflicts, dropConflict, getEntry, putEntries } from './db.js';
import { newId } from './model.js';
import { ask } from './menu.js';
import { rootOf, titleOf } from './notebook.js';

// "Two versions": when the same paragraph or line was changed on two devices
// while they were apart, this device's version was kept and the other saved
// aside. This panel shows both, side by side, and lets you keep either one or
// both.

const $ = (s) => document.querySelector(s);
const words = (e) => (e ? (e.deleted ? '' : e.text || (['para', 'line', 'heading', 'scene'].includes(e.kind) ? '' : titleOf(e))) : '');

export class Conflicts {
  constructor({ onApplied }) {
    this.onApplied = onApplied || (() => {});
    this.pill = $('#versions');
    this.panel = $('.versions');
    this.pill.addEventListener('click', () => this.open());
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.close());
    this.keepAll = this.panel.querySelector('[data-keep-all]');
    this.keepAll.addEventListener('click', () => this.keepAllMine());
  }

  // Settle every one the same way: what's on this device now stays as it is,
  // and the copies saved aside from the other device are let go. Asks first.
  async keepAllMine() {
    const rows = await conflicts();
    if (!rows.length) return;
    const ok = await ask({
      title: `Keep this device’s version for all ${rows.length}?`,
      body: 'Your writing stays exactly as it is on this device. The copies saved aside from the other device are let go, and can’t be brought back from here.',
      ok: 'Keep this device’s'
    });
    if (!ok) return;
    for (const other of rows) await dropConflict(other.key);
    await this.count();
    await this.render();
  }

  async count() {
    // Drop any where the other version adds nothing to this one, such as an
    // earlier copy of a paragraph you kept writing (an old sync bug made these).
    let list = await conflicts();
    const stale = [];
    for (const other of list) {
      const mine = await getEntry(other.id);
      if (mine && !mine.deleted && !other.deleted && other.title === mine.title && (mine.text || '').startsWith(other.text || '')) stale.push(other);
    }
    for (const o of stale) await dropConflict(o.key);
    if (stale.length) list = await conflicts();
    const n = list.length;
    this.pill.hidden = !n;
    this.pill.textContent = n === 1 ? '1 to check' : `${n} to check`;
    // New ones: let the top bar peek out for a moment so it's noticed.
    if (n > (this.seen || 0)) {
      document.body.classList.add('show-top');
      clearTimeout(this.peek);
      this.peek = setTimeout(() => { if (!document.querySelector('.topbar:hover')) document.body.classList.remove('show-top'); }, 6000);
    }
    this.seen = n;
    return n;
  }

  close() { this.panel.hidden = true; }

  async open() {
    this.panel.hidden = false;
    await this.render();
  }

  async render() {
    const list = this.panel.querySelector('ul');
    const rows = (await conflicts()).sort((a, b) => b.saved_at - a.saved_at);
    list.replaceChildren();
    this.keepAll.hidden = rows.length < 2;
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'versions-empty';
      li.textContent = 'Nothing to check. Both devices agree.';
      list.append(li);
    }
    for (const other of rows) {
      const mine = await getEntry(other.id);
      const root = await rootOf(mine && !mine.deleted ? mine : other);
      const li = document.createElement('li');
      const from = document.createElement('div');
      from.className = 'from';
      from.textContent = `${root ? titleOf(root) : 'Somewhere in the vault'} · saved aside ${new Date(other.saved_at).toLocaleString()}`;
      const pair = document.createElement('div');
      pair.className = 'versions-pair';
      pair.append(side('On this device', mine && !mine.deleted ? words(mine) : 'Deleted on this device'), side('From the other device', other.deleted ? 'Deleted on the other device' : words(other)));
      const actions = document.createElement('div');
      actions.className = 'versions-actions';
      actions.append(
        button('Keep this device’s', () => this.resolve(other, 'mine')),
        button('Use the other', () => this.resolve(other, 'theirs'))
      );
      if (mine && !mine.deleted && !other.deleted && ['para', 'line'].includes(other.kind)) actions.append(button('Keep both', () => this.resolve(other, 'both')));
      li.append(from, pair, actions);
      list.append(li);
    }
  }

  async resolve(other, pick) {
    const { key, saved_at, ...theirs } = other;
    const mine = await getEntry(other.id);
    const now = Date.now();
    let changed = [];
    if (pick === 'theirs') changed = [{ ...(mine || {}), ...theirs, updated_at: now }];
    // The other version goes right after this one, as its own paragraph or line.
    if (pick === 'both') changed = [{ ...theirs, id: newId(other.kind.slice(0, 2)), sort: (mine.sort || 0) + 1, parent_id: mine.parent_id, created_at: now, updated_at: now }];
    if (changed.length) await putEntries(changed);
    await dropConflict(key);
    if (changed.length) await this.onApplied(changed);
    await this.count();
    await this.render();
  }
}

function side(label, text) {
  const box = document.createElement('div');
  const l = document.createElement('span');
  l.className = 'panel-label';
  l.textContent = label;
  const t = document.createElement('p');
  t.className = 'line';
  t.textContent = text || '(empty)';
  box.append(l, t);
  return box;
}

function button(label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ghost-btn';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}
