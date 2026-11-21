// The stage line is the path (One home, Nov 20 2026): each stage of a piece
// is a door to where that work happens. Built-in stage names map by what
// they are; a custom or renamed stage is read by its name and place, and
// falls back to the text.
//   the first stage (New idea)            → Ideas for this piece
//   writing (Writing, Outlining, Drafting, Polishing) → the text
//   checking (Revising, Workshopping)     → Drafts and notes
//   making (Boarding, Prepping, Generating, Shooting, Rehearsing) → Shots
//   Editing, and the last stage           → Share and post
import { hasManuscript, stagesOf } from '../library.js';
import { bookPlace } from './routing.js';

export function doorKind(stage, list) {
  const i = list.indexOf(stage);
  const w = (stage || '').toLowerCase();
  if (i === list.length - 1 && i > 0) return 'deliver';
  if (/edit|post|release|publish|perform|\bout\b|cut/.test(w)) return 'deliver';
  if (i === 0 || /idea|gather|pitch/.test(w)) return 'ideas';
  if (/revis|workshop|check|notes|feedback|read/.test(w)) return 'revise';
  if (/board|prep|generat|shoot|rehears|film|record|anim|design/.test(w)) return 'make';
  return 'text';
}

export const DOOR_WORDS = { ideas: 'Ideas for this', text: 'The text', revise: 'Drafts and notes', make: 'Shots', deliver: 'Share and post' };

// Where a stage's door leads, as a place for go().
export async function doorPlace(piece, stage, world) {
  const kind = doorKind(stage, stagesOf(piece, world));
  const ms = hasManuscript(piece);
  if (kind === 'ideas') return { view: 'stage', id: piece.id, page: 'gather' };
  if (kind === 'revise' && ms) return { view: 'stage', id: piece.id, page: 'revise' };
  if (kind === 'make' && ms) return { view: 'production', id: piece.id };
  if (kind === 'deliver' && ms) return { view: 'deliver', id: piece.id };
  return bookPlace(piece.id);
}
