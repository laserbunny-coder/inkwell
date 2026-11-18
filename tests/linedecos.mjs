// Long pages stay quick because each line's bullet, fold arrow, box, tags and
// labels are redrawn only where a change happened. This checks that what's
// kept always matches drawing the whole page afresh, through a long run of
// mixed edits: typing, Enter, Tab, Shift + Tab, Backspace joins, moving lines,
// ticking, checklists, folding, zooming, paste and Undo.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { setOutline } from './outliner-kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4239;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);

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
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 6).join('\n     ')}`); }
}

// A page of about 120 lines, three deep, with tags, a checklist and a fold.
let spec = '';
for (let i = 0; i < 30; i++) {
  spec += `Line ${i} about the harbour${i % 4 === 0 ? ' #tide' : ''}${i === 5 ? ' [+]' : ''}\n`;
  for (let k = 0; k < 2; k++) {
    spec += `  Child ${i}.${k} with words${k === 1 ? ' #gulls' : ''}\n`;
    if (i % 3 === 0) spec += `    Grandchild ${i}.${k}\n`;
  }
}
spec = spec.replace('Line 10 about the harbour', 'Line 10 about the harbour|');

try {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(fake);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
  await sleep(600);
  await page.keyboard.press('Control+J');
  await page.waitForSelector('#outline-editor .ProseMirror');
  await sleep(500);
  await setOutline(page, spec);
  // Two lines become checklists (their lines get boxes and a count).
  await page.evaluate(() => {
    const ed = window.__outline;
    let n = 0;
    const tr = ed.state.tr;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'listItem') return;
      if (/^Line (3|12) /.test(node.firstChild.textContent)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checklist: true });
      n++;
    });
    ed.view.dispatch(tr);
  });
  await sleep(200);

  const bad = () => page.evaluate(() => window.__checkDecos());
  await check('starts out the same as drawing it afresh', async () => assert.deepEqual(await bad(), []));

  // Keys and actions, picked in a fixed pseudo-random order.
  let seed = Number(process.env.SEED || 11);
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
  const moveTo = (which) => page.evaluate((which) => {
    const ed = window.__outline;
    const ends = [];
    ed.state.doc.descendants((n, pos) => { if (n.isTextblock) { ends.push([pos + 1, pos + 1 + n.content.size]); return false; } return true; });
    const [a, b] = ends[which % ends.length];
    ed.commands.focus();
    ed.commands.setTextSelection(Math.random() < 0.5 ? a : b);
  }, which);
  const ACTIONS = [
    async () => page.keyboard.type(['x', ' #new', 'words ', '#tide ', '[ ] '][rnd(5)]),
    async () => page.keyboard.press('Enter'),
    async () => page.keyboard.press('Tab'),
    async () => page.keyboard.press('Shift+Tab'),
    async () => { await page.keyboard.press('Home'); await page.keyboard.press('Backspace'); },
    async () => page.keyboard.press('Delete'),
    async () => page.keyboard.press('Alt+Shift+ArrowUp'),
    async () => page.keyboard.press('Alt+Shift+ArrowDown'),
    async () => page.keyboard.press('Control+Enter'),
    async () => page.keyboard.press('Control+ArrowUp'),
    async () => page.keyboard.press('Control+ArrowDown'),
    async () => page.keyboard.press('Control+z'),
    async () => page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'Pasted one #tide\n  Pasted two\nPasted three');
      window.__outline.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }),
    async () => page.evaluate(() => {
      // Zoom into the caret's line, or back out.
      const ed = window.__outline, fk = window.__foldKey;
      if (fk.getState(ed.state).zoom) { ed.view.dispatch(ed.state.tr.setMeta(fk, { zoom: null })); return; }
      const { $head } = ed.state.selection;
      for (let d = $head.depth; d > 0; d--) if ($head.node(d).type.name === 'listItem') { ed.view.dispatch(ed.state.tr.setMeta(fk, { zoom: $head.node(d).attrs.eid })); return; }
    }),
    async () => moveTo(rnd(400))
  ];
  const log = [];
  for (let step = 0; step < 160; step++) {
    const a = rnd(ACTIONS.length);
    log.push(a);
    await ACTIONS[a]();
    // Rings and task labels follow what's saved (the app redraws them then), so check once it has saved.
    await page.waitForFunction(() => window.__notebook.store.idle, null, { timeout: 5000 }).catch(() => {});
    await sleep(60);
    const b = await bad();
    if (b.length) {
      console.log(JSON.stringify(await page.evaluate(() => window.__diffDecos()), null, 1));
      console.log(await page.evaluate(() => { const ed = window.__outline; const { from } = ed.state.selection; return `caret ${from} size ${ed.state.doc.content.size}`; }));
      await check(`after ${step + 1} steps it still matches (${b.join(', ')} differed; actions ${log.join(',')})`, async () => assert.deepEqual(b, []));
      break;
    }
  }
  await check('after 160 mixed edits it still matches drawing it afresh', async () => assert.deepEqual(await bad(), []));
  await check('no errors on the page', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
