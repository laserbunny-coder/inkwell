// Woven scripts in Inkwell: a screenplay written as flowing prose, with each
// scene's INT./EXT. heading hidden underneath as data. Claude helps two ways,
// only when asked:
// - prepare: "Prepare for shoot" reads every scene and fills in what its
//   hidden heading is missing (inside or outside, the place, the time of day,
//   whether it's continuous, a flashback, an intercut or a montage), suggests
//   a short title for scenes that have none, and asks one-tap questions where
//   the words really don't say. It never rewrites the writer's words, and
//   Inkwell only fills blanks and guesses, never what the writer set.
// - look: a per-script look ("make it feel like an old kung fu film"): title
//   font and colour, the faint scene line, the colour of the names. Only
//   choices Inkwell knows come back.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { json } from "../_shared/common.ts";

const PREPARE_SYSTEM = `You help a screenwriter get a script ready to shoot, inside Inkwell, their writing app. They write in "Woven": the script reads as flowing prose with no INT./EXT. scene headings on the page. Each scene still has a hidden heading underneath (inside or outside, place, time of day), so schedules, shot lists, breakdowns and call sheets can be made. They make guerrilla live-action films (a7S III, phone, background replacement) and AI films.

You get the scenes in order, each with what its heading already knows ("known"), whether that was only guessed from the words, its title if it has one, and the start of its text. Fill in what's missing from the text and the scenes around it:
- ie: "INT.", "EXT." or "INT./EXT." (a car, a doorway, a window between the two).
- place: a short location name in capitals the way a scene heading says it ("BAKERY KITCHEN", "ALLEY BEHIND THE BAKERY"). Reuse the exact name of a place the script or the world already uses whenever it's the same place, so one location isn't scheduled twice under two names.
- time: "DAY", "NIGHT", "MORNING", "EVENING", "DAWN", "DUSK", "LATER", "MOMENTS LATER" or "SAME TIME". A scene that runs straight on from the one before is kind "continuous" instead. Work it out from the story when the text doesn't say (a scene right after a night scene in the same place is still night).
- kind: "cut" (an ordinary new scene), "continuous", "intercut" (two places at once, like a phone call; give place2 too), "flashback" or "montage".
- title: for scenes without a title only, two to five plain words in the writer's own tone saying what happens ("The letter", "Kenji slips"). Leave it empty when the scene already has one.
Leave a field empty when the scene's known heading already has it, unless it was only guessed and the text clearly says otherwise. A talking head or interview straight to camera is place "TALKING HEAD" with no time.

Only ask a question when the text and the story truly can't tell (not for things you can reasonably infer): say it in a few plain words and give two to four short options. At most 8 questions, most useful first.

List under places every place you used that isn't in the world's places yet, with whether it's inside or outside.`;

const PREPARE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenes", "questions", "places"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "ie", "place", "time", "kind", "place2", "title"],
        properties: {
          n: { type: "integer" },
          ie: { type: "string", enum: ["", "INT.", "EXT.", "INT./EXT."] },
          place: { type: "string" },
          time: { type: "string" },
          kind: { type: "string", enum: ["", "cut", "continuous", "intercut", "flashback", "montage"] },
          place2: { type: "string" },
          title: { type: "string" },
        },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "field", "ask", "options"],
        properties: {
          n: { type: "integer" },
          field: { type: "string", enum: ["ie", "place", "time", "kind", "place2"] },
          ask: { type: "string" },
          options: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } },
          },
        },
      },
    },
    places: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "ie"], properties: { name: { type: "string" }, ie: { type: "string", enum: ["", "INT.", "EXT.", "INT./EXT."] } } },
    },
  },
};

const FONTS = ["same", "ui", "shojumaru", "yuji", "zhimang", "marker", "elite", "bebas", "cinzel", "creepster", "bungee", "playfair", "caveat", "pixel"];
const LOOK_SYSTEM = `You set the look of a screenplay in Inkwell, a writing app, so the page feels like its genre while staying calm enough to write in for hours. The writing is shown in the writer's own body font; you only choose the touches around it: how scene titles look, the faint line between scenes, and the colour of character names. Keep it tasteful: one strong idea, mostly in the titles, and a faint line. Colours are hex and must read on both a dark brown-black page (#1C1A17) and a warm off-white page (#F6F1E7), so pick mid-brightness tones, never near-black or near-white.

Title fonts you can use:
- same: the writing font; ui: Inter, small and quiet
- shojumaru: kung fu movie poster; yuji: Japanese brush lettering; zhimang: wild Chinese brush script
- marker: felt pen; elite: worn typewriter (noir, thrillers); bebas: tall movie-poster capitals
- cinzel: carved in stone, epic; creepster: horror; bungee: loud comic-book signs
- playfair: elegant drama; caveat: handwritten; pixel: retro video game`;

const LOOK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "titleFont", "titleColor", "titleCaps", "titleSize", "titlePos", "lineW", "lineFade", "lineColor", "lineLen", "names", "dialogue"],
  properties: {
    name: { type: "string", description: "Two or three words naming the look" },
    titleFont: { type: "string", enum: FONTS },
    titleColor: { type: "string", description: "hex like #d8432f, or muted, accent or ink" },
    titleCaps: { type: "boolean" },
    titleSize: { type: "string", enum: ["small", "big"] },
    titlePos: { type: "string", enum: ["center", "left"] },
    lineW: { type: "string", enum: ["hair", "thin", "bold"] },
    lineFade: { type: "string", enum: ["faint", "soft", "clear"] },
    lineColor: { type: "string", description: "hex, or ink, accent or title (same as the titles)" },
    lineLen: { type: "string", enum: ["full", "short"] },
    names: { type: "string", description: "hex, or blue, copper or ink" },
    dialogue: { type: "string", enum: ["center", "left"] },
  },
};

type Known = { ie?: string; place?: string; time?: string; kind?: string; place2?: string };
type Scene = { n: number; heading?: string; known?: Known; guessed?: boolean; title?: string; text?: string };
type Place = { name: string; ie?: string; notime?: boolean };
export type WovenBody = { task?: "prepare" | "look"; piece?: string; scenes?: Scene[]; places?: Place[]; describe?: string };

const str = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");

export function preparePrompt(b: WovenBody) {
  const scenes = (b.scenes ?? []).filter((s) => s && Number.isInteger(s.n)).slice(0, 400);
  const places = (b.places ?? []).filter((p) => p && typeof p.name === "string").slice(0, 200);
  const parts: string[] = [];
  if (b.piece) parts.push(`The script: ${str(b.piece, 200)}`);
  parts.push(`The world's places: ${places.map((p) => `${str(p.name, 80)}${p.ie ? ` (${str(p.ie, 10)})` : ""}${p.notime ? " (no time of day)" : ""}`).join(", ") || "(none yet)"}`);
  // A long script shares one budget, so its last scenes still get read.
  const total = scenes.reduce((n, s) => n + str(s.text, 1500).length, 0);
  const share = total > 200000 ? 200000 / total : 1;
  parts.push(`The scenes, in order:\n\n${scenes.map((s) => {
    const k = s.known ?? {};
    const known = [k.ie && `ie ${k.ie}`, k.place && `place ${k.place}`, k.place2 && `place2 ${k.place2}`, k.time && `time ${k.time}`, k.kind && k.kind !== "cut" && `kind ${k.kind}`].filter(Boolean).map((x) => str(x, 100)).join(", ");
    const text = str(s.text, 1500);
    return [`Scene ${s.n}${s.title ? ` "${str(s.title, 80)}"` : ""}`, `  Known: ${known || "nothing yet"}${s.guessed ? " (only guessed from the words)" : ""}`, `  Text:\n${text.slice(0, Math.max(300, Math.floor(text.length * share)))}`].join("\n");
  }).join("\n\n")}`);
  parts.push("Fill in each scene's missing heading parts and titles, list new places, and ask only what you must.");
  return { text: parts.join("\n\n"), scenes };
}

async function call(client: Anthropic, system: string, content: string, schema: unknown, effort: "low" | "medium", maxTokens: number) {
  // Streamed: the SDK refuses a non-streamed request this large.
  const response = await client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort, format: { type: "json_schema", schema } },
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: server-side fallback parameter (beta)
    fallbacks: "default",
  }).finalMessage();
  if (response.stop_reason === "refusal") throw Object.assign(new Error("Claude wouldn't read this one."), { status: 422 });
  if (response.stop_reason === "max_tokens") throw Object.assign(new Error("Claude's answer was cut off. Try again."), { status: 502 });
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw Object.assign(new Error("No answer came back. Try again."), { status: 502 });
  return JSON.parse(text.text);
}

export async function woven(client: Anthropic, body: WovenBody): Promise<Response> {
  try {
    if (body.task === "look") {
      const describe = str(body.describe, 500).trim();
      if (!describe) return json({ error: "Say what the look should feel like." }, 400);
      const look = await call(client, LOOK_SYSTEM, `${body.piece ? `The script: ${str(body.piece, 200)}\n\n` : ""}The look the writer wants: ${describe}`, LOOK_SCHEMA, "low", 4000);
      return json({ look });
    }
    const ctx = preparePrompt(body);
    if (!ctx.scenes.length) return json({ error: "There are no scenes to read yet." }, 400);
    const out = await call(client, PREPARE_SYSTEM, ctx.text, PREPARE_SCHEMA, "medium", 32000);
    const known = new Set(ctx.scenes.map((s) => s.n));
    return json({
      scenes: (out.scenes ?? []).filter((s: { n: number }) => known.has(s.n)),
      questions: (out.questions ?? []).filter((q: { n: number }) => known.has(q.n)).slice(0, 8),
      places: (out.places ?? []).slice(0, 60),
    });
  } catch (err) {
    console.error(err);
    const status = (err as { status?: number }).status;
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The Claude API key isn't set up correctly." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    if (status) return json({ error: (err as Error).message }, status);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
}
