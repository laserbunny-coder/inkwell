// First steps (Nov 23 2026, Studio onboarding). A new Studio copy starts
// with a sample short film, "Salt Road", and a First steps card on the Desk.
// Each step runs its own short click-through (tour.js) inside the sample.
// When all six are done the card offers to delete the sample and goes away;
// "Show me around" stays in Go.
//
// Where it lives: settings-plan fields.firstSteps = { made, done: [ids],
// gone } (syncs). The sample's rows carry fields.sample = true.

import { getEntry, putEntries, byKind } from './db.js';
import { entry } from './model.js';
import { PLAN_ID, savePlanSettings } from './tasks.js';
import { trash } from './trash.js';

export const SAMPLE = 'wd_sample_salt';
export const SAMPLE_PIECE = 'pr_sample_salt';
export const SAMPLE_CHAPTER = 'ch_sample_salt';
export const SAMPLE_SCENE = 'pp_sample_1';

export const STEPS = [
  { id: 'scene', label: 'Write a scene' },
  { id: 'bible', label: 'Add a character to the bible' },
  { id: 'shots', label: 'Break the scene into shots' },
  { id: 'look', label: 'Pin a look on the look wall' },
  { id: 'share', label: 'Send someone a read link' },
  { id: 'talk', label: 'Talk an idea in' }
];

export async function readSteps() {
  const row = await getEntry(PLAN_ID);
  const f = row && !row.deleted ? row.fields?.firstSteps : null;
  return { made: false, done: [], gone: false, ...(f && typeof f === 'object' ? f : {}) };
}
export async function saveSteps(patch) {
  const was = await readSteps();
  return savePlanSettings({ firstSteps: { ...was, ...patch } });
}
export async function stepDone(id) {
  const was = await readSteps();
  if (was.done.includes(id)) return null;
  return saveSteps({ done: [...was.done, id] });
}

// Has she any work of her own yet? Then no sample is made.
async function hasOwnWork() {
  const mine = [...(await byKind('world')), ...(await byKind('project'))].filter((w) => !w.deleted && !w.fields?.sample);
  return mine.length > 0;
}

// Once per vault: the sample film, unless she already has worlds of her own.
export async function ensureSample() {
  const st = await readSteps();
  if (st.made || st.gone) return [];
  if (await hasOwnWork()) { await saveSteps({ made: true, gone: true }); return []; }
  const rows = sampleRows();
  await putEntries(rows);
  await saveSteps({ made: true });
  return rows;
}

// The whole sample goes to the Trash (it can come back from there).
export async function deleteSample() {
  const w = await getEntry(SAMPLE);
  if (w && !w.deleted) await trash(w);
  return saveSteps({ gone: true });
}

function sampleRows() {
  const rows = [];
  const put = (kind, f) => { const r = entry(kind, f); r.fields = { ...(f.fields || {}), sample: true }; rows.push(r); return r; };
  const txt = (text) => (text ? [{ type: 'text', text }] : null);
  put('world', { id: SAMPLE, title: 'Salt Road', area_id: 'area-filmmaking', fields: { shape: 'one', logline: 'A sample short film to try Inkwell on. June drives all night to find the motel her father never came back from. Delete it whenever you like.', production: { code: 'SR', style: 'Grainy 16 mm, sodium-orange night light, long lenses' } } });
  put('project', { id: SAMPLE_PIECE, parent_id: SAMPLE, title: 'Salt Road', area_id: 'area-filmmaking', sort: 1024, fields: { type: 'screenplay', woven: true, label: 'Short', stage: 'Writing' } });
  put('page', { id: 'pg_sample_chars', parent_id: SAMPLE_PIECE, title: 'Characters', sort: 1024 });
  put('page', { id: 'pg_sample_june', parent_id: 'pg_sample_chars', title: 'June', sort: 1024, fields: { element: { type: 'character', snippet: 'Thirties, denim jacket, tired eyes, her father’s keys on a red cord' } } });
  put('page', { id: 'pg_sample_clerk', parent_id: 'pg_sample_chars', title: 'Clerk', sort: 2048, fields: { element: { type: 'character', snippet: 'Seventies, cardigan, reading glasses on a chain, never in a hurry' } } });
  put('page', { id: 'pg_sample_places', parent_id: SAMPLE_PIECE, title: 'Places', sort: 2048 });
  put('page', { id: 'pg_sample_motel', parent_id: 'pg_sample_places', title: 'Motel office', sort: 1024, fields: { element: { type: 'location', snippet: 'Small desert motel office at night, wood panelling, a bell on the counter, a broken neon sign outside' } } });
  put('act', { id: 'ac_sample_salt', parent_id: SAMPLE_PIECE, title: 'Screenplay', sort: 1024 });
  put('chapter', { id: SAMPLE_CHAPTER, parent_id: 'ac_sample_salt', title: 'Script', sort: 1024 });
  put('scene', { id: 'sc_sample_1', parent_id: SAMPLE_CHAPTER, title: 'The room nobody asks for', sort: 1024, fields: { level: 3, synopsis: 'June asks for the room with the broken sign.' } });
  let n = 1024;
  const para = (id, text, el) => put('para', { id, parent_id: SAMPLE_CHAPTER, sort: (n += 1024), text, content: txt(text), fields: { el } });
  para(SAMPLE_SCENE, 'INT. MOTEL OFFICE - NIGHT', 'scene');
  para('pp_sample_2', 'Rain on the window. JUNE, thirties, rings the bell twice.', 'action');
  para('pp_sample_3', 'JUNE', 'character');
  para('pp_sample_4', 'I need the room with the broken sign.', 'dialogue');
  para('pp_sample_5', 'CLERK', 'character');
  para('pp_sample_6', 'Nobody asks for that room.', 'dialogue');
  put('shot', { id: 'sh_sample_1', parent_id: SAMPLE_SCENE, sort: 1024, text: 'Wide on the office through the rainy window', fields: { n: 1, piece: SAMPLE_PIECE, framing: 'Wide' } });
  return rows;
}

// Each step's click-through, inside the sample film. Words for both a
// computer and a phone.
export const TOURS = {
  scene: [
    { go: { view: 'world', id: SAMPLE }, sel: '.wo-item', say: 'This is the project page for Salt Road: its Ideas, its Bible, the film itself, then Make and Deliver, top to bottom.' },
    { go: { view: 'write', chapterId: SAMPLE_CHAPTER }, sel: '.wv-line', say: 'The script. Each scene starts with a line like this one; tap it for the scene’s card. On a computer, Ctrl + Shift + Enter starts a new scene where you are.' },
    { sel: '.ProseMirror p[data-el="character"]', say: 'Type a name in capitals and press Enter: the next line is dialogue. Tab changes what a line is. Try writing what June says next.' }
  ],
  bible: [
    { go: { view: 'world', id: SAMPLE }, sel: '.wo-name', text: 'Bible', say: 'The Bible holds the characters, places and props every piece of the film shares. Open it with the arrow beside it.' },
    { sel: '.wo-item', say: 'To add a character, open Bible, then Characters, and add a line. In the script, @ brings in a name you already have.' }
  ],
  shots: [
    { go: { view: 'write', chapterId: SAMPLE_CHAPTER }, sel: '.zm-shots', say: 'Shots puts each scene’s shots right beside the script. Tap it.', tap: true },
    { say: 'Each shot has a code that never changes. Pick lines in the script and add a shot for them; drag a picture onto a shot to keep it.' }
  ],
  look: [
    { go: { view: 'world', id: SAMPLE }, sel: '.wo-name', text: 'Make', say: 'Under Make are the cast and places, each with a look wall: the versions you try, and a star on the one you keep.' },
    { say: 'Open Make, then a name such as June, and drop pictures onto it. Star the one that’s right; every prompt for her uses it.' }
  ],
  share: [
    { go: { view: 'world', id: SAMPLE }, sel: '.wo-item', say: 'A film’s ⋯ menu has “Share a link to read and comment…”: anyone with the link can read the script and leave notes, with no account.' }
  ],
  talk: [
    { sel: '.zm-mic', say: 'The mic. Talk an idea out, on a walk or in the car: Claude writes it up and keeps your exact words. On a computer, Alt + C.' }
  ]
};
