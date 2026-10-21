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
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
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
    await p.locator('#history-list button').nth(1).click();
    await p.locator('#history-restore').click();
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

  const all = () => p.evaluate(() => new Promise((res) => {
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
    assert.equal(novels.parent_id, 'area-writing');
    assert.equal(book.area_id, novels.id);
    assert.ok(rows.some((e) => e.kind === 'page' && e.title === 'Idea' && e.parent_id === book.id));

    await p.mouse.move(600, 4);
    await sleep(300);
    await p.locator('#crumb .crumb-part', { hasText: /^Winter Harbour$/ }).click();
    await p.waitForSelector('.project-home', { state: 'visible' });
    await p.locator('#ph-continue').click();
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

  await check('earlier days show below today and open when clicked', async () => {
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
    await p.waitForSelector('.past-days', { state: 'visible' });
    assert.match(await p.locator('.past-days').innerText(), /Yesterday’s thought/);
    await p.locator('.past-days p', { hasText: 'Yesterday’s thought' }).click();
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
    await p.locator('.block-menu button', { hasText: 'Add a note' }).click();
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

  await check('the command menu opens on categories, and typing still finds everything', async () => {
    await sleep(600);
    await p.keyboard.press('Control+K');
    await p.waitForSelector('.palette', { state: 'visible' });
    const top = await p.locator('#palette-list li .label').allInnerTexts();
    assert.equal(top.length, 7, top.join(' | '));
    assert.match(top[3], /^View/);
    assert.match(top[6], /^Keyboard shortcuts/);
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#palette-input').placeholder === 'View…');
    assert.match(await p.locator('#palette-list li[aria-selected="true"]').innerText(), /Sidebar/);
    await p.keyboard.press('Backspace');
    await p.waitForFunction(() => document.querySelectorAll('#palette-list li').length === 7);
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
    await phoneCtx.close();
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

  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
