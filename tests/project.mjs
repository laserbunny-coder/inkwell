// A project's page: what it's for (north star), where it stands (now), its
// next date, what needs you, its pieces by status, its steps (the project's
// own tasks), who's working on it (crew) and how it got here (turns). The
// calls and updates live in Daybook's tables; a stand-in (window.__desk)
// plays Daybook, as in desk.mjs.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4268;
const DIST = process.env.DIST;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

// Monday Nov 9 2026, 2:04 pm in Los Angeles.
const NOW = '2026-11-09T14:04:00-08:00';
const now = Date.parse(NOW);
const T = (s) => new Date(`${s}-08:00`).toISOString();
const NB = 'https://claude.ai/code/project/chan_nb';
const INK = 'https://claude.ai/code/project/chan_ink';

const db = {
  needs: [
    { id: 'n1', kind: 'decision', title: 'Pick Kenji’s final character sheet', project: 'The Ninja Bunch', link: `${NB}?thread=sheet`, project_link: NB, created_at: T('2026-11-08T10:09:00'), body: 'Guide: https://claude.ai/artifact/kenjiSheets' },
    { id: 'n2', kind: 'review', title: 'Try the AI production tools on Reel 4', project: 'The Ninja Bunch', link: `${NB}?thread=tools`, project_link: NB, created_at: T('2026-11-03T22:53:00'), body: '' },
    { id: 'n4', kind: 'review', title: 'Try opening two things side by side', project: 'Inkwell', link: `${INK}?thread=panes`, project_link: INK, created_at: T('2026-11-05T03:43:00'), body: '' },
  ],
  updates: [
    { id: 'u1', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=woven`, thread: 'Rethink the screenplay', text: 'Scripts moved to Woven: no slug lines, scene titles on the line', place: null, state: 'live', created_at: T('2026-11-05T16:00:00') },
    { id: 'u2', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=stills`, thread: 'Overnight stills', text: 'Reel 4: six stills generated overnight, named by shot code', place: null, state: 'done', created_at: T('2026-11-09T06:40:00') },
    { id: 'u3', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=prompts`, thread: 'Draft Reel 3 prompts', text: 'Reel 3 prompts are half drafted', place: null, state: 'working', created_at: T('2026-11-09T13:52:00') },
    { id: 'u4', project: 'Inkwell', project_link: INK, link: `${INK}?thread=redesign`, thread: 'Redesign Inkwell from the ground up', text: 'The new frame is live: rail, switch, five looks', place: null, state: 'live', created_at: T('2026-11-09T09:30:00') },
    // Too long ago for the page: only History has it.
    { id: 'u0', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=old`, thread: 'First look', text: 'First character sheets drawn', place: null, state: 'done', created_at: T('2026-08-01T09:00:00') },
  ],
};
const calls = [];

const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * 864e5, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const piece = (id, title, stage, sort, label, extra = {}) => row(id, 'project', 'wd_nb', sort, { title, fields: { type: 'screenplay', stage, label, ...extra.fields }, updated_at: extra.updated_at || now - 3 * 864e5 });
const task = (id, parent, sort, text, t = {}, done = false) => row(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done, box: true, task: { v: 1, day: null, est: null, done_at: done ? now - 864e5 : null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show', logline: 'A family bakery raises a troupe of hopeless ninjas. An anime mockumentary musical, told in reels first.' }, updated_at: now - 864e5 }),
  piece('pr_gag', 'Pancake on the head', 'New idea', 1, 'Gag'),
  piece('pr_ep2', 'Episode 2: Rent Day', 'New idea', 2, 'Episode'),
  piece('pr_ep1', 'Episode 1: The Audition', 'Writing', 3, 'Episode'),
  piece('pr_reel3', 'Reel 3: Rent Day', 'Writing', 4, 'Reel'),
  piece('pr_reel2', 'Reel 2: Breakfast', 'Boarding', 5, 'Reel', { updated_at: now - 2 * 36e5 }),
  row('ac_2', 'act', 'pr_reel2', 1, { title: 'Screenplay' }),
  row('ch_2', 'chapter', 'ac_2', 1, { title: 'Script', fields: { words: 142 } }),
  row('pb_1', 'para', 'ch_2', 1024, { text: 'Mom flips pancakes with a katana.', content: [{ type: 'text', text: 'Mom flips pancakes with a katana.' }], fields: { el: 'action' } }),
  row('pg_shots', 'page', 'pr_reel2', 1, { title: 'Shot list' }),
  piece('pr_reel4', 'Reel 4: The Rolling Pin', 'Generating', 6, 'Reel'),
  piece('pr_reel1', 'Reel 1: The Audition', 'Posted', 7, 'Reel'),
  row('sd_1', 'shootday', 'pr_reel2', 9, { fields: { date: '2026-12-14', call: '07:30', place: 'Echo Park', scenes: [], notes: '' } }),
  row('pg_chars', 'page', 'wd_nb', 1024, { title: 'Characters' }),
  // Its steps: three on its own Steps page, one written on a piece's page.
  row('steps-wd_nb', 'page', 'wd_nb', 2048, { title: 'Steps' }),
  task('st_1', 'steps-wd_nb', 1024, 'Board Reel 2', { day: '2026-11-12', est: 90 }),
  task('st_2', 'steps-wd_nb', 2048, 'Write Kenji’s second verse'),
  task('st_3', 'steps-wd_nb', 3072, 'Pick the bakery’s colours', {}, true),
  task('st_4', 'pg_shots', 1024, 'Star the stills for shot 3', { day: '2026-11-10', est: 15 }),
  // A task somewhere else is none of this project's business.
  row('page-tasks', 'page', null, 0, { title: 'Tasks' }),
  task('st_x', 'page-tasks', 1024, 'Order the storage drive', { day: '2026-11-09' }),
  // A life project nobody has touched in months.
  row('wd_camp', 'world', null, 2, { title: 'Camping', area_id: 'area-personal', fields: { life: true, star: 'Two trips with Arrow next season.' }, created_at: now - 200 * 864e5, updated_at: now - 90 * 864e5 }),
  row('pg_gear', 'page', 'wd_camp', 1024, { title: 'Gear list', created_at: now - 200 * 864e5, updated_at: now - 90 * 864e5 }),
];
const seed = (rows) => new Promise((res, rej) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
    for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  };
});

const browser = withoutSync(await chromium.launch());
async function open(viewport, { desk = true, ...extra } = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  await ctx.exposeFunction('__db', (op, a, b) => {
    calls.push([op, a, b]);
    if (op === 'desk') return { needs: db.needs.filter((n) => !n.resolved_at).map((n) => ({ ...n })), updates: db.updates.filter((u) => u.created_at >= a).map((u) => ({ ...u })) };
    if (op === 'all') return { needs: db.needs.map((n) => ({ ...n })), updates: db.updates.map((u) => ({ ...u })) };
    const n = db.needs.find((x) => x.id === a);
    if (op === 'done') n.resolved_at = T('2026-11-09T14:04:00');
    if (op === 'later') n.snoozed_until = b;
    return null;
  });
  if (desk) await ctx.addInitScript(() => {
    window.__desk = {
      desk: (since) => window.__db('desk', since),
      deskAll: () => window.__db('all'),
      doneNeed: (id) => window.__db('done', id),
      laterNeed: (id, until) => window.__db('later', id, until),
    };
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await page.evaluate(seed, SEED);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const get = async (p, id) => (await all(p)).find((r) => r.id === id);
const go = (p, place) => p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
const viewOf = (p) => p.evaluate(() => document.documentElement.dataset.view || 'write');
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const pick = async (p, label) => { await p.locator('.pop-menu .pop-item', { hasText: label }).first().click(); await sleep(300); };
const facts = (p) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#wh-facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.innerText.trim()])));
const steps = (p) => p.locator('#wh-steps .pl-task .pl-words').allInnerTexts();
const step = (p, text) => p.locator('#wh-steps .pl-task', { hasText: text });
const world = async (p, id = 'wd_nb') => {
  await go(p, { view: 'world', id });
  await p.waitForFunction((t) => document.documentElement.dataset.view === 'world' && document.querySelector('#wh-seat')?.textContent && document.querySelector('#wh-title')?.dataset.id !== t, id);
  await p.waitForSelector('#wh-facts dt');
  await still(p);
  await sleep(300);
};
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await still(p); await sleep(200); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}

try {
  const page = await open({ width: 1440, height: 900 });
  await world(page);
  await page.waitForSelector('#wh-calls .dk-call');

  await check('the head: its area, what it is and where it sits, its name, and Continue with the piece', async () => {
    assert.equal(await page.locator('#wh-area').evaluate((s) => s.selectedOptions[0].textContent.trim()), 'Filmmaking');
    assert.match(await page.locator('#wh-kind').innerText(), /^show$/i);
    assert.match(await page.locator('#wh-seat').innerText(), /^on stage$/i);
    assert.equal(await page.locator('#wh-title').innerText(), 'The Ninja Bunch');
    assert.equal(await page.locator('#wh-continue').innerText(), 'Continue · Reel 2: Breakfast');
    assert.match(await page.locator('#wh-logline').innerText(), /^A family bakery raises a troupe of hopeless ninjas\./);
    const dot = await page.locator('#wh-dot').evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(dot, 'rgb(31, 111, 100)', 'the area’s colour is only a dot');
  });

  await check('north star, now and next date read down the page; now is the last thing a thread said', async () => {
    const f = await facts(page);
    assert.deepEqual(Object.keys(f), ['North star', 'Now', 'Next date']);
    assert.equal(f['North star'], '');
    assert.equal(await page.locator('#wh-facts [data-field="star"]').getAttribute('data-ph'), 'What is this for?');
    assert.match(f.Now, /^✦\s*Reel 3 prompts are half drafted\s+12 min ago$/);
    assert.equal(await page.locator('#wh-facts .wp-now a.wp-when').getAttribute('href'), `${NB}?thread=prompts`, 'the time opens the thread');
    // The soonest dated step wins over the shoot day in December.
    assert.equal(f['Next date'], 'Tomorrow · Star the stills for shot 3');
  });

  await check('the north star is written right there, and the Desk has it too', async () => {
    const star = page.locator('#wh-facts [data-field="star"]');
    await star.click();
    await page.keyboard.type('Three finished reels that prove the look before the December 14 tests.');
    await page.keyboard.press('Enter');
    await sleep(400);
    assert.equal((await get(page, 'wd_nb')).fields.star, 'Three finished reels that prove the look before the December 14 tests.');
    assert.equal((await facts(page))['North star'], 'Three finished reels that prove the look before the December 14 tests.');
    await shot(page, 'project-top');
  });

  await check('Now can be said your own way; cleared, the thread’s line is back', async () => {
    const words = page.locator('#wh-facts [data-field="now"]');
    await words.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Reel 2 is boarded and waiting to generate.');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#wh-facts .wp-claude'));
    assert.equal((await get(page, 'wd_nb')).fields.now, 'Reel 2 is boarded and waiting to generate.');
    assert.match((await facts(page)).Now, /^Reel 2 is boarded and waiting to generate\.\s+just now$/);
    // Left alone, a thread's line is never saved as yours.
    await page.locator('#wh-facts [data-field="now"]').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#wh-facts .wp-claude');
    assert.equal((await get(page, 'wd_nb')).fields.now, '');
    assert.match((await facts(page)).Now, /^✦\s*Reel 3 prompts are half drafted/);
    await page.locator('#wh-facts [data-field="now"]').click();
    await page.keyboard.press('Escape');
    await sleep(300);
    assert.equal((await get(page, 'wd_nb')).fields.now, '');
  });

  await check('Needs you: this project’s calls only, the decision first; Done takes one off here and beside Desk', async () => {
    assert.match(await page.locator('#wh-calls .wp-sec').innerText(), /^needs you$/i);
    const rows = await page.locator('#wh-calls .dk-call .dk-call-t').allInnerTexts();
    assert.equal(rows.length, 2);
    assert.match(rows[0], /decide\s*Pick Kenji’s final character sheet/i);
    assert.match(rows[1], /try\s*Try the AI production tools on Reel 4/i);
    assert.match(await page.locator('#wh-calls .dk-call').first().locator('.dk-call-m').innerText(), /2 min · 1 day/);
    await page.locator('#wh-calls .dk-call').first().click();
    await page.waitForSelector('.pop-menu');
    assert.deepEqual((await page.locator('.pop-menu .pop-item').allInnerTexts()).map((t) => t.trim()), ['Open the thread', 'Open the guide', 'Done: take it off the list', 'Later: back tomorrow morning']);
    await pick(page, 'Done: take it off');
    await page.waitForFunction(() => document.querySelectorAll('#wh-calls .dk-call').length === 1);
    assert.ok(calls.some(([op, id]) => op === 'done' && id === 'n1'));
    await page.waitForFunction(() => document.querySelector('#desk-toggle')?.getAttribute('data-n') === '2');
    assert.equal(await viewOf(page), 'world', 'still on the project');
  });

  await check('Pieces by where they stand: words under one hairline, the last column lit, a piece opens', async () => {
    assert.match(await page.locator('#wh-pieces-box .wp-sec').innerText(), /^pieces\s+7 pieces · 142 words · 3 pages/i);
    const cols = await page.locator('#wh-board .sb-col').evaluateAll((els) => els.map((c) => `${c.dataset.stage} ${c.querySelectorAll('.sb-card').length}`));
    assert.deepEqual(cols, ['New idea 2', 'Writing 2', 'Boarding 1', 'Generating 1', 'Editing 0', 'Posted 1']);
    const card = page.locator('#wh-board .sb-card[data-id="pr_reel2"]');
    const look = await card.evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopWidth]; });
    assert.deepEqual(look, ['rgba(0, 0, 0, 0)', '0px'], 'no box around a piece');
    assert.ok(await page.locator('#wh-pieces').isHidden(), 'the list is away');
    assert.equal(await card.locator('.sb-kind').innerText(), 'Reel');
    await card.hover();
    assert.match(await card.locator('.sb-next').innerText(), /^Start generating/);
    await card.locator('.sb-next').click();
    await page.waitForFunction(() => document.querySelector('#wh-board .sb-col[data-stage="Generating"]')?.querySelectorAll('.sb-card').length === 2);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Generating');
  });

  await check('As a list shows how the pieces nest, and it’s remembered; By status brings the columns back', async () => {
    await page.locator('#wh-as').click();
    await page.waitForSelector('#wh-pieces li', { state: 'visible' });
    assert.ok(await page.locator('#wh-status').isHidden());
    assert.equal(await page.locator('#wh-as').innerText(), 'By status');
    assert.equal(await page.locator('#wh-pieces li').count(), 7);
    await world(page, 'wd_camp');
    await world(page);
    assert.ok(await page.locator('#wh-pieces li').first().isVisible(), 'still a list after coming back');
    await page.locator('#wh-as').click();
    await page.waitForSelector('#wh-board .sb-card', { state: 'visible' });
    assert.ok(await page.locator('#wh-pieces').isHidden());
  });

  await check('Steps: the project’s own tasks, dated ones first, with where one is written when it isn’t the Steps page', async () => {
    assert.match(await page.locator('#wh-steps .wp-sec').innerText(), /^steps\s+1 of 4 done$/i);
    assert.deepEqual(await steps(page), ['Star the stills for shot 3', 'Board Reel 2', 'Write Kenji’s second verse', 'Pick the bakery’s colours']);
    assert.equal(await step(page, 'Star the stills').locator('.pl-place').innerText(), 'Shot list');
    assert.equal(await step(page, 'Board Reel 2').locator('.pl-place').count(), 0);
    assert.equal(await step(page, 'Star the stills').locator('.pl-when').innerText(), 'Tomorrow');
    assert.equal(await step(page, 'Board Reel 2').locator('.pl-when').innerText(), 'Thu');
    assert.equal(await step(page, 'Board Reel 2').locator('.pl-est').innerText(), '1 h 30 min');
    assert.ok(await step(page, 'Pick the bakery').evaluate((el) => el.classList.contains('done')));
    assert.ok(!(await steps(page)).includes('Order the storage drive'), 'a task from elsewhere stays out');
  });

  await check('a step added here lives on the project’s Steps page, with no day yet', async () => {
    const input = page.locator('#wh-steps input[data-add]');
    assert.equal(await input.getAttribute('placeholder'), 'Add a step');
    await input.fill('Record the bakery jingle 45m');
    await input.press('Enter');
    await page.waitForFunction(() => /1 of 5 done/.test(document.querySelector('#wh-steps .wp-sec')?.innerText || ''));
    const t = (await all(page)).find((r) => r.text === 'Record the bakery jingle');
    assert.equal(t.parent_id, 'steps-wd_nb');
    assert.equal(t.fields.task.day, null);
    assert.equal(t.fields.task.est, 45);
    assert.equal((await all(page)).filter((r) => r.kind === 'page' && r.title === 'Steps' && !r.deleted).length, 1, 'one Steps page, not two');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.add), 'steps', 'the caret stays for the next one');
    assert.equal((await steps(page)).indexOf('Record the bakery jingle'), 3, 'after the dated ones and the older undated one');
  });

  await check('a step’s day moves from its label, and the next date follows; ticking it counts', async () => {
    await step(page, 'Record the bakery jingle').hover();
    await step(page, 'Record the bakery jingle').locator('.pl-when').click();
    await pick(page, 'Today');
    await page.waitForFunction(() => document.querySelector('#wh-steps .pl-task .pl-words')?.innerText === 'Record the bakery jingle');
    assert.equal((await all(page)).find((r) => r.text === 'Record the bakery jingle').fields.task.day, '2026-11-09');
    await page.waitForFunction(() => /Today · Record the bakery jingle/.test(document.querySelector('#wh-facts')?.innerText || ''));
    await step(page, 'Record the bakery jingle').locator('.pl-check').click();
    await page.waitForFunction(() => /2 of 5 done/.test(document.querySelector('#wh-steps .wp-sec')?.innerText || ''));
    await page.waitForFunction(() => /Tomorrow · Star the stills/.test(document.querySelector('#wh-facts')?.innerText || ''));
    assert.equal(await page.locator('#wh-steps .pl-took').count(), 0, 'no “how long” question on a project’s page');
  });

  await check('a step opens where it’s written, and today’s plan has the same task', async () => {
    await step(page, 'Star the stills').locator('.pl-place').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await page.waitForFunction(() => /Shot list/.test(document.querySelector('#nb-title')?.innerText || ''));
    await world(page);
  });

  await check('Crew: the threads working on it; Turns: what got finished, newest first, and the way to all of it', async () => {
    assert.match(await page.locator('#wh-crew .wp-sec').innerText(), /^crew/i);
    assert.deepEqual(await page.locator('#wh-crew .dk-crew-t').allInnerTexts(), ['Draft Reel 3 prompts']);
    assert.equal(await page.locator('#wh-crew .dk-crew-s').innerText(), '12 min ago');
    assert.equal(await page.locator('#wh-crew .dk-crew').getAttribute('href'), `${NB}?thread=prompts`);
    const turns = await page.locator('#wh-turns .wp-turn').evaluateAll((els) => els.map((e) => [...e.children].map((c) => c.innerText.trim())));
    assert.deepEqual(turns, [
      ['Nov 9', 'Reel 4: six stills generated overnight, named by shot code'],
      ['Nov 5', 'Scripts moved to Woven: no slug lines, scene titles on the line', 'LIVE']
    ]);
    await shot(page, 'project-lower');
    await page.locator('#wh-turns .wp-link').click();
    await page.waitForSelector('.desk-home .dk-thread', { state: 'visible' });
    assert.equal(await page.locator('.dk-search input').inputValue(), 'The Ninja Bunch');
    const names = await page.locator('.dk-thread .dk-name').allInnerTexts();
    assert.ok(names.includes('First look'), 'History has the old one too');
    assert.ok(!names.includes('Redesign Inkwell from the ground up'));
    await world(page);
  });

  await check('where it sits: Backstage from the page puts it backstage on the Desk and asks when it comes back', async () => {
    await page.locator('#wh-seat').click();
    assert.deepEqual((await page.locator('.pop-menu .pop-item').allInnerTexts()).map((t) => t.trim()), ['On stage', 'In the wings', 'Backstage']);
    await pick(page, 'Backstage');
    await page.waitForFunction(() => /backstage/i.test(document.querySelector('#wh-seat')?.innerText || ''));
    assert.deepEqual(Object.keys(await facts(page)), ['North star', 'Now', 'Next date', 'Backstage']);
    const back = page.locator('#wh-facts [data-field="back"]');
    assert.equal(await back.getAttribute('data-ph'), 'When does it come back?');
    await back.click();
    await page.keyboard.type('After the December 14 tests');
    await page.keyboard.press('Enter');
    await sleep(400);
    assert.equal((await get(page, 'wd_nb')).fields.back, 'After the December 14 tests');
    assert.equal((await get(page, 'settings-desk')).fields.stage['w:wd_nb'], 'back');
    await page.locator('#wh-seat').click();
    assert.ok((await page.locator('.pop-menu .pop-item').allInnerTexts()).some((t) => /Let Inkwell decide/.test(t)));
    await pick(page, 'Let Inkwell decide');
    await page.waitForFunction(() => /on stage/i.test(document.querySelector('#wh-seat')?.innerText || ''));
    assert.ok(!('Backstage' in (await facts(page))));
  });

  await check('a quiet life project: backstage by itself, its own words for now, steps but no status columns', async () => {
    await world(page, 'wd_camp');
    assert.match(await page.locator('#wh-seat').innerText(), /^backstage$/i);
    assert.match(await page.locator('#wh-kind').innerText(), /^life project$/i);
    const f = await facts(page);
    assert.equal(f['North star'], 'Two trips with Arrow next season.');
    assert.match(f.Now, /^Last written in Gear list\s+Aug 11$/);
    assert.equal(f.Backstage, '');
    assert.ok(!('Next date' in f));
    assert.ok(await page.locator('#wh-calls').isHidden());
    assert.ok(await page.locator('#wh-crew').isHidden());
    assert.ok(await page.locator('#wh-turns').isHidden());
    assert.ok(await page.locator('#wh-pieces-box').isHidden());
    assert.ok(await page.locator('#wh-status').isHidden());
    const input = page.locator('#wh-steps input[data-add]');
    await input.fill('Book the campsite for Friday night');
    await input.press('Enter');
    await page.waitForFunction(() => /0 of 1 done/.test(document.querySelector('#wh-steps .wp-sec')?.innerText || ''));
    assert.equal((await all(page)).find((r) => r.text === 'Book the campsite for Friday night').parent_id, 'steps-wd_camp');
    assert.ok(await page.locator('#wh-task-box').isVisible(), 'the Daybook box is still there until Daybook retires');
    // With no thread and no words of your own, a click on the line is where you write it.
    await page.locator('#wh-facts .wp-now').click({ position: { x: 4, y: 8 } });
    await page.waitForSelector('#wh-facts [data-field="now"]:focus');
    await page.keyboard.type('Gear list is current.');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Gear list is current\./.test(document.querySelector('#wh-facts .wp-now')?.innerText || ''));
    assert.equal((await get(page, 'wd_camp')).fields.now, 'Gear list is current.');
    assert.equal(await page.locator('#wh-task').getAttribute('placeholder'), 'Book the campsite for Friday night');
  });

  await check('each part can be switched off under Look', async () => {
    const flip = (name, on) => page.evaluate(([n, v]) => { const c = document.querySelector(`[data-show="${n}"]`); c.checked = v; c.dispatchEvent(new Event('change', { bubbles: true })); }, [name, on]);
    await flip('projdaybook', false);
    assert.ok(await page.locator('#wh-task-box').isHidden());
    await flip('projsteps', false);
    assert.ok(await page.locator('#wh-steps').isHidden());
    await world(page);
    await flip('projcrew', false);
    assert.ok(await page.locator('#wh-crew').isHidden());
    assert.ok(await page.locator('#wh-turns').isHidden());
    await flip('projrecent', false);
    assert.ok(await page.locator('#wh-recent-box').isHidden());
    for (const n of ['projdaybook', 'projsteps', 'projcrew', 'projrecent']) await flip(n, true);
    assert.ok(await page.locator('#wh-steps').isVisible());
    assert.ok(await page.locator('#wh-turns').isVisible());
  });

  await check('every look draws it without spilling, and nothing went wrong', async () => {
    for (const look of ['midnight', 'paper', 'slate', 'console', 'classic']) {
      await page.evaluate((l) => { document.documentElement.dataset.look = l; }, look);
      await sleep(120);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(wide <= 1, `${look} spills ${wide}`);
    }
    await page.evaluate(() => { document.documentElement.dataset.look = 'midnight'; });
    assert.deepEqual(page.errors, []);
  });
  if (SHOTS) {
    await world(page);
    await page.evaluate(() => { document.querySelector('.world-home').scrollTop = 0; });
    await page.setViewportSize({ width: 1440, height: 1500 });
    await shot(page, 'project-page');
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  await check('signed out, the page is Inkwell’s own: no calls, crew or turns, and nothing breaks', async () => {
    const solo = await open({ width: 1280, height: 860 }, { desk: false });
    await world(solo);
    const f = await facts(solo);
    assert.deepEqual(Object.keys(f), ['North star', 'Now', 'Next date']);
    assert.match(f.Now, /^Last written in Reel 2: Breakfast\s+2 h ago$/);
    assert.ok(await solo.locator('#wh-calls').isHidden());
    assert.ok(await solo.locator('#wh-crew').isHidden());
    assert.ok(await solo.locator('#wh-turns').isHidden());
    assert.match(await solo.locator('#wh-seat').innerText(), /^on stage$/i);
    assert.equal((await steps(solo)).length, 4);
    assert.deepEqual(solo.errors, []);
    await solo.context().close();
  });

  await check('on a phone it’s one column: facts stack, the columns swipe, nothing spills', async () => {
    const phone = await open({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
    await world(phone);
    await phone.waitForSelector('#wh-calls .dk-call');
    const cols = await phone.evaluate(() => getComputedStyle(document.querySelector('#wh-facts')).gridTemplateColumns.split(' ').length);
    assert.equal(cols, 1);
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 391, `page is ${wide} wide`);
    assert.ok(await phone.locator('#wh-steps .pl-task').first().isVisible());
    assert.ok(await phone.locator('#wh-steps .pl-when').first().isVisible(), 'the day shows without hovering');
    await shot(phone, 'project-phone');
    await phone.evaluate(() => document.querySelector('#wh-steps').scrollIntoView({ block: 'start' }));
    await shot(phone, 'project-phone-steps');
    assert.deepEqual(phone.errors, []);
    await phone.context().close();
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall project checks passed');
