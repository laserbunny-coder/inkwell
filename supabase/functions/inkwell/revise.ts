// Revising in Inkwell, with Claude only when asked:
// - notes: read a chapter (or a script) and give notes the way a good editor
//   would: short margin notes pinned to paragraphs, and a list of fixes the
//   writer can tick off;
// - talk: talk the draft over, a conversation about the chapter;
// - compare: two versions side by side (two drafts, or the text then and
//   now): say which works better where, and why.
// Nothing here writes anywhere: Inkwell shows what comes back, as notes in
// their own Claude category, a fix list page, or a reply.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { json } from "../_shared/common.ts";

const SYSTEM = `You are an experienced, candid editor helping a writer revise inside Inkwell, their writing app. They write novels, screenplays and short comedy pieces (gags, episodes). Their voice comes first: judge the writing by what it is trying to do, never push it toward a generic style, and never rewrite it for them unless asked. Be specific: point at the exact moment, say what's happening for a reader there, and why it matters. Kind but honest; no padding, no praise for its own sake. Plain text, no Markdown.

In a screenplay, paragraphs carry their element (scene heading, action, character, dialogue, parenthetical, transition); keep to screenplay craft when you comment (what's on screen, what's playable, economy of action lines).`;

const NOTES = `Give your notes on this text.
- notes: margin notes pinned to a paragraph (by its label, P1, P2…), one or two sentences each, about what a reader experiences at that moment and what could be stronger. Only where it matters; at most {N}. None on paragraphs that work.
- fixes: a short list of concrete things to do in the next pass, most important first, each one line, and the paragraph it's mostly about if there is one. At most 12.
- overall: two or three sentences on how the whole thing is working.`;

const COMPARE = `Two versions of the same writing follow, A and B, chapter by chapter (B may be a fresh draft rather than an edit of A). Say which works better and why, the way an editor comparing drafts would: what each does better, what B lost that A had, what to carry over. Each point names where it's about (a chapter or a moment) and which version is stronger there (a, b, or mixed). At most 10 points, most important first, then a short overall verdict.`;

const NOTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["notes", "fixes", "overall"],
  properties: {
    notes: { type: "array", items: { type: "object", additionalProperties: false, required: ["para", "text"], properties: { para: { type: "string" }, text: { type: "string" } } } },
    fixes: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "para"], properties: { text: { type: "string" }, para: { type: "string", description: "P label, or empty" } } } },
    overall: { type: "string" },
  },
};

const COMPARE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["points", "overall"],
  properties: {
    points: { type: "array", items: { type: "object", additionalProperties: false, required: ["where", "better", "why"], properties: { where: { type: "string" }, better: { type: "string", enum: ["a", "b", "mixed"] }, why: { type: "string" } } } },
    overall: { type: "string" },
  },
};

type Para = { id: string; text: string; el?: string };
type Side = { label?: string; chapters?: { title?: string; text?: string }[] };
type Msg = { who: "me" | "claude"; text: string };
export type ReviseBody = {
  task?: "notes" | "talk" | "compare";
  piece?: string;
  type?: string;
  chapter?: string;
  idea?: string;
  paras?: Para[];
  focus?: string;
  msgs?: Msg[];
  a?: Side;
  b?: Side;
};

const str = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");
const BUDGET = 300000;

// The text with each paragraph labelled P1, P2…, cut evenly if it's very long.
export function labelled(paras: Para[]) {
  const total = paras.reduce((n, p) => n + p.text.length, 0);
  const share = total > BUDGET ? BUDGET / total : 1;
  return paras.map((p, i) => {
    const t = p.text.length * share < p.text.length ? `${p.text.slice(0, Math.max(200, Math.floor(p.text.length * share)))} […]` : p.text;
    return `P${i + 1}${p.el ? ` (${p.el})` : ""}: ${t}`;
  }).join("\n");
}

function sideText(s: Side | undefined, budget: number) {
  const chapters = (s?.chapters ?? []).filter((c) => c && typeof c.text === "string").slice(0, 300);
  const total = chapters.reduce((n, c) => n + (c.text as string).length, 0);
  const share = total > budget ? budget / total : 1;
  return chapters.map((c) => {
    const t = c.text as string;
    const cut = Math.floor(t.length * share);
    return `## ${str(c.title, 200) || "Untitled"}\n${cut < t.length ? `${t.slice(0, Math.max(300, cut))} […]` : t}`;
  }).join("\n\n");
}

export function prompt(b: ReviseBody) {
  const head: string[] = [];
  if (b.piece) head.push(`The piece: ${str(b.piece, 200)}${b.type ? ` (${str(b.type, 40)})` : ""}`);
  if (b.idea) head.push(`The writer's notes on what this story is:\n${str(b.idea, 6000)}`);
  if (b.task === "compare") {
    head.push(`Version A (${str(b.a?.label, 80) || "earlier"}):\n\n${sideText(b.a, BUDGET / 2)}`);
    head.push(`Version B (${str(b.b?.label, 80) || "later"}):\n\n${sideText(b.b, BUDGET / 2)}`);
    head.push(COMPARE);
    return { text: head.join("\n\n"), paras: [] as Para[] };
  }
  const paras = (b.paras ?? []).filter((p) => p && typeof p.id === "string" && typeof p.text === "string" && p.text.trim()).slice(0, 4000);
  if (b.chapter) head.push(`Chapter: ${str(b.chapter, 200)}`);
  head.push(`The text, paragraph by paragraph:\n${labelled(paras)}`);
  if (b.task === "notes") {
    head.push(NOTES.replace("{N}", String(Math.max(4, Math.min(20, Math.round(paras.length / 6))))));
    if (b.focus) head.push(`The writer asks you to focus on: ${str(b.focus, 500)}`);
  }
  return { text: head.join("\n\n"), paras };
}

export function tidyNotes(out: { notes?: { para: string; text: string }[]; fixes?: { text: string; para: string }[]; overall?: string }, paras: Para[]) {
  const id = (label: string) => paras[Number(String(label).replace(/^P/i, "")) - 1]?.id ?? null;
  const notes = [];
  for (const n of out.notes ?? []) {
    const para = id(n.para);
    const text = str(n.text, 800).trim();
    if (para && text) notes.push({ para, text });
  }
  const fixes = [];
  for (const f of out.fixes ?? []) {
    const text = str(f.text, 400).trim();
    if (text) fixes.push({ text, para: f.para ? id(f.para) : null });
  }
  return { notes: notes.slice(0, 20), fixes: fixes.slice(0, 12), overall: str(out.overall, 1500).trim() };
}

export async function revise(client: Anthropic, body: ReviseBody): Promise<Response> {
  const task = body.task === "talk" ? "talk" : body.task === "compare" ? "compare" : "notes";
  const ctx = prompt({ ...body, task });
  if (task !== "compare" && !ctx.paras.length) return json({ error: "There's nothing here to read yet." }, 400);
  if (task === "compare" && !(body.a?.chapters?.length && body.b?.chapters?.length)) return json({ error: "Pick two versions to compare." }, 400);
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  if (task === "talk") {
    const msgs = (body.msgs ?? []).filter((m) => m && typeof m.text === "string" && m.text.trim()).slice(-30);
    if (!msgs.length || msgs[msgs.length - 1].who !== "me") return json({ error: "Say something first." }, 400);
    // The draft goes first, then the conversation so far.
    messages.push({ role: "user", content: `${ctx.text}\n\nI'd like to talk this over with you. Answer conversationally and briefly, like an editor across the table.` });
    messages.push({ role: "assistant", content: "I've read it. What's on your mind?" });
    for (const m of msgs) messages.push({ role: m.who === "me" ? "user" : "assistant", content: str(m.text, 8000) });
  } else messages.push({ role: "user", content: ctx.text });
  try {
    // Streamed: the SDK refuses a non-streamed request this large.
    const response = await client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      system: SYSTEM,
      messages,
      // A conversation answers in plain words; notes and comparisons come back as data.
      output_config: task === "talk" ? { effort: "low" } : { effort: "medium", format: { type: "json_schema", schema: task === "notes" ? NOTES_SCHEMA : COMPARE_SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    }).finalMessage();
    if (response.stop_reason === "refusal") return json({ error: "Claude wouldn't read this one." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Claude's answer was cut off. Try again." }, 502);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No answer came back. Try again." }, 502);
    if (task === "talk") return json({ reply: text.text.trim().slice(0, 8000) });
    const out = JSON.parse(text.text);
    if (task === "notes") return json(tidyNotes(out, ctx.paras));
    const points = (out.points ?? []).map((p: { where: string; better: string; why: string }) => ({
      where: str(p.where, 200), better: ["a", "b", "mixed"].includes(p.better) ? p.better : "mixed", why: str(p.why, 1200),
    })).filter((p: { why: string }) => p.why.trim()).slice(0, 10);
    return json({ points, overall: str(out.overall, 1500).trim() });
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The Claude API key isn't set up correctly." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
}
