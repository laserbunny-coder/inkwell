// The Training page's amounts (Part 6): each exercise line shows its amounts
// as a quiet chip ("3 holds · seconds · mark 10 · video"). Tapping it changes
// them one at a time. They're fields on the line, never typed syntax, so the
// words stay plain and both he and Claude can edit the outline.

import { getEntry, putEntries } from './db.js';
import { popMenu, askText, toast } from './menu.js';

// The chip's words, or '' for any other line.
export function amountsOf(row) {
  if (row?.fields?.session) return row.fields.session.once ? 'once' : '';
  const ex = row?.fields?.ex;
  if (!ex) return '';
  const bits = [];
  if (ex.m) bits.push(`${ex.m} min`);
  if (ex.n) bits.push(`${ex.n} ${ex.w || 'sets'}`);
  if (ex.u) bits.push(ex.u);
  if (ex.lad && ex.mark) bits.push(`move up at ${ex.mark}`);
  if (ex.link) bits.push('video');
  return bits.join(' · ') || 'amounts';
}

const num = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

// The menu under the chip: one choice per amount.
export function amountsMenu(eid, anchor, { wrote = async () => {} } = {}) {
  const set = async (patch) => {
    const r = await getEntry(eid);
    if (!r?.fields?.ex) return;
    const ex = { ...r.fields.ex, ...patch };
    for (const k of Object.keys(patch)) if (patch[k] == null || patch[k] === '') delete ex[k];
    const kept = { ...r, fields: { ...r.fields, ex }, updated_at: Date.now() };
    await putEntries([kept]);
    await wrote([kept]);
  };
  const ask = async (title, key, { body = '', placeholder = '', number = false } = {}) => {
    const r = await getEntry(eid);
    const got = await askText({ title, value: r?.fields?.ex?.[key] ?? '', body, placeholder, type: number ? 'number' : 'text' });
    if (got == null) return;
    const v = number ? num(got) : String(got).trim();
    if (v === undefined) { toast('That needs a number'); return; }
    await set({ [key]: v });
  };
  popMenu(anchor, [
    { label: 'Sets…', run: () => ask('How many sets?', 'n', { number: true, body: 'One dot each in Now. Empty for none.' }) },
    { label: 'What a set is called…', run: () => ask('What is a set called?', 'w', { placeholder: 'sets, holds, jumps…' }) },
    { label: 'Minutes…', run: () => ask('How many minutes?', 'm', { number: true, body: 'For timed work, such as handstand holds. Empty for none.' }) },
    { label: 'What to record…', run: () => ask('What do you record?', 'u', { placeholder: 'seconds, reps, inches', body: 'One number each time. Empty for nothing.' }) },
    { label: 'How to do it…', run: () => ask('How to do it', 'd', { placeholder: 'One quiet line in Now' }) },
    { label: 'The mark to move up…', run: () => ask('Move up at', 'mark', { number: true, body: 'With all sets done at this mark, Now asks if you’re ready for the next step.' }) },
    { label: 'Notes and video link…', run: () => ask('Notes and video', 'link', { placeholder: 'https://' }) }
  ]);
}
