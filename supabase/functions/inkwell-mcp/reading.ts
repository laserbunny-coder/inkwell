// First light (Part 5) and Training (Part 6) as the connector sees them: the
// same reading plan as the app (src/firstlight.js; keep the two in step) and
// the training week. Pure, no imports, so it can be checked on its own.

const OT: [string, number][] = [["Genesis", 50], ["Exodus", 40], ["Leviticus", 27], ["Numbers", 36], ["Deuteronomy", 34], ["Joshua", 24], ["Judges", 21], ["Ruth", 4], ["1 Samuel", 31], ["2 Samuel", 24], ["1 Kings", 22], ["2 Kings", 25], ["1 Chronicles", 29], ["2 Chronicles", 36], ["Ezra", 10], ["Nehemiah", 13], ["Esther", 10], ["Job", 42], ["Song of Solomon", 8], ["Isaiah", 66], ["Jeremiah", 52], ["Lamentations", 5], ["Ezekiel", 48], ["Daniel", 12], ["Hosea", 14], ["Joel", 3], ["Amos", 9], ["Obadiah", 1], ["Jonah", 4], ["Micah", 7], ["Nahum", 3], ["Habakkuk", 3], ["Zephaniah", 3], ["Haggai", 2], ["Zechariah", 14], ["Malachi", 4]];
const NT: [string, number][] = [["Matthew", 28], ["Mark", 16], ["Luke", 24], ["John", 21], ["Acts", 28], ["Romans", 16], ["1 Corinthians", 16], ["2 Corinthians", 13], ["Galatians", 6], ["Ephesians", 6], ["Philippians", 4], ["Colossians", 4], ["1 Thessalonians", 5], ["2 Thessalonians", 3], ["1 Timothy", 6], ["2 Timothy", 4], ["Titus", 3], ["Philemon", 1], ["Hebrews", 13], ["James", 5], ["1 Peter", 5], ["2 Peter", 3], ["1 John", 5], ["2 John", 1], ["3 John", 1], ["Jude", 1], ["Revelation", 22]];
export const TRACKS: { k: "ot" | "ps" | "wi" | "nt"; name: string; books: [string, number][]; per: number }[] = [
  { k: "ot", name: "Old Testament", books: OT, per: 2 },
  { k: "ps", name: "Psalms", books: [["Psalm", 150]], per: 1 },
  { k: "wi", name: "Wisdom", books: [["Proverbs", 31], ["Ecclesiastes", 12]], per: 1 },
  { k: "nt", name: "New Testament", books: NT, per: 2 },
];

// Reading plans (Nov 23 2026, add-ons), as in src/firstlight.js: fields.reading.plan.
const JOB = OT.findIndex(([b]) => b === "Job") + 1;
const OT_ALL: [string, number][] = [...OT.slice(0, JOB), ["Psalms", 150], ["Proverbs", 31], ["Ecclesiastes", 12], ...OT.slice(JOB)];
type Track = { k: string; name: string; books: [string, number][]; per: number };
export const PLANS: Record<string, { name: string; tracks: Track[] }> = {
  four: { name: "Four tracks", tracks: TRACKS },
  year: { name: "Old and New Testament", tracks: [{ k: "yo", name: "Old Testament", books: OT_ALL, per: 3 }, { k: "yn", name: "New Testament", books: NT, per: 1 }] },
  chapter: { name: "One chapter a day", tracks: [{ k: "ch", name: "The Bible", books: [...OT_ALL, ...NT], per: 1 }] },
};
export const planOf = (st: Record<string, unknown>) => (typeof st?.plan === "string" && PLANS[st.plan] ? st.plan : "four");
export const tracksOf = (st: Record<string, unknown>): Track[] => PLANS[planOf(st)].tracks;

const total = (books: [string, number][]) => books.reduce((a, b) => a + b[1], 0);
export function posOf(books: [string, number][], i: number): [number, number] {
  const n = total(books);
  let j = ((Math.floor(i) % n) + n) % n;
  for (let b = 0; b < books.length; b++) { if (j < books[b][1]) return [b, j + 1]; j -= books[b][1]; }
  return [0, 1];
}
export const refAt = (books: [string, number][], i: number) => { const [b, ch] = posOf(books, i); return `${books[b][0]} ${ch}`; };

const norm = (s: string) => s.toLowerCase().replace(/\bpsalms\b/, "psalm").replace(/\bsong of songs\b/, "song of solomon").replace(/^(i{1,3})\s/, (_m, r: string) => `${r.length} `).replace(/\s+/g, " ").trim();

// "2 Kings 4", "Psalm 23", "Ecclesiastes" (chapter 1) → a place in that track,
// or an error naming the books it takes.
export function placeIn(k: string, ref: unknown, tracks: Track[] = TRACKS): { place: number } | { error: string } {
  const t = tracks.find((x) => x.k === k);
  if (!t) return { error: `There's no reading track ${k}.` };
  const m = /^(.*?)(?:\s+(\d{1,3}))?$/.exec(String(ref ?? "").trim());
  const book = norm(m?.[1] ?? "");
  const ch = m?.[2] ? Number(m[2]) : 1;
  const b = t.books.findIndex(([name]) => norm(name) === book);
  if (b < 0) return { error: `${t.name} takes ${t.books.length > 3 ? `a book from ${t.books[0][0]} to ${t.books[t.books.length - 1][0]}` : t.books.map((x) => x[0]).join(" or ")}${t.k === "ot" ? " (Psalms, Proverbs and Ecclesiastes have their own tracks)" : ""}.` };
  if (ch < 1 || ch > t.books[b][1]) return { error: `${t.books[b][0]} has ${t.books[b][1]} chapter${t.books[b][1] === 1 ? "" : "s"}.` };
  let place = 0;
  for (let x = 0; x < b; x++) place += t.books[x][1];
  return { place: place + ch - 1 };
}

// Today's chapters from the places (six on the four tracks).
export function todays(st: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const t of tracksOf(st)) for (let n = 0; n < t.per; n++) out.push(refAt(t.books, (Number(st[t.k]) || 0) + n));
  return out;
}

// ---------- the training week ----------

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// { monday: "Hard A", tuesday: "Light", sunday: null… } → { 1: "Hard A", 2: "Light" }
// with session names matched to the page's (any case); days left out rest.
export function weekFrom(arg: unknown, names: string[]): { week: Record<string, string> } | { error: string } {
  if (!arg || typeof arg !== "object" || Array.isArray(arg)) return { error: "week must be an object of weekday → session name, such as { \"monday\": \"Hard A\" }." };
  const week: Record<string, string> = {};
  for (const [day, v] of Object.entries(arg as Record<string, unknown>)) {
    const d = WEEKDAYS.findIndex((w) => w === day.toLowerCase().trim() || w.slice(0, 3) === day.toLowerCase().trim());
    if (d < 0) return { error: `${day} isn't a weekday.` };
    if (v == null || v === "" || /^(rest|off|none)$/i.test(String(v))) continue;
    const name = names.find((n) => n.toLowerCase() === String(v).toLowerCase().trim());
    if (!name) return { error: `There's no session called ${v}. The sessions are ${names.join(", ")}.` };
    week[String(d + 1)] = name;
  }
  return { week };
}

export const weekWords = (week: unknown) => {
  const w = (week && typeof week === "object" ? week : {}) as Record<string, string>;
  return Object.fromEntries(WEEKDAYS.map((d, i) => [d, w[String(i + 1)] || "rest"]));
};
