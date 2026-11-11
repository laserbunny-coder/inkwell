// The workflow pages in Inkwell (Gather, Shape, Revise, the Drawer), with
// Claude only when asked:
// - gather: for each thing that came in for a world, the bible page or piece
//   it most likely belongs on (or the drawer, or nowhere);
// - drawer: which ideas in the drawer could belong to this world;
// - timeline: events in the pieces, in story order, for the world's timeline;
// - ties: how the characters are tied to each other;
// - develop: one step of a piece's Develop page grown from the step before;
// - continuity: what in a piece clashes with canon (posted pieces, the bible).
// Nothing here writes anywhere: Inkwell shows what comes back as suggestions,
// and nothing moves or changes until the person taps.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { json } from "../_shared/common.ts";

const SYSTEM = `You help a writer and filmmaker in Inkwell, their writing app. Everything they make lives in a world: its bible (pages for characters, places, rules, running gags) and its pieces (gags, shorts, episodes, novels, films). Things come in from their day pages: ideas said out loud while driving, links, research, half-thoughts. They also keep an idea drawer for sparks with no home yet. Some worlds are life projects instead (a kitchen remodel, research for a relative's illness): no pieces, just notes pages.

Be useful and brief. Use their words and names. Never invent facts about their story that aren't in what you're given. Plain text, no Markdown.`;

const TASKS = {
  gather: `Things have come in for the world. For each item, pick the one place it most likely belongs: one of the homes listed (a bible page or a piece, by its id), "drawer" if it's a creative spark that doesn't belong in this world after all, or "" if you can't tell. Give a short reason (under 15 words) in why. Prefer the most specific page: a line about a character goes on that character's page, not a general one.`,
  drawer: `Here is their idea drawer. Pick the ideas that could feed this world: fit its tone, characters, premise or pieces. Leave out ideas that are only loosely related. For each, a short reason (under 20 words). None is fine.`,
  timeline: `Read the pieces and list the events that matter to the world's timeline: things that happen in story time (births, meetings, fights, discoveries, deaths, moves), in story order, not the order they're told in. Each: what happens in one line, when in story time if the text says or clearly implies it (else ""), the id of the piece it's in, and after: the id of the existing event it comes right after ("" for the start or if unsure). Leave out events already on the timeline. At most 20.`,
  ties: `From the character pages and the pieces, say how the characters are tied to each other: family, love, rivalry, debts, secrets, mentor and student. Each tie: the two character ids (a, b), a label in a few words as they'd say it ("brothers", "owes him his life"), and why: where that comes from, in under 15 words. Only ties the material supports. Leave out ties that are already there. At most 20.`,
  develop: `They're developing a piece, small to big: one sentence, one paragraph, the people (what each wants, what stops them, what they learn), one page. Write the step asked for, growing it from the steps before and the idea page and draft if there are any. Keep their premise, tone and names. For "sentence": one sentence. For "paragraph": about five sentences: set-up, three turns, the ending. For "page": about 350 words. For "people": the main characters, each with name, wants, against (what stops them) and learns. Put the text in text (empty for people) and the characters in people (empty otherwise).`,
  continuity: `Posted pieces are canon, with the bible. Read the new piece and list where it clashes with canon: a name, age, look, place, rule, relationship or event that contradicts what's established, or something a character couldn't know yet. Each: where in the new piece (a short quote or scene), the issue in one sentence, and the canon it clashes with (which piece or bible page says otherwise, briefly). Only real clashes, not style notes. None is fine. At most 15.`,
} as const;
type Task = keyof typeof TASKS;

const obj = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const s = { type: "string" };
const arr = (items: unknown) => ({ type: "array", items });
const SCHEMAS: Record<Task, unknown> = {
  gather: obj({ picks: arr(obj({ id: s, home: s, why: s })) }),
  drawer: obj({ fits: arr(obj({ id: s, why: s })) }),
  timeline: obj({ events: arr(obj({ what: s, when: s, piece: s, after: s })) }),
  ties: obj({ ties: arr(obj({ a: s, b: s, label: s, why: s })) }),
  develop: obj({ text: s, people: arr(obj({ name: s, wants: s, against: s, learns: s })) }),
  continuity: obj({ issues: arr(obj({ where: s, issue: s, canon: s })) }),
};

type Item = { id?: string; text?: string };
type Named = { id?: string; title?: string; kind?: string; text?: string; stage?: string; name?: string; about?: string };
export type PagesBody = {
  task?: string;
  world?: string;
  about?: string;
  life?: boolean;
  homes?: Named[];
  items?: Item[];
  pieces?: (Named | string)[];
  events?: { id?: string; what?: string; when?: string }[];
  characters?: Named[];
  ties?: { a?: string; b?: string; label?: string }[];
  step?: string;
  piece?: string | Named;
  kind?: string;
  develop?: Record<string, unknown>;
  idea?: string;
  draft?: string;
  bible?: Named[];
  canon?: Named[];
};

const str = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/\s+\n/g, "\n").trim().slice(0, n) : "");
const list = <T>(x: unknown, n: number) => (Array.isArray(x) ? (x as T[]).slice(0, n) : []);

// What Claude reads for each task, with every list and text kept to a size.
export function prompt(task: Task, b: PagesBody) {
  const parts: string[] = [`World: ${str(b.world, 200) || "(untitled)"}${b.life ? " (a life project)" : ""}`];
  if (b.about) parts.push(`About it: ${str(b.about, 600)}`);
  if (task === "gather") {
    parts.push(`Homes:\n${list<Named>(b.homes, 300).map((h) => `${str(h.id, 60)} (${h.kind === "piece" ? "piece" : "page"}): ${str(h.title, 120)}`).join("\n") || "(none)"}`);
    parts.push(`Items:\n${list<Item>(b.items, 200).map((i) => `${str(i.id, 60)}: ${str(i.text, 600)}`).join("\n")}`);
  }
  if (task === "drawer") {
    const pieces = list<string>(b.pieces, 40).map((p) => str(p, 120)).filter(Boolean);
    if (pieces.length) parts.push(`Its pieces: ${pieces.join(", ")}`);
    parts.push(`The drawer:\n${list<Item>(b.items, 200).map((i) => `${str(i.id, 60)}: ${str(i.text, 300)}`).join("\n")}`);
  }
  if (task === "timeline") {
    parts.push(`On the timeline already:\n${list<{ id?: string; what?: string; when?: string }>(b.events, 200).map((e) => `${str(e.id, 60)}: ${str(e.what, 200)}${e.when ? ` (${str(e.when, 60)})` : ""}`).join("\n") || "(nothing yet)"}`);
    for (const p of list<Named>(b.pieces, 12)) parts.push(`Piece ${str(p.id, 60)}: ${str(p.title, 120)} (${str(p.stage, 20)})\n${str(p.text, 6000)}`);
  }
  if (task === "ties") {
    parts.push(`Characters:\n${list<Named>(b.characters, 40).map((c) => `${str(c.id, 60)}: ${str(c.name, 80)}${c.about ? `\n${str(c.about, 800)}` : ""}`).join("\n\n")}`);
    parts.push(`Ties already:\n${list<{ a?: string; b?: string; label?: string }>(b.ties, 100).map((t) => `${str(t.a, 60)} and ${str(t.b, 60)}: ${str(t.label, 80)}`).join("\n") || "(none)"}`);
    for (const p of list<Named>(b.pieces, 8)) parts.push(`Piece: ${str(p.title, 120)}\n${str(p.text, 4000)}`);
  }
  if (task === "develop") {
    parts.push(`Piece: ${str(typeof b.piece === "string" ? b.piece : b.piece?.title, 200)} (${str(b.kind, 40)})`);
    const d = (b.develop ?? {}) as Record<string, unknown>;
    for (const k of ["sentence", "paragraph", "page"]) if (str(d[k], 4000)) parts.push(`Their ${k}:\n${str(d[k], 4000)}`);
    const people = list<Record<string, string>>(d.people, 20).filter((p) => p?.name);
    if (people.length) parts.push(`Their people:\n${people.map((p) => `${str(p.name, 60)}: wants ${str(p.wants, 200)}; against ${str(p.against, 200)}; learns ${str(p.learns, 200)}`).join("\n")}`);
    if (b.idea) parts.push(`Idea page:\n${str(b.idea, 3000)}`);
    if (b.draft) parts.push(`The draft so far:\n${str(b.draft, 6000)}`);
    parts.push(`Write the step: ${str(b.step, 20)}`);
  }
  if (task === "continuity") {
    for (const p of list<Named>(b.bible, 60)) parts.push(`Bible page: ${str(p.title, 120)}\n${str(p.text, 800)}`);
    for (const p of list<Named>(b.canon, 10)) parts.push(`Canon (posted): ${str(p.title, 120)}\n${str(p.text, 5000)}`);
    const piece = (typeof b.piece === "object" ? b.piece : {}) as Named;
    parts.push(`The new piece: ${str(piece.title, 120)}\n${str(piece.text, 16000)}`);
  }
  return parts.join("\n\n");
}

// Claude's answer, checked against what was sent: only real ids come back.
export function tidy(task: Task, out: Record<string, unknown>, b: PagesBody) {
  if (task === "gather") {
    const homes = new Set(list<Named>(b.homes, 300).map((h) => h.id));
    const items = new Set(list<Item>(b.items, 200).map((i) => i.id));
    return { picks: list<{ id: string; home: string; why: string }>(out.picks, 200).filter((p) => items.has(p.id)).map((p) => ({ id: p.id, home: homes.has(p.home) || p.home === "drawer" ? p.home : "", why: str(p.why, 200) })) };
  }
  if (task === "drawer") {
    const items = new Set(list<Item>(b.items, 200).map((i) => i.id));
    return { fits: list<{ id: string; why: string }>(out.fits, 200).filter((f) => items.has(f.id)).map((f) => ({ id: f.id, why: str(f.why, 200) })) };
  }
  if (task === "timeline") {
    const pieces = new Set(list<Named>(b.pieces, 12).map((p) => p.id));
    const events = new Set(list<{ id?: string }>(b.events, 200).map((e) => e.id));
    return { events: list<Record<string, string>>(out.events, 20).filter((e) => str(e.what, 300)).map((e) => ({ what: str(e.what, 300), when: str(e.when, 80), piece: pieces.has(e.piece) ? e.piece : "", after: events.has(e.after) ? e.after : "" })) };
  }
  if (task === "ties") {
    const ids = new Set(list<Named>(b.characters, 40).map((c) => c.id));
    return { ties: list<Record<string, string>>(out.ties, 20).filter((t) => ids.has(t.a) && ids.has(t.b) && t.a !== t.b && str(t.label, 80)).map((t) => ({ a: t.a, b: t.b, label: str(t.label, 80), why: str(t.why, 200) })) };
  }
  if (task === "develop") {
    return { text: str(out.text, 6000), people: list<Record<string, string>>(out.people, 20).filter((p) => str(p.name, 80)).map((p) => ({ name: str(p.name, 80), wants: str(p.wants, 300), against: str(p.against, 300), learns: str(p.learns, 300) })) };
  }
  return { issues: list<Record<string, string>>(out.issues, 15).filter((i) => str(i.issue, 400)).map((i) => ({ where: str(i.where, 200), issue: str(i.issue, 400), canon: str(i.canon, 300) })) };
}

export async function pages(client: Anthropic, body: PagesBody): Promise<Response> {
  const task = (Object.keys(TASKS) as Task[]).find((t) => t === body.task);
  if (!task) return json({ error: "Unknown task." }, 400);
  if ((task === "gather" || task === "drawer") && !list(body.items, 1).length) return json({ error: "There's nothing to look at yet." }, 400);
  if (task === "ties" && list(body.characters, 2).length < 2) return json({ error: "Relationships need at least two characters." }, 400);
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: `${TASKS[task]}\n\n${prompt(task, body)}` }],
      output_config: { effort: task === "gather" || task === "drawer" ? "low" : "medium", format: { type: "json_schema", schema: SCHEMAS[task] } },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") return json({ error: "Claude wouldn't help with this one." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Claude's answer was cut off. Try again." }, 502);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No answer came back. Try again." }, 502);
    return json(tidy(task, JSON.parse(text.text), body));
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
}
