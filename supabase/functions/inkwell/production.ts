// The production layer in Inkwell: a script made ready to generate or shoot.
// Claude helps four ways, only when asked:
// - breakdown: read each scene (and the production notes beside it) and say
//   which of the world's elements (characters, locations, props, wardrobe)
//   it uses, and name any it needs that the kit doesn't have yet;
// - shots: suggest a shot list for a scene;
// - prompts: write the prompt for each shot's still and its video, from the
//   scene, the shot, the elements' own prompt snippets and looks, and the
//   show's style rules, learning from the prompts whose renders were starred;
// - captions: draft a caption for each platform a piece is posted on.
// Nothing here writes anywhere: Inkwell shows what comes back and the writer
// keeps, edits or throws it away.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { json } from "../_shared/common.ts";

const SYSTEM = `You help a writer-director in Inkwell, their writing app, take a script into production. Most of their pieces are AI-generated animation and live-action shorts (gags, episodes, reels): every shot starts as a still made from a text prompt with reference images (in ComfyUI, PixAI or similar), and the still is then animated with a video prompt. Some are shot live.

The world's bible doubles as the production kit. Each element (a character, location, prop or wardrobe item) has a name, sometimes other names it goes by, a short prompt snippet describing how it looks in visible terms, and sometimes a locked look (a LoRA or reference pack name). Use the writer's names and their snippets exactly; never invent a look that contradicts a snippet. Some elements also carry a lighting line (a location's light, the same every time), a character sheet (front, side and back views the generator is given as references) and IDs in the generators (a Higgsfield Soul ID or Element, a ComfyUI LoRA, a Kling reference). The show rules (its frame and what must always or never be true on screen) hold in every shot. Production notes are things the script doesn't say that the writer wants on screen; they count as much as the script.

Scenes come labelled C1, C2… and elements E1, E2…; shots S1, S2…. Refer to them only by those labels.`;

const BREAKDOWN = `For each scene, list the elements it uses: the characters present (speaking or not), the location, and any props or wardrobe that matter on screen, from the words of the scene and its production notes. Only list elements that really appear. Then, for scenes that clearly need something the kit doesn't have yet (a character, location, prop or wardrobe item with no element), name each one in a few words with its type, at most four per scene, and only things that matter to how the scene looks.`;

const SHOTS = `Suggest a shot list for scene {C}: the shots needed to tell it on screen, in order, each with what happens in it (one short sentence, present tense) and the framing (shot size and angle or movement, a few words: "Wide, low angle", "Close-up on Mom", "Slow push in"). Keep to what the scene says and its production notes. Keep it lean: as few shots as tell the scene well (usually 3 to 10). Don't repeat shots it already has; if it has some, suggest only the ones still missing, saying after which existing shot each goes (or "start").`;

const PROMPTS = `Write prompts for the shots listed. For each shot:
- still: a prompt for the first frame as one image: subject, action frozen at its key moment, setting, framing and angle, lighting and mood, in plain visual terms an image model follows. Build it from the scene, the shot, and the snippet of every element in the shot, worded so each character looks the same in every shot (reuse snippet wording). Follow the style rules. Say what is seen, not what it means.
- video: a prompt to animate that still into the shot: the motion of the subjects and camera over the shot's length, in the order it happens, and nothing about how things look that the still already shows. Fit the motion to the seconds given. If the shot is timed to a line of dialogue or song, the motion plays under that line (who speaks, mouth movement). If shots share a group, they are made in one multi-shot generation: write each one's video prompt as its part of that clip, in order, so they cut together.
Use each location's lighting line word for word in the still. Where an element has a ComfyUI LoRA, include its trigger word in the still. Keep to the show rules.
Where earlier prompts for this show were starred (they worked), follow their structure and wording habits. Where the shot already has prompts, write a better version that keeps what the writer added.
For each shot also list which elements appear in it.`;

const CAPTIONS = `Draft one caption for each platform listed, for posting this piece. Each in the show's own voice (from the piece and its world), fitted to the platform: YouTube a title line then a short description; Instagram and Facebook a hook line, a sentence or two, then a few hashtags; TikTok short and punchy with a few hashtags; X one or two lines under 280 characters. No emoji unless the show's voice clearly uses them. Never invent facts about the cast or release.`;

const id = (s: string) => ({ type: "string", description: s });
const SCHEMAS: Record<string, unknown> = {
  breakdown: {
    type: "object", additionalProperties: false, required: ["scenes"],
    properties: {
      scenes: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["scene", "elements", "missing"],
          properties: {
            scene: id("C label"),
            elements: { type: "array", items: id("E label") },
            missing: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "type"], properties: { name: { type: "string" }, type: { type: "string", enum: ["character", "location", "prop", "wardrobe", "other"] } } } },
          },
        },
      },
    },
  },
  shots: {
    type: "object", additionalProperties: false, required: ["shots"],
    properties: { shots: { type: "array", items: { type: "object", additionalProperties: false, required: ["what", "framing", "after"], properties: { what: { type: "string" }, framing: { type: "string" }, after: id("S label of the existing shot it follows, \"start\", or \"\" for the end") } } } },
  },
  prompts: {
    type: "object", additionalProperties: false, required: ["shots"],
    properties: { shots: { type: "array", items: { type: "object", additionalProperties: false, required: ["shot", "still", "video", "elements"], properties: { shot: id("S label"), still: { type: "string" }, video: { type: "string" }, elements: { type: "array", items: id("E label") } } } } },
  },
  captions: {
    type: "object", additionalProperties: false, required: ["captions"],
    properties: { captions: { type: "array", items: { type: "object", additionalProperties: false, required: ["platform", "text"], properties: { platform: { type: "string" }, text: { type: "string" } } } } },
  },
};

type Element = { id: string; type?: string; name: string; also?: string[]; snippet?: string; look?: string; lighting?: string; ids?: Record<string, string>; views?: string[] };
type Shot = { id: string; code?: string; what?: string; framing?: string; still?: string; video?: string; model?: string; secs?: number; sync?: string; group?: string };
type Scene = { id: string; code?: string; heading?: string; summary?: string; text?: string; notes?: string[]; elements?: string[]; shots?: Shot[] };
type Example = { still?: string; video?: string };
export type ProductionBody = {
  task?: string;
  piece?: string;
  world?: string;
  style?: string;
  rules?: string;
  scenes?: Scene[];
  elements?: Element[];
  scene?: string;
  shots?: string[];
  examples?: Example[];
  platforms?: string[];
  text?: string;
};

const str = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");
const list = <T>(a: unknown, n: number) => (Array.isArray(a) ? (a as T[]).filter((x) => x && typeof x === "object").slice(0, n) : []);

export function prompt(b: ProductionBody) {
  const task = ["breakdown", "shots", "prompts", "captions"].includes(String(b.task)) ? String(b.task) : "breakdown";
  const scenes = list<Scene>(b.scenes, 400).filter((s) => typeof s.id === "string");
  const elements = list<Element>(b.elements, 300).filter((e) => typeof e.id === "string" && typeof e.name === "string");
  const cLabel = new Map(scenes.map((s, i) => [s.id, `C${i + 1}`]));
  const eLabel = new Map(elements.map((e, i) => [e.id, `E${i + 1}`]));
  const shotIds: string[] = [];
  const sLabel = (sid: string) => { let i = shotIds.indexOf(sid); if (i < 0) { shotIds.push(sid); i = shotIds.length - 1; } return `S${i + 1}`; };
  const parts: string[] = [];
  if (b.world) parts.push(`The world: ${str(b.world, 200)}`);
  if (b.piece) parts.push(`The piece: ${str(b.piece, 200)}`);
  if (b.style) parts.push(`The show's style rules:\n${str(b.style, 4000)}`);
  if (b.rules) parts.push(`The show rules (always and never):\n${str(b.rules, 4000)}`);
  if (task !== "captions") {
    parts.push(`The kit:\n${elements.map((e) => `${eLabel.get(e.id)} (${str(e.type, 20) || "other"}): ${str(e.name, 120)}${(e.also ?? []).length ? `, also called ${(e.also ?? []).slice(0, 8).map((a) => str(a, 60)).join(", ")}` : ""}${e.snippet ? `\n  Looks: ${str(e.snippet, 1200)}` : ""}${e.lighting ? `\n  Lighting: ${str(e.lighting, 400)}` : ""}${e.ids && typeof e.ids === "object" && Object.keys(e.ids).length ? `\n  IDs: ${Object.entries(e.ids).slice(0, 6).map(([k, v]) => `${({ soul: "Higgsfield Soul ID", element: "Higgsfield Element", lora: "ComfyUI LoRA", kling: "Kling reference" } as Record<string, string>)[k] ?? str(k, 30)} ${str(v, 120)}`).join("; ")}` : e.look ? `\n  Locked look: ${str(e.look, 200)}` : ""}${(e.views ?? []).length ? `\n  Character sheet: ${(e.views ?? []).slice(0, 4).map((v) => str(v, 20)).join(", ")} views` : ""}`).join("\n") || "(empty)"}`);
  }
  // Scene text shares one budget, so a long script is cut evenly.
  const total = scenes.reduce((n, s) => n + (typeof s.text === "string" ? s.text.length : 0), 0);
  const share = total > 300000 ? 300000 / total : 1;
  const sceneText = (s: Scene) => {
    const t = typeof s.text === "string" ? s.text.slice(0, Math.max(400, Math.floor(s.text.length * share))) : "";
    const shots = list<Shot>(s.shots, 80).filter((x) => typeof x.id === "string");
    return [
      `${cLabel.get(s.id)}${s.code ? ` (scene ${str(s.code, 10)})` : ""}: ${str(s.heading, 200)}`,
      s.summary ? `  Summary: ${str(s.summary, 1000)}` : "",
      (s.elements ?? []).length ? `  Uses: ${(s.elements ?? []).map((x) => eLabel.get(x)).filter(Boolean).join(", ")}` : "",
      ...(s.notes ?? []).slice(0, 30).map((n) => `  Production note: ${str(n, 600)}`),
      t ? `  Text:\n${t}${t.length < (s.text ?? "").length ? " […]" : ""}` : "",
      ...shots.map((x) => `  ${sLabel(x.id)}${x.code ? ` [${str(x.code, 30)}]` : ""}: ${str(x.what, 400) || "(no description)"}${x.framing ? ` — ${str(x.framing, 120)}` : ""}${x.model || x.secs ? `\n    Made with: ${[str(x.model, 80), Number(x.secs) > 0 ? `${Number(x.secs)} s` : ""].filter(Boolean).join(", ")}` : ""}${x.sync ? `\n    Timed to: ${str(x.sync, 400)}` : ""}${x.group ? `\n    Group: ${str(x.group, 40)} (one generation with the other shots in this group)` : ""}${x.still ? `\n    Still prompt now: ${str(x.still, 2000)}` : ""}${x.video ? `\n    Video prompt now: ${str(x.video, 2000)}` : ""}`),
    ].filter(Boolean).join("\n");
  };
  if (task === "breakdown") {
    parts.push(`The scenes, in order:\n\n${scenes.map(sceneText).join("\n\n")}`, BREAKDOWN);
  } else if (task === "shots" || task === "prompts") {
    const scene = scenes.find((s) => s.id === b.scene) ?? scenes[0];
    if (scene) parts.push(`The scene:\n\n${sceneText(scene)}`);
    if (task === "shots") parts.push(SHOTS.replace("{C}", scene ? cLabel.get(scene.id)! : ""));
    else {
      const wanted = (Array.isArray(b.shots) ? b.shots : []).filter((x) => typeof x === "string" && shotIds.includes(x));
      const ex = list<Example>(b.examples, 8).filter((e) => e.still || e.video);
      if (ex.length) parts.push(`Prompts that worked (starred) for this show:\n${ex.map((e, i) => `Example ${i + 1}:${e.still ? `\n  Still: ${str(e.still, 1500)}` : ""}${e.video ? `\n  Video: ${str(e.video, 1500)}` : ""}`).join("\n")}`);
      parts.push(`Shots to write prompts for: ${(wanted.length ? wanted : shotIds).map(sLabel).join(", ")}`, PROMPTS);
    }
  } else {
    const platforms = (Array.isArray(b.platforms) ? b.platforms : []).filter((p) => typeof p === "string").slice(0, 8);
    parts.push(`What the piece is:\n${str(b.text, 20000) || "(only its title)"}`, `Platforms: ${platforms.join(", ") || "YouTube, Instagram, Facebook, TikTok, X"}`, CAPTIONS);
  }
  return { task, text: parts.join("\n\n"), scenes, elements, shotIds };
}

type Out = {
  scenes?: { scene: string; elements: string[]; missing: { name: string; type: string }[] }[];
  shots?: { what?: string; framing?: string; after?: string; shot?: string; still?: string; video?: string; elements?: string[] }[];
  captions?: { platform: string; text: string }[];
};

export function tidy(out: Out, ctx: ReturnType<typeof prompt>) {
  const scene = (l: string) => ctx.scenes[Number(String(l).replace(/^C/i, "")) - 1]?.id ?? null;
  const el = (l: string) => ctx.elements[Number(String(l).replace(/^E/i, "")) - 1]?.id ?? null;
  const shot = (l: string) => ctx.shotIds[Number(String(l).replace(/^S/i, "")) - 1] ?? null;
  const TYPES = ["character", "location", "prop", "wardrobe", "other"];
  if (ctx.task === "breakdown") {
    return {
      scenes: (out.scenes ?? []).map((s) => ({
        scene: scene(s.scene),
        elements: [...new Set((s.elements ?? []).map(el).filter(Boolean))],
        missing: (s.missing ?? []).map((m) => ({ name: str(m.name, 80).trim(), type: TYPES.includes(m.type) ? m.type : "other" })).filter((m) => m.name).slice(0, 4),
      })).filter((s) => s.scene),
    };
  }
  if (ctx.task === "shots") {
    return {
      shots: (out.shots ?? []).map((s) => ({ what: str(s.what, 400).trim(), framing: str(s.framing, 120).trim(), after: s.after === "start" ? "start" : s.after ? shot(s.after) : null }))
        .filter((s) => s.what).slice(0, 30),
    };
  }
  if (ctx.task === "prompts") {
    const seen = new Set<string>();
    const shots = [];
    for (const s of out.shots ?? []) {
      const sid = shot(String(s.shot));
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      shots.push({ shot: sid, still: str(s.still, 4000).trim(), video: str(s.video, 4000).trim(), elements: [...new Set((s.elements ?? []).map(el).filter(Boolean))] });
    }
    return { shots };
  }
  return { captions: (out.captions ?? []).map((c) => ({ platform: str(c.platform, 30).toLowerCase().replace(/[^a-z]/g, ""), text: str(c.text, 5000).trim() })).filter((c) => c.text) };
}

export async function production(client: Anthropic, body: ProductionBody): Promise<Response> {
  const ctx = prompt(body);
  if (ctx.task !== "captions" && !ctx.scenes.length) return json({ error: "There are no scenes to read yet." }, 400);
  if (ctx.task === "prompts" && !ctx.shotIds.length) return json({ error: "Add a shot first, then Claude can write its prompts." }, 400);
  try {
    // Streamed: the SDK refuses a non-streamed request this large.
    const response = await client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      system: SYSTEM,
      messages: [{ role: "user", content: ctx.text }],
      output_config: { effort: ctx.task === "breakdown" ? "low" : "medium", format: { type: "json_schema", schema: SCHEMAS[ctx.task] } },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    }).finalMessage();
    if (response.stop_reason === "refusal") return json({ error: "Claude wouldn't do this one." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Claude's answer was cut off. Try fewer scenes." }, 502);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No answer came back. Try again." }, 502);
    return json(tidy(JSON.parse(text.text), ctx));
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The Claude API key isn't set up correctly." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
}
