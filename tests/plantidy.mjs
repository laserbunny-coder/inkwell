// Clearing the plan: Delete (Ctrl + Shift + Backspace or the menu) sends a
// task and its lines to the Trash with Undo; several can be picked first; a
// task on the Acro HQ board asks first. Go through takes the pile left from
// earlier days one at a time: keep it for today, take it off the day, delete.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4281;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const NOW = '2026-11-09T14:04:00-08:00'; // a Monday, 2:04 pm
const LATER = '2026-11-11T09:00:00-08:00'; // that Wednesday
const at = (s) => `${s}:00-08:00`;
const EVENTS = [
  { id: 'c1:standup', title: 'Standup with Nate', start: at('2026-11-09T09:30'), end: at('2026-11-09T10:00'), allDay: false, calendar: 'Acro' },
  { id: 'c1:dentist', title: 'Dentist', start: at('2026-11-09T16:00'), end: at('2026-11-09T17:00'), allDay: false, calendar: 'Michael' },
  { id: 'c1:dana', title: 'Call with Dana', start: at('2026-11-09T18:00'), end: at('2026-11-09T18:30'), allDay: false, calendar: 'Michael' },
  { id: 'c2:bday', title: 'Arrow’s birthday', start: '2026-11-09', end: '2026-11-10', allDay: true, calendar: 'Family' },
];

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  // A fresh device: time estimates are as a new install has them (off).
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, estimates: false, ...extra });
  await ctx.addInitScript((events) => {
    window.__calendar = async () => {
      const gone = localStorage.getItem('cal-gone');
      return { connected: true, events: events.filter((e) => e.id !== gone) };
    };
  }, EVENTS);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const named = async (p, text) => (await all(p)).find((r) => r.text === text && r.fields?.task);
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const go = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((pl) => (document.documentElement.dataset.view || 'write') === pl.view && history.state?.view === pl.view, place);
  await still(p);
  await sleep(350);
};
const add = async (p, text) => { const input = p.locator('#plan input[data-add]').first(); await input.fill(text); await input.press('Enter'); await sleep(400); };
// The list as drawn: events as "@ title", tasks by their words.
const seq = (p) => p.evaluate(() => [...document.querySelectorAll('#plan .pl-list > .pl-task:not(.done), #plan .pl-list > .pl-wev')].map((el) => (el.classList.contains('pl-wev') ? `@ ${el.querySelector('.ev-w').textContent}` : el.querySelector('.pl-words').textContent)));
const seqIs = (p, want) => p.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('#plan .pl-list > .pl-task:not(.done), #plan .pl-list > .pl-wev')].map((el) => (el.classList.contains('pl-wev') ? `@ ${el.querySelector('.ev-w').textContent}` : el.querySelector('.pl-words').textContent))) === JSON.stringify(w), want, { timeout: 8000 }).catch(async () => { assert.deepEqual(await seq(p), want); });
const row = (p, text) => p.locator('#plan .pl-task', { hasText: text });
const ev = (p, text) => p.locator('#plan .pl-wev', { hasText: text });
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await still(p); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const look = (p, name, on) => p.evaluate(([n, v]) => { const c = document.querySelector(`[data-show="${n}"]`); if (c.checked !== v) c.click(); }, [name, on]);

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 10).join('\n     ')}`); }
}

const put = (p, rows) => p.evaluate((rs) => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const t = r.result.transaction('entries', 'readwrite'); for (const x of rs) t.objectStore('entries').put(x); t.oncomplete = () => res(); };
}), rows);
const words = (p) => p.evaluate(() => [...document.querySelectorAll('#plan .pl-list > .pl-task:not(.done) .pl-words')].map((w) => w.textContent));
const byId = async (p, id) => (await all(p)).find((r) => r.id === id);
const toast = (p) => p.locator('.toast').innerText();
const focusTask = async (p, text) => {
  await row(p, text).locator('.pl-words').focus();
  await p.waitForFunction((t) => document.activeElement?.closest?.('[data-task]')?.textContent.includes(t), text);
};

try {
  const page = await open({ width: 1440, height: 900 });
  await go(page, { view: 'notebook', pageId: 'day-2026-11-09' });
  await page.waitForSelector('#plan .pl-list');
  for (const t of ['Board Reel 2', 'Email Dana the boards', 'Print the call sheet', 'Order the storage drive', 'Book the rehearsal room', 'Call the print shop', 'Pick up the costumes']) await add(page, t);
  // Two lines of notes under one task, written under it as anywhere.
  const reel = await named(page, 'Board Reel 2');
  const now = Date.now();
  await put(page, [1, 2].map((n) => ({ id: `ln_reel_${n}`, kind: 'line', parent_id: reel.id, sort: n * 1024, text: n === 1 ? 'Shot list on the Reel 2 page' : 'Keep the rain real', content: [{ type: 'text', text: n === 1 ? 'Shot list on the Reel 2 page' : 'Keep the rain real' }], tags: [], links: [], fields: {}, deleted: false, created_at: now, updated_at: now })));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await go(page, { view: 'notebook', pageId: 'day-2026-11-09' });
  await page.waitForFunction(() => document.querySelectorAll('#plan .pl-task').length === 7);

  await check('Ctrl + Shift + Backspace on a task: it and its lines go to the Trash, the toast says so, and Undo brings all of it back', async () => {
    await focusTask(page, 'Board Reel 2');
    await page.keyboard.press('Control+Shift+Backspace');
    await page.waitForFunction(() => !document.querySelector('#plan .pl-task')?.textContent.includes('Board Reel 2') && ![...document.querySelectorAll('#plan .pl-words')].some((w) => w.textContent === 'Board Reel 2'));
    assert.match(await toast(page), /Deleted “Board Reel 2” and 2 lines under it/);
    const gone = await all(page);
    assert.ok(['ln_reel_1', 'ln_reel_2', reel.id].every((id) => gone.find((r) => r.id === id)?.fields?.trashed), 'the task and its lines are in the Trash');
    await page.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('#plan .pl-words')].some((w) => w.textContent === 'Board Reel 2'));
    const back = await all(page);
    assert.ok(['ln_reel_1', 'ln_reel_2', reel.id].every((id) => !back.find((r) => r.id === id)?.fields?.trashed), 'all of it is back');
    assert.equal((await words(page))[0], 'Board Reel 2', 'in its place');
  });

  await check('Delete in the ⋯ menu; Ctrl + Z in the plan takes it back; it leaves the page it was written on', async () => {
    await row(page, 'Call the print shop').locator('[data-act="more"]').click();
    await page.locator('.pop-menu .pop-item', { hasText: /^Delete$/ }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('#plan .pl-words')].some((w) => w.textContent === 'Call the print shop'));
    const line = await named(page, 'Call the print shop');
    assert.ok(line.fields.trashed);
    await go(page, { view: 'notebook', pageId: 'page-tasks' });
    await page.waitForSelector('#outline-editor li');
    assert.equal(await page.locator('#outline-editor li', { hasText: 'Call the print shop' }).count(), 0, 'not on its page either');
    await go(page, { view: 'notebook', pageId: 'day-2026-11-09' });
    await page.waitForSelector('#plan .pl-task');
    await focusTask(page, 'Board Reel 2');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => [...document.querySelectorAll('#plan .pl-words')].some((w) => w.textContent === 'Call the print shop'));
  });

  await check('Shift + click picks several; one Ctrl + Shift + Backspace deletes them, and one Undo brings them all back', async () => {
    await row(page, 'Print the call sheet').locator('.pl-words').click({ modifiers: ['Shift'] });
    await row(page, 'Order the storage drive').locator('.pl-words').click({ modifiers: ['Shift'] });
    assert.equal(await page.locator('#plan .pl-task.sel').count(), 2);
    assert.equal(await page.evaluate(() => !!document.querySelector('#outline-editor li.zoom-root')), false, 'a Shift + click picks, it doesn’t open');
    await page.keyboard.press('Control+Shift+Backspace');
    await page.waitForFunction(() => document.querySelectorAll('#plan .pl-task:not(.done)').length === 5);
    assert.match(await toast(page), /Deleted 2 tasks/);
    await page.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await page.waitForFunction(() => document.querySelectorAll('#plan .pl-task:not(.done)').length === 7);
    assert.equal(await page.locator('#plan .pl-task.sel').count(), 0);
  });

  await check('a task on the Acro HQ board is deleted without asking, marked to come off the board too; Undo takes it all back', async () => {
    const t = await named(page, 'Email Dana the boards');
    await put(page, [{ ...t, fields: { ...t.fields, hq: { id: 't9', link: 'https://hq.example/?task=t9' } }, updated_at: Date.now() }]);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await go(page, { view: 'notebook', pageId: 'day-2026-11-09' });
    await page.waitForSelector('#plan .pl-hq');
    await focusTask(page, 'Email Dana the boards');
    await page.keyboard.press('Control+Shift+Backspace');
    await page.waitForFunction(() => ![...document.querySelectorAll('#plan .pl-words')].some((w) => w.textContent === 'Email Dana the boards'));
    assert.equal(await page.locator('.ask').count(), 0, 'no question');
    assert.match(await toast(page), /from the HQ board/);
    const gone = await named(page, 'Email Dana the boards');
    assert.ok(gone.fields.trashed && gone.fields.hqDelete, 'in the Trash, and meant for the board too');
    await page.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('#plan .pl-words')].some((w) => w.textContent === 'Email Dana the boards'));
    const back = await named(page, 'Email Dana the boards');
    assert.ok(!back.fields.trashed && !back.fields.hqDelete, 'back, and staying on the board');
  });

  // Two days later, everything still open is carried over.
  await page.clock.setFixedTime(new Date(LATER));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await go(page, { view: 'notebook', pageId: 'day-2026-11-11' });
  await page.waitForFunction(() => document.querySelectorAll('#plan .pl-task.carried').length === 7);

  await check('Go through: the pile left from earlier days is offered in the plan’s head', async () => {
    assert.equal(await page.locator('#plan .pl-thru').innerText(), '7 from earlier days · Go through');
    await page.locator('#plan .pl-thru').click();
    await page.waitForSelector('.thru-card');
    const opts = await page.evaluate(() => [...document.querySelectorAll('.thru-opt')].map((b) => `${b.dataset.key} ${b.querySelector('.thru-label').textContent}`));
    assert.deepEqual(opts.filter((o) => !/HQ/.test(o)), ['K Keep it for today', 'C Done: check it off', 'N Not today: off the day, still where it’s written', 'D Delete it', 'S Skip for now']);
    assert.match(await page.locator('.thru-ctx').innerText(), /Planned for Nov 9/);
    await shot(page, 'thru-carried');
  });

  await check('Keep, Not today and Delete each do their part, and Undo takes the last one back', async () => {
    const first = await page.locator('.thru-big').innerText();
    await page.keyboard.press('k');
    await page.waitForFunction((f) => document.querySelector('.thru-big')?.textContent !== f, first);
    assert.equal((await named(page, first)).fields.task.day, '2026-11-11', 'kept: it’s today’s now');
    const second = await page.locator('.thru-big').innerText();
    await page.keyboard.press('n');
    await page.waitForFunction((f) => document.querySelector('.thru-big')?.textContent !== f, second);
    assert.equal((await named(page, second)).fields.task.day ?? null, null, 'not today: off the day');
    assert.ok(!(await named(page, second)).fields.trashed, 'and still there');
    const third = await page.locator('.thru-big').innerText();
    await page.keyboard.press('d');
    await page.waitForFunction((f) => document.querySelector('.thru-big')?.textContent !== f, third);
    assert.ok((await named(page, third)).fields.trashed, 'deleted: in the Trash');
    await page.keyboard.press('z');
    await page.waitForFunction((t) => document.querySelector('.thru-big')?.textContent === t, third);
    assert.ok(!(await named(page, third)).fields.trashed, 'Undo brought it back');
    await page.keyboard.press('c');
    await page.waitForFunction((f) => document.querySelector('.thru-big')?.textContent !== f, third);
    const ticked = await named(page, third);
    assert.ok(ticked.fields.done && ticked.fields.task.done_at, 'done: checked off');
    await page.keyboard.press('z');
    await page.waitForFunction((t) => document.querySelector('.thru-big')?.textContent === t, third);
    assert.ok(!(await named(page, third)).fields.done, 'Undo opened it again');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.thru'));
    await page.waitForFunction(() => document.querySelectorAll('#plan .pl-task.carried').length === 5);
    assert.ok([...await words(page)].includes(first), 'the kept one is on today');
  });

  await check('no page errors', async () => {
    assert.deepEqual(page.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nclearing the plan: all good');
process.exit(failed ? 1 : 0);
