import { putEntries, getEntry } from './db.js';

// Day reviews. Claude used to read a day's page at 9 pm and sort what was on
// it. That card is gone (Nov 2026); reviews already made stay with their day,
// as an entry of its own (review-<date>) under the day page, and the loose
// lines still read which lines a review already sorted.

export const reviewId = (iso) => `review-${iso}`;

export async function getReview(iso) {
  const row = await getEntry(reviewId(iso));
  return row && !row.deleted && row.fields?.review ? row : null;
}

const inline = (content) => (content || []).map((n) => (n.type === 'text' ? n.text : n.type === 'entryRef' ? n.attrs?.title || '' : '')).join('');
const live = (r) => r && !r.deleted && !r.fields?.trashed && !r.fields?.mirror;

// The lines among `ids` that aren't under another of them.
async function headLines(ids) {
  const out = [];
  for (const id of ids || []) {
    const r = await getEntry(id);
    if (live(r) && !(ids.includes(r.parent_id))) out.push(r);
  }
  return out;
}

// Puts a [[link]] to `place` at the end of each line.
export async function addLink(ids, place) {
  const rows = [];
  for (const r of await headLines(ids)) {
    if ((r.links || []).includes(place.id)) continue;
    const content = [...(r.content || [])];
    const last = content[content.length - 1];
    if (last && !(last.type === 'text' && /\s$/.test(last.text))) content.push({ type: 'text', text: ' ' });
    content.push({ type: 'entryRef', attrs: { id: place.id, title: place.title } });
    rows.push({ ...r, content, text: inline(content), links: [...new Set([...(r.links || []), place.id])], updated_at: Date.now() });
  }
  if (rows.length) await putEntries(rows);
  return rows;
}
