// The zoom, Part 4 (Nov 2026): Project, Desk and Library, and the seats.
// The Desk shows the projects on stage with their next two steps, one folded
// line for what needs you and who is working, and a quiet "In the wings"
// row. A project's seat (on stage, in the wings, backstage, finished) is set
// on a bar right above the ruler: carry the project onto a seat, right-click
// it, click its seat word, or Alt + S then 1 to 4. The Library lists On stage
// first, every area with each project's seat word, the Finished shelf and
// "Also here". A project's Overview has one thin stage line; a life project
// says so beside its name, and that is the switch. A piece shows its stage
// as dots; Shift + Left and Right step to the next piece or project.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4237;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;

const NOW = '2026-11-17T10:00:00-08:00';
const now = Date.parse(NOW);
const T = (s) => new Date(`${s}-08:00`).toISOString();
const NB = 'https://claude.ai/code/project/chan_nb';
const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 40 * 864e5, updated_at: now - 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, parent, sort, text, t = {}) => row(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done: false, box: true, task: { v: 1, day: null, est: null, done_at: null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show' }, updated_at: now - 6e4 }),
  row('steps-wd_nb', 'page', 'wd_nb', 2048, { title: 'Steps' }),
  task('st_nb1', 'steps-wd_nb', 1024, 'Board Reel 2', { day: '2026-11-17' }),
  task('st_nb2', 'steps-wd_nb', 2048, 'Pick the voice for Kenji'),
  task('st_nb3', 'steps-wd_nb', 3072, 'Cut the teaser'),
  row('pr_r1', 'project', 'wd_nb', 1, { title: 'Reel 1: Rooftop', fields: { type: 'screenplay', label: 'Reel' } }),
  row('pr_r2', 'project', 'wd_nb', 2, { title: 'Reel 2: Breakfast', fields: { type: 'screenplay', label: 'Reel' } }),
  row('wd_nas', 'world', null, 2, { title: 'NAS', area_id: 'area-personal', fields: { life: true }, updated_at: now - 2 * 864e5 }),
  row('steps-wd_nas', 'page', 'wd_nas', 2048, { title: 'Steps' }),
  task('st_nas', 'steps-wd_nas', 1024, 'Label the drives'),
  row('wd_tb', 'world', null, 3, { title: 'Two Blood', area_id: 'area-filmmaking', fields: {}, updated_at: now - 20 * 864e5 }),
  row('wd_old', 'world', null, 4, { title: 'Old Short', area_id: 'area-filmmaking', fields: { finished: now - 5 * 864e5 }, updated_at: now - 30 * 864e5 }),
  row('settings-desk', 'settings', null, 0, { title: 'Desk', fields: { stage: { 'w:wd_nb': 'on', 'w:wd_nas': 'on', 'w:wd_tb': 'wings' } } })
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
const all = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('writing');
  r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
}));
const get = async (p, id) => (await all(p)).find((r) => r.id === id);
const stageOf = async (p, id) => (await get(p, 'settings-desk'))?.fields?.stage?.[`w:${id}`] || null;

const browser = withoutSync(await chromium.launch());
const errors = [];
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message}`); if (process.env.STACK) console.log(e.stack); }
}
async function open(opts) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', ...opts });
  await ctx.addInitScript(([nb, t1, t2]) => {
    window.__desk = {
      desk: async () => ({
        needs: [{ id: 'n1', kind: 'decision', title: 'Pick Kenji’s final sheet', project: 'The Ninja Bunch', link: `${nb}?thread=sheet`, project_link: nb, created_at: t1, body: '' }],
        updates: [{ id: 'u1', project: 'The Ninja Bunch', project_link: nb, link: `${nb}?thread=prompts`, thread: 'Draft Reel 3 prompts', text: 'Half drafted', place: null, state: 'working', created_at: t2 }]
      }),
      deskAll: async () => ({ needs: [], updates: [] }), doneNeed: async () => null, laterNeed: async () => null
    };
  }, [NB, T('2026-11-17T08:00:00'), T('2026-11-17T09:30:00')]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.setFixedTime(new Date(NOW));
  await p.goto(URL);
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await p.evaluate(seed, SEED);
  await p.reload();
  await p.waitForFunction(() => document.documentElement.dataset.started === '1');
  await sleep(600);
  return p;
}
const blur = (p) => p.evaluate(() => document.activeElement?.blur());
const stop = async (p, s) => { await blur(p); await p.locator(`.zm-stop[data-stop="${s}"]`).click(); await sleep(1000); };

try {
  const p = await open({ viewport: { width: 1280, height: 800 } });

  await check('Desk: the projects on stage, each with its next two steps', async () => {
    await stop(p, 'desk');
    await p.waitForSelector('.zd-proj');
    const names = await p.locator('.zd-proj .zd-name').allInnerTexts();
    assert.ok(names.includes('The Ninja Bunch') && names.includes('NAS'), names.join(', '));
    const nb = p.locator('.zd-proj[data-pid="wd_nb"]');
    assert.deepEqual(await nb.locator('.zd-step-t').allInnerTexts(), ['Board Reel 2', 'Pick the voice for Kenji']);
    assert.equal(await nb.locator('.zd-more').count(), 1, 'and more on its Steps');
  });

  await check('Desk: one folded line for what needs you and who is working; it opens in place', async () => {
    await p.waitForSelector('.zd-crewline');
    assert.match(await p.locator('.zd-crewline').innerText(), /1 needs you · 1 thread working/);
    assert.equal(await p.locator('.zd-crew-in').count(), 0, 'folded');
    await p.locator('.zd-crewline').click();
    await p.waitForSelector('.zd-crew-in');
    assert.match(await p.locator('.zd-crew-in').innerText(), /Pick Kenji’s final sheet/);
    assert.match(await p.locator('.zd-crew-in').innerText(), /Draft Reel 3 prompts/);
    await p.locator('.zd-crewline').click();
    await p.waitForFunction(() => !document.querySelector('.zd-crew-in'));
  });

  await check('Desk: In the wings is one quiet row', async () => {
    assert.deepEqual(await p.locator('.zd-wings .zd-chip').allInnerTexts(), ['Two Blood']);
  });

  await check('a step on the Desk opens as its own page', async () => {
    await p.locator('.zd-step', { hasText: 'Board Reel 2' }).click();
    await p.waitForFunction(() => /Board Reel 2/.test(document.querySelector('.np-tx')?.textContent || ''));
    await stop(p, 'desk');
  });

  await check('right-click a project: the seat bar; In the wings moves it, with Undo', async () => {
    await p.locator('.zd-proj[data-pid="wd_nas"] .zd-ph').click({ button: 'right' });
    await p.waitForSelector('.zm-seatbar:not([hidden])');
    assert.deepEqual(await p.locator('.zm-seatbar .zm-sb[data-seat]').allInnerTexts(), ['On stage', 'In the wings', 'Backstage', 'Finished']);
    assert.equal(await p.locator('.zm-seatbar [aria-current]').getAttribute('data-seat'), 'on');
    await p.locator('.zm-seatbar [data-seat="wings"]').click();
    await p.waitForFunction(() => [...document.querySelectorAll('.zd-wings .zd-chip')].some((c) => c.textContent === 'NAS'));
    assert.equal(await stageOf(p, 'wd_nas'), 'wings');
    await p.locator('.toast button', { hasText: 'Undo' }).click();
    await p.waitForSelector('.zd-proj[data-pid="wd_nas"]');
    assert.equal(await stageOf(p, 'wd_nas'), 'on');
  });

  await check('carry a wings chip onto the bar’s On stage', async () => {
    await p.locator('.zd-wings .zd-chip', { hasText: 'Two Blood' }).dragTo(p.locator('.zm-seatbar [data-seat="on"]'), { force: true }).catch(async () => {
      // The bar comes up once the drag starts: drag in steps.
      const chip = await p.locator('.zd-wings .zd-chip', { hasText: 'Two Blood' }).boundingBox();
      await p.mouse.move(chip.x + 10, chip.y + 10);
      await p.mouse.down();
      await p.mouse.move(chip.x + 40, chip.y - 40, { steps: 5 });
      const seat = await p.locator('.zm-seatbar [data-seat="on"]').boundingBox();
      await p.mouse.move(seat.x + 10, seat.y + 10, { steps: 8 });
      await p.mouse.up();
    });
    await p.waitForFunction(() => !!document.querySelector('.zd-proj[data-pid="wd_tb"]'), null, { timeout: 5000 });
    assert.equal(await stageOf(p, 'wd_tb'), 'on');
  });

  await check('Alt + S on a project’s page, then 3: backstage', async () => {
    await p.evaluate(() => { history.pushState({ view: 'world', id: 'wd_tb' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'world', id: 'wd_tb' } })); });
    await p.waitForFunction(() => document.querySelector('#wh-title')?.textContent === 'Two Blood');
    await blur(p);
    await p.keyboard.press('Alt+KeyS');
    await p.waitForSelector('.zm-seatbar:not([hidden])');
    await p.keyboard.press('3');
    await p.waitForFunction(() => document.querySelector('.zm-seatbar')?.hidden);
    await sleep(500);
    assert.equal(await stageOf(p, 'wd_tb'), 'back');
  });

  await check('Library: On stage first, areas with seat words, the Finished shelf, Also here', async () => {
    await stop(p, 'library');
    await p.waitForSelector('#lib-zoom:not([hidden]) .zl-stage');
    const onStage = await p.locator('.zl-stage .zl-chip').allInnerTexts();
    assert.ok(onStage.includes('NAS') && onStage.includes('The Ninja Bunch') && !onStage.includes('Two Blood') && !onStage.includes('Old Short'), onStage.join(', '));
    const film = p.locator('.zl-area', { hasText: 'Filmmaking' });
    assert.match(await film.locator('.zl-row[data-pid="wd_tb"] .zl-seat').innerText(), /Backstage/);
    assert.equal(await film.locator('.zl-add').count(), 1, 'a quiet + where a new project would go');
    assert.deepEqual(await p.locator('.zl-done .zl-chip').allInnerTexts(), ['Old Short']);
    assert.ok((await p.locator('.zl-also .zl-chip').allInnerTexts()).includes('Drawer'));
    assert.equal(await p.locator('#lib-books').isVisible(), false, 'the cards are the Classic layout’s');
  });

  await check('Library: a seat word opens the bar', async () => {
    await p.locator('.zl-row[data-pid="wd_tb"] .zl-seat').click();
    await p.waitForSelector('.zm-seatbar:not([hidden])');
    await p.locator('.zm-seatbar [data-seat="wings"]').click();
    await p.waitForFunction(() => /In the wings/.test(document.querySelector('.zl-row[data-pid="wd_tb"] .zl-seat')?.textContent || ''));
    assert.equal(await stageOf(p, 'wd_tb'), 'wings');
  });

  await check('a project’s Overview: one thin stage line, its seat word opens the bar', async () => {
    await p.evaluate(() => { history.pushState({ view: 'world', id: 'wd_nb' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'world', id: 'wd_nb' } })); });
    await p.waitForFunction(() => document.querySelector('#wh-title')?.textContent === 'The Ninja Bunch');
    await p.waitForSelector('#wh-stagebar:not([hidden]) .zw-stand');
    assert.match(await p.locator('.zw-sg.has').first().innerText(), /2/);
    assert.equal(await p.locator('#wh-status').isVisible(), false, 'the big board lives on Make');
    await p.locator('#wh-seat').click();
    await p.waitForSelector('.zm-seatbar:not([hidden])');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.querySelector('.zm-seatbar')?.hidden);
  });

  await check('Shift + Right on a project: the next one in the Desk’s order', async () => {
    await blur(p);
    const ids = await p.evaluate(() => window.__deskOrder?.());
    await p.keyboard.press('Shift+ArrowRight');
    await p.waitForFunction(() => history.state?.view === 'world' && history.state.id !== 'wd_nb');
    if (ids) assert.equal((await p.evaluate(() => history.state)).id, ids[ids.indexOf('wd_nb') + 1]);
  });

  await check('a life project says so beside its name, and that is the switch', async () => {
    await p.evaluate(() => { history.pushState({ view: 'world', id: 'wd_nas' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'world', id: 'wd_nas' } })); });
    await p.waitForFunction(() => document.querySelector('#wh-title')?.textContent === 'NAS');
    await p.waitForSelector('.wp-lifeword');
    await p.locator('.wp-lifeword').click();
    await p.locator('.pop-menu .pop-item', { hasText: 'Story world' }).click();
    await p.waitForFunction(() => !document.querySelector('.wp-lifeword'));
    assert.ok(!(await get(p, 'wd_nas')).fields.life, 'a story world again');
  });

  await check('a piece: its stage as dots; Shift + Right is the next piece', async () => {
    await p.evaluate(() => { history.pushState({ view: 'project', id: 'pr_r1' }, ''); dispatchEvent(new PopStateEvent('popstate', { state: { view: 'project', id: 'pr_r1' } })); });
    await p.waitForFunction(() => document.querySelector('#ph-title')?.textContent === 'Reel 1: Rooftop');
    await p.waitForSelector('#ph-dots:not([hidden]) .zp-dot');
    const n = await p.locator('#ph-dots .zp-dot').count();
    assert.ok(n >= 4, `${n} dots`);
    await p.locator('#ph-dots .zp-dot').nth(2).click();
    await p.waitForFunction(() => document.querySelector('#ph-dots .zp-dot.here') === document.querySelectorAll('#ph-dots .zp-dot')[2]);
    await blur(p);
    await p.keyboard.press('Shift+ArrowRight');
    await p.waitForFunction(() => document.querySelector('#ph-title')?.textContent === 'Reel 2: Breakfast');
  });

  await check('Go has no list of rooms in the zoom', async () => {
    await blur(p);
    await p.keyboard.press('Control+o');
    await p.waitForSelector('.palette:not([hidden])');
    await sleep(300);
    assert.equal(await p.locator('.palette .bx-room, .palette [data-room]').count(), 0);
    await p.keyboard.press('Escape');
  });

  // The phone: hold a project for its seats; the bar fits the screen.
  const ph = await open({ ...devices['Pixel 7'] });
  await check('phone: the Desk, and a project’s seats on a hold', async () => {
    await ph.locator('.zm-stop[data-stop="desk"]').tap();
    await ph.waitForSelector('.zd-proj');
    await ph.locator('.zd-proj[data-pid="wd_nb"] .zd-ph').dispatchEvent('contextmenu');
    await ph.waitForSelector('.zm-seatbar:not([hidden])');
    const b = await ph.locator('.zm-seatbar').boundingBox();
    assert.ok(b.x >= 0 && b.x + b.width <= 413, 'fits');
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
    await ph.locator('.zm-seatbar [data-sb="x"]').tap();
  });
  await check('phone: the Library fits', async () => {
    await ph.locator('.zm-stop[data-stop="library"]').tap();
    await ph.waitForSelector('.zl-stage');
    assert.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  });

  await check('no page errors', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
