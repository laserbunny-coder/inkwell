// How Inkwell copes with very long pages. Not part of npm test: measurement only.
// Seeds an account through a stand-in for the server (like the tests), then for
// each size and page type measures opening, typing lag, outline keys, fold and
// zoom, paste, scrolling, saving and search, on desktop and on a throttled phone.
// Run: node tests/perf/longpages.mjs   SIZES=500,2000 MODES=desktop,phone
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const SIZES = (process.env.SIZES || '500,2000,5000,10000').split(',').map(Number);
const MODES = (process.env.MODES || 'desktop,phone').split(',');
const ONLYPAGES = process.env.PAGES ? process.env.PAGES.split(',') : null;
const OUT = process.env.OUT || 'perf-results.json';
const PORT = 4277;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(1500);
const APP = `http://localhost:${PORT}/`;

const DAY = 864e5;
const now = Date.now();
const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// ---------- made-up text ----------
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const WORDS = 'the lighthouse keeper counted ships while his sister read the log aloud and gulls wheeled over salt grey water a lamp burned through fog she wrote letters nobody answered rope tide harbour bread kitchen window morning quietly remembered never stairs brass winter storm night ninja bakery grandpa rolling pin kenji vanish song reel shot scene light shadow dream market train coffee notebook pencil archive island boat'.split(' ');
const sentence = (n = 8 + Math.floor(rnd() * 12)) => {
  const w = Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]);
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return `${w.join(' ')}.`;
};
const para = () => Array.from({ length: 3 + Math.floor(rnd() * 4) }, () => sentence()).join(' ');

// ---------- the account ----------
function account(size) {
  seed = 7;
  const table = new Map();
  let clock = now - 6 * 3600e3;
  const stamp = () => new Date((clock += 1)).toISOString();
  const put = (r) => {
    table.set(r.id, { parent_id: null, sort: 0, title: '', text: '', content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false, ...r, created_at: new Date(r.created_at || now - DAY).toISOString(), user_id: 'u1', updated_at: stamp() });
  };
  const txt = (t) => [{ type: 'text', text: t }];
  put({ id: 'area-writing', kind: 'area', title: 'Writing', sort: 1, fields: { color: '#9A4A2E' } });
  put({ id: 'wd_perf', kind: 'world', title: 'Long pages', area_id: 'area-writing', fields: { shape: 'one' } });

  // Outline page, 3 levels, with one parent holding up to 1,000 lines.
  const lines = (parentPage, count, { big }) => {
    let n = 0;
    const line = (parent, text, sort) => { const id = `li_${parentPage}_${n++}`; put({ id, kind: 'line', parent_id: parent, sort, text, content: txt(text), fields: { done: false } }); return id; };
    if (big) {
      const kids = Math.min(1000, Math.floor(count * 0.3));
      const bp = line(parentPage, 'BIGPARENT holds many lines', 512);
      for (let k = 0; k < kids && n < count; k++) line(bp, sentence(), (k + 1) * 1024);
    }
    let top = 0;
    while (n < count) {
      const t = line(parentPage, `${n === count - 1 ? 'ENDMARK ' : ''}${sentence()}`, (++top + 1) * 1024);
      const kids = Math.floor(rnd() * 4);
      for (let k = 0; k < kids && n < count; k++) {
        const c = line(t, `${n === count - 1 ? 'ENDMARK ' : ''}${sentence()}`, (k + 1) * 1024);
        const gk = Math.floor(rnd() * 3);
        for (let g = 0; g < gk && n < count; g++) line(c, `${n === count - 1 ? 'ENDMARK ' : ''}${sentence()}`, (g + 1) * 1024);
      }
    }
    return n;
  };
  put({ id: 'pg_outline', kind: 'page', parent_id: 'wd_perf', title: 'Long outline', sort: 1024 });
  lines('pg_outline', size, { big: true });
  put({ id: `day-${today}`, kind: 'day', title: today, created_at: now });
  lines(`day-${today}`, size, { big: false });

  // Novel chapter of prose paragraphs.
  put({ id: 'pr_novel', kind: 'project', parent_id: 'wd_perf', title: 'Long novel', area_id: 'area-writing', sort: 1, fields: { type: 'novel', levels: ['Act', 'Chapter'], label: 'Novel', stage: 'Drafted' } });
  put({ id: 'ac_novel', kind: 'act', parent_id: 'pr_novel', title: 'Act One', sort: 1024 });
  put({ id: 'ch_novel', kind: 'chapter', parent_id: 'ac_novel', title: 'One long chapter', sort: 1024 });
  for (let i = 0; i < size; i++) { const t = `${i === size - 1 ? 'ENDMARK ' : ''}${para()}`; put({ id: `pn_${i}`, kind: 'para', parent_id: 'ch_novel', sort: (i + 1) * 1024, text: t, content: txt(t) }); }

  // Screenplay.
  put({ id: 'pr_script', kind: 'project', parent_id: 'wd_perf', title: 'Long script', area_id: 'area-writing', sort: 2, fields: { type: 'screenplay', label: 'Film', stage: 'Written' } });
  put({ id: 'ac_script', kind: 'act', parent_id: 'pr_script', title: 'Screenplay', sort: 1024 });
  put({ id: 'ch_script', kind: 'chapter', parent_id: 'ac_script', title: 'Script', sort: 1024 });
  const EL = ['scene', 'action', 'character', 'dialogue', 'character', 'dialogue', 'action'];
  for (let i = 0; i < size; i++) {
    const el = EL[i % EL.length];
    let t = el === 'scene' ? `INT. LIGHTHOUSE ${i} - NIGHT` : el === 'character' ? (i % 2 ? 'MARA' : 'KENJI') : el === 'dialogue' ? sentence() : `${sentence()} ${sentence()}`;
    if (i === size - 1) t = `ENDMARK ${t}`;
    put({ id: `ps_${i}`, kind: 'para', parent_id: 'ch_script', sort: (i + 1) * 1024, text: t, content: txt(t), fields: { el } });
  }
  return table;
}

// ---------- in-page helpers ----------
const fake = () => {
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    async upload() {}, async download() { throw new Error('not found'); },
    subscribe() {}, unsubscribe() {}
  };
  // Keydown to the paint after it.
  window.__lat = [];
  addEventListener('keydown', (e) => {
    const t = performance.now();
    const key = e.key;
    requestAnimationFrame(() => setTimeout(() => window.__lat.push({ key, ms: performance.now() - t }), 0));
  }, true);
  // Long tasks (main thread blocked > 50 ms).
  window.__long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
  // What each save writes.
  window.__saves = { ls: 0, lsBytes: 0, idb: 0, idbBytes: 0 };
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { window.__saves.ls++; window.__saves.lsBytes += String(v).length; return set.call(this, k, v); };
  for (const m of ['put', 'add']) {
    const orig = IDBObjectStore.prototype[m];
    IDBObjectStore.prototype[m] = function (v, k) {
      window.__saves.idb++;
      const sk = `${this.name}:${(v && v.kind) || ''}`; window.__saves.by = window.__saves.by || {}; window.__saves.by[sk] = (window.__saves.by[sk] || 0) + 1;
      try { window.__saves.idbBytes += JSON.stringify(v).length; } catch {}
      return orig.call(this, v, k);
    };
  }
};

const ED = { outline: '#outline-editor', day: '#outline-editor', novel: '#editor', script: '#editor' };
const PLACE = {
  outline: { view: 'notebook', pageId: 'pg_outline' },
  day: { view: 'notebook', pageId: `day-${today}` },
  novel: { view: 'write', chapterId: 'ch_novel' },
  script: { view: 'write', chapterId: 'ch_script' }
};
const edVar = (type) => (ED[type] === '#outline-editor' ? '__outline' : '__editor');

const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };

async function openPage(page, type) {
  // Away first, so it's a real open.
  await page.evaluate(() => { const pl = { view: 'library', area: null }; history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); });
  await sleep(1200);
  await page.evaluate(() => { window.__long.length = 0; });
  return page.evaluate(async ({ place, v }) => {
    const t0 = performance.now();
    history.pushState(place, ''); dispatchEvent(new PopStateEvent('popstate', { state: place }));
    const has = () => { const ed = window[v]; if (!ed || ed.isDestroyed) return false; const d = ed.state.doc; return d.textBetween(Math.max(0, d.content.size - 3000), d.content.size, '\n').includes('ENDMARK'); };
    for (;;) {
      await new Promise((r) => setTimeout(r, 10));
      if (has()) break;
      if (performance.now() - t0 > 120000) return { ms: -1 };
    }
    const loaded = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const painted = performance.now() - t0;
    const blocks = window[v].state.doc.content.size;
    return { loadedMs: Math.round(loaded), ms: Math.round(painted), docSize: blocks, longest: Math.round(Math.max(0, ...window.__long)) };
  }, { place: PLACE[type], v: edVar(type) });
}

// Caret at the end of the first, middle or last block of words.
const caret = (page, type, where) => page.evaluate(({ v, where }) => {
  const ed = window[v];
  const ends = [];
  ed.state.doc.descendants((n, pos) => { if (n.isTextblock) { ends.push(pos + 1 + n.content.size); return false; } return true; });
  const at = where === 'top' ? ends[1] ?? ends[0] : where === 'middle' ? ends[Math.floor(ends.length / 2)] : ends[ends.length - 1];
  ed.commands.focus();
  ed.commands.setTextSelection(at);
  ed.view.dom.ownerDocument.defaultView.getSelection(); // settle
  const dom = ed.view.domAtPos(at).node;
  (dom.nodeType === 1 ? dom : dom.parentElement).scrollIntoView({ block: 'center' });
}, { v: edVar(type), where });

async function typeLag(page, type, where, phone) {
  await caret(page, type, where);
  await sleep(500);
  await page.evaluate(() => { window.__lat.length = 0; window.__long.length = 0; Object.assign(window.__saves, { ls: 0, lsBytes: 0, idb: 0, idbBytes: 0, by: {} }); });
  let prof = null;
  if (process.env.PROFILE && where === 'middle') { prof = await page.context().newCDPSession(page); await prof.send('Profiler.enable'); await prof.send('Profiler.start'); }
  await page.keyboard.type(' quick brown words', { delay: phone ? 140 : 90 });
  if (prof) {
    const { profile } = await prof.send('Profiler.stop');
    const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); });
    console.log(`  PROFILE ${type}:`, [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${Math.round(v)}ms ${k}`).join('\n    '));
  }
  await sleep(2500); // let saves land
  return page.evaluate(() => ({ lat: window.__lat.map((x) => x.ms), long: [...window.__long], saves: { ...window.__saves } }));
}

async function measureKeys(page, list) {
  await page.evaluate(() => { window.__lat.length = 0; });
  for (const k of list) { await page.keyboard.press(k); await sleep(250); }
  await sleep(300);
  return page.evaluate(() => window.__lat.map((x) => [x.key, Math.round(x.ms)]));
}

const paint = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))';
const foldZoom = (page) => page.evaluate(async () => {
  const ed = window.__outline, fk = window.__foldKey;
  let eid = null;
  ed.state.doc.descendants((n) => { if (eid) return false; if (n.type.name === 'listItem' && n.textContent.startsWith('BIGPARENT')) eid = n.attrs.eid; return !eid; });
  const pt = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const time = async (meta) => { const t = performance.now(); ed.view.dispatch(ed.state.tr.setMeta(fk, meta)); await pt(); return Math.round(performance.now() - t); };
  const st = fk.getState(ed.state);
  const startFolded = st.folded.has(eid);
  const out = {};
  if (startFolded) { out.unfold = await time({ fold: eid, on: false }); out.fold = await time({ fold: eid, on: true }); } else { out.fold = await time({ fold: eid, on: true }); out.unfold = await time({ fold: eid, on: false }); }
  out.zoomIn = await time({ zoom: eid });
  out.zoomOut = await time({ zoom: null });
  return out;
});

const scroll = (page, type) => page.evaluate(async (sel) => {
  let el = document.querySelector(`${sel} .ProseMirror`);
  while (el && !(el.scrollHeight > el.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  el = el || document.scrollingElement;
  el.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 300));
  const frames = [];
  let last = performance.now();
  const total = el.scrollHeight;
  const step = Math.max(200, Math.ceil(total / 240));
  await new Promise((done) => {
    const tick = () => {
      const t = performance.now(); frames.push(t - last); last = t;
      el.scrollTop += step;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2 || frames.length > 260) done(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  frames.shift();
  const s = [...frames].sort((a, b) => a - b);
  return { frames: frames.length, heightPx: total, p50: Math.round(s[Math.floor(s.length / 2)]), p95: Math.round(s[Math.floor(s.length * 0.95)]), worst: Math.round(s[s.length - 1]), slowFrames: frames.filter((f) => f > 34).length };
}, ED[type]);

async function search(page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+F');
  await page.waitForFunction(() => document.activeElement?.id === 'palette-input', null, { timeout: 30000 });
  const t0 = Date.now();
  await page.keyboard.type('lighthouse kenji');
  await page.waitForFunction(() => document.querySelector('#palette-input').value === 'lighthouse kenji');
  await page.waitForFunction(() => { const l = document.querySelector('#palette-list'); return l && !l.textContent.includes('Looking…') && l.children.length > 0; }, null, { timeout: 120000 }).catch(() => {});
  const ms = Date.now() - t0;
  const n = await page.locator('#palette-list li').count();
  // A second search, index already built.
  await page.fill('#palette-input', '');
  const t1 = Date.now();
  await page.keyboard.type('salt brass');
  await page.waitForFunction(() => { const l = document.querySelector('#palette-list'); return l && !l.textContent.includes('Looking…') && l.children.length > 0; }, null, { timeout: 120000 }).catch(() => {});
  const again = Date.now() - t1;
  await page.keyboard.press('Escape');
  return { firstMs: ms, againMs: again, results: n };
}

async function pasteLines(page) {
  await caret(page, 'outline', 'end');
  await sleep(300);
  const text = Array.from({ length: 2000 }, (_, i) => `${i === 1999 ? 'PASTEEND ' : ''}Pasted line ${i} about the harbour and the tide`).join('\n');
  await page.evaluate(() => { window.__long.length = 0; });
  return page.evaluate(async (text) => {
    const ed = window.__outline;
    const t0 = performance.now();
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    ed.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    for (;;) { if (ed.state.doc.textContent.includes('PASTEEND')) break; await new Promise((r) => setTimeout(r, 10)); if (performance.now() - t0 > 120000) return { ms: -1 }; }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ms = Math.round(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 3000));
    return { ms, longest: Math.round(Math.max(0, ...window.__long)), blockedAfter: Math.round(window.__long.reduce((a, b) => a + b, 0)) };
  }, text);
}

// ---------- run ----------
const results = existsSync(OUT) ? JSON.parse((await import('node:fs')).readFileSync(OUT, 'utf8')) : {};
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 1));

for (const size of SIZES) {
  const table = account(size);
  const remote = (op, arg) => {
    if (op === 'push') return arg.map((r) => { const at = new Date().toISOString(); return { id: r.id, updated_at: at }; });
    if (op === 'pull') return [...table.values()].filter((r) => r.updated_at > arg.since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(arg.from, arg.from + 500);
  };
  const dir = `/tmp/claude-perf-profile-${size}`;
  mkdirSync(dir, { recursive: true });
  for (const mode of MODES) {
    const phone = mode === 'phone';
    const opts = phone ? { ...devices['Pixel 7'] } : { viewport: { width: 1440, height: 900 } };
    const ctx = await chromium.launchPersistentContext(dir, { ...opts, timezoneId: 'America/Los_Angeles', locale: 'en-US', args: ['--enable-precise-memory-info'] });
    await ctx.exposeFunction('__remote', remote);
    await ctx.addInitScript(fake);
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message));
    const t0 = Date.now();
    await page.goto(APP);
    await page.waitForSelector('#editor .ProseMirror', { state: 'attached', timeout: 120000 });
    await page.waitForFunction(() => window.__sync && !window.__sync.running, null, { timeout: 600000 }).catch(() => {});
    await page.evaluate(() => window.__sync.run());
    await page.waitForFunction(() => window.__sync && !window.__sync.running, null, { timeout: 600000 }).catch(() => {});
    console.log(`size ${size} ${mode}: app ready + synced in ${Date.now() - t0} ms`);
    let cdp = null;
    if (phone) { cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    const r = results[`${size}-${mode}`] = { size, mode };
    for (const type of ['outline', 'day', 'novel', 'script']) {
      if (ONLYPAGES && !ONLYPAGES.includes(type)) continue;
      try {
        const o = r[type] = {};
        o.open = await openPage(page, type);
        o.open2 = await openPage(page, type);
        console.log(`  ${type} open ${o.open.ms} / ${o.open2.ms} ms`);
        await sleep(800);
        o.typing = {};
        for (const where of ['top', 'middle', 'end']) {
          const t = await typeLag(page, type, where, phone);
          o.typing[where] = { p50: pct(t.lat, 0.5), p95: pct(t.lat, 0.95), max: Math.round(Math.max(...t.lat)), longTasks: t.long.length, blocked: Math.round(t.long.reduce((a, b) => a + b, 0)), saves: t.saves };
          console.log(`  ${type} type ${where}: p50 ${o.typing[where].p50} p95 ${o.typing[where].p95} max ${o.typing[where].max}; saves ${JSON.stringify(t.saves)}`);
        }
        if (type === 'outline' || type === 'day') {
          await caret(page, type, 'middle'); await sleep(400);
          o.keys = await measureKeys(page, ['Enter', 'x', 'Tab', 'Shift+Tab', 'Home', 'Backspace', 'Alt+Shift+ArrowUp', 'Alt+Shift+ArrowDown']);
          console.log(`  ${type} keys ${JSON.stringify(o.keys)}`);
        }
        if (type === 'outline') { o.foldZoom = await foldZoom(page); console.log(`  fold/zoom ${JSON.stringify(o.foldZoom)}`); }
        o.scroll = await scroll(page, type);
        console.log(`  ${type} scroll ${JSON.stringify(o.scroll)}`);
      } catch (e) { console.log(`  ${type} FAILED ${e.message.split('\n')[0]}`); r[type] = { error: e.message.split('\n')[0] }; }
      save();
    }
    try { r.search = await search(page); console.log(`  search ${JSON.stringify(r.search)}`); } catch (e) { console.log('  search failed', e.message.split('\n')[0]); }
    if (!ONLYPAGES || ONLYPAGES.includes('outline')) {
      try { await openPage(page, 'outline'); r.paste = await pasteLines(page); console.log(`  paste 2000 ${JSON.stringify(r.paste)}`); } catch (e) { console.log('  paste failed', e.message.split('\n')[0]); }
    }
    r.heapMB = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6));
    console.log(`  heap ${r.heapMB} MB`);
    save();
    await ctx.close();
    // Pasted lines would grow the page for the next mode: start the next mode from a fresh copy.
    const { rmSync } = await import('node:fs'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  }
}
await sleep(200);
server.kill();
process.exit(0);
