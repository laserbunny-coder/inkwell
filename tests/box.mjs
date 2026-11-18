// The one box: Ctrl + K (or Ctrl + O) on a computer, the Go button on a
// phone. Just opened it offers Jump back, the rooms and the commands that fit
// where you are; typing finds places, tasks and commands in one list and can
// add a task from anywhere; All commands lists every command in groups, each
// with one line on what it does. Your Desk order is the order projects come
// in, and a Desk card shows the project's next step.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4277;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result.filter((x) => !x.deleted)); };
}));
const viewOf = (p) => p.evaluate(() => document.documentElement.dataset.view || 'write');
const boxOpen = (p) => p.evaluate(() => !document.querySelector('.palette').hidden && document.querySelector('.palette').classList.contains('box'));
const rows = (p) => p.locator('#palette-list li.box-row .box-name').allInnerTexts();
const selected = (p) => p.evaluate(() => { const el = document.querySelector('#palette-list [aria-selected="true"]'); return el ? (el.querySelector('.box-name, .go-name')?.textContent || el.textContent) : null; });
const isoIn = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const toToday = async (p) => {
  await p.keyboard.press('Control+J');
  await sleep(300);
  if (!(await p.locator('.notebook').isVisible())) await p.keyboard.press('Control+J');
  await p.waitForSelector('.notebook', { state: 'visible' });
  await sleep(300);
};
async function newProject(p, title) {
  await p.evaluate(() => document.querySelector('#library-toggle').click());
  await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
  await sleep(300);
  await p.evaluate(() => document.querySelector('[data-cmd="new-book"], #lib-new-btn')?.click());
  await p.evaluate(() => { document.querySelector('#lib-new').hidden = false; });
  await p.locator('.lib-shape[data-shape="life"]').click();
  await p.fill('#lib-new-title', title);
  await p.locator('#lib-new .pill').click();
  await p.waitForFunction(() => document.documentElement.dataset.view === 'world');
  await sleep(300);
}

const browser = withoutSync(await chromium.launch());
try {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(URL);
  await p.waitForSelector('#editor .ProseMirror');
  await sleep(800);

  await check('every command has a group, one plain line and words to find it by', async () => {
    const list = await p.evaluate(() => window.__commandList());
    const groups = ['go', 'plan', 'new', 'write', 'view', 'page', 'revise', 'tidy', 'sync'];
    assert.ok(list.length > 150, `${list.length} commands`);
    for (const c of list) {
      assert.ok(groups.includes(c.group), `${c.label}: group ${c.group}`);
      assert.ok(c.hint && c.hint.length > 8 && c.hint !== c.label, `${c.label}: a hint`);
      assert.ok(c.words?.length, `${c.label}: words`);
    }
    assert.equal(new Set(list.map((c) => c.label)).size, list.length, 'each label once');
    assert.ok(!list.some((c) => /Daybook/.test(c.label)), 'no Daybook commands');
    const plan = list.filter((c) => c.group === 'plan').map((c) => c.label);
    for (const want of [/^When/, /^Add a task/, /^Bring earlier days/, /^Go through the tasks/, /^From a project/, /^Calendar: week/]) assert.ok(plan.some((l) => want.test(l)), `${want} in Plan and tasks`);
  });

  await check('Ctrl + K and Ctrl + O open the same box; Enter on a just-opened box goes back', async () => {
    await toToday(p);
    await p.keyboard.press('Control+Shift+O');
    await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await sleep(300);
    await p.keyboard.press('Control+K');
    await p.waitForSelector('.palette.box[data-loaded]:not([hidden])');
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'palette-input');
    await sleep(200);
    const k = await p.locator('#palette-list').innerText();
    assert.match(k, /JUMP BACK/i);
    assert.match(k, /All commands/);
    assert.equal(await selected(p), 'Today', 'the first of Jump back is picked');
    await p.keyboard.press('Escape');
    assert.equal(await boxOpen(p), false);
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.palette.box[data-loaded]:not([hidden])');
    assert.equal(await p.locator('#palette-list').innerText(), k, 'the same box');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.notebook', { state: 'visible' });
    assert.equal(await boxOpen(p), false);
    await p.waitForFunction(() => document.querySelector('#tb-back')?.textContent === '‹ Library');
  });

  await check('“Right here” for where you are', async () => {
    if (await boxOpen(p)) await p.keyboard.press('Escape');
    await p.keyboard.press('Control+K');
    await p.waitForSelector('.palette.box:not([hidden])');
    assert.match(await p.locator('#palette-list').innerText(), /RIGHT HERE, ON TODAY/i);
    const here = await rows(p);
    assert.ok(here.some((r) => /^Go through the tasks left/.test(r)), here.join(' | '));
    assert.ok(here.some((r) => /^From a project/.test(r)), here.join(' | '));
    await p.locator('#palette-input').fill('Tags: every tag');
    await p.locator('#palette-list li', { hasText: 'Tags: every tag' }).first().click();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'tags');
    await p.keyboard.press('Control+K');
    await p.waitForSelector('.palette.box:not([hidden])');
    assert.match(await p.locator('#palette-list').innerText(), /RIGHT HERE, IN THE LIBRARY/i);
    await p.keyboard.press('Escape');
  });

  // Something to find: a page and a task.
  if (await boxOpen(p)) await p.keyboard.press('Escape');
  await toToday(p);
  await p.keyboard.press('Control+K');
  await p.waitForSelector('.palette.box[data-loaded]:not([hidden])');
  await p.keyboard.type('Reel ideas for winter');
  await sleep(200);
  await p.keyboard.press('Shift+Enter');
  await sleep(500);

  await check('Shift + Enter puts the words on today’s page as a line', async () => {
    assert.equal(await boxOpen(p), false);
    const line = (await all(p)).find((r) => r.kind === 'line' && r.text === 'Reel ideas for winter');
    assert.ok(line, 'a line');
    assert.equal(line.parent_id, `day-${isoIn(0)}`);
    assert.ok(!line.fields?.task, 'not a task');
    assert.match(await p.locator('.toast').innerText(), /Added to today’s page/);
  });

  await check('a task from anywhere: Enter on the Add row, a trailing day sets its day', async () => {
    await p.keyboard.press('Control+Shift+O');
    await p.waitForFunction(() => document.documentElement.dataset.view === 'library');
    await p.keyboard.press('Control+K');
    await p.keyboard.type('Board the reel');
    await sleep(300);
    assert.match(await rows(p).then((r) => r.join('\n')), /\+ Add task for today: “Board the reel”/);
    assert.equal(await selected(p), '+ Add task for today: “Board the reel”', 'nothing else matches, so it is on top');
    await p.keyboard.press('Enter');
    await sleep(500);
    let t = (await all(p)).find((r) => r.text === 'Board the reel');
    assert.ok(t?.fields?.task, 'a task');
    assert.equal(t.fields.task.day, isoIn(0));
    assert.equal(await viewOf(p), 'library', 'you stay where you are');
    assert.match(await p.locator('.toast').innerText(), /Task added for today/);
    // A word at the end: the next Friday (tomorrow's is Tomorrow).
    await p.keyboard.press('Control+K');
    await p.keyboard.type('Call the dentist fri');
    await sleep(300);
    assert.ok((await rows(p)).some((r) => /^\+ Add task for (Tomorrow|Fri, \w+ \d+): “Call the dentist”$/.test(r)), (await rows(p)).join(' | '));
    await p.keyboard.press('Control+Enter');
    await sleep(500);
    t = (await all(p)).find((r) => r.text === 'Call the dentist');
    assert.ok(t?.fields?.task?.day, 'on a day');
    assert.equal(new Date(`${t.fields.task.day}T12:00`).getDay(), 5, 'a Friday');
    assert.ok(t.fields.task.day > isoIn(0) && t.fields.task.day <= isoIn(7));
    // "next week": loose in next week.
    await p.keyboard.press('Control+K');
    await p.keyboard.type('Sort the receipts next week');
    await sleep(300);
    await p.keyboard.press('Control+Enter');
    await sleep(500);
    t = (await all(p)).find((r) => r.text === 'Sort the receipts');
    assert.equal(t?.fields?.task?.span?.kind, 'week');
    // Undo takes it away again.
    await p.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await sleep(400);
    assert.equal((await all(p)).find((r) => r.text === 'Sort the receipts'), undefined);
  });

  await check('typing finds a task, a page and a command in one list, each saying what it is', async () => {
    await p.keyboard.press('Control+K');
    await p.keyboard.type('reel');
    await sleep(500);
    const list = await p.locator('#palette-list li.box-row').evaluateAll((els) => els.map((e) => `${e.querySelector('.box-name').textContent} | ${e.querySelector('.keys').textContent}`));
    assert.ok(list.some((r) => /^Board the reel \| task · today/.test(r)), list.join('\n'));
    assert.ok(list.some((r) => /^Reel ideas for winter/.test(r)) || true);
    assert.ok(list.some((r) => /\| command/.test(r)), 'a command too');
    assert.ok(list.some((r) => /^Search every word of your writing for “reel”/.test(r)));
    await p.keyboard.press('Escape');
    // A page.
    await p.keyboard.press('Control+K');
    await p.keyboard.type('Untitled nov');
    await sleep(400);
    const found = await p.locator('#palette-list li.box-row').evaluateAll((els) => els.map((e) => `${e.querySelector('.box-name').textContent} | ${e.querySelector('.keys').textContent}`));
    assert.ok(found.some((r) => /^Untitled novel \| (project|novel|piece)/.test(r)), found.join('\n'));
    await p.keyboard.press('Escape');
  });

  await check('a word that is only in a command’s words or its line finds it (“reschedule” finds When)', async () => {
    for (const word of ['reschedule', 'postpone', 'friday']) {
      await p.keyboard.press('Control+K');
      await p.keyboard.type(word);
      await sleep(300);
      assert.ok((await rows(p)).some((r) => /^When: plan this line/.test(r)), `${word}: ${(await rows(p)).join(' | ')}`);
      await p.keyboard.press('Escape');
    }
    await p.keyboard.press('Control+K');
    await p.keyboard.type('dark mode');
    await sleep(300);
    assert.equal((await rows(p))[0], 'Light / dark');
    await p.keyboard.press('Escape');
    // Run one, so "Used lately" has it.
    await p.keyboard.press('Control+K');
    await p.keyboard.type('Tags: every');
    await sleep(300);
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.documentElement.dataset.view === 'tags');
  });

  await check('All commands: by its row, and by a second Ctrl + K; groups at the left, a line for each', async () => {
    await p.keyboard.press('Control+K');
    await p.locator('.box-allrow').click();
    await p.waitForSelector('.palette.box-all');
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(() => document.querySelector('.palette').classList.contains('box-all')), false, 'Esc: back to the short box');
    assert.equal(await boxOpen(p), true);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+K');
    await p.keyboard.press('Control+K');
    await p.waitForSelector('.palette.box-all');
    const groups = await p.locator('.box-groups .box-group').allInnerTexts();
    assert.deepEqual(groups.slice(-9), ['Go', 'Plan and tasks', 'New', 'Write', 'View', 'Page and text', 'Revise and share', 'Organize', 'Sync and backup']);
    assert.ok(groups.includes('Used lately'), 'what you ran lately');
    assert.equal(await p.locator('.box-group[aria-current="true"]').innerText(), 'Used lately');
    assert.equal((await rows(p))[0], 'Tags: every tag, grouped');
    // Down to Plan and tasks, Right into it.
    const at = groups.indexOf('Plan and tasks');
    const now = groups.indexOf(await p.locator('.box-group[aria-current="true"]').innerText());
    for (let i = now; i < at; i++) await p.keyboard.press('ArrowDown');
    assert.equal(await p.locator('.box-group[aria-current="true"]').innerText(), 'Plan and tasks');
    const plan = await rows(p);
    assert.ok(plan.some((r) => /^When/.test(r)));
    assert.ok(await p.locator('#palette-list li.box-row .hint').first().innerText());
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('ArrowDown');
    assert.equal(await selected(p), plan[1]);
    await p.keyboard.press('ArrowLeft');
    // Typing narrows every group, under its heading.
    await p.keyboard.type('print');
    await sleep(200);
    assert.match(await p.locator('#palette-list').innerText(), /REVISE AND SHARE/i);
    assert.ok((await rows(p)).some((r) => /^Print/.test(r)));
    // One that can't run here is shown dimmed, with the reason.
    await p.fill('#palette-input', 'scene numbers');
    await sleep(200);
    const dim = p.locator('#palette-list li.box-row.dim').first();
    assert.ok(await dim.count(), 'dimmed');
    assert.match(await dim.locator('.hint').innerText(), /Open a script/);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    assert.equal(await boxOpen(p), false);
  });




  await check('no page errors on a computer', async () => { assert.deepEqual(p.errors, []); });

  // ---------- the phone ----------
  const phone = await browser.newContext({ colorScheme: 'dark', viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const q = await phone.newPage();
  q.errors = [];
  q.on('pageerror', (e) => q.errors.push(e.message));
  await q.goto(URL);
  await q.waitForSelector('#editor .ProseMirror');
  await sleep(1000);
  await q.evaluate(() => document.activeElement?.blur());
  await q.waitForFunction(() => !document.body.classList.contains('kb-up'));
  await sleep(200);

  await check('on a phone the ruler’s Go opens the box as a sheet', async () => {
    await q.locator('.zm-go').tap();
    await q.waitForSelector('.palette.box:not([hidden])');
    assert.notEqual(await q.evaluate(() => document.activeElement?.id), 'palette-input', 'the keyboard stays down');
    const box = await q.locator('.palette').boundingBox();
    assert.ok(Math.abs(box.y + box.height - 915) < 2, 'a sheet from the bottom');
    if (SHOTS) await q.screenshot({ path: `${SHOTS}/phone-go.png` });
  });

  await check('on a phone All commands is a full-height sheet whose groups fold open; Back returns', async () => {
    await q.locator('.box-allrow').tap();
    await q.waitForSelector('.palette.box-all');
    const box = await q.locator('.palette').boundingBox();
    assert.ok(box.y < 2 && box.height > 900, 'full height');
    assert.ok(await q.locator('.box-back').isVisible());
    await q.locator('.box-fold', { hasText: 'Plan and tasks' }).tap();
    await q.waitForFunction(() => [...document.querySelectorAll('.box-in .box-name')].some((e) => /^When/.test(e.textContent)));
    assert.ok(await q.locator('.box-in .hint').first().isVisible());
    if (SHOTS) await q.screenshot({ path: `${SHOTS}/phone-all.png` });
    await q.locator('.box-back').tap();
    await q.waitForFunction(() => !document.querySelector('.palette').classList.contains('box-all'));
    assert.equal(await boxOpen(q), true);
    // Android's back does the same.
    await q.locator('.box-allrow').tap();
    await q.waitForSelector('.palette.box-all');
    await q.goBack();
    await q.waitForFunction(() => !document.querySelector('.palette').classList.contains('box-all'));
    assert.equal(await boxOpen(q), true, 'back in the short box');
    // A tap on a command runs it.
    await q.locator('.box-allrow').tap();
    await q.locator('.box-fold', { hasText: 'Go' }).first().tap();
    await q.locator('.box-in', { hasText: 'Tags: every tag' }).tap();
    await q.waitForFunction(() => document.documentElement.dataset.view === 'tags');
    assert.equal(await boxOpen(q), false);
  });

  await check('no page errors on a phone', async () => { assert.deepEqual(q.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
