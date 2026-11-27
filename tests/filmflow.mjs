// The film path from script to edit (Nov 27 2026). Build 1: one shot list in
// Make (Shots and Storyboard are one tab, List or Frames, with Play; the old
// 'board' place lands on Frames), the note for the day in the script's shot
// card, and "Before the shoot" with its doors.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4331;
const server = await serve(PORT);
const SHOTS = process.env.SHOTS || '';

const table = new Map();
let clock = Date.parse('2026-11-27T00:00:00Z');
const tick = () => new Date((clock += 1000)).toISOString();
function remote(op, arg) {
  if (op === 'push') {
    const stamp = tick();
    return arg.map((r) => { table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp }); return { id: r.id, updated_at: stamp }; });
  }
  if (op === 'pull') {
    return [...table.values()].filter((r) => r.updated_at > arg.since)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1))
      .slice(arg.from, arg.from + 500);
  }
}
const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    subscribe() {}, unsubscribe() {}
  };
};
const put = (r) => {
  const at = tick();
  table.set(r.id, { parent_id: null, sort: 0, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: Date.parse(at), ...r, user_id: 'u1', updated_at: at });
};
const para = (id, parent, sort, text, fields = {}) => put({ id, kind: 'para', parent_id: parent, sort, text, content: text ? [{ type: 'text', text }] : null, fields });
put({ id: 'area-film', kind: 'area', title: 'Filmmaking', sort: 1 });
// Salt Road, shot with a camera: two scenes, three shots, one shoot day with
// the first scene only; June is cast, the Clerk isn't.
put({ id: 'wd_sr', kind: 'world', title: 'Salt Road', area_id: 'area-film' });
put({ id: 'pg_june', kind: 'page', parent_id: 'wd_sr', title: 'June', sort: 1, fields: { element: { type: 'character', playedBy: 'Elle' } } });
put({ id: 'pg_clerk', kind: 'page', parent_id: 'wd_sr', title: 'Clerk', sort: 2, fields: { element: { type: 'character' } } });
put({ id: 'pr_salt', kind: 'project', parent_id: 'wd_sr', title: 'Salt Road', area_id: 'area-film', sort: 1, fields: { type: 'screenplay', woven: true, stage: 'Prepping', stageSet: 'live' } });
put({ id: 'ac_s', kind: 'act', parent_id: 'pr_salt', title: 'Screenplay', sort: 1 });
put({ id: 'ch_s1', kind: 'chapter', parent_id: 'ac_s', title: 'Script', sort: 1 });
put({ id: 'sc_s1', kind: 'scene', parent_id: 'ch_s1', sort: 1024, title: 'The office', fields: { level: 3 } });
para('pp_s1', 'ch_s1', 2048, 'INT. MOTEL OFFICE - NIGHT', { el: 'scene' });
para('pp_s2', 'ch_s1', 3072, 'June shakes the rain off at the counter.', { el: 'action' });
para('pp_s2b', 'ch_s1', 3584, 'The bell on the door is still ringing.', { el: 'action' });
put({ id: 'sc_s2', kind: 'scene', parent_id: 'ch_s1', sort: 4096, title: 'Room nine', fields: { level: 3 } });
para('pp_s3', 'ch_s1', 5120, 'INT. ROOM 9 - NIGHT', { el: 'scene' });
para('pp_s4', 'ch_s1', 6144, 'The key does not fit.', { el: 'action' });
put({ id: 'sh_a', kind: 'shot', parent_id: 'pp_s1', sort: 1024, text: 'June at the counter', fields: { n: 1, piece: 'pr_salt', framing: 'Wide', from: 'pp_s2', to: 'pp_s2' } });
put({ id: 'sh_b', kind: 'shot', parent_id: 'pp_s1', sort: 2048, text: 'The bell', fields: { n: 2, piece: 'pr_salt', framing: 'Insert' } });
put({ id: 'sh_c', kind: 'shot', parent_id: 'pp_s3', sort: 1024, text: 'The key', fields: { n: 1, piece: 'pr_salt', framing: 'Close-up', from: 'pp_s4', to: 'pp_s4' } });
put({ id: 'pg_office', kind: 'page', parent_id: 'wd_sr', title: 'Starlite office', sort: 3, fields: { element: { type: 'location' } } });
put({ id: 'bd-pp_s1', kind: 'breakdown', parent_id: 'pp_s1', fields: { add: ['pg_june', 'pg_clerk', 'pg_office'], drop: [], piece: 'pr_salt' } });
put({ id: 'sd_1', kind: 'shootday', parent_id: 'pr_salt', fields: { date: '2026-12-05', call: '18:00', place: 'Starlite Motel', scenes: ['pp_s1'] } });
// A generated reel in the same world.
put({ id: 'pr_gen', kind: 'project', parent_id: 'wd_sr', title: 'Salt Road teaser', area_id: 'area-film', sort: 2, fields: { type: 'screenplay', woven: true, stage: 'Generating', stageSet: 'ai' } });
put({ id: 'ac_g', kind: 'act', parent_id: 'pr_gen', title: 'Screenplay', sort: 1 });
put({ id: 'ch_g1', kind: 'chapter', parent_id: 'ac_g', title: 'Script', sort: 1 });
put({ id: 'sc_g1', kind: 'scene', parent_id: 'ch_g1', sort: 1024, title: 'Neon', fields: { level: 3 } });
para('pp_g1', 'ch_g1', 2048, 'EXT. MOTEL LOT - NIGHT', { el: 'scene' });
para('pp_g2', 'ch_g1', 3072, 'The VACANCY sign buzzes.', { el: 'action' });
put({ id: 'sh_g1', kind: 'shot', parent_id: 'pp_g1', sort: 1024, text: 'The sign', fields: { n: 1, piece: 'pr_gen', from: 'pp_g2', to: 'pp_g2' } });
put({ id: 'sh_g2', kind: 'shot', parent_id: 'pp_g1', sort: 2048, text: 'Rain on the lot', fields: { n: 2, piece: 'pr_gen', from: 'pp_g2', to: 'pp_g2', still: 'Rain on a motel lot, sodium light' } });

let failed = 0;
const errors = [];
let p;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) {
    failed += 1;
    const at = (e.stack || '').split('\n').find((l) => l.includes('filmflow.mjs')) || '';
    console.log(`FAIL ${name}\n     ${e.message}\n     ${at.trim()}`);
  }
}
const snap = async (n) => { if (SHOTS) { await sleep(400); await p.screenshot({ path: `${SHOTS}/${n}.png` }); } };
const until = (fn, arg, timeout = 15000) => p.waitForFunction(fn, arg, { timeout }).catch((e) => { throw new Error(`waited for ${String(fn).slice(0, 110)}: ${e.message.split('\n')[0]}`); });
const goThen = async (place, ready) => {
  for (let i = 0; ; i++) {
    await p.evaluate((pl) => window.__go(pl), place);
    try { await p.waitForFunction(ready, null, { timeout: 8000 }); return; } catch (e) { if (i >= 2) throw e; }
  }
};
const db = (id) => p.evaluate((i) => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get(i); q.onsuccess = () => res(q.result); }; }), id);
const dbUntil = (id, test) => until(([i, t]) => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get(i); q.onsuccess = () => res(new Function('x', `return ${t}`)(q.result)); }; }), [id, test]);
const idbPut = (row) => p.evaluate((r) => new Promise((res) => { const o = indexedDB.open('writing'); o.onsuccess = () => { const t = o.result.transaction('entries', 'readwrite'); t.objectStore('entries').put(r); t.oncomplete = () => res(); }; }), row);
const make = (id, tab) => goThen({ view: 'production', id, ...(tab ? { tab } : {}) }, () => document.documentElement.dataset.view === 'production' && !!document.querySelector('.prod-view .pd-body'));
const readyLines = () => p.$$eval('.pd-ready-line', (ls) => ls.map((l) => `${l.dataset.ready}|${l.querySelector('.pd-ready-v')?.textContent || ''}`));

const browser = await chromium.launch();
// A phone of its own (a real touch screen), synced from the same account.
async function onPhone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark', deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  const ph = await ctx.newPage();
  ph.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await ph.goto(`http://localhost:${PORT}/`);
  const keep = p;
  p = ph;
  await until(() => !!window.__go);
  await dbUntil('sh_c', '!!x');
  return async () => { await ctx.close(); p = keep; };
}
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark', deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://localhost:${PORT}/`);
  await until(() => !!window.__go);
  await dbUntil('sh_c', '!!x');

  await check('Make has three tabs: Shots (List or Frames, with Play), Cast and places, Shoot days', async () => {
    await make('pr_salt', 'shots');
    await until(() => !!document.querySelector('.pd-shot'));
    assert.deepEqual(await p.$$eval('.prod-view .gv-levels .chip', (cs) => cs.map((c) => c.textContent)), ['Shots', 'Cast and places', 'Shoot days']);
    assert.equal(await p.getAttribute('.pd-view[data-view="list"]', 'aria-pressed'), 'true');
    assert.equal(await p.locator('.pd-board-tools .pill', { hasText: 'Play' }).count(), 1);
    await until(() => /^0 of 3 got$/.test(document.querySelector('.pd-got-count')?.textContent || ''));
    assert.equal(await p.locator('.pd-shot .pd-thumb.empty').count(), 3, 'every row starts with its frame (empty here)');
    await snap('filmflow-list');
    await p.click('.pd-view[data-view="frames"]');
    await until(() => document.querySelectorAll('.pd-board .pd-card').length === 3);
    assert.equal(await p.locator('.pd-board-tools .pill', { hasText: 'Play' }).count(), 1, 'Play in both');
    await snap('filmflow-frames');
    // Frames is remembered on this device.
    await make('pr_salt', 'shots');
    await until(() => document.querySelectorAll('.pd-board .pd-card').length === 3);
    await p.click('.pd-view[data-view="list"]');
    await until(() => !!document.querySelector('.pd-shot'));
  });

  await check('the old Storyboard place lands on Shots with Frames on', async () => {
    await make('pr_salt', 'board');
    await until(() => document.querySelector('.prod-view .chip[data-tab="shots"]')?.getAttribute('aria-selected') === 'true' && document.querySelector('.pd-view[data-view="frames"]')?.getAttribute('aria-pressed') === 'true' && !!document.querySelector('.pd-board .pd-card'));
    assert.equal(await p.evaluate(() => localStorage.getItem('prodTab')), 'shots');
    await p.evaluate(() => localStorage.setItem('prodTab', 'board'));
    await make('pr_salt');
    await until(() => !!document.querySelector('.pd-board .pd-card') && document.querySelector('.prod-view .chip[data-tab="shots"]')?.getAttribute('aria-selected') === 'true');
    await p.click('.pd-view[data-view="list"]');
  });

  await check('Before the shoot: four lines, each counted, each a door', async () => {
    await make('pr_salt', 'shots');
    await until(() => document.querySelectorAll('.pd-ready-line').length === 4);
    assert.deepEqual(await readyLines(), ['lines|1 line without one', 'frames|3 to draw', 'days|1 scene not on a day', 'cast|Clerk is not cast']);
    await snap('filmflow-ready');
    await p.click('.pd-ready-line[data-ready="frames"] .pd-ready-door');
    await until(() => document.querySelector('.pd-view[data-view="frames"]')?.getAttribute('aria-pressed') === 'true' && !!document.querySelector('.pd-board .pd-card'));
    await p.click('.pd-view[data-view="list"]');
    await until(() => !!document.querySelector('.pd-ready-line[data-ready="days"]'));
    await p.click('.pd-ready-line[data-ready="days"] .pd-ready-door');
    await until(() => document.querySelector('.prod-view .chip[data-tab="days"]')?.getAttribute('aria-selected') === 'true');
    await p.click('.prod-view .chip[data-tab="shots"]');
    await until(() => !!document.querySelector('.pd-ready-line[data-ready="cast"]'));
    await p.click('.pd-ready-line[data-ready="cast"] .pd-ready-door');
    await until(() => document.querySelector('.prod-view .chip[data-tab="kit"]')?.getAttribute('aria-selected') === 'true');
    await p.click('.prod-view .chip[data-tab="shots"]');
    await until(() => !!document.querySelector('.pd-ready-line[data-ready="lines"]'));
    await p.click('.pd-ready-line[data-ready="lines"] .pd-ready-door');
    await until(() => !document.documentElement.dataset.view && !!window.__editor && document.documentElement.classList.contains('ss-on'));
  });

  await check('a line ticks when nothing is missing; it folds away', async () => {
    // The second scene goes on the day, from the day's form.
    await make('pr_salt', 'days');
    await p.locator('.pd-days .chip', { hasText: 'Dec' }).first().click();
    await p.click('.pd-day-plan');
    await p.locator('.pd-daypick .chip', { hasText: 'Room nine' }).click();
    await dbUntil('sd_1', "x.fields.scenes.includes('pp_s3')");
    await p.click('.pd-day-plan');
    await p.click('.prod-view .chip[data-tab="shots"]');
    await until(() => !!document.querySelector('.pd-ready-line.ok[data-ready="days"]'));
    assert.equal(await p.locator('.pd-ready-line[data-ready="days"] .pd-ready-v.ok').innerText(), '✓');
    await p.click('.pd-ready-head');
    await until(() => document.querySelector('.pd-ready')?.classList.contains('folded') && !document.querySelector('.pd-ready-line'));
    assert.match(await p.locator('.pd-ready-sum').innerText(), /^3 to do$/);
    await p.click('.pd-ready-head');
    await until(() => document.querySelectorAll('.pd-ready-line').length === 4);
  });

  await check('a generated piece shows only the first two lines', async () => {
    await make('pr_gen', 'shots');
    await until(() => !!document.querySelector('.pd-ready'));
    assert.deepEqual(await readyLines(), ['lines|✓', 'frames|2 to draw']);
    assert.match(await p.locator('.pd-ready .panel-label').innerText(), /Before generating/i);
  });

  await check('the note for the day: typed in Make, it shows in the script’s shot card, and back', async () => {
    await make('pr_salt', 'shots');
    await until(() => !!document.querySelector('.pd-shot[data-shot="sh_a"]'));
    await p.click('.pd-shot[data-shot="sh_a"] .pd-toggle');
    await p.fill('.pd-shot[data-shot="sh_a"] .pd-note', '35mm, slow push in');
    await p.locator('.gv-title').click();
    await dbUntil('sh_a', "x.fields.note === '35mm, slow push in'");
    // In the script, with Shots on: the open shot has the same note.
    await p.evaluate(() => localStorage.setItem('shotsOn:pr_salt', '1'));
    await goThen({ view: 'write', chapterId: 'ch_s1' }, () => !document.documentElement.dataset.view && !!document.querySelector('.ss-side [data-shot="sh_a"]'));
    await sleep(700);
    const cardSel = '.ss-side [data-shot="sh_a"]';
    await p.click(cardSel);
    if (!(await p.locator('.ss-detail[data-shot="sh_a"]').count())) await p.click(cardSel);
    await until(() => !!document.querySelector('.ss-detail[data-shot="sh_a"] .ss-note-in'));
    assert.equal(await p.inputValue('.ss-detail[data-shot="sh_a"] .ss-note-in'), '35mm, slow push in');
    await snap('filmflow-card-note');
    await p.fill('.ss-detail[data-shot="sh_a"] .ss-note-in', '35mm, slow push in. Rain on the mic.');
    await dbUntil('sh_a', "x.fields.note === '35mm, slow push in. Rain on the mic.'");
    await make('pr_salt', 'shots');
    await until(() => !!document.querySelector('.pd-shot[data-shot="sh_a"] .pd-note'));
    assert.equal(await p.inputValue('.pd-shot[data-shot="sh_a"] .pd-note'), '35mm, slow push in. Rain on the mic.');
  });

  await check('Before the shoot is gone once the piece is past Shooting', async () => {
    const piece = await db('pr_salt');
    await idbPut({ ...piece, fields: { ...piece.fields, stage: 'Editing' }, updated_at: Date.now() });
    await make('pr_salt', 'shots');
    await until(() => !!document.querySelector('.pd-shot'));
    assert.equal(await p.locator('.pd-ready').count(), 0);
    await idbPut({ ...piece, updated_at: Date.now() });
  });

  // ---------- build 2: generated shots, one stage at a time ----------
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const chips = () => p.$$eval('.pd-stagechip', (cs) => cs.map((c) => `${c.dataset.stage}:${c.querySelector('.pd-stagechip-n').textContent}`));
  const at = (stage) => until((st) => document.querySelector('.pd-stagechip[aria-pressed="true"]')?.dataset.stage === st, stage);
  const files = async (sel, list) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click(sel)]); await fc.setFiles(list); };
  const toastSays = (re) => until((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent || '')), re.source).catch(async (e) => { throw new Error(`${re.source} / toasts: ${await p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' || '))}`); });

  await check('a filmed piece shows no stage chips; a generated one has All plus six stages, with counts', async () => {
    await make('pr_salt', 'shots');
    await until(() => !!document.querySelector('.pd-shot'));
    assert.equal(await p.locator('.pd-stagechip').count(), 0);
    await make('pr_gen', 'shots');
    await until(() => !!document.querySelector('.pd-stagechip'));
    assert.deepEqual(await chips(), ['all:2', 'board:1', 'still:1', 'pickstill:0', 'video:0', 'picktake:0', 'done:0']);
    await at('all');
    assert.equal(await p.locator('.pd-scene').count(), 1, 'All is the list as it was');
  });

  await check('one shot through all six stages, each showing only what it needs', async () => {
    await p.click('.pd-stagechip[data-stage="board"]');
    await until(() => document.querySelectorAll('.pd-stageshot').length === 1 && !!document.querySelector('.pd-stageshot[data-shot="sh_g1"]'));
    assert.equal(await p.locator('.pd-scene').count(), 0, 'only the shots waiting here');
    await snap('filmflow-stage-board');
    await files('.pd-stageshot[data-shot="sh_g1"] .pd-boardphoto', [{ name: 'board.png', mimeType: 'image/png', buffer: PNG }]);
    await dbUntil('sh_g1', '!!x.fields.star?.board');
    await until(() => !document.querySelector('.pd-stageshot[data-shot="sh_g1"]'));
    assert.deepEqual(await chips(), ['all:2', 'board:0', 'still:2', 'pickstill:0', 'video:0', 'picktake:0', 'done:0']);
    // First frame to make: the prompt with Copy, and the board frame as it is.
    await p.click('.pd-stagechip[data-stage="still"]');
    await until(() => !!document.querySelector('.pd-stageshot[data-shot="sh_g1"] .pd-useboard'));
    assert.equal(await p.locator('.pd-stageshot[data-shot="sh_g1"] .pd-copy').count(), 1);
    await snap('filmflow-stage-still');
    await p.click('.pd-stageshot[data-shot="sh_g1"] .pd-useboard');
    await toastSays(/board frame is the first frame.*Video to make/);
    await dbUntil('sh_g1', 'x.fields.star.still === x.fields.star.board');
    assert.deepEqual((await chips()).slice(2, 5), ['still:1', 'pickstill:0', 'video:1']);
    await p.locator('.toast button', { hasText: 'Undo' }).last().click();
    await dbUntil('sh_g1', '!x.fields.star.still');
    await until(() => !!document.querySelector('.pd-stageshot[data-shot="sh_g1"]'));
    // Pictures come back: they wait to be picked; a tap picks one.
    await files('.pd-stageshot[data-shot="sh_g1"] .pd-addfiles', [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }, { name: 'b.png', mimeType: 'image/png', buffer: PNG }]);
    await toastSays(/2 pictures are in.*First frame to pick/);
    await p.click('.pd-stagechip[data-stage="pickstill"]');
    await until(() => document.querySelectorAll('.pd-stageshot[data-shot="sh_g1"] .pd-pick').length === 2);
    await p.locator('.pd-stageshot[data-shot="sh_g1"] .pd-pick').first().click();
    await toastSays(/First frame picked.*Video to make/);
    await dbUntil('sh_g1', '!!x.fields.star.still && x.fields.star.still !== x.fields.star.board');
    // Video to make: its prompt; takes come back, a tap keeps one: done.
    await p.click('.pd-stagechip[data-stage="video"]');
    await until(() => !!document.querySelector('.pd-stageshot[data-shot="sh_g1"] textarea[aria-label="Video prompt"]'));
    await files('.pd-stageshot[data-shot="sh_g1"] .pd-addfiles', [{ name: 't1.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') }]);
    await toastSays(/A take is in.*Take to pick/);
    await p.click('.pd-stagechip[data-stage="picktake"]');
    await until(() => document.querySelectorAll('.pd-stageshot[data-shot="sh_g1"] .pd-pick').length === 1);
    await p.locator('.pd-stageshot[data-shot="sh_g1"] .pd-pick').first().click();
    await toastSays(/Take picked.*Done/);
    await dbUntil('sh_g1', '!!x.fields.star.video');
    assert.deepEqual(await chips(), ['all:2', 'board:0', 'still:1', 'pickstill:0', 'video:0', 'picktake:0', 'done:1']);
    // The chip is remembered for this piece.
    await make('pr_gen', 'shots');
    await at('picktake');
  });

  await check('Open in Make lands on the shot’s own stage', async () => {
    await goThen({ view: 'production', id: 'pr_gen', tab: 'shots', shot: 'sh_g2', atStage: true }, () => document.querySelector('.pd-stagechip[aria-pressed="true"]')?.dataset.stage === 'still' && !!document.querySelector('.pd-stageshot[data-shot="sh_g2"]'));
  });

  await check('phone 390px: the chips wrap, the stage list fits', async () => {
    const back = await onPhone();
    await make('pr_gen', 'shots');
    await until(() => !!document.querySelector('.pd-stagechip'));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll');
    const xs = await p.$$eval('.pd-stagechip', (cs) => cs.map((c) => c.getBoundingClientRect().right));
    assert.ok(Math.max(...xs) <= 390, 'every chip on the screen');
    await snap('filmflow-stage-phone');
    await back();
  });

  // ---------- build 3: the shoot day as its running order ----------
  const runIds = () => p.$$eval('.pd-run-row', (rs) => rs.map((r) => r.dataset.shot));
  const places = () => p.$$eval('.pd-run-place', (rs) => rs.map((r) => r.textContent));
  const openDay = () => goThen({ view: 'production', id: 'pr_salt', tab: 'days', day: 'next' }, () => document.querySelectorAll('.pd-run-row').length >= 3);

  await check('the Shooting door opens the next shoot day as its running order, by place', async () => {
    await openDay();
    assert.match(await p.locator('.pd-day-date').innerText(), /Saturday, December 5/);
    assert.match(await p.locator('.pd-day-where').innerText(), /Starlite Motel · call 6:00 pm/);
    assert.deepEqual(await places(), ['Starlite office', 'Room nine']);
    assert.deepEqual(await runIds(), ['sh_a', 'sh_b', 'sh_c']);
    assert.match(await p.locator('.pd-dayhead .pd-got-count').innerText(), /^0 of 3 got$/);
    assert.equal(await p.locator('.pd-dayform').count(), 0, 'Plan this day is folded');
    assert.match(await p.locator('.pd-run-row[data-shot="sh_a"]').innerText(), /35mm, slow push in/, 'the note for the day on its row');
    await snap('filmflow-day');
  });

  await check('reorder: keys and dragging; the order is kept after a reload and goes to other devices', async () => {
    await p.locator('.pd-run-row[data-shot="sh_a"]').focus();
    await p.keyboard.press('Alt+Shift+ArrowDown');
    await dbUntil('sd_1', "JSON.stringify(x.fields.order) === JSON.stringify(['sh_b','sh_a','sh_c'])");
    await until(() => [...document.querySelectorAll('.pd-run-row')].map((r) => r.dataset.shot).join() === 'sh_b,sh_a,sh_c');
    // Drag sh_b back below sh_a.
    const a = await p.locator('.pd-run-row[data-shot="sh_a"]').boundingBox();
    const b = await p.locator('.pd-run-row[data-shot="sh_b"] .pd-run-sub').boundingBox();
    await p.mouse.move(b.x + 10, b.y + 5);
    await p.mouse.down();
    for (let i = 1; i <= 10; i++) { await p.mouse.move(b.x + 10, b.y + 5 + ((a.y + a.height * 0.85) - (b.y + 5)) * (i / 10)); await sleep(30); }
    await p.mouse.up();
    await dbUntil('sd_1', "JSON.stringify(x.fields.order) === JSON.stringify(['sh_a','sh_b','sh_c'])");
    await openDay();
    assert.deepEqual(await runIds(), ['sh_a', 'sh_b', 'sh_c']);
    await until(() => true);
    await sleep(1500);
    assert.deepEqual(table.get('sd_1')?.fields?.order, ['sh_a', 'sh_b', 'sh_c'], 'synced');
  });

  await check('tick: its time is kept, toast with Undo; a word for the edit; Left only', async () => {
    await p.click('.pd-run-row[data-shot="sh_a"] .pd-run-tick');
    await dbUntil('sh_a', 'x.fields.got > 1000000');
    await toastSays(/Got it at .* · 1 of 3/);
    await until(() => /Got \d/.test(document.querySelector('.pd-run-row[data-shot="sh_a"] .pd-run-got')?.textContent || ''));
    await p.locator('.toast button', { hasText: 'Undo' }).last().click();
    await dbUntil('sh_a', '!x.fields.got');
    await p.click('.pd-run-row[data-shot="sh_a"] .pd-run-tick');
    await dbUntil('sh_a', 'x.fields.got > 1000000');
    await p.click('.pd-run-row[data-shot="sh_a"] .pd-sayadd');
    await p.fill('.pd-run-sayin', 'Take 3 is the one');
    await p.keyboard.press('Enter');
    await dbUntil('sh_a', "x.fields.say === 'Take 3 is the one'");
    await until(() => /Take 3 is the one/.test(document.querySelector('.pd-run-row[data-shot="sh_a"]')?.textContent || ''));
    await snap('filmflow-day-got');
    await p.click('.pd-day-left');
    await until(() => !document.querySelector('.pd-run-row[data-shot="sh_a"]') && !!document.querySelector('.pd-run-row[data-shot="sh_b"]'));
    await p.click('.pd-day-left');
    await until(() => !!document.querySelector('.pd-run-row[data-shot="sh_a"]'));
  });

  await check('tap a frame: the lines it covers unfold under the row, nothing scrolls', async () => {
    await p.locator('.pd-run-row[data-shot="sh_c"] .pd-run-frame').scrollIntoViewIfNeeded();
    const y = await p.evaluate(() => window.scrollY);
    await p.click('.pd-run-row[data-shot="sh_c"] .pd-run-frame');
    await until(() => /The key does not fit/.test(document.querySelector('.pd-run-lines')?.textContent || ''));
    assert.equal(await p.evaluate(() => window.scrollY), y);
    await p.click('.pd-run-row[data-shot="sh_c"] .pd-run-frame');
    await until(() => !document.querySelector('.pd-run-lines'));
  });

  await check('+ Pickup shot: a real shot in the last row’s scene, on the day, its name ready', async () => {
    await p.click('.pd-pickup');
    await until(() => document.querySelectorAll('.pd-run-row').length === 4);
    const id = (await runIds()).at(-1);
    assert.ok(!['sh_a', 'sh_b', 'sh_c'].includes(id));
    assert.equal((await db(id)).parent_id, 'pp_s3', 'in Room nine');
    assert.ok(await p.evaluate(() => document.activeElement?.classList.contains('pd-run-what')), 'its name is focused');
    await p.keyboard.type('Pickup: the key again');
    await p.keyboard.press('Enter');
    await dbUntil(id, "x.text === 'Pickup: the key again'");
    // It shows in Make too.
    await make('pr_salt', 'shots');
    await until((i) => !!document.querySelector(`.pd-shot[data-shot="${i}"]`), id);
  });

  await check('the call sheet lists the shots in running order, words only; Plan this day unfolds the form', async () => {
    await openDay();
    await p.click('.pd-day-sheet');
    await until(() => !!document.querySelector('.pd-sheet-order'));
    const t = await p.locator('.pd-sheet-order').innerText();
    assert.ok(t.indexOf('June at the counter') < t.indexOf('The bell') && t.indexOf('The bell') < t.indexOf('The key'), t);
    assert.equal(await p.locator('.pd-sheet input[type="checkbox"]').count(), 0);
    await p.click('.pd-day-sheet');
    await p.click('.pd-day-plan');
    await until(() => !!document.querySelector('.pd-dayform'));
    await p.click('.pd-day-plan');
    await until(() => !document.querySelector('.pd-dayform'));
  });

  await check('at wrap: the shots left move to a new day, with Undo', async () => {
    await openDay();
    await until(() => !!document.querySelector('.pd-moveleft'));
    assert.match(await p.locator('.pd-moveleft').innerText(), /Move the 3 left to a new day/);
    await p.click('.pd-moveleft');
    await toastSays(/3 shots moved to/);
    await dbUntil('sd_1', "(x.fields.skip || []).length === 3");
    await until(() => document.querySelectorAll('.pd-run-row').length === 1);
    await p.locator('.toast button', { hasText: 'Undo' }).last().click();
    await dbUntil('sd_1', "!(x.fields.skip || []).length");
    await until(() => document.querySelectorAll('.pd-run-row').length === 4);
    assert.equal(await p.locator('.pd-days .chip[data-day]').count(), 1, 'the new day went again');
  });

  await check('phone 390px: the running order fits, the tick is easy to hit', async () => {
    const back = await onPhone();
    await openDay();
    await until(() => document.querySelectorAll('.pd-run-row').length === 4); // the pickup shot came over too
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll');
    const t = await p.locator('.pd-run-row[data-shot="sh_b"] .pd-run-tick').boundingBox();
    assert.ok(t.width >= 44 && t.height >= 44, 'tick at least 44 px');
    assert.ok(t.x + t.width <= 390, 'tick on the screen');
    await snap('filmflow-day-phone');
    await p.tap('.pd-run-row[data-shot="sh_b"] .pd-run-tick');
    await dbUntil('sh_b', 'x.fields.got > 1000000');
    await p.locator('.toast button', { hasText: 'Undo' }).last().tap();
    await dbUntil('sh_b', '!x.fields.got');
    await back();
  });

  await check('phone 390px: Shots fits, nothing scrolls sideways', async () => {
    const back = await onPhone();
    await make('pr_gen', 'shots');
    await make('pr_salt', 'shots');
    await until(() => !!document.querySelector('.pd-shot .pd-thumb'));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll');
    const t = await p.locator('.pd-shot .pd-thumb').first().boundingBox();
    assert.ok(t.width >= 56, 'the frame is big enough to tap');
    await snap('filmflow-phone');
    await p.locator('.pd-shot').first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await p.evaluate(() => window.scrollBy(0, -90));
    await snap('filmflow-phone-rows');
    await back();
  });

  assert.deepEqual(errors, []);
} catch (e) {
  failed += 1;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('filmflow: all passed');
process.exit(0);
