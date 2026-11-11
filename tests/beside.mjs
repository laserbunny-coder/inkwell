// Beside: one pane next to the page. Ctrl + \ opens today's plan there, puts
// it away and brings it back; the pane's head switches between Plan and Notes
// (the notes on the draft in the main window); anything opened beside takes
// the pane's place unless "More than one pane beside" is on.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4266;
const DIST = process.env.DIST;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;
const NOW = '2026-11-09T14:04:00-08:00';

const browser = withoutSync(await chromium.launch());
async function open(opts = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addInitScript(() => { window.__claude = () => ({}); });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const goMain = async (p, place) => { await p.evaluate((pl) => window.__panes.hooks.goMain(pl), place); await still(p); await sleep(250); };
const paneFrames = (p) => p.frames().filter((f) => f.url().includes('?pane='));
// The one pane beside, once it has started and is showing `view`.
async function pane(p, view, tab) {
  await p.waitForFunction(([v, t]) => {
    const f = [...document.querySelectorAll('.pane-frame')].at(-1);
    const d = f?.contentDocument?.documentElement;
    return d?.dataset?.started === '1' && (!v || (d.dataset.view || 'write') === v) && (!t || f.contentDocument.querySelector('#plan-sheet')?.dataset.tab === t);
  }, [view || '', tab || ''], { timeout: 15000 });
  return paneFrames(p).at(-1);
}
const head = (p) => p.evaluate(() => {
  const el = [...document.querySelectorAll('.pane')].at(-1);
  return el ? { lit: [...el.querySelectorAll('.pane-tab[aria-pressed="true"]')].map((b) => b.textContent).join(','), title: el.querySelector('.pane-title').textContent.trim(), kind: getComputedStyle(el.querySelector('.pane-kind')).display === 'none' ? '' : el.querySelector('.pane-kind').textContent, swap: getComputedStyle(el.querySelector('.pane-swap')).display !== 'none' } : null;
});
const headIs = (p, lit, title) => p.waitForFunction(([l, t]) => {
  const el = [...document.querySelectorAll('.pane')].at(-1);
  return el && [...el.querySelectorAll('.pane-tab[aria-pressed="true"]')].map((b) => b.textContent).join(',') === l && (t == null || el.querySelector('.pane-title').textContent.trim() === t);
}, [lit, title ?? null]);
const count = (p) => p.evaluate(() => window.__panes.count);
const beside = (p) => p.evaluate(() => ({ pressed: document.querySelector('#beside-toggle').getAttribute('aria-pressed'), has: document.documentElement.classList.contains('has-panes'), w: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panes-w')) || 0 }));
const words = (f) => f.locator('#plan-sheet .pl-task .pl-words').allInnerTexts();
const notes = (f) => f.evaluate(() => [...document.querySelectorAll('#side-notes .sn-card')].map((c) => `${c.querySelector('.sn-kind').textContent}: ${c.querySelector('.sn-text').textContent}`));
const toast = (p) => p.evaluate(() => document.querySelector('.toast')?.textContent || '');

async function seed(p) {
  await p.evaluate(async (now) => {
    const put = (rows) => new Promise((res) => { const r = indexedDB.open('writing'); r.onsuccess = () => { const tx = r.result.transaction('entries', 'readwrite'); for (const x of rows) tx.objectStore('entries').put(x); tx.oncomplete = res; }; });
    const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now, updated_at: now, sort: 1, parent_id: null };
    let n = 0;
    const para = (id, text, el) => ({ ...base, id, kind: 'para', parent_id: 'ch_r', sort: (n += 1024), text, content: [{ type: 'text', text }], fields: { el } });
    const line = (id, parent, text, fields = {}) => ({ ...base, id, kind: 'line', parent_id: parent, sort: (n += 1024), text, content: [{ type: 'text', text }], fields: { done: false, gather: null, gathered: null, mirror: null, ...fields } });
    const task = (day, est, order) => ({ box: true, task: { v: 1, day, est, done_at: null, actual: null, log: [], run: null, order, owner: null } });
    await put([
      { ...base, id: 'wd_nb', kind: 'world', title: 'The Ninja Bunch', area_id: 'area-writing' },
      { ...base, id: 'pr_reel', kind: 'project', parent_id: 'wd_nb', title: 'Reel 4: Breakfast', area_id: 'area-writing', fields: { type: 'screenplay', levels: ['Act', 'Script', 'Scene'] } },
      { ...base, id: 'ac_r', kind: 'act', parent_id: 'pr_reel', title: 'Screenplay' },
      { ...base, id: 'ch_r', kind: 'chapter', parent_id: 'ac_r', title: 'Script' },
      para('pp_1', 'INT. KITCHEN - MORNING', 'scene'),
      para('pp_2', 'Mom flips a pancake. Kenji sneaks in with the katana.', 'action'),
      para('pp_3', 'MOM', 'character'),
      para('pp_4', 'Sit.', 'dialogue'),
      para('pp_5', 'EXT. ROOF - NIGHT', 'scene'),
      para('pp_6', 'Rain. Grandpa waits with the rolling pin.', 'action'),
      { ...base, id: 'no_2', kind: 'note', parent_id: 'pp_6', type: 'directing', text: 'Ask Dana if the rain can be real', fields: { chapter_id: 'ch_r' }, sort: 1 },
      { ...base, id: 'no_1', kind: 'note', parent_id: 'pp_2', type: 'production', text: 'The apron must be the red one', fields: { chapter_id: 'ch_r' }, sort: 2 },
      { ...base, id: 'no_3', kind: 'note', parent_id: 'pp_4', type: 'claude', text: 'She says “Sit” twice in this reel', fields: { chapter_id: 'ch_r', claude: now }, sort: 3 },
      { ...base, id: 'no_4', kind: 'note', parent_id: 'pp_4', type: 'writing', text: 'An old worry, settled', fields: { chapter_id: 'ch_r', resolved: now }, sort: 4 },
      { ...base, id: 'pg_songs', kind: 'page', parent_id: 'wd_nb', title: 'Songs' },
      line('ln_song', 'pg_songs', 'Write the second verse of Kenji’s song', task('2026-11-09', 45, 2)),
      line('ln_song_n', 'ln_song', 'Rhymes with katana, nothing with pancake'),
      { ...base, id: 'page-tasks', kind: 'page', title: 'Tasks' },
      line('ln_call', 'page-tasks', 'Call Dana about the storyboards', task('2026-11-09', 30, 1)),
      line('ln_drive', 'page-tasks', 'Order the storage drive', task('2026-11-11', 15, 1)),
      { ...base, id: 'day-2026-11-09', kind: 'day', title: '2026-11-09' },
      line('ln_a', 'day-2026-11-09', 'Rain all morning'),
      line('ln_b', 'day-2026-11-09', 'Mika’s theme, slowed down'),
    ]);
  }, new Date(NOW).getTime());
  await p.reload();
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await goMain(p, { view: 'notebook', pageId: 'day-2026-11-09' });
}

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 6).join('\n     ')}`); }
}

try {
  const page = await open();
  await seed(page);

  await check('Beside sits in the top bar, and nothing is beside yet', async () => {
    const b = page.locator('#beside-toggle');
    assert.equal((await b.innerText()).trim(), 'Beside');
    assert.equal(await b.isVisible(), true);
    assert.match(await b.getAttribute('title'), /Ctrl\+\\/);
    assert.deepEqual(await beside(page), { pressed: 'false', has: false, w: 0 });
  });

  let f;
  await check('Ctrl + \\ opens today’s plan beside, and leaves you where you were', async () => {
    await page.click('#outline-editor .ProseMirror li:last-child p');
    await page.keyboard.press('Control+Backslash');
    f = await pane(page, 'plan', 'day');
    await still(page);
    assert.equal(await count(page), 1);
    const b = await beside(page);
    assert.equal(b.pressed, 'true');
    assert.equal(b.has, true);
    assert.ok(b.w > 300, `the pane has room (${b.w})`);
    await headIs(page, 'Plan', 'Today');
    const h = await head(page);
    assert.equal(h.kind, '', 'the switch says what it is');
    assert.equal(h.swap, false, 'a plan alone doesn’t trade places with the page');
    assert.deepEqual(await words(f), ['Call Dana about the storyboards', 'Write the second verse of Kenji’s song']);
    assert.equal(await f.locator('#plan-sheet .pl-switch [aria-current="page"]').innerText(), 'Day');
    assert.equal(await f.locator('.topbar').isVisible(), false);
    // Typing still lands on the day's page.
    await page.keyboard.type(' again');
    await page.waitForFunction(() => /slowed down again$/.test(document.querySelector('#outline-editor li:last-child p').textContent));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'notebook');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/beside-plan.png` });
  });

  await check('a task ticked beside is ticked on the day’s page too, and one added beside shows there', async () => {
    await f.locator('#plan-sheet .pl-task', { hasText: 'Call Dana' }).locator('[data-act="tick"]').click();
    await page.waitForFunction(() => !!document.querySelector('#plan .pl-task.done, #plan .pl-task[data-done="1"]') || [...document.querySelectorAll('#plan .pl-task')].some((r) => /Call Dana/.test(r.textContent) && r.querySelector('[data-act="tick"]')?.getAttribute('aria-checked') === 'true'));
    const row = (await all(page)).find((r) => r.id === 'ln_call');
    assert.equal(row.fields.done, true);
    await f.locator('#plan-sheet input[data-add]').fill('Print the call sheet 10m');
    await f.locator('#plan-sheet input[data-add]').press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('#plan .pl-task .pl-words')].some((w) => w.textContent === 'Print the call sheet'));
    assert.ok((await words(f)).includes('Print the call sheet'));
  });

  await check('the plan’s own Week and Pace open in the pane; Day comes back to today’s plan alone', async () => {
    await f.locator('#plan-sheet .pl-switch button[data-cmd="week"]').click();
    f = await pane(page, 'plan', 'week');
    await headIs(page, 'Plan', 'Week');
    assert.equal((await head(page)).swap, true);
    assert.equal(await f.locator('.pw-day').count(), 7);
    await f.locator('#plan-sheet .pl-switch button', { hasText: 'Day' }).click();
    f = await pane(page, 'plan', 'day');
    await headIs(page, 'Plan', 'Today');
    assert.equal(await f.evaluate(() => document.documentElement.dataset.view), 'plan', 'not the whole day page');
  });

  await check('a task’s place opens in the main view, and the plan stays beside', async () => {
    await f.locator('#plan-sheet .pl-task', { hasText: 'second verse' }).locator('[data-act="open"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.view === 'notebook' && /Songs/.test(document.querySelector('#crumb')?.innerText || ''));
    assert.equal(await f.evaluate(() => document.documentElement.dataset.view), 'plan');
    await headIs(page, 'Plan', 'Today');
    await goMain(page, { view: 'notebook', pageId: 'day-2026-11-09' });
  });

  await check('a click on a task in the plan beside opens it in the main view, zoomed in on its line', async () => {
    await f.locator('#plan-sheet .pl-task', { hasText: 'second verse' }).locator('.pl-words').click();
    await page.waitForFunction(() => /second verse/.test(document.querySelector('#outline-editor li.zoom-root')?.textContent || ''));
    assert.ok(await page.locator('#outline-editor li[data-eid="ln_song_n"]').isVisible(), 'its notes are right there');
    assert.equal(await f.evaluate(() => document.documentElement.dataset.view), 'plan', 'the plan stays beside');
    await goMain(page, { view: 'notebook', pageId: 'day-2026-11-09' });
  });

  await check('Ctrl + \\ puts it away and brings the same pane back; the button does the same', async () => {
    await page.click('#outline-editor .ProseMirror li:first-child p');
    await page.keyboard.press('Control+Backslash');
    await page.waitForFunction(() => !document.documentElement.classList.contains('has-panes'));
    assert.deepEqual(await beside(page), { pressed: 'false', has: false, w: 0 });
    assert.equal(await count(page), 1, 'still there');
    assert.equal(await page.locator('.panes').isVisible(), false);
    assert.match(await page.locator('#beside-toggle').getAttribute('title'), /Bring back/);
    await page.keyboard.press('Control+Backslash');
    await page.waitForFunction(() => document.documentElement.classList.contains('has-panes'));
    assert.equal(paneFrames(page).length, 1, 'the same pane, not a new one');
    assert.equal((await beside(page)).pressed, 'true');
    await page.locator('#beside-toggle').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('has-panes'));
    await page.locator('#beside-toggle').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('has-panes'));
    // From inside the pane it's the same key.
    await f.locator('#plan-sheet input[data-add]').click();
    await page.keyboard.press('Control+Backslash');
    await page.waitForFunction(() => !document.documentElement.classList.contains('has-panes'));
    await page.keyboard.press('Control+Backslash');
    await page.waitForFunction(() => document.documentElement.classList.contains('has-panes'));
  });

  await check('Focus is only the words: the pane steps out, and is back when you leave Focus', async () => {
    await page.click('#outline-editor .ProseMirror li:first-child p');
    await page.keyboard.press('Control+Period');
    await page.waitForFunction(() => document.documentElement.classList.contains('focus') && !document.documentElement.classList.contains('has-panes'));
    assert.equal(await page.locator('.panes').isVisible(), false);
    assert.equal(await count(page), 1);
    await page.keyboard.press('Control+Backslash');
    await page.waitForFunction(() => /Focus is only the words/.test(document.querySelector('.toast')?.textContent || ''));
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('has-panes')), false);
    await page.keyboard.press('Control+Period');
    await page.waitForFunction(() => !document.documentElement.classList.contains('focus') && document.documentElement.classList.contains('has-panes'));
    assert.equal((await beside(page)).pressed, 'true');
  });

  await check('a triangle shows a task’s lines in the plan; a click on one zooms into the task there, and Alt + Left comes back', async () => {
    const r = page.locator('#plan .pl-task', { hasText: 'second verse' });
    assert.equal(await r.locator('.pl-fold').count(), 1);
    assert.equal(await page.locator('#plan .pl-task', { hasText: 'Call Dana' }).locator('.pl-fold').count(), 0, 'none without lines under it');
    await r.locator('.pl-fold').click();
    await page.waitForFunction(() => /Rhymes with katana/.test(document.querySelector('#plan .pl-kids')?.textContent || ''));
    assert.equal(await page.locator('#plan .pl-task', { hasText: 'second verse' }).locator('.pl-fold').getAttribute('aria-expanded'), 'true');
    await page.locator('#plan .pl-kid-text', { hasText: 'Rhymes with katana' }).click();
    await page.waitForFunction(() => /second verse/.test(document.querySelector('#outline-editor li.zoom-root')?.textContent || ''));
    assert.ok(await page.locator('#outline-editor li[data-eid="ln_song_n"]').isVisible());
    assert.equal(await count(page), 1, 'Beside is as it was');
    await page.keyboard.press('Alt+ArrowLeft');
    await page.waitForFunction(() => !document.querySelector('#outline-editor li.zoom-root') && /Rhymes with katana/.test(document.querySelector('#plan .pl-kids')?.textContent || ''));
    // Under Look the triangle (and the lines it shows) can go.
    await page.evaluate(() => document.documentElement.classList.add('hide-tasknotes'));
    assert.equal(await page.locator('#plan .pl-task', { hasText: 'second verse' }).locator('.pl-fold').isVisible(), false);
    await page.evaluate(() => document.documentElement.classList.remove('hide-tasknotes'));
    await page.locator('#plan .pl-task', { hasText: 'second verse' }).locator('.pl-fold').click();
    await page.waitForFunction(() => !document.querySelector('#plan .pl-kids'));
  });

  await check('a task’s menu on the day’s page has Open it beside; the plan beside has no such line', async () => {
    await page.locator('#plan .pl-task', { hasText: 'second verse' }).click({ button: 'right' });
    await page.locator('.pop-menu .pop-item', { hasText: 'Open it beside' }).click();
    f = await pane(page, 'notebook');
    await headIs(page, '', 'Songs');
    assert.equal(await count(page), 1);
    await page.locator('.pane .pane-tab', { hasText: 'Plan' }).click();
    f = await pane(page, 'plan', 'day');
    await f.locator('#plan-sheet .pl-task', { hasText: 'second verse' }).click({ button: 'right' });
    await f.waitForSelector('.pop-menu .pop-item');
    assert.equal(await f.locator('.pop-menu .pop-item', { hasText: 'Open it beside' }).count(), 0);
    assert.equal(await f.locator('.pop-menu .pop-item', { hasText: 'Open it where it’s written' }).count(), 1);
    // Left open on purpose: going to Notes next puts it away.
  });

  await check('Notes: away from a draft it says so; on a draft it lists its notes in the order of the text', async () => {
    await page.locator('.pane .pane-tab', { hasText: 'Notes' }).click();
    f = await pane(page, 'sidenotes');
    assert.equal(await f.locator('.pop-menu').count(), 0, 'a menu left open in the pane went with the place');
    await headIs(page, 'Notes', 'No draft open');
    assert.match(await f.locator('#side-notes').innerText(), /Open a draft in the main view/);
    await goMain(page, { view: 'write', chapterId: 'ch_r' });
    await headIs(page, 'Notes', 'Reel 4: Breakfast');
    await f.waitForSelector('.sn-card');
    assert.deepEqual(await notes(f), ['Production: The apron must be the red one', 'Claude: She says “Sit” twice in this reel', 'Directing: Ask Dana if the rain can be real']);
    assert.equal(await f.locator('.sn-card').first().locator('.sn-on').innerText(), 'Mom flips a pancake. Kenji sneaks in with the katana.');
    assert.equal(await f.locator('.sn-head h1').innerText(), 'Reel 4: Breakfast');
    assert.equal((await head(page)).swap, false);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/beside-notes.png` });
  });

  await check('clicking a note takes the main view to its paragraph', async () => {
    await f.locator('.sn-card', { hasText: 'rain can be real' }).click();
    await page.waitForFunction(() => {
      const sel = document.getSelection();
      const el = sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('[data-eid]');
      return el?.dataset.eid === 'pp_6';
    });
    assert.equal(await f.evaluate(() => document.documentElement.dataset.view), 'sidenotes');
  });

  await check('a note written in the margin shows beside; Claude’s can be switched off under Look', async () => {
    await page.click('#editor [data-eid="pp_2"]');
    await page.keyboard.press('Alt+KeyN');
    await page.waitForSelector('.notes-layer textarea:focus');
    await page.keyboard.type('Second pancake lands on the cat');
    await f.waitForFunction(() => [...document.querySelectorAll('.sn-card .sn-text')].some((t) => t.textContent === 'Second pancake lands on the cat'));
    assert.equal((await notes(f)).length, 4);
    await page.evaluate(() => { const c = document.querySelector('[data-show="claude"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await goMain(page, { view: 'write', chapterId: 'ch_r' });
    await f.waitForFunction(() => document.querySelectorAll('.sn-card').length === 3);
    assert.ok(!(await notes(f)).some((n) => n.startsWith('Claude')));
    await page.evaluate(() => { const c = document.querySelector('[data-show="claude"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  });

  await check('something opened beside takes the pane’s place, and the pane’s Back returns', async () => {
    await goMain(page, { view: 'notebook', pageId: 'day-2026-11-09' });
    await headIs(page, 'Notes', 'No draft open');
    const li = page.locator('#outline-editor li', { hasText: 'Rain all morning' });
    await li.hover();
    await li.locator(':scope > .line-gutter .bullet').click({ button: 'middle' });
    f = await pane(page, 'notebook');
    assert.equal(await count(page), 1, 'one pane, not two');
    await headIs(page, '', 'Rain all morning');
    assert.equal((await head(page)).swap, true);
    await f.locator('#outline-editor .ProseMirror').click();
    await page.keyboard.press('Control+BracketLeft');
    f = await pane(page, 'sidenotes');
    await headIs(page, 'Notes', 'No draft open');
    await page.locator('.pane .pane-tab', { hasText: 'Plan' }).click();
    f = await pane(page, 'plan', 'day');
    await headIs(page, 'Plan', 'Today');
  });

  await check('it comes back after the app is opened again, put away if it was', async () => {
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    f = await pane(page, 'plan', 'day');
    assert.equal(await count(page), 1);
    assert.equal((await beside(page)).pressed, 'true');
    await page.keyboard.press('Control+Backslash');
    await page.waitForFunction(() => !document.documentElement.classList.contains('has-panes'));
    await sleep(200);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    await page.waitForFunction(() => window.__panes.count === 1);
    assert.deepEqual(await beside(page), { pressed: 'false', has: false, w: 0 });
    await page.keyboard.press('Control+Backslash');
    await page.waitForFunction(() => document.documentElement.classList.contains('has-panes'));
    f = await pane(page, 'plan', 'day');
  });

  await check('Look → More than one pane beside: a second opens next to the first; off again leaves one', async () => {
    await goMain(page, { view: 'notebook', pageId: 'day-2026-11-09' });
    assert.equal(await page.evaluate(() => document.querySelector('#many-panes').checked), false);
    await page.evaluate(() => { const c = document.querySelector('#many-panes'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    const li = page.locator('#outline-editor li', { hasText: 'Rain all morning' });
    await li.hover();
    await li.locator(':scope > .line-gutter .bullet').click({ button: 'middle' });
    await page.waitForFunction(() => window.__panes.count === 2);
    await pane(page, 'notebook');
    assert.equal(await page.locator('.pane:not(.spine)').count(), 2);
    await page.evaluate(() => { const c = document.querySelector('#many-panes'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => window.__panes.count === 1);
    await headIs(page, '', 'Rain all morning');
  });

  await check('× closes it; Ctrl + \\ then opens the plan afresh. Everything (Ctrl + K) has Beside and the draft’s notes', async () => {
    await page.locator('.pane-close').click();
    await page.waitForFunction(() => window.__panes.count === 0);
    assert.deepEqual(await beside(page), { pressed: 'false', has: false, w: 0 });
    await goMain(page, { view: 'write', chapterId: 'ch_r' });
    await page.keyboard.press('Control+KeyK');
    await page.waitForSelector('.palette:not([hidden]) input');
    await page.keyboard.type('beside');
    await sleep(200);
    const found = await page.locator('.palette li').allInnerTexts();
    assert.ok(found.some((t) => /^Beside: today’s plan next to this page/.test(t) && /Ctrl\+\\/.test(t)), found.join(' | '));
    await page.locator('.palette li', { hasText: 'this draft’s notes' }).click();
    f = await pane(page, 'sidenotes');
    await headIs(page, 'Notes', 'Reel 4: Breakfast');
    await page.locator('.pane-close').click();
    await page.waitForFunction(() => window.__panes.count === 0);
  });

  await check('Look → Beside off: the button goes, and Ctrl + \\ says where to switch it on', async () => {
    await page.evaluate(() => { const c = document.querySelector('[data-show="panes"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await page.locator('#beside-toggle').isVisible(), false);
    await page.keyboard.press('Control+Backslash');
    await page.waitForFunction(() => /switched off/.test(document.querySelector('.toast')?.textContent || ''));
    assert.equal(await count(page), 0);
    await page.evaluate(() => { const c = document.querySelector('[data-show="panes"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await page.locator('#beside-toggle').isVisible(), true);
  });

  await check('every look draws it, and nothing went wrong on the page', async () => {
    await goMain(page, { view: 'write', chapterId: 'ch_r' });
    await page.keyboard.press('Control+Backslash');
    f = await pane(page, 'plan', 'day');
    for (const look of ['lamplight', 'graphite', 'typewriter', 'paper', 'midnight']) {
      await page.evaluate((l) => { document.documentElement.dataset.look = l; }, look);
      await sleep(80);
      const box = await page.locator('.pane .pane-tab[aria-pressed="true"]').boundingBox();
      assert.ok(box && box.width > 20, look);
    }
    assert.deepEqual(page.errors, []);
    await page.locator('.pane-close').click();
  });

  const phone = await open({ ...devices['Pixel 7'] });
  await seed(phone);
  await check('phone: the plan comes up in a sheet with the same switch, and Notes follows the draft', async () => {
    assert.equal(await phone.locator('#beside-toggle').isVisible(), false);
    await phone.evaluate(() => window.__panes.open({ view: 'plan', tab: 'day' }));
    await phone.waitForFunction(() => document.documentElement.classList.contains('sheet-peek'));
    let pf = await pane(phone, 'plan', 'day');
    assert.deepEqual(await words(pf), ['Call Dana about the storyboards', 'Write the second verse of Kenji’s song']);
    assert.equal(await phone.locator('.ps-head .pane-tab[aria-pressed="true"]').innerText(), 'Plan');
    if (SHOTS) await phone.screenshot({ path: `${SHOTS}/beside-phone.png` });
    await phone.locator('.ps-head .pane-tab', { hasText: 'Notes' }).click();
    pf = await pane(phone, 'sidenotes');
    await phone.waitForFunction(() => document.querySelector('.ps-head .pane-tab[aria-pressed="true"]')?.textContent === 'Notes');
    assert.match(await pf.locator('#side-notes').innerText(), /Open a draft/);
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(wide <= 1, 'nothing spills sideways');
    assert.deepEqual(phone.errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\nBeside: ${failed} failed` : '\nBeside: all good');
process.exit(failed ? 1 : 0);
