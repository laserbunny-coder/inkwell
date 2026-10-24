// Revising and sharing: fresh eyes, printing as a manuscript or a script, a
// new draft from scratch with the old one kept whole and open beside it, the
// compare view (drafts, dates, Claude's words), Claude's notes (margin notes,
// a fix list, a conversation), and share links to read and comment, with the
// reader's page. window.__claude stands in for the server, a fake backend for
// Supabase, and window.__shareBackend for the share function.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { alignBlocks, pairChapters, likeness, runsOf, changeCount } from '../src/drafts.js';
import { hashOf, newToken, linkFor } from '../src/sharelink.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let failed = 0;
const checkNow = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); } };

// ---------- without a browser ----------

const b = (eid, text, kind = 'para') => ({ eid, text, kind });
checkNow('two versions line up: same, changed (by id or by likeness), taken out, added', () => {
  const A = [b('1', 'The rain fell on the dojo.'), b('2', 'Kenji waited.'), b('3', 'A crow called twice.'), b('4', 'Night came.')];
  const B = [b('1', 'The rain fell on the dojo.'), b('2', 'Kenji waited, sword drawn.'), b('9', 'Thunder.'), b('4', 'Night came.')];
  const rows = alignBlocks(A, B);
  assert.deepEqual(rows.map((r) => r.op), ['same', 'chg', 'del', 'ins', 'same']);
  assert.ok(rows[1].words.some((w) => w.op === '+' && /sword drawn/.test(w.t)));
  assert.deepEqual(changeCount(rows), { added: 4, cut: 5 });
});
checkNow('a fresh draft (new ids) still lines up by the words', () => {
  const A = [b('a1', 'INT. KITCHEN - MORNING'), b('a2', 'Mom flips a pancake.'), b('a3', 'Kenji sneaks in.')];
  const B = [b('b1', 'INT. KITCHEN - MORNING'), b('b2', 'Mom flips a pancake high.'), b('b3', 'Someone knocks.'), b('b4', 'Kenji sneaks in.')];
  assert.deepEqual(alignBlocks(A, B).map((r) => r.op), ['same', 'chg', 'ins', 'same']);
  assert.ok(likeness('a b c d', 'a b c e') > 0.7);
  assert.equal(likeness('one two', 'three four'), 0);
});
checkNow('chapters pair by id, then title, else stand alone', () => {
  const A = [{ id: 'c1', title: 'Chapter 1' }, { id: 'c2', title: 'The Gate' }, { id: 'c3', title: 'Old' }];
  const B = [{ id: 'x1', title: 'Chapter 1' }, { id: 'c2', title: 'The Gate (new)' }, { id: 'x9', title: 'Brand new' }];
  const pairs = pairChapters(A, B).map((p) => [p.a?.id || null, p.b?.id || null]);
  assert.deepEqual(pairs, [['c1', 'x1'], ['c2', 'c2'], ['c3', 'x9']]);
  const pairs2 = pairChapters([{ id: 'c1', title: 'One' }], [{ id: 'c1', title: 'One' }, { id: 'n', title: 'Two' }]).map((p) => [p.a?.id || null, p.b?.id || null]);
  assert.deepEqual(pairs2, [['c1', 'c1'], [null, 'n']]);
});
checkNow('a share link: an unguessable token, a read.html address, a fingerprint that changes with the words', () => {
  const t = newToken();
  assert.match(t, /^[A-Za-z0-9]{24}$/);
  assert.notEqual(t, newToken());
  assert.equal(linkFor('abc', 'https://x.github.io/inkwell/?p=1#z'), 'https://x.github.io/inkwell/read.html#abc');
  assert.equal(linkFor('abc', 'https://x.github.io/inkwell/index.html'), 'https://x.github.io/inkwell/read.html#abc');
  assert.notEqual(hashOf('one'), hashOf('two'));
  assert.deepEqual(runsOf([{ type: 'text', text: 'Hi ' }, { type: 'text', text: 'there', marks: [{ type: 'italic' }] }, { type: 'entryRef', attrs: { title: 'Mom' } }, { type: 'file', attrs: {} }]), [['Hi ', ''], ['there', 'i'], ['Mom', '']]);
});

// ---------- in the app ----------

const PORT = 4199;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const SHOTS = process.env.SHOTS || '';

const table = new Map();
const shares = new Map();
const comments = [];
let clock = Date.parse('2026-10-20T00:00:00Z');
const tick = () => new Date((clock += 1000)).toISOString();
function remote(op, arg) {
  if (op === 'push') {
    const stamp = tick();
    return arg.map((r) => { table.set(r.id, { ...r, user_id: 'u1', updated_at: stamp }); return { id: r.id, updated_at: stamp }; });
  }
  if (op === 'pull') {
    return [...table.values()].filter((r) => r.updated_at > arg.since)
      .sort((a, c) => (a.updated_at < c.updated_at ? -1 : a.updated_at > c.updated_at ? 1 : a.id < c.id ? -1 : 1))
      .slice(arg.from, arg.from + 500);
  }
  if (op === 'saveShare') { shares.set(arg.id, { ...arg, updated_at: tick() }); return true; }
  if (op === 'comments') return comments.filter((c) => arg.tokens.includes(c.share_id) && c.created_at > arg.since);
  if (op === 'reply') { const c = { id: `c${comments.length + 1}`, ...arg, owner: true, resolved: false, block: null, quote: '', created_at: tick() }; comments.push(c); return { id: c.id, created_at: c.created_at }; }
  if (op === 'resolve') { const c = comments.find((x) => x.id === arg.id); if (c) c.resolved = arg.resolved; return true; }
  // The share function, as readers reach it.
  if (op === 'share') {
    const s = shares.get(arg.token);
    if (!s || s.revoked) return { error: 'This link has been turned off.', code: 'gone' };
    if (arg.op === 'read') return { title: s.title, kind: s.kind, content: arg.since ? undefined : s.content, updated_at: s.updated_at, can_comment: s.can_comment, comments: comments.filter((c) => c.share_id === arg.token && (!arg.since || c.created_at > arg.since)) };
    if (arg.op === 'comment') {
      if (!s.can_comment) return { error: 'Comments are turned off for this link.' };
      const c = { id: `c${comments.length + 1}`, share_id: arg.token, parent_id: arg.parent || null, block: arg.parent ? null : arg.block, quote: arg.quote || '', name: arg.name || 'A reader', text: arg.text, owner: false, resolved: false, created_at: tick() };
      comments.push(c);
      return { comment: c };
    }
  }
}
const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    saveShare: (row) => window.__remote('saveShare', row),
    comments: (tokens, since) => window.__remote('comments', { tokens, since }),
    reply: (row) => window.__remote('reply', row),
    resolveComment: (id, resolved) => window.__remote('resolve', { id, resolved }),
    name: async () => 'Michael Writer',
    subscribe() {}, unsubscribe() {}
  };
  window.__shareBackend = async (body) => {
    const got = await window.__remote('share', body);
    if (got?.error) { const e = new Error(got.error); e.code = got.code; throw e; }
    return got;
  };
  window.__asked = [];
  window.__claude = async (body) => {
    window.__asked.push(body);
    if (body.mode !== 'revise') throw new Error('Not now');
    if (body.task === 'notes') return { notes: [{ para: body.paras[1].id, text: 'This beat lands; let it breathe.' }], fixes: [{ text: 'Cut the first line', para: body.paras[0].id }, { text: 'Name the crow', para: null }], overall: 'A strong opening.' };
    if (body.task === 'talk') return { reply: `You asked: ${body.msgs.at(-1).text}` };
    if (body.task === 'compare') return { points: [{ where: 'Chapter 1', better: 'b', why: 'Tighter.' }], overall: 'B is the keeper.' };
    return {};
  };
  window.print = () => { window.__printed = (window.__printed || 0) + 1; };
};

const put = (r) => {
  const at = tick();
  table.set(r.id, { parent_id: null, sort: 0, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, created_at: Date.parse(at), ...r, user_id: 'u1', updated_at: at });
};
const para = (id, parent, sort, text, fields = {}) => put({ id, kind: 'para', parent_id: parent, sort, text, content: text ? [{ type: 'text', text }] : null, fields });
put({ id: 'area-writing', kind: 'area', title: 'Writing', sort: 1 });
put({ id: 'wd_d', kind: 'world', title: 'The Dojo', area_id: 'area-writing' });
put({ id: 'pr_n', kind: 'project', parent_id: 'wd_d', title: 'The Dojo', area_id: 'area-writing', sort: 1, fields: { type: 'novel', levels: ['Act', 'Chapter', 'Scene'] } });
put({ id: 'ac_1', kind: 'act', parent_id: 'pr_n', title: 'Act One', sort: 1 });
put({ id: 'ch_1', kind: 'chapter', parent_id: 'ac_1', title: 'Chapter 1', sort: 1 });
put({ id: 'ch_2', kind: 'chapter', parent_id: 'ac_1', title: 'The Gate', sort: 2 });
para('pa_1', 'ch_1', 1024, 'The rain fell on the dojo all night.');
para('pa_2', 'ch_1', 2048, 'Kenji waited at the gate with his sword.');
put({ id: 'sc_1', kind: 'scene', parent_id: 'ch_1', sort: 3072, title: '' });
para('pa_3', 'ch_1', 4096, 'Morning came grey and slow.', { edited_by: 'claude', by: 'u1' });
para('pa_4', 'ch_2', 1024, 'A stranger stood at the gate.');
put({ id: 'no_1', kind: 'note', parent_id: 'pa_2', type: 'writing', text: 'Private: is this too slow?', fields: { chapter_id: 'ch_1' } });
put({ id: 'pr_s', kind: 'project', parent_id: 'wd_d', title: 'Reel 4', area_id: 'area-writing', sort: 2, fields: { type: 'screenplay', numbered: true, levels: ['Act', 'Script', 'Scene'] } });
put({ id: 'ac_s', kind: 'act', parent_id: 'pr_s', title: 'Screenplay', sort: 1 });
put({ id: 'ch_s', kind: 'chapter', parent_id: 'ac_s', title: 'Script', sort: 1 });
put({ id: 'sec_1', kind: 'scene', parent_id: 'ch_s', sort: 512, title: 'Act One' });
para('ps_1', 'ch_s', 1024, 'INT. KITCHEN - MORNING', { el: 'scene', code: '1' });
para('ps_2', 'ch_s', 2048, 'Mom flips a pancake.', { el: 'action' });
para('ps_3', 'ch_s', 3072, 'MOM', { el: 'character' });
para('ps_4', 'ch_s', 4096, 'Sit.', { el: 'dialogue' });
put({ id: 'pg_bible', kind: 'page', parent_id: 'wd_d', title: 'Kenji', sort: 1 });
put({ id: 'li_1', kind: 'line', parent_id: 'pg_bible', sort: 1024, text: 'Sixteen, stubborn', content: [{ type: 'text', text: 'Sixteen, stubborn' }], fields: { done: false } });
put({ id: 'li_2', kind: 'line', parent_id: 'li_1', sort: 1024, text: 'Hates rain', content: [{ type: 'text', text: 'Hates rain' }], fields: { done: false } });
put({ id: 'day-2026-10-20', kind: 'day', title: '2026-10-20' });
put({ id: 'li_day', kind: 'line', parent_id: 'day-2026-10-20', sort: 1024, text: 'My secret journal line', content: [{ type: 'text', text: 'My secret journal line' }], fields: { done: false } });

const browser = await chromium.launch();
async function device(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark', ...opts });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#editor .ProseMirror', { state: 'attached' });
  await sleep(800);
  return page;
}
const syncNow = (p) => p.evaluate(() => window.__sync.run());
const settle = async (p) => { await syncNow(p); await sleep(300); };
const go = (p, place) => p.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
const row = (id) => table.get(id);
const live = () => [...table.values()].filter((r) => !r.deleted);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const palette = async (p, text) => {
  await p.keyboard.press('Control+k');
  await p.waitForSelector('.palette:not([hidden])');
  await p.keyboard.type(text);
  await sleep(250);
  await p.keyboard.press('Enter');
  await sleep(400);
};
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 8).join('\n     ')}`); }
}

try {
  const laptop = await device();
  await settle(laptop);

  await check('fresh eyes: Ctrl+Shift+Y changes font, page and colour, and stays on this device', async () => {
    await go(laptop, { view: 'write', chapterId: 'ch_1' });
    await laptop.waitForSelector('#editor p[data-eid="pa_1"]');
    const before = await laptop.evaluate(() => [getComputedStyle(document.querySelector('#editor .ProseMirror')).fontFamily, getComputedStyle(document.body).backgroundColor, document.querySelector('.sheet').getBoundingClientRect().width]);
    await laptop.locator('#editor p[data-eid="pa_1"]').click();
    await laptop.keyboard.press('Control+Shift+Y');
    await sleep(400);
    const after = await laptop.evaluate(() => [getComputedStyle(document.querySelector('#editor .ProseMirror')).fontFamily, getComputedStyle(document.body).backgroundColor, document.querySelector('.sheet').getBoundingClientRect().width]);
    assert.ok(after[0] !== before[0], `font changed (${after[0]})`);
    assert.ok(after[1] !== before[1], 'page colour changed');
    assert.ok(after[2] < before[2], 'page narrower');
    await shot(laptop, '1-fresh-eyes');
    await laptop.reload();
    await laptop.waitForSelector('#editor p[data-eid="pa_1"]');
    assert.equal(await laptop.evaluate(() => document.documentElement.classList.contains('fresh-eyes')), true);
    await laptop.keyboard.press('Control+Shift+Y');
    await sleep(200);
    assert.equal(await laptop.evaluate(() => document.documentElement.classList.contains('fresh-eyes')), false);
  });

  await check('Ctrl+P prints the novel as a manuscript: title page, chapters, # for a scene break, no notes', async () => {
    await laptop.locator('#editor p[data-eid="pa_1"]').click();
    await laptop.keyboard.press('Control+p');
    await laptop.waitForFunction(() => window.__printed >= 1);
    const doc = await laptop.evaluate(() => {
      const d = document.querySelector('.print-doc');
      return { cls: d.className, big: d.querySelector('.pr-big').textContent, chapters: [...d.querySelectorAll('.pr-ch-title')].map((e) => e.textContent), breaks: d.querySelectorAll('.pr-break').length, text: d.textContent, count: d.querySelector('.pr-count').textContent, author: d.querySelector('.pr-by').textContent };
    });
    assert.match(doc.cls, /pr-novel/);
    assert.equal(doc.big, 'The Dojo');
    assert.deepEqual(doc.chapters, ['Chapter 1', 'The Gate']);
    assert.equal(doc.breaks, 1);
    assert.match(doc.count, /about \d+ words/);
    assert.equal(doc.author, 'by Michael');
    assert.doesNotMatch(doc.text, /Private: is this too slow/);
    await laptop.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.equal(await laptop.locator('.print-doc').count(), 0);
  });

  await check('a script prints in screenplay format: no section headings, scene codes, the usual elements', async () => {
    await go(laptop, { view: 'write', chapterId: 'ch_s' });
    await laptop.waitForSelector('html.script #editor p[data-eid="ps_2"]');
    await laptop.locator('#editor p[data-eid="ps_2"]').click();
    await laptop.keyboard.press('Control+p');
    await laptop.waitForFunction(() => window.__printed >= 2);
    const doc = await laptop.evaluate(() => {
      const d = document.querySelector('.print-doc');
      return { cls: d.className, kinds: [...d.querySelectorAll('.pr-chapter p')].map((p) => p.className), scene: d.querySelector('.pr-scene').textContent, text: d.textContent };
    });
    assert.match(doc.cls, /pr-script/);
    assert.deepEqual(doc.kinds, ['pr-scene', 'pr-action', 'pr-character', 'pr-dialogue']);
    assert.equal(doc.scene, '1INT. KITCHEN - MORNING1');
    assert.doesNotMatch(doc.text, /Act One/, 'sections are for finding your way, not for the page');
    await laptop.evaluate(() => dispatchEvent(new Event('afterprint')));
  });

  await check('Claude’s notes: margin notes in a Claude category, a fix list page, one switch hides them', async () => {
    await go(laptop, { view: 'write', chapterId: 'ch_1' });
    await laptop.waitForSelector('#editor p[data-eid="pa_1"]');
    await laptop.locator('#editor p[data-eid="pa_1"]').click();
    await palette(laptop, 'Claude’s notes on this chapter');
    await laptop.waitForSelector('.note select', { timeout: 5000 });
    await sleep(500);
    const asked = await laptop.evaluate(() => window.__asked.at(-1));
    assert.equal(asked.task, 'notes');
    assert.deepEqual(asked.paras.map((p) => p.id), ['pa_1', 'pa_2', 'pa_3']);
    await settle(laptop);
    const n = live().find((r) => r.kind === 'note' && r.type === 'claude');
    assert.equal(n.parent_id, 'pa_2');
    assert.equal(n.fields.by, 'claude');
    assert.ok(live().find((r) => r.id === 'settings-note-types').fields.types.some((t) => t.id === 'claude'), 'a Claude category was added');
    const page = row('pg_fix-ch_1');
    assert.equal(page.parent_id, 'pr_n');
    const lines = live().filter((r) => r.kind === 'line' && (r.parent_id === 'pg_fix-ch_1' || live().some((h) => h.id === r.parent_id && h.parent_id === 'pg_fix-ch_1')));
    assert.ok(lines.some((l) => /Cut the first line/.test(l.text) && l.links.includes('pa_1')), 'a fix links to its paragraph');
    assert.ok(lines.some((l) => l.text === 'A strong opening.'));
    await shot(laptop, '2-claude-notes');
    const visible = () => laptop.locator('.note:not([hidden])').evaluateAll((els) => els.map((e) => e.querySelector('textarea')?.value));
    assert.ok((await visible()).includes('This beat lands; let it breathe.'));
    await palette(laptop, 'Show or hide Claude’s notes');
    await sleep(300);
    assert.ok(!(await visible()).includes('This beat lands; let it breathe.'), 'hidden with one switch');
    assert.ok((await visible()).includes('Private: is this too slow?'), 'his own notes stay');
    await palette(laptop, 'Show or hide Claude’s notes');
  });

  await check('talk it over: a conversation about the chapter, kept with it', async () => {
    await palette(laptop, 'Talk this chapter over');
    await laptop.waitForSelector('.talk:not([hidden]) textarea');
    await laptop.locator('.talk textarea').fill('Is the opening slow?');
    await laptop.keyboard.press('Enter');
    await laptop.waitForSelector('.tk-claude:not(.tk-wait)');
    assert.equal(await laptop.locator('.tk-claude').last().textContent(), 'You asked: Is the opening slow?');
    const asked = await laptop.evaluate(() => window.__asked.at(-1));
    assert.equal(asked.task, 'talk');
    assert.equal(asked.paras.length, 3);
    await shot(laptop, '3-talk');
    await settle(laptop);
    assert.equal(row('tk-ch_1').fields.msgs.length, 2);
    await laptop.locator('.talk .ghost-btn', { hasText: 'Close' }).click();
  });

  await check('a new draft from scratch: the old one kept whole, the same chapters empty, the old draft beside', async () => {
    await laptop.locator('#editor p[data-eid="pa_1"]').click();
    await palette(laptop, 'Start a new draft from scratch');
    await laptop.locator('.ask .pill', { hasText: 'Start draft 2' }).click();
    await laptop.waitForSelector('.beside:not([hidden]) .bs-text .cmp-b');
    await sleep(400);
    await settle(laptop);
    const draft = live().find((r) => r.kind === 'draft');
    assert.equal(draft.parent_id, 'pr_n');
    assert.equal(draft.title, 'Draft 1');
    assert.equal(row('ac_1').parent_id, draft.id, 'the old act moved under the kept draft');
    assert.equal(row('pa_1').parent_id, 'ch_1', 'paragraphs untouched');
    assert.equal(row('no_1').parent_id, 'pa_2', 'notes untouched');
    const acts = live().filter((r) => r.kind === 'act' && r.parent_id === 'pr_n');
    assert.equal(acts.length, 1);
    const chs = live().filter((r) => r.kind === 'chapter' && r.parent_id === acts[0].id).sort((x, y) => x.sort - y.sort).map((c) => c.title);
    assert.deepEqual(chs, ['Chapter 1', 'The Gate']);
    assert.equal(row('pr_n').fields.draft, 2);
    assert.equal((await laptop.locator('#editor .ProseMirror').innerText()).trim(), '', 'a clean page');
    const beside = await laptop.locator('.beside .bs-text').innerText();
    assert.match(beside, /The rain fell on the dojo/);
    await laptop.keyboard.type('Rain all night on the dojo roof.');
    await laptop.keyboard.press('Enter');
    await laptop.keyboard.type('Kenji waited at the gate with his sword drawn.');
    await sleep(600);
    await shot(laptop, '4-new-draft-beside');
    await laptop.keyboard.press('Control+Shift+B');
    await sleep(200);
    assert.equal(await laptop.locator('.beside').isHidden(), true);
  });

  await check('compare: Draft 1 and now, side by side, changes marked, Claude’s words marked, Claude says which works', async () => {
    await laptop.keyboard.press('Control+Shift+X');
    await laptop.waitForSelector('html[data-view="compare"] .cmp-row.op-chg');
    assert.equal(await laptop.locator('.cmp-row.op-chg').count(), 2, 'both rewritten paragraphs pair with their old selves');
    const labels = await laptop.locator('.cmp-labels > div').allTextContents();
    assert.deepEqual(labels, ['Draft 1', 'Now']);
    assert.ok(await laptop.locator('.cmp-row.op-chg ins').count() > 0, 'words added are marked');
    assert.ok(await laptop.locator('.cmp-a .by-claude').count() === 1, 'the paragraph Claude wrote is marked');
    await laptop.locator('.cmp-tools .ghost-btn', { hasText: 'Ask Claude' }).click();
    await laptop.waitForSelector('.cmp-claude:not([hidden]) .cmp-point');
    assert.match(await laptop.locator('.cmp-point').textContent(), /Now is stronger.*Tighter/);
    const asked = await laptop.evaluate(() => window.__asked.at(-1));
    assert.equal(asked.task, 'compare');
    assert.equal(asked.a.label, 'Draft 1');
    await shot(laptop, '5-compare');
    // Following a link to a paragraph of the kept draft reads it here, not in the editor.
    await go(laptop, { view: 'write', chapterId: 'ch_1' });
    await laptop.waitForSelector('html[data-view="compare"]');
    await laptop.keyboard.press('Control+Shift+X');
    await laptop.waitForFunction(() => !document.documentElement.dataset.view);
  });

  await check('compare with a date: the text as it was, from history', async () => {
    await go(laptop, { view: 'compare', id: 'pr_n', a: { type: 'at', at: Date.now() - 864e5 * 30 }, b: { type: 'now' } });
    await laptop.waitForSelector('html[data-view="compare"] .cmp-labels');
    assert.match(await laptop.locator('.cmp-labels > div').first().textContent(), /^As of /);
  });

  let token = null;
  await check('share a link: the reader’s copy has the piece’s words only (no notes, no other pieces, no days)', async () => {
    await go(laptop, { view: 'project', id: 'pr_s' });
    await laptop.waitForSelector('html[data-view="project"]');
    await palette(laptop, 'Share a link to read');
    await laptop.locator('.share-panel .pill', { hasText: 'Make a link' }).waitFor();
    await shot(laptop, '6-share-ask');
    await laptop.locator('.share-panel .pill', { hasText: 'Make a link' }).click();
    await laptop.waitForSelector('.share-url');
    const url = await laptop.locator('.share-url').inputValue();
    assert.match(url, new RegExp(`^http://localhost:${PORT}/read\\.html#[A-Za-z0-9]{24}$`));
    token = url.split('#')[1];
    const s = shares.get(token);
    assert.equal(s.root_id, 'pr_s');
    assert.equal(s.world_id, 'wd_d');
    assert.equal(s.can_comment, true);
    const all = JSON.stringify(s.content);
    assert.match(all, /Mom flips a pancake/);
    assert.doesNotMatch(all, /Private|secret journal|rain fell|stranger/);
    assert.deepEqual(s.content.chapters[0].blocks.map((x) => x.id), ['sec_1', 'ps_1', 'ps_2', 'ps_3', 'ps_4']);
    await shot(laptop, '7-share-link');
    await settle(laptop);
    assert.equal(row('sh-pr_s').fields.token, token);
    await laptop.locator('.share-panel .pill', { hasText: 'Done' }).click();
  });

  await check('the reader’s page: the script in screenplay format, a comment on a paragraph, a reply', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, colorScheme: 'dark', hasTouch: true, isMobile: true });
    await ctx.exposeFunction('__remote', remote);
    await ctx.addInitScript(fake);
    const reader = await ctx.newPage();
    reader.errors = [];
    reader.on('pageerror', (e) => reader.errors.push(e.message));
    await reader.goto(`http://localhost:${PORT}/read.html#${token}`);
    await reader.waitForSelector('.rd-scene');
    assert.equal(await reader.locator('h1').textContent(), 'Reel 4');
    assert.equal(await reader.locator('.rd-scene').textContent(), '1INT. KITCHEN - MORNING');
    assert.equal(await reader.locator('.rd-character').textContent(), 'MOM');
    await reader.locator('.rd-action').tap();
    await reader.waitForSelector('#rd-bar:not([hidden])');
    await reader.locator('#rd-comment').tap();
    await reader.locator('#rd-text').fill('Love the pancake. Can Mom be grumpier?');
    await reader.locator('#rd-name').fill('Sam');
    await shot(reader, '8-reader-compose');
    await reader.locator('#rd-send').tap();
    await reader.waitForSelector('.rd-thread');
    assert.match(await reader.locator('.rd-thread').textContent(), /Sam.*Love the pancake/);
    assert.equal(comments[0].block, 'ps_2');
    await shot(reader, '9-reader-comment');
    reader.ctx = ctx;
    laptop.reader = reader;
    assert.deepEqual(reader.errors, []);
  });

  await check('the comment comes back as a margin note in Comments; a reply reaches the reader; resolve hides it', async () => {
    await laptop.evaluate(() => window.__sharing.refresh());
    await sleep(400);
    await go(laptop, { view: 'write', chapterId: 'ch_s' });
    await laptop.waitForSelector('#editor p[data-eid="ps_2"]');
    await laptop.evaluate(() => { if (!document.body.classList.contains('notes-on')) document.querySelector('[data-cmd="notes"]')?.click(); });
    await laptop.keyboard.press('Control+2').catch(() => {});
    await laptop.waitForSelector('.note-comment', { timeout: 5000 }).catch(async () => { await laptop.keyboard.press('Control+2'); await laptop.waitForSelector('.note-comment'); });
    assert.match(await laptop.locator('.note-comment').textContent(), /Sam.*Love the pancake/);
    await settle(laptop);
    const n = row(`cm-${comments[0].id}`);
    assert.equal(n.parent_id, 'ps_2');
    assert.equal(n.fields.chapter_id, 'ch_s');
    assert.equal(n.fields.by, 'reader:Sam');
    await laptop.locator('.note-comment .ghost-btn', { hasText: 'Reply' }).click();
    await laptop.keyboard.type('Grumpier it is.');
    await laptop.locator('.note-comment .pill', { hasText: 'Send' }).click();
    await laptop.waitForSelector('.nc-reply');
    await shot(laptop, '10-comment-in-margin');
    const reader = laptop.reader;
    await reader.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await reader.waitForFunction(() => /Grumpier it is/.test(document.querySelector('.rd-thread')?.textContent || ''));
    await laptop.locator('.note-comment .ghost-btn', { hasText: 'Resolve' }).click();
    await sleep(300);
    assert.equal(await laptop.locator('.note-comment').count(), 0);
    assert.equal(comments[0].resolved, true);
  });

  await check('new words reach the reader; turning the link off closes it', async () => {
    await laptop.locator('#editor p[data-eid="ps_4"]').click();
    await laptop.keyboard.press('End');
    await laptop.keyboard.type(' Now.');
    await sleep(800);
    await laptop.evaluate(() => window.__sharing.refresh());
    assert.match(JSON.stringify(shares.get(token).content), /Sit\. Now\./);
    const reader = laptop.reader;
    await reader.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await reader.waitForFunction(() => /Sit\. Now\./.test(document.body.textContent));
    await palette(laptop, 'Share a link to read');
    await laptop.locator('.share-panel .ghost-btn', { hasText: 'Stop sharing' }).click();
    await laptop.locator('.ask .pill', { hasText: 'Turn it off' }).click();
    await laptop.locator('.share-panel .pill', { hasText: 'Make a link' }).waitFor();
    assert.equal(shares.get(token).revoked, true);
    await reader.reload();
    await reader.waitForSelector('.rd-gone');
    assert.match(await reader.locator('.rd-gone').textContent(), /turned off/);
    await laptop.keyboard.press('Escape');
    await reader.ctx.close();
  });

  await check('a bible page shares as nested lines', async () => {
    await go(laptop, { view: 'notebook', pageId: 'pg_bible' });
    await laptop.waitForSelector('html[data-view="notebook"]');
    await sleep(400);
    await palette(laptop, 'Share a link to read');
    await laptop.locator('.share-panel .pill', { hasText: 'Make a link' }).click();
    await laptop.waitForSelector('.share-url');
    const t = (await laptop.locator('.share-url').inputValue()).split('#')[1];
    const s = shares.get(t);
    assert.equal(s.kind, 'page');
    assert.deepEqual(s.content.chapters[0].blocks.map((x) => [x.k, x.d, x.r[0][0]]), [['line', 0, 'Sixteen, stubborn'], ['line', 1, 'Hates rain']]);
    await laptop.keyboard.press('Escape');
  });

  await check('on a phone: compare reads as one column', async () => {
    const phone = await device({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    await settle(phone);
    await go(phone, { view: 'compare', id: 'pr_n' });
    await phone.waitForSelector('html[data-view="compare"] .cmp-row.op-chg');
    const shown = await phone.evaluate(() => [...document.querySelectorAll('.cmp-row.op-chg')].map((r) => [getComputedStyle(r.querySelector('.cmp-a')).display, getComputedStyle(r.querySelector('.cmp-i')).display])[0]);
    assert.deepEqual(shown, ['none', 'block']);
    await shot(phone, '11-phone-compare');
    assert.deepEqual(phone.errors, []);
  });

  await check('no page errors', async () => assert.deepEqual(laptop.errors, []));
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
