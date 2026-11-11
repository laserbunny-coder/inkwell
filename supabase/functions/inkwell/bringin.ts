// Bring in old notes (Inkwell): a section copied out of Thymer, Tana, Workflowy
// or OneNote. Claude suggests where it goes (one of the person's worlds, life
// projects or bible pages, the idea drawer, or a loose page), a title, a
// one-line about, a few tags (their own tags first), and which old to-dos in it
// still look alive. Nothing is written here: Inkwell fills these in as
// suggestions and the person changes anything before it comes in.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { json } from "../_shared/common.ts";

const SYSTEM = `You help a writer and filmmaker move a few chosen notes from old apps (Thymer, Tana, Workflowy, OneNote) into Inkwell, their writing app. They pick what's worth keeping; you suggest where each piece goes and how to label it. Everything in Inkwell lives in a world (a story or show, with a bible of pages and pieces), a life project (a kitchen remodel, a business, health research: notes only), the Drawer (creative sparks with no home yet), or a loose page.

You get the note as an indented outline (each line has an id like [l3]), the app it came from, the homes they have, and the tags they already use.

- home: the id of the one home it most clearly belongs to. Prefer the most specific: a note about one character goes on that character's bible page if there is one. "drawer" if it's a creative idea or story spark with no world yet. "" (a loose page) if it's reference or life material that fits none of the homes. Never guess a home it only loosely relates to.
- title: a short, plain title in their words (keep theirs if it's already good). No dates unless the date is the point.
- about: one line, under 25 words, saying what this is and why it might matter, so it can be found later. Plain, no "This note...".
- tags: 1 to 4 tags without the # sign, lowercase, words joined with hyphens. Reuse their existing tags where they fit; add a new one only when nothing fits.
- todos: ids of lines that are to-dos or action items AND still look worth doing (not done, not obviously stale, not tied to a date long past). Leave out finished, vague or dead ones. None is fine.

Never invent facts. Plain text, no Markdown.`;

const s = { type: "string" };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["home", "title", "about", "tags", "todos"],
  properties: { home: s, title: s, about: s, tags: { type: "array", items: s }, todos: { type: "array", items: s } },
};

type Home = { id?: string; title?: string; kind?: string };
export type BringInBody = { app?: string; title?: string; text?: string; homes?: Home[]; tags?: string[] };

const str = (x: unknown, n: number) => (typeof x === "string" ? x.trim().slice(0, n) : "");
const list = <T>(x: unknown, n: number) => (Array.isArray(x) ? (x as T[]).slice(0, n) : []);
const tag = (t: unknown) => (typeof t === "string" ? t.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "") : "");

export function prompt(b: BringInBody) {
  const homes = list<Home>(b.homes, 400).filter((h) => str(h.id, 80));
  const parts: string[] = [];
  parts.push(`Came from: ${str(b.app, 40) || "another app"}`);
  if (b.title) parts.push(`Its title there: ${str(b.title, 200)}`);
  parts.push(`Homes:\n${homes.map((h) => `${str(h.id, 80)} (${h.kind === "life" ? "life project" : h.kind === "page" ? "bible page" : "world"}): ${str(h.title, 160)}`).join("\n") || "(none yet)"}`);
  const tags = list<string>(b.tags, 300).map(tag).filter(Boolean);
  parts.push(`Tags they use: ${tags.length ? tags.map((t) => `#${t}`).join(" ") : "(none yet)"}`);
  parts.push(`The note:\n${str(b.text, 14000)}`);
  return parts.join("\n\n");
}

// Claude's answer, checked: a real home, real line ids, tidy tags.
export function tidy(out: Record<string, unknown>, b: BringInBody) {
  const homes = new Set(list<Home>(b.homes, 400).map((h) => h.id));
  const ids = new Set([...(str(b.text, 14000).matchAll(/\[(l\d+)\]/g))].map((m) => m[1]));
  const home = typeof out.home === "string" && (homes.has(out.home) || out.home === "drawer") ? out.home : "";
  return {
    home,
    title: str(out.title, 160),
    about: str(out.about, 300).replace(/\s+/g, " "),
    tags: [...new Set(list<string>(out.tags, 6).map(tag).filter(Boolean))].slice(0, 4),
    todos: list<string>(out.todos, 60).filter((t) => ids.has(t)),
  };
}

export async function bringIn(client: Anthropic, body: BringInBody): Promise<Response> {
  if (!str(body?.text, 10)) return json({ error: "There's nothing to look at yet." }, 400);
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt(body) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") return json({ error: "Claude wouldn't help with this one." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Claude's answer was cut off. Try again." }, 502);
    const text = response.content.find((c) => c.type === "text");
    if (!text || text.type !== "text") return json({ error: "No answer came back. Try again." }, 502);
    return json(tidy(JSON.parse(text.text), body));
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
}
