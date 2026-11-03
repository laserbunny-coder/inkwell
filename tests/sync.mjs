// Two devices (separate browser profiles) syncing through a stand-in for
// Supabase that behaves the same way: the server stamps updated_at, and pulls
// return everything changed since a time.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4181;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const table = new Map();
let clock = Date.parse('2026-10-20T00:00:00Z');
function remote(op, arg) {
  if (op === 'push') {
    const stamp = new Date((clock += 1000)).toISOString();
    return arg.map((r) => {
      table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp });
      return { id: r.id, updated_at: stamp };
    });
  }
  if (op === 'pull') {
    return [...table.values()].filter((r) => r.updated_at > arg.since)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1))
      .slice(arg.from, arg.from + 500);
  }
}

const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }),
    onAuth() {},
    signIn() {},
    signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    subscribe() {},
    unsubscribe() {}
  };
};

const browser = await chromium.launch();
async function device() {
  const ctx = await browser.newContext();
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('#editor .ProseMirror');
  return page;
}
const text = (p) => p.locator('#editor .ProseMirror').innerText();
const syncNow = (p) => p.evaluate(() => window.__sync.run());
const words = (p) => p.locator('#editor .ProseMirror').innerText();

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); }
}

try {
  const laptop = await device();
  await laptop.keyboard.type('From the laptop.');
  await sleep(600);
  await syncNow(laptop);

  await check('writing on one device reaches the cloud', async () => {
    const paras = [...table.values()].filter((r) => r.kind === 'para');
    assert.equal(paras.length, 1);
    assert.equal(paras[0].text, 'From the laptop.');
  });

  await check('writing on after a sync does not count as a clash with yourself', async () => {
    await laptop.keyboard.type(' Still going.');
    await sleep(600);
    await syncNow(laptop);
    await laptop.keyboard.type(' And more.');
    await sleep(600);
    await syncNow(laptop);
    await syncNow(laptop);
    assert.equal(await laptop.locator('#versions').isHidden(), true, 'no "to check" pill');
    const paras = [...table.values()].filter((r) => r.kind === 'para');
    assert.equal(paras[0].text, 'From the laptop. Still going. And more.');
    // Put the text back the way the later checks expect it.
    for (let i = 0; i < ' Still going. And more.'.length; i++) await laptop.keyboard.press('Backspace');
    await sleep(600);
    await syncNow(laptop);
  });

  await sleep(50);
  const phone = await device();
  await sleep(500);
  await syncNow(phone);
  await sleep(300);

  await check('a new device picks up the same book and drops its own empty starter', async () => {
    assert.equal(await text(phone), 'From the laptop.');
    const live = [...table.values()].filter((r) => r.kind === 'project' && !r.deleted);
    assert.equal(live.length, 1);
  });

  await check('writing on the second device shows up on the first', async () => {
    await phone.locator('#editor .ProseMirror p').last().click();
    await phone.keyboard.press('End');
    await phone.keyboard.press('Enter');
    await phone.keyboard.type('And from the phone.');
    await sleep(600);
    await syncNow(phone);
    await syncNow(laptop);
    await sleep(300);
    assert.match(await text(laptop), /From the laptop\.\s+And from the phone\./);
  });

  await check('the cursor stays put when the other device changes a different paragraph', async () => {
    await laptop.locator('#editor .ProseMirror p').first().click();
    await laptop.keyboard.press('End');
    await phone.locator('#editor .ProseMirror p').last().click();
    await phone.keyboard.press('End');
    await phone.keyboard.type(' More.');
    await sleep(600);
    await syncNow(phone);
    await syncNow(laptop);
    await sleep(300);
    await laptop.keyboard.type(' Still here.');
    assert.match(await text(laptop), /From the laptop\. Still here\.\s+And from the phone\. More\./);
  });

  await check('editing the same paragraph on both while apart keeps both versions', async () => {
    await sleep(600);
    await syncNow(laptop);
    await syncNow(phone);
    await sleep(300);
    // Laptop goes offline and edits paragraph one.
    await laptop.evaluate(() => { window.__savedUser = window.__sync.user; window.__sync.user = null; });
    await laptop.locator('#editor .ProseMirror p').first().click();
    await laptop.keyboard.press('End');
    await laptop.keyboard.type(' Laptop edit.');
    await sleep(600);
    // Phone edits the same paragraph and syncs first.
    await phone.locator('#editor .ProseMirror p').first().click();
    await phone.keyboard.press('End');
    await phone.keyboard.type(' Phone edit.');
    await sleep(600);
    await syncNow(phone);
    // Laptop comes back.
    await laptop.evaluate(() => { window.__sync.user = window.__savedUser; return window.__sync.run(); });
    await syncNow(phone);
    await sleep(300);
    assert.match(await text(laptop), /Laptop edit\./);
    assert.match(await text(phone), /Laptop edit\./);
    const conflicts = await laptop.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => { const q = r.result.transaction('conflicts').objectStore('conflicts').getAll(); q.onsuccess = () => res(q.result); };
    }));
    assert.ok(conflicts.some((c) => c.text.includes('Phone edit.')), 'phone version kept as a conflict copy');
  });

  await check('a line on today’s page reaches the other device’s open page', async () => {
    await phone.keyboard.press('Control+J');
    await phone.waitForSelector('#outline-editor .ProseMirror-focused');
    await laptop.keyboard.press('Control+J');
    await laptop.waitForSelector('#outline-editor .ProseMirror-focused');
    await sleep(300);
    await laptop.keyboard.type('Idea from the laptop');
    await sleep(700);
    await syncNow(laptop);
    await syncNow(phone);
    await sleep(500);
    assert.match(await phone.locator('#outline-editor .ProseMirror').innerText(), /Idea from the laptop/);
    await phone.keyboard.type('Phone line');
    await sleep(700);
    await syncNow(phone);
    await syncNow(laptop);
    await sleep(500);
    assert.match(await laptop.locator('#outline-editor .ProseMirror').innerText(), /Idea from the laptop[\s\S]*Phone line|Phone line[\s\S]*Idea from the laptop/);
  });

  // Gathering a #tag onto a page, with mirrors edited on either device.
  const mirrorTexts = (p) => p.evaluate(() => [...document.querySelectorAll('#outline-editor li.mirror > p')].map((x) => x.textContent));
  const outlineHas = (p, re) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#outline-editor .ProseMirror').innerText), re.source, { timeout: 5000 });
  const atEnd = async (p, words) => {
    await p.evaluate(() => window.__outline.commands.focus('end'));
    await p.keyboard.press('Enter');
    await p.keyboard.type(words);
    await sleep(700);
  };
  const openPage = async (p, title) => {
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.go-panel', { state: 'visible' });
    await sleep(300);
    await p.keyboard.type(title);
    await sleep(300);
    await p.locator('#palette-list li', { hasText: new RegExp(`^${title}`) }).first().click();
    await p.waitForFunction((t) => document.querySelector('#nb-title')?.textContent === t, title);
    await sleep(400);
  };
  const today = async (p) => {
    await p.keyboard.press('Control+O');
    await p.waitForSelector('.go-panel', { state: 'visible' });
    await sleep(300);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+J');
    await sleep(300);
    if (!(await p.locator('.notebook').isVisible())) await p.keyboard.press('Control+J');
    await p.waitForSelector('#outline-editor .ProseMirror', { state: 'visible' });
    await sleep(400);
  };

  await check('a page gathering #gift on one device shows the same mirrors on the other', async () => {
    await atEnd(laptop, 'Candle for Ana #gift');
    await laptop.locator('#outline-editor .tag', { hasText: '#gift' }).last().click();
    await laptop.waitForSelector('.tag-results', { state: 'visible' });
    await laptop.locator('.tag-results [data-cmd=gather-tag]').click();
    await laptop.waitForSelector('.palette', { state: 'visible' });
    await laptop.locator('#palette-list li', { hasText: 'A new page called “Gift”' }).click();
    await laptop.waitForFunction(() => document.querySelectorAll('#outline-editor li.mirror').length === 1);
    await sleep(700);
    await syncNow(laptop);
    await syncNow(phone);
    await openPage(phone, 'Gift');
    assert.deepEqual(await mirrorTexts(phone), ['Candle for Ana #gift']);
  });

  await check('editing a mirror on the phone changes the original on the laptop', async () => {
    await phone.evaluate(() => {
      const ed = window.__outline;
      ed.state.doc.descendants((n, pos) => { if (n.type.name === 'listItem' && n.attrs.mirror) { ed.commands.setTextSelection(pos + 2); return false; } });
      ed.commands.focus();
    });
    await sleep(100);
    await phone.keyboard.type('Tall ');
    await sleep(800);
    await syncNow(phone);
    await syncNow(laptop);
    await outlineHas(laptop, /Tall Candle for Ana #gift/);
    const src = [...table.values()].find((r) => r.kind === 'line' && !r.deleted && !r.fields?.mirror && r.text === 'Tall Candle for Ana #gift');
    assert.ok(src, 'the original line itself changed');
    await today(laptop);
    await outlineHas(laptop, /Tall Candle for Ana #gift/);
  });

  await check('editing the original on the laptop updates the mirror open on the phone', async () => {
    await laptop.evaluate(() => {
      const ed = window.__outline;
      ed.state.doc.descendants((n, pos) => { if (n.type.name === 'paragraph' && n.textContent.startsWith('Tall Candle')) { ed.commands.setTextSelection(pos + 1 + 'Tall Candle'.length); return false; } });
      ed.commands.focus();
    });
    await sleep(100);
    await laptop.keyboard.type(' (vanilla)');
    await sleep(800);
    await syncNow(laptop);
    await syncNow(phone);
    await phone.waitForFunction(() => [...document.querySelectorAll('#outline-editor li.mirror > p')].some((x) => x.textContent === 'Tall Candle (vanilla) for Ana #gift'), null, { timeout: 5000 });
  });

  await check('something tagged later on one device gathers onto the page open on the other', async () => {
    await atEnd(laptop, 'Book for Leo #gift');
    await syncNow(laptop);
    await syncNow(phone);
    await phone.waitForFunction(() => document.querySelectorAll('#outline-editor li.mirror').length === 2, null, { timeout: 5000 });
    assert.deepEqual(await mirrorTexts(phone), ['Tall Candle (vanilla) for Ana #gift', 'Book for Leo #gift']);
  });

  await check('both devices gathering the same line while apart make one mirror, not two', async () => {
    await sleep(800);
    await syncNow(phone);
    await syncNow(laptop);
    await atEnd(laptop, 'Scarf for Kim #gift');
    await syncNow(laptop);
    await syncNow(phone); // the phone's open page gathers it...
    await phone.waitForFunction(() => document.querySelectorAll('#outline-editor li.mirror').length === 3, null, { timeout: 5000 });
    await openPage(laptop, 'Gift'); // ...and so does the laptop's, before hearing from the phone
    await laptop.waitForFunction(() => document.querySelectorAll('#outline-editor li.mirror').length === 3, null, { timeout: 5000 });
    await sleep(800);
    await syncNow(phone);
    await syncNow(laptop);
    await syncNow(phone);
    await sleep(500);
    for (const p of [laptop, phone]) {
      const texts = await mirrorTexts(p);
      assert.equal(texts.filter((t) => t.startsWith('Scarf for Kim')).length, 1, texts.join(' | '));
    }
    const rows = [...table.values()].filter((r) => r.kind === 'line' && !r.deleted && r.fields?.mirror && r.text.startsWith('Scarf for Kim'));
    assert.equal(rows.length, 1);
    assert.ok(rows.every((r) => r.tags.length === 0));
  });

  await check('sorting on one device and deleting a mirror on the other both stick', async () => {
    // Laptop: move Scarf up to the top of the list. Phone: delete Book's mirror.
    await laptop.evaluate(() => {
      const ed = window.__outline;
      ed.state.doc.descendants((n, pos) => { if (n.type.name === 'paragraph' && n.textContent.startsWith('Scarf for Kim')) { ed.commands.setTextSelection(pos + 1); return false; } });
      ed.commands.focus();
    });
    await laptop.keyboard.press('Alt+Shift+ArrowUp');
    await sleep(100);
    await laptop.keyboard.press('Alt+Shift+ArrowUp');
    await sleep(800);
    await phone.evaluate(() => {
      const ed = window.__outline;
      ed.state.doc.descendants((n, pos) => {
        if (n.type.name === 'listItem' && n.firstChild.textContent.startsWith('Book for Leo')) { ed.view.dispatch(ed.state.tr.delete(pos, pos + n.nodeSize)); return false; }
      });
    });
    await sleep(800);
    await syncNow(laptop);
    await syncNow(phone);
    await syncNow(laptop);
    await sleep(600);
    for (const p of [laptop, phone]) {
      const texts = await mirrorTexts(p);
      assert.deepEqual(texts, ['Scarf for Kim #gift', 'Tall Candle (vanilla) for Ana #gift'], texts.join(' | '));
    }
    assert.ok([...table.values()].some((r) => !r.deleted && r.text === 'Book for Leo #gift' && !r.fields?.mirror), 'the original Book line is still there');
  });


  // A new device (or a reinstall) makes no starter novel of its own until the
  // cloud says the account is empty, so it can't end up with a second one.
  const newcomer = async (signedIn, remoteFn = '__remote') => {
    const ctx = await browser.newContext();
    if (remoteFn !== '__remote') await ctx.exposeFunction(remoteFn, (op, arg) => (op === 'push' ? arg.map((r) => ({ id: r.id, updated_at: new Date().toISOString() })) : []));
    else await ctx.exposeFunction('__remote', remote);
    await ctx.addInitScript(([on, fn]) => {
      let tell = null;
      let user = on ? { id: 'u1' } : null;
      window.__signIn = () => { user = { id: 'u1' }; tell?.(user); };
      window.__syncBackend = {
        user: async () => user, onAuth(f) { tell = f; }, signIn() {}, signOut() {},
        push: (rows) => window[fn]('push', rows), pull: (since, from) => window[fn]('pull', { since, from }),
        subscribe() {}, unsubscribe() {}
      };
    }, [signedIn, remoteFn]);
    const p = await ctx.newPage();
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(e.message));
    await p.goto(URL);
    return { p, ctx };
  };
  const projectsOn = (p) => p.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('writing');
    r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result.filter((e) => (e.kind === 'project' || e.kind === 'world') && !e.deleted).map((e) => e.title)); };
  }));

  await check('a fresh device signed out makes no starter novel and opens on today', async () => {
    const starters = () => [...table.values()].filter((r) => r.kind === 'project' && !r.deleted && r.title === 'Untitled novel').length;
    const before = starters();
    const { p, ctx } = await newcomer(false);
    await p.waitForSelector('main.notebook #outline-editor .ProseMirror', { state: 'visible' });
    assert.equal(await p.evaluate(() => document.documentElement.dataset.view), 'notebook');
    assert.deepEqual(await projectsOn(p), []);
    // Signing in brings the account's own book down, and still no starter.
    await p.evaluate(() => window.__signIn());
    await p.waitForFunction(() => document.querySelector('#sync').dataset.state === 'synced');
    await sleep(800);
    assert.equal(starters(), before, 'no second starter in the cloud');
    const local = await projectsOn(p);
    assert.equal(local.filter((t) => t === 'Untitled novel').length, before * 2, local.join(', '));
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });

  await check('a fresh device signed in to an account with writing never makes a starter', async () => {
    const worlds = () => [...table.values()].filter((r) => (r.kind === 'world' || r.kind === 'project') && !r.deleted).length;
    const was = worlds();
    const { p, ctx } = await newcomer(true);
    await p.waitForSelector('#editor .ProseMirror', { state: 'visible' });
    await p.waitForFunction(() => document.querySelector('#sync').dataset.state === 'synced');
    await sleep(800);
    assert.equal(worlds(), was, 'nothing new in the cloud');
    // It opens straight in the account's own book.
    assert.match(await p.locator('#editor .ProseMirror').innerText(), /laptop/i);
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });

  await check('signing in to an empty account makes the one starter novel then', async () => {
    const { p, ctx } = await newcomer(false, '__empty');
    await p.waitForSelector('main.notebook #outline-editor .ProseMirror', { state: 'visible' });
    assert.deepEqual(await projectsOn(p), []);
    await p.evaluate(() => window.__signIn());
    await p.waitForFunction(() => document.querySelector('#sync').dataset.state === 'synced');
    await p.waitForFunction(() => document.querySelector('#outline-tree')?.textContent.includes('Untitled novel'), null, { timeout: 5000 });
    const titles = await projectsOn(p);
    assert.equal(titles.filter((t) => t === 'Untitled novel').length, 2, titles.join(', ')); // its world and its piece
    // Opened on today, it stays there.
    assert.equal(await p.evaluate(() => document.documentElement.dataset.view), 'notebook');
    assert.deepEqual(p.errors, []);
    await ctx.close();
  });

  await check('two new devices on an empty account at the same moment end up with one starter novel', async () => {
    // Their own empty cloud; both pull before either has pushed.
    const cloud = new Map();
    let tick = Date.parse('2026-11-01T00:00:00Z');
    let pulls = 0;
    const own = async (op, arg) => {
      if (op === 'pull') pulls += 1;
      // Hold the first pushes until both devices have looked.
      if (op === 'push') for (let i = 0; i < 100 && pulls < 2; i += 1) await sleep(50);
      if (op === 'push') { const at = new Date((tick += 1000)).toISOString(); return arg.map((r) => { cloud.set(r.id, { ...r, user_id: 'u1', updated_at: at }); return { id: r.id, updated_at: at }; }); }
      if (op === 'pull') return [...cloud.values()].filter((r) => r.updated_at > arg.since).sort((x, y) => (x.updated_at < y.updated_at ? -1 : x.updated_at > y.updated_at ? 1 : x.id < y.id ? -1 : 1)).slice(arg.from, arg.from + 500);
      return null;
    };
    const twin = async () => {
      const ctx = await browser.newContext();
      await ctx.exposeFunction('__twin', own);
      await ctx.addInitScript(() => {
        window.__syncBackend = {
          user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
          push: (rows) => window.__twin('push', rows), pull: (since, from) => window.__twin('pull', { since, from }),
          subscribe() {}, unsubscribe() {}
        };
      });
      const p = await ctx.newPage();
      p.errors = [];
      p.on('pageerror', (e) => p.errors.push(e.message));
      return { p, ctx };
    };
    const [one, two] = await Promise.all([twin(), twin()]);
    await Promise.all([one.p.goto(URL), two.p.goto(URL)]);
    for (const { p } of [one, two]) await p.waitForSelector('#outline-editor .ProseMirror', { state: 'attached' });
    for (let i = 0; i < 2; i += 1) for (const { p } of [one, two]) { await p.evaluate(() => window.__sync.run()); await sleep(300); }
    // One and the same starter, not two that then have to give way to each other.
    const made = [...cloud.values()].filter((r) => r.kind === 'project');
    assert.equal(made.length, 1, `cloud has ${made.length} starter books`);
    assert.equal(made[0].deleted, false);
    for (const { p } of [one, two]) {
      const titles = await projectsOn(p);
      assert.equal(titles.filter((t) => t === 'Untitled novel').length, 2, titles.join(', ')); // its world and its piece
      assert.deepEqual(p.errors, []);
    }
    await one.ctx.close();
    await two.ctx.close();
  });

  await check('changes that have waited days for the cloud are called out', async () => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      window.__syncBackend = { user: async () => null, onAuth() {}, signIn() {}, signOut() {}, push: async () => [], pull: async () => [], subscribe() {}, unsubscribe() {} };
    });
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.waitForSelector('#outline-editor .ProseMirror');
    await p.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('writing');
      r.onsuccess = () => {
        const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
        const old = Date.now() - 3 * 864e5;
        tx.objectStore('entries').put({ id: 'pa_old', kind: 'para', parent_id: 'x', sort: 1, text: 'Old', tags: [], links: [], created_at: old, updated_at: old });
        tx.objectStore('outbox').put({ id: 'pa_old' });
        tx.oncomplete = () => res();
      };
    }));
    await p.reload();
    await p.waitForFunction(() => /Not synced for 3 days/.test(document.querySelector('#sync').textContent), null, { timeout: 5000 });
    assert.match(await p.locator('#sync').textContent(), /Sign in/);
    await ctx.close();
  });

  await check('no page errors', async () => assert.deepEqual([...laptop.errors, ...phone.errors], []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
