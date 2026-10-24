// The Tags page: every #tag with its count and when it was last used, sorted
// three ways; Claude sorts tags into groups and points out ones that look the
// same; tags move between groups and can be renamed or merged everywhere;
// a tag can be gone through one thing at a time (Done, Keep, Untag).
// window.__claude stands in for Claude.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4193;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const asked = [];
function claude(body) {
  if (body.mode !== 'tags') return {};
  asked.push(body);
  const mine = body.groups || [];
  return {
    groups: [...mine, { name: 'Film references', tags: ['stunts', 'stunt', 'anime'] }, { name: 'Music', tags: ['music'] }, { name: 'Writing', tags: ['idea'] }],
    same: [{ tags: ['stunt', 'stunts'], keep: 'stunts' }]
  };
}
const fake = () => { window.__claude = (body) => window.__toClaude(body); };

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const LINES = [
  ['l1', 'How to fake a ninja fight #stunts', 6],
  ['l2', 'Wire work behind the scenes #stunts #anime', 5],
  ['l3', 'Falling down stairs safely #stunts', 4],
  ['l4', 'Old stunt reel from 1985 #stunt', 3],
  ['l5', 'Sea shanty theme song #music', 2],
  ['l6', 'Ninjas raised by a bakery #idea', 1]
];

const seed = (rows) => new Promise((res, rej) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
    for (const row of rows) { tx.objectStore('entries').put(row); tx.objectStore('outbox').put({ id: row.id }); }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  };
});
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const row = async (p, id) => (await all(p)).find((r) => r.id === id);
const tagRow = (p, tag) => p.locator(`.tg-tag[data-tag="${tag}"]`);
const command = async (p, name) => {
  await p.keyboard.press('Control+K');
  await p.keyboard.type(name);
  await sleep(250);
  await p.keyboard.press('Enter');
  await sleep(500);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark' });
await ctx.exposeFunction('__toClaude', claude);
await ctx.addInitScript(fake);
const page = await ctx.newPage();
page.errors = [];
page.on('pageerror', (e) => page.errors.push(e.message));

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

const shots = process.env.SHOTS;
try {
  await page.goto(URL);
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(500);
  const now = Date.now();
  const tagsOf = (t) => [...t.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
  await page.evaluate(seed, [
    { id: `day-${today}`, kind: 'day', title: today, parent_id: null, sort: 0, text: '', content: null, tags: [], links: [], fields: {}, deleted: false, created_at: now, updated_at: now },
    ...LINES.map(([id, text, ago], i) => ({ id, kind: 'line', parent_id: `day-${today}`, sort: (i + 1) * 1024, text, content: [{ type: 'text', text }], tags: tagsOf(text), links: [], fields: { done: false }, deleted: false, created_at: now - ago * 3600e3, updated_at: now - ago * 3600e3 })),
    { id: 'l1-s', kind: 'line', parent_id: 'l1', sort: 1024, text: 'A video by Stunt School showing a staged fight.', content: [{ type: 'text', text: 'A video by Stunt School showing a staged fight.' }], tags: [], links: [], fields: { by: 'claude' }, deleted: false, created_at: now, updated_at: now }
  ]);
  await page.reload();
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(700);

  await check('Ctrl + K "Tags" opens the Tags page with every tag, its count and when it was last used', async () => {
    await command(page, 'Tags: every tag');
    await page.waitForSelector('.tags-home .tg-tag');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'tags');
    assert.equal(await page.locator('.tg-tag').count(), 5);
    assert.equal((await tagRow(page, 'stunts').locator('.tg-count').textContent()).trim(), '3');
    assert.match(await tagRow(page, 'music').locator('.tg-when').textContent(), /h ago/);
    assert.match(await page.locator('#crumb').innerText(), /Library\s*›\s*Tags/);
  });

  await check('tags sort by most used, recently used, or A to Z', async () => {
    const order = () => page.locator('.tg-tag').evaluateAll((els) => els.map((e) => e.dataset.tag));
    assert.equal((await order())[0], 'stunts');
    await page.selectOption('.tg-bar select', 'recent');
    assert.equal((await order())[0], 'idea');
    await page.selectOption('.tg-bar select', 'az');
    assert.deepEqual(await order(), ['anime', 'idea', 'music', 'stunt', 'stunts']);
    await page.selectOption('.tg-bar select', 'used');
  });

  await check('Claude sorts the tags into groups and points out #stunt and #stunts', async () => {
    await page.click('.tg-bar [data-act="sort"]');
    await page.waitForSelector('.tg-group[data-group]');
    const names = await page.locator('.tg-group-name').evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(names, ['Film references', 'Music', 'Writing']);
    assert.equal(await page.locator('.tg-group').nth(0).locator('.tg-tag').count(), 3);
    assert.match(await page.locator('.tg-same').innerText(), /#stunt \(1\) and #stunts \(3\)/);
    assert.equal(asked[0].tags.find((t) => t.tag === 'stunts').count, 3);
    assert.ok(asked[0].tags.find((t) => t.tag === 'stunts').samples.includes('How to fake a ninja fight'));
    if (shots) await page.screenshot({ path: `${shots}/desktop-10-tags.png` });
  });

  await check('renaming a group and dragging a tag to another group are kept', async () => {
    const name = page.locator('.tg-group-name').nth(1);
    await name.fill('Music and sound');
    await name.press('Enter');
    await sleep(300);
    await tagRow(page, 'anime').dragTo(page.locator('.tg-group').nth(2));
    await sleep(500);
    const groups = (await row(page, 'settings-tag-groups')).fields.groups;
    assert.equal(groups[1].name, 'Music and sound');
    assert.ok(groups[2].tags.includes('anime'));
    assert.ok(!groups[0].tags.includes('anime'));
  });

  await check('asked again, Claude keeps your groups as they are', async () => {
    await page.click('.tg-bar [data-act="sort"]');
    await page.waitForFunction(() => !document.querySelector('.tg-bar [data-act="sort"]')?.disabled);
    await sleep(300);
    assert.deepEqual(asked[1].groups.map((g) => g.name), ['Film references', 'Music and sound', 'Writing']);
    const groups = (await row(page, 'settings-tag-groups')).fields.groups;
    assert.ok(groups[2].tags.includes('anime'), 'anime stays where you put it');
  });

  await check('merging #stunt into #stunts rewrites the line and drops the suggestion', async () => {
    await page.click('.tg-same button:has-text("Merge into #stunts")');
    await page.waitForFunction(() => !document.querySelector('.tg-tag[data-tag="stunt"]'));
    const l4 = await row(page, 'l4');
    assert.equal(l4.text, 'Old stunt reel from 1985 #stunts');
    assert.deepEqual(l4.tags, ['stunts']);
    assert.equal(await page.locator('.tg-same').count(), 0);
    assert.equal((await tagRow(page, 'stunts').locator('.tg-count').textContent()).trim(), '4');
  });

  await check('a tag opens to everything in it; Rename or merge renames it everywhere', async () => {
    await tagRow(page, 'music').locator('.tg-name').click();
    await page.waitForSelector('.tg-items li');
    assert.match(await page.locator('.tg-head h1').textContent(), /#music/);
    assert.match(await page.locator('.tg-items').innerText(), /Sea shanty/);
    await page.click('button:has-text("Rename or merge…")');
    await page.fill('.tg-rename input', 'songs');
    await page.click('.tg-rename button[type="submit"]');
    await page.waitForFunction(() => /#songs/.test(document.querySelector('.tg-head h1')?.textContent || ''));
    const l5 = await row(page, 'l5');
    assert.equal(l5.text, 'Sea shanty theme song #songs');
    const groups = (await row(page, 'settings-tag-groups')).fields.groups;
    assert.ok(groups[1].tags.includes('songs') && !groups[1].tags.includes('music'));
  });

  await check('going through a tag shows one thing at a time with what Claude wrote under it', async () => {
    await page.click('.tg-back');
    await tagRow(page, 'stunts').locator('.tg-name').click();
    await page.click('button:has-text("Go through them one by one")');
    await page.waitForSelector('.tg-card');
    assert.match(await page.locator('.tg-progress').textContent(), /1 of 4/);
    assert.match(await page.locator('.tg-text').textContent(), /Old stunt reel/);
    // The notes box is ready to type in; Alt + arrows step while it is.
    assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('tg-note')));
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForFunction(() => /2 of 4/.test(document.querySelector('.tg-progress')?.textContent || ''));
    await page.click('.tg-from');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => /3 of 4/.test(document.querySelector('.tg-progress')?.textContent || ''));
    assert.match(await page.locator('.tg-text').textContent(), /Wire work/);
    await page.keyboard.press('Alt+ArrowRight');
    await page.waitForFunction(() => /How to fake/.test(document.querySelector('.tg-text')?.textContent || ''));
    assert.match(await page.locator('.tg-kids').innerText(), /Stunt School/);
    await page.keyboard.type('Great reference for episode 3');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Try the table flip #idea');
    if (shots) await page.screenshot({ path: `${shots}/desktop-11-go-through.png` });
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForFunction(() => /3 of 4/.test(document.querySelector('.tg-progress')?.textContent || ''));
    const notes = (await all(page)).filter((r) => r.parent_id === 'l1' && !r.deleted).sort((a, b) => a.sort - b.sort);
    assert.deepEqual(notes.map((n) => n.text), ['A video by Stunt School showing a staged fight.', 'Great reference for episode 3', 'Try the table flip #idea']);
    assert.deepEqual(notes[2].tags, ['idea']);
  });

  await check('Done checks it off and moves on; done ones are skipped next time', async () => {
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => /3 of 3/.test(document.querySelector('.tg-progress')?.textContent || ''));
    assert.equal((await row(page, 'l2')).fields.done, true);
    assert.match(await page.locator('.tg-text').textContent(), /How to fake/);
    await page.click('.tg-skip input');
    await page.waitForFunction(() => /1 of 4/.test(document.querySelector('.tg-progress')?.textContent || ''));
    await page.click('.tg-skip input');
    await page.waitForFunction(() => /1 of 3/.test(document.querySelector('.tg-progress')?.textContent || ''));
  });

  await check('Untag takes the tag off one thing, keeps its words, and can be undone', async () => {
    await page.click('.tg-acts [data-act="untag"]');
    await page.waitForFunction(() => /1 of 2/.test(document.querySelector('.tg-progress')?.textContent || ''));
    const l4 = await row(page, 'l4');
    assert.equal(l4.text, 'Old stunt reel from 1985');
    assert.deepEqual(l4.tags, []);
    await page.click('.toast button:has-text("Undo")');
    await page.waitForFunction(() => /1 of 3/.test(document.querySelector('.tg-progress')?.textContent || ''));
    assert.deepEqual((await row(page, 'l4')).tags, ['stunts']);
  });

  await check('the end says so, and the shelf and Library both lead to the Tags page', async () => {
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Alt+ArrowRight'); await sleep(300); }
    await page.waitForSelector('.tg-end');
    await page.keyboard.press('Control+Shift+O');
    await page.waitForSelector('.library .lib-tags');
    await page.click('.library .lib-tags');
    await page.waitForSelector('.tags-home .tg-tag');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'tags');
  });

  await check('Back steps from a tag to the list', async () => {
    await tagRow(page, 'idea').locator('.tg-name').click();
    await page.waitForFunction(() => /#idea/.test(document.querySelector('.tg-head h1')?.textContent || ''));
    await page.goBack();
    await page.waitForSelector('.tags-home .tg-tag');
  });

  await check('on a phone the Tags page fits the screen', async () => {
    const phone = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await phone.exposeFunction('__toClaude', claude);
    await phone.addInitScript(fake);
    const p = await phone.newPage();
    await p.goto(URL);
    await p.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
    await p.evaluate(seed, [{ id: 'p1', kind: 'line', parent_id: `day-${today}`, sort: 1024, text: 'A very long line about a stunt reel with a long name #a-really-long-tag-name-for-testing', content: [{ type: 'text', text: 'x' }], tags: ['a-really-long-tag-name-for-testing'], links: [], fields: {}, deleted: false, created_at: Date.now(), updated_at: Date.now() }]);
    await p.evaluate(() => { localStorage.setItem('place', JSON.stringify({ view: 'tags' })); });
    await p.reload();
    await p.waitForSelector('.tags-home .tg-tag');
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 0, `page is ${wide}px too wide`);
    if (shots) await p.screenshot({ path: `${shots}/phone-7-tags.png` });
    await phone.close();
  });

  await check('no page errors', async () => { assert.deepEqual(page.errors, []); });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `${failed} failed` : 'tags: all passed');
process.exit(failed ? 1 : 0);
