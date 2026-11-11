// Side by side: middle-click opens a place in a pane beside the main view.
// A pane is Inkwell again in a frame: you can write in it, what you write
// shows in the main window (and the other way round), only the main window
// syncs, lines drag from one window into another, and a phone peeks at a
// pane in a sheet instead.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4267;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

// The cloud, standing in: it notes which window sent each push.
const table = new Map();
const pushedFrom = [];
let clock = Date.parse('2026-11-05T00:00:00Z');
function remote(op, arg, where) {
  if (op === 'push') {
    pushedFrom.push(where);
    const stamp = new Date((clock += 1000)).toISOString();
    return arg.map((r) => { table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp }); return { id: r.id, updated_at: stamp }; });
  }
  if (op === 'pull') return [...table.values()].filter((r) => r.updated_at > arg.since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(arg.from, arg.from + 500);
}
const fake = () => {
  // These checks are about a row of panes: Look → "More than one pane beside".
  // (One pane, Plan and Notes are in tests/beside.mjs.)
  try { localStorage.setItem('manyPanes', '1'); } catch { /* no storage yet */ }
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }),
    onAuth() {}, signIn() {}, signOut() {}, subscribe() {}, unsubscribe() {},
    push: (rows) => window.__remote('push', rows, location.search),
    pull: (since, from) => window.__remote('pull', { since, from }, location.search)
  };
};

const browser = await chromium.launch();
const errors = [];
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = `day-${iso(new Date())}`;
const tomorrow = `day-${iso(new Date(Date.now() + 864e5))}`;
const lines = (f) => f.evaluate(() => [...document.querySelectorAll('#outline-editor li > p')].map((p) => p.textContent));
const paneFrames = (p) => p.frames().filter((f) => f.url().includes('?pane='));
async function paneReady(p, n) {
  await p.waitForFunction((n) => [...document.querySelectorAll('.pane-frame')].filter((f) => f.contentDocument?.documentElement?.dataset?.started === '1').length >= n, n, { timeout: 15000 });
  return paneFrames(p);
}
async function toToday(p) {
  await p.evaluate((id) => window.__panes.hooks.goMain({ view: 'notebook', pageId: id }), today);
  await p.waitForSelector('.notebook', { state: 'visible' });
  await sleep(300);
}
// Drags a line by its dots to just under another line (in any window).
async function dragLine(p, from, to, { alt = false } = {}) {
  // Out of the way of the Library, which a hover at the left edge slides open.
  await p.mouse.move(600, 500);
  await p.evaluate(() => document.body.classList.remove('show-outline'));
  await sleep(250);
  await from.hover();
  const g = await from.locator(':scope > .line-gutter .bullet').boundingBox();
  const t = await to.locator(':scope > p').boundingBox();
  await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await p.mouse.down();
  if (alt) await p.keyboard.down('Alt');
  for (let i = 1; i <= 12; i++) { await p.mouse.move(g.x + (t.x + 30 - g.x) * i / 12, g.y + (t.y + t.height * 0.8 - g.y) * i / 12); await sleep(25); }
  await sleep(150);
  await p.mouse.up();
  if (alt) await p.keyboard.up('Alt');
}

try {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForSelector('html[data-started="1"]');
  await toToday(p);
  await p.click('#outline-editor .ProseMirror');
  for (const t of ['Alpha', 'Bravo', 'Charlie']) { await p.keyboard.type(t); await p.keyboard.press('Enter'); }
  await p.keyboard.type('Verse two');
  await p.keyboard.press('Tab');
  await sleep(800);

  let pane;
  await check('middle-clicking a line’s dots opens it beside, zoomed in, and leaves you where you were', async () => {
    const li = p.locator('#outline-editor li', { hasText: 'Charlie' }).first();
    await li.hover();
    const g = await li.locator(':scope > .line-gutter .bullet').boundingBox();
    await p.mouse.click(g.x + g.width / 2, g.y + g.height / 2, { button: 'middle' });
    [pane] = await paneReady(p, 1);
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('has-panes')), true);
    assert.deepEqual(await pane.evaluate(() => [document.documentElement.dataset.view, window.__notebook.zoom != null]), ['notebook', true]);
    await p.waitForFunction(() => document.querySelector('.pane-title')?.textContent === 'Charlie');
    assert.equal(await p.locator('.pane-kind').innerText(), 'LINE');
    // The main view made room, and its words are where they were.
    assert.ok((await p.locator('#outline-editor').boundingBox()).x + 200 < 1440 - 400);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.view), 'notebook');
    assert.equal(await pane.evaluate(() => !!document.querySelector('.topbar') && getComputedStyle(document.querySelector('.topbar')).display), 'none', 'no top bar in a pane');
  });

  await check('what you write in a pane shows in the main window, and the other way round', async () => {
    const verse = pane.locator('#outline-editor li > p', { hasText: 'Verse two' });
    await verse.click();
    await pane.press('#outline-editor .ProseMirror', 'End');
    await pane.locator('#outline-editor .ProseMirror').pressSequentially(' is hungry');
    await p.waitForFunction(() => [...document.querySelectorAll('#outline-editor li > p')].some((x) => x.textContent === 'Verse two is hungry'), null, { timeout: 5000 });
    await p.locator('#outline-editor li > p', { hasText: 'Alpha' }).click();
    await p.keyboard.press('End');
    await p.keyboard.type(' and more');
    await pane.waitForFunction(() => [...document.querySelectorAll('#outline-editor li > p')].some((x) => x.textContent === 'Charlie'), null, { timeout: 5000 });
    await sleep(800);
    // Back in the pane: Alpha isn't shown there (zoomed into Charlie), but it's saved once.
    assert.equal(await pane.evaluate(async () => (await window.__notebook.store.refresh(), true)), true);
  });

  await check('only the main window syncs, and it sends what was written in a pane', async () => {
    await p.evaluate(() => window.__sync.run());
    await sleep(500);
    assert.ok(pushedFrom.length > 0, 'something was pushed');
    assert.ok(pushedFrom.every((w) => !w.includes('pane=')), `pushes came from ${[...new Set(pushedFrom)].join(', ')}`);
    assert.ok([...table.values()].some((r) => r.text === 'Verse two is hungry'), 'the pane’s words reached the cloud');
  });

  await check('Ctrl + Alt + W closes the pane you’re in', async () => {
    await pane.locator('#outline-editor .ProseMirror').click();
    await p.keyboard.press('Control+Alt+KeyW');
    await p.waitForFunction(() => !document.querySelector('.pane'));
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('has-panes')), false);
  });

  let other;
  await check('a line dragged from the main window into a pane moves there, children and all, where it was dropped', async () => {
    await p.evaluate((id) => window.__panes.open({ view: 'notebook', pageId: id }), tomorrow);
    [other] = await paneReady(p, 1);
    await other.click('#outline-editor .ProseMirror');
    await other.locator('#outline-editor .ProseMirror').pressSequentially('One');
    await other.press('#outline-editor .ProseMirror', 'Enter');
    await other.locator('#outline-editor .ProseMirror').pressSequentially('Two');
    await sleep(800);
    await dragLine(p, p.locator('#outline-editor li', { hasText: 'Charlie' }).first(), other.locator('#outline-editor li', { hasText: 'One' }).first());
    await other.waitForFunction(() => [...document.querySelectorAll('#outline-editor li > p')].map((x) => x.textContent).join('|') === 'One|Charlie|Verse two is hungry|Two', null, { timeout: 6000 });
    await p.waitForFunction(() => [...document.querySelectorAll('#outline-editor li > p')].length === 2, null, { timeout: 5000 }).catch(() => {});
    assert.deepEqual(await lines(p), ['Alpha and more', 'Bravo']);
  });

  await check('with Alt held as you let go, the line stays and a link to it goes in the pane', async () => {
    await dragLine(p, p.locator('#outline-editor li', { hasText: 'Bravo' }).first(), other.locator('#outline-editor li', { hasText: 'Two' }).first(), { alt: true });
    await other.waitForFunction(() => [...document.querySelectorAll('#outline-editor a[data-ref]')].some((a) => a.textContent === 'Bravo'), null, { timeout: 5000 });
    assert.deepEqual(await lines(p), ['Alpha and more', 'Bravo']);
  });

  await check('a line dragged from a pane into the main window moves there', async () => {
    await dragLine(p, other.locator('#outline-editor li', { hasText: 'One' }).first(), p.locator('#outline-editor li', { hasText: 'Alpha' }).first());
    await p.waitForFunction(() => [...document.querySelectorAll('#outline-editor li > p')].map((x) => x.textContent).join('|') === 'Alpha and more|One|Bravo', null, { timeout: 6000 });
    await other.waitForFunction(() => ![...document.querySelectorAll('#outline-editor li > p')].some((x) => x.textContent === 'One'), null, { timeout: 5000 });
  });

  await check('the line menu has Open beside and Move to the page open beside', async () => {
    const li = p.locator('#outline-editor li', { hasText: 'Bravo' }).first();
    await li.hover();
    await li.locator(':scope > .line-gutter .bullet').click({ button: 'right' });
    await p.waitForSelector('.handle-menu');
    const menu = await p.locator('.handle-menu').innerText();
    assert.match(menu, /Open beside/);
    const moveTo = p.locator('.handle-menu button', { hasText: /^Move to Thursday|^Move to Friday|^Move to .*20\d\d|^Move to / }).filter({ hasNotText: 'Move to…' });
    assert.equal(await moveTo.count(), 1, menu);
    await moveTo.click();
    await other.waitForFunction(() => [...document.querySelectorAll('#outline-editor li > p')].some((x) => x.textContent === 'Bravo'), null, { timeout: 5000 });
    await p.waitForFunction(() => [...document.querySelectorAll('#outline-editor li > p')].map((x) => x.textContent).join('|') === 'Alpha and more|One', null, { timeout: 5000 }).catch(() => {});
    assert.deepEqual(await lines(p), ['Alpha and more', 'One']);
  });

  await check('more than three panes: the oldest fold into spines, and a spine opens again', async () => {
    for (const v of [{ view: 'library' }, { view: 'tags' }, { view: 'drawer' }]) await p.evaluate((pl) => window.__panes.open(pl), v);
    await paneReady(p, 4);
    assert.equal(await p.locator('.pane.spine').count(), 1);
    assert.equal(await p.locator('.pane:not(.spine)').count(), 3);
    await p.locator('.pane.spine .pane-spine').click();
    await sleep(300);
    assert.equal(await p.locator('.pane.spine').count(), 1);
    assert.equal(await p.locator('.pane').first().evaluate((el) => el.classList.contains('spine')), false, 'the first pane is open again');
  });

  await check('the panes come back after the app is opened again', async () => {
    const before = await p.locator('.pane').count();
    await p.reload();
    await p.waitForSelector('html[data-started="1"]');
    await paneReady(p, before);
    assert.equal(await p.locator('.pane').count(), before);
  });

  await check('⇤ swaps a pane with the main view', async () => {
    const firstTitle = await p.locator('.pane').first().locator('.pane-title').innerText();
    await p.locator('.pane').first().locator('.pane-swap').click();
    await sleep(1200);
    assert.match(await p.locator('#crumb').innerText(), new RegExp(firstTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  await check('Aa → Panes off closes them, and middle-click no longer opens one', async () => {
    await p.evaluate(() => { const c = document.querySelector('[data-show="panes"]'); c.checked = false; c.dispatchEvent(new Event('change')); });
    assert.equal(await p.locator('.pane').count(), 0);
    await toToday(p);
    const li = p.locator('#outline-editor li').first();
    await li.hover();
    const g = await li.locator(':scope > .line-gutter .bullet').boundingBox();
    await p.mouse.click(g.x + g.width / 2, g.y + g.height / 2, { button: 'middle' });
    await sleep(800);
    assert.equal(await p.locator('.pane').count(), 0);
    await p.evaluate(() => { const c = document.querySelector('[data-show="panes"]'); c.checked = true; c.dispatchEvent(new Event('change')); });
  });

  await check('Shift + Enter in Ctrl + K opens the result beside', async () => {
    await p.keyboard.press('Control+K');
    await p.waitForSelector('.palette:not([hidden])');
    await p.keyboard.type('Library');
    await sleep(400);
    await p.keyboard.press('Shift+Enter');
    await paneReady(p, 1);
    assert.equal(await p.evaluate(() => document.documentElement.dataset.view), 'notebook', 'the main view stays');
    await p.evaluate(() => window.__panes.closeAll());
  });

  // ---------- a phone ----------
  const phone = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
  await phone.addInitScript(() => { window.__syncBackend = null; try { localStorage.setItem('manyPanes', '1'); } catch { /* no storage yet */ } });
  const ph = await phone.newPage();
  ph.on('pageerror', (e) => errors.push(e.message));
  await ph.goto(URL);
  await ph.waitForSelector('html[data-started="1"]');

  await check('on a phone, Peek beside opens it in a sheet over the page', async () => {
    await toToday(ph);
    await ph.tap('#outline-editor .ProseMirror');
    await ph.keyboard.type('Kenji’s song');
    await ph.keyboard.press('Enter');
    await ph.keyboard.type('Grandpa on the roof');
    await sleep(600);
    const li = ph.locator('#outline-editor li', { hasText: 'Kenji' });
    await li.locator(':scope > p').tap();
    await sleep(300);
    // Held still, the line's dots bring up its menu (a tap would zoom in).
    const dots = await li.locator(':scope > .line-gutter .bullet').boundingBox();
    const touch = await ph.context().newCDPSession(ph);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dots.x + dots.width / 2, y: dots.y + dots.height / 2 }] });
    await sleep(650);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ph.waitForSelector('.handle-menu');
    await sleep(300);
    await ph.locator('.handle-menu button', { hasText: 'Peek beside' }).tap();
    await paneReady(ph, 1);
    assert.equal(await ph.evaluate(() => document.documentElement.classList.contains('sheet-peek')), true);
    assert.equal(await ph.evaluate(() => document.documentElement.classList.contains('has-panes')), false, 'no columns on a phone');
    await ph.waitForFunction(() => document.querySelector('.ps-title')?.textContent.startsWith('Kenji'));
    // The sheet keeps clear of the bar at the bottom (it settles a frame after the bar shows).
    const clear = () => ph.waitForFunction(() => {
      const s = document.querySelector('.pane-sheet').getBoundingClientRect();
      const b = document.querySelector('.placebar').getBoundingClientRect();
      return s.bottom <= (b.height ? b.top : innerHeight) + 1;
    }, null, { timeout: 2000 }).then(() => true, () => false);
    assert.ok(await clear(), 'the sheet sits above the bottom bar');
    await ph.evaluate(() => document.activeElement?.blur());
    await sleep(300);
    assert.ok(await clear(), 'still above the bar once it shows again');
  });

  await check('a second peek: ‹ › flip between them, and × closes one', async () => {
    await ph.evaluate((id) => window.__panes.open({ view: 'notebook', pageId: id }), tomorrow);
    await paneReady(ph, 2);
    assert.equal(await ph.locator('.ps-count').innerText(), '2 of 2');
    await ph.locator('.ps-btn[aria-label="Previous pane"]').tap();
    assert.equal(await ph.locator('.ps-count').innerText(), '1 of 2');
    await ph.locator('.ps-btn[aria-label="Close this pane"]').tap();
    await sleep(300);
    assert.equal(await ph.locator('.pane').count(), 1);
    assert.equal(await ph.locator('.ps-count').isVisible(), false);
  });

  await check('nothing went wrong on the page', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
