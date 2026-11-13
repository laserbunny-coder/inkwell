// The history strip: hidden until asked for, scrubbing back through a
// chapter or page, Show changes, Compare, bringing one paragraph or line back
// (with Undo), going back to a version (with Undo), outline lines with their
// children, the phone width, and that looking writes nothing.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withBlockBack } from '../src/history.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4193;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

// Signed in to a stand-in for the cloud (as in history.mjs), so the app opens
// on the writing page the same way here and on the test machine.
const table = new Map();
let clock = Date.parse('2026-10-20T00:00:00Z');
function remote(op, arg) {
  if (op === 'push') {
    const stamp = new Date((clock += 1000)).toISOString();
    return arg.map((r) => { table.set(`${r.user}:${r.id}`, r); return { id: r.id, updated_at: stamp }; });
  }
  return [];
}
const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: "u1" }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows), pull: () => window.__remote('pull', {}),
    subscribe() {}, unsubscribe() {}
  };
};
const browser = await chromium.launch();
async function device(viewport = { width: 1300, height: 850 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 700, isMobile: viewport.width < 700 });
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
const text = (p) => p.locator('#editor .ProseMirror:not(.hs-past)').innerText();
const para = (id, t) => ({ type: 'paragraph', attrs: { eid: id }, content: [{ type: 'text', text: t }] });
const setDoc = (p, content, sel = '__editor') => p.evaluate(([c, s]) => window[s].commands.setContent({ type: 'doc', content: c }, { emitUpdate: true }), [content, sel]);
const open = async (p) => { await p.keyboard.press('Control+Shift+H'); await p.waitForSelector('.hstrip .hs-tick'); await sleep(250); };
const close = async (p) => { await p.keyboard.press('Escape'); await sleep(250); };
// Keep a version: opening the strip saves what's there first.
const keepNow = async (p) => { await sleep(300); await open(p); await close(p); await sleep(60); };
const head = (p) => p.locator('.hs-when .hs-t').innerText();
const counts = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const db = r.result;
    const tx = db.transaction(['snapshots', 'entries']);
    const out = {};
    let left = 2;
    const fin = () => { if (--left === 0) res(out); };
    tx.objectStore('snapshots').count().onsuccess = (e) => { out.snaps = e.target.result; fin(); };
    tx.objectStore('entries').getAll().onsuccess = (e) => { out.entries = e.target.result.length; out.latest = Math.max(0, ...e.target.result.map((x) => x.updated_at || 0)); fin(); };
  };
}));
const clickMark = async (p, i, { shift = false } = {}) => {
  const box = await p.locator('.hs-tick').nth(i).boundingBox();
  const track = await p.locator('.hs-track').boundingBox();
  if (shift) await p.keyboard.down('Shift');
  await p.mouse.click(box.x + box.width / 2, track.y + track.height / 2);
  if (shift) await p.keyboard.up('Shift');
  await sleep(150);
};

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 6).join('\n     ')}`); }
}

try {
  await check('a cut outline line comes back under its parent with its own lines, leaving out ones still there', async () => {
    const li = (id, t, kids) => ({ type: 'listItem', attrs: { eid: id }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }, ...(kids ? [{ type: 'bulletList', content: kids }] : [])] });
    const then = { type: 'doc', content: [{ type: 'bulletList', content: [li('p', 'Plan', [li('a', 'Shots', [li('a1', 'Wide'), li('a2', 'Close')]), li('b', 'Sound')])] }] };
    // Today: "Shots" was cut, and "Close" moved to the top.
    const now = { type: 'doc', content: [{ type: 'bulletList', content: [li('a2', 'Close'), li('p', 'Plan', [li('b', 'Sound')])] }] };
    const got = withBlockBack(now, then, 'a');
    const plan = got.content[0].content[1];
    const shots = plan.content[1].content[0];
    assert.equal(shots.attrs.eid, 'a');
    assert.deepEqual(shots.content[1].content.map((x) => x.attrs.eid), ['a1'], 'Close is still in today’s page, so only Wide comes with it');
    // A reworded line takes its old words and keeps the lines under it today.
    const reworded = withBlockBack({ type: 'doc', content: [{ type: 'bulletList', content: [li('p', 'Plan v2', [li('b', 'Sound')])] }] }, then, 'p');
    assert.equal(reworded.content[0].content[0].content[0].content[0].text, 'Plan');
    assert.equal(reworded.content[0].content[0].content[1].content[0].attrs.eid, 'b');
  });

  const a = await device();
  await a.locator('#editor .ProseMirror').click();

  await check('hidden until asked for; opening and closing leaves the page untouched and writes nothing', async () => {
    assert.equal(await a.locator('.hstrip').count(), 0, 'no strip on its own');
    await setDoc(a, [para('p1', 'The tide went out.'), para('p2', 'She carried the pan.'), para('p3', 'Nobody went to the old works.')]);
    await keepNow(a);
    await setDoc(a, [para('p1', 'The tide went out further than ever.'), para('p2', 'She carried the pan.'), para('p3', 'Nobody went to the old works.')]);
    await keepNow(a);
    await setDoc(a, [para('p1', 'The tide went out further than ever.'), para('p2', 'She carried the pan on her hip.'), para('p4', 'Then she followed the prints.')]);
    await keepNow(a);
    const before = await text(a);
    const was = await counts(a);
    await open(a);
    assert.equal(await head(a), 'Now');
    // Scrub about, compare, show changes: all looking.
    await a.keyboard.press('ArrowLeft');
    await a.keyboard.press('ArrowLeft');
    await a.locator('.hs-btn', { hasText: 'Show changes' }).click();
    await a.keyboard.press('ArrowRight');
    await close(a);
    assert.equal(await a.locator('.hstrip').count(), 0);
    assert.equal(await text(a), before);
    assert.equal(await a.evaluate(() => window.__editor.isEditable), true, 'editable again');
    const now = await counts(a);
    assert.deepEqual(now, was, 'nothing written while only looking');
  });

  await check('scrubbing shows each version, read-only, and the header says when', async () => {
    await open(a);
    const n = await a.locator('.hs-tick').count();
    assert.ok(n >= 3, `marks: ${n}`);
    assert.equal(await a.evaluate(() => window.__editor.isEditable), false, 'read-only while open');
    await a.keyboard.press('ArrowLeft');
    assert.match(await a.locator('.hs-past').innerText(), /old works\./);
    assert.match(await a.locator('.hs-past').innerText(), /further than ever/);
    assert.ok(!(await a.locator('#editor .ProseMirror:not(.hs-past)').isVisible()), 'today’s page is hidden behind the version');
    assert.match(await head(a), /^Today, /);
    assert.match(await a.locator('.hs-when .hs-sub').innerText(), /(ago|just now) · \d+ words/);
    await a.keyboard.press('ArrowLeft');
    assert.doesNotMatch(await a.locator('.hs-past').innerText(), /further/);
    // Drag all the way right: Now again, today's page shown.
    const track = await a.locator('.hs-track').boundingBox();
    await a.mouse.move(track.x + 4, track.y + 20);
    await a.mouse.down();
    await a.mouse.move(track.x + track.width / 2, track.y + 20, { steps: 5 });
    await a.mouse.move(track.x + track.width - 2, track.y + 20, { steps: 5 });
    await a.mouse.up();
    await sleep(100);
    assert.equal(await head(a), 'Now');
    assert.ok(await a.locator('#editor .ProseMirror:not(.hs-past)').isVisible());
    await close(a);
  });

  await check('Show changes marks what today’s page no longer has', async () => {
    await open(a);
    await clickMark(a, 0);
    await a.locator('.hs-btn', { hasText: 'Show changes' }).click();
    await sleep(100);
    assert.match(await a.locator('.hs-past .hs-gone').first().innerText(), /old works/);
    await close(a);
  });

  await check('Compare lines up a cut and an added paragraph side by side', async () => {
    await open(a);
    const n = await a.locator('.hs-tick').count();
    await clickMark(a, 0);
    await a.locator('.hs-btn', { hasText: 'Compare' }).click();
    await clickMark(a, n - 1);
    assert.ok(await a.locator('.hs-cmp').isVisible());
    assert.match(await head(a), /beside Now/);
    const cells = await a.locator('.hs-cmp > *').allInnerTexts();
    const cutAt = cells.findIndex((c) => /old works/.test(c));
    assert.ok(cutAt > 0, cells.join(' | '));
    assert.equal(cells[cutAt + 1], 'Cut', 'the cut one sits beside a gap');
    const addAt = cells.findIndex((c) => /followed the prints/.test(c));
    assert.equal(cells[addAt - 1], 'Not written yet');
    assert.ok(await a.locator('.hs-cmp ins').count() > 0, 'changed words marked');
    // Shift + click picks the second one too.
    await a.keyboard.press('Escape');
    await clickMark(a, 0);
    await clickMark(a, 1, { shift: true });
    assert.ok(await a.locator('.hs-cmp').isVisible());
    await a.keyboard.press('Escape');
    await close(a);
  });

  await check('Bring this back puts a cut paragraph back where it sat, and Undo takes it out', async () => {
    await open(a);
    await clickMark(a, 0);
    const p3 = a.locator('.hs-past [data-eid="p3"]');
    await p3.hover();
    await p3.locator('.hs-tools button', { hasText: 'Bring this back' }).click();
    await sleep(500);
    assert.equal(await head(a), 'Now', 'back to Now');
    assert.match(await text(a), /on her hip\.\s+Nobody went to the old works\.\s+Then she followed/);
    const marks = await a.locator('.hs-tick').count();
    await a.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await sleep(500);
    assert.doesNotMatch(await text(a), /old works/);
    assert.ok(await a.locator('.hs-tick').count() >= marks, 'the change is a mark too');
    await close(a);
  });

  await check('Go back to this version, then Undo', async () => {
    await open(a);
    await clickMark(a, 0);
    await a.locator('.hs-btn', { hasText: 'Go back to this version' }).click();
    await sleep(500);
    assert.match(await text(a), /^The tide went out\.\s+She carried the pan\.\s+Nobody went/);
    const titles = await a.locator('.hs-tick').evaluateAll((ts) => ts.map((t) => t.title));
    assert.ok(titles.some((t) => /Before going back/.test(t)), titles.join(' | '));
    await a.locator('.toast .toast-action', { hasText: 'Undo' }).click();
    await sleep(500);
    assert.match(await text(a), /further than ever[\s\S]*followed the prints/);
    await close(a);
  });

  await check('a version can be named', async () => {
    await open(a);
    await clickMark(a, 1);
    await a.locator('.hs-name').click();
    await a.locator('.ask input').fill('Before the rewrite');
    await a.locator('.ask .pill').click();
    await sleep(300);
    assert.match(await a.locator('.hs-when .hs-sub').innerText(), /“Before the rewrite”/);
    assert.equal(await a.locator('.hs-tick.named').count() >= 1, true);
    await close(a);
  });

  await check('the chapter’s ⋯ menu opens it', async () => {
    await a.locator('#ch-more .more-btn').click();
    await a.locator('.pop-menu .pop-item', { hasText: /^History$/ }).click();
    await a.waitForSelector('.hstrip');
    await a.locator('.hs-done').click();
    await sleep(200);
    assert.equal(await a.locator('.hstrip').count(), 0);
  });

  await check('an outline line comes back with its children, from a page’s ⋯ menu', async () => {
    await a.keyboard.press('Control+J');
    await a.waitForSelector('#outline-editor .ProseMirror-focused');
    await sleep(400);
    await a.keyboard.type('Shoot list');
    await a.keyboard.press('Enter');
    await a.keyboard.press('Tab');
    await a.keyboard.type('Wide of the flats');
    await a.keyboard.press('Enter');
    await a.keyboard.type('Close on the prints');
    await a.keyboard.press('Enter');
    await a.keyboard.press('Shift+Tab');
    await a.keyboard.type('Call the printer');
    await sleep(500);
    await a.locator('#nb-more .more-btn').click();
    await a.locator('.pop-menu .pop-item', { hasText: /^History$/ }).click();
    await a.waitForSelector('.hstrip .hs-tick');
    await close(a);
    // Cut "Shoot list" and the lines under it.
    await a.evaluate(() => { const ed = window.__outline; const json = ed.getJSON(); json.content[0].content = json.content[0].content.filter((li) => !/Shoot list/.test(JSON.stringify(li.content[0]))); ed.commands.setContent(json, { emitUpdate: true }); });
    await sleep(500);
    assert.doesNotMatch(await a.locator('#outline-editor').innerText(), /Shoot list/);
    await open(a);
    await a.keyboard.press('ArrowLeft');
    const line = a.locator('.hs-past .hs-can', { hasText: 'Shoot list' }).first();
    await line.hover();
    await line.locator('.hs-tools button', { hasText: 'Bring this back' }).click();
    await sleep(600);
    await close(a);
    assert.match(await a.locator('#outline-editor').innerText(), /Shoot list\s+Wide of the flats\s+Close on the prints\s+Call the printer/);
  });

  await check('no page errors', async () => assert.deepEqual(a.errors, []));

  await check('on a phone the strip fits, and a tap shows a paragraph’s tools', async () => {
    const ph = await device({ width: 390, height: 800 });
    await setDoc(ph, [para('q1', 'One line here.'), para('q2', 'A second line that will be cut.')]);
    await keepNow(ph);
    await setDoc(ph, [para('q1', 'One line here, longer now.')]);
    await keepNow(ph);
    await open(ph);
    await ph.keyboard.press('ArrowLeft');
    const fits = await ph.evaluate(() => ({ doc: document.documentElement.scrollWidth, w: innerWidth, strip: document.querySelector('.hstrip').getBoundingClientRect().right }));
    assert.ok(fits.doc <= fits.w && fits.strip <= fits.w, JSON.stringify(fits));
    await ph.locator('.hs-past [data-eid="q2"]').tap();
    assert.ok(await ph.locator('.hs-past [data-eid="q2"] .hs-tools').isVisible());
    // Compare on a phone: one column.
    await ph.locator('.hs-btn', { hasText: 'Compare' }).tap();
    const n = await ph.locator('.hs-tick').count();
    const box = await ph.locator('.hs-tick').nth(n - 1).boundingBox();
    const track = await ph.locator('.hs-track').boundingBox();
    await ph.touchscreen.tap(box.x + box.width / 2, track.y + track.height / 2);
    await sleep(200);
    assert.ok(await ph.locator('.hs-cmp.one').isVisible());
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(ph.errors, []);
    await ph.context().close();
  });

  await check('dragging across 100 marks of a 5,000-word chapter keeps up', async () => {
    const p = await device();
    const ms = await p.evaluate(async () => {
      const words = (k) => Array.from({ length: 50 }, (_, j) => `word${(j * 7 + k) % 97}`).join(' ');
      const base = Array.from({ length: 100 }, (_, i) => ({ type: 'paragraph', attrs: { eid: `x${i}` }, content: [{ type: 'text', text: `${words(i)}.` }] }));
      const db = await new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => res(r.result); });
      const root = window.__hstrip.hooks.target().root.id;
      const tx = db.transaction('snapshots', 'readwrite');
      const t0 = Date.now() - 100 * 6e4;
      for (let v = 0; v < 100; v++) {
        const doc = { type: 'doc', content: base.map((b, i) => (i === v ? { ...b, content: [{ type: 'text', text: `Changed ${v}. ${words(v + 3)}` }] } : b)) };
        tx.objectStore('snapshots').add({ chapter_id: root, at: t0 + v * 6e4, words: 5000, doc });
      }
      await new Promise((res) => { tx.oncomplete = res; });
      await window.__hstrip.open();
      await new Promise((r) => setTimeout(r, 300));
      const t = performance.now();
      for (let i = window.__hstrip.marks.length - 1; i >= 0; i--) window.__hstrip.show(i);
      return performance.now() - t;
    });
    assert.ok(ms < 3000, `100 steps took ${Math.round(ms)} ms`);
    console.log(`     (100 steps across a 5,000-word chapter: ${Math.round(ms)} ms)`);
    await p.context().close();
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
