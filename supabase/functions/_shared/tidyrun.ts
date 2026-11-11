// Makes a batch of tidy suggestions for one person (see tidy.ts): reads how
// their Inkwell is kept, asks Claude, checks the answer and saves the batch as
// an entry of kind 'tidy'. Used by the weekly job (inkwell-digest, early on
// Monday) and when the person asks for one now (the inkwell function).
import type Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { checkTidy, type Input, type Item, type Row, TIDY_SCHEMA, TIDY_SYSTEM, tidyPrompt } from "./tidy.ts";

export const TIDY_MODEL = "claude-sonnet-5-5";
const SHAPE_COLS = "id,kind,parent_id,sort,title,fields,area_id,deleted,created_at,updated_at";
const COLS = "id,kind,parent_id,sort,title,text,tags,links,fields,area_id,deleted,created_at,updated_at";
const DAYS_BACK = 14;

const full = (r: Partial<Row>): Row => ({ text: "", tags: [], links: [], title: "", fields: {}, area_id: null, parent_id: null, ...r } as Row);

function localDate(iso: string | number | Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

async function all(sb: SupabaseClient, userId: string, cols: string, build: (q: any) => any): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(sb.from("writing_entries").select(cols).eq("user_id", userId)).order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as Row[]).map(full));
    if (data.length < 1000 || rows.length > 20000) return rows;
  }
}

/** Everything the tidy pass reads, for one person. */
export async function tidyInput(sb: SupabaseClient, userId: string, tz: string): Promise<Input> {
  const since = new Date(Date.now() - DAYS_BACK * 86_400_000).toISOString();
  const [outline, abouts, roll, tags, empty, recent, batches] = await Promise.all([
    all(sb, userId, SHAPE_COLS, (q) => q.in("kind", ["area", "world", "project", "page"]).eq("deleted", false)),
    all(sb, userId, "id,kind,parent_id,text,fields,deleted", (q) => q.eq("kind", "about").eq("deleted", false)),
    sb.rpc("inkwell_rollup", { p_user: userId }),
    sb.rpc("inkwell_tags", { p_user: userId, p_under: null }),
    sb.rpc("inkwell_empty", { p_user: userId }),
    sb.from("writing_entries").select(COLS).eq("user_id", userId).eq("kind", "line").eq("deleted", false)
      .gte("created_at", since).order("created_at", { ascending: false }).limit(1500),
    sb.from("writing_entries").select("id,fields,created_at").eq("user_id", userId).eq("kind", "tidy").eq("deleted", false)
      .order("created_at", { ascending: false }).limit(40),
  ]);
  for (const r of [roll, tags, empty, recent, batches]) if (r.error) throw r.error;

  // Which day each recent line is on (lines nest under lines).
  const lines = (recent.data as Row[]).map(full);
  const known = new Map(lines.map((r) => [r.id, r]));
  let need = [...new Set(lines.map((r) => r.parent_id).filter((x): x is string => !!x && !known.has(x) && !x.startsWith("day-")))];
  for (let i = 0; need.length && i < 20; i++) {
    const { data, error } = await sb.from("writing_entries").select("id,kind,parent_id").eq("user_id", userId).in("id", need.slice(0, 200));
    if (error) throw error;
    for (const r of data as Row[]) known.set(r.id, full(r));
    need = [...new Set((data as Row[]).map((r) => r.parent_id).filter((x): x is string => !!x && !known.has(x) && !x.startsWith("day-")))];
  }
  const dayOf = (r: Row): string | null => {
    for (let x: Row | undefined = r, i = 0; x && i < 40; i++) {
      if (x.parent_id?.startsWith("day-")) return x.parent_id.slice(4);
      x = x.parent_id ? known.get(x.parent_id) : undefined;
    }
    return null;
  };
  const dayLines = lines
    .filter((l) => !l.fields?.trashed && !l.fields?.mirror && !l.fields?.done && !l.fields?.daybook && !l.fields?.letgo && l.fields?.by !== "claude" && (l.text || "").trim())
    .map((l) => ({ ...l, day: dayOf(l) }))
    .filter((l): l is Row & { day: string } => !!l.day);

  const declined: Input["declined"] = [];
  const waiting: Input["waiting"] = [];
  const fresh = Date.now() - 56 * 86_400_000;
  for (const b of (batches.data ?? []) as { fields: { tidy?: { items?: (Item & { choice: string | null })[] } }; created_at: string }[]) {
    for (const it of b.fields?.tidy?.items ?? []) {
      if (it.choice === "no") declined.push({ key: it.key, title: it.title });
      else if (!it.choice && Date.parse(b.created_at) > fresh) waiting.push({ key: it.key, title: it.title });
      else if (it.choice) declined.push({ key: it.key, title: it.title }); // done already: nothing to suggest again
    }
  }
  const aboutMap = new Map<string, string>();
  for (const a of abouts) if (a.parent_id && !a.fields?.off && (a.text || "").trim()) aboutMap.set(a.parent_id, a.text.trim());
  return {
    outline,
    abouts: aboutMap,
    rollup: new Map(((roll.data ?? []) as { home: string; n: number; last: string }[]).map((r) => [r.home, { n: r.n, last: r.last }])),
    empty: new Set(((empty.data ?? []) as ({ id: string } | string)[]).map((r) => (typeof r === "string" ? r : r.id))),
    tags: ((tags.data ?? []) as { tag: string; n: number }[]).map((t) => ({ tag: t.tag, n: t.n })),
    dayLines,
    declined, waiting,
    today: localDate(Date.now(), tz),
  };
}

/** Asks Claude for suggestions. Returns the checked items (maybe none). */
export async function askTidy(client: Anthropic, input: Input): Promise<Item[]> {
  const labels = tidyPrompt(input);
  const response = await client.beta.messages.create({
    model: TIDY_MODEL,
    max_tokens: 8000,
    system: TIDY_SYSTEM,
    messages: [{ role: "user", content: labels.text }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: TIDY_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: server-side fallback parameter (beta)
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") throw new Error(`tidy stopped: ${response.stop_reason}`);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no tidy suggestions came back");
  return checkTidy(JSON.parse(block.text), labels, input);
}

/** Saves a batch (even an empty one, so the week isn't asked again). */
export async function saveTidy(sb: SupabaseClient, userId: string, id: string, items: Item[], week: string | null) {
  const { error } = await sb.from("writing_entries").upsert({
    id, user_id: userId, kind: "tidy", parent_id: null, sort: 0, title: week ? `Tidy pass, week of ${week}` : "Tidy pass", text: "",
    content: null, tags: [], links: [], deleted: false, type: null, area_id: null,
    fields: { by: "claude", edited_by: "claude", tidy: { at: new Date().toISOString(), week, items } },
  });
  if (error) throw error;
}

/** Makes one batch for a person and saves it. Returns how many suggestions. */
export async function makeTidy(sb: SupabaseClient, client: Anthropic, userId: string, tz: string, id: string, week: string | null): Promise<number> {
  const input = await tidyInput(sb, userId, tz);
  const items = await askTidy(client, input);
  await saveTidy(sb, userId, id, items, week);
  return items.length;
}
