import { getEntry, children, putEntries, byKind } from './db.js';
import { entry, newId } from './model.js';
import { worldTree } from './library.js';
import { assignCodes, codeOrder } from './script.js';

// The production layer: the same story, made ready to shoot or generate.
// Nothing here is a copy of the writing:
// - the world's bible pages double as the production kit: a page can be an
//   element (a character, a location, a prop, wardrobe) with reference
//   pictures, its locked look (a LoRA or reference pack) and a short prompt
//   snippet that says what it looks like;
// - a scene's breakdown is the elements it uses: found in its words, added or
//   taken away by hand, or found by Claude;
// - shots live under their scene (the scene heading in a script), each with
//   what happens, the framing, a prompt for the still and one for the video,
//   and every render that came back, with a star on the one that worked;
// - shot codes (NB-E01-S03A-04) never change once given, so file names on the
//   NAS and clips in Resolve keep pointing at the right shot.

export const ELEMENT_TYPES = [
  { id: 'character', label: 'Character', plural: 'Characters' },
  { id: 'location', label: 'Location', plural: 'Locations' },
  { id: 'prop', label: 'Prop', plural: 'Props' },
  { id: 'wardrobe', label: 'Wardrobe', plural: 'Wardrobe' },
  { id: 'other', label: 'Other', plural: 'Other' }
];
export const typeOf = (id) => ELEMENT_TYPES.find((t) => t.id === id) || ELEMENT_TYPES.at(-1);

// What a bible page is likely to be, from the page it sits in ("Characters",
// "Places", "Props", "Costumes"…).
export function guessType(...titles) {
  for (const t of titles) {
    const s = (t || '').toLowerCase();
    if (/character|cast|people|who/.test(s)) return 'character';
    if (/location|place|set\b|sets\b|where|world map/.test(s)) return 'location';
    if (/prop|object|thing|weapon|item/.test(s)) return 'prop';
    if (/wardrobe|costume|outfit|cloth/.test(s)) return 'wardrobe';
  }
  return null;
}

// ---------- the kit ----------

// Every element in a world: its bible pages that are elements, in bible order.
export async function elementsIn(world) {
  if (!world) return [];
  const { pages, piecePages } = await worldTree(world.id);
  return [...pages, ...piecePages].map(({ row }) => row).filter((p) => p.fields?.element && !p.fields?.trashed);
}

// Bible pages that aren't elements yet, with a guess at what each would be.
export async function plainPages(world) {
  if (!world) return [];
  const { pages } = await worldTree(world.id);
  const byId = new Map(pages.map(({ row }) => [row.id, row]));
  return pages.map(({ row }) => row).filter((p) => !p.fields?.element && !p.fields?.trashed)
    .map((p) => ({ page: p, guess: guessType(byId.get(p.parent_id)?.title, p.title) }));
}

// The page an element of this type goes in ("Characters"), made if it isn't there.
async function categoryPage(world, type) {
  const t = typeOf(type);
  const top = (await children(world.id)).filter((r) => r.kind === 'page');
  const found = top.find((p) => guessType(p.title) === type && !p.fields?.element) || top.find((p) => (p.title || '').toLowerCase() === t.plural.toLowerCase());
  if (found) return found;
  const page = entry('page', { id: newId('pg'), parent_id: world.id, title: t.plural, sort: top.length + 1 });
  await putEntries([page]);
  return page;
}

export async function newElement(world, type, title) {
  const parent = await categoryPage(world, type);
  const sort = (await children(parent.id)).filter((r) => r.kind === 'page').length + 1;
  const page = entry('page', { id: newId('pg'), parent_id: parent.id, title, sort, fields: { element: { type } } });
  await putEntries([page]);
  return page;
}

export async function setElement(id, patch) {
  const fresh = await getEntry(id);
  if (!fresh) return null;
  const el = patch === null ? undefined : { ...(fresh.fields?.element || {}), ...patch };
  const { element: _e, ...rest } = fresh.fields || {};
  const row = { ...fresh, fields: el ? { ...rest, element: el } : rest, updated_at: Date.now() };
  await putEntries([row]);
  return row;
}

export const namesOf = (el) => [el.title || '', ...(el.fields?.element?.also || [])].map((s) => s.trim()).filter((s) => s.length > 1);

// ---------- the breakdown ----------

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The elements a scene's words mention: a character by the name over their
// lines, anything by its name or another name it goes by. `cues` are the
// script's character names in the scene, as written over their lines.
export function findElements(text, cues, elements) {
  const out = [];
  const said = new Set((cues || []).map((c) => c.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim().toUpperCase()));
  for (const el of elements) {
    const names = namesOf(el);
    const hit = names.some((n) => said.has(n.toUpperCase()) || new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, 'iu').test(text));
    if (hit) out.push(el.id);
  }
  return out;
}

export const breakdownId = (sceneId) => `bd-${sceneId}`;

// What a scene uses: what's found in its words plus what was added by hand
// (or by Claude), less what was taken away.
export function sceneElements(found, bd) {
  const add = bd?.fields?.add || [];
  const drop = new Set(bd?.fields?.drop || []);
  return [...new Set([...found, ...add])].filter((id) => !drop.has(id));
}

export async function changeBreakdown(sceneId, { add = [], drop = [], sig, audio, pieceId } = {}) {
  const id = breakdownId(sceneId);
  const prev = await getEntry(id);
  const f = prev && !prev.deleted ? prev.fields || {} : {};
  const adds = new Set(f.add || []);
  const drops = new Set(f.drop || []);
  for (const x of add) { adds.add(x); drops.delete(x); }
  for (const x of drop) { adds.delete(x); drops.add(x); }
  const row = {
    ...(prev || entry('breakdown', { id, parent_id: sceneId })),
    parent_id: sceneId,
    deleted: false,
    fields: { ...f, add: [...adds], drop: [...drops], ...(sig !== undefined ? { sig } : {}), ...(audio !== undefined ? { audio } : {}), ...(pieceId ? { piece: pieceId } : {}) },
    updated_at: Date.now()
  };
  await putEntries([row]);
  return row;
}

// A short fingerprint of a scene's words, to notice when it changes after
// its shots were planned.
export function sceneSig(texts) {
  let h = 0x811c9dc5;
  const s = texts.map((t) => (t || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// ---------- shots ----------

// "3A" as it goes in a file name: "03A".
export const pad = (code) => {
  const m = /^([A-Z]*)(\d+)([A-Z]*)$/i.exec(String(code || ''));
  return m ? `${m[1]}${m[2].padStart(2, '0')}${m[3]}`.toUpperCase() : String(code || '').toUpperCase();
};

// NB-E01-S03A-04: the show, the piece, the scene, the shot. Parts not set
// yet are left out.
export function shotCode({ show, piece, scene, shot }) {
  const clean = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return [clean(show), clean(piece), scene ? `S${pad(scene)}` : '', shot ? pad(shot) : ''].filter(Boolean).join('-');
}

// The next shot's number in a scene, between `before` and `after` (numbers
// of shots already there) or at the end: the same never-changing numbering
// as scene numbers, so a shot added between 3 and 4 is 3A.
export function shotNumber(numbers, at = numbers.length) {
  const list = [...numbers.slice(0, at), null, ...numbers.slice(at)];
  return assignCodes(list)[at];
}

export async function shotsUnder(sceneId) {
  return (await children(sceneId)).filter((r) => r.kind === 'shot').sort((a, b) => a.sort - b.sort);
}

export async function newShot(scene, { what = '', framing = '', after = null, pieceId = null, by = null } = {}) {
  const list = await shotsUnder(scene);
  const at = after ? list.findIndex((s) => s.id === after) + 1 : list.length;
  const n = shotNumber(list.map((s) => s.fields?.n || null), at);
  const prev = list[at - 1];
  const next = list[at];
  const sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1024 : next ? next.sort - 1024 : 1024;
  const row = entry('shot', { id: newId('sh'), parent_id: scene, sort, text: what, fields: { n, framing, ...(pieceId ? { piece: pieceId } : {}) }, ...(by ? { _by: by } : {}) });
  await putEntries([row]);
  return row;
}

// Where a shot is, worked out from what it has: planned, prompted, renders
// in, a still picked, the take picked.
export const SHOT_STAGES = [
  { id: 'plan', label: 'Planned' },
  { id: 'prompt', label: 'Prompted' },
  { id: 'renders', label: 'Renders in' },
  { id: 'still', label: 'Still picked' },
  { id: 'take', label: 'Take picked' }
];
export function shotStage(shot) {
  const f = shot.fields || {};
  if (f.star?.video) return 'take';
  if (f.star?.still) return 'still';
  if ((f.tries || []).some((t) => t.files?.length)) return 'renders';
  if ((f.still || '').trim() || (f.video || '').trim()) return 'prompt';
  return 'plan';
}

// Keeps the prompts as they were when renders came back, so the wording that
// worked is never lost. Renders made with the prompts as they are now go with
// the last try if it had the same prompts, or start a new one.
export function withRenders(fields, fileIds, by = 'me', at = Date.now()) {
  const tries = [...(fields.tries || [])];
  const cur = { still: fields.still || '', video: fields.video || '' };
  const last = tries.at(-1);
  if (last && (last.still || '') === cur.still && (last.video || '') === cur.video) tries[tries.length - 1] = { ...last, files: [...(last.files || []), ...fileIds] };
  else tries.push({ id: newId('tr'), at, by, ...cur, files: [...fileIds] });
  return { ...fields, tries };
}

// New prompts (from Claude, or brought back from an earlier try). The ones
// they replace are kept as a try of their own unless they already are one.
export function withPrompts(fields, { still, video }, by = 'me', at = Date.now()) {
  const tries = [...(fields.tries || [])];
  const cur = { still: fields.still || '', video: fields.video || '' };
  const kept = tries.some((t) => (t.still || '') === cur.still && (t.video || '') === cur.video);
  if ((cur.still || cur.video) && !kept) tries.push({ id: newId('tr'), at, by: fields.prompt_by || 'me', ...cur, files: [] });
  return { ...fields, tries, still: still ?? cur.still, video: video ?? cur.video, prompt_by: by };
}

export const isVideo = (type) => /^video\//.test(type || '');

// A file name carrying a shot's code finds its shot: "NB-E01-S03A-04 v2.mp4".
export function shotForName(name, codes) {
  const up = String(name || '').toUpperCase();
  let best = null;
  for (const [code, id] of codes) if (code && up.includes(code) && (!best || code.length > best.code.length)) best = { code, id };
  return best?.id || null;
}

// ---------- how it's made ----------

// How a shot gets made. A generated shot needs nothing from a shoot; one
// from reference needs footage to generate from (an action move, say); a
// live-action shot is filmed. Live-action pieces start their shots there.
export const MADE_BY = [
  { id: 'gen', label: 'Generated' },
  { id: 'ref', label: 'From reference', about: 'Generated from footage you shoot' },
  { id: 'live', label: 'Live action', about: 'Filmed' }
];
export const madeBy = (shot, setId) => shot?.fields?.made || (setId === 'live' ? 'live' : 'gen');
export const needsFootage = (made) => made === 'ref' || made === 'live';

// A scene's voices: recorded in a session, generated, or some of each. The
// project's choice unless the scene says otherwise.
export const AUDIO = [
  { id: 'recorded', label: 'Recorded voices' },
  { id: 'generated', label: 'Generated voices' },
  { id: 'both', label: 'Recorded and generated' }
];
export const audioOf = (bd, world) => bd?.fields?.audio || world?.fields?.production?.audio || 'recorded';
export const needsVoices = (audio) => audio === 'recorded' || audio === 'both';

// What still needs a day: scenes with shots to film that aren't on a shoot
// day, and scenes with voices to record that aren't on a voice session.
// scenes: [{ id, shots, audio, talk }] where talk says it has lines.
export function toPlan(scenes, days, setId) {
  const on = (type) => new Set(days.filter((d) => !d.deleted && (d.fields?.type === 'voice') === (type === 'voice')).flatMap((d) => d.fields?.scenes || []));
  const shooting = on('shoot');
  const voicing = on('voice');
  const shoot = [];
  const voice = [];
  for (const s of scenes) {
    const shots = (s.shots || []).filter((sh) => needsFootage(madeBy(sh, setId)));
    if (shots.length && !shooting.has(s.id)) shoot.push({ scene: s, shots });
    if (s.talk && needsVoices(s.audio) && !voicing.has(s.id)) voice.push(s);
  }
  return { shoot, voice };
}

// ---------- shoot days ----------

export async function shootDays(pieceId) {
  return (await children(pieceId)).filter((r) => r.kind === 'shootday').sort((a, b) => String(a.fields?.date || '').localeCompare(String(b.fields?.date || '')) || a.created_at - b.created_at);
}

export async function newShootDay(pieceId, date, { type = null, scenes = [] } = {}) {
  const row = entry('shootday', { id: newId('sd'), parent_id: pieceId, title: '', fields: { date, call: '', place: '', scenes, notes: '', ...(type === 'voice' ? { type } : {}) } });
  await putEntries([row]);
  return row;
}

// The task Daybook gets for a shoot day: on its date, at call time.
export function dayTask(day, piece, base) {
  const f = day.fields || {};
  const [h, m] = String(f.call || '').split(':').map(Number);
  return {
    id: `inkwell-${day.id}`,
    title: `${f.type === 'voice' ? 'Voice session' : 'Shoot'}: ${piece.title || 'Untitled'}${f.place ? ` at ${f.place}` : ''}`,
    notes: f.notes || null,
    link: `${base}?open=${encodeURIComponent(day.id)}`,
    deleted: false,
    ...(f.date ? { day: f.date } : {}),
    ...(f.date && Number.isFinite(h) ? { start_min: h * 60 + (m || 0) } : {})
  };
}

// ---------- out to the edit ----------

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

// The script's dialogue as subtitles: one per speech, in order, two seconds
// apart. The words and names are right; the timing is done in Resolve.
export function toSrt(speeches, { names = false, each = 2000 } = {}) {
  const t = (ms) => {
    const two = (n, w = 2) => String(n).padStart(w, '0');
    return `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)},${two(ms % 1000, 3)}`;
  };
  return speeches.map((s, i) => `${i + 1}\n${t(i * each)} --> ${t((i + 1) * each - 1)}\n${names && s.who ? `${s.who}: ` : ''}${s.text}\n`).join('\n');
}

// Speeches from a script's lines (as stored, in order): a character's name
// and the dialogue under it, parentheticals left out.
export function speechesIn(rows) {
  const out = [];
  let who = null;
  for (const r of rows) {
    const el = r.fields?.el;
    const text = (r.text || '').trim();
    if (el === 'character') { who = text.replace(/\s*\(.*?\)\s*/g, ' ').trim(); if (out.length) out.at(-1).open = false; continue; }
    if (el === 'dialogue' && text) { const last = out.at(-1); if (last && last.who === who && last.open) last.text += ` ${text}`; else out.push({ who, text, open: true }); continue; }
    if (el !== 'paren') { who = null; if (out.length) out.at(-1).open = false; }
  }
  return out.map(({ who: w, text }) => ({ who: w, text }));
}

export const PLATFORMS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'x', label: 'X' }
];

export { codeOrder };
