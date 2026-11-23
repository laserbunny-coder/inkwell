// What a making stage on the path says is done and what is left (Studio
// polish build 3, Nov 23 2026), so the path doubles as the film's to-do list:
//   Boarding    "3 of 5 shots have a picked still"
//   Prepping    "5 shots planned, 3 with a frame. The poster and Two coffees are on no shoot day yet."
//   Generating  "1 of 5 takes picked. About $9.40 still to make."
//   Shooting    "Sat, Dec 5 at Bonneville turn-off. 2 of 4 shots still to get."
//   Editing     "Hand-off for Resolve not made yet"
//   the last    "Not out yet"
// Boarding and Prepping also count the lines without a shot, once shots sit
// on their lines.
import { byKind, getEntry } from '../db.js';
import { stageSetOf, isOut, isReady, bookType, hasManuscript } from '../library.js';
import { isFilmed, gotIt, estimate, priceList, PRICES_ID, money, shootDays, toPlan, needsFootage, madeBy } from '../production.js';
import { bareLines } from '../shotlines.js';
import { sceneTitle } from '../scenename.js';
import { isoToday } from '../dates.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const and = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const setIdOf = (piece, world) => { const s = stageSetOf(piece, world); return s?.own ? s.base : s?.id; };

// The film's scenes in order, by their names, each with its lines and shots.
export async function scenesOf(piece) {
  if (!hasManuscript(piece)) return [];
  const { loadStructure, rowsAt } = await import('../grid.js');
  const st = await loadStructure(piece);
  if (!st.acts.length) return [];
  const script = bookType(piece) === 'screenplay';
  const texts = new Map();
  for (const act of st.acts) for (const ch of act.chapters) for (const r of ch.rows) texts.set(r.id, r);
  const named = script ? new Map(rowsAt('wscene', st, piece).filter((r) => r.type === 'row' && r.kind === 'scene').map((r) => [r.id, r])) : new Map();
  const shots = (await byKind('shot')).filter((sh) => !sh.deleted);
  return rowsAt(script ? 'slug' : 'scene', st, piece).filter((x) => x.type === 'row').map((x) => {
    const w = named.get(x.id);
    const name = (w && sceneTitle({ title: w.name || '', first: w.first || '' })) || x.title || 'A scene';
    const paras = x.members.slice(1).map((id) => texts.get(id)).filter((r) => r && r.kind === 'para').map((r) => ({ id: r.id, el: r.fields?.el || 'action', text: r.text || '' }));
    return { id: x.id, name, paras, shots: shots.filter((sh) => sh.parent_id === x.id).sort((a, b) => a.sort - b.sort) };
  });
}

// "N lines without a shot", once any shot sits on its lines.
function bareText(scenes) {
  const all = scenes.flatMap((s) => s.shots);
  if (!all.some((sh) => sh.fields?.from)) return '';
  const n = scenes.reduce((k, s) => k + bareLines(s.shots, s.paras).length, 0);
  return n ? ` ${plural(n, 'line')} without a shot.` : ' Every line has a shot.';
}

const dayWords = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export async function pathNote(kind, piece, world) {
  if (kind === 'edit') {
    const at = piece.fields?.handoff;
    return at ? `Hand-off for Resolve made ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Hand-off for Resolve not made yet';
  }
  if (kind === 'out') return isOut(piece, world) ? 'Out' : isReady(piece, world) ? 'Ready to go out' : 'Not out yet';
  const setId = setIdOf(piece, world);
  const scenes = await scenesOf(piece);
  const shots = scenes.flatMap((s) => s.shots);
  if (!shots.length) return 'no shots yet';
  const filmed = shots.filter((sh) => isFilmed(sh, setId));
  const made = shots.filter((sh) => !isFilmed(sh, setId));
  if (kind === 'board') {
    const picked = shots.filter((sh) => sh.fields?.star?.still).length;
    return `${picked} of ${plural(shots.length, 'shot')} ${shots.length === 1 ? 'has' : 'have'} a picked still.${bareText(scenes)}`;
  }
  if (kind === 'days') {
    const days = (await shootDays(piece.id)).filter((d) => !d.deleted && d.fields?.type !== 'voice');
    const today = isoToday();
    const next = days.find((d) => (d.fields?.date || '') >= today) || days.at(-1);
    const where = next ? `${next.fields?.date ? dayWords(next.fields.date) : 'A shoot day with no date'}${next.fields?.place ? ` at ${next.fields.place}` : ''}.` : 'No shoot day yet.';
    const toGet = filmed.length ? filmed : shots.filter((sh) => needsFootage(madeBy(sh, setId)));
    const left = toGet.filter((sh) => !gotIt(sh)).length;
    return toGet.length ? `${where} ${left ? `${left} of ${plural(toGet.length, 'shot')} still to get.` : 'Every shot is got.'}` : where;
  }
  // Shots: planning for the camera, or making with AI.
  if (setId === 'live' || (filmed.length && !made.length)) {
    const framed = shots.filter((sh) => (sh.fields?.tries || []).some((t) => t.files?.length || t.links?.length)).length;
    const plan = toPlan(scenes.map((s) => ({ id: s.id, shots: s.shots })), await shootDays(piece.id), setId).shoot;
    const names = plan.map((x) => x.scene.name ?? scenes.find((s) => s.id === x.scene.id)?.name).filter(Boolean);
    const off = names.length ? ` ${and(names.slice(0, 3))}${names.length > 3 ? ` and ${names.length - 3} more` : ''} ${names.length === 1 ? 'is' : 'are'} on no shoot day yet.` : '';
    return `${plural(shots.length, 'shot')} planned, ${framed} with a frame.${off}${bareText(scenes)}`;
  }
  const taken = made.filter((sh) => sh.fields?.star?.video).length;
  const pg = piece.fields?.gen || {};
  const tries = Number(pg.tries) > 0 ? Number(pg.tries) : 3;
  const est = estimate(made.filter((sh) => !sh.fields?.star?.video), priceList(await getEntry(PRICES_ID)), { model: pg.model || '', tries });
  const cost = est.usd > 0 ? ` About ${money(est.usd)} still to make.` : '';
  return `${taken} of ${plural(made.length, 'take')} picked.${cost}`;
}
