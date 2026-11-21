// Tidying up: the Trash (with Undo and Restore), changing how a piece is
// written and what it's called, moving chapters and pages, and both of those reaching another device. Also
// that note cards line up with their paragraphs when notes are switched on.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4185;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;

// The same stand-in for the cloud as tests/sync.mjs.
const table = new Map();
let clock = Date.parse('2026-10-20T00:00:00Z');
function remote(op, arg) {
  if (op === 'push') {
    const stamp = new Date((clock += 1000)).toISOString();
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

const browser = await chromium.launch();
async function device({ synced = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.exposeFunction('__remote', remote);
  // Not synced: a device without sync (as when the app has no Supabase settings).
  await ctx.addInitScript(synced ? fake : () => { window.__syncBackend = null; });
  // These checks work a world's pieces as a list (the other way to see them is by status).
  await ctx.addInitScript(() => { try { localStorage.setItem('piecesAs', 'list'); } catch { /* no storage */ } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('#editor .ProseMirror');
  await sleep(400);
  return page;
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const syncNow = (p) => p.evaluate(() => window.__sync.run());
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(250);
  await p.keyboard.press('Enter');
  await sleep(300);
};
const menuPick = async (p, ...labels) => {
  for (const l of labels) { await p.locator('.pop-menu button', { hasText: l }).first().click(); await sleep(250); }
};
const openTrash = (p) => p.evaluate(() => { document.querySelector('#lib-trash-box').open = true; });
// The zoom's Library: areas with their projects' names.
const lib = async (p) => { await p.keyboard.press('Control+Shift+O'); await p.waitForSelector('#lib-zoom .zl-name'); await sleep(300); };
const cardTitles = (p) => p.locator('#lib-zoom .zl-area .zl-name').allInnerTexts();
const openWorld = async (p, title) => {
  await p.locator('#lib-zoom .zl-name', { hasText: new RegExp(`^${title}$`) }).first().click();
  await p.waitForSelector('.world-home', { state: 'visible' });
  await sleep(300);
};
// A project's own ⋯ (on its page).
const worldMore = async (p, title, ...labels) => { await lib(p); await openWorld(p, title); await p.locator('#wh-more .more-btn').click(); await menuPick(p, ...labels); };
const areaNames = (p) => p.locator('#lib-zoom .zl-area .zl-h').allTextContents();
const go = (p, place) => p.evaluate((pl) => window.__go(pl), place);
const book = async (p, title) => (await all(p)).find((e) => e.kind === 'project' && e.title === title && !e.deleted);
const world = async (p, title) => (await all(p)).find((e) => e.kind === 'world' && e.title === title && !e.deleted);

let failed = 0;
const pages = {};
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 4).join('\n     ')}`);
    if (process.env.SHOTS) for (const [n, pg] of Object.entries(pages)) await pg.screenshot({ path: `${process.env.SHOTS}/${failed}-${n}.png` }).catch(() => {});
  }
}

try {
  const a = await device();
  const b = await device();
  Object.assign(pages, { a, b });

  await check('a piece can change how it is written, and takes a label of your own', async () => {
    await a.locator('#editor .ProseMirror').click();
    await a.keyboard.type('It was a bright cold day in April, and the clocks were striking thirteen.');
    await sleep(800);
    await lib(a);
    await a.locator('#lib-zoom .zl-area .zl-add').first().click();
    await a.waitForSelector('#lib-new', { state: 'visible' });
    await a.locator('#lib-new-title').fill('Research');
    await a.locator('#lib-new button[type=submit]').click();
    await sleep(600);
    // It opened on its Idea page; go to the world and change its piece.
    await lib(a);
    await openWorld(a, 'Research');
    await a.evaluate(() => window.__go({ view: 'stage', id: history.state.id, page: 'write' })); // the Pieces zoom (One home: one piece is drawn as that piece)
    await a.locator('#wh-pieces li', { hasText: 'Research' }).locator('.more-btn').click();
    await menuPick(a, 'Written as', 'Outline');
    await sleep(400);
    assert.equal((await book(a, 'Research')).fields.type, 'lines');
    // What it is, from the same ⋯ (One home: the piece has no Overview).
    await a.locator('#wh-pieces li', { hasText: 'Research' }).locator('.more-btn').click();
    await menuPick(a, 'What it is');
    await a.waitForSelector('.ask input');
    await a.locator('.ask input').fill('Gag');
    await a.locator('.ask input').press('Enter');
    await sleep(400);
    assert.equal((await book(a, 'Research')).fields.label, 'Gag');
  });

  await check('writing a piece with words in it as an outline asks first and keeps the manuscript', async () => {
    await lib(a);
    await openWorld(a, 'Untitled novel');
    await a.evaluate(() => window.__go({ view: 'stage', id: history.state.id, page: 'write' })); // the Pieces zoom (One home: one piece is drawn as that piece)
    const asOutline = async () => { await a.locator('#wh-pieces li', { hasText: 'Untitled novel' }).locator('.more-btn').click(); await menuPick(a, 'Written as', 'Outline'); };
    await asOutline();
    await a.waitForSelector('.ask');
    assert.match(await a.locator('.ask').innerText(), /stays exactly as it is/);
    await a.locator('.ask .ghost-btn', { hasText: 'Cancel' }).click();
    await sleep(300);
    assert.equal((await book(a, 'Untitled novel')).fields.type || 'novel', 'novel');
    await asOutline();
    await a.locator('.ask .pill', { hasText: 'Change it' }).click();
    await sleep(500);
    assert.equal((await book(a, 'Untitled novel')).fields.type, 'lines');
    { const nv = await book(a, 'Untitled novel'); const acts = (await all(a)).filter((e) => e.kind === 'act' && e.parent_id === nv.id && !e.deleted).map((x) => x.id); assert.ok((await all(a)).some((e) => e.kind === 'chapter' && acts.includes(e.parent_id) && e.title === 'Chapter 1' && !e.deleted), 'the manuscript is kept'); }
    await go(a, { view: 'world', id: (await world(a, 'Untitled novel')).id });
    await a.evaluate(() => window.__go({ view: 'stage', id: history.state.id, page: 'write' })); // the Pieces zoom (One home: one piece is drawn as that piece)
    await a.locator('#wh-pieces li', { hasText: 'Untitled novel' }).locator('.more-btn').click();
    await menuPick(a, 'Written as', 'Prose');
    await sleep(500);
    assert.equal((await book(a, 'Untitled novel')).fields.type, 'novel');
    const novel = await book(a, 'Untitled novel');
    const acts = (await all(a)).filter((e) => e.kind === 'act' && e.parent_id === novel.id && !e.deleted).map((x) => x.id);
    const chapters = (await all(a)).filter((e) => e.kind === 'chapter' && acts.includes(e.parent_id) && !e.deleted);
    assert.equal(chapters.length, 1, 'changing back did not add a second first chapter');
  });

  await check('a world goes to the Trash, Undo brings it straight back', async () => {
    await worldMore(a, 'Research', 'Move to Trash');
    await sleep(400);
    await lib(a);
    assert.ok(!(await cardTitles(a)).includes('Research'));
    assert.match(await a.locator('#lib-trash-box summary').innerText(), /Trash \(1\)/i);
    await a.locator('.toast-action', { hasText: 'Undo' }).click();
    await sleep(500);
    await lib(a);
    assert.ok((await cardTitles(a)).includes('Research'));
    assert.ok(await a.locator('#lib-trash-box').isHidden());
  });

  await check('a world with writing asks before it goes, and comes back whole from the Trash', async () => {
    await openWorld(a, 'Untitled novel');
    await a.locator('#wh-continue').click();
    await sleep(500);
    await command(a, 'This world: rename');
    await menuPick(a, 'Move to Trash');
    await a.waitForSelector('.ask');
    assert.match(await a.locator('.ask').innerText(), /14 words/);
    await a.locator('.ask .pill', { hasText: 'Move to Trash' }).click();
    await sleep(700);
    assert.equal(await a.evaluate(() => document.documentElement.dataset.view), 'library');
    assert.ok(!(await cardTitles(a)).includes('Untitled novel'));
    // Opening the app again doesn't make a new starter book, or reopen the trashed one.
    await a.reload();
    await a.waitForSelector('#editor .ProseMirror', { state: 'attached' });
    await sleep(800);
    assert.equal((await all(a)).filter((e) => e.kind === 'project' && !e.deleted).length, 2);
    assert.equal(await a.evaluate(() => document.documentElement.dataset.view), 'library');
    await openTrash(a);
    await a.locator('#lib-trash li', { hasText: 'Untitled novel' }).locator('button', { hasText: 'Restore' }).click();
    await sleep(500);
    await lib(a);
    await openWorld(a, 'Untitled novel');
    await a.locator('#wh-continue').click();
    await sleep(600);
    assert.match(await a.locator('#editor .ProseMirror').innerText(), /clocks were striking thirteen/);
    const paras = (await all(a)).filter((e) => e.kind === 'para' && !e.deleted);
    assert.ok(paras.length >= 1 && paras.every((x) => !x.fields?.trashed), 'paragraphs back');
  });

  await check('chapters move up and down, and one can go to the Trash on its own', async () => {
    await command(a, 'New chapter');
    await a.keyboard.type('Second chapter words.');
    await sleep(700);
    const novel = await book(a, 'Untitled novel');
    // The novel's Outline holds its chapters now (One home), each with its ⋯.
    await go(a, { view: 'grid', id: novel.id, mode: 'outline' });
    await a.waitForSelector('.ph1');
    await sleep(500);
    const rows = () => a.locator('.ol-row > .ol-head .ol-title').allTextContents();
    const more = (t) => a.locator('.ol-row', { hasText: t }).locator('> .ol-head .more-btn');
    assert.deepEqual(await rows(), ['Chapter 1', 'Chapter 2']);
    await more('Chapter 2').click();
    await menuPick(a, 'Move up');
    await a.waitForFunction(() => [...document.querySelectorAll('.ol-row > .ol-head .ol-title')].map((x) => x.textContent).join() === 'Chapter 2,Chapter 1');
    await more('Chapter 2').click();
    await menuPick(a, 'Move to Trash');
    await a.locator('.ask .pill', { hasText: 'Move to Trash' }).click();
    await a.waitForFunction(() => [...document.querySelectorAll('.ol-row > .ol-head .ol-title')].map((x) => x.textContent).join() === 'Chapter 1');
    await a.locator('.toast-action').click();
    await a.waitForFunction(() => [...document.querySelectorAll('.ol-row > .ol-head .ol-title')].map((x) => x.textContent).join() === 'Chapter 2,Chapter 1');
  });

  await check('a page moves to another world, and goes to the Trash from its own ⋯', async () => {
    const research = await world(a, 'Research');
    const idea = (await all(a)).find((e) => e.kind === 'page' && e.parent_id === research.id);
    await a.evaluate((id) => window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'notebook', pageId: id } })), idea.id);
    await sleep(500);
    await a.keyboard.type('A thought worth keeping');
    await sleep(700);
    await a.locator('#nb-more .more-btn').click();
    await menuPick(a, 'Move to', 'Untitled novel');
    await sleep(300);
    const novel = await world(a, 'Untitled novel');
    assert.equal((await all(a)).find((e) => e.id === idea.id).parent_id, novel.id);
    await a.locator('#nb-more .more-btn').click();
    await menuPick(a, 'Move to Trash');
    await sleep(600);
    assert.equal(await a.evaluate(() => document.documentElement.dataset.view), 'world');
    const row = (await all(a)).find((e) => e.id === idea.id);
    assert.equal(row.fields.trashedWith, idea.id);
    const line = (await all(a)).find((e) => e.kind === 'line' && e.text === 'A thought worth keeping');
    assert.equal(line.fields.trashedWith, idea.id, 'its lines went with it');
  });

  await check('an area with a world in it asks first, and Restore brings both back', async () => {
    const research = await world(a, 'Research');
    await a.evaluate(async (id) => {
      const r = indexedDB.open('writing');
      await new Promise((res) => { r.onsuccess = res; });
      const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
      const s = tx.objectStore('entries');
      s.get(id).onsuccess = (e) => { s.put({ ...e.target.result, area_id: 'area-business', updated_at: Date.now() }); tx.objectStore('outbox').put({ id }); };
      await new Promise((res) => { tx.oncomplete = res; });
    }, research.id);
    await a.keyboard.press('Control+Shift+O');
    await sleep(300);
    await lib(a);
    // An area's menu is a right-click on its name.
    await a.locator('#lib-zoom .zl-area .zl-h', { hasText: 'Business' }).click({ button: 'right' });
    await menuPick(a, 'Move to Trash');
    await a.waitForSelector('.ask');
    assert.match(await a.locator('.ask').innerText(), /1 world/);
    await a.locator('.ask .pill', { hasText: 'Move to Trash' }).click();
    await sleep(500);
    assert.ok(!(await areaNames(a)).includes('Business'));
    assert.ok(!(await cardTitles(a)).includes('Research'));
    await openTrash(a);
    await a.locator('#lib-trash li', { hasText: 'Business' }).locator('button', { hasText: 'Restore' }).click();
    await sleep(500);
    await lib(a);
    assert.ok((await areaNames(a)).includes('Business'));
    assert.ok((await cardTitles(a)).includes('Research'));
  });

  await check('Trash and Restore reach the other device', async () => {
    await syncNow(a);
    await syncNow(b);
    await lib(b);
    assert.ok((await cardTitles(b)).includes('Research'));
    await worldMore(b, 'Research', 'Move to Trash');
    await sleep(400);
    await syncNow(b);
    await syncNow(a);
    await sleep(500);
    await lib(a);
    assert.ok(!(await cardTitles(a)).includes('Research'), 'gone on the first device too');
    await openTrash(a);
    await a.locator('#lib-trash li', { hasText: 'Research' }).locator('button', { hasText: 'Restore' }).click();
    await sleep(400);
    await syncNow(a);
    await syncNow(b);
    await sleep(500);
    await lib(b);
    assert.ok((await cardTitles(b)).includes('Research'), 'back on the second device');
  });

  await check('the open chapter going to the Trash on another device moves you off it', async () => {
    await lib(b);
    await openWorld(b, 'Untitled novel');
    await b.locator('#wh-continue').click();
    await sleep(600);
    assert.equal(await b.evaluate(() => document.documentElement.dataset.view || 'write'), 'write');
    const ch = (await all(a)).find((e) => e.kind === 'chapter' && e.title === 'Chapter 2');
    await b.evaluate((id) => window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'write', chapterId: id } })), ch.id);
    await sleep(500);
    assert.match(await b.locator('#editor .ProseMirror').innerText(), /Second chapter words/);
    await a.evaluate((id) => window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'write', chapterId: id } })), ch.id);
    await sleep(500);
    await command(a, 'This chapter: rename');
    await menuPick(a, 'Move to Trash');
    await a.locator('.ask .pill', { hasText: 'Move to Trash' }).click();
    await sleep(500);
    await syncNow(a);
    await syncNow(b);
    await sleep(800);
    assert.doesNotMatch(await b.locator('#editor .ProseMirror').innerText(), /Second chapter words/);
    // Nothing on the second device wrote over it: still whole in the Trash.
    await syncNow(b);
    const para = (await all(a)).find((e) => e.kind === 'para' && e.text === 'Second chapter words.');
    assert.ok(para && !para.deleted && para.fields.trashedWith === ch.id);
  });

  await check('Delete forever asks, then removes it everywhere', async () => {
    await a.keyboard.press('Control+Shift+O');
    await sleep(400);
    await openTrash(a);
    const li = a.locator('#lib-trash li', { hasText: 'Chapter 2' });
    await li.locator('button', { hasText: 'Delete forever' }).click();
    await a.waitForSelector('.ask');
    assert.match(await a.locator('.ask').innerText(), /can’t be brought back/);
    await a.locator('.ask .pill', { hasText: 'Delete forever' }).click();
    await sleep(500);
    const para = (await all(a)).find((e) => e.kind === 'para' && e.text === 'Second chapter words.');
    assert.ok(para.deleted);
    assert.equal(await a.locator('#lib-trash li', { hasText: 'Chapter 2' }).count(), 0);
  });

  await check('note cards line up with their paragraphs when notes are switched on', async () => {
    const c = await device({ synced: false });
    pages.c = c;
    await c.locator('#editor .ProseMirror').click();
    const long = 'This paragraph is long enough to wrap onto several lines once the page narrows to make room for notes beside it. '.repeat(3);
    await c.keyboard.type(long.trim());
    await c.keyboard.press('Enter');
    await c.keyboard.type('Second paragraph with a note.');
    await c.keyboard.press('Alt+N');
    await sleep(300);
    await c.keyboard.type('A note');
    await sleep(500);
    await c.locator('#editor .ProseMirror').click();
    await c.keyboard.press('Control+2');
    await sleep(200);
    await c.keyboard.press('Control+2');
    await sleep(900);
    const gap = await c.evaluate(() => {
      const ps = document.querySelectorAll('#editor .ProseMirror p');
      return document.querySelector('.note:not([hidden])').getBoundingClientRect().top - ps[1].getBoundingClientRect().top;
    });
    assert.ok(Math.abs(gap) < 4, `card is ${Math.round(gap)}px off its paragraph`);
  });

  await check('no page errors', async () => assert.deepEqual([...a.errors, ...b.errors], []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
