// A project's home as one outline (Nov 2026): the top block (Continue,
// Next step, Needs you), then Ideas, Bible, Pieces, Make, Deliver and About
// as lines. ▸ opens a line in place, its name zooms in (‹ back), Alt + 0 to
// 5 and Alt + G (Go to…) on a computer, the search button on a phone. The
// page strip is gone for projects, so a phone reaches everything.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4297;
const server = await serve(PORT);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

// Monday Nov 9 2026, 2:04 pm in Los Angeles.
const NOW = '2026-11-09T14:04:00-08:00';
const now = Date.parse(NOW);
const T = (s) => new Date(`${s}-08:00`).toISOString();
const NB = 'https://claude.ai/code/project/chan_nb';
const INK = 'https://claude.ai/code/project/chan_ink';

const db = {
  needs: [
    { id: 'n1', kind: 'decision', title: 'Pick Kenji’s final character sheet', project: 'The Ninja Bunch', link: `${NB}?thread=sheet`, project_link: NB, created_at: T('2026-11-08T10:09:00'), body: 'Guide: https://claude.ai/artifact/kenjiSheets' },
    { id: 'n2', kind: 'review', title: 'Try the AI production tools on Reel 4', project: 'The Ninja Bunch', link: `${NB}?thread=tools`, project_link: NB, created_at: T('2026-11-03T22:53:00'), body: '' },
    { id: 'n4', kind: 'review', title: 'Try opening two things side by side', project: 'Inkwell', link: `${INK}?thread=panes`, project_link: INK, created_at: T('2026-11-05T03:43:00'), body: '' },
  ],
  updates: [
    { id: 'u1', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=woven`, thread: 'Rethink the screenplay', text: 'Scripts moved to Woven: no slug lines, scene titles on the line', place: null, state: 'live', created_at: T('2026-11-05T16:00:00') },
    { id: 'u2', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=stills`, thread: 'Overnight stills', text: 'Reel 4: six stills generated overnight, named by shot code', place: null, state: 'done', created_at: T('2026-11-09T06:40:00') },
    { id: 'u3', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=prompts`, thread: 'Draft Reel 3 prompts', text: 'Reel 3 prompts are half drafted', place: null, state: 'working', created_at: T('2026-11-09T13:52:00') },
    { id: 'u4', project: 'Inkwell', project_link: INK, link: `${INK}?thread=redesign`, thread: 'Redesign Inkwell from the ground up', text: 'The new frame is live: rail, switch, five looks', place: null, state: 'live', created_at: T('2026-11-09T09:30:00') },
    // Too long ago for the page: only History has it.
    { id: 'u0', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=old`, thread: 'First look', text: 'First character sheets drawn', place: null, state: 'done', created_at: T('2026-08-01T09:00:00') },
  ],
};
const calls = [];

const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * 864e5, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const piece = (id, title, stage, sort, label, extra = {}) => row(id, 'project', 'wd_nb', sort, { title, fields: { type: 'screenplay', stage, label, ...extra.fields }, updated_at: extra.updated_at || now - 3 * 864e5 });
const task = (id, parent, sort, text, t = {}, done = false) => row(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done, box: true, task: { v: 1, day: null, est: null, done_at: done ? now - 864e5 : null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show', logline: 'A family bakery raises a troupe of hopeless ninjas. An anime mockumentary musical, told in reels first.' }, updated_at: now - 864e5 }),
  piece('pr_gag', 'Pancake on the head', 'New idea', 1, 'Gag'),
  piece('pr_ep2', 'Episode 2: Rent Day', 'New idea', 2, 'Episode'),
  piece('pr_ep1', 'Episode 1: The Audition', 'Writing', 3, 'Episode'),
  piece('pr_reel3', 'Reel 3: Rent Day', 'Writing', 4, 'Reel'),
  piece('pr_reel2', 'Reel 2: Breakfast', 'Boarding', 5, 'Reel', { updated_at: now - 2 * 36e5 }),
  row('ac_2', 'act', 'pr_reel2', 1, { title: 'Screenplay' }),
  row('ch_2', 'chapter', 'ac_2', 1, { title: 'Script', fields: { words: 142 } }),
  row('pb_1', 'para', 'ch_2', 1024, { text: 'Mom flips pancakes with a katana.', content: [{ type: 'text', text: 'Mom flips pancakes with a katana.' }], fields: { el: 'action' } }),
  row('pg_shots', 'page', 'pr_reel2', 1, { title: 'Shot list' }),
  piece('pr_reel4', 'Reel 4: The Rolling Pin', 'Generating', 6, 'Reel'),
  piece('pr_reel1', 'Reel 1: The Audition', 'Posted', 7, 'Reel'),
  row('sd_1', 'shootday', 'pr_reel2', 9, { fields: { date: '2026-12-14', call: '07:30', place: 'Echo Park', scenes: [], notes: '' } }),
  row('pg_chars', 'page', 'wd_nb', 1024, { title: 'Characters' }),
  // Its steps: three on its own Steps page, one written on a piece's page.
  row('steps-wd_nb', 'page', 'wd_nb', 2048, { title: 'Steps' }),
  task('st_1', 'steps-wd_nb', 1024, 'Board Reel 2', { day: '2026-11-12', est: 90 }),
  task('st_2', 'steps-wd_nb', 2048, 'Write Kenji’s second verse'),
  task('st_3', 'steps-wd_nb', 3072, 'Pick the bakery’s colours', {}, true),
  task('st_4', 'pg_shots', 1024, 'Star the stills for shot 3', { day: '2026-11-10', est: 15 }),
  // A task somewhere else is none of this project's business.
  row('page-tasks', 'page', null, 0, { title: 'Tasks' }),
  task('st_x', 'page-tasks', 1024, 'Order the storage drive', { day: '2026-11-09' }),
  // A life project nobody has touched in months.
  row('wd_camp', 'world', null, 2, { title: 'Camping', area_id: 'area-personal', fields: { life: true, star: 'Two trips with Arrow next season.' }, created_at: now - 200 * 864e5, updated_at: now - 90 * 864e5 }),
  row('pg_gear', 'page', 'wd_camp', 1024, { title: 'Gear list', created_at: now - 200 * 864e5, updated_at: now - 90 * 864e5 }),
];
const seed = (rows) => new Promise((res, rej) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => {
    const tx = r.result.transaction(['entries', 'outbox'], 'readwrite');
    for (const x of rows) { tx.objectStore('entries').put(x); tx.objectStore('outbox').put({ id: x.id }); }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  };
});

const browser = withoutSync(await chromium.launch());
async function open(viewport, extra = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  await ctx.exposeFunction('__db', (op, a) => (op === 'desk' ? { needs: db.needs.map((n) => ({ ...n })), updates: db.updates.filter((u) => u.created_at >= a).map((u) => ({ ...u })) } : op === 'all' ? { needs: db.needs, updates: db.updates } : null));
  await ctx.addInitScript(() => { window.__desk = { desk: (s) => window.__db('desk', s), deskAll: () => window.__db('all'), doneNeed: () => null, laterNeed: () => null }; });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  await page.evaluate(seed, SEED);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.started === '1');
  return page;
}
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const get = async (p, id) => (await all(p)).find((r) => r.id === id);
const go = (p, place) => p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
const viewOf = (p) => p.evaluate(() => document.documentElement.dataset.view || 'write');
const placeOf = (p) => p.evaluate(() => history.state);
const home = async (p, id = 'wd_nb') => {
  await go(p, { view: 'world', id });
  await p.waitForFunction(() => document.documentElement.dataset.view === 'world' && document.querySelector('#wh-outline [data-part]:not(#wh-about)'));
  await sleep(500);
};
const parts = (p) => p.locator('#wh-outline > li.wo-line > .wo-row > .wo-name:visible').allInnerTexts();
const shot = async (p, name) => { if (SHOTS) { await sleep(200); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}

try {
  const phone = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true });
  await home(phone);

  await check('phone: the home is one outline in idea-to-posted order, no strip, nothing sideways', async () => {
    assert.deepEqual(await parts(phone), ['Ideas', 'Bible', 'Pieces', 'Make', 'Deliver', 'About']);
    assert.equal(await phone.locator('#page-tabs').isVisible(), false, 'no page strip in a project');
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(wide <= 0, `the page scrolls sideways by ${wide}px`);
    for (const name of ['Ideas', 'Bible', 'Pieces', 'Make', 'Deliver', 'About']) {
      const box = await phone.locator('#wh-outline .wo-name', { hasText: name }).first().boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 412, `${name} is on screen`);
    }
    assert.match(await phone.locator('#wh-outline [data-part="pieces"] .wo-meta').innerText(), /2 new idea · 2 writing · 1 boarding/);
    await shot(phone, 'outline-phone');
  });

  await check('phone: the top block says where to carry on, the next step and what needs you', async () => {
    assert.match(await phone.locator('#wh-continue').innerText(), /Reel 2: Breakfast/);
    assert.match(await phone.locator('#wh-next-step').innerText(), /Star the stills for shot 3[\s\S]*all 3 ›/);
    assert.match(await phone.locator('#wh-calls').innerText(), /Needs you[\s\S]*Pick Kenji’s final character sheet[\s\S]*all 2 ›/i);
    assert.equal(await phone.locator('#wh-calls .dk-call:visible').count(), 1, 'only the first call until “all 2”');
  });

  await check('phone: a bible page is two taps from the home (▸ Bible, then the page)', async () => {
    await phone.locator('#wh-outline [data-part="bible"] .wo-tog').tap();
    await phone.waitForSelector('#wh-outline [data-part="bible"] .wo-kids');
    await phone.locator('#wh-outline [data-part="bible"] .wo-item', { hasText: 'Characters' }).tap();
    await phone.waitForFunction(() => history.state?.view === 'notebook');
    assert.equal((await placeOf(phone)).pageId, 'pg_chars');
  });

  await check('what’s open is remembered for the project, on this device', async () => {
    await home(phone);
    assert.equal(await phone.locator('#wh-outline [data-part="bible"] .wo-tog').getAttribute('aria-expanded'), 'true');
    assert.equal(await phone.locator('#wh-outline [data-part="pieces"] .wo-tog').getAttribute('aria-expanded'), 'false');
    await phone.locator('#wh-outline [data-part="bible"] .wo-tog').tap();
    await sleep(400);
    assert.equal(await phone.locator('#wh-outline [data-part="bible"] .wo-kids').count(), 0);
  });

  await check('phone: Pieces opens in place with each stage as dots, and → moves one on', async () => {
    await phone.locator('#wh-outline [data-part="pieces"] .wo-tog').tap();
    const reel4 = phone.locator('#wh-outline .wo-piece', { hasText: 'Reel 4: The Rolling Pin' });
    await reel4.waitFor();
    assert.equal(await reel4.locator('.wo-dots i.on').count(), 4);
    await reel4.locator('.wo-next').tap();
    await phone.waitForFunction(async () => true);
    await sleep(600);
    assert.equal((await get(phone, 'pr_reel4')).fields.stage, 'Editing');
  });

  await check('phone: the search button in a project is Go to… for that project', async () => {
    await phone.locator('.zm-go').tap();
    await phone.waitForSelector('.gt-bg:not([hidden])');
    await phone.waitForFunction(() => /The Ninja Bunch/.test(document.querySelector('.gt-q')?.placeholder || ''));
    await phone.locator('.gt-q').fill('charac');
    assert.equal(await phone.locator('.gt-hit').first().locator('.gt-name').innerText(), 'Characters');
    await shot(phone, 'goto-phone');
    await phone.locator('.gt-hit').first().tap();
    await phone.waitForFunction(() => history.state?.pageId === 'pg_chars');
    assert.equal(await phone.locator('.gt-bg').isVisible(), false);
  });

  await check('a piece on a phone: ‹ its project and Outline · Write · Grid, all in reach', async () => {
    await go(phone, { view: 'project', id: 'pr_reel2' });
    await phone.waitForSelector('#piece-back:not([hidden])');
    assert.ok(await phone.locator('#page-tabs').isHidden(), 'no row of tabs in a piece (One home)');
    for (const t of [phone.locator('#piece-back'), ...(await phone.locator('.pv-seg button').all())]) {
      const b = await t.boundingBox();
      assert.ok(b.x >= 0 && b.x + b.width <= 412, `${await t.innerText()} is in reach`);
    }
  });

  await check('phone: Add an idea puts a line on today’s page that links to the project', async () => {
    await home(phone);
    await phone.locator('#wh-outline [data-part="ideas"] .wo-tog').tap();
    const input = phone.locator('#wh-outline .wo-idea input');
    await input.fill('Grandpa’s nunchucks are breadsticks');
    await input.press('Enter');
    await phone.waitForFunction(() => document.querySelector('#wh-outline [data-part="ideas"] .wo-count')?.textContent === '1');
    const line = (await all(phone)).find((r) => r.kind === 'line' && /nunchucks/.test(r.text || ''));
    assert.equal(line.parent_id, 'day-2026-11-09');
    assert.ok(line.links.includes('wd_nb'));
  });

  await check('a life project’s home: the top block, Ideas and Notes', async () => {
    await home(phone, 'wd_camp');
    assert.deepEqual(await parts(phone), ['Ideas', 'Notes', 'About']);
  });
  await phone.context().close();

  const desk = await open({ width: 1440, height: 900 });
  await home(desk);

  await check('desktop: a name zooms in (its plain name, ‹ back), Alt + Left comes back out', async () => {
    await desk.locator('#wh-outline [data-part="pieces"] .wo-name').click();
    await desk.waitForFunction(() => document.documentElement.dataset.view === 'stage' && document.querySelector('.st-title')?.textContent === 'Pieces');
    assert.equal(await desk.locator('.st-back').innerText(), '‹ The Ninja Bunch');
    await desk.waitForSelector('.st-write .wo-piece');
    assert.equal(await desk.locator('.st-write .wo-piece').count(), 7);
    await desk.keyboard.press('Alt+ArrowLeft');
    await desk.waitForFunction(() => document.documentElement.dataset.view === 'world');
  });

  await check('desktop: Alt + 1 to 5 zoom into Ideas, Bible, Pieces, Make, Deliver; Alt + 0 is home', async () => {
    const seen = [];
    for (const n of [1, 2, 3, 4, 5]) {
      await desk.keyboard.press(`Alt+${n}`);
      await sleep(500);
      seen.push(await desk.locator('.st-title').innerText());
    }
    assert.deepEqual(seen, ['Ideas', 'Bible', 'Pieces', 'Make', 'Deliver']);
    await desk.keyboard.press('Alt+0');
    await desk.waitForFunction(() => document.documentElement.dataset.view === 'world');
  });

  await check('the ruler’s Project stop, from inside a part, is the project’s home', async () => {
    await desk.keyboard.press('Alt+2');
    await desk.waitForFunction(() => document.documentElement.dataset.view === 'stage');
    await desk.locator('.zm-stop[data-stop="project"]').click();
    await desk.waitForFunction(() => document.documentElement.dataset.view === 'world');
    assert.equal((await placeOf(desk)).id, 'wd_nb');
  });

  await check('Steps: “all 3 ›” zooms into every step; ticking the next step ticks it', async () => {
    await desk.locator('#wh-next-row .wt-all').click();
    await desk.waitForFunction(() => history.state?.part === 'steps' && !document.querySelector('#wh-zoom-title').hidden);
    assert.equal(await desk.locator('#wh-zoom-title').innerText(), 'Steps');
    assert.equal(await desk.locator('#wh-steps .pl-task:not(.done)').count(), 3);
    assert.equal(await desk.locator('#wh-outline').isVisible(), false);
    await desk.locator('#wh-back').click();
    await desk.waitForFunction(() => document.documentElement.dataset.view === 'world' && !history.state?.part);
    await desk.locator('#wh-next-row .wt-tick').click();
    await sleep(800);
    assert.equal((await get(desk, 'st_4')).fields.done, true);
    assert.match(await desk.locator('#wh-next-step').innerText(), /Board Reel 2/);
  });

  await check('desktop: Alt + G goes to anything in the project by name; Esc closes', async () => {
    await desk.keyboard.press('Alt+g');
    await desk.waitForSelector('.gt-bg:not([hidden])');
    await desk.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await desk.locator('.gt-bg').isVisible(), false);
    assert.equal(await viewOf(desk), 'world', 'Esc only closed Go to');
    await desk.keyboard.press('Alt+g');
    await desk.keyboard.type('breakf');
    await shot(desk, 'goto-desk');
    await desk.keyboard.press('Enter');
    // A script opens on its text (One home): there is no Overview to land on.
    await desk.waitForFunction(() => history.state?.view === 'write');
    assert.equal(await desk.evaluate(() => window.__editor.getText().length > 0), true);
  });

  await check('desktop: zoomed into Ideas, Add an idea is at the top; ⋯ Delete puts it in the Trash with Undo', async () => {
    await home(desk);
    await desk.keyboard.press('Alt+1');
    await desk.waitForFunction(() => document.querySelector('.st-title')?.textContent === 'Ideas');
    const input = desk.locator('.st-idea input');
    await input.fill('Mom’s katana is a spatula');
    await input.press('Enter');
    await desk.waitForFunction(() => [...document.querySelectorAll('.st-card .st-text')].some((t) => /spatula/.test(t.textContent)));
    assert.equal(await desk.evaluate(() => document.activeElement?.closest('.st-idea') !== null), true, 'the box keeps the cursor for the next one');
    await shot(desk, 'ideas-add');
    const card = desk.locator('.st-card', { hasText: 'spatula' });
    await card.locator('.st-acts button').last().click();
    await desk.getByRole('menuitem', { name: 'Delete' }).click();
    await desk.waitForFunction(() => ![...document.querySelectorAll('.st-card .st-text')].some((t) => /spatula/.test(t.textContent)));
    const gone = (await all(desk)).find((r) => r.kind === 'line' && /spatula/.test(r.text || ''));
    assert.ok(gone.fields.trashed, 'in the Trash, not deleted');
    await desk.locator('.toast button', { hasText: 'Undo' }).first().click();
    await desk.waitForFunction(() => [...document.querySelectorAll('.st-card .st-text')].some((t) => /spatula/.test(t.textContent)));
    await desk.keyboard.press('Alt+0');
    await desk.waitForFunction(() => document.documentElement.dataset.view === 'world');
  });

  await check('the old words still find the parts in Go (Ctrl + K)', async () => {
    await home(desk);
    await desk.keyboard.press('Control+k');
    await desk.waitForSelector('#palette-input');
    await desk.keyboard.type('shape');
    await sleep(300);
    assert.match(await desk.locator('.palette').innerText(), /Bible/);
    await desk.keyboard.press('Escape');
  });

  await check('nothing went wrong in the page', async () => { assert.deepEqual(desk.errors, []); });
  await desk.context().close();
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
