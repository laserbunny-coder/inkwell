// The Journal line (Nov 28 2026, his ask): every day page starts with a fixed
// line, Journal. What's written under it counts as #journal without the tag;
// the line itself can't be renamed, deleted, moved or indented, and nothing
// goes above it. Its fold is one setting for every day. All journals lists
// every day's journal, newest first, with a find box. Also: the day's Page
// face has no plan on it, and List, Page and Hours share one head and one
// column width. (A Journal-mode voice capture landing under Journal is
// checked in voice.mjs.)
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4319;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const browser = withoutSync(await chromium.launch());
const errors = [];
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result.filter((x) => !x.deleted)); };
}));
const go = (p, x) => p.evaluate((x) => { history.pushState(x, ''); dispatchEvent(new PopStateEvent('popstate', { state: x })); }, x);
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = isoOf(new Date());
const yesterday = isoOf(new Date(Date.now() - 864e5));
const open = async (ctx) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(URL);
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await sleep(500);
  return p;
};
const toDay = async (p, iso = today) => {
  await go(p, { view: 'notebook', pageId: `day-${iso}` });
  await p.waitForFunction((id) => document.documentElement.dataset.view === 'notebook' && document.querySelector('#outline-editor li[data-journal]')?.dataset.eid === id, `jr-${iso}`);
  await sleep(300);
};
const firstLine = (p) => p.evaluate(() => document.querySelector('#outline-editor .ProseMirror > ul > li > p')?.firstChild?.textContent);
const journalKids = async (p, iso = today) => (await all(p)).filter((r) => r.parent_id === `jr-${iso}`).sort((a, b) => a.sort - b.sort).map((r) => r.text);

try {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
  const p = await open(ctx);

  await check('a new day page starts with Journal and an empty “Write here…” line; nothing is saved yet', async () => {
    await toDay(p);
    assert.equal(await firstLine(p), 'Journal');
    assert.equal(await p.locator('#outline-editor p.jr-write').count(), 1);
    assert.equal(await p.locator('#outline-editor p.jr-write').getAttribute('data-ph'), 'Write here…');
    await sleep(800);
    assert.equal((await all(p)).filter((r) => r.kind === 'line' || r.kind === 'day').length, 0, 'an empty day fills nothing');
  });

  await check('what is typed under it is saved under jr-<date>, and stays after a reload', async () => {
    await p.locator('#outline-editor p.jr-write').click();
    await p.keyboard.type('Woke early. Quiet house.');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Long walk by the river');
    await sleep(900);
    const rows = await all(p);
    const head = rows.find((r) => r.id === `jr-${today}`);
    assert.ok(head?.fields?.journal, 'the Journal row');
    assert.equal(head.parent_id, `day-${today}`);
    assert.deepEqual(await journalKids(p), ['Woke early. Quiet house.', 'Long walk by the river']);
    assert.ok(!rows.some((r) => /#journal/.test(r.text || '')), 'no #journal typed into the words');
    await p.reload();
    await p.waitForFunction(() => document.documentElement.dataset.started === '1');
    await toDay(p);
    assert.equal(await firstLine(p), 'Journal');
    assert.match(await p.locator('#outline-editor').innerText(), /Woke early\. Quiet house\.[\s\S]*Long walk by the river/);
  });

  await check('nothing goes above Journal: Enter at its start, or moving the next line up', async () => {
    await p.locator('#outline-editor li[data-journal] > p').click({ position: { x: 4, y: 8 } });
    await p.keyboard.press('Home');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Z');
    await sleep(300);
    assert.equal(await firstLine(p), 'Journal');
    assert.ok((await journalKids(p))[0].startsWith('Woke early'), 'Enter went to the first line under it');
    // A line of the day's own, below the journal, moved up: still below Journal.
    await p.evaluate(() => { const ed = window.__outline; const end = ed.state.doc.content.size; ed.chain().focus().insertContentAt(end - 1, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved a link' }] }] }).run(); });
    await p.locator('#outline-editor .ProseMirror > ul > li > p', { hasText: 'Saved a link' }).click();
    for (let i = 0; i < 3; i++) { await p.keyboard.press('Alt+Shift+ArrowUp'); await sleep(120); }
    assert.equal(await firstLine(p), 'Journal');
    assert.equal(await p.evaluate(() => document.querySelectorAll('#outline-editor li[data-journal]').length), 1);
  });

  await check('Journal can’t be renamed, deleted or indented, and its menu holds only Fold, All journals and Zoom in', async () => {
    const jp = p.locator('#outline-editor li[data-journal] > p');
    await jp.click({ position: { x: 4, y: 8 } });
    await p.keyboard.press('End');
    await p.keyboard.type('!');
    await p.keyboard.press('Tab');
    await p.keyboard.press('Control+Shift+Backspace');
    await p.keyboard.press('Backspace');
    await sleep(300);
    assert.equal(await firstLine(p), 'Journal');
    await p.keyboard.press('Escape');
    await p.evaluate(() => document.activeElement?.blur());
    await jp.click({ button: 'right', position: { x: 20, y: 8 } });
    await p.waitForSelector('.pop-menu, .handle-menu', { timeout: 4000 });
    const items = (await p.locator('.pop-menu .pop-item, .handle-menu button').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    assert.deepEqual(items.map((t) => t.split('\n')[0]), ['Fold', 'All journals', 'Zoom in'], items.join(' | '));
    await p.keyboard.press('Escape');
  });

  await check('the fold is one setting for every day, and stays after a reload', async () => {
    await toDay(p);
    await p.locator('#outline-editor .jr-fold').click();
    await p.waitForFunction(() => document.querySelector('#outline-editor li[data-journal]').classList.contains('folded'));
    assert.match(await p.locator('#outline-editor .jr-count').innerText(), /^\d+ lines?$/);
    await toDay(p, yesterday);
    await p.waitForFunction(() => document.querySelector('#outline-editor li[data-journal]').classList.contains('folded'));
    await p.reload();
    await p.waitForFunction(() => document.documentElement.dataset.started === '1');
    await toDay(p);
    await p.waitForFunction(() => document.querySelector('#outline-editor li[data-journal]').classList.contains('folded'));
    await p.locator('#outline-editor .jr-fold').click();
    await p.waitForFunction(() => !document.querySelector('#outline-editor li[data-journal]').classList.contains('folded'));
  });

  await check('#journal finds a line under Journal without the tag; stepped out of it (Shift + Tab), it isn’t #journal any more', async () => {
    const tagged = async () => { await p.evaluate(() => window.__notebook.showTag('journal')); await sleep(200); return p.locator('#tag-results-list').innerText(); };
    assert.match(await tagged(), /Long walk by the river/);
    await p.keyboard.press('Escape');
    await p.locator('#outline-editor li > p', { hasText: 'Long walk by the river' }).click();
    await p.keyboard.press('End');
    await p.keyboard.press('Shift+Tab');
    await sleep(900);
    assert.ok(!(await journalKids(p)).includes('Long walk by the river'));
    assert.doesNotMatch(await tagged(), /Long walk by the river/);
    await p.evaluate(() => { document.querySelector('.tag-results').hidden = true; });
  });

  await check('All journals: newest first, older typed #journal lines too, a find box that marks the words, and Write › opens today in the journal', async () => {
    await toDay(p, yesterday);
    await p.evaluate(() => { const ed = window.__outline; const end = ed.state.doc.content.size; ed.chain().focus().insertContentAt(end - 1, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An old voice journal about the bridge #journal' }] }] }).run(); });
    await sleep(900);
    await go(p, { view: 'journal' });
    await p.waitForSelector('#journal-sheet .jp-day');
    const days = await p.locator('#journal-sheet .jp-day').evaluateAll((els) => els.map((e) => e.dataset.day));
    assert.deepEqual(days.slice(0, 2), [today, yesterday]);
    assert.match(await p.locator(`#journal-sheet .jp-day[data-day="${yesterday}"]`).innerText(), /old voice journal about the bridge/);
    assert.equal(await p.locator(`#journal-sheet .jp-day[data-day="${today}"] .jp-open`).innerText(), 'Write ›');
    assert.equal(await p.locator(`#journal-sheet .jp-day[data-day="${yesterday}"] .jp-open`).innerText(), 'Open day ›');
    await p.locator('#journal-sheet .jp-find input').fill('bridge');
    await p.waitForFunction(() => document.querySelectorAll('#journal-sheet .jp-day').length === 1);
    assert.equal(await p.locator('#journal-sheet mark').first().innerText(), 'bridge');
    await p.locator('#journal-sheet .jp-find input').fill('');
    await p.waitForFunction((d) => !!document.querySelector(`#journal-sheet .jp-day[data-day="${d}"]`), today);
    await p.locator(`#journal-sheet .jp-day[data-day="${today}"] .jp-open`).click();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'notebook');
    await sleep(400);
    const inJournal = await p.evaluate(() => { const li = document.getSelection()?.anchorNode?.parentElement?.closest('li'); return !!li && !!li.parentElement.closest('li[data-journal]'); });
    assert.ok(inJournal, 'the caret is in the journal');
  });

  await check('All journals opens from Ctrl + K and from the Journal line', async () => {
    await toDay(p);
    await p.locator('#outline-editor li[data-journal] > p').hover();
    await p.locator('#outline-editor .jr-all').click();
    await p.waitForFunction(() => document.documentElement.dataset.view === 'journal');
    await toDay(p);
    await p.keyboard.press('Control+K');
    await p.waitForSelector('.palette:not([hidden])');
    await p.keyboard.type('Journal: every');
    await sleep(250);
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.documentElement.dataset.view === 'journal');
  });

  await check('the day’s Page has no plan on it; List and Hours sit in the Page’s column, with the faces in the same place', async () => {
    const spot = async (place) => {
      await go(p, place);
      await sleep(700);
      return p.evaluate(() => {
        const vis = (s) => [...document.querySelectorAll(s)].find((x) => x.offsetParent);
        const f = vis('.zm-faces')?.getBoundingClientRect();
        const sheet = vis('.nb-sheet, #plan-sheet')?.getBoundingClientRect();
        return { x: Math.round(f.x), y: Math.round(f.y), left: Math.round(sheet.left), width: Math.round(sheet.width), plan: !!vis('#plan') };
      });
    };
    const page = await spot({ view: 'notebook', pageId: `day-${today}` });
    const list = await spot({ view: 'plan', tab: 'day' });
    const hours = await spot({ view: 'plan', tab: 'calday' });
    assert.equal(page.plan, false, 'no plan on the page');
    assert.deepEqual([list.left, list.width], [page.left, page.width], 'List in the Page’s column');
    assert.deepEqual([hours.left, hours.width], [page.left, page.width], 'Hours too');
    assert.deepEqual([list.x, list.y], [page.x, page.y], 'faces in the same place (List)');
    assert.deepEqual([hours.x, hours.y], [page.x, page.y], 'faces in the same place (Hours)');
  });

  await check('a project page keeps its own width', async () => {
    await go(p, { view: 'plan', tab: 'week' });
    await sleep(600);
    const w = await p.evaluate(() => document.querySelector('#plan-sheet').getBoundingClientRect().width);
    assert.ok(w > 700, `Week is still wide (${w})`);
  });

  await check('on a phone: no plan on the Page, faces in the same place, All journals showing, no sideways scroll on the Journal page', async () => {
    const pctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
    const ph = await open(pctx);
    await toDay(ph);
    const at = async () => ph.evaluate(() => { const f = [...document.querySelectorAll('.zm-faces')].find((x) => x.offsetParent).getBoundingClientRect(); return [Math.round(f.x), Math.round(f.y)]; });
    const page = await at();
    assert.equal(await ph.evaluate(() => !!document.querySelector('#plan')?.offsetParent), false);
    assert.ok(await ph.evaluate(() => Number(getComputedStyle(document.querySelector('#outline-editor .jr-all')).opacity) > 0.3), 'All journals shows, faintly');
    await go(ph, { view: 'plan', tab: 'day' });
    await sleep(700);
    assert.deepEqual(await at(), page, 'List’s faces where the Page’s are');
    await go(ph, { view: 'journal' });
    await ph.waitForSelector('#journal-sheet .jp-find');
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
    await pctx.close();
  });

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
