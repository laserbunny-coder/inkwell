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
  row('pr_novel', 'project', 'wd_nb', 3, { title: 'The Bakery Book', fields: { type: 'novel', stage: 'Drafted' } }),
  row('wd_poems', 'world', null, 2, { title: 'Morning Poems' }),
  row('pr_poem', 'project', 'wd_poems', 1, { title: 'Flour Dust', fields: { type: 'novel', stage: 'Idea', stageSet: 'short' } })
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
const board = (p) => p.evaluate(() => [...document.querySelectorAll('#wh-board .sb-set, #wh-board')].filter((x) => x.matches('.sb-set') || !x.querySelector('.sb-set')).map((set) => ({
  name: set.querySelector(':scope > .panel-label')?.textContent || '',
  cols: [...set.querySelectorAll('.sb-col')].map((c) => `${c.dataset.stage}:${c.querySelectorAll('.sb-card').length}`)
})));
const openMake = async (p) => {
  await go(p, { view: 'world', id: 'wd_nb' });
  await p.waitForSelector('#wh-board .sb-card');
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
  await p.locator('#wh-workflow').click();
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
    assert.deepEqual(b[0].cols, ['New idea:0', 'Writing:0', 'Boarding:1', 'Generating:0', 'Editing:0', 'Posted:1']);
    assert.equal(b[1].name, 'Book');
    assert.deepEqual(b[1].cols, ['New idea:0', 'Outlining:0', 'Drafting:1', 'Revising:0', 'Editing:0', 'Published:0']);
    assert.ok(await page.locator('.sb-set').first().locator('.sb-col.out[data-stage="Posted"]').count());
    await shot(page, 'stagesets-board');
  });

  await check('Workflow… renames a step and the piece on it follows', async () => {
    await openStages(page);
    assert.equal(await page.locator('.se-use select[data-type="screenplay"]').inputValue(), 'ai');
    assert.equal(await page.locator('.se-use select[data-type="novel"]').inputValue(), 'book');
    assert.equal(await page.locator('.se-list .se-row:has(.se-name)').last().locator('.se-out').count(), 1);
    await page.locator('.se-name').nth(2).fill('Storyboarded');
    await shot(page, 'stagesets-edit');
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    const w = await get(page, 'wd_nb');
    assert.deepEqual(w.fields.stageLists.ai, ['New idea', 'Writing', 'Storyboarded', 'Generating', 'Editing', 'Posted']);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Storyboarded');
    assert.equal((await get(page, 'pr_reel1')).fields.stage, 'Posted');
    assert.deepEqual((await board(page))[0].cols.slice(0, 3), ['New idea:0', 'Writing:0', 'Storyboarded:1']);
  });

  await check('removing the stage a piece is on warns first, moves it back, and Undo puts it all back', async () => {
    await openStages(page);
    await page.locator('.se-row').nth(2).locator('.se-del').click();
    assert.match(await page.locator('.se-moves').innerText(), /Reel 2: Breakfast is on Storyboarded; it will move to Writing\./);
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Writing');
    assert.deepEqual((await get(page, 'wd_nb')).fields.stageLists.ai, ['New idea', 'Writing', 'Generating', 'Editing', 'Posted']);
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(600);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Storyboarded');
    assert.deepEqual((await get(page, 'wd_nb')).fields.stageLists.ai, ['New idea', 'Writing', 'Storyboarded', 'Generating', 'Editing', 'Posted']);
  });

  await check('adding a stage puts it before the last one; Back to the usual stages undoes the names', async () => {
    await openStages(page);
    await page.locator('.se-add').click();
    const names = await page.locator('.se-name').evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(names, ['New idea', 'Writing', 'Storyboarded', 'Generating', 'Editing', 'New step', 'Posted']);
    await page.locator('.se-reset', { hasText: 'Back to the usual AI video' }).click();
    const back = await page.locator('.se-name').evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(back, ['New idea', 'Writing', 'Boarding', 'Generating', 'Editing', 'Posted']);
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nb')).fields.stageLists, undefined);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Boarding');
  });

  await check('a project can send its scripts through Live action; a piece keeps its point (Boarding becomes Prepping)', async () => {
    await openStages(page);
    await page.selectOption('.se-use select[data-type="screenplay"]', 'live');
    assert.equal(await page.locator('.se-tabs .chip.on').getAttribute('data-set'), 'live');
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nb')).fields.stageFor.screenplay, 'live');
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Prepping');
    assert.equal((await get(page, 'pr_reel1')).fields.stage, 'Released');
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nb')).fields.stageFor, undefined);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, 'Boarding');
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
    assert.equal(p.fields.stage, 'Prepping');
    assert.equal(await page.locator('#ph-stage').inputValue(), 'Prepping');
    await openMake(page);
    const b = await board(page);
    assert.deepEqual(b.map((x) => x.name), ['AI video', 'Live action', 'Book']);
    assert.equal(b[1].cols[2], 'Prepping:1');
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
    assert.equal(p.fields.stage, 'Boarding');
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

  await check('a book’s Make puts the video tools away; it can still ask for them, with Undo', async () => {
    await go(page, { view: 'production', id: 'pr_novel' });
    await page.waitForSelector('.pd-notvideo');
    assert.match(await page.locator('.pd-notvideo').innerText(), /goes through Book stages, so the video tools[\s\S]*beta readers/);
    assert.equal(await page.locator('.prod-view .gv-levels').count(), 0);
    await shot(page, 'stagesets-book-make');
    await page.locator('.pd-notvideo button', { hasText: 'Use the video tools anyway' }).click();
    await page.waitForSelector('.prod-view .gv-levels .chip[data-tab="shots"]');
    assert.equal((await get(page, 'pr_novel')).fields.videoTools, true);
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await page.waitForSelector('.pd-notvideo');
    assert.equal((await get(page, 'pr_novel')).fields.videoTools, undefined);
  });

  await check('a world with nothing to film has no Shoot days in Make; one with scripts does', async () => {
    await go(page, { view: 'world', id: 'wd_poems' });
    await page.waitForSelector('#wh-board .sb-card');
    assert.deepEqual((await board(page))[0].cols, ['New idea:1', 'Drafting:0', 'Polishing:0', 'Out:0']);
    await go(page, { view: 'stage', id: 'wd_poems', page: 'make' });
    await page.waitForSelector('.st-chips .chip');
    assert.deepEqual(await page.locator('.st-chips .chip').evaluateAll((els) => els.map((e) => e.dataset.sub)), ['kit']);
    await go(page, { view: 'stage', id: 'wd_nb', page: 'make' });
    // The old world's tabs can still be up for a moment; wait for this one's.
    await page.waitForFunction(() => document.querySelectorAll('.st-chips .chip').length === 2).catch(() => {});
    assert.deepEqual(await page.locator('.st-chips .chip').evaluateAll((els) => els.map((e) => e.dataset.sub)), ['kit', 'days']);
  });

  await check('a step moves with Alt + Left; a tool turned off leaves Make; Undo brings both back', async () => {
    await openMake(page);
    await openStages(page);
    await page.locator('.se-tabs .chip[data-set="ai"]').click();
    await page.locator('.se-name').nth(2).focus();
    await page.keyboard.press('Alt+ArrowLeft');
    assert.deepEqual(await page.locator('.se-name').evaluateAll((els) => els.map((e) => e.value)), ['New idea', 'Boarding', 'Writing', 'Generating', 'Editing', 'Posted']);
    // Focus follows the step, so it can keep moving.
    assert.equal(await page.evaluate(() => document.activeElement.value), 'Boarding');
    await page.locator('.se-toolchips .chip[data-tool="days"]').click();
    assert.equal(await page.locator('.se-toolchips .chip[data-tool="days"]').getAttribute('aria-pressed'), 'false');
    await shot(page, 'workflow-edit');
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    const w = await get(page, 'wd_nb');
    assert.deepEqual(w.fields.stageLists.ai, ['New idea', 'Boarding', 'Writing', 'Generating', 'Editing', 'Posted']);
    assert.deepEqual(w.fields.toolLists.ai, ['shots', 'board', 'kit']);
    await go(page, { view: 'production', id: 'pr_reel1', tab: 'shots' });
    await page.waitForSelector('.prod-view .gv-levels .chip[data-tab="shots"]');
    assert.deepEqual(await page.locator('.prod-view .gv-levels .chip').evaluateAll((els) => els.map((e) => e.dataset.tab)), ['shots', 'board', 'kit']);
    await shot(page, 'workflow-make-tools');
    await openMake(page);
    await openStages(page);
    await page.locator('.se-tabs .chip[data-set="ai"]').click();
    await page.locator('.se-reset').click();
    assert.equal(await page.locator('.se-toolchips .chip[data-tool="days"]').getAttribute('aria-pressed'), 'true');
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nb')).fields.toolLists, undefined);
  });

  await check('Save as my own workflow keeps it on every device and points the project at it', async () => {
    await openStages(page);
    await page.locator('.se-tabs .chip[data-set="ai"]').click();
    await page.locator('.se-add').click();
    await page.locator('.se-name').nth(5).fill('Live shoot');
    await page.locator('.se-keep').click();
    await page.fill('.se-own-name', 'Reels with a live shoot');
    await page.locator('.se-tools .pill', { hasText: 'Keep' }).click();
    await sleep(400);
    const own = (await all(page)).find((r) => r.kind === 'workflow');
    assert.ok(own, 'the workflow is saved');
    assert.equal(own.title, 'Reels with a live shoot');
    assert.deepEqual({ base: own.fields.base, stages: own.fields.stages, tools: own.fields.tools }, { base: 'ai', stages: ['New idea', 'Writing', 'Boarding', 'Generating', 'Editing', 'Live shoot', 'Posted'], tools: ['shots', 'board', 'kit', 'days'] });
    assert.equal(await page.locator('.stage-edit .se-tabs .chip.on').getAttribute('data-set'), own.id);
    assert.equal(await page.locator('.se-use select[data-type="screenplay"]').inputValue(), own.id);
    await shot(page, 'workflow-own');
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nb')).fields.stageFor.screenplay, own.id);
    assert.equal((await get(page, 'wd_nb')).fields.stageLists, undefined);
    assert.equal((await get(page, 'pr_reel1')).fields.stage, 'Posted');
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nb')).fields.stageFor?.screenplay, undefined);
  });

  await check('New fills in how it gets made from what you are making, and Customize changes it in place', async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+K');
    await page.keyboard.type('New show');
    await page.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('New show'));
    await page.keyboard.press('Enter');
    await page.waitForSelector('#lib-new', { state: 'visible' });
    await page.waitForSelector('#lib-new-how .se-tabs .chip.on');
    assert.equal(await page.locator('#lib-new-how .se-tabs .chip.on').getAttribute('data-set'), 'ai');
    assert.match(await page.locator('#lib-new-how .se-preview').innerText(), /New idea › Writing › Boarding › Generating › Editing › Posted[\s\S]*Make: Shots, Storyboard, Kit, Shoot days/);
    await shot(page, 'workflow-new-preview');
    // A book series starts as Book; a life project has no workflow.
    await page.locator('.lib-shape[data-shape="series"]').click();
    assert.equal(await page.locator('#lib-new-how .se-tabs .chip.on').getAttribute('data-set'), 'book');
    await page.locator('.lib-shape[data-shape="life"]').click();
    assert.equal(await page.locator('#lib-new-how').isHidden(), true);
    await page.locator('.lib-shape[data-shape="show"]').click();
    // Your own workflow is under More.
    await page.locator('#lib-new-how .se-more').click();
    assert.ok(await page.locator('#lib-new-how .se-tabs .chip', { hasText: 'Reels with a live shoot' }).count());
    await page.locator('#lib-new-how .se-tabs .chip[data-set="ai"]').click();
    await page.locator('#lib-new-how .se-customize').click();
    await page.locator('#lib-new-how .se-name').nth(1).fill('Scripted');
    await page.locator('#lib-new-how .se-toolchips .chip[data-tool="kit"]').click();
    await shot(page, 'workflow-new');
    await page.fill('#lib-new-title', 'Bakery Nights');
    await page.locator('#lib-new button[type="submit"]').click();
    await sleep(800);
    const w = (await all(page)).find((r) => r.kind === 'world' && r.title === 'Bakery Nights');
    assert.equal(w.fields.shape, 'show');
    assert.deepEqual(w.fields.stageLists, { ai: ['New idea', 'Scripted', 'Boarding', 'Generating', 'Editing', 'Posted'] });
    assert.deepEqual(w.fields.toolLists, { ai: ['shots', 'board', 'days'] });
    assert.equal(w.fields.stageFor, undefined);
  });

  await check('your own workflow can be deleted: it warns who uses it, moves their pieces to the usual steps, and Undo puts it back', async () => {
    const own = (await all(page)).find((r) => r.kind === 'workflow' && !r.deleted);
    await openMake(page);
    await openStages(page);
    await page.selectOption('.se-use select[data-type="screenplay"]', own.id);
    await page.locator('.stage-edit .pill.primary').click();
    await sleep(600);
    assert.equal((await get(page, 'wd_nb')).fields.stageFor.screenplay, own.id);
    const reel2 = (await get(page, 'pr_reel2')).fields.stage;
    await openStages(page);
    assert.equal(await page.locator('.stage-edit .se-tabs .chip.on').getAttribute('data-set'), own.id);
    await page.locator('.se-delown').click();
    await page.waitForSelector('.se-delask');
    assert.match(await page.locator('.se-delask').innerText(), /Delete “Reels with a live shoot”\? The Ninja Bunch uses it; its pieces move to the matching AI video steps\. You can undo\./);
    await shot(page, 'workflow-delete');
    await page.locator('.se-delyes').click();
    await page.waitForSelector('.stage-edit', { state: 'detached' });
    await sleep(500);
    assert.equal((await get(page, own.id)).deleted, true);
    assert.equal((await get(page, 'wd_nb')).fields.stageFor.screenplay, 'ai');
    assert.equal((await get(page, 'pr_reel1')).fields.stage, 'Posted');
    assert.ok(['New idea', 'Writing', 'Boarding', 'Generating', 'Editing', 'Posted'].includes((await get(page, 'pr_reel2')).fields.stage));
    await page.locator('.toast button', { hasText: 'Undo' }).click();
    await sleep(600);
    assert.ok(!(await get(page, own.id)).deleted);
    assert.equal((await get(page, 'wd_nb')).fields.stageFor.screenplay, own.id);
    assert.equal((await get(page, 'pr_reel2')).fields.stage, reel2);
  });

  await check('it can be deleted from New too, and leaves the More list', async () => {
    const own = (await all(page)).find((r) => r.kind === 'workflow' && !r.deleted);
    await page.keyboard.press('Control+K');
    await page.keyboard.type('New show');
    await page.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('New show'));
    await page.keyboard.press('Enter');
    await page.waitForSelector('#lib-new-how .se-tabs .chip.on');
    await page.locator('#lib-new-how .se-more').click();
    await page.locator(`#lib-new-how .se-tabs .chip[data-set="${own.id}"]`).click();
    await page.locator('#lib-new-how .se-customize').click();
    await page.locator('#lib-new-how .se-delown').click();
    await page.locator('#lib-new-how .se-delyes').click();
    await page.waitForSelector('#lib-new-how .se-tabs .chip.on[data-set="ai"]');
    assert.equal(await page.locator(`#lib-new-how .se-tabs .chip[data-set="${own.id}"]`).count(), 0);
    assert.equal((await get(page, own.id)).deleted, true);
    await page.keyboard.press('Escape');
  });

  await check('nothing broke', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
