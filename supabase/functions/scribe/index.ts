// Scribe, the dictation app: a recording comes in from the phone keyboard (or
// the Windows app), is written out by the same speech service as Inkwell's
// Capture, then Claude rewrites it in the chosen mode (Text message, Email, …).
// The device proves who it is with a secret made in Inkwell under "Connect
// Scribe"; only a hash of it is kept (scribe_tokens). Modes are the person's
// own (scribe_modes), starting from modes.ts. A mode with "Keep in Inkwell"
// on also files the recording and its words on that day's Inkwell page
// (keep.ts), after the answer has gone back. The speech service is told the
// names from Inkwell (worlds, pages, pieces) so they come back spelled right.
//
//   GET  …/scribe/modes                     -> { modes }
//   POST …/scribe  multipart: audio, mode, app, duration (ms)
//                                           -> { original, text, mode }
//   POST …/scribe  multipart: action=keep, audio, duration (ms)
//                                           -> { kept, mode, name, title }  (the Record tile: nothing typed,
//                                              written up the way Inkwell's Capture would and filed there)
//   POST …/scribe  multipart: action=make-mode, audio, [current = the mode being changed, as JSON]
//                                           -> { said, mode, added? }  (not saved yet; `added` is
//                                              the part tacked on the end of the current instruction)
//   POST …/scribe  JSON { action: "redo", original, mode, app } -> { text, mode }
//   POST …/scribe  JSON { action: "save-mode", mode: { id?, name, prompt, apps, model?, keep? } } -> { mode }
//   POST …/scribe  JSON { action: "delete-mode", id } -> { ok }
//   POST …/scribe  multipart: action=fix, audio, text, before, after, how (selection|last|before), mode, app
//                                           -> { said, text, learn, unchanged }  (the words with the spoken
//                                              change made; `learn`: names they spelled out, to remember)
//   GET  …/scribe/spellings                 -> { spellings }
//   POST …/scribe  JSON { action: "remember", term } -> { spellings }
//   POST …/scribe  JSON { action: "forget", term }   -> { spellings }
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, cors } from "../_shared/common.ts";
import { hear } from "../inkwell/speech.ts";
import { keepInInkwell } from "./keep.ts";
import { AROUND_MAX, finishFix, FIX_HINT, FIX_SCHEMA, FIX_SYSTEM, fixContent, fixModel, TARGET_MAX } from "./fix.ts";
import { forget, remember, spellingsOf, termsFor } from "./spellings.ts";
import { pick as pickMode, write } from "../inkwell/voice.ts";
import { cleanApps, deleteMode, type Mode, type Model, MODEL_IDS, modelOf, MODELS, modesOf, PROMPT_MAX, saveMode } from "./modes.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const headers = { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

const HINT = "Someone dictating a text message, an email or a note to type into their phone or computer.";

const SYSTEM = `You turn a dictated voice note into the text the person meant to type, ready to send as is. It was spoken out loud and written out word for word, so it may ramble, repeat itself, correct itself ("no wait, Thursday") or include asides. Write the finished text in their own voice, as them, in the mode they picked.

- Use only what they said. Never add facts, names, plans, promises or details of your own.
- If they talk to you ("make this sound friendly", "scratch that last part"), follow it and leave the instruction out of the text.
- Never answer questions in the note or reply to it: it's their message to someone else.
- Plain text only, no Markdown. Only the finished text, with nothing before or after it.`;

const TEXT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string", description: "The finished text, ready to type in." } },
};

const MODE_SYSTEM = `You help someone set up a mode in Scribe, their dictation keyboard. A mode is a short instruction, in plain words, for how their dictated words get rewritten before they're typed in (for example "A text message. Short and casual, keep my wording, no emoji."). They describe the mode they want out loud.

- name: two or three words, like "Work Slack" or "Email".
- prompt: the instruction, written as they'd say it, 1 to 4 sentences. Keep everything they asked for and add nothing they didn't.
- model: which Claude writes it. "haiku" is quick and cheap, right for texts, chat and light clean-ups; "sonnet" suits emails and everyday writing with some tone; "opus" is for writing that matters: long idea dumps, journaling, characters and voices, anything creative. If they name one ("use Opus for this", "the cheap one", "the best one"), use it; otherwise pick by what it's for.
- apps: the apps they said it's for, as Android app ids (Slack is "com.Slack", Gmail "com.google.android.gm", WhatsApp "com.whatsapp", Google Messages "com.google.android.apps.messaging", Outlook "com.microsoft.office.outlook", LinkedIn "com.linkedin.android", Discord "com.discord") plus the Windows program name when there's a desktop app ("slack.exe", "outlook.exe"). Only apps they named; empty if none.`;

// A change to a mode they have. The instruction they have is kept word for
// word: most changes are something to add, which goes on the end; only when
// they ask to take out or change part of it is the whole thing rewritten, and
// then only that part changes.
const CHANGE_SYSTEM = `You help someone change a mode in Scribe, their dictation keyboard. A mode is an instruction, in plain words, for how their dictated words get rewritten before they're typed in. They like the instruction they have and said out loud what to change about it.

- kind: "add" when they want something added to it ("also break long ones into paragraphs", "add that it should never use emoji"); this is most changes. "rewrite" only when they ask to take something out, or to change or replace something the instruction already says (it says "no greeting" and they now want one).
- add: for "add", only the new sentence or sentences, in plain words as they'd say it, written to read well after the current instruction (same voice: if it says "they", say "they"; if it says "I", say "I"). Never repeat what the instruction already says. Empty for "rewrite".
- prompt: for "rewrite", the whole new instruction: every sentence they didn't ask to change stays exactly as it is, word for word; change only what they asked. Empty for "add".
- name: keep the current name unless they asked to rename it.
- model: keep the current one unless they named another ("use Opus for this", "the cheap one" = haiku, "the best one" = opus).
- apps: keep the current list; add or take out only apps they named, as Android app ids (Slack "com.Slack", Gmail "com.google.android.gm", WhatsApp "com.whatsapp", Google Messages "com.google.android.apps.messaging", Outlook "com.microsoft.office.outlook") plus the Windows program name when there's a desktop app ("slack.exe", "outlook.exe").`;

const CHANGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "add", "prompt", "name", "model", "apps"],
  properties: {
    kind: { type: "string", enum: ["add", "rewrite"] },
    add: { type: "string" },
    prompt: { type: "string" },
    name: { type: "string" },
    model: { type: "string", enum: MODELS },
    apps: { type: "array", items: { type: "string" } },
  },
};

/** The current instruction with `add` on the end, as its own sentence(s). */
export function addTo(prompt: string, add: string): string {
  const p = prompt.trim();
  const a = add.trim();
  if (!a) return p;
  if (!p) return a;
  return /[.!?:)"'”]$/.test(p) ? `${p} ${a}` : `${p}. ${a}`;
}

const MODE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "prompt", "model", "apps"],
  properties: {
    name: { type: "string" },
    prompt: { type: "string" },
    model: { type: "string", enum: MODELS },
    apps: { type: "array", items: { type: "string" } },
  },
};

async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function ownerOf(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const { data } = await admin().from("scribe_tokens").select("user_id").eq("token_hash", await sha256(token)).maybeSingle();
  return data?.user_id ?? null;
}

// Work that carries on after the reply (the platform keeps the function up for it).
function later(p: Promise<unknown>) {
  // @ts-ignore: Supabase's edge runtime
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
  else p.catch(() => {});
}

const clean = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
async function ask(system: string, content: string, schema: { [key: string]: unknown }, model: Model = "opus"): Promise<Record<string, unknown>> {
  const request = {
    model: MODEL_IDS[model],
    max_tokens: 16000,
    system,
    messages: [{ role: "user" as const, content }],
    // Low effort keeps it quick enough to wait for with the keyboard open.
    output_config: { effort: "low" as const, format: { type: "json_schema" as const, schema } },
  };
  // Opus retries a declined request on another model by itself; the smaller
  // models don't have that, so a decline there goes to Opus instead.
  const response = model === "opus"
    // @ts-ignore: server-side fallback parameter (beta)
    ? await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    : await client.beta.messages.create(request);
  if (response.stop_reason === "refusal" && model !== "opus") return ask(system, content, schema, "opus");
  if (response.stop_reason !== "end_turn") throw new Error(`Claude stopped early (${response.stop_reason}).`);
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No answer came back.");
  return JSON.parse(text.text);
}

async function rewrite(said: string, mode: Mode, app: string): Promise<string> {
  if (!mode.prompt.trim()) return said;
  const out = await ask(SYSTEM, `Mode: ${mode.name}. ${mode.prompt}${app ? `\n\nThey're typing into: ${app}` : ""}\n\nWhat they said:\n${said.slice(0, 60000)}`, TEXT_SCHEMA, modelOf(mode.model) ?? "opus");
  return String(out.text ?? "").trim() || said;
}

// Writes out an uploaded recording; errors come back as a ready reply.
type Heard = { said: string; by?: string; audio: File };
async function writeOut(form: FormData, userId: string, hint = HINT): Promise<Heard | Response> {
  const audio = form.get("audio");
  if (!(audio instanceof File) || !audio.size) return reply({ error: "No recording came through." }, 400);
  try {
    const heard = await hear(audio, audio.name || "scribe.m4a", { hint, terms: await termsFor(userId) });
    return { said: heard.text, by: heard.by, audio };
  } catch (err) {
    const e = err as Error & { code?: string; status?: number };
    console.error(e);
    return reply({ error: e.message, code: e.code ?? null }, e.status ?? 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  const userId = await ownerOf(req);
  if (!userId) return reply({ error: "Scribe isn't connected. Open Scribe and tap Connect.", code: "not-connected" }, 401);

  try {
    if (req.method === "GET" && new URL(req.url).pathname.endsWith("/modes")) return reply({ modes: await modesOf(userId) });
    if (req.method === "GET" && new URL(req.url).pathname.endsWith("/spellings")) return reply({ spellings: await spellingsOf(userId) });
    if (req.method !== "POST") return reply({ error: "Not found" }, 404);

    const isForm = (req.headers.get("Content-Type") ?? "").includes("multipart/form-data");
    const form = isForm ? await req.formData().catch(() => null) : null;
    const body = isForm ? null : await req.json().catch(() => null) as Record<string, unknown> | null;
    const action = String(form?.get("action") ?? body?.action ?? "dictate");
    const modes = await modesOf(userId);
    const pick = (id: unknown) => modes.find((m) => m.id === id) ?? modes[0];

    if (action === "dictate" && form) {
      const heard = await writeOut(form, userId);
      if (heard instanceof Response) return heard;
      const said = heard.said;
      const mode = pick(form.get("mode"));
      if (!said) return reply({ original: "", text: "", mode: mode.id });
      const app = clean(form.get("app"), 100);
      let text = said;
      let warning: string | undefined;
      try {
        text = await rewrite(said, mode, app);
      } catch (err) {
        // The words still come back, so nothing said is lost.
        console.error(err);
        warning = "Claude couldn't rewrite it this time, so here are your words as said.";
      }
      // Filed in Inkwell once the answer is on its way, so typing isn't held up.
      if (mode.keep) {
        later(keepInInkwell(userId, heard.audio, { said, text, mode, app, duration: Number(form.get("duration")) || 0, heardBy: heard.by }));
      }
      return reply({ original: said, text, mode: mode.id, kept: !!mode.keep, ...(warning ? { warning } : {}) });
    }

    if (action === "keep" && form) {
      const heard = await writeOut(form, userId);
      if (heard instanceof Response) return heard;
      const said = heard.said;
      if (!said) return reply({ kept: false, error: "Didn't catch any words in that one." }, 422);
      // As Inkwell's Capture does: Claude picks the mode, then writes it up with a title.
      const mode = await pickMode(client, said, modes, "day");
      let w: Awaited<ReturnType<typeof write>> | null = null;
      try {
        w = await write(client, said, mode, { place: "day" }, false);
      } catch (err) {
        console.error(err); // kept word for word; Inkwell can write it up again
      }
      const text = (w?.blocks ?? []).map((b) => b.text).join("\n\n");
      await keepInInkwell(userId, heard.audio, {
        said, text, mode, app: "", duration: Number(form.get("duration")) || 0, heardBy: heard.by,
        blocks: w?.blocks, notes: w?.notes, title: w?.title,
      }, new Date(), true);
      return reply({ kept: true, mode: mode.id, name: mode.name, title: w?.title ?? "" });
    }

    if (action === "redo" && body) {
      const said = clean(body.original, 60000);
      if (!said) return reply({ error: "Nothing to redo." }, 400);
      const mode = pick(body.mode);
      return reply({ text: await rewrite(said, mode, clean(body.app, 100)), mode: mode.id });
    }

    if (action === "make-mode" && form) {
      const heard = await writeOut(form, userId);
      if (heard instanceof Response) return heard;
      const said = heard.said;
      if (!said) return reply({ error: "Didn't catch anything. Try again a little closer." }, 422);
      // The mode being changed: sent whole (it may be an unsaved draft), else by id.
      let current: Mode | undefined = modes.find((m) => m.id === form.get("mode"));
      try {
        const c = JSON.parse(String(form.get("current") ?? "null"));
        if (c && typeof c === "object") current = { id: clean(c.id, 40), name: clean(c.name, 40), prompt: clean(c.prompt, PROMPT_MAX), apps: cleanApps(c.apps), model: modelOf(c.model) ?? modes.find((m) => m.id === c.id)?.model ?? "opus", keep: typeof c.keep === "boolean" ? c.keep : !!modes.find((m) => m.id === c.id)?.keep };
      } catch { /* not sent */ }
      if (!current) {
        const out = await ask(MODE_SYSTEM, `The mode they asked for:\n${said}`, MODE_SCHEMA);
        return reply({ said, mode: { id: null, name: clean(out.name, 40), prompt: clean(out.prompt, PROMPT_MAX), apps: cleanApps(out.apps), model: modelOf(out.model) ?? "opus", keep: false } });
      }
      const out = await ask(CHANGE_SYSTEM, `The mode now:\nName: ${current.name}\nInstruction: ${current.prompt || "(none: it types the words as said)"}\nModel: ${current.model}\nApps: ${current.apps.join(", ") || "none"}\n\nThe change they asked for:\n${said}`, CHANGE_SCHEMA);
      const added = out.kind === "rewrite" ? "" : clean(out.add, PROMPT_MAX);
      // "add" never touches what's there; a rewrite that came back empty keeps it too.
      const prompt = out.kind === "rewrite" ? clean(out.prompt, PROMPT_MAX) || current.prompt : addTo(current.prompt, added).slice(0, PROMPT_MAX);
      return reply({
        said,
        added,
        mode: { id: current.id || null, name: clean(out.name, 40) || current.name, prompt, apps: cleanApps(out.apps), model: modelOf(out.model) ?? current.model, keep: !!current.keep },
      });
    }

    if (action === "fix" && form) {
      // Line breaks as the phone has them (form data can turn them into \r\n on the way).
      const nl = (v: FormDataEntryValue | null) => String(v ?? "").replace(/\r\n?/g, "\n");
      const text = nl(form.get("text"));
      if (!text.trim()) return reply({ error: "There's nothing to fix there. Select some words first." }, 400);
      // Cut short, the rest would be lost when the fix is typed over it.
      if (text.length > TARGET_MAX) return reply({ error: "That's too much to change at once. Select a smaller part." }, 400);
      const heard = await writeOut(form, userId, FIX_HINT);
      if (heard instanceof Response) return heard;
      const said = heard.said.trim();
      if (!said) return reply({ said: "", text, learn: [], unchanged: true });
      const mode = pick(form.get("mode"));
      const out = await ask(FIX_SYSTEM, fixContent({
        text,
        before: nl(form.get("before")).slice(-AROUND_MAX),
        after: nl(form.get("after")).slice(0, AROUND_MAX),
        how: clean(form.get("how"), 20),
        said,
        modeName: mode.name,
        modePrompt: mode.prompt,
        app: clean(form.get("app"), 100),
      }), FIX_SCHEMA, fixModel(mode.model, text.length));
      return reply({ said, ...finishFix(text, out) });
    }

    if (action === "remember" && body) {
      const kept = await remember(userId, body.term);
      return typeof kept === "string" ? reply({ error: kept }, 400) : reply({ spellings: kept });
    }

    if (action === "forget" && body) return reply({ spellings: await forget(userId, body.term) });

    if (action === "save-mode" && body && typeof body.mode === "object" && body.mode) {
      const saved = await saveMode(userId, modes, body.mode as Record<string, unknown>);
      return typeof saved === "string" ? reply({ error: saved }, 400) : reply({ mode: saved });
    }

    if (action === "delete-mode" && body) {
      const why = await deleteMode(userId, modes, body.id);
      return why ? reply({ error: why }, 400) : reply({ ok: true });
    }

    return reply({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return reply({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.APIError) return reply({ error: `Claude returned an error (${err.status}).` }, 502);
    return reply({ error: "Something went wrong in Scribe's server step." }, 500);
  }
});
