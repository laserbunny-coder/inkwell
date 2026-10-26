// Makes the README screenshots: fills a fresh, local-only copy of the app with
// a made-up version of The Ninja Bunch (an anime mockumentary musical told in
// reels) and a novel, then photographs the main places at desktop and phone
// size, in dark mode. Nothing here touches a real account: sync talks to a
// stand-in kept in this script, and window.__claude stands in for Claude.
// Run: node docs/screenshots/capture.mjs   (with Playwright installed)
// Only some shots: ONLY=today,grid node docs/screenshots/capture.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(`${process.execPath.replace(/bin\/node$/, '')}lib/node_modules/playwright`)); }

const OUT = fileURLToPath(new URL('.', import.meta.url));
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const PORT = 4191;
const server = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await sleep(2500);
const APP = `http://localhost:${PORT}/`;

// ---------- the made-up account ----------

const DAY = 864e5;
const now = Date.now();
// Dates as the app sees them on Michael's devices, in Pacific time.
const iso = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const today = iso(now);
const table = new Map();
const bucket = new Map();
let clock = now - 6 * 3600e3;
const stamp = () => new Date((clock += 1000)).toISOString();
const tagsIn = (t) => [...String(t).matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase());
const put = (r) => {
  // Rows arrive the way the server sends them: times as text.
  const at = new Date(r.created_at || now - DAY).toISOString();
  table.set(r.id, { parent_id: null, sort: 0, title: '', text: '', content: null, tags: tagsIn(r.text || ''), type: null, fields: {}, area_id: null, links: [], deleted: false, ...r, created_at: at, user_id: 'u1', updated_at: stamp() });
  return r;
};
const txt = (t) => ({ type: 'text', text: t });
const ref = (id, title) => ({ type: 'entryRef', attrs: { id, title } });
const flat = (content) => content.map((n) => n.text || n.attrs.title).join('');
const links = (content) => content.filter((n) => n.type === 'entryRef').map((n) => n.attrs.id);
let ids = 0;
const nid = (p) => `${p}_${(ids += 1).toString(36)}`;

// Lines on a page or day, nested: 'text', or [content|'text', [kids]].
function lines(parent, items, base = now - 2 * DAY) {
  items.forEach((it, i) => {
    let [content, kids] = Array.isArray(it) && it.length === 2 && Array.isArray(it[1]) && !it[1][0]?.type ? it : [it, null];
    if (typeof content === 'string') content = [txt(content)];
    else if (!Array.isArray(content)) content = [content];
    else if (!content[0]?.type) content = content.flat();
    const text = flat(content);
    const id = nid('li');
    put({ id, kind: 'line', parent_id: parent, sort: (i + 1) * 1024, text, content, tags: tagsIn(text), links: links(content), fields: { done: false }, created_at: base + i * 60e3 });
    if (kids) lines(id, kids, base);
  });
}

// Areas, nested like Michael's.
const area = (id, title, color, parent, sort) => put({ id, kind: 'area', title, parent_id: parent, sort, fields: { color } });
area('area-writing', 'Writing', '#9A4A2E', null, 1);
area('area-filmmaking', 'Filmmaking', '#1F6F64', null, 2);
area('area-business', 'Business', '#5B6E8C', null, 3);
area('area-personal', 'Personal', '#8C5B7A', null, 4);
area('ar_novels', 'Novels', '#A8743A', 'area-writing', 1);
area('ar_working', 'Working', '#8C7A5B', 'ar_novels', 1);
area('ar_past', 'Past', '#4E6B3A', 'ar_novels', 2);

// ----- The Ninja Bunch: a show -----
const NB = 'wd_nb';
put({ id: NB, kind: 'world', title: 'The Ninja Bunch', area_id: 'area-filmmaking', created_at: now - 20 * DAY, fields: {
  shape: 'show',
  logline: 'A family bakery raises a troupe of hopeless ninjas. An anime mockumentary musical, told in reels first.',
  production: { code: 'NB', style: 'Anime look, soft watercolor backgrounds, warm morning bakery light. Mockumentary: handheld, talking heads straight to camera.' }
} });

// Bible: characters, places, props. The ones with fields.element are the production kit.
const page = (id, parent, title, sort, fields = {}, body = []) => { put({ id, kind: 'page', parent_id: parent, title, sort, fields }); lines(id, body); return id; };
page('pg_idea', NB, 'Idea', 512, {}, ['Ninjas who are terrible at being ninjas, raised by a bakery that is secretly a dojo.', 'Every reel ends on a song. The songs add up to the musical.']);
page('pg_chars', NB, 'Characters', 1024);
page('pg_kenji', 'pg_chars', 'Kenji', 1024, { element: { type: 'character', snippet: 'Nine years old, round face, red headband, ninja black two sizes too big', look: 'Kenji LoRA v3' } },
  ['Nine. Wants it more than anyone. Can’t vanish, can’t climb, can sing.', [txt('Wants'), ['To be picked for the troupe.']], [txt('Needs'), ['To stop hiding the singing.']]]);
page('pg_mom', 'pg_chars', 'Mom', 2048, { element: { type: 'character', also: ['Mother'], snippet: 'Fifties, short, calm, grey bun, red apron, flour on her hands', look: 'Mom ref pack' } },
  ['Runs the bakery. The best fighter in the family and never mentions it.']);
page('pg_grandpa', 'pg_chars', 'Grandpa', 3072, { element: { type: 'character', snippet: 'Eighties, tiny, huge white eyebrows, carries a rolling pin like a sword' } },
  ['Says he was a real ninja. Nobody believes him.']);
page('pg_sensei', 'pg_chars', 'Sensei Tanaka', 4096, { element: { type: 'character', snippet: 'Forties, very serious, very tall, terrible at baking' } });
page('pg_places', NB, 'Places', 2048);
page('pg_kitchen', 'pg_places', 'Bakery kitchen', 1024, { element: { type: 'location', snippet: 'Small warm bakery kitchen, flour in the air, copper pans, morning sun through steam' } });
page('pg_alley', 'pg_places', 'The alley', 2048, { element: { type: 'location', snippet: 'Narrow alley behind the bakery, one lamppost, bins, laundry lines' } });
page('pg_dojo', 'pg_places', 'Dojo', 3072, { element: { type: 'location', snippet: 'Old wooden dojo above the bakery, paper screens' } });
page('pg_props', NB, 'Props', 3072);
page('pg_katana', 'pg_props', 'Katana', 1024, { element: { type: 'prop', snippet: 'Chipped practice katana, used mostly for pancakes' } });
page('pg_pin', 'pg_props', 'Rolling pin', 2048, { element: { type: 'prop', also: ['pin'], snippet: 'Ancient dark wood rolling pin with a silk tassel' } });
page('pg_songs', NB, 'Songs', 4096, {}, ['Silent as the Morning Bread (Kenji’s song)', 'Knead, Breathe, Strike (training montage)', 'The Pancake Waltz']);

// Threads (the plot grid's columns), shared by every piece in the world.
put({ id: 'th_kenji', kind: 'thread', parent_id: NB, title: 'Kenji’s courage', sort: 1024, fields: { tag: 'kenji' } });
put({ id: 'th_grandpa', kind: 'thread', parent_id: NB, title: 'Grandpa’s secret', sort: 2048, fields: { tag: 'grandpa' } });
put({ id: 'th_bakery', kind: 'thread', parent_id: NB, title: 'Save the bakery', sort: 3072, fields: { tag: 'bakery' } });

// Pieces.
const piece = (id, parent, title, sort, fields) => put({ id, kind: 'project', parent_id: parent, title, area_id: 'area-filmmaking', sort, fields, created_at: now - 15 * DAY });
const script = (pieceId) => {
  put({ id: `ac_${pieceId}`, kind: 'act', parent_id: pieceId, title: 'Screenplay', sort: 1024 });
  put({ id: `ch_${pieceId}`, kind: 'chapter', parent_id: `ac_${pieceId}`, title: 'Script', sort: 1024 });
  let n = 0;
  return {
    id: `ch_${pieceId}`,
    s: (id, title, level, synopsis) => put({ id, kind: 'scene', parent_id: `ch_${pieceId}`, sort: (n += 1024), title, fields: { ...(level > 1 ? { level } : {}), ...(synopsis ? { synopsis } : {}) } }),
    l: (id, text, el, extra = {}) => put({ id, kind: 'para', parent_id: `ch_${pieceId}`, sort: (n += 1024), text, content: [txt(text)], fields: { el, ...extra }, created_at: now - 3 * DAY })
  };
};
const note = (para, chapter, text, extra = {}) => put({ id: nid('no'), kind: 'note', parent_id: para, type: extra.type || 'writing', text, fields: { chapter_id: chapter, ...extra.fields } });

piece('pr_r1', NB, 'Reel 1: The Audition', 1, { type: 'screenplay', label: 'Reel', stage: 'Posted', code: 'R01', posting: { youtube: { url: 'https://youtu.be/ninjabunch1', caption: 'Kenji tries out for the troupe. It goes badly. 🥷🍞' }, instagram: { url: 'https://instagram.com/reel/ninjabunch1' } } });
{
  const r = script('pr_r1');
  r.l('p1_1', 'INT. DOJO - DAY', 'scene', { code: '1' });
  r.l('p1_2', 'Six kids in ninja black. SENSEI TANAKA walks the line. KENJI, nine, is shaking.', 'action');
  r.l('p1_3', 'SENSEI TANAKA', 'character');
  r.l('p1_4', 'Vanish.', 'dialogue');
  r.l('p1_5', 'Five kids vanish. Kenji is still there. He waves.', 'action');
  note('p1_5', 'ch_pr_r1', 'Kenji can’t vanish', { fields: { thread: 'th_kenji', beat: 'promise' } });
  r.l('p1_6', 'INT. BAKERY - FRONT COUNTER - LATER', 'scene', { code: '2' });
  r.l('p1_7', 'Talking head. GRANDPA polishes a rolling pin like a sacred sword.', 'action');
  note('p1_7', 'ch_pr_r1', 'The rolling pin was a real weapon once', { fields: { thread: 'th_grandpa', beat: 'promise' } });
  r.l('p1_8', 'GRANDPA', 'character');
  r.l('p1_9', 'In my day, we didn’t vanish. We were simply never there.', 'dialogue');
}

piece('pr_r2', NB, 'Reel 2: Breakfast', 2, { type: 'screenplay', label: 'Reel', stage: 'Boarded', numbered: true, code: 'R02', levels: ['Act', 'Script', 'Scene'] });
const R2 = script('pr_r2');
{
  const { s, l } = R2;
  s('s2_a1', 'Cold open', 1, 'Breakfast is a battlefield and Mom always wins.');
  s('s2_q1', 'Breakfast fight', 2, 'Kenji tries to sneak a pancake. Mom wins without looking up.');
  l('p2_1', 'INT. BAKERY KITCHEN - MORNING', 'scene', { code: '1' });
  l('p2_2', 'Flour hangs in the air. MOM flips pancakes with a katana. KENJI creeps along the counter in full ninja black.', 'action');
  note('p2_2', R2.id, 'Mom never looks at him. Not once.');
  note('p2_2', R2.id, 'The apron must be the red one', { type: 'production' });
  l('p2_3', 'KENJI', 'character');
  l('p2_4', '(whispering)', 'paren');
  l('p2_5', 'Nobody move. I am the shadow.', 'dialogue');
  l('p2_6', 'MOM', 'character');
  l('p2_7', 'The shadow has syrup on his sleeve.', 'dialogue');
  note('p2_7', R2.id, 'Kenji gets caught, again', { fields: { thread: 'th_kenji', beat: 'progress' } });
  l('p2_8', 'A pancake lands on his head. She still hasn’t looked up.', 'action');
  s('s2_q2', 'Talking head', 2, 'Grandpa explains the old ways. He is lying.');
  l('p2_9', 'INT. BAKERY - FRONT COUNTER - LATER', 'scene', { code: '2' });
  l('p2_10', 'GRANDPA dusts a rolling pin like a sacred sword.', 'action');
  note('p2_10', R2.id, 'Grandpa hides the pin when Mom walks in', { fields: { thread: 'th_grandpa', beat: 'progress' } });
  l('p2_11', 'GRANDPA', 'character');
  l('p2_12', 'In my day, ninjas made their own bread.', 'dialogue');
  l('p2_13', 'INTERVIEWER (O.S.)', 'character');
  l('p2_14', 'Did they?', 'dialogue');
  l('p2_15', 'GRANDPA', 'character');
  l('p2_16', '(beat)', 'paren');
  l('p2_17', 'No.', 'dialogue');
  s('s2_a2', 'The song', 1, 'Kenji sings when he thinks nobody is watching.');
  s('s2_q3', 'Alley practice', 2);
  l('p2_18', 'EXT. ALLEY BEHIND THE BAKERY - DAY', 'scene', { code: '3' });
  l('p2_19', 'Kenji practices vanishing behind the lamppost. He is wider than the lamppost.', 'action');
  note('p2_19', R2.id, 'Still can’t vanish, but he sings', { fields: { thread: 'th_kenji', beat: 'progress' } });
  note('p2_19', R2.id, 'The bakery rent letter is in the bin', { fields: { thread: 'th_bakery', beat: 'promise' } });
  l('p2_20', 'KENJI', 'character');
  l('p2_21', '(singing, very quietly)', 'paren');
  l('p2_22', 'Silent as the morning bread, soft as flour on the stair…', 'dialogue');
  l('p2_23', 'Behind him, Mom watches from the back door. She smiles.', 'action');
}

// Reel 3 is shot live, on the bakery roof, so it goes through the Live action stages.
piece('pr_r3', NB, 'Reel 3: Night Training', 3, { type: 'screenplay', label: 'Reel', stage: 'Prepped', stageSet: 'live', code: 'R03' });
{
  const r = script('pr_r3');
  r.l('p3_1', 'EXT. BAKERY ROOF - NIGHT', 'scene', { code: '1' });
  r.l('p3_2', 'Grandpa throws the rolling pin. It takes out three practice dummies and comes back to his hand.', 'action');
  note('p3_2', 'ch_pr_r3', 'The pin really was a weapon', { fields: { thread: 'th_grandpa', beat: 'payoff' } });
}
piece('pr_g1', NB, 'Pancake on the head', 4, { type: 'screenplay', label: 'Gag', stage: 'Idea' });
piece('pr_song', NB, 'Silent as the Morning Bread', 5, { type: 'lines', label: 'Song', stage: 'Drafted', stageSet: 'short' });
piece('pr_s1', NB, 'Season 1', 6, { type: 'lines', label: 'Season', stage: 'Idea' });
[['Episode 1: The Audition', 'Written'], ['Episode 2: Rent Day', 'Idea'], ['Episode 3: The Rival Bakery', 'Idea'], ['Episode 4: Opening Night', 'Idea']].forEach(([t, stage], i) =>
  piece(`pr_e${i + 1}`, 'pr_s1', t, (i + 1) * 1024, { type: 'screenplay', label: 'Episode', stage }));

// Shots for Reel 2, under each scene heading. Renders are drawn later, in the page.
const SHOTS = [
  ['p2_1', '1', 'Wide', 'The kitchen in morning steam. Mom at the stove, Kenji a shadow along the counter.', 'Anime watercolor, small warm bakery kitchen, flour in the air, morning sun through steam, a calm woman in a red apron flipping pancakes with a katana, a nine-year-old ninja creeping along the counter, wide shot'],
  ['p2_1', '2', 'Close-up', 'Kenji’s eyes over the counter edge.', 'Anime close-up, nine-year-old boy in oversized ninja black and red headband peeking over a flour-dusted counter, determined eyes'],
  ['p2_1', '3', 'Insert', 'The pancake lands on his head.', 'Anime insert, a perfect golden pancake landing on a small ninja’s head, flour puff, comic timing'],
  ['p2_9', '1', 'Medium', 'Talking head: Grandpa with the rolling pin.', 'Anime mockumentary talking head, tiny old man with huge white eyebrows holding a dark wood rolling pin like a sword, bakery counter behind, straight to camera'],
  ['p2_18', '1', 'Wide', 'Kenji half-hidden behind a lamppost.', 'Anime wide, narrow alley behind a bakery, one lamppost, a small ninja failing to hide behind it, laundry lines, afternoon light'],
  ['p2_18', '2', 'Medium', 'Mom in the back doorway, smiling.', 'Anime medium, a calm woman in a red apron leaning in a bakery back doorway, soft smile, warm light']
];
SHOTS.forEach(([scene, n, framing, what, still], i) => put({ id: `sh_${i + 1}`, kind: 'shot', parent_id: scene, sort: (Number(n) || i) * 1024, text: what, fields: { n, framing, piece: 'pr_r2', ...(i === 3 ? { made: 'ref' } : {}), still, video: i < 4 ? `${framing} shot, slow push in, 3 seconds` : '' } }));
put({ id: 'sd_1', kind: 'shootday', parent_id: 'pr_r3', fields: { date: iso(now + 12 * DAY), call: '09:00', wrap: '13:00', place: 'The bakery on Sunset (after closing)', scenes: ['p3_1'], notes: 'Bring the real rolling pin. Practice dummies from the garage.' } });

// ----- a novel, for prose -----
put({ id: 'wd_salt', kind: 'world', title: 'The Salt Keeper', area_id: 'ar_working', fields: { shape: 'one', logline: 'A lighthouse keeper dies; his sister comes to close the station and finds his log tells another story.' }, created_at: now - 40 * DAY });
put({ id: 'pr_salt', kind: 'project', parent_id: 'wd_salt', title: 'The Salt Keeper', area_id: 'ar_working', sort: 1, fields: { type: 'novel', levels: ['Act', 'Chapter', 'Scene'], label: 'Novel', stage: 'Drafted' } });
put({ id: 'ac_salt1', kind: 'act', parent_id: 'pr_salt', title: 'Act One', sort: 1024 });
['The Logbook', 'Low Tide', 'What the Gulls Knew'].forEach((t, i) => put({ id: `ch_salt${i + 1}`, kind: 'chapter', parent_id: 'ac_salt1', title: `${i + 1}. ${t}`, sort: (i + 1) * 1024 }));
page('pg_lens', 'wd_salt', 'Fresnel lens', 2048, {}, ['First-order lenses stand taller than a person. Hundreds of glass prisms in brass rings. #research']);
page('pg_maren', 'wd_salt', 'Maren', 1024, {}, ['Forty-one. Archivist in the city. Hasn’t been back in twenty years.']);
[
  [txt('The logbook was heavier than she expected, the way a sleeping cat is heavier than a cat. Maren carried it down the iron stairs with both arms, counting the steps out of habit, and set it on the kitchen table beside the cold kettle.')],
  [txt('Her brother had kept it for eleven years. Every entry began the same: the date, the wind, the state of the sea, the hour the lamp was lit. After that his handwriting loosened, as if the lamp had been the only thing that needed him to be careful.')],
  [txt('“Fog at four. Lit early. Saw the ferry turn back.” She read it twice. The ferry had not turned back in the story everyone told on the mainland.')],
  [txt('Outside, the gulls were working the tideline. The island was small enough that you could hear the whole of it at once: water on three sides, wind on the fourth, and in the middle a tower that had been built to be seen, not to see.')],
  [txt('She found the first letter folded into the back cover, pressed flat by years of weight. It was addressed to her. It had never been sent.')],
  [txt('By morning the lamp had gone out on its own. Maren climbed up to the lamp room and stood inside the great glass of the '), ref('pg_lens', 'Fresnel lens'), txt(', where the light was broken into rings, and for a moment the whole sea looked like the inside of a shell.')],
  [txt('She had come to close the station. That was the job; the letter from the board had said so in three careful paragraphs. Nobody had said anything about reading.')]
].forEach((content, i) => put({ id: `ps_${i + 1}`, kind: 'para', parent_id: 'ch_salt1', sort: (i + 1) * 1024, text: flat(content), content, links: links(content), created_at: now - (5 - Math.min(i, 4)) * DAY }));
note('ps_1', 'ch_salt1', 'Open on weight. The logbook is the brother: she carries him down the stairs.');
note('ps_3', 'ch_salt1', 'Plant the ferry here. The mainland version comes in ch. 4 and should contradict this line.', { fields: { beat: 'promise' } });
note('ps_4', 'ch_salt1', 'If this ever goes to screen: one long wide, no music, just wind.', { type: 'directing' });

// ----- a life project -----
put({ id: 'wd_kitchen', kind: 'world', title: 'Kitchen remodel', area_id: 'area-personal', fields: { shape: 'one', life: true, logline: 'Open shelves, a real range, and somewhere to put the stand mixer.' } });
page('pg_k1', 'wd_kitchen', 'Ideas', 1024, {}, ['Butcher block on the island, quartz by the sink', 'Ask about moving the window #remodel']);

// ----- daily pages -----
const dayPage = (offset, items) => {
  const d = iso(now - offset * DAY);
  put({ id: `day-${d}`, kind: 'day', title: d, created_at: now - offset * DAY });
  lines(`day-${d}`, items, now - offset * DAY);
};
dayPage(0, [
  [[txt('Morning pages')], ['Slept badly, dreamed about flour. Probably useful.', [txt('Grandpa should hum while he polishes the pin. Use it in '), ref('pr_r2', 'Reel 2: Breakfast'), txt('.')]]],
  [[txt('Ninja Bunch')], [
    [txt('Kenji’s song needs a second verse '), ref(NB, 'The Ninja Bunch'), txt(' #songs')],
    [txt('What if the bakery is losing money and the ninjas have to save it? '), ref(NB, 'The Ninja Bunch')],
    'Render the alley shots again, the lamppost is too thin #render'
  ]],
  'A ninja who only fights at breakfast #drawer',
  'Haunted lighthouse film, told only through the logbook #drawer',
  'Call Dana about the storyboards before Friday'
]);
dayPage(1, ['Posted Reel 1. 4 comments already, all about Grandpa. #ninjabunch', [txt('Idea: every reel ends on a song. Added to '), ref('pg_idea', 'Idea')]]);
dayPage(3, ['Wrote the alley scene on a walk. #walkandtalk']);

// Word counts the app keeps on each chapter.
for (const ch of [...table.values()].filter((r) => r.kind === 'chapter')) {
  ch.fields = { ...ch.fields, words: [...table.values()].filter((r) => r.parent_id === ch.id && r.kind === 'para').reduce((n, r) => n + r.text.split(/\s+/).filter(Boolean).length, 0) };
}

// ---------- the stand-ins for the server ----------

function remote(op, arg) {
  if (op === 'push') {
    return arg.map((r) => { const at = stamp(); table.set(r.id, { ...r, user_id: 'u1', updated_at: at }); return { id: r.id, updated_at: at }; });
  }
  if (op === 'pull') {
    return [...table.values()].filter((r) => r.updated_at > arg.since)
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1))
      .slice(arg.from, arg.from + 500);
  }
  if (op === 'upload') { bucket.set(arg.path, arg); return true; }
  if (op === 'download') return bucket.get(arg) || null;
}
const fake = () => {
  const toB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(blob); });
  window.__syncBackend = {
    user: async () => ({ id: 'u1' }), onAuth() {}, signIn() {}, signOut() {},
    push: (rows) => window.__remote('push', rows),
    pull: (since, from) => window.__remote('pull', { since, from }),
    async upload(path, blob, type) { await window.__remote('upload', { path, type, data: await toB64(blob) }); },
    async download(path) {
      const f = await window.__remote('download', path);
      if (!f) throw new Error('not found');
      return new Blob([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], { type: f.type });
    },
    subscribe() {}, unsubscribe() {}
  };
  window.__modes = [
    { id: 'idea', name: 'Idea', prompt: 'An outline of the idea.', model: 'opus' },
    { id: 'journal', name: 'Journal', prompt: 'Light cleanup.', model: 'opus' },
    { id: 'scene', name: 'Scene', prompt: 'Paragraphs, or screenplay format in a script.', model: 'opus' },
    { id: 'text', name: 'Text message', prompt: 'A text.', model: 'haiku' },
    { id: 'email', name: 'Email', prompt: 'A ready-to-send email.', model: 'sonnet' }
  ];
  window.__claude = async (body) => {
    if (body.mode === 'voice-modes') return { modes: window.__modes };
    if (body.mode === 'voice' && window.__voice) return window.__voice(body);
    throw new Error('Not now');
  };
};

// ---------- the photographs ----------

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

async function session(opts) {
  const ctx = await browser.newContext({ colorScheme: 'dark', permissions: ['microphone'], timezoneId: 'America/Los_Angeles', locale: 'en-US', ...opts });
  await ctx.exposeFunction('__remote', remote);
  await ctx.addInitScript(fake);
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'dark'); } catch {} });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(APP);
  await page.waitForSelector('#editor .ProseMirror', { state: 'attached' });
  await page.waitForFunction(() => window.__sync && !window.__sync.running, null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.__sync.run());
  await sleep(1500);
  return { ctx, page };
}

const go = async (page, place, wait = 1200) => {
  await page.evaluate((pl) => { history.pushState(pl, ''); dispatchEvent(new PopStateEvent('popstate', { state: pl })); }, place);
  await sleep(wait);
};

// Saved as WebP, desktop 2000px wide and phone 780px wide, so the README loads quickly.
const shot = async (page, name, { top = true } = {}) => {
  if (ONLY && !ONLY.has(name)) return;
  const { width, height } = page.viewportSize();
  if (width > 600) await page.mouse.move(width - 8, Math.round(height * 0.6));
  if (top) await toTop(page);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
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
  if (process.env.PNG) writeFileSync(`${process.env.PNG}/${name}.png`, Buffer.from(png, 'base64'));
  console.log('saved', name);
};
const toTop = (page) => page.evaluate(() => { scrollTo(0, 0); for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0; });
const blur = (page) => page.evaluate(() => { document.activeElement?.blur(); getSelection()?.removeAllRanges(); });
const settleNotes = (page) => page.evaluate(() => {
  for (const t of document.querySelectorAll('.note textarea')) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }
  dispatchEvent(new Event('resize'));
});

// Simple painted frames standing in for renders: sky, a warm room, a figure.
async function paintRenders(page) {
  await page.evaluate(async (list) => {
    const { addFile } = await import('/src/files.js');
    const { withRenders } = await import('/src/production.js');
    const { getEntry, putEntries } = await import('/src/db.js');
    const palettes = [['#f6c27a', '#c9783f', '#5a2e1c'], ['#ffd9a0', '#d98b52', '#3c2416'], ['#f4e3b5', '#e0a96d', '#6b3a22'], ['#e8c08a', '#a0613a', '#2e1a10'], ['#9fb8c9', '#5e7a8c', '#22303a'], ['#f2c48d', '#b5714a', '#3a2418']];
    for (const [i, id] of list.entries()) {
      const c = document.createElement('canvas');
      c.width = 960; c.height = 540;
      const g = c.getContext('2d');
      const [a, b, d] = palettes[i % palettes.length];
      const sky = g.createLinearGradient(0, 0, 0, 540); sky.addColorStop(0, a); sky.addColorStop(1, b);
      g.fillStyle = sky; g.fillRect(0, 0, 960, 540);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      for (let k = 0; k < 40; k++) { g.beginPath(); g.arc((k * 137) % 960, (k * 89) % 360, 3 + (k % 5), 0, 7); g.fill(); }
      g.fillStyle = d; g.fillRect(0, 400, 960, 140);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(120 + i * 60, 160, 90, 240);
      // a figure: head, body, red headband
      const x = 480 + (i % 2 ? -140 : 120);
      g.fillStyle = '#1b1b22'; g.beginPath(); g.ellipse(x, 330, 55, 90, 0, 0, 7); g.fill();
      g.fillStyle = '#f1d2b4'; g.beginPath(); g.arc(x, 220, 42, 0, 7); g.fill();
      g.fillStyle = '#c8352c'; g.fillRect(x - 44, 200, 88, 12);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      const file = await addFile(new File([blob], `NB-R02 render ${i + 1}.jpg`, { type: 'image/jpeg' }));
      const shot = await getEntry(id);
      const fields = withRenders(shot.fields, [file.id]);
      fields.star = { still: file.id };
      await putEntries([{ ...shot, fields }]);
    }
  }, ['sh_1', 'sh_2', 'sh_3', 'sh_4', 'sh_5', 'sh_6']);
}

const RAW = 'okay so for the next reel um grandpa finally shows what the rolling pin can do. scratch that. kenji sees grandpa do it by accident at night on the roof. note to self ask dana if the roof set is too expensive';
const VOICE = {
  raw: RAW, mode: 'idea', tag: 'ninjabunch',
  blocks: [
    { text: 'Next reel: Kenji catches Grandpa on the roof at night, using the rolling pin for real.', el: 'paragraph', new_scene: false },
    { text: 'Kenji isn’t meant to see it. He finds out by accident.', el: 'paragraph', new_scene: false }
  ],
  notes: [{ text: 'Ask Dana if the roof set is too expensive.', after: 1 }]
};
const record = async (page, ms = 1800) => {
  await page.waitForSelector('.capture:not([hidden])');
  // Alt + C starts recording by itself; the big button starts it otherwise.
  await page.waitForSelector('.capture[data-state="recording"]', { timeout: 2500 }).catch(() => page.click('.cap-big'));
  await page.waitForSelector('.capture[data-state="recording"]');
  await sleep(ms);
};

// ----- computer -----
{
  const { ctx, page } = await session({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await paintRenders(page);
  await page.evaluate((v) => { window.__voice = async () => v; }, VOICE);

  // Today, with a voice capture just written up (the chip says which mode).
  await go(page, { view: 'notebook', pageId: `day-${today}` });
  await page.keyboard.press('Alt+c');
  await record(page);
  await page.click('.cap-big');
  await page.waitForSelector('.capture', { state: 'hidden', timeout: 10000 });
  await page.waitForFunction(() => /Grandpa on the roof/.test(document.querySelector('#outline-editor .ProseMirror')?.innerText || ''), null, { timeout: 15000 }).catch(() => console.log('voice write-up did not show'));
  await sleep(800);
  await blur(page);
  await shot(page, 'desktop-today');

  // The world's Overview, then each workflow tab.
  await go(page, { view: 'world', id: NB });
  await shot(page, 'desktop-overview');
  await go(page, { view: 'stage', id: NB, page: 'gather' });
  await shot(page, 'desktop-gather');
  await go(page, { view: 'stage', id: NB, page: 'shape' });
  await shot(page, 'desktop-shape');
  await go(page, { view: 'stage', id: NB, page: 'shape', sub: 'promises' });
  await shot(page, 'desktop-promises');
  await go(page, { view: 'stage', id: NB, page: 'make', sub: 'board' });
  await shot(page, 'desktop-stage-board');
  // Stages…: each kind of piece goes through its own set, editable per project.
  await page.getByRole('button', { name: 'Stages…' }).first().click().catch(() => console.log('no Stages… button'));
  await page.waitForSelector('.stage-edit', { state: 'visible' }).catch(() => {});
  await sleep(600);
  await shot(page, 'desktop-stage-sets', { top: false });
  await page.keyboard.press('Escape');
  await sleep(300);

  // The script, with its sections, summaries and scene numbers.
  await go(page, { view: 'write', chapterId: R2.id }, 1500);
  await blur(page);
  await shot(page, 'desktop-script');

  // Talking into the draft: the record screen says where it will land.
  await page.locator('#editor p[data-eid="p2_8"]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Alt+c');
  await record(page, 1200);
  await shot(page, 'desktop-record', { top: false });
  await page.click('.cap-cancel').catch(() => {});
  await sleep(500);

  // Plot grid, shots with renders, storyboard, shoot day.
  await go(page, { view: 'grid', id: 'pr_r2' }, 1500);
  await shot(page, 'desktop-grid');
  await go(page, { view: 'production', id: 'pr_r2', tab: 'shots' }, 1800);
  await page.locator('.pd-shot').first().locator('button').first().click().catch(() => {});
  await sleep(800);
  await shot(page, 'desktop-shots');
  await go(page, { view: 'production', id: 'pr_r2', tab: 'board' }, 1800);
  await shot(page, 'desktop-storyboard');
  await go(page, { view: 'production', id: 'pr_r3', tab: 'days' }, 1500);
  await page.getByText(/^Sat, Nov|^\w{3}, \w{3} \d+$/).first().click().catch(() => console.log('no shoot day chip'));
  await sleep(800);
  await shot(page, 'desktop-shoot-day');
  await go(page, { view: 'deliver', id: 'pr_r1', tab: 'post' }, 1500);
  await shot(page, 'desktop-posting');

  // Prose: notes in the margin, then focus, then fresh eyes.
  await go(page, { view: 'write', chapterId: 'ch_salt1' }, 1500);
  await blur(page);
  await page.keyboard.press('Control+2');
  await sleep(900);
  await settleNotes(page);
  await shot(page, 'desktop-manuscript-notes');
  await page.keyboard.press('Control+2');
  await page.locator('#editor .ProseMirror p').nth(3).click();
  await page.keyboard.press('Control+.');
  await sleep(900);
  await shot(page, 'desktop-focus');
  await page.keyboard.press('Control+.');
  await sleep(400);

  // Getting around: the Go panel, the command menu.
  await go(page, { view: 'write', chapterId: R2.id }, 1200);
  await go(page, { view: 'stage', id: NB, page: 'shape' }, 800);
  await go(page, { view: 'world', id: NB }, 800);
  await page.keyboard.press('Control+o');
  await page.waitForSelector('.go-panel', { state: 'visible' }).catch(() => {});
  await sleep(600);
  await shot(page, 'desktop-go', { top: false });
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('Control+k');
  await sleep(700);
  await shot(page, 'desktop-command-menu', { top: false });
  await page.keyboard.press('Escape');

  // The desk: Library, Drawer, Tags.
  await go(page, { view: 'library', area: null });
  await shot(page, 'desktop-library');
  await go(page, { view: 'drawer' });
  await shot(page, 'desktop-drawer');
  await go(page, { view: 'tags' });
  await shot(page, 'desktop-tags');
  await ctx.close();
}

// ----- one in light mode -----
{
  const { ctx, page } = await session({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.reload();
  await page.waitForSelector('#editor .ProseMirror', { state: 'attached' });
  await sleep(1200);
  await go(page, { view: 'write', chapterId: 'ch_salt1' }, 1500);
  await blur(page);
  await page.keyboard.press('Control+2');
  await sleep(900);
  await settleNotes(page);
  await shot(page, 'desktop-manuscript-light');
  await ctx.close();
}

// ----- Android phone -----
{
  const { ctx, page } = await session({ viewport: { width: 412, height: 870 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await paintRenders(page);
  // Visit a few places first, so Jump back in the Go sheet lists real ones.
  for (const pl of [{ view: 'write', chapterId: 'ch_salt1' }, { view: 'production', id: 'pr_r2', tab: 'shots' }, { view: 'write', chapterId: R2.id }, { view: 'stage', id: NB, page: 'shape' }, { view: 'notebook', pageId: `day-${today}` }]) await go(page, pl, 900);
  await blur(page);
  await sleep(600);
  await shot(page, 'phone-today');
  await go(page, { view: 'world', id: NB });
  await shot(page, 'phone-overview');
  await page.locator('.pb-place').tap().catch(() => {});
  await sleep(800);
  await shot(page, 'phone-go', { top: false });
  await page.keyboard.press('Escape');
  await page.locator('.go-backdrop').click({ force: true }).catch(() => {});
  await go(page, { view: 'write', chapterId: R2.id }, 1500);
  await blur(page);
  await shot(page, 'phone-script');
  await go(page, { view: 'grid', id: 'pr_r2' }, 1500);
  await shot(page, 'phone-grid');
  await go(page, { view: 'production', id: 'pr_r2', tab: 'board' }, 1800);
  await shot(page, 'phone-storyboard');
  await go(page, { view: 'notebook', pageId: `day-${today}` });
  await blur(page);
  await sleep(600);
  await page.locator('.pb-mic').tap().catch((e) => console.log('mic:', e.message.split('\n')[0]));
  await record(page, 1200).catch((e) => console.log('record:', e.message.split('\n')[0]));
  await shot(page, 'phone-record', { top: false });
  await ctx.close();
}

await browser.close();
server.kill();
