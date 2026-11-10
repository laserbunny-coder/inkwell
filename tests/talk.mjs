// Talk it through: Claude in the Beside pane (Alt + T), about the project
// you're in or everything on stage. It answers with moves you tick; Apply
// does them, writes a turn on each project touched with your words as the
// reason, and can be undone. window.__claude plays the server and
// window.__desk plays Daybook's side (calls and updates).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { withoutSync } from './nosync.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 4269;
const DIST = process.env.DIST;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort', ...(DIST ? ['--outDir', DIST] : [])], { stdio: 'pipe' });
await sleep(1500);
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS;

// Monday Nov 9 2026, 2:04 pm in Los Angeles.
const NOW = '2026-11-09T14:04:00-08:00';
const now = Date.parse(NOW);
const T = (s) => new Date(`${s}-08:00`).toISOString();
const NB = 'https://claude.ai/code/project/chan_nb';
const INK = 'https://claude.ai/code/project/chan_ink';

const fresh = () => ({
  needs: [
    { id: 'n1', kind: 'decision', title: 'Pick Kenji’s final character sheet', project: 'The Ninja Bunch', link: `${NB}?thread=sheet`, project_link: NB, created_at: T('2026-11-08T10:09:00'), body: '' },
    { id: 'n2', kind: 'review', title: 'Try the AI production tools on Reel 4', project: 'The Ninja Bunch', link: `${NB}?thread=tools`, project_link: NB, created_at: T('2026-11-03T22:53:00'), body: '' },
    { id: 'n4', kind: 'review', title: 'Try opening two things side by side', project: 'Inkwell', link: `${INK}?thread=panes`, project_link: INK, created_at: T('2026-11-05T03:43:00'), body: '' },
  ],
  updates: [
    { id: 'u3', project: 'The Ninja Bunch', project_link: NB, link: `${NB}?thread=prompts`, thread: 'Draft Reel 3 prompts', text: 'Reel 3 prompts are half drafted', place: null, state: 'working', created_at: T('2026-11-09T13:52:00') },
    { id: 'u4', project: 'Inkwell', project_link: INK, link: `${INK}?thread=redesign`, thread: 'Redesign Inkwell from the ground up', text: 'The new frame is live: rail, switch, five looks', place: null, state: 'live', created_at: T('2026-11-09T09:30:00') },
  ],
});

const base = { title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: now - 20 * 864e5, updated_at: now - 2 * 36e5 };
const row = (id, kind, parent_id, sort, extra = {}) => ({ ...base, id, kind, parent_id, sort, ...extra });
const task = (id, parent, sort, text, t = {}, done = false) => row(id, 'line', parent, sort, {
  text, content: [{ type: 'text', text }],
  fields: { done, box: true, task: { v: 1, day: null, est: null, done_at: done ? now - 864e5 : null, actual: null, log: [], run: null, order: sort, ...t } }
});
const SEED = [
  row('wd_nb', 'world', null, 1, { title: 'The Ninja Bunch', area_id: 'area-filmmaking', fields: { shape: 'show', star: 'Three finished reels that prove the look before the December 14 tests.' }, updated_at: now - 864e5 }),
  row('pr_reel2', 'project', 'wd_nb', 1, { title: 'Reel 2: Breakfast', fields: { type: 'screenplay', stage: 'Boarding', label: 'Reel' } }),
  row('steps-wd_nb', 'page', 'wd_nb', 2048, { title: 'Steps' }),
  task('st_1', 'steps-wd_nb', 1024, 'Board Reel 2', { day: '2026-11-09', est: 90 }),
  task('st_2', 'steps-wd_nb', 2048, 'Write Kenji’s second verse', { day: '2026-11-09', est: 120 }),
  task('st_3', 'steps-wd_nb', 3072, 'Pick the bakery’s colours', {}, true),
  row('wd_scribe', 'world', null, 2, { title: 'Scribe', area_id: 'area-business', fields: { life: true, star: 'Dictation that sounds like you, anywhere you type.' }, updated_at: now - 864e5 }),
  row('page-tasks', 'page', null, 0, { title: 'Tasks' }),
  task('st_x', 'page-tasks', 1024, 'Harbor spot: second grade pass', { day: '2026-11-09', est: 180 }),
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

// What "Claude" answers, by what was last said.
const ANSWERS = {
  give: {
    say: 'Today has about six and a half hours planned against an afternoon. The grade has a client waiting, so the verse is what moves.',
    moves: [
      { type: 'move_task', task: 'st_2', day: '2026-11-12', label: 'Move “Write Kenji’s second verse” to Thursday', why: 'Today is 6 h 30 min against about 4 free', on: true },
      { type: 'add_step', project: 'wd_nb', text: 'Star the stills for shot 3', day: '2026-11-10', minutes: 15, label: '', why: 'The stills came back overnight', on: true },
      { type: 'set_star', project: 'wd_nb', text: 'Two finished reels before the December 14 tests.', label: 'Change the north star to two reels', why: 'Three won’t fit', on: false },
      // None of these point at anything real, so none may show.
      { type: 'move_task', task: 'nope', day: '2026-11-12', label: 'Move a task that isn’t there', why: '', on: true },
      { type: 'move_task', task: 'st_1', day: '2026-11-09', label: 'Move it to the day it’s already on', why: '', on: true },
      { type: 'add_step', project: 'wd_gone', text: 'A step for nothing', day: '', minutes: 0, label: '', why: '', on: true },
      { type: 'launch_rocket', label: 'Not a move at all', on: true },
    ]
  },
  backstage: {
    say: 'Scribe has no date and nothing waits on it. Parking it costs nothing this month.',
    moves: [
      { type: 'set_stage', project: 'wd_scribe', stage: 'back', text: 'After the December 14 tests', label: 'Put Scribe backstage until the tests end', why: 'Nothing waits on it', on: true },
      { type: 'call_later', call: 'n2', label: '', why: 'A try-out, not a decision', on: true },
    ]
  },
  plain: { say: 'Board Reel 2. Everything else on this project waits on it.', moves: [] }
};

const browser = withoutSync(await chromium.launch());
async function open(viewport, { server: mode = 'ok', ...extra } = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', timezoneId: 'America/Los_Angeles', viewport, ...extra });
  const st = { db: fresh(), asked: [], calls: [], mode };
  await ctx.exposeFunction('__db', (op, a, b) => {
    st.calls.push([op, a, b]);
    if (op === 'desk') return { needs: st.db.needs.filter((n) => !n.resolved_at).map((n) => ({ ...n })), updates: st.db.updates.filter((u) => u.created_at >= a).map((u) => ({ ...u })) };
    if (op === 'all') return { needs: st.db.needs.map((n) => ({ ...n })), updates: st.db.updates.map((u) => ({ ...u })) };
    const n = st.db.needs.find((x) => x.id === a);
    if (op === 'done') n.resolved_at = T('2026-11-09T14:04:00');
    if (op === 'later') n.snoozed_until = b;
    return null;
  });
  await ctx.exposeFunction('__toClaude', async (body) => {
    if (body.mode !== 'talk') return {};
    st.asked.push(body);
    if (st.mode === 'old') return { error: 'Missing paragraph' };
    if (st.mode === 'down') throw new Error('network');
    await sleep(250);
    const last = body.said.at(-1).text;
    return /backstage|park/i.test(last) ? ANSWERS.backstage : /next step/i.test(last) ? ANSWERS.plain : ANSWERS.give;
  });
  await ctx.addInitScript(() => {
    window.__claude = (body) => window.__toClaude(body);
    window.__desk = {
      desk: (since) => window.__db('desk', since),
      deskAll: () => window.__db('all'),
      doneNeed: (id) => window.__db('done', id),
      laterNeed: (id, until) => window.__db('later', id, until),
    };
  });
  const page = await ctx.newPage();
  page.st = st;
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
const still = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const goMain = async (p, place) => {
  await p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await p.waitForFunction((v) => (document.documentElement.dataset.view || 'write') === v, place.view);
  await still(p);
  await sleep(300);
};
// The pane beside, once it's on the talk.
async function pane(p) {
  await p.waitForFunction(() => {
    const f = [...document.querySelectorAll('.pane-frame')].at(-1);
    const d = f?.contentDocument?.documentElement;
    return d?.dataset?.started === '1' && d.dataset.view === 'talk' && !!f.contentDocument.querySelector('.tt-ask textarea');
  }, null, { timeout: 15000 });
  return p.frames().filter((f) => f.url().includes('?pane=')).at(-1);
}
const say = async (f, text) => {
  await f.locator('.tt-ask textarea').fill(text);
  await f.locator('.tt-ask textarea').press('Enter');
};
const answered = (f, n = 1) => f.waitForFunction((k) => document.querySelectorAll('.tt-cl').length === k && !document.querySelector('.tt-wait'), n);
const moves = (f) => f.evaluate(() => [...document.querySelectorAll('.tt-moves')].at(-1) ? [...[...document.querySelectorAll('.tt-moves')].at(-1).querySelectorAll('.tt-move')].map((m) => `${m.querySelector('input').checked ? '[x]' : '[ ]'} ${m.querySelector('.tt-move-t').firstChild.textContent}`) : []);
const toastText = (p) => p.evaluate(() => document.querySelector('.toast')?.textContent || '');
const shot = async (p, name) => { if (SHOTS) { await p.evaluate(() => document.querySelector('.toast')?.remove()); await still(p); await sleep(250); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}

try {
  const page = await open({ width: 1440, height: 900 });
  const st = page.st;
  await goMain(page, { view: 'world', id: 'wd_nb' });
  await page.waitForSelector('#wh-steps .pl-task');
  let f;

  await check('Alt + T on a project opens Claude beside it, about that project', async () => {
    await page.keyboard.press('Alt+t');
    f = await pane(page);
    assert.equal(await page.locator('.pane .pane-tab[aria-pressed="true"]').innerText(), 'Claude');
    assert.deepEqual(await page.locator('.pane .pane-tab').allInnerTexts(), ['Plan', 'Claude', 'Notes']);
    assert.match(await f.locator('.sn-eyebrow').innerText(), /^talk it through$/i);
    assert.equal(await f.locator('.tt-head h1').innerText(), 'The Ninja Bunch');
    assert.match(await f.locator('.tt-hint').innerText(), /nothing changes until you apply them/);
    assert.deepEqual(await f.locator('.tt-start').allInnerTexts(), ['What’s the next step here?', 'Is this week’s part of it realistic?', 'What’s in the way?']);
    assert.equal(await f.evaluate(() => document.activeElement?.tagName), 'TEXTAREA', 'ready to type');
    assert.equal(await f.locator('.tt-ask textarea').getAttribute('placeholder'), 'Say or type what’s on your mind');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.view), 'world', 'the project stays where it was');
  });

  await check('what you say goes to Claude with the project as the page shows it', async () => {
    await say(f, 'This week feels too full. What should give?');
    await f.waitForSelector('.tt-wait');
    assert.equal(await f.locator('.tt-me').innerText(), 'This week feels too full. What should give?');
    await answered(f);
    const b = st.asked.at(-1);
    assert.equal(b.mode, 'talk');
    assert.equal(b.about, 'The Ninja Bunch');
    assert.equal(b.today, '2026-11-09');
    assert.equal(b.free_hours_a_week, 45);
    assert.deepEqual(b.said, [{ who: 'me', text: 'This week feels too full. What should give?' }]);
    assert.equal(b.projects.length, 1);
    const p = b.projects[0];
    assert.equal(p.id, 'wd_nb');
    assert.equal(p.sits, 'On stage');
    assert.equal(p.north_star, 'Three finished reels that prove the look before the December 14 tests.');
    assert.equal(p.now, 'Reel 3 prompts are half drafted');
    assert.deepEqual(p.steps, [{ id: 'st_1', text: 'Board Reel 2', day: '2026-11-09', minutes: 90 }, { id: 'st_2', text: 'Write Kenji’s second verse', day: '2026-11-09', minutes: 120 }]);
    assert.equal(p.steps_done, 1);
    assert.deepEqual(p.needs_you.map((c) => [c.id, c.kind, c.waiting_days]), [['n1', 'decision', 1], ['n2', 'try it', 5]]);
    assert.deepEqual(p.crew, ['Draft Reel 3 prompts']);
    assert.deepEqual(b.week[0], { day: '2026-11-09', weekday: 'Monday', planned_minutes: 390, tasks: 3 });
    assert.equal(b.week.length, 7);
    assert.deepEqual(b.other_tasks, [{ id: 'st_x', text: 'Harbor spot: second grade pass', day: '2026-11-09', minutes: 180 }]);
    assert.ok(b.other_projects.some((o) => o.name === 'Scribe'), 'the rest are there by name');
  });

  await check('the answer comes with moves to tick: Claude’s picks ticked, and only ones that point at something real', async () => {
    assert.match(await f.locator('.tt-cl').innerText(), /^✦\s*Today has about six and a half hours planned/);
    assert.deepEqual(await moves(f), [
      '[x] Move “Write Kenji’s second verse” to Thursday',
      '[x] Add “Star the stills for shot 3” to The Ninja Bunch',
      '[ ] Change the north star to two reels'
    ]);
    assert.equal(await f.locator('.tt-move small').first().innerText(), 'Today is 6 h 30 min against about 4 free');
    assert.equal(await f.locator('.tt-go').innerText(), 'Apply 2 moves');
    assert.match(await f.locator('.tt-apply .tt-note').innerText(), /Nothing changes until you do/);
    // Nothing has changed yet.
    assert.equal((await get(page, 'st_2')).fields.task.day, '2026-11-09');
    await f.locator('.tt-move', { hasText: 'north star' }).locator('input').check();
    assert.equal(await f.locator('.tt-go').innerText(), 'Apply 3 moves');
    await f.locator('.tt-move', { hasText: 'north star' }).locator('input').uncheck();
    assert.equal(await f.locator('.tt-go').innerText(), 'Apply 2 moves');
    await shot(page, 'talk-moves');
  });

  await check('Apply does the ticked ones, the project’s page follows, and a turn keeps your words as the reason', async () => {
    await f.locator('.tt-go').click();
    await f.waitForSelector('.tt-move.applied');
    assert.equal((await get(page, 'st_2')).fields.task.day, '2026-11-12');
    const added = (await all(page)).find((r) => r.text === 'Star the stills for shot 3' && !r.deleted);
    assert.equal(added.parent_id, 'steps-wd_nb');
    assert.equal(added.fields.task.day, '2026-11-10');
    assert.equal(added.fields.task.est, 15);
    const w = await get(page, 'wd_nb');
    assert.equal(w.fields.star, 'Three finished reels that prove the look before the December 14 tests.', 'the unticked one didn’t happen');
    assert.equal(w.fields.turns.length, 1);
    assert.equal(w.fields.turns[0].text, 'Move “Write Kenji’s second verse” to Thursday. Add “Star the stills for shot 3” to The Ninja Bunch');
    assert.equal(w.fields.turns[0].why, 'This week feels too full. What should give?');
    assert.match(await f.locator('.tt-apply .tt-note').innerText(), /^Applied 2 moves · 2:04 pm$/);
    assert.equal(await f.locator('.tt-go').count(), 0);
    assert.match(await toastText(f), /Applied 2 moves\s*Undo/);
    // The page in the main window shows it without being asked.
    await page.waitForFunction(() => [...document.querySelectorAll('#wh-steps .pl-task .pl-words')].map((x) => x.innerText).join('|') === 'Board Reel 2|Star the stills for shot 3|Write Kenji’s second verse|Pick the bakery’s colours');
    await page.waitForFunction(() => /Move “Write Kenji’s second verse” to Thursday/.test(document.querySelector('#wh-turns')?.innerText || ''));
    assert.match(await page.locator('#wh-turns .wp-why').innerText(), /^“This week feels too full\. What should give\?”$/);
    await shot(page, 'talk-applied');
  });

  await check('Undo puts every one of them back, and the moves can be ticked again', async () => {
    await f.locator('.toast button', { hasText: 'Undo' }).click();
    await f.waitForSelector('.tt-go');
    assert.equal((await get(page, 'st_2')).fields.task.day, '2026-11-09');
    assert.ok(!(await all(page)).some((r) => r.text === 'Star the stills for shot 3' && !r.deleted), 'the added step is gone');
    assert.deepEqual((await get(page, 'wd_nb')).fields.turns, undefined);
    await page.waitForFunction(() => [...document.querySelectorAll('#wh-steps .pl-task .pl-words')].map((x) => x.innerText).join('|') === 'Board Reel 2|Write Kenji’s second verse|Pick the bakery’s colours');
    await page.waitForFunction(() => document.querySelector('#wh-turns')?.hidden === true);
    assert.equal(await f.locator('.tt-go').innerText(), 'Apply 2 moves');
    assert.match(await toastText(f), /Put back as it was/);
  });

  await check('a plain answer has no moves, and asking again retires moves that were never applied', async () => {
    await say(f, 'OK. What’s the next step here?');
    await answered(f, 2);
    assert.deepEqual(st.asked.at(-1).said.map((m) => m.who), ['me', 'claude', 'me']);
    assert.equal(await f.locator('.tt-moves').count(), 1, 'only the first answer had moves');
    assert.match(await f.locator('.tt-apply .tt-note').innerText(), /for an earlier answer/);
    assert.equal(await f.locator('.tt-go').count(), 0);
    assert.ok(await f.locator('.tt-move input').first().isDisabled());
    assert.match(await f.locator('.tt-cl').last().innerText(), /Board Reel 2\. Everything else/);
  });

  await check('the talk is kept: after a reload it’s all still there', async () => {
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.started === '1');
    f = await pane(page);
    await f.waitForFunction(() => document.querySelectorAll('.tt-cl').length === 2);
    assert.equal(await f.locator('.tt-me').count(), 2);
    assert.equal(await f.locator('.tt-head h1').innerText(), 'The Ninja Bunch');
  });

  await check('from the Desk it’s about everything on stage, a talk of its own; the project’s is there when you go back', async () => {
    await goMain(page, { view: 'desk' });
    await f.waitForFunction(() => document.querySelector('.tt-head h1')?.innerText === 'Everything on stage');
    assert.equal(await f.locator('.tt-me').count(), 0);
    assert.deepEqual(await f.locator('.tt-start').allInnerTexts(), ['What should give this week?', 'What needs me first?', 'What can go backstage for now?']);
    assert.ok(await page.locator('.dk-talk').isVisible());
    assert.equal(await page.locator('.dk-talk').innerText(), '✦ Talk it through');
    await f.locator('.tt-start', { hasText: 'backstage' }).click();
    await answered(f);
    const b = st.asked.at(-1);
    assert.equal(b.about, '');
    // The first-run novel was made a moment ago, so it sits on stage too.
    assert.deepEqual(b.projects.map((p) => p.name).sort(), ['Inkwell', 'Scribe', 'The Ninja Bunch', 'Untitled novel']);
    assert.equal(b.projects.find((p) => p.name === 'Inkwell').id, '', 'a Claude project with no page of its own');
    assert.deepEqual(await moves(f), ['[x] Put Scribe backstage until the tests end', '[x] Set “Try the AI production tools on Reel 4” aside until tomorrow morning']);
    await goMain(page, { view: 'world', id: 'wd_nb' });
    await f.waitForFunction(() => document.querySelector('.tt-head h1')?.innerText === 'The Ninja Bunch');
    assert.equal(await f.locator('.tt-me').count(), 2);
    await goMain(page, { view: 'desk' });
    await f.waitForFunction(() => document.querySelector('.tt-head h1')?.innerText === 'Everything on stage');
    assert.equal(await f.locator('.tt-go').innerText(), 'Apply 2 moves');
    await shot(page, 'talk-desk');
  });

  await check('a project goes backstage with when it comes back, and a call is set aside; the Desk shows both at once', async () => {
    await page.waitForFunction(() => document.querySelector('#desk-toggle')?.getAttribute('data-n') === '3');
    await f.locator('.tt-go').click();
    await f.waitForSelector('.tt-move.applied');
    assert.equal((await get(page, 'settings-desk')).fields.stage['w:wd_scribe'], 'back');
    const s = await get(page, 'wd_scribe');
    assert.equal(s.fields.back, 'After the December 14 tests');
    assert.equal(s.fields.turns[0].text, 'Put Scribe backstage until the tests end');
    assert.equal(s.fields.turns[0].why, 'What can go backstage for now?');
    assert.ok(st.calls.some(([op, id, until]) => op === 'later' && id === 'n2' && /^2026-11-10T15:00/.test(until)), 'back at 7 tomorrow morning');
    await page.waitForFunction(() => !!document.querySelector('.dk-back .dk-row[data-key="w:wd_scribe"]'));
    await page.waitForFunction(() => document.querySelector('#desk-toggle')?.getAttribute('data-n') === '2');
    await page.waitForFunction(() => /1 set aside until tomorrow morning/.test(document.querySelector('.dk-later')?.innerText || ''));
    // Undo brings the call back too.
    await f.locator('.toast button', { hasText: 'Undo' }).click();
    await page.waitForFunction(() => document.querySelector('#desk-toggle')?.getAttribute('data-n') === '3');
    assert.ok(st.calls.some(([op, id, until]) => op === 'later' && id === 'n2' && until === null));
    // The Desk's settings weren't there before, so Undo takes the row away again.
    const d = await get(page, 'settings-desk');
    assert.ok(d.deleted || !d.fields.stage?.['w:wd_scribe']);
    assert.equal((await get(page, 'wd_scribe')).fields.back, undefined);
  });

  await check('Start over clears this talk and nothing else', async () => {
    await f.locator('.tt-over').click();
    assert.equal(await f.locator('.tt-me').count(), 0);
    assert.equal(await f.locator('.tt-start').count(), 3);
    await goMain(page, { view: 'world', id: 'wd_nb' });
    await f.waitForFunction(() => document.querySelector('.tt-head h1')?.innerText === 'The Ninja Bunch');
    assert.equal(await f.locator('.tt-me').count(), 2);
  });

  await check('the ways in: the Desk’s button, the project’s ⋯ and the command list; Plan and Notes are one click away', async () => {
    await page.locator('.pane .pane-tab', { hasText: 'Plan' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.pane-frame')].at(-1)?.contentDocument?.documentElement?.dataset.view === 'plan');
    await page.locator('#wh-more .more-btn').click();
    await page.locator('.pop-menu .pop-item', { hasText: 'Talk it through with Claude' }).click();
    f = await pane(page);
    assert.equal(await page.evaluate(() => window.__panes.count), 1, 'the one pane, not another');
    await page.locator('.pane .pane-tab', { hasText: 'Plan' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.pane-frame')].at(-1)?.contentDocument?.documentElement?.dataset.view === 'plan');
    await goMain(page, { view: 'desk' });
    await page.locator('.dk-talk').click();
    f = await pane(page);
    await page.locator('.pane .pane-tab', { hasText: 'Plan' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.pane-frame')].at(-1)?.contentDocument?.documentElement?.dataset.view === 'plan');
    await page.locator('body').click({ position: { x: 300, y: 500 } });
    await page.keyboard.press('Control+K');
    await page.keyboard.type('talk it through');
    await page.waitForSelector('.palette .p-item, .palette li');
    await sleep(250);
    await page.keyboard.press('Enter');
    f = await pane(page);
    assert.equal(await f.locator('.tt-head h1').innerText(), 'Everything on stage');
  });

  await check('with Beside switched off under Look there’s no button, and Alt + T says why', async () => {
    await page.evaluate(() => { const c = document.querySelector('[data-show="panes"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.ok(await page.locator('.dk-talk').isHidden());
    await page.locator('body').click({ position: { x: 300, y: 500 } });
    await page.keyboard.press('Alt+t');
    await page.waitForFunction(() => /Beside is switched off/.test(document.querySelector('.toast')?.textContent || ''));
    await page.evaluate(() => { const c = document.querySelector('[data-show="panes"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.deepEqual(page.errors, []);
  });

  await check('before the server knows how, it says so plainly; when Claude can’t be reached, Try again asks again', async () => {
    const old = await open({ width: 1280, height: 860 }, { server: 'old' });
    await goMain(old, { view: 'world', id: 'wd_nb' });
    await old.keyboard.press('Alt+t');
    const of = await pane(old);
    await say(of, 'What should give?');
    await of.waitForSelector('.tt-fail');
    assert.match(await of.locator('.tt-fail').innerText(), /Claude can’t talk it through yet: this arrives with the next update\./);
    assert.equal(await of.locator('.tt-me').innerText(), 'What should give?', 'what you said is kept');
    old.st.mode = 'down';
    await of.locator('.tt-fail button').click();
    await of.waitForFunction(() => /Couldn’t reach Claude just now/.test(document.querySelector('.tt-fail')?.innerText || ''));
    old.st.mode = 'ok';
    await of.locator('.tt-fail button').click();
    await answered(of);
    assert.equal(await of.locator('.tt-me').count(), 1, 'asked once, not three times');
    assert.equal(old.st.asked.at(-1).said.length, 1);
    assert.deepEqual(old.errors, []);
    await old.context().close();
  });

  await check('on a phone it comes up as a sheet from the Desk, with the same switch, and nothing spills', async () => {
    const phone = await open(undefined, { ...devices['Pixel 7'] });
    await phone.evaluate(() => document.querySelector('#desk-toggle, .pb-desk')?.click());
    await phone.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, { view: 'desk' });
    await phone.waitForSelector('.dk-talk', { state: 'visible' });
    await phone.locator('.dk-talk').tap();
    await phone.waitForFunction(() => document.documentElement.classList.contains('sheet-peek'));
    const pf = await pane(phone);
    assert.equal(await phone.locator('.ps-head .pane-tab[aria-pressed="true"]').innerText(), 'Claude');
    await pf.locator('.tt-start').first().tap();
    await answered(pf);
    assert.ok((await moves(pf)).length >= 2);
    const wide = await pf.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide <= 1, `the sheet spills ${wide}`);
    if (SHOTS) { await still(phone); await sleep(300); await phone.screenshot({ path: `${SHOTS}/talk-phone.png` }); }
    assert.deepEqual(phone.errors, []);
    await phone.context().close();
  });
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall talk checks passed');
