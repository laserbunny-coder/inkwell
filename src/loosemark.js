// What makes a line loose (see loose.js). Kept on its own, with nothing but
// dates to lean on, so the editor can ask it of every line it draws.

import { isoOf, addDays } from './tasks.js';

export const LOOSE_DAYS = 7;

const DAY_ID = /^day-(\d{4}-\d{2}-\d{2})$/;
export const dayOfPage = (id) => DAY_ID.exec(id || '')?.[1] || null;
// Is this day still one whose loose lines count?
export const inWindow = (iso, today = isoOf()) => !!iso && iso <= today && iso > addDays(today, -LOOSE_DAYS);

// A line straight on a day's page (not one indented under another), with words, and nothing yet saying what it is.
export function isLoose(row) {
  if (!row || row.deleted || row.kind !== 'line') return false;
  if (!dayOfPage(row.parent_id)) return false;
  if (!(row.text || '').trim()) return false;
  const f = row.fields || {};
  if (f.sorted || f.task || f.done || f.box || f.checklist || f.daybook || f.mirror || f.gather || f.mull || f.trashed) return false;
  if ((row.tags || []).length || (row.links || []).length) return false;
  return true;
}
