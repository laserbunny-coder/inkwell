// End-to-end checks in a real browser: writing is saved, survives a reload and
// a crash, paragraphs become entries, notes and history work.
// Run: npm run build && npm test
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

const PORT = 4179;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const entries = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const q = r.result.transaction('entries').objectStore('entries').getAll();
    q.onsuccess = () => res(q.result);
  };
}));
const text = () => page.locator('#editor .ProseMirror').innerText();
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); if (process.env.STACK) console.log(e.stack); }
}

try {
  await page.goto(URL);
  await page.waitForSelector('#editor .ProseMirror');

  await check('typing is saved as paragraph entries with stable ids and tags', async () => {
    await page.keyboard.type('The logbook was heavier than she expected. #lighthouse');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Her brother wrote it.');
    await sleep(800);
    const paras = (await entries()).filter((e) => e.kind === 'para' && !e.deleted);
    assert.equal(paras.length, 2);
    assert.ok(paras.every((p) => p.id.startsWith('pa_')));
    assert.notEqual(paras[0].id, paras[1].id);
    assert.deepEqual(paras.find((p) => p.text.includes('logbook')).tags, ['lighthouse']);
    assert.equal(await page.locator('#status').innerText(), 'Saved');
  });

  await check('text survives a reload', async () => {
    await page.reload();
    await page.waitForSelector('#editor .ProseMirror');
    await sleep(300);
    assert.match(await text(), /heavier than she expected[\s\S]*Her brother wrote it\./);
  });

  await check('paragraph ids stay the same across reloads and edits', async () => {
    const before = (await entries()).filter((e) => e.kind === 'para' && !e.deleted).map((e) => e.id).sort();
    await page.locator('#editor .ProseMirror p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Salt.');
    await sleep(800);
    const after = (await entries()).filter((e) => e.kind === 'para' && !e.deleted).map((e) => e.id).sort();
    assert.deepEqual(after, before);
  });

  await check('a crash before the save lands is recovered from the write-ahead copy', async () => {
    await page.locator('#editor .ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Unsaved words.');
    // Simulate the tab dying before IndexedDB finished: grab the write-ahead copy, then hard-reload without the debounce firing.
    const wal = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('wal:')));
    assert.ok(wal, 'write-ahead copy exists while typing');
    const walValue = await page.evaluate((k) => localStorage.getItem(k), wal);
    const fresh = await ctx.newPage();
    await page.close();
    await fresh.goto('about:blank');
    await fresh.goto(URL);
    await fresh.evaluate(([k, v]) => localStorage.setItem(k, v), [wal, walValue]);
    await fresh.reload();
    await fresh.waitForSelector('#editor .ProseMirror');
    await sleep(800);
    assert.match(await fresh.locator('#editor .ProseMirror').innerText(), /Unsaved words\./);
    globalThis.p2 = fresh;
  });

  const p = globalThis.p2 || page;
  p.on('pageerror', (e) => errors.push(e.message));

  await check('scene break becomes a scene entry and shows in the outline', async () => {
    await p.locator('#editor .ProseMirror p').last().click();
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Control+Shift+Enter');
    await p.keyboard.type('Next morning.');
    await sleep(800);
    const all = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
    }));
    assert.equal(all.filter((e) => e.kind === 'scene' && !e.deleted).length, 1);
    await p.keyboard.press('Control+1');
    await sleep(500);
    assert.equal(await p.locator('.tree-scene').count(), 1);
    await p.keyboard.press('Control+1');
  });

  await check('a note attaches to its paragraph as its own entry', async () => {
    await sleep(400);
    await p.locator('#editor .ProseMirror p').first().click();
    await p.keyboard.press('Alt+N'); // Windows: Chrome keeps Ctrl+Shift+N for itself
    await sleep(300);
    await p.keyboard.type('Macro insert on the handwriting #props');
    await sleep(800);
    const all = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
    }));
    const note = all.find((e) => e.kind === 'note');
    const first = await p.locator('#editor .ProseMirror p').first().getAttribute('data-eid');
    assert.equal(note.parent_id, first);
    assert.deepEqual(note.tags, ['props']);
    const box = await p.locator('.note').boundingBox();
    const para = await p.locator('#editor .ProseMirror p').first().boundingBox();
    assert.ok(Math.abs(box.y - para.y) < 4, `note top ${box.y} vs paragraph top ${para.y}`);
  });

  await check('command menu opens and runs commands', async () => {
    await p.locator('#editor .ProseMirror p').first().click();
    await p.keyboard.press('Control+K');
    assert.equal(await p.locator('.palette').isVisible(), true);
    assert.ok(!/[⌘⌥⇧]/.test(await p.locator('.palette').innerText()), 'menu shows Ctrl, not ⌘');
    await p.keyboard.type('new chapter');
    await p.keyboard.press('Enter');
    await sleep(800);
    assert.match(await p.locator('#crumb').innerText(), /Chapter 2/);
  });

  await check('earlier versions are kept and can be restored', async () => {
    await p.keyboard.type('First draft line.');
    await sleep(4800);
    await p.keyboard.press('Control+A');
    await p.keyboard.type('Rewritten.');
    await sleep(4800);
    await p.keyboard.press('Control+Shift+H');
    await sleep(500);
    const n = await p.locator('#history-list button').count();
    assert.ok(n >= 2, `expected 2+ versions, got ${n}`);
    await p.locator('#history-list button').filter({ hasText: /first kept/ }).click();
    await p.locator('#history-restore').click();
    // It asks first, and keeps the text as it is now in the history.
    await p.locator('.ask .pill').click();
    await sleep(800);
    assert.match(await p.locator('#editor .ProseMirror').innerText(), /First draft line\./);
  });

  await check('page width and text size change and stick after reload', async () => {
    await p.keyboard.press('Escape');
    await p.locator('#editor .ProseMirror p').first().click();
    const width = () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--page-width').trim() || '660px');
    assert.equal(await width(), '660px');
    await p.keyboard.press('Alt+BracketRight');
    await p.keyboard.press('Alt+Equal');
    await sleep(400);
    assert.equal(await width(), '700px');
    await p.reload();
    await p.waitForSelector('#editor .ProseMirror');
    assert.equal(await p.locator('#editor .ProseMirror').evaluate((el) => getComputedStyle(el).fontSize), '22px');
    assert.equal(await width(), '700px');
  });

  await check('the Aa panel picks a font by kind, and it sticks after reload', async () => {
    const family = () => p.locator('#editor .ProseMirror').evaluate((el) => getComputedStyle(el).fontFamily);
    assert.match(await family(), /Newsreader/);
    await p.evaluate(() => document.querySelector('.corner [data-cmd=page]').click());
    assert.equal(await p.locator('.font-groups button.current').innerText(), 'Serif');
    await p.locator('.font-groups button', { hasText: 'Mono' }).click();
    await p.locator('.font-list button', { hasText: 'JetBrains Mono' }).click();
    assert.match(await family(), /JetBrains Mono/);
    assert.equal(await p.locator('#font-value').innerText(), 'JetBrains Mono');
    // Each button is drawn in its own font.
    assert.match(await p.locator('.font-list button', { hasText: 'Courier Prime' }).locator('.font-name').evaluate((el) => getComputedStyle(el).fontFamily), /Courier Prime/);
    // and says a little about it.
    assert.match(await p.locator('.font-list button', { hasText: 'JetBrains Mono' }).locator('.font-about').innerText(), /coding/);
    await p.reload();
    await p.waitForSelector('#editor .ProseMirror');
    assert.match(await family(), /JetBrains Mono/);
    assert.equal(await p.evaluate(() => !!document.getElementById('font-jetbrains')), true);
    await p.evaluate(() => document.querySelector('.corner [data-cmd=page]').click());
    assert.equal(await p.locator('.font-groups button.current').innerText(), 'Mono');
    await p.locator('.font-groups button', { hasText: 'Serif' }).click();
    await p.locator('.font-list button', { hasText: 'Newsreader' }).click();
    assert.match(await family(), /Newsreader/);
    await p.locator('#page-done').click();
  });

  const all =() => p.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('writing');
    r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
  }));
  const text2 = () => p.locator('#editor .ProseMirror').innerText();
  const outlineText = () => p.locator('#outline-editor .ProseMirror').innerText();

  await check('today’s page: nested lines are saved as linked entries', async () => {
    await p.keyboard.press('Control+J');
    await p.waitForSelector('#outline-editor .ProseMirror-focused');
    await sleep(300);
    assert.equal(await p.locator('#nb-kind').innerText(), 'TODAY');
    await p.keyboard.type('Call the harbourmaster #research');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Tab');
    await p.keyboard.type('Ask about the 1912 storm');
    await p.keyboard.press('Enter');
    await p.keyboard.type('See [[');
    await p.waitForSelector('.picker', { state: 'visible' });
    await p.keyboard.type('Lighthouse keeper');
    await p.keyboard.press('Enter');
    await sleep(800);
    const rows = await all();
    const lines = rows.filter((e) => e.kind === 'line' && !e.deleted);
    const day = rows.find((e) => e.kind === 'day');
    const page = rows.find((e) => e.kind === 'page' && e.title === 'Lighthouse keeper');
    assert.ok(day && page, 'day and page saved');
    const top = lines.find((l) => l.text.startsWith('Call'));
    const storm = lines.find((l) => l.text.startsWith('Ask'));
    const see = lines.find((l) => l.text.startsWith('See'));
    assert.equal(top.parent_id, day.id);
    assert.equal(storm.parent_id, top.id);
    assert.equal(see.parent_id, top.id);
    assert.deepEqual(top.tags, ['research']);
    assert.deepEqual(see.links, [page.id]);
    assert.match(see.text, /Lighthouse keeper/);
    await p.waitForFunction(() => document.querySelector('#shelves-tags').innerText.includes('#research'), null, { timeout: 3000 });
  });

  await check('a link opens its page, which shows where it was linked from', async () => {
    await p.locator('#outline-editor a.ref').click();
    await sleep(500);
    assert.equal(await p.locator('#nb-title').innerText(), 'Lighthouse keeper');
    await p.waitForSelector('.backlinks', { state: 'visible' });
    assert.match(await p.locator('#backlinks-list').innerText(), /See Lighthouse keeper/);
    await p.keyboard.type('Keeps the log in pencil');
    await sleep(700);
    await p.locator('#backlinks-list button').first().click();
    await sleep(500);
    assert.equal(await p.locator('#nb-kind').innerText(), 'TODAY');
    assert.match(await outlineText(), /Ask about the 1912 storm/);
  });

  await check('the notebook survives a reload and ⌘J goes back to writing', async () => {
    await p.reload();
    await p.waitForSelector('#outline-editor .ProseMirror');
    await sleep(500);
    assert.equal(await p.locator('.notebook').isVisible(), true);
    assert.match(await outlineText(), /Call the harbourmaster[\s\S]*Ask about the 1912 storm[\s\S]*See Lighthouse keeper/);
    await p.keyboard.press('Control+J');
    await sleep(300);
    assert.equal(await p.locator('.page').isVisible(), true);
    assert.equal(await p.locator('.notebook').isVisible(), false);
  });

  await check('library: nested areas, a new book, and moving between books', async () => {
    await p.keyboard.press('Control+K');
    await p.keyboard.type('Library');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#lib-books .card:not(.card-new)');
    assert.match(await p.locator('#lib-books').innerText(), /Untitled novel/);
    await p.locator('#lib-areas .chip', { hasText: 'Writing' }).click();
    await sleep(300);
    await p.locator('#lib-areas .chip-row').nth(1).locator('.chip.add').click();
    await p.keyboard.type('Novels');
    await p.keyboard.press('Enter');
    await sleep(500);
    assert.equal(await p.locator('#lib-areas .chip.on').count(), 2, 'Writing and Novels both picked');
    await p.locator('.card-new').click();
    await p.keyboard.type('Winter Harbour');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.notebook', { state: 'visible' });
    await sleep(400);
    assert.equal(await p.locator('#nb-title').innerText(), 'Idea');
    assert.match(await p.locator('#crumb').innerText(), /Library\s*›\s*Writing\s*›\s*Novels\s*›\s*Winter Harbour\s*›\s*Idea/);
    const rows = await all();
    const novels = rows.find((e) => e.kind === 'area' && e.title === 'Novels');
    const book = rows.find((e) => e.kind === 'project' && e.title === 'Winter Harbour');
    const world = rows.find((e) => e.kind === 'world' && e.title === 'Winter Harbour');
    assert.equal(novels.parent_id, 'area-writing');
    assert.equal(world.area_id, novels.id);
    assert.equal(book.parent_id, world.id, 'the book is the first piece in its world');
    assert.ok(rows.some((e) => e.kind === 'page' && e.title === 'Idea' && e.parent_id === world.id), 'the Idea page is in the world’s bible');

    await p.mouse.move(600, 4);
    await sleep(300);
    await p.locator('#crumb .crumb-part', { hasText: /^Winter Harbour$/ }).click();
    await p.waitForSelector('.world-home', { state: 'visible' });
    await p.locator('#wh-continue').click();
    await p.waitForSelector('#editor .ProseMirror', { state: 'visible' });
    await sleep(300);
    await p.keyboard.type('Snow on the harbour wall.');
    await sleep(700);
    assert.match(await p.locator('#crumb').innerText(), /Winter Harbour\s*▾\s*›\s*Chapter 1/);

    await p.keyboard.press('Control+O');
    await p.keyboard.type('Chapter 2 · Untitled');
    await p.keyboard.press('Enter');
    await sleep(600);
    assert.match(await p.locator('#crumb').innerText(), /Untitled novel/);
    await p.keyboard.press('Control+O');
    await p.keyboard.type('Chapter 1 · Winter');
    await p.keyboard.press('Enter');
    await sleep(600);
    assert.match(await text2(), /Snow on the harbour wall\./);
  });

  await check('the app reopens where you left off', async () => {
    await p.reload();
    await p.waitForSelector('#editor .ProseMirror');
    await sleep(700);
    assert.match(await p.locator('#crumb').innerText(), /Winter Harbour/);
    assert.match(await text2(), /Snow on the harbour wall\./);
  });

  await check('earlier days stay closed behind the line under today, open on a click, and are remembered', async () => {
    await p.evaluate(() => new Promise((res) => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const r = indexedDB.open('writing');
      r.onsuccess = () => {
        const tx = r.result.transaction('entries', 'readwrite');
        const st = tx.objectStore('entries');
        const base = { tags: [], links: [], fields: {}, type: null, area_id: null, deleted: false, created_at: 1, updated_at: 1 };
        st.put({ ...base, id: `day-${iso}`, kind: 'day', parent_id: null, sort: 0, title: iso, text: '', content: null });
        st.put({ ...base, id: 'li_yesterday', kind: 'line', parent_id: `day-${iso}`, sort: 1, title: '', text: 'Yesterday’s thought', content: [{ type: 'text', text: 'Yesterday’s thought' }] });
        tx.oncomplete = res;
      };
    }));
    await p.keyboard.press('Control+J');
    await p.waitForSelector('.past-toggle', { state: 'visible' });
    assert.equal(await p.locator('.past-day').count(), 0, 'closed by default');
    await p.locator('.past-toggle').click();
    await p.waitForSelector('.past-day', { state: 'visible' });
    assert.match(await p.locator('.past-list').innerText(), /Yesterday’s thought/);
    assert.equal(await p.evaluate(() => localStorage.getItem('pastDays')), 'open');
    await p.locator('.past-toggle').click();
    await sleep(200);
    assert.equal(await p.locator('.past-day').count(), 0, 'closed again');
    assert.equal(await p.evaluate(() => localStorage.getItem('pastDays')), null);
    await p.locator('.past-toggle').click();
    await p.waitForSelector('.past-day', { state: 'visible' });
    await p.locator('.past-list p', { hasText: 'Yesterday’s thought' }).click();
    await sleep(500);
    assert.equal(await p.locator('#nb-kind').innerText(), 'DAILY PAGE');
    assert.match(await outlineText(), /Yesterday’s thought/);
  });

  await check('Back and Forward step through where you have been', async () => {
    await p.keyboard.press('Control+J');
    await p.waitForSelector('.page', { state: 'visible' });
    await sleep(300);
    await p.keyboard.press('Control+J');
    await p.waitForSelector('.notebook', { state: 'visible' });
    await sleep(300);
    await p.goBack();
    await sleep(600);
    assert.equal(await p.locator('.page').isVisible(), true, 'back to writing');
    assert.match(await text2(), /Snow on the harbour wall\./);
    await p.goForward();
    await sleep(600);
    assert.equal(await p.locator('.notebook').isVisible(), true, 'forward to the notebook');
  });

  await check('clicking a #tag lists everything with it', async () => {
    await p.locator('#outline-editor .ProseMirror li').last().click();
    await p.keyboard.press('Control+End');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Ferry timetable #research');
    await sleep(700);
    await p.locator('#outline-editor .tag', { hasText: '#research' }).last().click();
    await p.waitForSelector('.tag-results', { state: 'visible' });
    const found = await p.locator('#tag-results-list').innerText();
    assert.match(found, /Ferry timetable/);
    assert.match(found, /Call the harbourmaster/);
    await p.keyboard.press('Escape');
  });

  await check('a #tag gathers onto a page as mirrors you can sort and edit', async () => {
    const words = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].map((x) => {
      const c = x.cloneNode(true);
      return c.textContent;
    }), sel);
    const lines = () => words('#outline-editor li > p');
    // Puts the caret at the start (or end) of the line with these words.
    const caret = (has, end = false) => p.evaluate(({ has, end }) => {
      const ed = window.__outline;
      let at = null;
      ed.state.doc.descendants((n, pos) => { if (at === null && n.type.name === 'paragraph' && n.textContent.includes(has)) at = end === true ? pos + 1 + n.content.size : pos + 1 + (end || 0); return at === null; });
      ed.commands.setTextSelection(at);
      ed.commands.focus();
    }, { has, end });
    const mirrors = () => words('#outline-editor li.mirror > p');
    const toNotebook = async () => {
      await p.keyboard.press('Control+J');
      await p.waitForSelector('#editor .ProseMirror', { state: 'visible' });
      await sleep(300);
      await p.keyboard.press('Control+J');
      await p.waitForSelector('.notebook', { state: 'visible' });
      await sleep(400);
    };
    await toNotebook();
    const today = await p.locator('#nb-title').innerText();
    await p.evaluate(() => window.__outline.commands.focus('end'));
    await p.keyboard.press('Enter');
    await p.keyboard.type('Lego lighthouse for Sam #gift');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Wool scarf for Mum #gift');
    await sleep(700);
    await p.locator('#outline-editor .tag', { hasText: '#gift' }).last().click();
    await p.waitForSelector('.tag-results', { state: 'visible' });
    await p.locator('.tag-results [data-cmd=gather-tag]').click();
    await p.waitForSelector('.palette', { state: 'visible' });
    await sleep(300);
    await p.locator('#palette-list li', { hasText: 'A new page called “Gift”' }).click();
    await p.waitForFunction(() => document.querySelectorAll('#outline-editor li.mirror').length === 2);
    assert.equal(await p.locator('#nb-title').innerText(), 'Gift');
    assert.equal(await p.locator('#outline-editor p.gathers').getAttribute('data-gathers'), '#gift');
    assert.deepEqual(await mirrors(), ['Lego lighthouse for Sam #gift', 'Wool scarf for Mum #gift']);
    const short = await p.evaluate(() => new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    assert.equal(await p.locator('#outline-editor li.mirror').first().getAttribute('data-from'), short, `mirrored from ${today}`);
    await sleep(700);
    let rows = await all();
    const giftPage = rows.find((r) => r.kind === 'page' && r.title === 'Gift' && !r.deleted);
    const mirrorRows = rows.filter((r) => r.kind === 'line' && !r.deleted && r.fields?.mirror);
    assert.equal(mirrorRows.length, 2);
    assert.ok(mirrorRows.every((r) => r.tags.length === 0), 'a mirror is not found twice under its #tag');
    const tagged = rows.filter((r) => !r.deleted && r.tags?.includes('gift'));
    assert.equal(tagged.length, 2);

    // Edit a mirror: the original changes too.
    await p.locator('#outline-editor li.mirror > p', { hasText: 'Lego lighthouse' }).click();
    assert.equal(await p.locator('#nb-title').innerText(), 'Gift', 'clicking a mirror edits it here');
    await caret('Lego lighthouse');
    await p.keyboard.type('Big ');
    await sleep(900);
    rows = await all();
    const lego = rows.find((r) => r.id === mirrorRows.find((m) => m.text.startsWith('Lego')).fields.mirror);
    assert.equal(lego.text, 'Big Lego lighthouse for Sam #gift');
    assert.deepEqual(lego.tags, ['gift']);
    assert.notEqual(lego.parent_id, giftPage.id, 'the original stays where it was written');

    // Sort them: a heading for Mum with the scarf under it, then delete the Lego mirror.
    await caret('Wool scarf');
    await p.keyboard.press('Enter');
    await p.keyboard.press('ArrowUp');
    await p.keyboard.type('Mum');
    await p.keyboard.press('ArrowDown');
    await sleep(100); // the editor picks up an arrow's move a moment later
    await p.keyboard.press('Tab');
    await sleep(300);
    // Enter in the middle of a mirror opens a line after it and leaves its words whole.
    await caret('Big Lego', 3);
    await p.keyboard.press('Enter');
    await p.keyboard.type('blue one');
    await sleep(900);
    assert.deepEqual((await mirrors()).slice(0, 1), ['Big Lego lighthouse for Sam #gift']);
    assert.ok((await lines()).includes('blue one'));
    assert.equal((await all()).find((r) => r.id === lego.id).text, 'Big Lego lighthouse for Sam #gift');
    // The editor reads each key's effect a moment later; a person never types this fast.
    const keys = async (...ks) => { for (const k of ks) { await p.keyboard.press(k); await sleep(80); } };
    await keys('Shift+Home', 'Backspace', 'Backspace');
    await caret('Big Lego', true);
    await sleep(80);
    await keys('Shift+Home', 'Backspace', 'Backspace');
    await sleep(900);
    rows = await all();
    assert.ok(!rows.some((r) => r.kind === 'line' && !r.deleted && r.fields?.mirror === lego.id), 'the Lego mirror is gone from the page');
    const scarfMirror = rows.find((r) => r.kind === 'line' && !r.deleted && r.fields?.mirror && r.text.startsWith('Wool'));
    const mum = rows.find((r) => r.kind === 'line' && !r.deleted && r.text === 'Mum');
    assert.ok(mum && scarfMirror, 'Mum heading and scarf mirror saved');
    assert.equal(scarfMirror.parent_id, mum.id, 'the mirror nests under Mum on this page');
    assert.ok(rows.find((r) => r.id === lego.id && !r.deleted), 'deleting a mirror leaves the original');

    // Edit the original on its own page, and tag something new.
    await toNotebook();
    await caret('Wool scarf for Mum', true);
    await p.keyboard.press('Control+ArrowLeft');
    await p.keyboard.press('Control+ArrowLeft');
    await p.keyboard.type('(green) ');
    await p.evaluate(() => window.__outline.commands.focus('end'));
    await p.keyboard.press('Enter');
    await p.keyboard.type('Ferry tickets for Dad #gift');
    await sleep(900);
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.go-panel', { state: 'visible' });
    await sleep(300);
    await p.keyboard.type('Gift');
    await sleep(300);
    await p.locator('#palette-list li', { hasText: /^Gift/ }).first().click();
    await p.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Gift');
    await p.waitForFunction(() => document.querySelectorAll('#outline-editor li.mirror').length === 2);
    const after = await lines();
    assert.ok(after.includes('Wool scarf for Mum (green) #gift'), after.join(' | '));
    assert.ok(after.includes('Ferry tickets for Dad #gift'), after.join(' | '));
    assert.ok(!after.some((t) => t.includes('Lego')), 'a deleted mirror stays gone');
    assert.ok(after.indexOf('Mum') < after.indexOf('Wool scarf for Mum (green) #gift'), 'the sorting is kept');

    // Bring back what was deleted.
    await p.locator('#outline-editor li[data-gather] > p').click();
    assert.equal(await p.locator('.tag-results').isVisible(), false, 'clicking the line (not its #tag chip) edits it');
    await p.locator('#outline-editor li[data-gather] > p').click({ position: { x: 1, y: 8 } });
    await sleep(100);
    await p.keyboard.press('Control+K');
    await p.waitForSelector('.palette', { state: 'visible' });
    await p.keyboard.type('Bring back gathered');
    await sleep(200);
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelectorAll('#outline-editor li.mirror').length === 3);

    // The #tag chip on the gathering line lists the tag.
    const box = await p.evaluate(() => {
      const el = document.querySelector('#outline-editor p.gathers');
      const r = document.createRange(); r.selectNodeContents(el);
      const last = [...r.getClientRects()].filter((x) => x.width).at(-1);
      return { x: last.right + 30, y: last.top + last.height / 2 };
    });
    await p.mouse.click(box.x, box.y);
    await p.waitForSelector('.tag-results', { state: 'visible' });
    assert.equal(await p.locator('#tag-results-title').textContent(), '#gift');
    const listed = await p.locator('#tag-results-list').innerText();
    assert.equal((listed.match(/Wool scarf/g) || []).length, 1, 'mirrors are not listed again under the tag');
    await p.locator('.tag-results [data-cmd=close-tag]').click();

  });

  await check('the six-dot handle moves a paragraph and adds a note', async () => {
    await p.keyboard.press('Control+J');
    await p.waitForSelector('#editor .ProseMirror', { state: 'visible' });
    await p.locator('#editor .ProseMirror p').last().click();
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Second line.');
    await sleep(700);
    const paras = p.locator('#editor .ProseMirror > p');
    await paras.nth(1).hover();
    const h = await p.locator('.block-handle').boundingBox();
    const first = await paras.nth(0).boundingBox();
    await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await p.mouse.down();
    await p.mouse.move(h.x + 5, first.y + 4, { steps: 6 });
    await p.mouse.up();
    await sleep(700);
    assert.match(await text2(), /^Second line\.\s+Snow on the harbour wall\./);
    await paras.nth(1).hover();
    await p.locator('.block-handle').click();
    await p.locator('.handle-menu button', { hasText: 'Add a note' }).click();
    await sleep(300);
    await p.keyboard.type('Check the tide tables');
    await sleep(800);
    const note = (await all()).find((e) => e.kind === 'note' && e.text === 'Check the tide tables');
    assert.equal(note.parent_id, await paras.nth(1).getAttribute('data-eid'));
    // Hide notes sits on the note itself; the dot brings them back.
    await p.locator('.note').first().hover();
    await p.locator('.note-hide').first().click();
    await p.waitForFunction(() => !document.body.classList.contains('notes-on'));
    await p.locator('.note-dot').first().click();
    await p.waitForFunction(() => document.body.classList.contains('notes-on'));
  });

  await check('a right-click on the handle opens the same menu, with Turn into chips', async () => {
    const para = p.locator('#editor .ProseMirror > p').first();
    await para.hover();
    await p.locator('.block-handle').click({ button: 'right' });
    await p.waitForSelector('.handle-menu', { state: 'visible' });
    assert.equal(await p.locator('.handle-menu .head').innerText(), 'PARAGRAPH');
    assert.deepEqual(await p.locator('.handle-menu .hm-chip').allInnerTexts(), ['Paragraph', 'Heading']);
    assert.equal(await p.locator('.handle-menu .hm-chip.current').innerText(), 'Paragraph');
    await p.locator('.handle-menu .hm-chip', { hasText: 'Heading' }).click();
    await p.waitForSelector('#editor .ProseMirror > h2');
    assert.equal(await p.locator('.handle-menu').count(), 0, 'the menu closes');
    await p.locator('#editor .ProseMirror > h2').hover();
    await p.locator('.block-handle').click();
    assert.equal(await p.locator('.handle-menu .head').innerText(), 'HEADING');
    await p.locator('.handle-menu .hm-chip', { hasText: 'Paragraph' }).click();
    await p.waitForFunction(() => !document.querySelector('#editor .ProseMirror > h2'));
    // Move to… opens the same picker as "Send selection to…", with pages and days.
    await p.locator('#editor .ProseMirror > p').first().hover();
    await p.locator('.block-handle').click({ button: 'right' });
    await p.locator('.handle-menu .item', { hasText: 'Move to…' }).click();
    await p.waitForSelector('.palette', { state: 'visible' });
    await p.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.startsWith('Today'));
    await p.keyboard.press('Escape');
  });

  await check('the handle stays while the mouse crosses the margin to it', async () => {
    await p.keyboard.press('Escape');
    const para = await p.locator('#editor .ProseMirror > p').first().boundingBox();
    await p.mouse.move(para.x + 40, para.y + 6);
    await p.mouse.move(para.x - 20, para.y + 6, { steps: 5 });
    assert.equal(await p.locator('.block-handle').evaluate((el) => el.classList.contains('visible')), true);
  });

  await check('note categories can be added and are saved to sync', async () => {
    await p.keyboard.press('Control+K');
    await p.keyboard.type('Note categories');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.note-types');
    await p.locator('.note-types button', { hasText: '+ Add a category' }).click();
    await p.keyboard.type('Props');
    await p.locator('.note-types button', { hasText: 'Save' }).click();
    await sleep(500);
    const row = (await all()).find((e) => e.id === 'settings-note-types');
    assert.ok(row?.fields.types.some((t) => t.name === 'Props'));
  });

  await check('Linked from shows with a count, and can be switched off', async () => {
    await p.keyboard.press('Control+O');
    await p.keyboard.type('Lighthouse keeper');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#nb-links', { state: 'visible' });
    assert.equal(await p.locator('#nb-links').innerText(), 'Linked from 1');
    await sleep(500); // let the page finish opening, so it doesn't take focus back from the menu
    await p.keyboard.press('Control+K');
    await p.keyboard.type('hide "Linked from"');
    await p.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('Linked from'));
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.documentElement.classList.contains('hide-links'), null, { timeout: 3000 });
    assert.equal(await p.locator('.notebook .backlinks').isVisible(), false);
    await p.keyboard.press('Control+.');
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('focus')), true);
    await p.keyboard.press('Control+.');
  });

  await check('shortcuts: Library, a day back, the shortcuts sheet and the Focus button', async () => {
    await p.keyboard.press('Control+Shift+O');
    await p.waitForSelector('main.library', { state: 'visible' });
    await p.keyboard.press('Control+J');
    await p.waitForSelector('.notebook', { state: 'visible' });
    await p.waitForFunction(() => document.querySelector('#nb-kind').textContent === 'Today');
    const today = await p.evaluate(() => document.querySelector('#nb-title').textContent);
    await p.keyboard.press('Control+Alt+ArrowUp');
    await p.waitForFunction((t) => document.querySelector('#nb-title').textContent !== t, today);
    await p.keyboard.press('Control+Alt+ArrowDown');
    await p.waitForFunction((t) => document.querySelector('#nb-title').textContent === t, today);
    await p.keyboard.press('Control+/');
    assert.equal(await p.locator('.shortcuts').isVisible(), true);
    // Off a Mac every label reads Ctrl, Alt and Shift, in the sheet, the buttons and the menu.
    const sheet = await p.locator('.shortcuts').innerText();
    assert.ok(!/[⌘⌥⇧]/.test(sheet), sheet);
    assert.ok(sheet.includes('Ctrl+J') && sheet.includes('Ctrl+Shift+O') && sheet.includes('Alt+N'), sheet);
    assert.equal(await p.locator('#focus-toggle').getAttribute('title'), 'Focus: just the text (Ctrl+.)');
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.shortcuts').isVisible(), false);
    // The empty command menu has a row for the same list.
    await sleep(300);
    await p.keyboard.press('Control+K');
    await p.locator('.palette li', { hasText: 'Keyboard shortcuts' }).click();
    assert.equal(await p.locator('.shortcuts').isVisible(), true);
    assert.equal(await p.locator('.palette').isVisible(), false);
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.shortcuts').isVisible(), false);
    await p.locator('#focus-toggle').click({ force: true });
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('focus')), true);
    await p.locator('#focus-toggle').click({ force: true });
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('focus')), false);
    await p.keyboard.press('Control+J');
  });

  await check('lines fold away and a bullet zooms in', async () => {
    if (!(await p.locator('.notebook').isVisible())) await p.keyboard.press('Control+J');
    await p.waitForSelector('.notebook', { state: 'visible' });
    await p.waitForFunction(() => document.querySelector('#nb-kind').textContent === 'Today');
    const top = p.locator('#outline-editor li', { hasText: 'Call the harbourmaster' }).first();
    // Bullets are off by default: the dot only shows under the pointer.
    assert.equal(await top.locator(':scope > .line-gutter .bullet').evaluate((b) => getComputedStyle(b, '::after').opacity), '0');
    const storm = p.locator('#outline-editor li p', { hasText: 'Ask about the 1912 storm' });
    await top.locator(':scope > p').click({ position: { x: 12, y: 10 } }); // away from the #tag
    await sleep(150);
    await p.keyboard.press('Control+ArrowUp');
    await p.waitForFunction(() => document.querySelector('#outline-editor li.folded'));
    assert.equal(await storm.isVisible(), false, 'folded away');
    await p.keyboard.press('Control+ArrowDown');
    assert.equal(await storm.isVisible(), true, 'unfolded');
    await top.locator(':scope > .line-gutter .fold').click();
    assert.equal(await storm.isVisible(), false, 'arrow folds');
    await top.locator(':scope > .line-gutter .fold').click();
    assert.equal(await storm.isVisible(), true, 'arrow unfolds');
    await top.locator(':scope > .line-gutter .bullet').click();
    await p.waitForSelector('.notebook.zoomed');
    assert.equal(await p.locator('#nb-zoom').isVisible(), true);
    assert.equal(await p.locator('#nb-title').isVisible(), false);
    assert.equal(await storm.isVisible(), true);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('.notebook.zoomed'));
    await top.locator(':scope > .line-gutter .bullet').click();
    await p.waitForSelector('.notebook.zoomed');
    await p.goBack();
    await p.waitForFunction(() => !document.querySelector('.notebook.zoomed'));
    assert.equal(await p.locator('#nb-title').isVisible(), true);
  });

  await check('a notebook line shows six dots on hover; a right-click opens its menu', async () => {
    const top = p.locator('#outline-editor li', { hasText: 'Call the harbourmaster' }).first();
    await top.locator(':scope > p').hover({ position: { x: 12, y: 10 } });
    await p.waitForFunction(() => [...document.querySelectorAll('#outline-editor li')].find((li) => li.querySelector(':scope > p')?.textContent.startsWith('Call the harbourmaster'))?.querySelector(':scope > .line-gutter .grip') && getComputedStyle([...document.querySelectorAll('#outline-editor li')].find((li) => li.querySelector(':scope > p')?.textContent.startsWith('Call the harbourmaster')).querySelector(':scope > .line-gutter .grip')).opacity === '1');
    await top.locator(':scope > .line-gutter .bullet').click({ button: 'right' });
    await p.waitForSelector('.handle-menu', { state: 'visible' });
    assert.equal(await p.locator('.notebook.zoomed').count(), 0, 'a right-click does not zoom');
    assert.match(await p.locator('.handle-menu .head').innerText(), /^LINE · \d+ LINES? UNDER IT$/);
    const labels = await p.locator('.handle-menu .item > span:first-child').allInnerTexts();
    assert.equal(labels[0], 'Zoom in');
    assert.ok(labels.some((l) => /^Fold the \d+ lines? under it$/.test(l)), labels.join(' | '));
    assert.ok(labels.includes('Move to…'));
    assert.match(labels.at(-1), /^Delete line and the \d+ lines? under it$/);
    await p.locator('.handle-menu .item', { hasText: 'Mark done' }).click();
    await p.waitForFunction(() => [...document.querySelectorAll('#outline-editor li[data-done] > p')].some((x) => x.textContent.startsWith('Call the harbourmaster')));
    await top.locator(':scope > .line-gutter .bullet').click({ button: 'right' });
    await p.locator('.handle-menu .item', { hasText: 'Not done' }).click();
    await p.waitForFunction(() => ![...document.querySelectorAll('#outline-editor li[data-done] > p')].some((x) => x.textContent.startsWith('Call the harbourmaster')));
    await top.locator(':scope > .line-gutter .bullet').click({ button: 'right' });
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.handle-menu').count(), 0);
    // Switched off, the line goes back to a plain dot.
    await p.evaluate(() => document.documentElement.classList.add('hide-handle'));
    await top.locator(':scope > p').hover({ position: { x: 12, y: 10 } });
    await sleep(300);
    assert.equal(await top.locator(':scope > .line-gutter .grip').evaluate((g) => getComputedStyle(g).opacity), '0');
    await p.evaluate(() => document.documentElement.classList.remove('hide-handle'));
  });

  await check('the command menu opens on categories, and typing still finds everything', async () => {
    await sleep(600);
    await p.keyboard.press('Control+K');
    await p.waitForSelector('.palette', { state: 'visible' });
    const top = await p.locator('#palette-list li .label').allInnerTexts();
    assert.equal(top.length, 9, top.join(' | '));
    assert.match(top[3], /^View/);
    assert.match(top[8], /^Keyboard shortcuts/);
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#palette-input').placeholder === 'View…');
    assert.match(await p.locator('#palette-list li[aria-selected="true"]').innerText(), /Sidebar/);
    await p.keyboard.press('Backspace');
    await p.waitForFunction(() => document.querySelectorAll('#palette-list li').length === 9);
    await p.keyboard.type('light / dark');
    assert.match(await p.locator('#palette-list li').first().innerText(), /Light \/ dark/);
    await p.keyboard.press('Escape');
  });

  await check('a screenplay formats itself as you type, and keeps its elements', async () => {
    await sleep(400);
    await p.keyboard.press('Control+K');
    await p.keyboard.type('New screenplay');
    await p.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('New screenplay'));
    await p.keyboard.press('Enter');
    await p.waitForSelector('#lib-new', { state: 'visible' });
    await p.fill('#lib-new-title', 'The Harbour');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.notebook', { state: 'visible' });
    await p.waitForFunction(() => document.querySelector('#nb-title').textContent === 'Idea');
    await sleep(400);
    await p.keyboard.press('Control+O');
    await p.keyboard.type('Script · The Harbour');
    await p.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('Script · The Harbour'));
    await p.keyboard.press('Enter');
    await p.waitForSelector('html.script #editor p[data-el="scene"]');
    await p.locator('#editor p[data-el="scene"]').click();
    await p.keyboard.type('int. lighthouse - night');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Rain hits the glass.');
    await p.keyboard.press('Enter');
    await p.keyboard.type('MARA');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Is anyone up here?');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Tab');
    const els = await p.$$eval('#editor .ProseMirror > p', (ps) => ps.map((x) => x.dataset.el || 'action'));
    assert.deepEqual(els, ['scene', 'action', 'character', 'dialogue', 'character']);
    assert.equal(await p.locator('#editor p[data-el="scene"]').evaluate((x) => getComputedStyle(x).textTransform), 'uppercase');
    await p.waitForFunction(() => /About 1 page/.test(document.querySelector('#words').textContent));
    await sleep(800);
    const mara = (await all()).find((e) => e.kind === 'para' && e.text === 'MARA');
    assert.equal(mara.fields.el, 'character');
    // "# " starts a section, your own heading over the INT./EXT. scenes.
    await p.keyboard.type('# ');
    await sleep(300);
    await p.waitForFunction(() => document.activeElement?.classList.contains('scene-title'));
    await p.keyboard.type('The light goes out');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => [...document.querySelectorAll('#outline-scenes .tree-scene')].map((b) => b.textContent).join('|') === 'INT. LIGHTHOUSE - NIGHT|The light goes out');
    await sleep(800);
    assert.ok((await all()).some((e) => e.kind === 'scene' && e.title === 'The light goes out'));
    await p.keyboard.press('Control+K');
    await p.keyboard.type('Read it through');
    await p.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('Read it through'));
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.documentElement.classList.contains('reading'));
    assert.equal(await p.locator('.scene-break').isVisible(), false);
    await p.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'));
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.documentElement.classList.contains('reading') && !document.documentElement.classList.contains('focus'));
    await p.reload();
    await p.waitForSelector('html.script #editor p[data-el="dialogue"]');
    assert.equal(await p.locator('#editor p[data-el="dialogue"]').innerText(), 'Is anyone up here?');
  });

  await check('on a phone, element buttons above the keyboard change the line you are on', async () => {
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    const ph = await phoneCtx.newPage();
    ph.on('pageerror', (e) => errors.push(e.message));
    await ph.goto(URL);
    await ph.waitForSelector('#editor .ProseMirror');
    await sleep(500);
    await ph.keyboard.press('Control+K');
    await ph.keyboard.type('New screenplay');
    await ph.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('New screenplay'));
    await ph.keyboard.press('Enter');
    await ph.waitForSelector('#lib-new', { state: 'visible' });
    await ph.fill('#lib-new-title', 'Pocket');
    await ph.keyboard.press('Enter');
    await ph.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Idea');
    await sleep(400);
    await ph.keyboard.press('Control+O');
    await ph.keyboard.type('Script · Pocket');
    await ph.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.includes('Script · Pocket'));
    await ph.keyboard.press('Enter');
    await ph.waitForSelector('html.script #editor p[data-el="scene"]');
    await ph.locator('#editor p[data-el="scene"]').tap();
    await ph.waitForSelector('.script-bar', { state: 'visible' });
    assert.equal(await ph.locator('.script-bar button.current').innerText(), 'Scene');
    await ph.keyboard.type('Mara');
    await ph.locator('.script-bar button[data-el="character"]').tap();
    await ph.waitForSelector('#editor p[data-el="character"]');
    assert.equal(await ph.evaluate(() => document.activeElement?.classList.contains('ProseMirror')), true, 'keyboard stays up');
    assert.equal(await ph.locator('.script-bar button.current').innerText(), 'Character');
    // The handle beside the line opens the menu as a sheet (no dragging on a phone).
    await ph.locator('.block-handle').tap();
    await ph.waitForSelector('.handle-menu.as-sheet', { state: 'visible' });
    assert.equal(await ph.locator('.handle-menu .head').innerText(), 'CHARACTER');
    assert.deepEqual(await ph.locator('.handle-menu .hm-chip').allInnerTexts(), ['Scene', 'Action', 'Character', 'Paren', 'Dialogue', 'Transition']);
    await ph.locator('.handle-menu .hm-chip', { hasText: 'Dialogue' }).tap();
    await ph.waitForSelector('#editor p[data-el="dialogue"]');
    await ph.locator('.script-bar button[data-el="character"]').tap();
    await ph.waitForSelector('#editor p[data-el="character"]');
    // The mic first, then the script buttons, the alternates, and + (the insert menu) last.
    const row = await ph.locator('.script-bar:not(.outline-bar) button').evaluateAll((bs) => bs.filter((b) => b.offsetParent).map((b) => (b.dataset.ins ? 'insert' : b.dataset.talk ? 'talk' : b.dataset.alt || b.dataset.el)));
    assert.deepEqual(row, ['talk', 'scene', 'action', 'character', 'paren', 'dialogue', 'transition', 'section', 'word', 'ask', 'para', 'prev', 'next', 'insert']);

    // Outlines get their own row: indent, outdent, move, tag.
    await ph.keyboard.press('Control+J');
    await ph.waitForFunction(() => document.querySelector('#nb-kind')?.textContent === 'Today');
    // The page takes the caret itself; a tap on it could land on the row above
    // the keyboard (which is up by then) and press one of its buttons.
    await ph.evaluate(() => {
      window.__seen = [];
      const note = (e) => window.__seen.push([performance.now() | 0, e.type, e.target.dataset?.do || e.target.className || e.target.tagName]);
      for (const t of ['pointerdown', 'pointerup', 'focusout', 'keydown']) document.addEventListener(t, note, true);
    });
    await ph.evaluate(() => window.__notebook.editor.commands.focus('end'));
    await ph.waitForSelector('.outline-bar', { state: 'visible' });
    await ph.keyboard.type('Boats');
    await ph.keyboard.press('Enter');
    await ph.keyboard.type('Tides');
    await ph.waitForSelector('.outline-bar', { state: 'visible' });
    const tap = (what) => ph.locator(`.outline-bar [data-do="${what}"]`).tap({ timeout: 8000 })
      .catch(async (e) => { console.log('seen', JSON.stringify(await ph.evaluate(() => [window.__seen, performance.now() | 0]))); throw e; });
    await tap('indent');
    await ph.waitForFunction(() => [...document.querySelectorAll('#outline-editor li li > p')].some((p) => p.textContent === 'Tides'));
    await tap('outdent');
    await ph.waitForFunction(() => ![...document.querySelectorAll('#outline-editor li li > p')].some((p) => p.textContent === 'Tides'));
    await tap('up');
    const order = () => ph.evaluate(() => [...document.querySelectorAll('#outline-editor .ProseMirror > ul > li > p')].map((p) => p.textContent).filter((t) => t === 'Boats' || t === 'Tides'));
    await ph.waitForFunction(() => {
      const t = [...document.querySelectorAll('#outline-editor .ProseMirror > ul > li > p')].map((p) => p.textContent);
      return t.indexOf('Tides') > -1 && t.indexOf('Tides') < t.indexOf('Boats');
    });
    assert.deepEqual(await order(), ['Tides', 'Boats']);
    await tap('tag');
    await ph.keyboard.type('sea');
    await ph.waitForFunction(() => [...document.querySelectorAll('#outline-editor li > p')].some((p) => p.textContent === 'Tides #sea'));
    assert.equal(await ph.evaluate(() => document.activeElement?.closest('#outline-editor') !== null), true, 'keyboard stays up');
    // The mic comes first in the row, then Undo and Redo, the moves, # and link;
    // Done, Move to, Zoom and + (the insert menu) wait at the end.
    assert.deepEqual(await ph.locator('.outline-bar button').evaluateAll((bs) => bs.map((b) => b.dataset.do)), ['talk', 'undo', 'redo', 'outdent', 'indent', 'up', 'down', 'tag', 'link', 'done', 'move', 'zoom', 'insert']);
    assert.equal(await ph.locator('.outline-bar [data-do="link"]').evaluate((b) => b.getBoundingClientRect().right <= innerWidth), true, 'link fits on the first screen');
    // The line you're on shows its handle; a tap brings its menu up from the bottom.
    // Move down keeps the sheet open so it can be tapped again.
    const here = ph.locator('#outline-editor li.here > .line-gutter .bullet');
    await here.waitFor({ state: 'visible' });
    await here.tap();
    await ph.waitForSelector('.handle-menu.as-sheet', { state: 'visible' });
    assert.equal(await ph.locator('.notebook.zoomed').count(), 0, 'a tap on the handle does not zoom');
    await ph.locator('.handle-menu .pair .item', { hasText: 'Move down' }).tap();
    await ph.waitForFunction(() => {
      const t = [...document.querySelectorAll('#outline-editor .ProseMirror > ul > li > p')].map((p) => p.textContent);
      return t.indexOf('Tides #sea') > t.indexOf('Boats');
    });
    assert.equal(await ph.locator('.handle-menu.as-sheet').isVisible(), true, 'the sheet stays for another move');
    await ph.locator('#outline-editor li > p', { hasText: /^Tides #sea$/ }).tap();
    assert.equal(await ph.locator('.handle-menu').count(), 0, 'a tap elsewhere closes it');
    await ph.keyboard.press('End');
    await tap('undo');
    await ph.waitForFunction(() => ![...document.querySelectorAll('#outline-editor li > p')].some((p) => p.textContent === 'Tides #sea'));
    await tap('redo');
    await ph.waitForFunction(() => [...document.querySelectorAll('#outline-editor li > p')].some((p) => p.textContent === 'Tides #sea'));
    await tap('done');
    await ph.waitForFunction((t) => [...document.querySelectorAll('#outline-editor li[data-done] > p')].some((x) => x.textContent === t), 'Tides #sea');
    await tap('done');
    await ph.waitForFunction(() => !document.querySelector('#outline-editor li[data-done]'));
    // Move to… sends the line to tomorrow's page.
    await tap('move');
    await ph.waitForSelector('.palette', { state: 'visible' });
    await ph.waitForFunction(() => document.querySelector('#palette-list li')?.textContent.startsWith('Tomorrow'));
    await ph.locator('#palette-list li').first().tap();
    await ph.waitForFunction(() => ![...document.querySelectorAll('#outline-editor li > p')].some((p) => p.textContent === 'Tides #sea'));
    await sleep(500);
    const moved = await ph.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result.filter((e) => e.text === 'Tides #sea')); };
    }));
    const d = new Date(); d.setDate(d.getDate() + 1);
    const tomorrow = `day-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(moved.length, 1);
    assert.equal(moved[0].parent_id, tomorrow);
    assert.equal(moved[0].deleted, false);
    // Holding a button doesn't press it (holding is for scrolling the row); a quick tap does.
    const order2 = await ph.locator('.outline-bar button').evaluateAll((bs) => bs.map((b) => b.dataset.do));
    assert.ok(order2.indexOf('zoom') > order2.indexOf('link'), order2.join(','));
    assert.equal(order2.includes('fold'), false);
    await ph.evaluate(() => window.__outline.commands.focus('end'));
    await ph.keyboard.press('Enter');
    await ph.keyboard.type('Gulls');
    await sleep(200);
    const nested = () => ph.evaluate(() => [...document.querySelectorAll('#outline-editor li li > p')].some((x) => x.textContent === 'Gulls'));
    const ib = await ph.locator('.outline-bar [data-do="indent"]').boundingBox();
    const cdp = await phoneCtx.newCDPSession(ph);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ib.x + ib.width / 2, y: ib.y + ib.height / 2 }] });
    await sleep(500);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    assert.equal(await nested(), false, 'a held button does nothing');
    await tap('indent');
    await ph.waitForFunction(() => [...document.querySelectorAll('#outline-editor li li > p')].some((x) => x.textContent === 'Gulls'));
    // After zooming in and out, and moving lines, the caret stays clear of the row.
    await ph.evaluate(() => window.__outline.commands.focus('end'));
    for (let i = 0; i < 30; i++) { await ph.keyboard.press('Enter'); await ph.keyboard.type(`Line ${i}`); }
    const clear = () => ph.evaluate(() => {
      const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
      const bar = document.querySelector('.outline-bar').getBoundingClientRect();
      return r.bottom > 0 && r.bottom <= bar.top - 40;
    });
    await tap('zoom');
    await ph.waitForSelector('.notebook.zoomed');
    await tap('zoom');
    await ph.waitForFunction(() => !document.querySelector('.notebook.zoomed'));
    await sleep(200);
    assert.equal(await clear(), true, 'caret visible after zooming out');
    await ph.evaluate(() => window.scrollTo(0, 0));
    await tap('up');
    await sleep(200);
    assert.equal(await clear(), true, 'caret visible after moving a line');
    // Tapping a line low on the screen brings it up above the row.
    await ph.evaluate(() => {
      const bar = document.querySelector('.outline-bar').getBoundingClientRect();
      const p = [...document.querySelectorAll('#outline-editor li > p')].find((x) => x.textContent === 'Line 12');
      window.scrollBy(0, p.getBoundingClientRect().bottom - bar.top + 4);
    });
    await sleep(150);
    await ph.locator('#outline-editor li > p', { hasText: /^Line 12$/ }).tap({ position: { x: 30, y: 4 } });
    await ph.waitForFunction(() => window.__outline.state.selection.$head.parent.textContent === 'Line 12');
    await sleep(400);
    assert.equal(await clear(), true, 'caret visible after tapping a line near the bottom');
    // A line with lines under it has a caret to fold it.
    const parent = ph.locator('#outline-editor li.has-kids').first();
    const caret = parent.locator(':scope > .line-gutter .fold');
    assert.ok(Number(await caret.evaluate((b) => getComputedStyle(b).opacity)) > 0.3, 'caret shows on a phone');
    await caret.tap();
    await ph.waitForSelector('#outline-editor li.folded');
    // The caret stepped up onto the folded line, so its handle is there now; Unfold leads its menu.
    await ph.locator('#outline-editor li.here.folded > .line-gutter .bullet').tap();
    await ph.waitForSelector('.handle-menu.as-sheet', { state: 'visible' });
    assert.match(await ph.locator('.handle-menu .item').first().innerText(), /^Unfold the \d+ lines under it/);
    await ph.locator('.handle-menu .item').first().tap();
    await ph.waitForFunction(() => !document.querySelector('#outline-editor li.folded'));
    await phoneCtx.close();
  });

  await check('a notebook line moves with Alt+Shift+arrows and by dragging its dot', async () => {
    await sleep(300);
    if (!(await p.locator('.notebook').isVisible())) await p.keyboard.press('Control+J');
    await p.waitForFunction(() => document.querySelector('#nb-kind')?.textContent === 'Today');
    const texts = () => p.evaluate(() => [...document.querySelectorAll('#outline-editor li > p')].map((x) => x.textContent));
    const last = p.locator('#outline-editor li > p').last();
    await last.click();
    await p.keyboard.press('End');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Alpha');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Beta');
    await sleep(150);
    await p.keyboard.press('Alt+Shift+ArrowUp');
    await p.waitForFunction(() => { const t = [...document.querySelectorAll('#outline-editor li > p')].map((x) => x.textContent); return t.indexOf('Beta') === t.indexOf('Alpha') - 1; });
    // Drag Alpha's dot above Beta.
    const alpha = p.locator('#outline-editor li', { has: p.locator(':scope > p', { hasText: /^Alpha$/ }) });
    const beta = p.locator('#outline-editor li > p', { hasText: /^Beta$/ });
    const dot = await alpha.locator(':scope > .line-gutter .bullet').boundingBox();
    const tgt = await beta.boundingBox();
    await p.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await p.mouse.down();
    await p.mouse.move(dot.x + 4, dot.y - 10, { steps: 4 });
    await p.mouse.move(tgt.x + 20, tgt.y + 4, { steps: 6 });
    assert.equal(await p.locator('.line-drop').isVisible(), true);
    await p.mouse.up();
    await p.waitForFunction(() => { const t = [...document.querySelectorAll('#outline-editor li > p')].map((x) => x.textContent); return t.indexOf('Alpha') === t.indexOf('Beta') - 1; });
    assert.equal(await p.locator('.notebook.zoomed').count(), 0, 'a drag does not zoom in');
    await sleep(1200);
    await p.reload();
    await p.waitForFunction(() => document.querySelector('#nb-kind')?.textContent === 'Today');
    const after = await texts();
    assert.equal(after.indexOf('Alpha'), after.indexOf('Beta') - 1, 'the new order is saved');
    // Ctrl+Enter marks a line done, and it stays done.
    await sleep(600); // the page takes focus back after a reload
    const alphaLine = p.locator('#outline-editor li > p', { hasText: /^Alpha$/ });
    await alphaLine.click();
    await sleep(300);
    await alphaLine.click();
    await p.waitForFunction(() => window.__outline.state.selection.$head.parent.textContent === 'Alpha');
    await p.keyboard.press('Control+Enter');
    await p.waitForFunction((t) => [...document.querySelectorAll('#outline-editor li[data-done] > p')].some((x) => x.textContent === t), 'Alpha');
    await sleep(1200);
    await p.reload();
    await p.waitForFunction((t) => [...document.querySelectorAll('#outline-editor li[data-done] > p')].some((x) => x.textContent === t), 'Alpha');
  });

  await check('Progress shows words and pages by day, week and month', async () => {
    await sleep(400);
    await p.keyboard.press('Control+Shift+P');
    await p.waitForSelector('.stats', { state: 'visible' });
    await p.waitForFunction(() => document.querySelectorAll('.stats-list li').length >= 3);
    const names = await p.locator('.stats-list .name').allInnerTexts();
    assert.match(names[0], /^Everything/);
    assert.ok(names.some((n) => /The Harbour\s+Screenplay/.test(n)), names.join(' | '));
    assert.match(names.at(-1), /^Notes/);
    assert.match(await p.locator('.stats-sub').innerText(), /^Today · Everything/);
    assert.match(await p.locator('.stats-big').innerText(), /\d words?$/);
    assert.equal(await p.locator('.stats-bars rect').count(), 14);
    await p.locator('.stats-list button', { hasText: 'The Harbour' }).click();
    await p.waitForFunction(() => /page/.test(document.querySelector('.stats-big').textContent));
    await p.locator('.stats [data-unit="month"]').click();
    await p.waitForFunction(() => /^This month/.test(document.querySelector('.stats-sub').textContent));
    assert.equal(await p.locator('.stats-bars rect').count(), 12);
    const tally = await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result.filter((e) => e.kind === 'tally')); };
    }));
    assert.equal(tally.length, 1);
    assert.ok(tally[0].fields.start && tally[0].fields.end, 'the first tally keeps where the day started');
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.stats').isVisible(), false);
  });

  await check('a manuscript paragraph gathers too, and a mirror edit reaches the open chapter', async () => {
    await p.keyboard.press('Escape');
    if (!(await p.locator('#editor .ProseMirror').isVisible())) await p.keyboard.press('Control+J');
    await p.waitForSelector('#editor .ProseMirror', { state: 'visible' });
    await sleep(400);
    await p.evaluate(() => window.__editor.commands.focus('end'));
    await p.keyboard.press('Enter');
    await p.keyboard.type('A ship in a bottle for Dad. #gift');
    await sleep(900);
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.go-panel', { state: 'visible' });
    await sleep(300);
    await p.keyboard.type('Gift');
    await sleep(300);
    await p.locator('#palette-list li', { hasText: /^Gift/ }).first().click();
    await p.waitForFunction(() => document.querySelector('#nb-title')?.textContent === 'Gift');
    await p.waitForFunction(() => [...document.querySelectorAll('#outline-editor li.mirror > p')].some((x) => x.textContent.startsWith('A ship in a bottle')));
    await p.evaluate(() => {
      const ed = window.__outline;
      ed.state.doc.descendants((n, pos) => { if (n.type.name === 'paragraph' && n.textContent.startsWith('A ship in a bottle')) { ed.commands.setTextSelection(pos + 3); return false; } });
      ed.commands.focus();
    });
    await sleep(80);
    await p.keyboard.type('glass ');
    await sleep(900);
    await p.keyboard.press('Control+J');
    await p.waitForSelector('#editor .ProseMirror', { state: 'visible' });
    await sleep(400);
    assert.match(await p.locator('#editor .ProseMirror').innerText(), /A glass ship in a bottle for Dad\. #gift/);
    const para = (await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
    }))).find((r) => r.kind === 'para' && !r.deleted && r.text.includes('ship in a bottle'));
    assert.equal(para.text, 'A glass ship in a bottle for Dad. #gift');
  });

  await check('Enter on an empty top line starts a new line (the next words are kept)', async () => {
    if (!(await p.locator('#outline-editor').isVisible())) await p.keyboard.press('Control+J');
    await p.waitForSelector('#outline-editor .ProseMirror', { state: 'visible' });
    await sleep(500);
    await p.evaluate(() => {
      const ed = window.__outline;
      ed.commands.setContent({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }] });
      ed.commands.focus('end');
    });
    await sleep(200);
    await p.keyboard.press('Enter');
    await p.keyboard.type('Kept words');
    const texts = await p.evaluate(() => { const o = []; window.__outline.state.doc.descendants((n) => { if (n.type.name === 'listItem') o.push(n.firstChild.textContent); }); return o; });
    assert.deepEqual(texts, ['', 'Kept words']);
  });

  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
