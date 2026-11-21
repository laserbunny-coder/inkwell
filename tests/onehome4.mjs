// One home (Nov 20 2026), Part 4: the stage line is the path. In the
// Outline head, tapping the stage unfolds one row per stage, filled up to
// where it is, each saying what's built there; a row opens where that work
// happens; right-click (a long press on Android) sets the stage.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4300;
const server = await serve(PORT);
const SHOTS = process.env.SHOTS || '';

const table = new Map();
let clock = Date.parse('2026-11-20T00:00:00Z');
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
put({ id: 'wd_nb', kind: 'world', title: 'NB', area_id: 'area-film' });
put({ id: 'pr_nb', kind: 'project', parent_id: 'wd_nb', title: 'NB', area_id: 'area-film', sort: 1, fields: { type: 'screenplay', woven: true, stage: 'Writing', develop: { paragraph: 'Kenji wants out. The family wants him in.' } } });
put({ id: 'ac_1', kind: 'act', parent_id: 'pr_nb', title: 'Screenplay', sort: 1 });
put({ id: 'ch_1', kind: 'chapter', parent_id: 'ac_1', title: 'Script', sort: 1, fields: { words: 420 } });
put({ id: 'sc_1', kind: 'scene', parent_id: 'ch_1', sort: 1024, title: 'Breakfast', fields: { level: 3, synopsis: 'Nobody can pass the syrup like a normal person.' } });
para('pp_1', 'ch_1', 2048, 'INT. KITCHEN - MORNING', { el: 'scene' });
para('pp_2', 'ch_1', 3072, 'Mother flips a pancake. Kenji sneaks in with the katana.', { el: 'action' });
put({ id: 'sc_2', kind: 'scene', parent_id: 'ch_1', sort: 4096, title: 'The gate', fields: { level: 3 } });
para('pp_3', 'ch_1', 5120, 'EXT. DOJO - DAY', { el: 'scene' });
para('pp_4', 'ch_1', 6144, 'Rain. A stranger at the gate.', { el: 'action' });
put({ id: 'pg_chars', kind: 'page', parent_id: 'pr_nb', title: 'Characters', sort: 1 });
put({ id: 'sh_1', kind: 'shot', parent_id: 'pp_1', sort: 1024, text: 'Wide on the kitchen', fields: { n: 1, piece: 'pr_nb' } });
put({ id: 'sh_2', kind: 'shot', parent_id: 'pp_1', sort: 2048, text: 'Close on the syrup', fields: { n: 2 } });
// A project with two pieces: a novel (chapters) and a short.
put({ id: 'wd_wh', kind: 'world', title: 'Winter Harbour', area_id: 'area-film', sort: 2 });
put({ id: 'pr_nov', kind: 'project', parent_id: 'wd_wh', title: 'The Harbour Book', area_id: 'area-film', sort: 1, fields: { type: 'novel', label: 'Novel', stage: 'Drafting' } });
put({ id: 'ac_n', kind: 'act', parent_id: 'pr_nov', title: 'Part one', sort: 1 });
put({ id: 'ch_a', kind: 'chapter', parent_id: 'ac_n', title: 'The ferry', sort: 1, fields: { synopsis: 'Ada misses the last boat on purpose.', words: 1200 } });
para('pn_1', 'ch_a', 1024, 'The ferry horn went twice and Ada did not move.');
put({ id: 'ch_b', kind: 'chapter', parent_id: 'ac_n', title: 'Low tide', sort: 2, fields: { words: 800 } });
para('pn_2', 'ch_b', 1024, 'At low tide the harbour showed its bones.');
put({ id: 'pg_map', kind: 'page', parent_id: 'pr_nov', title: 'Harbour map', sort: 1 });
put({ id: 'pr_sh', kind: 'project', parent_id: 'wd_wh', title: 'Gulls', area_id: 'area-film', sort: 2, fields: { type: 'screenplay', label: 'Short', stage: 'Idea' } });
put({ id: 'day-2026-11-20', kind: 'day', title: '2026-11-20' });
put({ id: 'li_nb', kind: 'line', parent_id: 'day-2026-11-20', sort: 1, text: 'Kenji hates syrup NB', content: [{ type: 'text', text: 'Kenji hates syrup ' }, { type: 'entryRef', attrs: { id: 'pr_nb', title: 'NB' } }], links: ['pr_nb'], fields: { done: false } });
put({ id: 'ch_s', kind: 'chapter', parent_id: 'pr_sh', title: 'Script', sort: 1 });
para('ps_1', 'ch_s', 1024, 'EXT. PIER - DAWN', { el: 'scene' });

let failed = 0;
const errors = [];
let p;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) {
    failed += 1;
    const at = (e.stack || '').split('\n').find((l) => l.includes('onehome4.mjs')) || '';
    console.log(`FAIL ${name}\n     ${e.message}\n     ${at.trim()}`);
  }
}
const snap = async (n) => { if (SHOTS) { await sleep(300); await p.screenshot({ path: `${SHOTS}/${n}.png` }); } };
const view = () => p.evaluate(() => document.documentElement.dataset.view || 'write');
const until = (fn, arg, timeout = 30000) => p.waitForFunction(fn, arg, { timeout }).catch((e) => { throw new Error(`waited for ${String(fn).slice(0, 90)}: ${e.message.split('\n')[0]}`); });
// Go somewhere and wait to be there; once more if the app was still settling
// in (start-up can land on Today just after the first go).
const goThen = async (place, ready) => {
  for (let i = 0; ; i++) {
    await p.evaluate((pl) => window.__go(pl), place);
    try { await p.waitForFunction(ready, null, { timeout: 8000 }); return; } catch (e) { if (i >= 2) throw e; }
  }
};


const db = (id, test) => until(([i, t]) => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').get(i); q.onsuccess = () => res(new Function('x', `return ${t}`)(q.result)); }; }), [id, test]);
const outlineOf = (id) => goThen({ view: 'grid', id, mode: 'outline' }, () => !!document.querySelector('.grid-view .ph1'));
const doorRows = () => p.$$eval('.ph1-way .ph1-door', (ls) => ls.map((l) => `${l.className}|${l.textContent}`));
const door = (stage) => p.locator('.ph1-way .ph1-go', { has: p.locator('.ph1-st', { hasText: new RegExp(`^${stage}$`) }) });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark', deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://localhost:${PORT}/`);
  await until(() => !!window.__grid);
  await db('li_nb', '!!x');

  await check('the stage unfolds the path: each stage, filled up to where it is, with what’s built', async () => {
    await outlineOf('pr_nb');
    assert.equal(await p.$eval('.ph1-way', (w) => w.hidden), true, 'folded at first');
    await p.click('.ph1-stage');
    await until(() => document.querySelectorAll('.ph1-way .ph1-door').length >= 4 && !/^\s*$/.test(document.querySelector('.ph1-way .ph1-door .ph1-built')?.textContent || ''));
    const rows = await doorRows();
    assert.equal(rows.length, await p.$$eval('.ph1-dots i', (d) => d.length));
    assert.match(rows[0], /\bf\b.*New idea\s*1 idea for this\s*›/);
    assert.match(rows[1], /\bf\b.*\bat\b.*Writing\s*2 scenes, 420 words/);
    assert.match(rows.find((r) => /Boarding/.test(r)), /Boarding\s*1 shot/);
    assert.ok(!/\bf\b/.test(rows.at(-1).split('|')[0]), 'not filled past where it is');
    assert.match(rows.at(-1), /not posted/);
    await snap('a-path');
  });

  await check('it stays open on this device', async () => {
    await goThen({ view: 'world', id: 'wd_nb' }, () => document.documentElement.dataset.view === 'world');
    await outlineOf('pr_nb');
    assert.equal(await p.$eval('.ph1-way', (w) => w.hidden), false);
  });

  await check('each row is a door: the text, Ideas, Shots, Share and post', async () => {
    await door('Writing').click();
    await until(() => !document.documentElement.dataset.view && window.__editor?.getText().includes('Kenji'));
    await outlineOf('pr_nb');
    await door('New idea').click();
    await until(() => document.documentElement.dataset.view === 'stage' && /Kenji hates syrup/.test(document.querySelector('.st-cards')?.textContent || ''));
    await outlineOf('pr_nb');
    await door('Boarding').click();
    await until(() => document.documentElement.dataset.view === 'production');
    await outlineOf('pr_nb');
    await p.locator('.ph1-way .ph1-go').last().click();
    await until(() => document.documentElement.dataset.view === 'deliver');
  });

  await check('right-click a row: Set stage to …', async () => {
    await outlineOf('pr_nb');
    await door('Boarding').click({ button: 'right' });
    await p.locator('.pop-menu [role="menuitem"]', { hasText: 'Set stage to Boarding' }).click();
    await db('pr_nb', "x.fields.stage === 'Boarding'");
    await until(() => /Boarding/.test(document.querySelector('.ph1-word')?.textContent || ''));
  });

  await check('a novel: Revising opens Drafts and notes', async () => {
    await outlineOf('pr_nov');
    await p.waitForSelector('.ph1-way:not([hidden]) .ph1-go');
    const names = await p.$$eval('.ph1-way .ph1-st', (s) => s.map((x) => x.textContent));
    assert.ok(names.includes('Revising'), names.join(', '));
    await door('Revising').click();
    await until(() => document.documentElement.dataset.view === 'stage' && /Drafts and notes/.test(document.querySelector('#crumb')?.textContent || ''));
  });

  await check('tapping the stage folds it again', async () => {
    await outlineOf('pr_nb');
    await p.click('.ph1-stage');
    assert.equal(await p.$eval('.ph1-way', (w) => w.hidden), true);
    await p.click('.ph1-stage');
  });

  await ctx.close();

  for (const width of [412, 360]) {
    const phone = await browser.newContext({ viewport: { width, height: 860 }, hasTouch: true, isMobile: true, colorScheme: 'dark', deviceScaleFactor: SHOTS ? 2 : 1 });
    await phone.exposeFunction('__remote', remote);
    await phone.addInitScript(fake);
    p = await phone.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://localhost:${PORT}/`);
    await until(() => !!window.__grid);
    await db('li_nb', '!!x');
    await check(`phone ${width}px: the path fits, and a tap opens a door`, async () => {
      await outlineOf('pr_nb');
      await p.tap('.ph1-stage');
      await p.waitForSelector('.ph1-way:not([hidden]) .ph1-go');
      await until(() => /scenes/.test(document.querySelector('.ph1-way')?.textContent || ''));
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'nothing scrolls sideways');
      const h = await p.$$eval('.ph1-way .ph1-door', (b) => b.map((x) => x.getBoundingClientRect().height));
      assert.ok(h.every((x) => x >= 40 && x < 70), h.join(','));
      await sleep(1200); await snap(`b-phone-${width}`);
      await door('Writing').tap();
      await until(() => !document.documentElement.dataset.view && window.__editor?.getText().includes('Kenji'));
    });
    await phone.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.log(`page errors:\n  ${errors.join('\n  ')}`); failed += 1; }
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
process.exit(0);
