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
put({ id: 'bd-pp_s1', kind: 'breakdown', parent_id: 'pp_s1', fields: { add: ['pg_june', 'pg_clerk'], drop: [], piece: 'pr_salt' } });
put({ id: 'sd_1', kind: 'shootday', parent_id: 'pr_salt', fields: { date: '2026-12-05', call: '18:00', place: 'Starlite Motel', scenes: ['pp_s1'] } });
// A generated reel in the same world.
put({ id: 'pr_gen', kind: 'project', parent_id: 'wd_sr', title: 'Salt Road teaser', area_id: 'area-film', sort: 2, fields: { type: 'screenplay', woven: true, stage: 'Generating', stageSet: 'ai' } });
put({ id: 'ac_g', kind: 'act', parent_id: 'pr_gen', title: 'Screenplay', sort: 1 });
put({ id: 'ch_g1', kind: 'chapter', parent_id: 'ac_g', title: 'Script', sort: 1 });
put({ id: 'sc_g1', kind: 'scene', parent_id: 'ch_g1', sort: 1024, title: 'Neon', fields: { level: 3 } });
para('pp_g1', 'ch_g1', 2048, 'EXT. MOTEL LOT - NIGHT', { el: 'scene' });
para('pp_g2', 'ch_g1', 3072, 'The VACANCY sign buzzes.', { el: 'action' });
put({ id: 'sh_g1', kind: 'shot', parent_id: 'pp_g1', sort: 1024, text: 'The sign', fields: { n: 1, piece: 'pr_gen', from: 'pp_g2', to: 'pp_g2' } });

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
    await p.locator('.pd-daypick .chip', { hasText: 'Room nine' }).click();
    await dbUntil('sd_1', "x.fields.scenes.includes('pp_s3')");
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
    assert.deepEqual(await readyLines(), ['lines|✓', 'frames|1 to draw']);
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

  await check('phone 390px: Shots fits, nothing scrolls sideways', async () => {
    await p.setViewportSize({ width: 390, height: 844 });
    await make('pr_gen', 'shots');
    await make('pr_salt', 'shots');
    await until(() => !!document.querySelector('.pd-shot .pd-thumb'));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll');
    const t = await p.locator('.pd-shot .pd-thumb').first().boundingBox();
    assert.ok(t.width >= 56, 'the frame is big enough to tap');
    await snap('filmflow-phone');
    await p.setViewportSize({ width: 1280, height: 860 });
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
