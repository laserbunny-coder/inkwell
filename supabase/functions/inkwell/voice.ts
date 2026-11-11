// Walk-and-talk: a recording becomes writing in one of the person's modes
// (the same modes as Scribe, so one made in either app shows in both). The
// recording is written out word for word, Claude picks the mode that fits
// (unless one was asked for), then writes it in that mode: spoken edits
// applied ("scratch that", a retake), asides said as notes to self set apart,
// "new paragraph" and "next scene" obeyed. The word-for-word text always comes
// back too, so nothing said is lost.
//
//   { mode: "voice", file | transcript, duration, use?: mode id, place: "day" | "draft", script?, before?, book?, tags? }
//     -> { raw, mode, blocks: [{ text, el, new_scene, said? }], notes: [{ text, after }], tag?, refs? }
//   { mode: "voice-modes" } -> { modes }
//   { mode: "voice-save-mode", item: { id?, name, prompt, model? } } -> { mode }
//   { mode: "voice-delete-mode", id } -> { ok }
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, json } from "../_shared/common.ts";
import { HINT } from "./capture.ts";
import { type Heard, hear } from "./speech.ts";
import { refsIn, tagFor } from "./enrich.ts";
import { deleteMode, type Mode, type Model, MODEL_IDS, modelOf, modesOf, saveMode } from "../scribe/modes.ts";

const ELEMENTS = ["paragraph", "scene", "action", "character", "paren", "dialogue", "transition"];

const SYSTEM = `You turn a recording into the writing its speaker meant, in the mode they're using. They're a writer and filmmaker who talks out loud while walking, driving or thinking: journaling, working through ideas, drafting scenes, or saying a message to send. The recording was written out word for word, so it rambles, repeats itself, corrects itself and has asides.

- Use only what they said. Never add ideas, facts, names, events, images or dialogue of your own, and never answer or judge what they said. Keep their words and their voice as far as the mode allows.
- Spoken edits: they edit out loud, and you carry the edits out and leave the instruction itself out. "Scratch that", "delete that", "cut the last sentence", "strike that" remove what they point at. "Go back", "let me start again", "start over", "take two", "let me try that again" mean the new attempt replaces the earlier one. "No, I mean…", "actually make it…" correct what came before. A false start, a stumble, or a line said twice in a row: keep only the last take.
- Notes to self: anything they flag as a note to self ("note to self", "remind me to", "I need to check", "for later", "make a note") or clearly say about the writing rather than as part of it ("that line's weak, fix it later") goes in notes, not in the text. Each note is in their words, tidied; "after" is the index of the block it was said during or right after (-1 if before the first block).
- Spoken layout: "new paragraph" starts a new block; "next scene" or "new scene" starts a new scene, so the first block of that scene has new_scene true. Leave those words out.
- blocks are the finished text, one block per paragraph. Plain text, no Markdown, no headings unless they dictated one.
- el is "paragraph" for every block, unless they're writing a screenplay (you'll be told): then each block is one screenplay element, "scene" (a scene heading like INT. KITCHEN - NIGHT, only if they said where and when), "action", "character" (the name, in capitals), "paren" (a parenthetical, in brackets), "dialogue" or "transition".`;

export const TITLE_MAX = 60;
const TITLE = `- title: a short title for the entry, ${TITLE_MAX} characters at most, in their own words where you can: what it's about, the way they'd name it. No quotes, no full stop at the end, no date.`;

const SAID = `- said: for each block, the stretch of the word-for-word text it came from, copied exactly as written there, so they can flip back to what they really said. Every part of the word-for-word text belongs to one block's said, in order, except what was a note to self.`;

const PICK_SYSTEM = `You pick which of someone's writing modes fits a recording they just made. Each mode is a way their words get written up. Answer with the id of the one mode that fits what they were doing: journaling or thinking out loud, an idea for a story or project, drafting a scene, a message or email to someone, and so on. If they say which mode they want ("this is a journal entry", "email to Nate"), use it. When nothing fits better, use the first mode.`;

const block = (said: boolean) => ({
  type: "object",
  additionalProperties: false,
  required: said ? ["text", "el", "new_scene", "said"] : ["text", "el", "new_scene"],
  properties: {
    text: { type: "string" },
    el: { type: "string", enum: ELEMENTS },
    new_scene: { type: "boolean" },
    ...(said ? { said: { type: "string" } } : {}),
  },
});

const schema = (said: boolean, titled = false) => ({
  type: "object",
  additionalProperties: false,
  required: titled ? ["title", "blocks", "notes"] : ["blocks", "notes"],
  properties: {
    ...(titled ? { title: { type: "string" } } : {}),
    blocks: { type: "array", items: block(said) },
    notes: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["text", "after"], properties: { text: { type: "string" }, after: { type: "integer" } } },
    },
  },
});

type Block = { text: string; el: string; new_scene: boolean; said?: string };
type Note = { text: string; after: number };
type VoiceBody = { file?: string; transcript?: string; duration?: number; use?: string; place?: string; script?: boolean; before?: string; book?: string; tags?: string[]; terms?: string[] };

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(-n) : "");

export async function pick(client: Anthropic, raw: string, modes: Mode[], place: string): Promise<Mode> {
  if (modes.length === 1) return modes[0];
  const list = modes.map((m) => `- ${m.id}: ${m.name}. ${m.prompt}`).join("\n");
  const where = place === "draft" ? "They recorded it while writing a story, aiming it at the scene they're on." : "They recorded it onto their day page.";
  const response = await client.beta.messages.create({
    model: MODEL_IDS.haiku,
    max_tokens: 200,
    system: PICK_SYSTEM,
    messages: [{ role: "user", content: `Their modes:\n${list}\n\n${where}\n\nWhat they said (the start of it):\n${raw.slice(0, 6000)}` }],
    output_config: {
      format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["mode"], properties: { mode: { type: "string", enum: modes.map((m) => m.id) } } } },
    },
  }).catch((err) => { console.error(err); return null; });
  const text = response?.content.find((b) => b.type === "text");
  const id = text && text.type === "text" ? JSON.parse(text.text).mode : null;
  return modes.find((m) => m.id === id) ?? modes[0];
}

// A capture on a day or notes page gets a short title too (`titled`); a draft doesn't.
export async function write(client: Anthropic, raw: string, mode: Mode, b: VoiceBody, said: boolean, model: Model = modelOf(mode.model) ?? "opus", titled = !said): Promise<{ blocks: Block[]; notes: Note[]; title?: string }> {
  const parts = [`Mode: ${mode.name}. ${mode.prompt}`];
  if (b.script) parts.push("They're writing a screenplay: use screenplay elements.");
  if (b.book) parts.push(`What they're writing: ${String(b.book).slice(0, 200)}`);
  if (b.before) parts.push(`The text just before where this goes (match its voice and tense; don't repeat it):\n${clip(b.before, 3000)}`);
  parts.push(`What they said, word for word:\n${raw.slice(0, 80000)}`);
  // Long recordings make long answers; past 16000 tokens the SDK needs a stream.
  const stream = client.beta.messages.stream({
    model: MODEL_IDS[model],
    max_tokens: 32000,
    system: [SYSTEM, ...(said ? [SAID] : []), ...(titled ? [TITLE] : [])].join("\n"),
    messages: [{ role: "user", content: parts.join("\n\n") }],
    output_config: { effort: "low", format: { type: "json_schema", schema: schema(said, titled) } },
    ...(model === "opus" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
  } as never);
  const response = await stream.finalMessage();
  // A smaller model that declines hands it to Opus, which can fall back on its own.
  if (response.stop_reason === "refusal" && model !== "opus") return write(client, raw, mode, b, said, "opus", titled);
  if (response.stop_reason !== "end_turn") throw new Error(`Claude stopped early (${response.stop_reason}).`);
  const text = response.content.find((x) => x.type === "text");
  if (!text || text.type !== "text") throw new Error("No answer came back.");
  const out = JSON.parse(text.text);
  const title = titled ? shortTitle(out.title) : "";
  return { ...tidy(out, said), ...(title ? { title } : {}) };
}

// One line, no closing full stop, cut at a word if it runs past TITLE_MAX.
export function shortTitle(t: unknown, max = TITLE_MAX): string {
  let s = typeof t === "string" ? t.replace(/\s+/g, " ").trim().replace(/^["'“‘]+|["'”’]+$/g, "").replace(/[.]+$/, "") : "";
  if (s.length > max) {
    const room = s.slice(0, max); // one short of max + 1, leaving room for the "…"
    const atWord = room.replace(/\s+\S*$/, "");
    s = (atWord.length >= max / 2 ? atWord : room.slice(0, max - 1)).replace(/[,;:\s-]+$/, "").slice(0, max - 1) + "…";
  }
  return s;
}

// Only well-formed blocks and notes get through.
export function tidy(out: { blocks?: unknown; notes?: unknown }, said: boolean): { blocks: Block[]; notes: Note[] } {
  const blocks = (Array.isArray(out.blocks) ? out.blocks : [])
    .filter((x) => x && typeof x.text === "string" && x.text.trim())
    .map((x) => ({
      text: String(x.text).trim(),
      el: ELEMENTS.includes(x.el) ? x.el : "paragraph",
      new_scene: !!x.new_scene,
      ...(said ? { said: typeof x.said === "string" ? x.said.trim() : "" } : {}),
    }));
  const notes = (Array.isArray(out.notes) ? out.notes : [])
    .filter((x) => x && typeof x.text === "string" && x.text.trim())
    .map((x) => ({ text: String(x.text).trim(), after: Math.max(-1, Math.min(blocks.length - 1, Math.round(Number(x.after) || 0))) }));
  return { blocks, notes };
}

async function writeOut(userId: string, b: VoiceBody): Promise<Heard> {
  if (typeof b.file !== "string" || !/^[\w-]+$/.test(b.file)) throw Object.assign(new Error("Missing recording"), { status: 400 });
  const { data, error } = await admin().storage.from("writing-files").download(`${userId}/${b.file}`);
  if (error || !data) throw Object.assign(new Error("The recording hasn't reached the cloud yet."), { status: 404 });
  const type = data.type || "audio/webm";
  const ext = type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";
  return await hear(data, `capture.${ext}`, { hint: HINT, terms: b.terms ?? [] });
}

export async function voice(client: Anthropic, userId: string, b: VoiceBody): Promise<Response> {
  const place = b.place === "draft" ? "draft" : "day";
  let raw = typeof b.transcript === "string" ? b.transcript.trim() : "";
  // Which speech service wrote it out, and what it tried on the way (kept on the line).
  let heard: { heard_by?: string; tried?: string[] } = {};
  try {
    if (!raw) { const h = await writeOut(userId, b); raw = h.text.trim(); heard = { heard_by: h.by, tried: h.tried ?? [] }; }
  } catch (err) {
    const e = err as Error & { code?: string; status?: number };
    console.error(e);
    return json({ error: e.message, code: e.code ?? null }, e.status ?? 500);
  }
  // Nothing heard: said so, so the app can keep the recording and offer another try.
  if (!raw) { console.warn("voice: no words heard", b.file ?? "(transcript)"); return json({ raw: "", mode: null, blocks: [], notes: [], heard: "nothing", ...heard }); }

  const modes = await modesOf(userId);
  // Drafting goes in as a scene unless another mode was asked for.
  const asked = modes.find((m) => m.id === b.use) ?? (place === "draft" && !b.use ? modes.find((m) => m.id === "scene") : undefined);
  const quiet = <T>(p: Promise<T>, empty: T) => p.catch((err) => { console.error(err); return empty; });
  // A day-page capture also gets Claude's one #tag and links to anything it named.
  const extras = place === "day" && !b.use
    ? Promise.all([quiet(tagFor(client, raw, b.tags), ""), quiet(refsIn(client, raw), [] as { label: string; url: string }[])])
    : Promise.resolve(null);
  const mode = asked ?? await pick(client, raw, modes, place);
  let written: { blocks: Block[]; notes: Note[] };
  try {
    written = await write(client, raw, mode, b, place === "draft");
  } catch (err) {
    // The words still come back, so nothing said is lost.
    console.error(err);
    const [tag, refs] = (await extras) ?? ["", []];
    return json({ raw, mode: mode.id, blocks: [], notes: [], tag, refs, ...heard, warning: "Claude couldn't write it up this time, so here are your words as said." });
  }
  const more = await extras;
  return json({ raw, mode: mode.id, ...written, ...heard, ...(more ? { tag: more[0], refs: more[1] } : {}) });
}

export async function voiceModes(userId: string, body: Record<string, unknown>): Promise<Response> {
  const modes = await modesOf(userId);
  if (body.mode === "voice-save-mode" && body.item && typeof body.item === "object") {
    const saved = await saveMode(userId, modes, body.item as Record<string, unknown>);
    return typeof saved === "string" ? json({ error: saved }, 400) : json({ mode: saved });
  }
  if (body.mode === "voice-delete-mode") {
    const why = await deleteMode(userId, modes, body.id);
    return why ? json({ error: why }, 400) : json({ ok: true });
  }
  return json({ modes: modes.map(({ id, name, prompt, model }) => ({ id, name, prompt, model })) });
}
