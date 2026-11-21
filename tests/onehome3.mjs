// One home (Nov 20 2026), Part 3: one Ideas list and one Bible, each thing
// knowing its piece. With several pieces, chips (Everything, Whole project,
// each piece) pick whose; a new idea or page goes to the picked piece; "For…"
// ties an idea or a page to the whole project or a piece, with Undo; a piece's
// "Ideas for this" opens the project's Ideas with it picked. One piece: none.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4299;
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
const idea = (id, sort, text, to, title) => put({ id, kind: 'line', parent_id: 'day-2026-11-20', sort, text: `${text} ${title}`, content: [{ type: 'text', text: `${text} ` }, { type: 'entryRef', attrs: { id: to, title } }], links: [to], created_at: Date.parse('2026-11-20T10:00:00Z') + sort, fields: { done: false } });
idea('li_whole', 1, 'The harbour freezes in act two', 'wd_wh', 'Winter Harbour');
idea('li_nov', 2, 'Ada keeps a list of ferries', 'pr_nov', 'The Harbour Book');
idea('li_sh', 3, 'A gull steals the map', 'pr_sh', 'Gulls');
idea('li_nb', 4, 'Kenji hates syrup', 'wd_nb', 'NB');
put({ id: 'ch_s', kind: 'chapter', parent_id: 'pr_sh', title: 'Script', sort: 1 });
para('ps_1', 'ch_s', 1024, 'EXT. PIER - DAWN', { el: 'scene' });

let failed = 0;
const errors = [];
let p;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) {
    failed += 1;
    const at = (e.stack || '').split('\n').find((l) => l.includes('onehome3.mjs')) || '';
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
const allRows = () => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); }; }));
const openPart = async (part) => {
  const tog = `#wh-outline > li[data-part="${part}"] > .wo-row > .wo-tog`;
  await p.waitForSelector(tog);
  if ((await p.$eval(tog, (b) => b.getAttribute('aria-expanded'))) !== 'true') await p.click(tog);
  await p.waitForSelector(`#wh-outline > li[data-part="${part}"] > .wo-kids`);
};
const home = (id) => goThen({ view: 'world', id }, () => document.documentElement.dataset.view === 'world' && !!document.querySelector('#wh-outline > li[data-part]'));
const ideas = () => p.$$eval('li[data-part="ideas"] > .wo-kids > li[data-drag="wo-idea"]', (ls) => ls.map((l) => l.textContent));
const chip = (part, label) => p.locator(`li[data-part="${part}"] .wo-picks .chip`, { hasText: label }).first().click();
const menuPick = async (...labels) => { for (const l of labels) await p.locator('.pop-menu [role="menuitem"]', { hasText: l }).first().click(); };

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

  await check('Ideas: chips for each piece, and each idea names its piece', async () => {
    await home('wd_wh');
    await openPart('ideas');
    const chips = await p.$$eval('li[data-part="ideas"] .wo-picks .chip', (b) => b.map((x) => x.textContent));
    assert.deepEqual(chips, ['Everything', 'Whole project', 'The Harbour Book', 'Gulls']);
    await until(() => document.querySelectorAll('li[data-part="ideas"] li[data-drag="wo-idea"]').length === 3);
    const list = await ideas();
    assert.ok(list.some((t) => /Ada keeps a list.*The Harbour Book/.test(t)), list.join(' | '));
    assert.ok(list.some((t) => /harbour freezes/.test(t) && !/The Harbour Book|Gulls/.test(t)), 'a whole-project idea has no name');
    await snap('a-ideas-chips');
  });

  await check('a piece picked: only its ideas, and a new idea is for it', async () => {
    await chip('ideas', 'Gulls');
    await until(() => document.querySelectorAll('li[data-part="ideas"] li[data-drag="wo-idea"]').length === 1);
    assert.match((await ideas())[0], /gull steals/);
    assert.equal(await p.$eval('li[data-part="ideas"] .wo-add-idea input', (i) => i.placeholder), 'Add an idea for Gulls…');
    await p.fill('li[data-part="ideas"] .wo-add-idea input', 'Seagull cameo');
    await p.press('li[data-part="ideas"] .wo-add-idea input', 'Enter');
    await until(() => document.querySelectorAll('li[data-part="ideas"] li[data-drag="wo-idea"]').length === 2);
    const made = (await allRows()).find((r) => r.kind === 'line' && /Seagull cameo/.test(r.text));
    assert.deepEqual(made.links, ['pr_sh']);
    await chip('ideas', 'Whole project');
    await until(() => document.querySelectorAll('li[data-part="ideas"] li[data-drag="wo-idea"]').length === 1);
    assert.match((await ideas())[0], /harbour freezes/);
    await chip('ideas', 'Everything');
    await until(() => document.querySelectorAll('li[data-part="ideas"] li[data-drag="wo-idea"]').length === 4);
  });

  await check('"For…" ties an idea to a piece (the words stay), and Undo puts it back', async () => {
    const li = p.locator('li[data-part="ideas"] li[data-drag="wo-idea"]', { hasText: 'harbour freezes' });
    await li.hover();
    await li.locator('.more-btn, .menu-btn').first().click();
    await menuPick('For…', 'The Harbour Book');
    await db('li_whole', "x.links.includes('pr_nov') && !x.links.includes('wd_wh') && /freezes in act two/.test(x.text)");
    await until(() => /harbour freezes.*The Harbour Book/.test([...document.querySelectorAll('li[data-part="ideas"] li[data-drag="wo-idea"]')].map((l) => l.textContent).join('|')));
    await p.waitForSelector('.toast');
    assert.match(await p.$eval('.toast', (t) => t.textContent), /Now for The Harbour Book.*Undo/);
    await p.click('.toast .toast-action');
    await db('li_whole', "x.links.includes('wd_wh') && !x.links.includes('pr_nov')");
  });

  await check('Bible: chips; a page made with a piece picked goes inside it', async () => {
    await home('wd_wh');
    await openPart('bible');
    await chip('bible', 'The Harbour Book');
    await until(() => document.querySelector('li[data-part="bible"] .wo-add-page input')?.placeholder === 'Add a page for The Harbour Book…');

    await p.fill('li[data-part="bible"] .wo-add-page input', 'Ferry times');
    await p.press('li[data-part="bible"] .wo-add-page input', 'Enter');
    await until(() => /Ferry times/.test(document.querySelector('li[data-part="bible"]')?.textContent || ''));
    const pg = (await allRows()).find((r) => r.kind === 'page' && r.title === 'Ferry times');
    assert.equal(pg.parent_id, 'pr_nov');
    await snap('b-bible-chips');
  });

  await check('"For…" on a Bible page moves it to the whole project', async () => {
    const li = p.locator('li[data-part="bible"] .wo-page', { hasText: 'Harbour map' });
    await li.hover();
    await li.locator('.more-btn, .menu-btn').first().click();
    await menuPick('For…', 'Whole project');
    await db('pg_map', "x.parent_id === 'wd_wh'");
    await chip('bible', 'Everything');
    await until(() => document.querySelector('li[data-part="bible"] .wo-picks .chip.on')?.textContent === 'Everything');
  });

  await check('a piece’s "Ideas for this" opens the project’s Ideas with that piece picked', async () => {
    await p.evaluate(() => window.__go({ view: 'stage', id: 'pr_sh', page: 'gather' }));
    await until(() => document.documentElement.dataset.view === 'stage' && document.querySelector('.st-picks .chip.on')?.textContent === 'Gulls');
    const cards = await p.$$eval('.st-cards .st-card', (c) => c.map((x) => x.textContent));
    assert.equal(cards.length, 2, cards.join(' | '));
    assert.equal(await p.$eval('.st-idea input', (i) => i.placeholder), 'Add an idea for Gulls…');
    await snap('c-ideas-zoom');
  });

  await check('the Bible zoom lists the pages inside pieces, with chips', async () => {
    await p.evaluate(() => window.__go({ view: 'stage', id: 'wd_wh', page: 'shape' }));
    await until(() => !!document.querySelector('.st-bible') && !!document.querySelector('.st-picks'));
    // The pick is one per project on this device: Gulls, from Ideas for this.
    assert.equal(await p.$eval('.st-picks .chip.on', (c) => c.textContent), 'Gulls');
    await p.locator('.st-picks .chip', { hasText: 'Everything' }).click();
    await until(() => /Ferry times/.test(document.querySelector('.st-bible')?.textContent || ''));
    const t = await p.$eval('.st-bible', (u) => u.textContent);
    assert.match(t, /Ferry times\s*The Harbour Book/);
  });

  await check('one piece: no chips, no names', async () => {
    await home('wd_nb');
    await openPart('ideas');
    await until(() => /Kenji hates syrup/.test(document.querySelector('li[data-part="ideas"]')?.textContent || ''));
    assert.equal(await p.$('li[data-part="ideas"] .wo-picks'), null);
    assert.equal(await p.$('li[data-part="ideas"] .wo-for'), null);
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
    await check(`phone ${width}px: the chips wrap and nothing scrolls sideways`, async () => {
      await home('wd_wh');
      await openPart('ideas');
      await p.waitForSelector('li[data-part="ideas"] .wo-picks .chip');
      await p.locator('li[data-part="ideas"] .wo-picks .chip', { hasText: 'The Harbour Book' }).tap();
      await until(() => document.querySelectorAll('li[data-part="ideas"] li[data-drag="wo-idea"]').length === 1);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'nothing scrolls sideways');
      await snap(`d-phone-${width}`);
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
