// Writes Inkwell's weekly and monthly summaries (see digest.ts). Woken at 4 am
// Los Angeles time by the database's job, which proves itself with the secret
// in push_config. Each run catches up on any finished week (up to eight back)
// or month (up to three back) that has something written and no summary yet,
// a few at a time, so a missed night is made up the next.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, json } from "../_shared/common.ts";
import {
  addDays, dayStart, localDate, mondayNote, mondayOf, MODEL, monthEnd, monthLetter, monthPrompt, monthTitle, MONTH_SYSTEM, periodsDue, type Row, SCHEMA, tidy,
  WEEK_SCHEMA, weekPrompt, weekTitle, WEEK_SYSTEM,
} from "./digest.ts";
import { makeTidy } from "../_shared/tidyrun.ts";

const INKWELL = "https://laserbunny-coder.github.io/inkwell/";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const COLS = "id,kind,parent_id,title,text,tags,fields,created_at";
const PER_RUN = 6;

type Sb = ReturnType<typeof admin>;

async function ask(system: string, text: string, schema: Record<string, unknown> = SCHEMA) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: text }],
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: server-side fallback parameter (beta)
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") throw new Error(`summary stopped: ${response.stop_reason}`);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no summary came back");
  return JSON.parse(block.text);
}

/** "World › Page" or "Daily page 2026-10-27" for each row, walking up through parents. */
async function placer(sb: Sb, userId: string, rows: Row[]) {
  const known = new Map(rows.map((r) => [r.id, r]));
  let need = [...new Set(rows.map((r) => r.parent_id).filter((x): x is string => !!x && !known.has(x)))];
  for (let i = 0; need.length && i < 40; i++) {
    const { data, error } = await sb.from("writing_entries").select(COLS).eq("user_id", userId).in("id", need.slice(0, 200));
    if (error) throw error;
    for (const r of data as Row[]) known.set(r.id, r);
    need = [...new Set((data as Row[]).map((r) => r.parent_id).filter((x): x is string => !!x && !known.has(x)))];
  }
  return (r: Row): string => {
    const parts: string[] = [];
    for (let x: Row | undefined = r, i = 0; x && i < 60; x = x.parent_id ? known.get(x.parent_id) : undefined, i++) {
      if (x.kind === "day") return [`Daily page ${x.id.slice(4)}`, ...parts].join(" › ");
      if (["world", "project", "page", "chapter"].includes(x.kind) && x !== r) parts.unshift(x.title || "Untitled");
    }
    return parts.join(" › ") || "Loose";
  };
}

async function save(sb: Sb, userId: string, row: Record<string, unknown>) {
  const { error } = await sb.from("writing_entries").upsert({ ...row, user_id: userId, sort: 0, content: null, tags: [], links: [], deleted: false, type: null, area_id: null });
  if (error) throw error;
}

async function forUser(sb: Sb, userId: string, tz: string, budget: { left: number }, force: boolean) {
  const today = localDate(Date.now(), tz);
  const due = periodsDue(today);
  const made: string[] = [];
  const { data: have, error } = await sb.from("writing_entries").select("id").eq("user_id", userId).eq("kind", "digest").eq("deleted", false);
  if (error) throw error;
  const exists = new Set((have ?? []).map((r) => r.id));

  let behind = false;
  for (const monday of due.weeks) {
    const id = `dg-week-${monday}`;
    if (exists.has(id) && !force) continue;
    if (budget.left <= 0) { behind = true; break; }
    const { data, error } = await sb.from("writing_entries").select(COLS).eq("user_id", userId).eq("deleted", false)
      .in("kind", ["line", "para", "page", "world", "project"])
      .gte("created_at", dayStart(monday, tz)).lt("created_at", dayStart(addDays(monday, 7), tz))
      .order("created_at").limit(5000);
    if (error) throw error;
    const rows = data as Row[];
    const where = await placer(sb, userId, rows);
    const p = weekPrompt(rows, where);
    if (!p.labels.length && !p.paragraphs) continue;
    budget.left--;
    const out = tidy(await ask(WEEK_SYSTEM, `${weekTitle(monday)}\n\n${p.text}`, WEEK_SCHEMA), p.labels, "L");
    if (!out.summary) continue;
    await save(sb, userId, {
      id, kind: "digest", parent_id: null, title: weekTitle(monday), text: out.summary,
      fields: { period: "week", from: monday, to: addDays(monday, 6), threads: out.threads, keywords: out.keywords, promises: out.promises, lines: p.lines, paragraphs: p.paragraphs, by: "claude", edited_by: "claude", model: MODEL },
    });
    exists.add(id);
    made.push(id);
  }

  // Months are written from their weeks, so only once the weeks are caught up.
  for (const month of behind ? [] : due.months) {
    const id = `dg-month-${month}`;
    if ((exists.has(id) && !force) || budget.left <= 0) continue;
    const { data, error } = await sb.from("writing_entries").select(COLS).eq("user_id", userId).eq("kind", "digest").eq("deleted", false)
      .like("id", `dg-week-${month}-%`).order("id");
    if (error) throw error;
    const weeks = data as Row[];
    if (!weeks.length) continue;
    const p = monthPrompt(weeks);
    budget.left--;
    const out = tidy(await ask(MONTH_SYSTEM, `${monthTitle(month)}\n\n${p.text}`), p.labels, "W");
    if (!out.summary) continue;
    await save(sb, userId, {
      id, kind: "digest", parent_id: null, title: monthTitle(month), text: out.summary,
      fields: { period: "month", from: `${month}-01`, to: monthEnd(month), threads: out.threads, keywords: out.keywords, weeks: weeks.map((w) => w.id), by: "claude", edited_by: "claude", model: MODEL },
    });
    exists.add(id);
    made.push(id);
  }
  // The latest month summed up: a note in Daybook (it can buzz the phone), in
  // waking hours during the week after it's written. Only the latest, so
  // catching up never sends a pile; once only (deduped on its link).
  const latest = due.months[due.months.length - 1];
  if (!behind && latest && awake(tz) && today < addDays(mondayOf(monthEnd(latest)), 14)) {
    const { data: m } = await sb.from("writing_entries").select("text,fields").eq("user_id", userId).eq("id", `dg-month-${latest}`).eq("deleted", false).maybeSingle();
    if (m?.text) await monthNote(sb, userId, latest, m.text, (m.fields?.threads ?? []) as { title: string }[]);
  }
  if (!behind) made.push(...await weekly(sb, userId, tz, today, budget, force));
  return made;
}

/** Waking hours where they are (8 am to 8 pm): notes that can buzz the phone wait for these. */
export function awake(tz: string, now = new Date()): boolean {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  return h >= 8 && h < 20;
}

/** The "Your month" note in Daybook, once per month (deduped on its link). */
async function monthNote(sb: Sb, userId: string, month: string, summary: string, threads: { title: string }[]) {
  const link = `${INKWELL}?summaries=${month}`;
  const { data: sent } = await sb.from("notes").select("id").eq("user_id", userId).eq("link", link).limit(1);
  if (sent?.length) return;
  const note = monthLetter(month, summary, threads);
  const { error } = await sb.from("notes").insert({ user_id: userId, author: "Inkwell", title: note.title, body: note.body, link });
  if (error) console.error("month note", userId, error);
}

/**
 * Once a week, on the first run on or after Monday: the tidy pass (Claude's
 * suggestions, waiting for a yes or no in Inkwell), then a note in Daybook with
 * last week's gist, the things they said they'd do (one tap from a task each),
 * and how many tidy-ups are waiting.
 */
async function weekly(sb: Sb, userId: string, tz: string, today: string, budget: { left: number }, force: boolean): Promise<string[]> {
  const monday = mondayOf(today);
  const made: string[] = [];
  const tidyId = `td-week-${monday}`;
  const { data: have } = await sb.from("writing_entries").select("id,fields").eq("user_id", userId).eq("id", tidyId).maybeSingle();
  let count = have ? ((have.fields?.tidy?.items ?? []) as { choice: string | null }[]).filter((i) => !i.choice).length : 0;
  if ((!have || force) && budget.left > 0) {
    // Only for someone who writes in Inkwell: a world or a daily page.
    const { count: n } = await sb.from("writing_entries").select("id", { count: "exact", head: true }).eq("user_id", userId).in("kind", ["world", "day"]).eq("deleted", false);
    if (n) {
      budget.left--;
      try {
        count = await makeTidy(sb, client, userId, tz, tidyId, monday);
        made.push(tidyId);
      } catch (e) {
        console.error("tidy", userId, e);
      }
    }
  }

  // The Monday note, once a week, from last week's summary. Only in waking
  // hours, since it can buzz the phone (the hourly run posts it from 8 am).
  if (!awake(tz)) return made;
  const link = `${INKWELL}?tidy=${monday}`;
  const { data: sent } = await sb.from("notes").select("id").eq("user_id", userId).eq("link", link).limit(1);
  if (sent?.length) return made;
  const { data: week } = await sb.from("writing_entries").select("id,title,text,fields").eq("user_id", userId).eq("id", `dg-week-${addDays(monday, -7)}`).eq("deleted", false).maybeSingle();
  if (!week && !count) return made;
  const ids = ((week?.fields?.promises ?? []) as { line: string }[]).map((p) => p.line);
  const { data: lines } = ids.length ? await sb.from("writing_entries").select("id,fields,created_at,deleted").eq("user_id", userId).in("id", ids) : { data: [] };
  const state = new Map((lines ?? []).map((l: { id: string; fields: Record<string, unknown>; created_at: string; deleted: boolean }) => [l.id, { done: !!l.fields?.done, daybook: l.fields?.daybook, created_at: l.created_at, deleted: l.deleted || !!l.fields?.trashed }]));
  const note = week
    ? mondayNote(week, state, count, INKWELL, tz)
    : { title: "Your tidy pass in Inkwell", body: `Claude has ${count === 1 ? "one tidy-up" : `${count} tidy-ups`} for Inkwell waiting for a yes or no. Open Inkwell to go through them.`, offers: [] };
  const { error } = await sb.from("notes").insert({ user_id: userId, author: "Inkwell", title: note.title, body: note.body, link, offers: note.offers });
  if (error) console.error("monday note", userId, error);
  else made.push(link);
  return made;
}

Deno.serve(async (req) => {
  const sb = admin();
  const { data: cfg } = await sb.from("push_config").select("cron_secret").eq("id", 1).single();
  if (!cfg || req.headers.get("x-cron-secret") !== cfg.cron_secret) return json({ error: "Not allowed" }, 401);
  const body = await req.json().catch(() => ({})) as { force?: boolean };
  const { data: users, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) return json({ error: error.message }, 500);
  const budget = { left: PER_RUN };
  const made: Record<string, string[]> = {};
  for (const u of users.users) {
    const tz = typeof u.user_metadata?.tz === "string" && u.user_metadata.tz ? u.user_metadata.tz : "America/Los_Angeles";
    try {
      const got = await forUser(sb, u.id, tz, budget, !!body.force);
      if (got.length) made[u.id] = got;
    } catch (e) {
      console.error("digest", u.id, e);
    }
    if (budget.left <= 0) break;
  }
  return json({ made });
});
