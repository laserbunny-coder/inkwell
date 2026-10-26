// Stage sets: each kind of piece goes through its own stages (AI video,
// Live action, Book, Stage, Short writing), a project can rename, add,
// remove and reorder them (pieces on a removed stage move back, with Undo),
// and one piece can go through another set. In Make, each shot says how
// it's made (generated, from reference, live action), each scene how its
// voices are made, and To plan gathers what needs a shoot day or a voice
// session.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4198;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const now = Date.now();
const row = (id, kind, parent_id, sort, extra = {}) => ({ id, kind, parent_id, sort, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now, updated_at: now, ...extra });
const para = (id, ch, sort, text, el) => row(id, 'para', ch, sort, { text, content: [{ type: 'text', text }], fields: { el } });
// A made-up world for testing, not Michael's real plans.
const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch' }),
  row('pr_reel1', 'project', 'wd_nb', 1, { title: 'Reel 1: The Audition', fields: { type: 'screenplay', stage: 'Posted' } }),
  row('pr_reel2', 'project', 'wd_nb', 2, { title: 'Reel 2: Breakfast', fields: { type: 'screenplay', stage: 'Boarded' } }),
  row('ac_2', 'act', 'pr_reel2', 1, { title: 'Screenplay' }),
  row('ch_2', 'chapter', 'ac_2', 1, { title: 'Script' }),
  para('pp_1', 'ch_2', 1024, 'INT. KITCHEN - MORNING', 'scene'),
  para('pp_2', 'ch_2', 2048, 'MOM', 'character'),
  para('pp_3', 'ch_2', 3072, 'Eat your breakfast.', 'dialogue'),
  para('pp_4', 'ch_2', 4096, 'EXT. YARD - DAY', 'scene'),
  para('pp_5', 'ch_2', 5120, 'Kenji flips over the fence.', 'action'),
  row('sh_1', 'shot', 'pp_1', 1, { text: 'Mom at the stove', fields: { n: 1, piece: 'pr_reel2' } }),
  row('sh_2', 'shot', 'pp_4', 1, { text: 'The flip', fields: { n: 1, piece: 'pr_reel2' } }),
  row('pr_novel', 'project', 'wd_nb', 3, { title: 'The Bakery Book', fields: { type: 'novel', stage: 'Drafted' } })
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => { page.errors.push(e.message); if (process.env.DEBUG) console.log(e.stack); });

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}
const SHOTS = process.env.SHOTS;
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const board = (p) => p.evaluate(() => [...document.querySelectorAll('#st-board .sb-set, #st-board')].filter((x) => x.matches('.sb-set') || !x.querySelector('.sb-set')).map((set) => ({
  name: set.querySelector(':scope > .panel-label')?.textContent || '',
  cols: [...set.querySelectorAll('.sb-col')].map((c) => `${c.dataset.stage}:${c.querySelectorAll('.sb-card').length}`)
})));
const openMake = async (p) => {
  await go(p, { view: 'world', id: 'wd_nb' });
  await sleep(500);
  await p.keyboard.press('Alt+Digit5');
  await p.waitForSelector('#st-board .sb-card');
  await sleep(300);
};
const pieceSet = async (p, name) => {
  await go(p, { view: 'project', id: 'pr_reel2' });
  await p.waitForSelector('html[data-view="project"] #ph-more .more-btn');
  await sleep(400);
  // Clicked from the page itself: on the test machines Playwright's scroll
  // into view could wait on this button for the whole timeout.
  await p.evaluate(() => document.querySelector('#ph-more .more-btn').click());
  await p.waitForSelector('.pop-menu');
  await pick(p, 'Stages:');
  await pick(p, name);
  await sleep(400);
};
const openStages = async (p) => {
  await p.locator('.st-board-tools button', { hasText: 'Stages' }).click();
  await p.waitForSelector('.stage-edit');
};

try {
  await page.goto(URL);
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(500);
  await page.evaluate(seed, SEED);
  await page.reload();
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(700);

  await check('scripts go through AI video and the novel through Book, each its own row on the board', async () => {
    await openMake(page);
    const b = await board(page);
    assert.equal(b.length, 2);
    assert.equal(b[0].name, 'AI video');
    assert.deepEqual(b[0].cols, ['Idea:0', 'Written:0', 'Boarded:1', 'Generated:0', 'Edited:0', 'Posted:1']);
    assert.equal(b[1].name, 'Book');
    assert.deepEqual(b[1].cols, ['Idea:0', 'Outlined:0', 'Drafted:1', 'Revised:0', 'Edited:0', 'Published:0']);
    assert.ok(await page.locator('.sb-set').first().locator('.sb-col.out[data-stage="Posted"]').count());
    await shot(page, 'stagesets-board');
  });

  await check('Stages… renames a stage and the piece on it follows', async () => {
    await openStages(page);
    assert.equal(await page.locator('.se-use select[data-type="screenplay"]').inputValue(), 'ai');
    assert.equal(await page.locator('.se-use select[data-type="novel"]').inputValue(), 'book');
    assert.match(await page.locator('.se-row').last().innerText(), /out in the world/);
    await page.locator('.se-name').nth(2).fill('Storyboarded');
    await shot(page, 'stagesets-edit');
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    const w = await get(page, 'wd_nb');
    assert.deepEqual(w.fields.stageLists.ai, ['Idea', 'Written', 'Storyboarded', 'Generated', 'Edited', 'Posted']);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Storyboarded');
    assert.equal((await get(page, 'pr_reel1')).fields.stage, 'Posted');
    assert.deepEqual((await board(page))[0].cols.slice(0, 3), ['Idea:0', 'Written:0', 'Storyboarded:1']);
  });

  await check('removing the stage a piece is on warns first, moves it back, and Undo puts it all back', async () => {
    await openStages(page);
    await page.locator('.se-row').nth(2).locator('button', { hasText: 'Remove' }).click();
    assert.match(await page.locator('.se-moves').innerText(), /Reel 2: Breakfast is on Storyboarded; it will move to Written\./);
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Written');
    assert.deepEqual((await get(page, 'wd_nb')).fields.stageLists.ai, ['Idea', 'Written', 'Generated', 'Edited', 'Posted']);
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(600);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Storyboarded');
    assert.deepEqual((await get(page, 'wd_nb')).fields.stageLists.ai, ['Idea', 'Written', 'Storyboarded', 'Generated', 'Edited', 'Posted']);
  });

  await check('adding a stage puts it before the last one; Back to the usual stages undoes the names', async () => {
    await openStages(page);
    await page.locator('.se-tools button', { hasText: '+ Add a stage' }).click();
    const names = await page.locator('.se-name').evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(names, ['Idea', 'Written', 'Storyboarded', 'Generated', 'Edited', 'New stage', 'Posted']);
    await page.locator('.se-tools button', { hasText: 'Back to the usual AI video stages' }).click();
    const back = await page.locator('.se-name').evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(back, ['Idea', 'Written', 'Boarded', 'Generated', 'Edited', 'Posted']);
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nb')).fields.stageLists, undefined);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Boarded');
  });

  await check('a project can send its scripts through Live action; a piece keeps its point (Boarded becomes Prepped)', async () => {
    await openStages(page);
    await page.selectOption('.se-use select[data-type="screenplay"]', 'live');
    assert.equal(await page.locator('.se-tabs .chip.on').getAttribute('data-set'), 'live');
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nb')).fields.stageFor.screenplay, 'live');
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Prepped');
    assert.equal((await get(page, 'pr_reel1')).fields.stage, 'Released');
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nb')).fields.stageFor, undefined);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Boarded');
    assert.equal((await get(page, 'pr_reel1')).fields.stage, 'Posted');
  });

  await check('one piece can go through another set, from its menu', async () => {
    // The piece page holds still once drawn (nothing redraws it over and over).
    await go(page, { view: 'project', id: 'pr_reel2' });
    await page.waitForSelector('html[data-view="project"] #ph-more .more-btn');
    await sleep(500);
    const redraws = await page.evaluate(() => new Promise((res) => {
      let n = 0;
      const o = new MutationObserver(() => { n += 1; });
      o.observe(document.querySelector('#ph-more'), { childList: true });
      setTimeout(() => { o.disconnect(); res(n); }, 1500);
    }));
    assert.equal(redraws, 0, `the piece page redrew ${redraws} times while idle`);
    await pieceSet(page, 'Live action');
    const p = await get(page, 'pr_reel2');
    assert.equal(p.fields.stageSet, 'live');
    assert.equal(p.fields.stage, 'Prepped');
    assert.equal(await page.locator('#ph-stage').inputValue(), 'Prepped');
    await openMake(page);
    const b = await board(page);
    assert.deepEqual(b.map((x) => x.name), ['AI video', 'Live action', 'Book']);
    assert.equal(b[1].cols[2], 'Prepped:1');
  });

  await check('a live-action piece starts its shots as Live action; one can be marked generated, with Undo', async () => {
    await go(page, { view: 'production', id: 'pr_reel2', tab: 'shots' });
    await page.waitForSelector('.pd-scene[data-scene="pp_1"] .pd-shot');
    assert.equal(await page.locator('.pd-shot[data-shot="sh_1"]').getAttribute('data-made'), 'live');
    assert.equal(await page.locator('.pd-shot[data-shot="sh_1"] .pd-made').innerText(), 'Live action');
    await page.locator('.pd-shot[data-shot="sh_1"] .pd-made').click();
    await pick(page, 'Generated');
    await sleep(400);
    assert.equal((await get(page, 'sh_1')).fields.made, 'gen');
    assert.equal(await page.locator('.pd-shot[data-shot="sh_1"] .pd-made').count(), 0);
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(500);
    assert.equal((await get(page, 'sh_1')).fields.made, undefined);
  });

  await check('back on AI video, a shot can be made from reference; the scene knows its voices', async () => {
    await pieceSet(page, 'AI video');
    const p = await get(page, 'pr_reel2');
    assert.equal(p.fields.stageSet, undefined);
    assert.equal(p.fields.stage, 'Boarded');
    await go(page, { view: 'production', id: 'pr_reel2', tab: 'shots' });
    await sleep(600);
    await page.waitForSelector('.pd-shot[data-shot="sh_2"][data-made="gen"]');
    await page.locator('.pd-shot[data-shot="sh_2"] .more-btn').click();
    await pick(page, 'Made by');
    await pick(page, 'From reference');
    await sleep(400);
    assert.equal((await get(page, 'sh_2')).fields.made, 'ref');
    assert.equal(await page.locator('.pd-shot[data-shot="sh_2"] .pd-made').innerText(), 'From reference');
    // Only the kitchen has lines, so only it asks about voices.
    assert.equal(await page.locator('.pd-scene[data-scene="pp_1"] .pd-audio').innerText(), 'Recorded voices');
    assert.equal(await page.locator('.pd-scene[data-scene="pp_4"] .pd-audio').count(), 0);
    await shot(page, 'stagesets-made');
  });

  await check('To plan gathers shots to film and voices to record, and makes the days', async () => {
    await page.locator('.gv-levels .chip[data-tab="days"]').click();
    await page.waitForSelector('.pd-plan');
    const t = await page.locator('.pd-plan').innerText();
    assert.match(t, /1 shot to film[\s\S]*EXT\. YARD - DAY[\s\S]*from reference/i);
    assert.match(t, /1 scene with voices to record[\s\S]*INT\. KITCHEN - MORNING/);
    await shot(page, 'stagesets-plan');
    await page.locator('.pd-plan .pill', { hasText: 'new voice session' }).click();
    await page.waitForSelector('.pd-sheet');
    const days = (await all(page)).filter((r) => r.kind === 'shootday' && !r.deleted);
    assert.equal(days.length, 1);
    assert.equal(days[0].fields.type, 'voice');
    assert.deepEqual(days[0].fields.scenes, ['pp_1']);
    const sheet = await page.locator('.pd-sheet').innerText();
    assert.match(sheet, /Voice session[\s\S]*MOM: Eat your breakfast\./i);
    assert.doesNotMatch(sheet, /Props|Locations/);
    assert.match(await page.locator('.pd-days .chip[data-type="voice"]').innerText(), /^Voices · /);
    await shot(page, 'stagesets-voice');
  });

  await check('a scene can have generated voices, then nothing is left to record', async () => {
    await page.locator('.gv-levels .chip[data-tab="shots"]').click();
    await page.waitForSelector('.pd-scene[data-scene="pp_1"] .pd-audio');
    await page.locator('.pd-scene[data-scene="pp_1"] .pd-audio').click();
    await pick(page, 'Generated voices');
    await sleep(400);
    assert.equal((await get(page, 'bd-pp_1')).fields.audio, 'generated');
    assert.equal(await page.locator('.pd-scene[data-scene="pp_1"] .pd-audio').innerText(), 'Generated voices');
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(400);
    assert.equal((await get(page, 'bd-pp_1')).fields.audio, null);
  });

  await check('nothing broke', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
