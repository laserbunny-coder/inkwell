// Autocomplete while typing (Nov 18 2026): # lists his tags, [[ lists pages,
// then projects and pieces, @ lists the characters and places of the project
// he is in. Up / Down, Enter or Tab, Esc; on a phone one row above the keyboard.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4296;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY = `day-${today}`;

function rows() {
  const now = Date.now();
  const base = { content: null, tags: [], links: [], fields: {}, deleted: false, created_at: now, updated_at: now, text: '', title: '' };
  const line = (id, parent, text, sort, tags = []) => ({ ...base, id, kind: 'line', parent_id: parent, sort, text, content: [{ type: 'text', text }], tags });
  const page = (id, parent, title, sort, type) => ({ ...base, id, kind: 'page', parent_id: parent, title, sort, fields: type ? { element: { type } } : {} });
  return [
    { ...base, id: DAY, kind: 'day', title: today, parent_id: null, sort: 0 },
    line('l1', DAY, 'Fake a ninja fight #stunts', 1024, ['stunts']),
    line('l2', DAY, 'Wire work #stunts #anime', 2048, ['stunts', 'anime']),
    line('l3', DAY, 'Falling down stairs #stunts', 3072, ['stunts']),
    line('l4', DAY, 'Sea shanty theme #music', 4096, ['music']),
    { ...base, id: 'w1', kind: 'world', title: 'The Ninja Bunch', parent_id: null, sort: 1024 },
    { ...base, id: 'w2', kind: 'world', title: 'Harbor Tales', parent_id: null, sort: 2048 },
    { ...base, id: 'p1', kind: 'project', title: 'Episode 1', parent_id: 'w1', sort: 1024 },
    { ...base, id: 'p2', kind: 'project', title: 'Episode 1', parent_id: 'w2', sort: 1024 },
    page('g1', 'w1', 'Characters', 1024),
    page('c1', 'g1', 'Kenji', 1024, 'character'),
    page('c2', 'g1', 'Mika', 2048),
    page('g2', 'w1', 'Places', 2048),
    page('s1', 'g2', 'Harbor Dojo', 1024, 'location'),
    page('c3', 'w2', 'Captain Ola', 3072, 'character'),
    page('pg1', null, 'Lighthouse keeper', 0)
  ];
}

const seed = (list) => new Promise((res, rej) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
    for (const row of list) { tx.objectStore('entries').put(row); tx.objectStore('outbox').put({ id: row.id }); }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  };
});

const browser = withoutSync(await chromium.launch());
async function open(opts = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce', viewport: { width: 1280, height: 860 }, ...opts });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(URL);
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await p.evaluate(seed, rows());
  await p.reload();
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await sleep(500);
  return p;
}
const goPage = async (p, pageId) => {
  await p.evaluate((id) => { const st = { view: 'notebook', pageId: id }; history.pushState(st, ''); dispatchEvent(new PopStateEvent('popstate', { state: st })); }, pageId);
  await p.waitForSelector('#outline-editor .ProseMirror', { state: 'visible' });
  await sleep(400);
};
// A new last line on the open page.
const newLine = async (p) => {
  await sleep(300); // the last line's save
  // Into the last line, away from its #tags and links (a click on one opens it).
  await p.evaluate(() => { const ed = window.__outline; ed.commands.focus('end'); });
  await p.waitForSelector('#outline-editor .ProseMirror-focused');
  await sleep(150);
  await p.keyboard.press('Enter');
};
const lastLine = (p) => p.locator('#outline-editor li > p').last().innerText();
const shownList = (p) => p.locator('.suggest:not([hidden]) li .label').allInnerTexts();
const hints = (p) => p.locator('.suggest:not([hidden]) li .hint').allInnerTexts();
const listShows = (p) => p.waitForSelector('.suggest:not([hidden]) li');
const listGone = (p) => p.waitForFunction(() => document.querySelector('.suggest')?.hidden !== false);
const refsIn = (p) => p.locator('#outline-editor li > p').last().locator('a[data-ref]').evaluateAll((as) => as.map((a) => [a.dataset.ref, a.textContent]));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}

try {
  const page = await open();
  await goPage(page, DAY);

  await check('# lists his tags, most used first, and narrows as he types', async () => {
    await newLine(page);
    await page.keyboard.type('#');
    await listShows(page);
    assert.deepEqual(await shownList(page), ['#stunts', '#anime', '#music']);
    await page.keyboard.type('u');
    // Matches anywhere in the tag, words that start with it first.
    await page.waitForFunction(() => document.querySelectorAll('.suggest li').length === 2);
    assert.deepEqual(await shownList(page), ['#stunts', '#music']);
    await page.keyboard.type('s');
    await page.waitForFunction(() => document.querySelectorAll('.suggest li').length === 1);
    assert.deepEqual(await shownList(page), ['#music']);
  });

  await check('Enter takes it, with a space, and typing goes on after it', async () => {
    await page.keyboard.press('Enter');
    await listGone(page);
    await page.keyboard.type('for the end credits');
    assert.equal(await lastLine(page), '#music for the end credits');
  });

  await check('Down and Tab take another; a space or Esc closes it and leaves what he typed', async () => {
    await newLine(page);
    await page.keyboard.type('Stairs #');
    await listShows(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await listGone(page);
    assert.equal(await lastLine(page), 'Stairs #music ');
    await page.keyboard.type('#stu');
    await listShows(page);
    await page.keyboard.type(' ');
    await listGone(page);
    await page.keyboard.type('#mu');
    await listShows(page);
    await page.keyboard.press('Escape');
    await listGone(page);
    assert.equal(await lastLine(page), 'Stairs #music #stu #mu');
    // Still in the text after Esc.
    await page.keyboard.type('x');
    assert.equal(await lastLine(page), 'Stairs #music #stu #mux');
  });

  await check('# only opens at the start of a line or after a space, and a new tag is never blocked', async () => {
    await newLine(page);
    await page.keyboard.type('C#');
    await sleep(300);
    assert.equal(await page.locator('.suggest:not([hidden])').count(), 0);
    await page.keyboard.type(' #brandnew');
    await sleep(300);
    // Nothing matches: no empty box.
    assert.equal(await page.locator('.suggest:not([hidden])').count(), 0);
    await page.keyboard.press('Enter');
    assert.match(await page.locator('#outline-editor li > p').nth(-2).innerText(), /#brandnew$/);
  });

  await check('[[ lists pages, then projects and pieces; a piece shows its project faintly', async () => {
    await newLine(page);
    await page.keyboard.type('See [[Epi');
    await listShows(page);
    assert.deepEqual(await shownList(page), ['Episode 1', 'Episode 1', 'New page “Epi”']);
    assert.deepEqual((await hints(page)).slice(0, 2).sort(), ['Harbor Tales', 'The Ninja Bunch']);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('See [[light');
    await listShows(page);
    assert.equal((await shownList(page))[0], 'Lighthouse keeper');
    await page.keyboard.press('Enter');
    await listGone(page);
    await page.keyboard.type('tonight');
    assert.deepEqual(await refsIn(page), [['pg1', 'Lighthouse keeper']]);
    assert.equal(await lastLine(page), 'See Lighthouse keeper tonight');
  });

  await check('[[ with a new name makes the page and links it', async () => {
    await newLine(page);
    await page.keyboard.type('[[Storm of 1912');
    await listShows(page);
    assert.deepEqual(await shownList(page), ['New page “Storm of 1912”']);
    await page.keyboard.press('Enter');
    await listGone(page);
    const [[id, title]] = await refsIn(page);
    assert.equal(title, 'Storm of 1912');
    assert.match(id, /^pg_/);
  });

  await check('@ outside a project lists characters only', async () => {
    await newLine(page);
    await page.keyboard.type('Ask @');
    await listShows(page);
    assert.deepEqual(await shownList(page), ['Captain Ola', 'Kenji']);
    await page.keyboard.press('Escape');
  });

  await check('@ in a project lists its characters, then its places; a pick is a link shown as the name', async () => {
    await goPage(page, 'g1');
    await newLine(page);
    await page.keyboard.type('Fight at @');
    await listShows(page);
    // Mika has no type of her own: she sits in Characters.
    assert.deepEqual(await shownList(page), ['Kenji', 'Mika', 'Harbor Dojo']);
    assert.deepEqual(await hints(page), ['character', 'character', 'place']);
    await page.keyboard.type('har');
    await page.waitForFunction(() => document.querySelectorAll('.suggest li').length === 1);
    await page.keyboard.press('Enter');
    await listGone(page);
    assert.deepEqual(await refsIn(page), [['s1', 'Harbor Dojo']]);
  });

  await check('the thought box (Alt + J) offers the same list, and Enter takes it without filing', async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+j');
    await page.waitForSelector('#zm-thought-in', { state: 'visible' });
    await page.keyboard.type('Rehearse #stun');
    await page.waitForFunction(() => document.querySelector('.suggest')?.hidden === false && document.querySelectorAll('.suggest li').length === 1);
    assert.deepEqual(await shownList(page), ['#stunts']);
    await page.keyboard.press('Enter');
    await listGone(page);
    assert.equal(await page.locator('#zm-thought-in').inputValue(), 'Rehearse #stunts ');
    assert.equal(await page.locator('#zm-thought-in').isVisible(), true, 'not filed yet');
    await page.keyboard.type('with [[Light');
    await listShows(page);
    await page.keyboard.press('Enter');
    await listGone(page);
    assert.equal(await page.locator('#zm-thought-in').inputValue(), 'Rehearse #stunts with [[Lighthouse keeper]] ');
    await page.keyboard.type('#mu');
    await listShows(page);
    await page.keyboard.press('Escape');
    await listGone(page);
    assert.equal(await page.locator('#zm-thought-in').isVisible(), true, 'Esc closed only the list');
    await page.locator('#zm-thought-in').fill('');
    await page.keyboard.press('Escape');
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });

  // ---------- phone ----------
  const phone = await open({ ...devices['Pixel 7'], colorScheme: 'dark' });
  await check('phone: the matches sit in one row above the keyboard, and a tap takes one', async () => {
    await goPage(phone, DAY);
    await phone.locator('#outline-editor li > p').last().tap();
    await phone.keyboard.press('End');
    await phone.keyboard.press('Enter');
    await phone.keyboard.type('#');
    await listShows(phone);
    assert.ok(await phone.locator('.suggest').evaluate((b) => b.classList.contains('row')), 'a row');
    const box = await phone.locator('.suggest').boundingBox();
    const caret = await phone.locator('#outline-editor li > p').last().boundingBox();
    const vh = await phone.evaluate(() => (window.visualViewport ? visualViewport.offsetTop + visualViewport.height : innerHeight));
    assert.ok(box.y + box.height <= vh + 1, 'on screen');
    assert.ok(box.y >= caret.y + caret.height || box.y + box.height <= caret.y, 'never over the line being typed');
    const items = await phone.locator('.suggest li').evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().height));
    assert.ok(items.every((h) => h >= 40), 'thumb-sized');
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide <= 1, `${wide}px too wide`);
    await phone.locator('.suggest li', { hasText: '#music' }).tap();
    await listGone(phone);
    assert.equal(await lastLine(phone), '#music ');
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : 'autocomplete: all passed');
process.exit(failed ? 1 : 0);
