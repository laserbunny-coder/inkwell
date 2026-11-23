// The stage line is the path (One home, Nov 20 2026): each stage of a piece
// is a door to where that work happens. Built-in stage names map by what
// they are; a custom or renamed stage is read by its name and place, and
// falls back to the text.
//   the first stage (New idea)            → Ideas for this piece
//   writing (Writing, Outlining, Drafting, Polishing) → the text
//   checking (Revising, Workshopping)     → Drafts and notes
//   Boarding                              → Storyboard
//   Prepping, Generating (and Rehearsing, Recording, Animating) → Shots
//   Shooting, Filming                     → Shoot days
//   Editing                               → Deliver, at the files for the edit
//   the last stage (Posted, Released…)    → Deliver, at posting
// (Studio polish build 3, Nov 23 2026: each stage lands on its own screen.)
import { hasManuscript, stagesOf } from '../library.js';
import { bookPlace } from './routing.js';

export function doorKind(stage, list) {
  const i = list.indexOf(stage);
  const w = (stage || '').toLowerCase();
  if (i === list.length - 1 && i > 0) return 'out';
  if (/edit|\bcut/.test(w)) return 'edit';
  if (/post|release|publish|perform|\bout\b/.test(w)) return 'out';
  if (i === 0 || /idea|gather|pitch/.test(w)) return 'ideas';
  if (/revis|workshop|check|notes|feedback|read/.test(w)) return 'revise';
  if (/board/.test(w)) return 'board';
  if (/shoot|film/.test(w)) return 'days';
  if (/prep|generat|rehears|record|anim|design/.test(w)) return 'shots';
  return 'text';
}

export const DOOR_WORDS = { ideas: 'Ideas for this', text: 'The text', revise: 'Drafts and notes', board: 'Storyboard', shots: 'Shots', days: 'Shoot days', edit: 'Deliver, for the edit', out: 'Deliver, Posting' };
const TAB = { board: 'board', shots: 'shots', days: 'days' };

// Where a stage's door leads, as a place for go().
export async function doorPlace(piece, stage, world) {
  const kind = doorKind(stage, stagesOf(piece, world));
  const ms = hasManuscript(piece);
  if (kind === 'ideas') return { view: 'stage', id: piece.id, page: 'gather' };
  if (kind === 'revise' && ms) return { view: 'stage', id: piece.id, page: 'revise' };
  if (TAB[kind] && ms) return { view: 'production', id: piece.id, tab: TAB[kind] };
  if (kind === 'edit' && ms) return { view: 'deliver', id: piece.id, tab: 'files' };
  if (kind === 'out' && ms) return { view: 'deliver', id: piece.id, tab: 'post' };
  return bookPlace(piece.id);
}
