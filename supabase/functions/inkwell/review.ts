// The day review: Claude reads a day's page in Inkwell (captures, journaling,
// notes, ideas), writes a few sentences on what the day was like, and sorts
// what's on it into threads, each with a suggestion: make it a task in
// Daybook, keep thinking about it, split it into parts, or let it go, plus a
// world or page to link it to and tags that fit. The
// writer decides each one in Inkwell; nothing here sends anything anywhere.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { json } from "../_shared/common.ts";

const SYSTEM = `You help a writer and filmmaker look back over one day's page in Inkwell, their notes app. The page holds whatever they put there that day: things said out loud while driving or walking (written out word for word), journaling, ideas for stories, films and shows, links they saved, reminders, half-thoughts. Each line has a label like L3; indented lines sit under the line above them.

Write two things.

1. summary: what the day was like and what was on their mind, in the second person ("You spent the morning..."), in plain words. Its length follows the day: a light page gets a few sentences; a full page with many entries can take up to three or four short paragraphs (separated by a blank line), giving the context they need to make the choices below. Never pad it. Warm but not gushing, no advice, no judging, nothing they didn't say.

2. threads: the things on the page someone might want to act on or come back to, each a short title and a one-sentence gist, with the labels of the lines it comes from. One thread can draw on several lines; a line can belong to only one thread. Leave out lines that are just a passing remark, a feeling already said in the summary, or something already done, unless there's something in it to keep. A day with nothing to act on has no threads. For each thread, suggest one of:
   - daybook: a concrete thing to do. Give the task a short title that starts with a verb, as they'd write it on their own list, and pick the area it belongs in from their areas (use its id), or "" if none clearly fits.
   - mull: an idea or question worth more thought but not a task yet.
   - drawer: a creative spark with no home yet (a story or film idea, a gag, a bit, a title) that doesn't belong to anything they're working on: it goes in their idea drawer to be found later.
   - split: a ramble that holds several separate things. Give the parts, each with its own title, gist, lines (from this thread's lines), suggestion (daybook, mull, drawer or let_go) and task.
   - let_go: worth noting, nothing to do.
   Give a task for every thread and part (for mull, drawer and let_go, the task they'd write if they changed their mind). Parts are only for split; leave them empty otherwise.

3. still: they may have things they were already mulling over from earlier days, labelled M1, M2. Bring back at most three: ones today's page touches on first, then ones that have sat longest. For each, a short note on why it's coming up now ("You talked about the sequel again today", "It's been two weeks"). None if there are none.

4. For every thread and part, also:
   - link: the label (like P3) of the one world, piece or page in their Library it's clearly about, from the list of their worlds and pages, when its lines don't already link there ([[Name]] in a line is a link). A line about a character, place or running gag links to that page rather than the whole world. "" when nothing clearly fits or you're unsure; a wrong link is worse than none.
   - tags: up to three tags that would help them find it later, chosen from the tags they already use (written without #). Only suggest a new tag when none of theirs fits and it would clearly help. Leave out tags already on those lines. None is fine.

Use their words and names. Never invent tasks, details or ideas they didn't have.`;

const TASK = {
  type: "object",
  additionalProperties: false,
  required: ["title", "area_id"],
  properties: { title: { type: "string" }, area_id: { type: "string" } },
};

const PART = {
  type: "object",
  additionalProperties: false,
  required: ["title", "gist", "lines", "suggest", "task", "link", "tags"],
  properties: {
    title: { type: "string" },
    gist: { type: "string" },
    lines: { type: "array", items: { type: "string" } },
    suggest: { type: "string", enum: ["daybook", "mull", "drawer", "let_go"] },
    task: TASK,
    link: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "threads", "still"],
  properties: {
    summary: { type: "string" },
    threads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "gist", "lines", "suggest", "task", "parts", "link", "tags"],
        properties: {
          title: { type: "string" },
          gist: { type: "string" },
          lines: { type: "array", items: { type: "string" } },
          suggest: { type: "string", enum: ["daybook", "mull", "drawer", "split", "let_go"] },
          task: TASK,
          parts: { type: "array", items: PART },
          link: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
    still: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["mulling", "note"],
        properties: { mulling: { type: "string" }, note: { type: "string" } },
      },
    },
  },
};

type Line = { id: string; text: string; depth?: number };
type Mulling = { id: string; text: string; since?: string };
type Area = { id: string; title: string };
// Somewhere a line can link to: a world, piece or page ("in" names its world).
type Place = { id: string; title: string; kind?: string; in?: string };
export type ReviewBody = { day?: string; title?: string; lines?: Line[]; mulling?: Mulling[]; areas?: Area[]; places?: Place[]; tags?: string[] };

type Task = { title: string; area_id: string };
type Part = { title: string; gist: string; lines: string[]; suggest: string; task: Task; link?: string; tags?: string[] };
type Thread = Part & { parts: Part[] };

const str = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");
export const cleanTag = (t: unknown) => String(t ?? "").trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 40);

// Lines and mulled items go to Claude with short labels (L1, M1) and come back
// as their real ids; labels that don't match are dropped.
export function prompt(b: ReviewBody) {
  const lines = (b.lines ?? []).filter((l) => l && typeof l.id === "string" && typeof l.text === "string" && l.text.trim()).slice(0, 400);
  const mulling = (b.mulling ?? []).filter((m) => m && typeof m.id === "string" && typeof m.text === "string").slice(0, 60);
  const areas = (b.areas ?? []).filter((a) => a && typeof a.id === "string" && typeof a.title === "string").slice(0, 40);
  const places = (b.places ?? []).filter((p) => p && typeof p.id === "string" && typeof p.title === "string" && p.title.trim()).slice(0, 300);
  const tags = [...new Set((b.tags ?? []).map(cleanTag).filter(Boolean))].slice(0, 120);
  const parts: string[] = [];
  parts.push(`The day: ${str(b.title, 80) || str(b.day, 20)}`);
  parts.push(`Their areas in Daybook:\n${areas.map((a) => `${a.id}: ${a.title}`).join("\n") || "(none)"}`);
  parts.push(`Their worlds and pages in Inkwell (for links):\n${places.map((p, i) => `P${i + 1}: ${str(p.title, 120)}${p.kind ? ` (${str(p.kind, 20)}${p.in ? ` in ${str(p.in, 80)}` : ""})` : ""}`).join("\n") || "(none)"}`);
  parts.push(`Tags they use: ${tags.map((t) => `#${t}`).join(" ") || "(none)"}`);
  let budget = 60000;
  const shown: string[] = [];
  lines.forEach((l, i) => {
    const t = str(l.text, 6000).replace(/\s+/g, " ");
    if (budget <= 0) return;
    budget -= t.length;
    shown.push(`${"  ".repeat(Math.max(0, Math.min(Number(l.depth) || 0, 6)))}L${i + 1}: ${t}`);
  });
  parts.push(`The page:\n${shown.join("\n")}`);
  if (mulling.length) parts.push(`Already mulling over:\n${mulling.map((m, i) => `M${i + 1}${m.since ? ` (since ${str(m.since, 20)})` : ""}: ${str(m.text, 500)}`).join("\n")}`);
  return { text: parts.join("\n\n"), lines, mulling, areas, places };
}

export function tidy(out: { summary?: string; threads?: Thread[]; still?: { mulling: string; note: string }[] }, ctx: ReturnType<typeof prompt>) {
  const lineId = (label: string) => ctx.lines[Number(String(label).replace(/^L/i, "")) - 1]?.id;
  const areaIds = new Set(ctx.areas.map((a) => a.id));
  const taken = new Set<string>();
  const ids = (labels: unknown) => {
    const out: string[] = [];
    for (const l of Array.isArray(labels) ? labels : []) {
      const id = lineId(l);
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  };
  const task = (t: Task | undefined, title: string) => ({
    title: str(t?.title, 200).trim() || title,
    area_id: t?.area_id && areaIds.has(t.area_id) ? t.area_id : null,
  });
  // A suggested link comes back as a place label (P3); tags come back cleaned, at most three.
  const link = (label: unknown) => {
    const p = ctx.places[Number(String(label ?? "").trim().replace(/^P/i, "")) - 1];
    return p && /^P?\d+$/i.test(String(label).trim()) ? { id: p.id, title: str(p.title, 120).trim() } : null;
  };
  const tagsOf = (list: unknown) => [...new Set((Array.isArray(list) ? list : []).map(cleanTag).filter(Boolean))].slice(0, 3);
  const part = (p: Part, allowed: string[] | null) => {
    const lines = ids(p.lines).filter((id) => !allowed || allowed.includes(id));
    const title = str(p.title, 200).trim();
    return { title, gist: str(p.gist, 600).trim(), lines, suggest: ["daybook", "mull", "drawer", "let_go"].includes(p.suggest) ? p.suggest : "mull", task: task(p.task, title), link: link(p.link), tags: tagsOf(p.tags) };
  };
  const threads = [];
  for (const t of out.threads ?? []) {
    const lines = ids(t.lines).filter((id) => !taken.has(id));
    const title = str(t.title, 200).trim();
    if (!title) continue;
    lines.forEach((id) => taken.add(id));
    const parts = t.suggest === "split" ? (t.parts ?? []).map((p) => part(p, lines.length ? lines : null)).filter((p) => p.title) : [];
    const suggest = t.suggest === "split" && parts.length < 2 ? "mull" : (["daybook", "mull", "drawer", "split", "let_go"].includes(t.suggest) ? t.suggest : "mull");
    threads.push({ title, gist: str(t.gist, 600).trim(), lines, suggest, task: task(t.task, title), parts: suggest === "split" ? parts : [], link: link(t.link), tags: tagsOf(t.tags) });
  }
  const still: { id: string; note: string }[] = [];
  for (const s of out.still ?? []) {
    const m = ctx.mulling[Number(String(s.mulling).replace(/^M/i, "")) - 1];
    if (m && !still.some((x) => x.id === m.id)) still.push({ id: m.id, note: str(s.note, 300).trim() });
  }
  return { summary: str(out.summary, 6000).trim(), threads: threads.slice(0, 20), still: still.slice(0, 3) };
}

export async function review(client: Anthropic, body: ReviewBody): Promise<Response> {
  const ctx = prompt(body);
  if (!ctx.lines.length) return json({ error: "There's nothing on this day to look back over yet." }, 400);
  try {
    // Streamed: the SDK refuses a non-streamed request this large (it could
    // run past its 10-minute limit), and a long review needs the room.
    const response = await client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      system: SYSTEM,
      messages: [{ role: "user", content: ctx.text }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    }).finalMessage();
    if (response.stop_reason === "refusal") return json({ error: "Claude wouldn't review this day." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Claude's review was cut off. Try again." }, 502);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No review came back. Try again." }, 502);
    return json(tidy(JSON.parse(text.text), ctx));
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The Claude API key isn't set up correctly." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
}
