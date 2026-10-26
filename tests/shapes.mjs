// The workflow pages: the tabs in the top strip (hidden while writing, faint
// on pages you look at, full with Alt held, gone in focus), Alt + 0 to 6; a
// world's Overview; Gather with File into… and Go through; Shape (Bible,
// Timeline, Relationships, Promises; a piece's Develop page); Write; Revise
// (with a new draft from this one); Make (the stage board, kit, shoot days);
// Deliver (files, share, posting); the Today panel; the Drawer; and life
// projects. window.__claude stands in for Claude.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4197;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;


const now = Date.now();
const row = (id, kind, parent_id, sort, extra = {}) => ({ id, kind, parent_id, sort, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now, updated_at: now, ...extra });
const para = (id, ch, sort, text, el) => row(id, 'para', ch, sort, { text, content: [{ type: 'text', text }], fields: { el } });
// The Ninja Bunch from before shapes: two reels, no shape of its own.
const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', fields: { logline: 'A family bakery raises a troupe of hopeless ninjas.' } }),
  row('pr_reel1', 'project', 'wd_nb', 1, { title: 'Reel 1: The Audition', fields: { type: 'screenplay', stage: 'Posted' } }),
  row('ac_1', 'act', 'pr_reel1', 1, { title: 'Screenplay' }),
  row('ch_1', 'chapter', 'ac_1', 1, { title: 'Script', fields: { words: 8 } }),
  para('pa_1', 'ch_1', 1024, 'INT. DOJO - DAY', 'scene'),
  para('pa_2', 'ch_1', 2048, 'Kenji freezes in front of the sensei.', 'action'),
  row('pr_reel2', 'project', 'wd_nb', 2, { title: 'Reel 2: Breakfast', fields: { type: 'screenplay', stage: 'Written' } })
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
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const get = async (p, id) => (await all(p)).find((r) => r.id === id);
const go = (p, place) => p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
const pick = async (p, label) => { await p.locator('.pop-menu .pop-item', { hasText: label }).first().click(); await sleep(300); };
const live = (rows) => rows.filter((r) => !r.deleted && !r.fields?.trashed);

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}
const SHOTS = process.env.SHOTS;
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const openNew = async (p) => {
  await go(p, { view: 'library' });
  await sleep(400);
  await p.locator('.card-new').click();
  await p.waitForSelector('#lib-new', { state: 'visible' });
};

try {
  await page.goto(URL);
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(500);
  await page.evaluate(seed, SEED);
  await page.reload();
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(700);

  await check('New asks what you are making, and says you can change it any time', async () => {
    await openNew(page);
    assert.equal(await page.locator('.lib-new-q').innerText(), 'What are you making?');
    assert.deepEqual(await page.locator('.lib-shape b').allInnerTexts(), ['One piece', 'Book series', 'Show', 'Collection', 'Universe', 'Life project']);
    assert.equal(await page.locator('.lib-shape[aria-checked="true"]').getAttribute('data-shape'), 'one');
    assert.ok(await page.locator('#lib-new-type-box').isVisible());
    assert.match(await page.locator('#lib-new').innerText(), /change this any time/);
    await page.locator('.lib-shape[data-shape="show"]').click();
    assert.ok(await page.locator('#lib-new-type-box').isHidden());
    assert.match(await page.locator('#lib-new-levels').innerText(), /Season 1 and Episode 1/);
    await page.fill('#lib-new-title', 'Bakery Nights');
    await shot(page, 'shapes-new');
  });

  await check('a Show starts with Season 1 and its first Episode, and says it is a show', async () => {
    await page.locator('#lib-new .pill').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'world');
    await sleep(500);
    const rows = live(await all(page));
    const w = rows.find((r) => r.kind === 'world' && r.title === 'Bakery Nights');
    assert.equal(w.fields.shape, 'show');
    const season = rows.find((r) => r.parent_id === w.id && r.kind === 'project');
    assert.equal(season.title, 'Season 1');
    assert.equal(season.fields.label, 'Season');
    const ep = rows.find((r) => r.parent_id === season.id && r.kind === 'project');
    assert.equal(ep.title, 'Episode 1');
    assert.equal(ep.fields.label, 'Episode');
    assert.equal(ep.fields.type, 'screenplay');
    assert.match(await page.locator('#wh-kind').innerText(), /^Show/);
    assert.equal(await page.locator('#wh-new-piece').innerText(), '+ Season');
    await shot(page, 'shapes-show');
  });

  await check('inside a Season, a new piece starts as the next Episode, written as a script', async () => {
    const rows = live(await all(page));
    const season = rows.find((r) => r.title === 'Season 1' && r.kind === 'project');
    await go(page, { view: 'project', id: season.id });
    await page.waitForFunction(() => document.querySelector('#ph-new-piece')?.textContent === '+ Episode');
    await page.locator('#ph-new-piece').click();
    await page.waitForSelector('.ask-piece');
    assert.equal(await page.locator('.ask-piece h2').innerText(), 'New episode in Season 1');
    assert.equal(await page.locator('.ask-piece input[aria-label="Name"]').inputValue(), 'Episode 2');
    assert.equal(await page.locator('.ask-piece input[aria-label="What it is"]').inputValue(), 'Episode');
    assert.equal(await page.locator('.ask-piece .chip.on').getAttribute('data-type'), 'screenplay');
    await shot(page, 'shapes-episode');
    await page.locator('.ask-piece .pill').click();
    await sleep(600);
    const ep2 = live(await all(page)).find((r) => r.title === 'Episode 2');
    assert.equal(ep2.parent_id, season.id);
    assert.equal(ep2.fields.label, 'Episode');
  });

  await check('a Book series starts with Book 1, and the next piece is Book 2', async () => {
    await openNew(page);
    await page.locator('.lib-shape[data-shape="series"]').click();
    await page.fill('#lib-new-title', 'Kenji Chronicles');
    await page.locator('#lib-new .pill').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'world');
    await sleep(500);
    const rows = live(await all(page));
    const w = rows.find((r) => r.kind === 'world' && r.title === 'Kenji Chronicles');
    const book = rows.find((r) => r.parent_id === w.id && r.kind === 'project');
    assert.equal(book.title, 'Book 1');
    assert.equal(book.fields.type, 'novel');
    assert.equal(await page.locator('#wh-new-piece').innerText(), '+ Book');
    await page.locator('#wh-new-piece').click();
    await page.waitForSelector('.ask-piece');
    assert.equal(await page.locator('.ask-piece input[aria-label="Name"]').inputValue(), 'Book 2');
    await page.locator('.ask-piece .ghost-btn', { hasText: 'Cancel' }).click();
  });

  await check('one piece still opens on its Idea page, written how you chose', async () => {
    await openNew(page);
    await page.selectOption('#lib-new-type', 'screenplay');
    await page.fill('#lib-new-title', 'The Lighthouse');
    await page.locator('#lib-new .pill').click();
    await page.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Idea');
    const rows = live(await all(page));
    const w = rows.find((r) => r.kind === 'world' && r.title === 'The Lighthouse');
    assert.equal(w.fields.shape, 'one');
    assert.equal(rows.find((r) => r.parent_id === w.id && r.kind === 'project').fields.type, 'screenplay');
  });

  await check('an older world reads as a collection, and changing its shape moves nothing', async () => {
    await go(page, { view: 'library' });
    await sleep(500);
    const card = page.locator('.card', { hasText: 'The Ninja Bunch' });
    assert.match(await card.innerText(), /collection/i);
    const before = JSON.stringify(live(await all(page)).filter((r) => r.kind === 'project').map((r) => [r.id, r.parent_id, r.title, r.fields.label || '']).sort());
    await go(page, { view: 'world', id: 'wd_nb' });
    await sleep(400);
    await page.locator('#wh-more .more-btn').click();
    await pick(page, 'Shape');
    await pick(page, 'Show:');
    await sleep(300);
    assert.equal((await get(page, 'wd_nb')).fields.shape, 'show');
    assert.match(await page.locator('.toast').innerText(), /Nothing moved/);
    // It offers to put the two reels into Season 1; leave them as they are.
    await page.waitForSelector('.ask');
    assert.match(await page.locator('.ask').innerText(), /Put these 2 pieces into Season 1\?/);
    await shot(page, 'shapes-offer');
    await page.locator('.ask .ghost-btn', { hasText: 'Leave as is' }).click();
    await sleep(300);
    const after = JSON.stringify(live(await all(page)).filter((r) => r.kind === 'project').map((r) => [r.id, r.parent_id, r.title, r.fields.label || '']).sort());
    assert.equal(after, before);
    assert.match(await page.locator('#wh-kind').innerText(), /^Show/);
    assert.equal(await page.locator('#wh-new-piece').innerText(), '+ Season');
    await shot(page, 'shapes-change');
  });

  await check('rename a Show’s levels: new pieces start as Batches and Reels; old ones keep their names', async () => {
    await page.locator('#wh-more .more-btn').click();
    await pick(page, 'Shape');
    await pick(page, 'Rename levels');
    await page.waitForSelector('.ask input');
    assert.equal(await page.locator('.ask input').inputValue(), 'Season › Episode');
    await page.fill('.ask input', 'Batch › Reel');
    await page.locator('.ask .pill').click();
    await sleep(400);
    assert.deepEqual((await get(page, 'wd_nb')).fields.levelNames, ['Batch', 'Reel']);
    assert.equal(await page.locator('#wh-new-piece').innerText(), '+ Batch');
    assert.equal((await get(page, 'pr_reel1')).title, 'Reel 1: The Audition');
    // A Batch's next piece is a Reel.
    await page.locator('#wh-new-piece').click();
    await page.waitForSelector('.ask-piece');
    assert.equal(await page.locator('.ask-piece input[aria-label="Name"]').inputValue(), 'Batch 1');
    await page.locator('.ask-piece .pill').click();
    await page.waitForFunction(() => document.querySelector('#ph-new-piece')?.textContent === '+ Reel');
    await shot(page, 'shapes-rename');
    await go(page, { view: 'world', id: 'wd_nb' });
    await sleep(400);
  });

  await check('a Show inside a Universe gives its pieces Seasons', async () => {
    await page.locator('#wh-more .more-btn').click();
    await pick(page, 'Shape');
    await pick(page, 'Universe:');
    await sleep(300);
    assert.equal(await page.locator('#wh-new-piece').innerText(), '+ Piece');
    await page.locator('#wh-new-piece').click();
    await page.waitForSelector('.ask-piece');
    await page.fill('.ask-piece input[aria-label="Name"]', 'The Reels');
    await page.fill('.ask-piece input[aria-label="What it is"]', 'Show');
    await page.locator('.ask-piece .pill').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'project');
    await page.waitForFunction(() => document.querySelector('#ph-new-piece')?.textContent === '+ Season');
  });

  await check('a life project from Shape, and back, keeps everything', async () => {
    await go(page, { view: 'world', id: 'wd_nb' });
    await sleep(400);
    await page.locator('#wh-more .more-btn').click();
    await pick(page, 'Shape');
    await pick(page, 'Life project:');
    await sleep(300);
    assert.equal((await get(page, 'wd_nb')).fields.life, true);
    await page.locator('#wh-more .more-btn').click();
    await pick(page, 'Shape');
    await pick(page, 'Show:');
    await page.waitForSelector('.ask');
    await page.locator('.ask .pill').click();
    await sleep(500);
    // Its levels were renamed Batch › Reel, so the reels go into a new Batch 1, as Reels.
    const s1 = await get(page, (await get(page, 'pr_reel1')).parent_id);
    assert.equal(s1.title, 'Batch 1');
    assert.equal(s1.parent_id, 'wd_nb');
    assert.equal((await get(page, 'pr_reel1')).fields.label, 'Reel');
    await page.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await sleep(500);
    assert.equal((await get(page, 'pr_reel1')).parent_id, 'wd_nb');
    assert.ok(!(await get(page, 'pr_reel1')).fields.label);
    assert.ok((await get(page, s1.id)).deleted);
    const w = await get(page, 'wd_nb');
    assert.ok(!w.fields.life);
    assert.equal(w.fields.shape, 'show');
    assert.equal(live(await all(page)).filter((r) => r.kind === 'project' && r.parent_id === 'wd_nb').length, 4);
  });

  await check('no page errors', async () => {
    assert.deepEqual(page.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
