// Makes the README screenshots: fills a fresh, local-only copy of the app with
// made-up writing, then photographs the main views at desktop and phone size.
// Nothing here touches a real account: the dev server runs with sync off.
// Run: node docs/screenshots/capture.mjs   (with Playwright installed)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

const OUT = fileURLToPath(new URL('.', import.meta.url));
const PORT = 4191;
const server = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(2500);
const APP = `http://localhost:${PORT}/`;

// ---------- the made-up library ----------

function seed() {
  return (async () => {
    const { putEntries, setMeta } = await import('/src/db.js');
    const { entry, newId, wordCount, DEFAULT_NOTE_TYPES } = await import('/src/model.js');
    const DAY = 864e5;
    const now = Date.now();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const rows = [];
    const add = (kind, f) => { const e = entry(kind, { id: newId(kind.slice(0, 2)), ...f }); rows.push(e); return e; };
    const ref = (e) => ({ type: 'entryRef', attrs: { id: e.id, title: e.title } });
    const txt = (t) => ({ type: 'text', text: t });
    const flat = (content) => content.map((n) => n.text || n.attrs.title).join('');

    // Areas, nested like Michael's: Writing › Novels › Working.
    const area = (id, title, color, parent, sort) => { const a = entry('area', { id, title, parent_id: parent, sort, fields: { color } }); rows.push(a); return a; };
    area('area-writing', 'Writing', '#9A4A2E', null, 1);
    area('area-filmmaking', 'Filmmaking', '#1F6F64', null, 2);
    area('area-business', 'Business', '#5B6E8C', null, 3);
    area('area-personal', 'Personal', '#8C5B7A', null, 4);
    const novels = area('ar_novels', 'Novels', '#A8743A', 'area-writing', 1);
    const working = area('ar_working', 'Working', '#8C7A5B', novels.id, 1);
    area('ar_past', 'Past', '#4E6B3A', novels.id, 2);
    const research = area('ar_research', 'Research', '#7A5BA8', 'area-writing', 2);

    // ----- a novel -----
    const book = add('project', { title: 'The Salt Keeper', area_id: working.id, fields: { type: 'novel', levels: ['Act', 'Chapter', 'Scene'] }, created_at: now - 40 * DAY });
    const acts = [['Act One', ['The Logbook', 'Low Tide', 'What the Gulls Knew']], ['Act Two', ['The Mainland', 'Fog Signal', 'A Letter Unsent']], ['Act Three', ['Lamp Room']]];
    let mainChapter;
    acts.forEach(([title, chapters], i) => {
      const act = add('act', { parent_id: book.id, title, sort: (i + 1) * 1024 });
      chapters.forEach((c, j) => {
        const ch = add('chapter', { parent_id: act.id, title: `${j + 1 + (i ? acts.slice(0, i).reduce((n, a) => n + a[1].length, 0) : 0)}. ${c}`, sort: (j + 1) * 1024 });
        if (i === 0 && j === 0) mainChapter = ch;
        else if (i < 2) {
          // Other chapters get some words, so the counts and progress look lived in.
          const t = 'The wind came round to the east and stayed there for three days, and nobody on the island spoke of anything else. The boats stayed in, the nets dried on the wall, and the light burned a little longer every evening.';
          for (let k = 0; k < 14; k++) add('para', { parent_id: ch.id, sort: (k + 1) * 1024, text: t, content: [txt(t)], created_at: now - (4 + ((i * 3 + j) * 5 + k * 3) % 24) * DAY });
        }
      });
    });

    // Research pages the novel links to.
    const lensPage = add('page', { parent_id: book.id, title: 'Fresnel lens', sort: 2048 });
    const ideaPage = add('page', { parent_id: book.id, title: 'Idea', sort: 1024 });
    const marenPage = add('page', { parent_id: book.id, title: 'Maren (character)', sort: 3072 });

    const paras = [
      [txt('The logbook was heavier than she expected, the way a sleeping cat is heavier than a cat. Maren carried it down the iron stairs with both arms, counting the steps out of habit, and set it on the kitchen table beside the cold kettle.')],
      [txt('Her brother had kept it for eleven years. Every entry began the same: the date, the wind, the state of the sea, the hour the lamp was lit. After that his handwriting loosened, as if the lamp had been the only thing that needed him to be careful.')],
      [txt('“Fog at four. Lit early. Saw the ferry turn back.” She read it twice. The ferry had not turned back in the story everyone told on the mainland.')],
      [txt('Outside, the gulls were working the tideline. The island was small enough that you could hear the whole of it at once: water on three sides, wind on the fourth, and in the middle a tower that had been built to be seen, not to see.')],
      [txt('She found the first letter folded into the back cover, pressed flat by years of weight. It was addressed to her. It had never been sent.')],
      'scene',
      [txt('By morning the lamp had gone out on its own. Maren climbed up to the lamp room and stood inside the great glass of the '), null, txt(', where the light was broken into rings, and for a moment the whole sea looked like the inside of a shell.')],
      [txt('She had come to close the station. That was the job, the letter from the board had said so in three careful paragraphs. Nobody had said anything about reading.')],
      [txt('She opened the log again at the last page. Under the final entry, in pencil, so light it might have been the grain of the paper, her brother had written a single word: '), txt('wait'), txt('.')]
    ];
    const paraRows = [];
    paras.forEach((p, i) => {
      if (p === 'scene') { add('scene', { parent_id: mainChapter.id, sort: (i + 1) * 1024, title: 'Next morning' }); return; }
      const content = p.map((n) => n || ref(lensPage));
      paraRows.push(add('para', { parent_id: mainChapter.id, sort: (i + 1) * 1024, text: flat(content), content, links: content.filter((n) => n.type === 'entryRef').map((n) => n.attrs.id), created_at: now - (i < 5 ? 3 : 1) * DAY }));
    });

    // Margin notes on a few paragraphs.
    const note = (para, type, text) => add('note', { parent_id: para.id, type, text, tags: [], fields: { chapter_id: mainChapter.id } });
    note(paraRows[0], 'writing', 'Open on weight. The logbook is the brother: she carries him down the stairs.');
    note(paraRows[2], 'writing', 'Plant the ferry here. The mainland version gets told in ch. 4, and it should contradict this line.');
    note(paraRows[3], 'directing', 'If this ever goes to screen: one long wide, no music, just wind.');
    note(paraRows[6], 'production', 'Check: did keepers really light early in fog? Ask the harbour museum.');

    // Idea page, Maren page, lens page.
    const lines = (parent, items, depth = 0, base = now - 5 * DAY) => items.forEach((it, i) => {
      const [content, kids] = Array.isArray(it) && Array.isArray(it[0]) ? it : [typeof it === 'string' ? [txt(it)] : it, null];
      const text = flat(content);
      const tags = [...text.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase());
      const l = add('line', { parent_id: parent, sort: (i + 1) * 1024, text, content, tags, links: content.filter((n) => n.type === 'entryRef').map((n) => n.attrs.id), fields: { done: false }, created_at: base });
      if (kids) lines(l.id, kids, depth + 1, base);
    });
    lines(ideaPage.id, [
      'A lighthouse keeper dies; his sister comes to close the station and finds the log tells a different story.',
      [[txt('Questions')], ['What did he see the night the ferry sank?', 'Why did he never send the letters?', 'Who on the mainland needs the old story to stay true?']],
      [[txt('Tone')], ['Quiet, salt-worn, patient. Weather as a character.', 'Every chapter opens with a log entry.']]
    ]);
    lines(marenPage.id, [
      'Forty-one. Archivist in the city. Hasn’t been back in twenty years.',
      'Counts things when she’s anxious: stairs, gulls, rings in the lens.',
      [[txt('Wants')], ['To close the station and leave by the Friday boat.']],
      [[txt('Needs')], ['To admit she left him there.']]
    ]);
    lines(lensPage.id, [
      'First-order lenses stand taller than a person. Hundreds of glass prisms in brass rings.',
      'Light bent into a beam that carries 20+ miles. #research',
      'Keepers wore linen aprons so nothing would scratch the glass. #detail'
    ]);

    // ----- a screenplay -----
    const film = add('project', { title: 'Night Ferry', area_id: 'area-filmmaking', fields: { type: 'screenplay', levels: ['Act', 'Script', 'Scene'] }, created_at: now - 20 * DAY });
    const fa = add('act', { parent_id: film.id, title: 'Screenplay', sort: 1024 });
    const script = add('chapter', { parent_id: fa.id, title: 'Script', sort: 1024 });
    [['scene', 'EXT. HARBOUR - NIGHT'], ['action', 'Rain on black water. A single ferry idles at the dock, its windows yellow. DEL (60s), oilskin coat, unties the last rope.'],
      ['character', 'DEL'], ['paren', '(to no one)'], ['dialogue', 'Last one out. Always the last one out.'],
      ['action', 'Up on the headland, the lighthouse beam swings past. Then stops.'], ['character', 'DEL'], ['dialogue', 'That’s not right.'],
      ['transition', 'CUT TO:'], ['scene', 'INT. LAMP ROOM - CONTINUOUS'], ['action', 'TOM (40s) stands at the dark lens, a match burning down to his fingers.']]
      .forEach(([el, text], i) => add('para', { parent_id: script.id, sort: (i + 1) * 1024, text, content: [txt(text)], fields: { el }, created_at: now - 8 * DAY }));
    add('page', { parent_id: film.id, title: 'Idea', sort: 1024 });

    // ----- a notes collection and a loose page -----
    const coll = add('project', { title: 'Coastal research', area_id: research.id, fields: { type: 'notes' } });
    const tides = add('page', { parent_id: coll.id, title: 'Tide tables', sort: 1024 });
    lines(tides.id, ['Spring tides twice a month, at new and full moon. #research', 'The causeway floods two hours either side of high water.']);
    add('page', { parent_id: coll.id, title: 'Shipwrecks 1890–1930', sort: 2048 });
    const shorts = add('project', { title: 'Short stories', area_id: novels.id, fields: { type: 'notes' } });
    ['The Ferryman’s Wife', 'Small Hours', 'Weather Report'].forEach((title, i) => add('page', { parent_id: shorts.id, title, sort: (i + 1) * 1024 }));
    const pitch = add('project', { title: 'Documentary pitch', area_id: 'area-filmmaking', fields: { type: 'notes' } });
    ['Logline', 'Interview list'].forEach((title, i) => add('page', { parent_id: pitch.id, title, sort: (i + 1) * 1024 }));
    add('page', { parent_id: null, title: 'Books to read', sort: 1024 });

    // ----- daily pages -----
    const day = (offset, items) => {
      const d = iso(now - offset * DAY);
      const page = entry('day', { id: `day-${d}`, title: d, created_at: now - offset * DAY, updated_at: now - offset * DAY });
      rows.push(page);
      lines(page.id, items, 0, now - offset * DAY);
    };
    day(0, [
      [[txt('Morning pages')], ['Slept badly. Dreamed about the lamp room again, which is probably useful.', [[txt('The rings of the lens look like a shell from inside. Use it in '), ref(mainChapter), txt('.')]]]],
      [[txt('Writing')], [
        [[txt('Finish the scene break in '), ref(mainChapter)]],
        [[txt('Ferry backstory: who was on board? See '), ref(marenPage)]],
        'Read the chapter aloud before bed. #revision'
      ]],
      [[txt('Research')], [[[txt('Ask the harbour museum about fog procedure. #research')]], [[txt('Notes on '), ref(lensPage)]]]],
      'Call Dad about Sunday.'
    ]);
    day(1, ['Wrote 900 words. The letter scene finally works. #progress', [[txt('Idea: every chapter opens with a log entry. Added to '), ref(ideaPage)]], 'Walk by the river, 40 min.']);
    day(2, ['Outlined Act Two on a napkin. Transcribe it.', 'Night Ferry: the beam stops. That’s the inciting image. #film']);
    day(4, ['First draft of chapter one done. #progress']);

    // Word counts per chapter (the app keeps them on the chapter), and edit times that look lived in.
    for (const ch of rows.filter((r) => r.kind === 'chapter')) {
      ch.fields = { ...ch.fields, words: rows.filter((r) => r.parent_id === ch.id && r.kind === 'para').reduce((n, r) => n + wordCount(r.text), 0) };
    }
    const ago = { 'Night Ferry': 2, 'Coastal research': 3, 'Short stories': 9, 'Documentary pitch': 16, 'Books to read': 5, 'Fresnel lens': 1, 'Maren (character)': 4, 'Idea': 1 };
    for (const r of rows) if (r.title in ago) r.updated_at = now - ago[r.title] * DAY - 3600e3;
    await putEntries(rows, { fromSync: true });
    await setMeta('areasSeeded', true);
    await setMeta('noteTypes', DEFAULT_NOTE_TYPES);
    await setMeta('lastChapter', mainChapter.id);
    await setMeta(`lastChapter:${book.id}`, mainChapter.id);
    return { chapter: mainChapter.id, book: book.id, film: script.id, lens: lensPage.id, idea: ideaPage.id, today: `day-${iso(now)}` };
  })();
}

// ---------- the photographs ----------

const browser = await chromium.launch();

async function session(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  // A blank page on the app's own address, so the data can go in before the app first runs.
  await page.route(`${APP}seed.html`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }));
  await page.goto(`${APP}seed.html`);
  const ids = await page.evaluate(seed);
  return { ctx, page, ids };
}

async function open(page, place, extra = {}) {
  await page.evaluate(([p, x]) => {
    localStorage.setItem('place', JSON.stringify(p));
    for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v);
  }, [place, extra]);
  await page.goto(APP);
  await page.waitForSelector('#editor .ProseMirror', { state: 'attached' });
  await sleep(1200);
}

// Saved as WebP, desktop 2000px wide and phone 780px wide (like Daybook's), so the README loads quickly.
const shot = async (page, name, { top = true } = {}) => {
  const { width, height } = page.viewportSize();
  await page.mouse.move(width - 8, Math.round(height * 0.6));
  if (top) await toTop(page);
  await sleep(500);
  const png = (await page.screenshot()).toString('base64');
  const webp = await page.evaluate(async ([data, w]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round(img.height * (w / img.width));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', 0.9).split(',')[1];
  }, [png, width > 600 ? 2000 : 780]);
  writeFileSync(`${OUT}${name}.webp`, Buffer.from(webp, 'base64'));
  console.log('saved', name);
};
const toTop = (page) => page.evaluate(() => { scrollTo(0, 0); for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0; });
// Notes measure their cards while the column is still sliding in; settle them once it's there.
const settleNotes = (page) => page.evaluate(() => {
  for (const t of document.querySelectorAll('.note textarea')) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }
  dispatchEvent(new Event('resize'));
});
const blur = (page) => page.evaluate(() => { document.activeElement?.blur(); getSelection()?.removeAllRanges(); });

for (const theme of ['light', 'dark']) {
  const { ctx, page, ids } = await session({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
  const t = { theme };
  // Dark is the main look (it's what Michael writes in); one light shot shows the other theme.
  if (theme === 'dark') {
    // Writing, notes beside the text.
    await open(page, { view: 'write', chapterId: ids.chapter }, t);
    await blur(page);
    await toTop(page);
    await page.keyboard.press('Control+2');
    await sleep(800);
    await settleNotes(page);
    await shot(page, 'desktop-manuscript-notes');

    // Focus mode: just the text.
    await page.keyboard.press('Control+2');
    await page.locator('#editor .ProseMirror p').nth(3).click();
    await page.keyboard.press('Control+.');
    await sleep(900);
    await shot(page, 'desktop-focus');
    await page.keyboard.press('Control+.');

    // Outline at the left edge, pinned.
    await open(page, { view: 'write', chapterId: ids.chapter }, t);
    await page.keyboard.press('Control+1');
    await sleep(600);
    await blur(page);
    await shot(page, 'desktop-outline');
    await page.keyboard.press('Control+1');

    // Command menu.
    await open(page, { view: 'write', chapterId: ids.chapter }, t);
    await sleep(400);
    await page.keyboard.press('Control+k');
    await sleep(600);
    await shot(page, 'desktop-command-menu');
    await page.keyboard.press('Escape');

    // Today's page.
    await open(page, { view: 'notebook', pageId: ids.today }, t);
    await blur(page);
    await shot(page, 'desktop-today');

    // Library.
    await open(page, { view: 'library', area: null }, t);
    await shot(page, 'desktop-library');

    // A book's home.
    await open(page, { view: 'project', id: ids.book }, t);
    await shot(page, 'desktop-book');

    // Screenplay.
    await open(page, { view: 'write', chapterId: ids.film }, t);
    await blur(page);
    await shot(page, 'desktop-screenplay');

    // Progress.
    await open(page, { view: 'write', chapterId: ids.chapter }, t);
    await page.keyboard.press('Control+Shift+P');
    await sleep(900);
    await shot(page, 'desktop-progress');
  } else {
    await open(page, { view: 'write', chapterId: ids.chapter }, t);
    await blur(page);
    await toTop(page);
    await page.keyboard.press('Control+2');
    await sleep(800);
    await settleNotes(page);
    await shot(page, 'desktop-manuscript-light');
  }
  await ctx.close();
}

// Phone (Android-sized), touch.
{
  const { ctx, page, ids } = await session({ viewport: { width: 412, height: 870 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const t = { theme: 'dark' };
  await open(page, { view: 'write', chapterId: ids.chapter }, t);
  await blur(page);
  await shot(page, 'phone-manuscript');

  await open(page, { view: 'notebook', pageId: ids.today }, t);
  await blur(page);
  await shot(page, 'phone-today');

  await open(page, { view: 'library', area: null }, t);
  await shot(page, 'phone-library');

  await open(page, { view: 'write', chapterId: ids.chapter }, t);
  await page.keyboard.press('Control+k');
  await sleep(700);
  await shot(page, 'phone-command-menu');

  await open(page, { view: 'project', id: ids.book }, t);
  await shot(page, 'phone-book');

  await open(page, { view: 'write', chapterId: ids.film }, t);
  await blur(page);
  await shot(page, 'phone-screenplay');
  await ctx.close();
}

await browser.close();
server.kill();
