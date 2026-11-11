// Inkwell (the writing app) asks Claude for alternates: other words that fit
// a sentence, or rewrites of a paragraph; and voice captures are written out
// and outlined here (capture.ts), shared links get a snapshot (snapshot.ts), a day's page gets a
// review (review.ts), the plot grid gets a thread filled in or its promises checked (grid.ts), a script gets its breakdown, shot lists, generation prompts and captions (production.ts), a Woven script gets its hidden scene headings filled in or a look for its genre (woven.ts), a draft gets editor's notes, a talk-through or two versions compared (revise.ts), tags get sorted into groups (tags.ts), old notes brought in from other apps get a home, title, about and tags suggested (bringin.ts), the workflow pages get homes for what came in, drawer picks, timeline events, ties, Develop steps and continuity checks (pages.ts), and recordings are written up in a mode, for the day
// page or straight into a draft (voice.ts), and meeting recordings become notes (meeting.ts), the Catch-up page gets its one-line read of the day (catchup.ts), a business meeting's tasks going to Acro HQ (acro.ts). It lives here because Inkwell syncs
// through this same Supabase project and uses the same Claude key.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, cors, json, userFrom } from "../_shared/common.ts";
import { capture } from "./capture.ts";
import { snapshot } from "./snapshot.ts";
import { sortTags } from "./tags.ts";
import { lookup } from "./enrich.ts";
import { review } from "./review.ts";
import { voice, voiceModes } from "./voice.ts";
import { grid } from "./grid.ts";
import { woven } from "./woven.ts";
import { production } from "./production.ts";
import { revise } from "./revise.ts";
import { pages } from "./pages.ts";
import { bringIn } from "./bringin.ts";
import { meetingNotes, writeOutMeeting } from "./meeting.ts";
import { sendToAcro } from "./acro.ts";
import { catchup } from "./catchup.ts";
import { talk } from "./talk.ts";
import { makeTidy } from "../_shared/tidyrun.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const SYSTEM = `You help a writer inside Inkwell, their writing app, find other ways to say something. They write novels and screenplays. You suggest; they choose. Their own voice comes first: match the tone, tense, point of view, register and rhythm of the text around the passage, and never make it fancier than the writing it sits in.

Word or phrase alternates:
- The passage is marked ⟦like this⟧ in its paragraph. Suggest replacements that fit this sentence and this story, not dictionary synonyms. A different word that makes the sentence work better is welcome, including another part of speech, as long as the sentence still reads correctly.
- Each suggestion says exactly which original text it replaces ("replace") and the new text ("with"). Usually "replace" is just the marked passage. When the new word needs a neighbouring word to change so the sentence stays right ("a" to "an", dropping an adverb the new verb already carries, a preposition the new verb needs), widen "replace" to take in those words, at most two words on either side of the marked passage, copied exactly as they appear in the paragraph, and give the whole new wording in "with".
- Never repeat the passage itself or any of the alternates the writer already has. No two suggestions the same.
- Order them best first.

Paragraph rewrites:
- Rewrite the whole paragraph, keeping what happens and what it means. Each rewrite should take a genuinely different approach (tighter, a different rhythm, a different image or emphasis), not a light reshuffle. Keep any names, facts and dialogue the story relies on. Plain text, no Markdown.

In a screenplay, the passage's element (action, dialogue, character, parenthetical, scene heading, transition) tells you its job; keep to screenplay style for that element.`;

const WORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["replace", "with"],
        properties: {
          replace: { type: "string", description: "The original text being replaced, copied exactly from the paragraph; contains the marked passage." },
          with: { type: "string", description: "The new text that takes its place." },
        },
      },
    },
  },
};

const PARAGRAPH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rewrites"],
  properties: { rewrites: { type: "array", items: { type: "string" } } },
};

type Body = {
  mode: "word" | "paragraph";
  paragraph: string;
  before?: string;
  after?: string;
  book?: string;
  chapter?: string;
  idea?: string;
  element?: string;
  existing?: string[];
  count?: number;
};

// Context is trimmed to a sensible size; the passage itself never is.
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(-n) : "");
const clipStart = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

function prompt(b: Body): string {
  const parts: string[] = [];
  if (b.book) parts.push(`Book: ${b.book}`);
  if (b.chapter) parts.push(`Chapter: ${b.chapter}`);
  if (b.idea) parts.push(`The writer's notes on what this story is:\n${clipStart(b.idea, 6000)}`);
  if (b.before) parts.push(`Text just before:\n${clip(b.before, 4000)}`);
  parts.push(`${b.mode === "word" ? "The paragraph, with the passage marked" : "The paragraph to rewrite"}:\n${b.paragraph}`);
  if (b.after) parts.push(`Text just after:\n${clipStart(b.after, 3000)}`);
  if (b.element) parts.push(`Screenplay element of this paragraph: ${b.element}`);
  const count = Math.max(1, Math.min(b.count ?? (b.mode === "word" ? 6 : 2), 10));
  if (b.mode === "word") {
    const have = (b.existing ?? []).filter((s) => typeof s === "string").slice(0, 30);
    if (have.length) parts.push(`Alternates the writer already has (don't repeat): ${have.map((s) => JSON.stringify(s)).join(", ")}`);
    parts.push(`Suggest ${count} alternates for the marked passage.`);
  } else {
    parts.push(`Write ${count} rewrites of the paragraph.`);
  }
  return parts.join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = await userFrom(req);
  if (!user) return json({ error: "Not signed in" }, 401);

  const body = await req.json().catch(() => null) as Body | null;
  if (body && (body as { mode: string }).mode === "capture") return capture(client, user.id, body as never);
  if (body && (body as { mode: string }).mode === "voice") {
    try { return await voice(client, user.id, body as never); } catch (err) { console.error(err); return json({ error: "Something went wrong writing that up. It'll try again." }, 500); }
  }
  if (body && /^voice-(modes|save-mode|delete-mode)$/.test((body as { mode: string }).mode)) {
    try { return await voiceModes(user.id, body as never); } catch (err) { console.error(err); return json({ error: "Couldn't reach your modes. Try again." }, 500); }
  }
  if (body && (body as { mode: string }).mode === "review") return review(client, body as never);
  if (body && (body as { mode: string }).mode === "catchup") return catchup(client, body as never);
  if (body && (body as { mode: string }).mode === "talk") return talk(client, body as never);
  // A tidy pass now (the weekly one is made early on Monday): suggestions saved
  // as a batch for the app to show; nothing in the notes changes here.
  if (body && (body as { mode: string }).mode === "tidy") {
    try {
      const tz = typeof user.user_metadata?.tz === "string" && user.user_metadata.tz ? user.user_metadata.tz : "America/Los_Angeles";
      const id = `td_${Date.now().toString(36).padStart(9, "0")}${crypto.randomUUID().slice(0, 8)}`;
      const count = await makeTidy(admin(), client, user.id, tz, id, null);
      return json({ id, count });
    } catch (err) {
      console.error(err);
      return json({ error: "Claude couldn't look things over just now. Try again in a minute." }, 500);
    }
  }
  if (body && (body as { mode: string }).mode === "grid") return grid(client, body as never);
  if (body && (body as { mode: string }).mode === "woven") return woven(client, body as never);
  if (body && (body as { mode: string }).mode === "production") return production(client, body as never);
  if (body && (body as { mode: string }).mode === "revise") return revise(client, body as never);
  if (body && (body as { mode: string }).mode === "tags") return sortTags(client, body as never);
  if (body && (body as { mode: string }).mode === "pages") return pages(client, body as never);
  if (body && (body as { mode: string }).mode === "bringin") return bringIn(client, body as never);
  if (body && (body as { mode: string }).mode === "meeting-writeout") return writeOutMeeting(user.id, body as never);
  if (body && (body as { mode: string }).mode === "meeting-notes") return meetingNotes(client, body as never);
  if (body && (body as { mode: string }).mode === "acro-send") return sendToAcro(body as never);
  if (body && (body as { mode: string }).mode === "snapshot") return snapshot(client, user.id, body as never);
  if (body && (body as { mode: string }).mode === "lookup") {
    const b = body as unknown as { text?: string; list?: string };
    if (typeof b.text !== "string" || !b.text.trim()) return json({ error: "Missing title" }, 400);
    try { return json(await lookup(client, b.text, String(b.list ?? ""))); } catch (err) { console.error(err); return json({ error: "Couldn't look that up. Try again." }, 502); }
  }

  if (!body || !["word", "paragraph"].includes(body.mode) || typeof body.paragraph !== "string" || !body.paragraph.trim()) {
    return json({ error: "Missing paragraph" }, 400);
  }
  if (body.paragraph.length > 12000) return json({ error: "That paragraph is too long to ask about." }, 413);
  if (body.mode === "word" && !/⟦[^⟧]+⟧/.test(body.paragraph)) return json({ error: "No passage marked" }, 400);

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt(body) }],
      // Low effort keeps word suggestions quick enough to wait for at the desk.
      output_config: {
        effort: body.mode === "word" ? "low" : "medium",
        format: { type: "json_schema", schema: body.mode === "word" ? WORD_SCHEMA : PARAGRAPH_SCHEMA },
      },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") return json({ error: "Claude wouldn't suggest anything for this one." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Claude's answer was cut off. Try again." }, 502);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No answer came back. Try again." }, 502);
    const out = JSON.parse(text.text);
    return json(body.mode === "word" ? { suggestions: out.suggestions ?? [] } : { rewrites: out.rewrites ?? [] });
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The Claude API key isn't set up correctly." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
});
