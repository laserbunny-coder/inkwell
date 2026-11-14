// Tick boxes on lines: a checklist line gives the lines right under it boxes,
// other lines stay notes, any line can have a box of its own, and ticking is
// the same as Done (Ctrl+Enter). Saved and synced to another device.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pageFirst } from './pagefirst.mjs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4247;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

// The cloud, shared by both devices.
const table = new Map();
let clock = Date.parse('2026-11-03T00:00:00Z');
function remote(op, arg) {
  if (op === 'push') {
    const stamp = new Date((clock += 1000)).toISOString();
    return arg.map((r) => { table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp }); return { id: r.id, updated_at: stamp }; });
  }
  return [...table.values()].filter((r) => r.updated_at > arg.since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1)).slice(arg.from, arg.from + 500);
}
const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows), pull: (since, from) => window.__remote('pull', { since, from }),
    subscribe() {}, unsubscribe() {}
  };
};

const browser = pageFirst(await chromium.launch());
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
async function device(options = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', ...options });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(URL);
  await p.waitForFunction(() => document.querySelector('#sync')?.dataset.state === 'synced');
  // Signed in, a first run waits on the cloud before it opens its place.
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  if ((await p.evaluate(() => document.documentElement.dataset.view)) !== 'notebook') await p.keyboard.press('Control+J');
  await p.waitForSelector('main.notebook #outline-editor .ProseMirror', { state: 'visible' });
  await sleep(300);
  return p;
}
const syncNow = (p) => p.evaluate(() => window.__sync.run());
const boxes = (p) => p.evaluate(() => [...document.querySelectorAll('#outline-editor li.boxed')].map((li) => `${li.querySelector(':scope > .line-box').getAttribute('aria-checked') === 'true' ? '[x]' : '[ ]'} ${li.querySelector(':scope > p').firstChild?.textContent ?? ''}`));
const caretOn = (p, text) => p.evaluate((t) => {
  const ed = window.__outline;
  ed.state.doc.descendants((n, pos) => { if (n.type.name === 'paragraph' && n.textContent === t) ed.commands.setTextSelection(pos + 1 + t.length); });
  ed.commands.focus();
}, text);
const command = async (p, label) => {
  await p.keyboard.press('Control+K');
  await p.locator('#palette-input').fill(label);
  await p.locator('#palette-list li', { hasText: label }).first().click();
  await sleep(200);
};
const line = (p, text) => p.locator('#outline-editor li', { has: p.locator(':scope > p', { hasText: new RegExp(`^${text}(\\d+/\\d+)?$`) }) });

try {
  const laptop = await device({ viewport: { width: 1280, height: 860 } });
  await caretOn(laptop, '');
  await laptop.keyboard.type('Camping trip');
  await laptop.keyboard.press('Enter');
  await laptop.keyboard.type('Bring the good tent, the old one leaks');
  await laptop.keyboard.press('Enter');
  await laptop.keyboard.type('Gear');
  await laptop.keyboard.press('Enter');
  await laptop.keyboard.press('Tab');
  for (const t of ['Tent', 'Stove', 'Lantern']) { await laptop.keyboard.type(t); await laptop.keyboard.press('Enter'); }
  await laptop.keyboard.type('Ask Nate about the stove fuel');
  await laptop.keyboard.press('Enter');
  await laptop.keyboard.press('Shift+Tab');
  await laptop.keyboard.type('Food');
  await sleep(300);

  await check('a line made a checklist gives the lines right under it boxes', async () => {
    await caretOn(laptop, 'Gear');
    await command(laptop, 'Checklist: tick boxes on the lines under this one');
    assert.deepEqual(await boxes(laptop), ['[ ] Tent', '[ ] Stove', '[ ] Lantern', '[ ] Ask Nate about the stove fuel']);
    assert.equal(await line(laptop, 'Gear').locator(':scope > p .check-count').textContent(), '0/4');
    // Lines outside it stay plain.
    assert.equal(await line(laptop, 'Food').locator('.line-box').count(), 0);
    assert.equal(await line(laptop, 'Camping trip').locator(':scope > .line-box').count(), 0);
  });

  await check('a line in a checklist can go without a box, as a note', async () => {
    await caretOn(laptop, 'Ask Nate about the stove fuel');
    await command(laptop, 'No box on this line');
    assert.deepEqual(await boxes(laptop), ['[ ] Tent', '[ ] Stove', '[ ] Lantern']);
    assert.equal(await line(laptop, 'Gear').locator(':scope > p .check-count').textContent(), '0/3');
  });

  await check('clicking a box ticks it, strikes the line through and counts it', async () => {
    await line(laptop, 'Tent').locator(':scope > .line-box').click();
    assert.deepEqual(await boxes(laptop), ['[x] Tent', '[ ] Stove', '[ ] Lantern']);
    assert.equal(await line(laptop, 'Tent').getAttribute('data-done'), '');
    assert.equal(await line(laptop, 'Gear').locator(':scope > p .check-count').textContent(), '1/3');
    await line(laptop, 'Tent').locator(':scope > .line-box').click();
    assert.deepEqual(await boxes(laptop), ['[ ] Tent', '[ ] Stove', '[ ] Lantern']);
  });

  await check('Ctrl + Enter still strikes a line through, and ticks its box', async () => {
    await caretOn(laptop, 'Stove');
    await laptop.keyboard.press('Control+Enter');
    assert.deepEqual(await boxes(laptop), ['[ ] Tent', '[x] Stove', '[ ] Lantern']);
    await caretOn(laptop, 'Bring the good tent, the old one leaks');
    await laptop.keyboard.press('Control+Enter');
    assert.equal(await line(laptop, 'Bring the good tent, the old one leaks').getAttribute('data-done'), '');
    assert.equal(await line(laptop, 'Bring the good tent, the old one leaks').locator(':scope > .line-box').count(), 0);
    await laptop.keyboard.press('Control+Enter');
  });

  await check('Enter on a box line starts the next thing to tick', async () => {
    await caretOn(laptop, 'Lantern');
    await laptop.keyboard.press('Enter');
    await laptop.keyboard.type('Water jug');
    assert.deepEqual(await boxes(laptop), ['[ ] Tent', '[x] Stove', '[ ] Lantern', '[ ] Water jug']);
  });

  await check('typing [ ] at the start of any line gives it a box of its own', async () => {
    await caretOn(laptop, 'Food');
    await laptop.keyboard.press('Enter');
    await laptop.keyboard.press('Tab');
    await laptop.keyboard.type('[ ] Buy marshmallows');
    await laptop.keyboard.press('Enter');
    await laptop.keyboard.type('[x] Check the fire ban');
    assert.deepEqual((await boxes(laptop)).slice(4), ['[ ] Buy marshmallows', '[x] Check the fire ban']);
    // The "/box" menu takes it off again.
    await caretOn(laptop, 'Check the fire ban');
    await command(laptop, 'No box on this line');
    assert.equal(await line(laptop, 'Check the fire ban').locator('.line-box').count(), 0);
    await command(laptop, 'Box on this line');
    assert.equal(await line(laptop, 'Check the fire ban').locator('.line-box').count(), 1);
  });

  await check('the right-click line menu has Checklist and Box', async () => {
    await line(laptop, 'Food').locator(':scope > .line-gutter').click({ button: 'right' });
    const menu = laptop.locator('.handle-menu, .hm-menu, [role="menu"]').last();
    await menu.waitFor();
    const text = await menu.innerText();
    assert.match(text, /Checklist: boxes on the lines under it/);
    assert.match(text, /Box on this line/);
    await laptop.keyboard.press('Escape');
  });

  await check('ticks and checklists are saved and reach the other device', async () => {
    await sleep(1200);
    await syncNow(laptop);
    const rows = [...table.values()].filter((r) => r.kind === 'line' && !r.deleted);
    const by = (t) => rows.find((r) => r.text === t);
    assert.equal(by('Gear').fields.checklist, true);
    assert.equal(by('Stove').fields.done, true);
    assert.equal(by('Ask Nate about the stove fuel').fields.box, false);
    assert.equal(by('Buy marshmallows').fields.box, true);
    assert.equal('box' in by('Tent').fields, false);
    const phone = await device({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    await phone.waitForFunction(() => document.querySelectorAll('#outline-editor li.boxed').length >= 6, null, { timeout: 8000 });
    assert.deepEqual(await boxes(phone), ['[ ] Tent', '[x] Stove', '[ ] Lantern', '[ ] Water jug', '[ ] Buy marshmallows', '[x] Check the fire ban']);

    // A tap on the phone ticks it without bringing up the keyboard.
    await phone.evaluate(() => document.activeElement?.blur());
    const box = line(phone, 'Lantern').locator(':scope > .line-box');
    // Seen on the publish runner's older browser: say what the box looks like if it can't be tapped.
    await box.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
      const info = await phone.evaluate(() => {
        const b = [...document.querySelectorAll('#outline-editor .line-box')].map((x) => { const r = x.getBoundingClientRect(); const cs = getComputedStyle(x); return `${x.closest('li').querySelector(':scope > p').textContent}: ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} ${cs.display} ${cs.visibility} ${cs.fontSize}`; });
        const lis = [...document.querySelectorAll('#outline-editor li')].map((li) => `${li.className}|${getComputedStyle(li).display}`);
        return { b, lis, view: document.documentElement.className, h: innerHeight, sy: scrollY };
      });
      throw new Error(JSON.stringify(info));
    });
    await box.tap();
    await sleep(200);
    assert.deepEqual((await boxes(phone)).slice(0, 3), ['[ ] Tent', '[x] Stove', '[x] Lantern']);
    assert.equal(await phone.evaluate(() => !!document.activeElement?.closest?.('#outline-editor')), false, 'the editor did not take focus');
    await sleep(1200);
    await syncNow(phone);
    await syncNow(laptop);
    await laptop.waitForFunction(() => document.querySelector('#outline-editor li.boxed:nth-of-type(3) > .line-box')?.getAttribute('aria-checked') === 'true' || [...document.querySelectorAll('#outline-editor li.boxed')].some((li) => li.textContent.includes('Lantern') && li.querySelector(':scope > .line-box').getAttribute('aria-checked') === 'true'), null, { timeout: 8000 });
    assert.equal(await line(laptop, 'Gear').locator(':scope > p .check-count').textContent(), '2/4');
    assert.deepEqual(phone.errors, []);
  });

  await check('a reload keeps it all', async () => {
    await laptop.reload();
    await laptop.waitForSelector('main.notebook #outline-editor li.boxed');
    assert.deepEqual(await boxes(laptop), ['[ ] Tent', '[x] Stove', '[x] Lantern', '[ ] Water jug', '[ ] Buy marshmallows', '[x] Check the fire ban']);
  });

  await check('Ctrl + Z right after opening a page or a chapter never empties it', async () => {
    const before = await laptop.locator('#outline-editor').innerText();
    await laptop.locator('#outline-editor li > p', { hasText: /^Food/ }).click();
    for (let i = 0; i < 4; i++) await laptop.keyboard.press('Control+z');
    await sleep(1500);
    assert.equal(await laptop.locator('#outline-editor').innerText(), before);
    assert.ok([...table.values()].filter((r) => r.kind === 'line' && !r.deleted).length >= 11, 'nothing deleted');
    // Typing then undoing still works.
    await laptop.keyboard.press('End');
    await laptop.keyboard.type(' and cocoa');
    await laptop.keyboard.press('Control+z');
    assert.equal(await laptop.locator('#outline-editor').innerText(), before);
    // The same in a chapter: Ctrl + J opens the draft.
    await laptop.keyboard.press('Control+J');
    await laptop.waitForFunction(() => !document.documentElement.dataset.view);
    await sleep(500);
    const words = await laptop.locator('#editor .ProseMirror').innerText();
    await laptop.locator('#editor .ProseMirror').click();
    for (let i = 0; i < 3; i++) await laptop.keyboard.press('Control+z');
    await sleep(300);
    assert.equal(await laptop.locator('#editor .ProseMirror').innerText(), words);
  });

  await check('no page errors', async () => assert.deepEqual(laptop.errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
