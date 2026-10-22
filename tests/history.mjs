// History: versions of chapters and pages, what changed since each, bringing
// back deleted paragraphs and lines, going back to a version (undoably),
// versions reaching the other device, and old versions thinning out.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { thin, compare, words } from '../src/history.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4189;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

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
async function device(viewport = { width: 1300, height: 850 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 700 });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(URL);
  await p.waitForSelector('#editor .ProseMirror');
  await sleep(500);
  return p;
}
const syncNow = (p) => p.evaluate(() => window.__sync.run());
const text = (p) => p.locator('#editor .ProseMirror').innerText();
const openHistory = async (p) => {
  if (await p.locator('.history').isVisible()) await p.keyboard.press('Escape'); await p.keyboard.press('Control+Shift+H'); await p.waitForSelector('.history', { state: 'visible' }); await sleep(400); };
const closeHistory = async (p) => { await p.keyboard.press('Escape'); await sleep(200); };
// Type a paragraph at the very end of the chapter.
const setText = (p, paras) => p.evaluate((ps) => {
  const ed = window.__editor;
  ed.commands.setContent({ type: 'doc', content: ps.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }, { emitUpdate: true });
}, paras);

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 5).join('\n     ')}`); }
}

try {
  await check('history thins out: everything for two days, hourly for two weeks, daily after', async () => {
    const now = Date.parse('2026-10-22T12:00:00');
    const list = [];
    let id = 0;
    // Every 10 minutes for 30 days.
    for (let t = now - 30 * 864e5; t <= now; t += 6e5) list.push({ id: id++, root: 'c', at: t });
    const drop = new Set(thin(list, now));
    const kept = list.filter((v) => !drop.has(v.id));
    const recent = kept.filter((v) => now - v.at < 2 * 864e5).length;
    assert.equal(recent, list.filter((v) => now - v.at < 2 * 864e5).length, 'all of the last two days');
    const hourly = kept.filter((v) => now - v.at >= 2 * 864e5 && now - v.at < 14 * 864e5).length;
    assert.ok(hourly >= 12 * 24 - 2 && hourly <= 12 * 24 + 2, `about one an hour: ${hourly}`);
    const daily = kept.filter((v) => now - v.at >= 14 * 864e5).length;
    assert.ok(daily >= 15 && daily <= 17, `about one a day: ${daily}`);
    // Labelled versions (like "Before going back") are always kept.
    assert.ok(!thin([{ id: 'x', root: 'c', at: now - 20 * 864e5, label: 'Before going back' }, { id: 'y', root: 'c', at: now - 20 * 864e5 + 1 }], now).includes('x'));
  });

  await check('comparing versions finds removed, added and changed paragraphs', async () => {
    const doc = (ps) => ({ type: 'doc', content: ps.map(([eid, t]) => ({ type: 'paragraph', attrs: { eid }, content: [{ type: 'text', text: t }] })) });
    const c = compare(doc([['a', 'One.'], ['b', 'Two.'], ['c', 'Three.']]), doc([['a', 'One.'], ['c', 'Three, longer.'], ['d', 'Four.']]));
    assert.deepEqual(c.map((x) => x.op), ['same', 'del', 'chg', 'ins']);
    assert.equal(c[1].after, 'a');
    assert.deepEqual(words('the cold sea', 'the warm sea').filter((w) => w.op !== '='), [{ t: 'cold', op: '-' }, { t: 'warm', op: '+' }]);
  });

  const a = await device();
  const b = await device();

  await check('a deleted paragraph shows in what changed, and comes back where it was', async () => {
    await a.locator('#editor .ProseMirror').click();
    await setText(a, ['The tide came in.', 'Gulls argued on the pier.', 'Night fell.']);
    await sleep(600);
    await openHistory(a);
    await closeHistory(a);
    // Take out the middle paragraph and change the last.
    await a.evaluate(() => {
      const ed = window.__editor;
      const json = ed.getJSON();
      json.content.splice(1, 1);
      json.content[1].content[0].text = 'Night fell fast.';
      ed.commands.setContent(json, { emitUpdate: true });
    });
    await sleep(600);
    await openHistory(a);
    const items = await a.locator('#history-list li').allInnerTexts();
    assert.ok(items.some((x) => /^Today/i.test(x)), items.join(' | '));
    assert.ok(items.some((x) => /Deleted paragraphs/.test(x)), items.join(' | '));
    // The older version: the deleted paragraph is struck, the changed one shows its words.
    await a.locator('#history-list button').filter({ hasText: /first kept/ }).click();
    await sleep(300);
    assert.equal(await a.locator('.hb-del .hb-text').innerText(), 'Gulls argued on the pier.');
    assert.match(await a.locator('.hb-chg ins').innerText(), /fast\./);
    await a.locator('.hb-del .history-back').click();
    await sleep(500);
    await closeHistory(a);
    assert.match(await text(a), /The tide came in\.\s+Gulls argued on the pier\.\s+Night fell fast\./);
  });

  await check('Deleted paragraphs brings one back even without opening a version', async () => {
    await a.evaluate(() => {
      const ed = window.__editor;
      const json = ed.getJSON();
      json.content.shift();
      ed.commands.setContent(json, { emitUpdate: true });
    });
    await sleep(600);
    await openHistory(a);
    await a.locator('#history-list .history-deleted').click();
    await sleep(300);
    await a.locator('.hb', { hasText: 'The tide came in.' }).locator('.history-back').click();
    await sleep(600);
    await closeHistory(a);
    assert.match(await text(a), /^The tide came in\.\s+Gulls argued/);
  });

  await check('going back to a version asks, keeps the current text as a version, and can be undone from history', async () => {
    await openHistory(a);
    await a.locator('#history-list button').filter({ hasText: /first kept/ }).click();
    await a.locator('#history-restore').click();
    await a.waitForSelector('.ask');
    await a.locator('.ask .pill').click();
    await sleep(700);
    assert.match(await text(a), /Night fell\.$/);
    await openHistory(a);
    const items = await a.locator('#history-list button').allInnerTexts();
    assert.ok(items.some((x) => /Before going back/.test(x)), items.join(' | '));
    await a.locator('#history-list button').filter({ hasText: /Before going back/ }).click();
    await a.locator('#history-restore').click();
    await a.locator('.ask .pill').click();
    await sleep(700);
    assert.match(await text(a), /Night fell fast\./);
  });

  await check('pages keep history too, and a deleted line comes back', async () => {
    await a.keyboard.press('Control+J');
    await a.waitForSelector('#outline-editor .ProseMirror-focused');
    await sleep(500);
    await a.keyboard.type('Buy stamps');
    await a.keyboard.press('Enter');
    await a.keyboard.type('Call the printer');
    await sleep(700);
    await openHistory(a);
    await closeHistory(a);
    await a.evaluate(() => {
      const ed = window.__outline;
      const json = ed.getJSON();
      json.content[0].content.pop();
      ed.commands.setContent(json, { emitUpdate: true });
    });
    await sleep(700);
    assert.doesNotMatch(await a.locator('#outline-editor').innerText(), /printer/);
    await openHistory(a);
    assert.match(await a.locator('#history-title').innerText(), /History · /i);
    await a.locator('#history-list .history-deleted').click();
    await sleep(300);
    await a.locator('.hb', { hasText: 'Call the printer' }).locator('.history-back').click();
    await sleep(600);
    await closeHistory(a);
    assert.match(await a.locator('#outline-editor').innerText(), /Buy stamps\s+Call the printer/);
  });

  await check('versions reach the other device', async () => {
    await syncNow(a);
    await syncNow(b);
    await sleep(500);
    await b.keyboard.press('Control+J');
    await sleep(400);
    await b.keyboard.press('Control+J');
    await sleep(800);
    assert.match(await text(b), /Night fell fast/);
    await openHistory(b);
    const items = await b.locator('#history-list button').allInnerTexts();
    assert.ok(items.filter((x) => /words/.test(x)).length >= 1, items.join(' | '));
    await b.locator('#history-list button').filter({ hasText: /first kept/ }).click();
    await sleep(300);
    assert.ok(await b.locator('.hb').count() > 0);
  });

  await check('on a phone, a long version scrolls to its end', async () => {
    const ph = await device({ width: 390, height: 800 });
    const long = Array.from({ length: 60 }, (_, k) => `Line ${k + 1} of a long day, with enough words to wrap onto a second row.`);
    await setText(ph, long);
    await sleep(600);
    await openHistory(ph);
    await closeHistory(ph);
    await ph.evaluate(() => {
      const ed = window.__editor;
      const json = ed.getJSON();
      json.content[json.content.length - 1].content[0].text = 'The very last line, changed.';
      ed.commands.setContent(json, { emitUpdate: true });
    });
    await sleep(600);
    await openHistory(ph);
    await ph.locator('#history-list button').filter({ hasText: '900 words' }).click();
    await sleep(300);
    const last = ph.locator('.hb-chg').last();
    await last.scrollIntoViewIfNeeded();
    await sleep(200);
    const box = await last.boundingBox();
    assert.ok(box && box.y + box.height <= 800, `last change sits at ${box && Math.round(box.y)}px, below the screen`);
    const scrolled = await ph.evaluate(() => document.querySelector('.history-preview').scrollTop);
    assert.ok(scrolled > 0, 'the version scrolls');
    await ph.context().close();
  });

  await check('no page errors', async () => assert.deepEqual([...a.errors, ...b.errors], []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
