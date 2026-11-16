// Training streak and charts (One thing at a time, Part 7, Nov 15 2026).
// Plain functions over the training log, no database, so they can be
// checked on their own (tests/trainstats.mjs).
//
// The log (fields.training.log on the Training page): one entry per finished
// session or "I trained on my own":
//   { d: 'YYYY-MM-DD', s: session name, h: hard (or a test day), own: true?,
//     n: { exercise key: number }, st: { ladder: step index when recorded } }
//
// His standing rule was "no streaks, no nagging". He asked for the streak;
// the no-nagging half stays: a missed day simply starts the count again,
// silently. Sunday is not a training day: it never counts and never breaks.
// Today does not break the streak while it is still today.

const MS = 86400000;
const toMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
export const plusDays = (iso, n) => fromMs(toMs(iso) + n * MS);
// 0 = Sunday … 6 = Saturday
export const dow = (iso) => new Date(toMs(iso)).getUTCDay();
export const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / MS);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The log keeps at least two years.
export const KEEP_DAYS = 800;
export function trimLog(log, today) {
  const from = plusDays(today, -KEEP_DAYS);
  return (log || []).filter((e) => e && typeof e.d === 'string' && e.d >= from);
}

// Day → 'h' (hard or a test day) or 'l' (light, or on my own). Sundays left out.
export function trainedDays(log) {
  const out = new Map();
  for (const e of log || []) {
    if (!e?.d || dow(e.d) === 0) continue;
    const k = e.h ? 'h' : 'l';
    if (out.get(e.d) !== 'h') out.set(e.d, k);
  }
  return out;
}

// → { cur, best }. A day counts when trained; Sunday is skipped; today
// still to come doesn't break; any other day without a session starts again.
export function streakOf(log, today) {
  const days = trainedDays(log);
  if (!days.size) return { cur: 0, best: 0 };
  const first = [...days.keys()].sort()[0];
  let run = 0;
  let best = 0;
  for (let d = first; d <= today; d = plusDays(d, 1)) {
    if (dow(d) === 0) continue;
    if (days.has(d)) { run += 1; if (run > best) best = run; } else if (d !== today) run = 0;
  }
  return { cur: run, best };
}

// The one line at the top of the block, or '' (never a zero, never a loss).
export function streakLine({ cur, best }) {
  if (cur >= 2) return cur >= best ? `${cur} days in a row. Your best yet.` : `${cur} days in a row. Best ${best}.`;
  if (best >= 2) return `Best: ${best} days in a row.`;
  return '';
}

// Twelve weeks of dots: 12 columns (oldest first, this week last), each
// Monday to Saturday. kind: 'h' hard, 'l' light, 'm' no session, 't' today
// not yet trained, null nothing (before he started, or still to come).
export function gridOf(log, today) {
  const days = trainedDays(log);
  const first = days.size ? [...days.keys()].sort()[0] : null;
  const back = (dow(today) + 6) % 7; // days since Monday
  const monday = plusDays(today, -back);
  const cols = [];
  for (let c = 0; c < 12; c++) {
    const wk = plusDays(monday, -(11 - c) * 7);
    const col = [];
    for (let r = 0; r < 6; r++) {
      const d = plusDays(wk, r);
      let kind = null;
      if (days.has(d)) kind = days.get(d);
      else if (d === today) kind = 't';
      else if (first && d > first && d < today) kind = 'm';
      col.push({ d, kind, ago: 11 - c, day: DAYNAMES[r + 1] });
    }
    cols.push(col);
  }
  return cols;
}

export const gridCount = (cols) => cols.flat().filter((c) => c.kind === 'h' || c.kind === 'l').length;
export const gridLine = (n) => (n
  ? `Trained ${n} ${n === 1 ? 'day' : 'days'} in the last 12 weeks. Sundays are off and never count.`
  : 'Each day you train adds a dot. Sundays are off and never count.');
const agoWords = (ago) => (ago === 0 ? 'This week' : ago === 1 ? 'Last week' : `${ago} weeks ago`);
export function cellTip(c) {
  const what = { h: 'hard day', l: 'light day', m: 'no session', t: 'not yet' }[c.kind];
  return c.kind === 't' ? `Today: ${what}` : `${agoWords(c.ago)}, ${c.day}: ${what}`;
}

// ---------- the charts behind the goals ----------

export const GOALS = [
  { k: 'vtest', t: 'Vertical over 30 inches', n: 'Vertical', u: 'inches', goal: 30, gl: 'Goal 30' },
  { k: 'lever', t: 'Front lever', n: 'Front lever', u: 'seconds', lad: 'lever', gl: 'Move up at' },
  { k: 'planche', t: 'Straddle planche', n: 'Planche', u: 'seconds', lad: 'planche', gl: 'Move up at' },
  { k: 'presslow', t: 'Press to handstand', n: 'Press lowering', u: 'seconds' },
  { k: 'free', t: 'Two-minute handstand', n: 'Free handstand', u: 'seconds', goal: 120, gl: 'Goal 120', light: true }
];
export const goalOf = (k) => GOALS.find((g) => g.k === k);

// A goal's numbers, oldest first: { d, v, s (ladder step or undefined) }.
// The handstand counts from light days (and its test); a ladder from hard days.
export function seriesOf(log, k) {
  const g = goalOf(k);
  const out = [];
  for (const e of [...(log || [])].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))) {
    const v = e?.n?.[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const p = { d: e.d, v };
    if (g?.lad) p.s = e.st?.[g.lad] ?? 0;
    // One number a day: the later entry wins.
    if (out.length && out.at(-1).d === p.d) out.pop();
    out.push(p);
  }
  return out;
}
export const inWindow = (pts, today) => {
  const from = plusDays(today, -83);
  const w = pts.filter((p) => p.d >= from);
  return w.length ? w : pts.slice(-1);
};

// A ladder step's short name above its stretch: "Tuck", "Advanced tuck", "Full".
export function shortStep(name) {
  const s = /^front lever$/i.test(name || '') ? 'Full' : String(name || '').replace(/ front lever$| planche$/i, '').replace(/^Planche /, '');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

const unitOf = (g, v) => (g.u === 'inches' && v === 1 ? 'inch' : g.u === 'seconds' && v === 1 ? 'second' : g.u);
// Under the chart: "Advanced tuck front lever: 9 seconds now, up from 4 at the start of this step."
export function chartSentence(g, pts, steps = []) {
  const last = pts.at(-1);
  if (!last) return 'Your chart starts with your first number.';
  const same = g.lad ? pts.filter((p) => p.s === last.s) : pts;
  const first = same[0];
  const who = g.lad ? (steps[last.s] || g.n) : g.n;
  let s = `${who}: ${last.v} ${unitOf(g, last.v)} now`;
  if (first !== last) s += `${last.v > first.v ? ', up from ' : ', from '}${first.v}${g.lad ? ' at the start of this step' : ` on ${shortDate(first.d)}`}`;
  return `${s}.`;
}
// Pointing at a point: "Oct 12: 5 seconds, advanced tuck".
export const pointSentence = (g, p, steps = []) => `${shortDate(p.d)}: ${p.v} ${unitOf(g, p.v)}${g.lad ? `, ${shortStep(steps[p.s] || '').toLowerCase()}` : ''}`;

// Two or three round numbers between lo and hi.
export function niceTicks(lo, hi) {
  const raw = (hi - lo) / 3 || 1;
  let step = 10 ** Math.floor(Math.log10(raw));
  const m = raw / step;
  step *= m > 5 ? 10 : m > 2 ? 5 : m > 1 ? 2 : 1;
  const t = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(Math.round(v * 100) / 100);
  return t;
}

// ---------- after a session ----------

// The goal numbers in this entry that beat every earlier number at the same
// step. Never for the first number at a step. → ["advanced tuck front lever, 10 seconds"]
export function bestYet(log, entry, steps = {}) {
  const out = [];
  for (const g of GOALS) {
    const v = entry?.n?.[g.k];
    if (typeof v !== 'number') continue;
    const s = g.lad ? entry.st?.[g.lad] ?? 0 : undefined;
    const prev = (log || []).filter((e) => e !== entry && !(e.d === entry.d && e.s === entry.s) && typeof e?.n?.[g.k] === 'number' && (!g.lad || (e.st?.[g.lad] ?? 0) === s));
    if (!prev.length) continue;
    if (v <= Math.max(...prev.map((e) => e.n[g.k]))) continue;
    const who = g.lad ? (steps[g.lad]?.[s] || g.n) : g.n;
    out.push(`${who.toLowerCase()}, ${v} ${unitOf(g, v)}`);
  }
  return out;
}

// The quiet line under "Done.": each half follows its own switch.
export function gateLine(log, entry, today, { charts = true, streak = true, steps = {} } = {}) {
  const bits = [];
  if (charts) { const b = bestYet(log, entry, steps); if (b.length) bits.push(`Best yet: ${b.join('; ')}.`); }
  if (streak) { const { cur } = streakOf(log, today); if (cur >= 2) bits.push(`${cur} days in a row.`); }
  return bits.join(' ');
}

// ---------- filling the log once from the daily pages ----------

// From what Part 6 left on his days: a line "Training: Hard A" (or "Training:
// on my own") with a child line per result, like "Tuck front lever hold: 8
// seconds, 4 of 5 holds" or "Tuck front lever hold with planche lean hold: 8
// and 6 seconds". names: lower-cased exercise name → { k, lad, i }.
// sessions: lower-cased session name → { hard }.
export function entryFromLines(day, title, kids, names, sessions) {
  const m = /^training:\s*(.+)$/i.exec(String(title || '').trim());
  if (!m) return null;
  const s = m[1].trim();
  const own = /^on my own$/i.test(s);
  const ses = sessions.get(s.toLowerCase());
  const e = { d: day, s: own ? 'On my own' : s, h: !own && (!!ses?.hard || !!ses?.once || /^(hard|evaluation)/i.test(s)), n: {}, st: {} };
  if (own) e.own = true;
  for (const text of kids) {
    const r = /^(.+?):\s*(.+)$/.exec(String(text || '').trim());
    if (!r) continue;
    const who = r[1].split(/\s+with\s+/i).map((x) => names.get(x.trim().toLowerCase()));
    const nums = [];
    const first = r[2].split(',')[0];
    for (const part of first.split(/\s+and\s+/i)) { const n = /(-?\d+(?:\.\d+)?)/.exec(part); if (n) nums.push(Number(n[1])); }
    who.forEach((x, i) => {
      if (!x || nums[i] == null || /\bof\b/.test(first.split(/\s+and\s+/i)[i] || '')) return;
      e.n[x.k] = nums[i];
      if (x.lad) e.st[x.lad] = x.i;
    });
  }
  return e;
}
