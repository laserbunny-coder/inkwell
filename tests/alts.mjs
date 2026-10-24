// Alternates in a real browser: word versions and paragraph versions are added,
// flipped in place, saved, and stay out of exports.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

const PORT = 4183;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const entries = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const para = () => page.locator('#editor .ProseMirror p').first().innerText();
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#editor .ProseMirror');
  await sleep(500);
  await page.keyboard.type('She walked to the harbour.');
  await sleep(400);

  await check('⌘⇧E on a word opens the panel and adds alternates', async () => {
    await page.evaluate(() => window.__editor.chain().focus().setTextSelection(7).run());
    await page.keyboard.press('Control+Shift+E');
    await page.waitForSelector('.alt-panel:not([hidden]) input');
    await page.waitForFunction(() => document.activeElement?.matches('.alt-panel input'));
    await page.keyboard.type('drifted');
    await page.keyboard.press('Enter');
    await page.keyboard.type('marched');
    await page.keyboard.press('Shift+Enter');
    assert.equal(await para(), 'She marched to the harbour.');
    assert.deepEqual(await page.locator('.alt-panel .alt-pick').allInnerTexts(), ['walked', 'drifted', 'marched']);
    assert.equal(await page.locator('.alt-panel li.current .alt-pick').innerText(), 'marched');
  });

  await check('⌥↓ flips the word in place', async () => {
    await page.keyboard.press('Escape');
    await page.locator('#editor .alt').click();
    await page.keyboard.press('Alt+ArrowDown');
    assert.equal(await para(), 'She walked to the harbour.');
    await page.keyboard.press('Alt+ArrowDown');
    assert.equal(await para(), 'She drifted to the harbour.');
  });

  await check('alternates are saved and come back after a reload', async () => {
    await sleep(800);
    const p = (await entries()).find((e) => e.kind === 'para' && !e.deleted);
    assert.equal(p.text, 'She drifted to the harbour.');
    await page.reload();
    await page.waitForSelector('#editor .alt');
    await sleep(500);
    assert.deepEqual(JSON.parse(await page.locator('#editor .alt').getAttribute('data-alts')), ['walked', 'drifted', 'marched']);
  });

  await check('a new paragraph version keeps the old one and flips back', async () => {
    await page.locator('#editor .ProseMirror p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Control+Shift+D');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.type('The harbour was empty when she got there.');
    assert.equal(await page.locator('#editor p[data-pv]').getAttribute('data-pv'), '2/2');
    await page.keyboard.press('Home');
    await page.keyboard.press('Alt+ArrowUp');
    assert.equal(await para(), 'She drifted to the harbour.');
    await page.keyboard.press('End');
    await page.keyboard.press('Alt+ArrowUp');
    assert.equal(await para(), 'The harbour was empty when she got there.');
    await sleep(800);
    const p = (await entries()).find((e) => e.kind === 'para' && !e.deleted);
    assert.equal(p.fields.versions.length, 2);
    assert.equal(p.fields.pvi, 1);
    assert.equal(p.text, 'The harbour was empty when she got there.');
  });

  await check('the versions panel lists paragraph versions and can drop one', async () => {
    await page.evaluate(() => { document.querySelector('#editor .ProseMirror').focus(); });
    await page.keyboard.press('Control+K');
    await page.keyboard.type('Versions of this paragraph');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.alt-panel:not([hidden]) li');
    assert.equal(await page.locator('.alt-panel li').count(), 2);
    await page.locator('.alt-panel li:not(.current) .alt-drop').click({ force: true });
    assert.equal(await page.locator('.alt-panel li').count(), 1);
    assert.equal(await page.locator('#editor p[data-pv]').count(), 0);
  });

  await check('switching marks off hides the underline; focus hides it too', async () => {
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__editor.chain().focus().setTextSelection(7).run());
    await page.keyboard.press('Control+Shift+E');
    await page.waitForSelector('.alt-panel:not([hidden]) input');
    // The panel takes focus a moment after it shows; typing before then lands in the text.
    await page.waitForFunction(() => document.activeElement?.matches('.alt-panel input'));
    await page.keyboard.type('port');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const deco = () => page.locator('#editor .alt').first().evaluate((el) => getComputedStyle(el).textDecorationLine);
    assert.equal(await deco(), 'underline');
    await page.evaluate(() => document.documentElement.classList.add('hide-alts'));
    assert.equal(await deco(), 'none');
    await page.evaluate(() => document.documentElement.classList.remove('hide-alts'));
    await page.evaluate(() => document.documentElement.classList.add('focus'));
    assert.equal(await deco(), 'none');
    await page.evaluate(() => document.documentElement.classList.remove('focus'));
  });

  await check('Ask Claude adds suggestions that fit, widening to fix "a" and "an"', async () => {
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.__asked = [];
      window.__claude = async (body) => {
        window.__asked.push(body);
        await new Promise((r) => setTimeout(r, 150));
        if (body.mode === 'paragraph') return { rewrites: ['A first rewrite.', 'A second rewrite.'] };
        return { suggestions: [{ replace: 'a long', with: 'an endless' }, { replace: 'long', with: 'slow' }, { replace: 'nowhere', with: 'bogus' }] };
      };
      window.__editor.chain().focus('end').run();
    });
    await page.keyboard.press('Enter');
    await page.keyboard.type('She took a long walk.');
    const p = page.locator('#editor .ProseMirror p').last();
    await page.evaluate(() => { const { state } = window.__editor; const end = state.doc.content.size - 1; window.__editor.chain().focus().setTextSelection(end - 8).run(); });
    await page.keyboard.press('Control+Shift+E');
    await page.waitForSelector('.alt-panel:not([hidden]) .alt-ask');
    await page.locator('.alt-panel .alt-ask').click();
    await page.waitForSelector('.alt-panel .alt-ask:disabled');
    await page.waitForSelector('.alt-panel li.by-claude');
    const asked = await page.evaluate(() => window.__asked[0]);
    assert.equal(asked.mode, 'word');
    assert.equal(asked.paragraph, 'She took a ⟦long⟧ walk.');
    assert.deepEqual(asked.existing, ['long']);
    assert.match(asked.before, /harbour/);
    assert.equal(asked.book, 'Untitled novel');
    assert.deepEqual(await page.locator('.alt-panel .alt-pick').allInnerTexts(), ['a long', 'an endless', 'a slow']);
    assert.equal(await page.locator('.alt-panel li.by-claude').count(), 2);
    assert.equal(await p.innerText(), 'She took a long walk.');
    await page.locator('.alt-panel .alt-pick', { hasText: 'an endless' }).click();
    assert.equal(await p.innerText(), 'She took an endless walk.');
  });

  await check('?? in the add box asks too, and nothing new says so', async () => {
    await page.evaluate(() => { window.__claude = async () => ({ suggestions: [{ replace: 'an endless', with: 'a long' }] }); });
    await page.locator('.alt-panel input').click();
    await page.keyboard.type('??');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.alt-panel .alt-note');
    assert.match(await page.locator('.alt-panel .alt-note').innerText(), /anything new/);
  });

  await check('Ask Claude for a rewrite adds paragraph versions and keeps yours showing', async () => {
    await page.evaluate(() => {
      window.__claude = async (body) => { window.__asked.push(body); return { rewrites: ['A first rewrite.', 'A second rewrite.'] }; };
    });
    await page.locator('.alt-panel .alt-head .ghost-btn', { hasText: 'Paragraph' }).click();
    await page.locator('.alt-panel .alt-ask').click();
    await page.waitForFunction(() => document.querySelectorAll('.alt-panel li').length === 3);
    assert.equal(await page.evaluate(() => window.__asked.at(-1).mode), 'paragraph');
    assert.equal(await page.locator('#editor .ProseMirror p').last().innerText(), 'She took an endless walk.');
    assert.equal(await page.locator('#editor .ProseMirror p').last().getAttribute('data-pv'), '1/3');
  });

  await check('a Claude error shows in the panel', async () => {
    await page.evaluate(() => { window.__claude = async () => { throw new Error('Claude is busy right now. Try again in a minute.'); }; });
    await page.locator('.alt-panel .alt-ask').click();
    await page.waitForFunction(() => /busy/.test(document.querySelector('.alt-panel .alt-note')?.textContent || ''));
  });

  await check('no Ask Claude button when signed out', async () => {
    await page.evaluate(() => { delete window.__claude; });
    await page.locator('.alt-panel .alt-head .ghost-btn', { hasText: 'Word' }).click();
    assert.equal(await page.locator('.alt-panel .alt-ask').count(), 0);
  });

  await check('on a phone, the alternates buttons ride at the end of the row above the keyboard', async () => {
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
    const ph = await phoneCtx.newPage();
    ph.on('pageerror', (e) => errors.push(e.message));
    await ph.goto(`http://localhost:${PORT}/`);
    await ph.waitForSelector('#editor .ProseMirror');
    await sleep(500);
    await ph.locator('#editor .ProseMirror').tap();
    await ph.keyboard.type('She walked home.');
    await ph.waitForSelector('.script-bar', { state: 'visible' });
    // A prose chapter: + (the insert menu) and the alternates buttons, no script ones.
    const shown = () => ph.locator('.script-bar button').evaluateAll((bs) => bs.filter((b) => b.offsetParent).map((b) => (b.dataset.ins ? 'insert' : b.dataset.talk ? 'talk' : b.dataset.alt || b.dataset.el)));
    assert.deepEqual(await shown(), ['insert', 'talk', 'word', 'ask', 'para', 'prev', 'next']);
    assert.equal(await ph.locator('.script-bar [data-alt="prev"]').evaluate((b) => b.classList.contains('idle')), true);
    // Alternates: the sheet opens for the word at the caret, and the keyboard stays up.
    await ph.evaluate(() => window.__editor.chain().focus().setTextSelection(7).run());
    await ph.locator('.script-bar [data-alt="word"]').tap();
    await ph.waitForSelector('.alt-panel.sheet-mode:not([hidden])');
    assert.equal(await ph.evaluate(() => document.activeElement?.classList.contains('ProseMirror')), true, 'keyboard stays up');
    const sheet = await ph.locator('.alt-panel').boundingBox();
    const bar = await ph.locator('.script-bar:not(.outline-bar)').boundingBox();
    assert.ok(sheet.y + sheet.height <= bar.y + 1, 'the sheet sits above the row');
    // Ask Claude from the row.
    await ph.evaluate(() => { window.__claude = async () => ({ suggestions: [{ replace: 'walked', with: 'wandered' }] }); });
    await ph.locator('.script-bar [data-alt="ask"]').tap();
    await ph.waitForFunction(() => [...document.querySelectorAll('.alt-panel .alt-pick')].some((b) => b.textContent === 'wandered'));
    await ph.waitForFunction(() => document.querySelector('.script-bar [data-alt="word"]').textContent === 'Alternates · 2');
    // ‹ › flip the word in place.
    await ph.locator('.script-bar [data-alt="next"]').tap();
    await ph.waitForFunction(() => window.__editor.state.doc.textContent === 'She wandered home.');
    await ph.locator('.script-bar [data-alt="prev"]').tap();
    await ph.waitForFunction(() => window.__editor.state.doc.textContent === 'She walked home.');
    // Turning alternates off hides the row on prose.
    await ph.evaluate(() => { localStorage.setItem('hide', JSON.stringify(['alts'])); });
    await ph.reload();
    await ph.waitForSelector('#editor .ProseMirror');
    await sleep(500);
    await ph.locator('#editor .ProseMirror').tap();
    await sleep(300);
    assert.equal(await ph.locator('.script-bar:not(.outline-bar)').isHidden(), true);
    await phoneCtx.close();
  });

  await check('no page errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
