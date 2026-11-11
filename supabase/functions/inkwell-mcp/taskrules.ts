// Task rules for the Inkwell connector, the same as the app's (src/tasks.js
// in the inkwell repo): when a repeating task comes round, the day it's due,
// and how it reads in words. A task is a line with fields.task:
//   { v: 1, day, est, done_at (ms), actual, log, run, order, owner,
//     until, mark: 'date' | 'hard', repeat: { every, n, days, from, until },
//     did: [[day, minutes, ms]], habit, on: { day, at (minutes from midnight) }, len }
// Days are the person's local dates, YYYY-MM-DD.

export type RepeatRule = { every: "day" | "weekdays" | "week" | "month"; n?: number; days?: number[]; from: string; until?: string | null };
export type Task = {
  v: 1; day: string | null; est: number | null; done_at: number | null; actual: number | null;
  log: [number, number][]; run: number | null; order: number; owner?: string | null;
  until?: string | null; mark?: "date" | "hard" | null; repeat?: RepeatRule | null;
  did?: [string, number | null, number][]; habit?: boolean;
  /** Where it sits on the day's Calendar (minutes from midnight), and how long its block is. */
  on?: { day: string; at: number } | null; len?: number | null;
};

export const blank = (): Task => ({ v: 1, day: null, est: null, done_at: null, actual: null, log: [], run: null, order: 0 });
export const taskOf = (fields: Record<string, unknown> | undefined): Task | null => {
  const t = fields?.task as Task | undefined;
  return t && t.v ? t : null;
};

const DAY = 864e5;
const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");
export const addDays = (iso: string, n: number) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
const between = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);
/** Monday = 1 … Sunday = 7. */
export const dow = (iso: string) => ((new Date(ms(iso)).getUTCDay() + 6) % 7) + 1;
const monday = (iso: string) => addDays(iso, 1 - dow(iso));
export const isRepeat = (t: Task | null | undefined) => !!t?.repeat?.every;
export const isStretch = (t: Task | null | undefined) => !!(t?.day && t.until && t.until >= t.day);

/** Does this rule land on that day? */
export function lands(rule: RepeatRule | null | undefined, iso: string): boolean {
  if (!rule?.every || !rule.from || iso < rule.from || (rule.until && iso > rule.until)) return false;
  const n = Math.max(1, Number(rule.n) || 1);
  if (rule.every === "day") return between(rule.from, iso) % n === 0;
  if (rule.every === "weekdays") return dow(iso) <= 5;
  if (rule.every === "week") {
    const days = rule.days?.length ? rule.days : [dow(rule.from)];
    if (!days.includes(dow(iso))) return false;
    return (between(monday(rule.from), monday(iso)) / 7) % n === 0;
  }
  if (rule.every === "month") {
    const a = new Date(ms(rule.from)), d = new Date(ms(iso));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    if (d.getUTCDate() !== Math.min(a.getUTCDate(), last)) return false;
    return ((d.getUTCFullYear() - a.getUTCFullYear()) * 12 + d.getUTCMonth() - a.getUTCMonth()) % n === 0;
  }
  return false;
}
/** The next day it lands on after that one (null: it has run out). */
export function nextOn(rule: RepeatRule | null | undefined, after: string): string | null {
  for (let k = 1; k <= 800; k++) {
    const iso = addDays(after, k);
    if (rule?.until && iso > rule.until) return null;
    if (lands(rule, iso)) return iso;
  }
  return null;
}
export const firstOn = (rule: RepeatRule, day: string) => (lands(rule, day) ? day : nextOn(rule, day));

/** The day a task is due: a repeating one that was missed moves up to the latest day it has come round since. */
export function dueDay(t: Task, today: string): string | null {
  if (!isRepeat(t) || !t.day || t.day >= today) return t.day || null;
  for (let iso = today; iso > t.day; iso = addDays(iso, -1)) if (lands(t.repeat, iso)) return iso;
  return t.day;
}
/** Every day in a range a task is on: its own day, or each day a repeating one comes round (from its due day on). */
export function daysIn(t: Task, from: string, to: string, today: string): string[] {
  if (!isRepeat(t)) return t.day && t.day >= from && t.day <= to ? [t.day] : [];
  const due = dueDay(t, today);
  if (!due) return [];
  const out: string[] = [];
  if (due >= from && due <= to) out.push(due);
  for (let iso = due > from ? addDays(due, 1) : from; iso <= to && out.length < 400; iso = addDays(iso, 1)) if (iso > due && lands(t.repeat, iso)) out.push(iso);
  return out;
}

const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const listed = (w: string[]) => (w.length < 2 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w.at(-1)}`);
/** "Every day", "Weekdays", "Every Monday", "Every other week on Monday", "Every month on the 14th". */
export function repeatWord(rule: RepeatRule | null | undefined): string {
  if (!rule?.every) return "";
  const n = Math.max(1, Number(rule.n) || 1);
  if (rule.every === "day") return n === 1 ? "Every day" : n === 2 ? "Every other day" : `Every ${n} days`;
  if (rule.every === "weekdays") return "Weekdays";
  if (rule.every === "week") {
    const days = (rule.days?.length ? [...rule.days].sort((a, b) => a - b) : [dow(rule.from)]).map((d) => NAMES[d - 1]);
    if (n > 1) return `Every ${n === 2 ? "other week" : `${n} weeks`} on ${listed(days)}`;
    return days.length === 1 ? `Every ${days[0]}` : listed(days);
  }
  return `${n === 1 ? "Every month" : `Every ${n} months`} on the ${nth(new Date(ms(rule.from)).getUTCDate())}`;
}

/** A repeating task just ticked: the day goes into its history and it opens again on the next day it lands on. False when it has run out (it stays done). */
export function roll(t: Task, doneDay: string, now: number): boolean {
  t.did = [...(t.did || []), [doneDay, t.actual ?? null, t.done_at || now] as [string, number | null, number]].slice(-400);
  const next = nextOn(t.repeat, t.day && t.day > doneDay ? t.day : doneDay);
  if (!next) return false;
  Object.assign(t, { day: next, done_at: null, actual: null, log: [], run: null });
  return true;
}
