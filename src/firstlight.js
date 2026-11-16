// First light (One thing at a time, Part 5, Nov 15 2026): the morning Bible
// reading, before anything else the first time Today is opened each day.
//
// His plan: four tracks, each going round by itself and starting over at its
// end. Old Testament 2 chapters (without Psalms, Proverbs and Ecclesiastes;
// Song of Solomon stays), Psalms 1, Wisdom 1 (Proverbs, then Ecclesiastes),
// New Testament 2. A place only moves when he says he read; a missed day
// changes nothing. The places sync with the plan's settings:
//   settings-plan fields.reading = { ot, ps, wi, nt (chapter counts from the
//     start of each track), read: day, skip: day }
//
// The text is the ESV through Crossway's API, one chapter per request, from
// the server (mode "esv") with his key. Until the key exists the server says
// { nokey: true }: then each chapter name links to esv.org and "I read it"
// is the way through. Only today's chapters are kept on the device.

import { getEntry } from './db.js';
import { PLAN_ID, savePlanSettings, isoOf, tickTask, addDays } from './tasks.js';
import { withDay, withoutDay, cleanDays, trackWords, daysFromHistory } from './readstats.js';

const OT = [['Genesis', 50], ['Exodus', 40], ['Leviticus', 27], ['Numbers', 36], ['Deuteronomy', 34], ['Joshua', 24], ['Judges', 21], ['Ruth', 4], ['1 Samuel', 31], ['2 Samuel', 24], ['1 Kings', 22], ['2 Kings', 25], ['1 Chronicles', 29], ['2 Chronicles', 36], ['Ezra', 10], ['Nehemiah', 13], ['Esther', 10], ['Job', 42], ['Song of Solomon', 8], ['Isaiah', 66], ['Jeremiah', 52], ['Lamentations', 5], ['Ezekiel', 48], ['Daniel', 12], ['Hosea', 14], ['Joel', 3], ['Amos', 9], ['Obadiah', 1], ['Jonah', 4], ['Micah', 7], ['Nahum', 3], ['Habakkuk', 3], ['Zephaniah', 3], ['Haggai', 2], ['Zechariah', 14], ['Malachi', 4]];
const NT = [['Matthew', 28], ['Mark', 16], ['Luke', 24], ['John', 21], ['Acts', 28], ['Romans', 16], ['1 Corinthians', 16], ['2 Corinthians', 13], ['Galatians', 6], ['Ephesians', 6], ['Philippians', 4], ['Colossians', 4], ['1 Thessalonians', 5], ['2 Thessalonians', 3], ['1 Timothy', 6], ['2 Timothy', 4], ['Titus', 3], ['Philemon', 1], ['Hebrews', 13], ['James', 5], ['1 Peter', 5], ['2 Peter', 3], ['1 John', 5], ['2 John', 1], ['3 John', 1], ['Jude', 1], ['Revelation', 22]];
export const TRACKS = [
  { k: 'ot', name: 'Old Testament', books: OT, per: 2 },
  { k: 'ps', name: 'Psalms', books: [['Psalm', 150]], per: 1 },
  { k: 'wi', name: 'Wisdom', books: [['Proverbs', 31], ['Ecclesiastes', 12]], per: 1 },
  { k: 'nt', name: 'New Testament', books: NT, per: 2 }
];

const total = (books) => books.reduce((a, b) => a + b[1], 0);
// A place (chapters from the start) → [book index, chapter], going round.
export function posOf(books, i) {
  const n = total(books);
  let j = ((Math.floor(i) % n) + n) % n;
  for (let b = 0; b < books.length; b++) { if (j < books[b][1]) return [b, j + 1]; j -= books[b][1]; }
  return [0, 1];
}
// [book index, chapter] → a place.
export function placeOf(books, b, ch) {
  let i = 0;
  for (let k = 0; k < b; k++) i += books[k][1];
  return i + Math.min(Math.max(1, Math.floor(ch) || 1), books[b][1]) - 1;
}

const blank = () => ({ ot: 0, ps: 0, wi: 0, nt: 0, read: null, skip: null, days: [], rounds: {} });
export async function readReading() {
  const row = await getEntry(PLAN_ID);
  const r = row && !row.deleted ? row.fields?.reading : null;
  return { ...blank(), ...(r && typeof r === 'object' ? r : {}) };
}
export async function saveReading(next) { return savePlanSettings({ reading: next }); }

// Today's six chapters, in order.
export function todays(st) {
  const out = [];
  for (const t of TRACKS) for (let n = 0; n < t.per; n++) { const [b, ch] = posOf(t.books, (st[t.k] || 0) + n); out.push(`${t.books[b][0]} ${ch}`); }
  return out;
}
// Read: each track moves on by its share, round to the start at its end
// (which counts a time through), and the day goes in the log (Part 8).
function moved(st) {
  const next = { ...st, rounds: { ...(st.rounds || {}) } };
  for (const t of TRACKS) {
    const at = (st[t.k] || 0) + t.per;
    if (at >= total(t.books)) next.rounds[t.k] = (next.rounds[t.k] || 0) + 1;
    next[t.k] = at % total(t.books);
  }
  return next;
}
export function advanced(st, day = isoOf()) {
  return { ...moved(st), read: day, skip: null, days: withDay(st.days, day, day) };
}
// "I read yesterday too": yesterday goes in the log and each place moves on
// by one day's reading. Today stays as it was.
export function readYesterday(st, today = isoOf()) {
  const y = addDays(today, -1);
  return { ...moved(st), read: st.read && st.read > y ? st.read : y, days: withDay(st.days, y, today) };
}
// Offered the morning after a day with no mark, once he has read at least once.
export const missedYesterday = (st, today = isoOf()) => !!(st.days?.length || st.read) && !(st.days || []).includes(addDays(today, -1)) && st.read !== addDays(today, -1) && st.read !== today;
// A day in the past week switched between read and not read. Places stay.
export function toggledDay(st, day, today = isoOf()) {
  const has = (st.days || []).includes(day);
  return { ...st, days: has ? withoutDay(st.days, day) : withDay(st.days, day, today) };
}
export const totalOf = (t) => total(t.books);
// Each track: { k, name, words, pos, total } for the Desk.
export function trackRows(st) {
  return TRACKS.map((t) => {
    const pos = st[t.k] || 0;
    const [b, ch] = posOf(t.books, pos);
    return { k: t.k, name: t.name, pos, total: total(t.books), words: trackWords(t.books[b][0], ch, t.books.length, total(t.books), st.rounds?.[t.k] || 0) };
  });
}

// Filled once from his Bible habit's history and First light's last day.
const isBibleHabit = (i) => i.mine !== false && i.task?.habit && BIBLE.test(i.row?.text || '');
export async function readingLog(items = [], today = isoOf()) {
  const st = await readReading();
  if (st.filled) return st;
  const next = { ...st, filled: true, days: cleanDays([...(st.days || []), ...daysFromHistory(st, items.filter(isBibleHabit).map((i) => i.task))], today) };
  await saveReading(next);
  return next;
}

// The chapter on esv.org: https://www.esv.org/2+Kings+4/
export const esvLink = (ref) => `https://www.esv.org/${String(ref).trim().replace(/\s+/g, '+')}/`;

// ---------- today's chapters on this device ----------

const KEY = 'firstLight';
function store(day) {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.day === day) return s; } catch { /* nothing kept */ }
  return { day, ch: {}, nokey: null };
}
function keep(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* no storage here */ }
}
// What the device knows today: has the key been seen missing? (null = not asked yet)
export const keyState = (day = isoOf()) => store(day).nokey;
export const kept = (ref, day = isoOf()) => store(day).ch[ref] || null;

// One chapter: from today's store, else the server. Yesterday's are dropped.
// → { text, notice } | { nokey: true } | { error }
export async function chapter(ref, ask, day = isoOf()) {
  const s = store(day);
  if (s.ch[ref]) return s.ch[ref];
  if (!ask) return { error: 'Reading here needs a connection.' };
  let got;
  try { got = await ask({ mode: 'esv', ref }); } catch (e) { console.warn(e); got = null; }
  if (got?.nokey) { s.nokey = true; keep(s); return { nokey: true }; }
  if (!got || got.error || typeof got.text !== 'string') return { error: got?.error || 'That chapter didn’t come through.' };
  s.nokey = false;
  s.ch[ref] = { text: got.text, notice: String(got.notice || '') };
  keep(s);
  return s.ch[ref];
}

// His Bible habit for today, if he has one: ticked when he has read.
const BIBLE = /\b(bible|scripture|reading|read the word|devotion|first light)\b/i;
export async function tickBibleHabit(items, today = isoOf()) {
  const h = items.find((i) => i.mine !== false && i.task?.habit && !i.row.fields?.done && !i.ghost && i.task.day === today && BIBLE.test(i.row.text || ''));
  if (!h) return null;
  return { id: h.row.id, rows: await tickTask(h.row.id, true) };
}
