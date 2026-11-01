// The notebook outline behaves like Workflowy: Enter, Backspace and Delete at
// either end of a line (folded or open), indent and outdent, moving lines,
// zoom, pasting several lines, done, and that every word still saves.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { setOutline, readOutline, clean } from './outliner-kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4231;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: async (rows) => rows.map((r) => ({ id: r.id, updated_at: new Date().toISOString() })),
    pull: async () => [], async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {}
  };
};

const browser = await chromium.launch();
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

async function open(options = {}) {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript(fake);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(600);
  await page.keyboard.press('Control+J');
  await page.waitForSelector('#outline-editor .ProseMirror');
  await sleep(400);
  return page;
}

const keys = async (page, list) => {
  for (const k of list) {
    if (k.startsWith('type:')) await page.keyboard.type(k.slice(5));
    else await page.keyboard.press(k);
    await sleep(110);
  }
};
const paste = (page, text, html) => page.evaluate(({ text, html }) => {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  if (html) dt.setData('text/html', html);
  window.__outline.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, { text, html });

// Each case: the page before (| is the caret, [+] a folded line), the keys, the page after.
const CASES = [
  ['Enter at the end of a folded line adds a line after the whole group, still folded', `
Shared reel idea| [+]
  Kenji falls off the roof
  Momo laughs
Rehearsal notes`, ['Enter', 'type:Ramen shop scene'], `
Shared reel idea [+]
  Kenji falls off the roof
  Momo laughs
Ramen shop scene|
Rehearsal notes`],
  ['Enter at the end of an open line adds its first line underneath', `
Shared reel idea|
  Kenji falls off the roof
Rehearsal notes`, ['Enter', 'type:Cold open'], `
Shared reel idea
  Cold open|
  Kenji falls off the roof
Rehearsal notes`],
  ['Enter in the middle of a folded line sends the rest after the group', `
Ninja |Bunch [+]
  Kenji
Rehearsal notes`, ['Enter'], `
Ninja  [+]
  Kenji
|Bunch
Rehearsal notes`],
  ['Enter in the middle of an open line sends the rest to the first line under it', `
Ninja |Bunch
  Kenji`, ['Enter'], `
Ninja 
  |Bunch
  Kenji`],
  ['Enter at the start of a folded line opens a line above it', `
|Shared reel idea [+]
  Kenji falls`, ['Enter', 'ArrowUp', 'type:Note'], `
Note|
Shared reel idea [+]
  Kenji falls`],
  ['Enter after a done line starts a line that isn’t done', `
~Write the theme song|`, ['Enter', 'type:Book the dojo'], `
~Write the theme song
Book the dojo|`],
  ['Backspace at the start of a line joins it to the folded line above, which stays folded', `
Shared reel idea [+]
  Kenji falls
| and more`, ['Backspace'], `
Shared reel idea| and more [+]
  Kenji falls`],
  ['Backspace on an empty line under a folded group goes to the end of the folded line', `
Shared reel idea [+]
  Kenji falls
|`, ['Backspace', 'type:!'], `
Shared reel idea!| [+]
  Kenji falls`],
  ['Backspace on an empty nested line removes it instead of moving it out', `
Cast
  Kenji
  |
Locations`, ['Backspace', 'type:!'], `
Cast
  Kenji!|
Locations`],
  ['Backspace joins a line, and its lines, to a line above that has none', `
Cast
|Locations
  Dojo
  Ramen shop`, ['Backspace'], `
Cast|Locations
  Dojo
  Ramen shop`],
  ['Backspace does nothing when both lines have lines under them', `
Cast [+]
  Kenji
|Locations
  Dojo`, ['Backspace'], `
Cast [+]
  Kenji
|Locations
  Dojo`],
  ['Backspace on a first line joins it to the line it is under', `
Cast
  |Kenji
  Momo`, ['Backspace'], `
Cast|Kenji
  Momo`],
  ['Backspace at the very start of the page does nothing', `
|Cast
Momo`, ['Backspace'], `
|Cast
Momo`],
  ['Delete at the end of a folded line pulls up the line after the group', `
Shared reel idea| [+]
  Kenji falls
and next`, ['Delete'], `
Shared reel idea|and next [+]
  Kenji falls`],
  ['Delete at the end of an open line pulls up its first line', `
Cast|
  : Kenji
Locations`, ['Delete'], `
Cast|: Kenji
Locations`],
  ['Delete before an empty line removes it', `
Cast|

Locations`, ['Delete'], `
Cast|
Locations`],
  ['Tab under a folded line opens it and goes last', `
Cast [+]
  Kenji
Momo|`, ['Tab'], `
Cast
  Kenji
  Momo|`],
  ['Tab on the first line does nothing', `
Ca|st
Kenji`, ['Tab'], `
Ca|st
Kenji`],
  ['Tab and Shift+Tab move several picked lines together', `
Cast
Ken|ji
Momo`, ['Shift+ArrowDown', 'Tab'], `
Cast
  Kenji
  Momo`],
  ['Shift+Tab puts the line after the one it was under; the lines below stay put', `
Cast
  Kenji
  Momo|
  Sensei
Locations`, ['Shift+Tab'], `
Cast
  Kenji
  Sensei
Momo|
Locations`],
  ['Shift+Tab keeps the line’s own lines with it', `
Cast
  Momo|
    Loves ramen
  Sensei`, ['Shift+Tab'], `
Cast
  Sensei
Momo|
  Loves ramen`],
  ['Alt+Shift+Down moves a line past a folded group as a whole', `
Intro|
Cast [+]
  Kenji
End`, ['Alt+Shift+ArrowDown'], `
Cast [+]
  Kenji
Intro|
End`],
  ['Moving the first line up carries it into the group above', `
Cast
  Kenji
Locations
  |Dojo
  Ramen shop`, ['Alt+Shift+ArrowUp'], `
Cast
  Kenji
  |Dojo
Locations
  Ramen shop`],
  ['Moving the last line down carries it into the group below, opening it', `
Cast
  Kenji|
Locations [+]
  Dojo`, ['Control+Shift+ArrowDown'], `
Cast
Locations
  Kenji|
  Dojo`],
  ['Ctrl+Shift+Backspace deletes the line and everything under it', `
Cast
Locations|
  Dojo
End`, ['Control+Shift+Backspace'], `
Cast|
End`],
  ['Arrow Down from a folded line skips what’s folded', `
Cast| [+]
  Kenji
Locations`, ['ArrowDown', 'Home', 'type:>'], `
Cast [+]
  Kenji
>|Locations`],
  ['Ctrl+Enter marks a folded line done and keeps it folded', `
Cast| [+]
  Kenji`, ['Control+Enter'], `
~Cast| [+]
  Kenji`]
];

const ZOOMED = [
  ['Shift+Tab on a top line of a zoom does nothing (it would leave the view)', `
Season one
  Cast
    |Kenji`, 'Cast', ['Shift+Tab'], `
Season one
  Cast
    |Kenji`],
  ['Backspace at the start of a zoom’s first line doesn’t pull it into the title', `
Season one
  Cast
    |Kenji`, 'Cast', ['Backspace'], `
Season one
  Cast
    |Kenji`],
  ['Moving a zoom’s first line up stays inside the zoom', `
Season one
  Cast
    |Kenji
  Locations`, 'Cast', ['Alt+Shift+ArrowUp'], `
Season one
  Cast
    |Kenji
  Locations`],
  ['Enter at the end of the zoomed-in line adds its first line', `
Season one
  Cast|
    Kenji`, 'Cast', ['Enter', 'type:Momo'], `
Season one
  Cast
    Momo|
    Kenji`]
];

try {
  const page = await open();
  for (const [name, before, k, after] of CASES) {
    await check(name, async () => {
      await setOutline(page, before);
      await keys(page, k);
      assert.equal(await readOutline(page), clean(after));
    });
  }
  for (const [name, before, zoom, k, after] of ZOOMED) {
    await check(name, async () => {
      await setOutline(page, before, { zoom });
      await keys(page, k);
      assert.equal(await readOutline(page), clean(after));
    });
  }
  await setOutline(page, '|');

  await check('pasting plain lines makes lines, nested by indent, dashes taken off', async () => {
    await setOutline(page, 'Episodes: | (draft)');
    await paste(page, '- Episode 1\n  - Cold open\n  - [x] Theme song\n- Episode 2');
    await sleep(150);
    assert.equal(await readOutline(page), clean(`
Episodes: Episode 1
  Cold open
  ~Theme song
Episode 2| (draft)`));
  });

  await check('pasting a Workflowy list (HTML) keeps its nesting', async () => {
    await setOutline(page, '|');
    await paste(page, 'Episode 1\nCold open\nEpisode 2', '<ul><li>Episode 1<ul><li>Cold open</li></ul></li><li>Episode 2</li></ul>');
    await sleep(150);
    assert.equal(await readOutline(page), clean(`
Episode 1
  Cold open
Episode 2|`));
  });

  await check('a line can only hold one paragraph, so nothing typed or pasted goes unsaved', async () => {
    const extra = await page.evaluate(() => {
      let n = 0;
      window.__outline.state.doc.descendants((node) => { if (node.type.name === 'listItem' && node.childCount > 1 && node.child(1).type.name === 'paragraph') n++; });
      return n;
    });
    assert.equal(extra, 0);
    assert.equal(await page.evaluate(() => window.__outline.schema.nodes.listItem.spec.content), 'paragraph bulletList?');
  });

  await check('every line typed with these keys is still there after a reload', async () => {
    await setOutline(page, '|');
    await page.keyboard.type('Ninja Bunch reel');
    await keys(page, ['Enter', 'Tab', 'type:Kenji falls', 'Enter', 'type:Momo laughs', 'ArrowUp', 'ArrowUp', 'End', 'Control+ArrowUp', 'Enter', 'type:Rehearsal', 'Enter', 'type: notes', 'Home', 'Backspace']);
    await sleep(900);
    await page.reload();
    await page.waitForSelector('#outline-editor .ProseMirror');
    await sleep(900);
    const text = await page.evaluate(() => window.__outline.state.doc.textContent);
    assert.equal(text, 'Ninja Bunch reelKenji fallsMomo laughsRehearsal notes');
    assert.equal((await readOutline(page)).replace('|', ''), clean(`
Ninja Bunch reel [+]
  Kenji falls
  Momo laughs
Rehearsal notes`));
  });

  await check('a page saved with a line holding two paragraphs opens with both as lines', async () => {
    const doc = { type: 'doc', content: [{ type: 'bulletList', content: [
      { type: 'listItem', attrs: { eid: 'li_a' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cast' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Locations' }] }] }
    ] }] };
    const pageId = await page.evaluate(() => window.__notebook.page.id);
    await page.evaluate(({ pageId, doc }) => localStorage.setItem(`wal:${pageId}`, JSON.stringify({ at: Date.now(), doc })), { pageId, doc });
    await page.reload();
    await page.waitForSelector('#outline-editor .ProseMirror');
    await sleep(900);
    assert.equal((await readOutline(page)).replace('|', ''), 'Cast\nLocations');
  });

  assert.deepEqual(page.errors, []);
  await page.context().close();

  // On a phone: the same keys come from the keyboard, and the bar's buttons.
  const ph = await open({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const bar = async (what) => { await ph.locator(`.outline-bar button[data-do="${what}"]`).tap(); await sleep(250); };

  await check('phone: Enter at the end of a folded line adds a line after the group', async () => {
    await setOutline(ph, 'Shared from Instagram| [+]\n  Kenji clip\n  Caption idea\nEnd');
    await keys(ph, ['Enter', 'type:My note']);
    assert.equal(await readOutline(ph), clean(`
Shared from Instagram [+]
  Kenji clip
  Caption idea
My note|
End`));
  });

  await check('phone: the outdent button leaves the lines below where they were', async () => {
    await setOutline(ph, 'Cast\n  Kenji\n  Momo|\n  Sensei');
    await sleep(300);
    await bar('outdent');
    assert.equal(await readOutline(ph), clean(`
Cast
  Kenji
  Sensei
Momo|`));
  });

  await check('phone: the up button carries the first line into the group above', async () => {
    await setOutline(ph, 'Cast\n  Kenji\nLocations\n  |Dojo');
    await sleep(300);
    await bar('up');
    assert.equal(await readOutline(ph), clean(`
Cast
  Kenji
  |Dojo
Locations`));
  });

  assert.deepEqual(ph.errors, []);
} catch (e) {
  failed += 1;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall outliner checks passed');
