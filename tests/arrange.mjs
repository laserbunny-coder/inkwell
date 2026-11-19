// Add, move and delete everywhere (Nov 19 2026): every list has a way to
// add (a line at the top), reorder (drag; hold on a phone; Alt + Shift +
// Up / Down), move (⋯ › Move to…) and delete (⋯, Ctrl + Shift + Backspace,
// to the Trash with Undo), on a computer and on a phone.
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';
import { serve } from './kit.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4311;
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
  row('area-filmmaking', 'area', null, 1, { title: 'Filmmaking' }),
  row('area-writing', 'area', null, 2, { title: 'Writing' }),
  row('area-work', 'area', null, 3, { title: 'Work' }),
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show' }, updated_at: now - 864e5 }),
  piece('pr_reel1', 'Reel 1: The Audition', 'Posted', 1, 'Reel'),
  piece('pr_reel2', 'Reel 2: Breakfast', 'Boarding', 2, 'Reel'),
  piece('pr_reel3', 'Reel 3: Rent Day', 'Writing', 3, 'Reel'),
  row('pg_kenji', 'page', 'wd_nb', 1, { title: 'Kenji' }),
  row('pg_mom', 'page', 'wd_nb', 2, { title: 'Mom' }),
  row('pg_bakery', 'page', 'wd_nb', 3, { title: 'The bakery' }),
  row('pg_gags', 'page', 'wd_nb', 4, { title: 'Running gags' }),
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


const titles = async (p, parent, kind = 'page') => (await all(p)).filter((r) => r.parent_id === parent && r.kind === kind && !r.fields?.trashed && !r.deleted).sort((a, b) => a.sort - b.sort).map((r) => r.title);
const stage = async (p, page, sub) => {
  await go(p, { view: 'stage', id: 'wd_nb', page, ...(sub ? { sub } : {}) });
  await p.waitForFunction(() => document.documentElement.dataset.view === 'stage' && document.querySelector('.st-body'));
  await sleep(500);
};
const menuPick = async (p, button, name) => { await button.click(); await p.waitForSelector('.pop-menu .pop-item'); await p.locator('.pop-menu .pop-item').filter({ hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) }).first().click(); };

try {
  const desk = await open({ width: 1440, height: 900 });

  await check('desktop: the Bible starts with “Add a bible page…”; Enter adds one and keeps the cursor', async () => {
    await stage(desk, 'shape', 'bible');
    const input = desk.locator('.st-addbox input');
    await input.fill('Grandpa');
    await input.press('Enter');
    await desk.waitForFunction(() => [...document.querySelectorAll('.st-bible .loose-title')].some((b) => b.textContent === 'Grandpa'));
    assert.equal(await desk.evaluate(() => !!document.activeElement?.closest('.st-addbox')), true);
    assert.deepEqual(await titles(desk, 'wd_nb'), ['Kenji', 'Mom', 'The bakery', 'Running gags', 'Grandpa']);
  });

  await check('desktop: drag a bible page to the top with the mouse', async () => {
    const from = await desk.locator('.st-bible li', { hasText: 'Grandpa' }).locator('.loose-title').boundingBox();
    const to = await desk.locator('.st-bible li', { hasText: 'Kenji' }).boundingBox();
    await desk.mouse.move(from.x + 20, from.y + from.height / 2);
    await desk.mouse.down();
    for (let k = 1; k <= 12; k += 1) { await desk.mouse.move(from.x + 20, from.y + from.height / 2 + ((to.y + 3 - from.y - from.height / 2) * k) / 12); await sleep(20); }
    await shot(desk, 'arrange-drag-desk');
    await desk.mouse.up();
    await desk.waitForFunction(() => document.querySelector('.st-bible .loose-title')?.textContent === 'Grandpa');
    await sleep(800);
    assert.deepEqual(await titles(desk, 'wd_nb'), ['Grandpa', 'Kenji', 'Mom', 'The bakery', 'Running gags']);
  });

  await check('desktop: Alt + Shift + Down moves the page you’re on, and keeps moving it', async () => {
    await desk.locator('.st-bible li', { hasText: 'Grandpa' }).locator('.loose-title').focus();
    await desk.keyboard.press('Alt+Shift+ArrowDown');
    await desk.waitForFunction(() => document.querySelectorAll('.st-bible .loose-title')[1]?.textContent === 'Grandpa');
    await desk.keyboard.press('Alt+Shift+ArrowDown');
    await desk.waitForFunction(() => document.querySelectorAll('.st-bible .loose-title')[2]?.textContent === 'Grandpa');
    assert.deepEqual(await titles(desk, 'wd_nb'), ['Kenji', 'Mom', 'Grandpa', 'The bakery', 'Running gags']);
  });

  await check('desktop: a page’s ⋯ has Move up, Move down, Move to the top, Move to and Move to Trash, with the keys', async () => {
    const more = desk.locator('.st-bible li', { hasText: 'The bakery' }).locator('.more-btn');
    await more.click();
    await desk.waitForSelector('.pop-menu .pop-item');
    const items = await desk.locator('.pop-menu .pop-item').allInnerTexts();
    for (const want of ['Move up', 'Move down', 'Move to the top', 'Move to', 'Move to Trash']) assert.ok(items.some((t) => t.startsWith(want)), `${want} in ${items.join(' | ')}`);
    assert.ok(items.some((t) => /Move up\s*Alt\+Shift\+↑/.test(t)), 'the keys are spelled out');
    await shot(desk, 'arrange-menu-desk');
    await desk.locator('.pop-menu .pop-item', { hasText: 'Move to the top' }).click();
    await desk.waitForFunction(() => document.querySelector('.st-bible .loose-title')?.textContent === 'The bakery');
  });

  await check('desktop: Ctrl + Shift + Backspace puts a page in the Trash, with Undo', async () => {
    await desk.locator('.st-bible li', { hasText: 'Grandpa' }).locator('.loose-title').focus();
    await desk.keyboard.press('Control+Shift+Backspace');
    await desk.waitForFunction(() => ![...document.querySelectorAll('.st-bible .loose-title')].some((b) => b.textContent === 'Grandpa'));
    assert.ok((await get(desk, (await all(desk)).find((r) => r.title === 'Grandpa').id)).fields.trashed);
    await desk.locator('.toast button', { hasText: 'Undo' }).first().click();
    await desk.waitForFunction(() => [...document.querySelectorAll('.st-bible .loose-title')].some((b) => b.textContent === 'Grandpa'));
  });

  await check('desktop: Pieces drag into order, and their ⋯ moves them up and down', async () => {
    await stage(desk, 'write');
    const order = () => desk.locator('.st-write .wo-piece .wo-item').allInnerTexts();
    assert.deepEqual(await order(), ['Reel 1: The Audition', 'Reel 2: Breakfast', 'Reel 3: Rent Day']);
    await menuPick(desk, desk.locator('.st-write .wo-piece', { hasText: 'Reel 3' }).locator('.more-btn'), 'Move up');
    await desk.waitForFunction(() => document.querySelectorAll('.st-write .wo-piece .wo-item')[1]?.textContent.startsWith('Reel 3'));
    assert.deepEqual(await titles(desk, 'wd_nb', 'project'), ['Reel 1: The Audition', 'Reel 3: Rent Day', 'Reel 2: Breakfast']);
  });

  await check('desktop: ideas go in your own order (kept on the project), newest still on top', async () => {
    await stage(desk, 'gather');
    for (const t of ['First idea', 'Second idea', 'Third idea']) {
      await desk.locator('.st-idea input').fill(t);
      await desk.locator('.st-idea input').press('Enter');
      await desk.waitForFunction((x) => [...document.querySelectorAll('.st-card .st-text')].some((e) => e.textContent.includes(x)), t);
    }
    const cards = () => desk.locator('.st-card .st-text').allInnerTexts();
    const [a, b] = (await cards()).map((t) => t.split(' The Ninja')[0]);
    await desk.locator('.st-card', { hasText: a }).locator('.st-from').focus();
    await desk.keyboard.press('Alt+Shift+ArrowDown');
    await desk.waitForFunction((x) => (document.querySelector('.st-card .st-text')?.textContent || '').startsWith(x), b);
    assert.ok((await get(desk, 'wd_nb')).fields.ideaOrder.length >= 2);
    await desk.locator('.st-idea input').fill('Fourth idea');
    await desk.locator('.st-idea input').press('Enter');
    await desk.waitForFunction(() => /Fourth idea/.test(document.querySelector('.st-card .st-text')?.textContent || ''));
  });

  await check('desktop: Kit adds a character right there, and ⋯ takes one out of the kit', async () => {
    await stage(desk, 'make', 'kit');
    await desk.locator('.st-kit-add button', { hasText: '+ Character' }).click();
    await desk.locator('.ask input').fill('Kenji’s rival');
    await desk.locator('.ask input').press('Enter');
    await desk.waitForFunction(() => [...document.querySelectorAll('.st-kit-name')].some((e) => e.textContent === 'Kenji’s rival'));
    const el = (await all(desk)).find((r) => r.title === 'Kenji’s rival');
    assert.equal(el.fields.element.type, 'character');
    await menuPick(desk, desk.locator('.st-kit li', { hasText: 'Kenji’s rival' }).locator('.more-btn'), 'Take it out of the kit (the page stays)');
    await desk.waitForFunction(() => ![...document.querySelectorAll('.st-kit-name')].some((e) => e.textContent === 'Kenji’s rival'));
    assert.equal((await get(desk, el.id)).fields.element, undefined);
  });

  await check('desktop: + Shoot day from the project picks the piece and opens its call sheet', async () => {
    await stage(desk, 'make', 'days');
    await desk.locator('.st-day-add').click();
    await desk.getByRole('menuitem', { name: 'Reel 2: Breakfast' }).click();
    await desk.waitForFunction(() => history.state?.view === 'production');
    assert.equal((await placeOf(desk)).id, 'pr_reel2');
    assert.ok((await all(desk)).some((r) => r.kind === 'shootday' && r.parent_id === 'pr_reel2'));
  });

  await check('desktop: Month has an Add line in every week; it lands loose in that week', async () => {
    await go(desk, { view: 'plan', tab: 'ahead' });
    await desk.waitForSelector('.mo-week .mo-add input');
    assert.equal(await desk.locator('.mo-week .mo-add').count(), 4);
    const second = desk.locator('.mo-week').nth(1).locator('.mo-add input');
    await second.fill('Book the bakery for the shoot');
    await second.press('Enter');
    await desk.waitForFunction(() => [...document.querySelectorAll('.mo-week')][1]?.textContent.includes('Book the bakery'));
    const t = (await all(desk)).find((r) => r.text === 'Book the bakery for the shoot').fields.task;
    assert.equal(t.span.kind, 'week');
    assert.equal(t.span.start, '2026-11-16');
    assert.equal(t.day, null);
  });

  await check('desktop: Year has an Add line in every month; it lands in that month', async () => {
    await go(desk, { view: 'plan', tab: 'year' });
    await desk.waitForSelector('.yr-month .yr-add input');
    const feb = desk.locator('.yr-month[data-month="2027-02"] .yr-add input');
    await feb.fill('Premiere the first season');
    await feb.press('Enter');
    await desk.waitForFunction(() => document.querySelector('.yr-month[data-month="2027-02"]')?.textContent.includes('Premiere the first season'));
    const t = (await all(desk)).find((r) => r.text === 'Premiere the first season').fields.task;
    assert.deepEqual([t.span.kind, t.span.start], ['month', '2027-02-01']);
    await shot(desk, 'arrange-year');
  });

  await check('desktop: an area’s ⋯ in the Library moves it down among the areas', async () => {
    await go(desk, { view: 'library' });
    await desk.waitForSelector('.zl-area .zl-area-more');
    await menuPick(desk, desk.locator('.zl-area', { has: desk.locator('.zl-h', { hasText: 'Filmmaking' }) }).locator('.zl-area-more'), 'Move down');
    await desk.waitForFunction(() => document.querySelector('.zl-area .zl-h')?.textContent.startsWith('Writing'));
    const areas = (await all(desk)).filter((r) => r.kind === 'area').sort((a, b) => a.sort - b.sort).map((r) => r.title);
    assert.deepEqual(areas.slice(0, 2), ['Writing', 'Filmmaking']);
  });

  await check('nothing went wrong on the computer', async () => { assert.deepEqual(desk.errors, []); });
  await desk.context().close();

  const phone = await open({ width: 412, height: 915 }, { hasTouch: true, isMobile: true });
  const cdp = await phone.context().newCDPSession(phone);
  const centre = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  const holdDrag = async (from, to) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    await sleep(550);
    for (let k = 1; k <= 12; k += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + ((to.y - from.y) * k) / 12 }] }); await sleep(25); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
  };

  await check('phone: on the home, ▸ Bible starts with Add a page and each page has ⋯', async () => {
    await home(phone);
    await phone.locator('#wh-outline [data-part="bible"] .wo-tog').tap();
    await phone.waitForSelector('#wh-outline [data-part="bible"] .wo-add-page input');
    assert.equal(await phone.locator('#wh-outline [data-part="bible"] .wo-page .more-btn').count(), 4);
    await shot(phone, 'arrange-home-phone');
  });

  await check('phone: hold a bible page and slide it to the top', async () => {
    const from = await centre(phone.locator('#wh-outline .wo-page', { hasText: 'Running gags' }).locator('.wo-item'));
    const to = await centre(phone.locator('#wh-outline .wo-page', { hasText: 'Kenji' }));
    await holdDrag(from, { x: from.x, y: to.b.y + 2 });
    await phone.waitForFunction(() => document.querySelector('#wh-outline .wo-page .wo-item')?.textContent === 'Running gags');
    assert.deepEqual(await titles(phone, 'wd_nb'), ['Running gags', 'Kenji', 'Mom', 'The bakery']);
  });

  await check('phone: an idea’s ⋯ on the home deletes it, with Undo', async () => {
    await phone.locator('#wh-outline [data-part="ideas"] .wo-tog').tap();
    const input = phone.locator('#wh-outline [data-part="ideas"] .wo-idea input');
    await input.fill('A ninja who is afraid of flour');
    await input.press('Enter');
    await phone.waitForFunction(() => [...document.querySelectorAll('#wh-outline [data-part="ideas"] .wo-item')].some((e) => /flour/.test(e.textContent)));
    await phone.evaluate(() => document.activeElement?.blur());
    await sleep(400);
    await phone.locator('#wh-outline [data-part="ideas"] li', { hasText: 'flour' }).locator('.more-btn').tap();
    await phone.waitForSelector('.pop-menu .pop-item');
    await shot(phone, 'arrange-idea-menu-phone');
    await phone.locator('.pop-menu .pop-item', { hasText: 'Delete' }).tap();
    await phone.waitForFunction(() => ![...document.querySelectorAll('#wh-outline [data-part="ideas"] .wo-item')].some((e) => /flour/.test(e.textContent)));
    const line = (await all(phone)).find((r) => /flour/.test(r.text || ''));
    assert.ok(line.fields.trashed);
    assert.match(await phone.locator('.toast').last().innerText(), /afraid of flour/);
  });

  await check('nothing went wrong on the phone', async () => { assert.deepEqual(phone.errors, []); });
  await phone.context().close();
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
