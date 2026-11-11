// Tags in Inkwell: Claude sorts the person's tags into a few families (Film
// references, Music, Story ideas...) and points out tags that look like the
// same thing (#stunt and #stunts). Groups the person already has stay as they
// are; only tags not in a group yet are placed. Nothing changes until they
// say so in Inkwell.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { json } from "../_shared/common.ts";

const SYSTEM = `You help a writer and filmmaker keep the #tags in their notes app tidy. They tag things they save and write: links, videos, ideas, journaling, story notes. Over time the tags pile up and they forget what they called things.

You get their tags, each with how many things carry it and a few examples of what's tagged, and the groups they already have.

1. groups: sort the tags into families that make sense for them, such as "Film references", "Music", "Story ideas", "Business". Keep every group they already have, with its name and the tags already in it. Put each tag that isn't in a group yet into one of their groups if it fits, or into a new group. Aim for about 4 to 12 groups in all; a group can be small. Group names are short and plain, in their words, without the # sign. Every tag goes in exactly one group.

2. same: tags that look like the same thing written two ways: singular and plural (#stunt, #stunts), spelling, abbreviations (#bts, #behindthescenes), or near-identical meaning (#film-idea, #movie-idea). For each, list the tags and which one to keep (usually the most used, or the clearer name). Don't suggest pairs listed as not the same. Leave out tags that are only related, not the same. None if there are none.

Use only tags from the list.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["groups", "same"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "tags"],
        properties: { name: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
      },
    },
    same: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tags", "keep"],
        properties: { tags: { type: "array", items: { type: "string" } }, keep: { type: "string" } },
      },
    },
  },
};

type Tag = { tag: string; count?: number; samples?: string[] };
type Group = { name: string; tags: string[] };
export type TagsBody = { tags?: Tag[]; groups?: Group[]; apart?: string[][] };

const clean = (t: unknown) => (typeof t === "string" ? t.trim().replace(/^#/, "").toLowerCase() : "");
const str = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

export function prompt(b: TagsBody) {
  const tags = (b.tags ?? []).map((t) => ({ tag: clean(t?.tag), count: Number(t?.count) || 0, samples: (t?.samples ?? []).map((s) => str(s, 140)).filter(Boolean).slice(0, 3) }))
    .filter((t) => t.tag).slice(0, 600);
  const known = new Set(tags.map((t) => t.tag));
  const groups = (b.groups ?? []).map((g) => ({ name: str(g?.name, 60), tags: (g?.tags ?? []).map(clean).filter((t) => known.has(t)) })).filter((g) => g.name).slice(0, 40);
  const apart = (b.apart ?? []).map((p) => (Array.isArray(p) ? p.map(clean).filter(Boolean) : [])).filter((p) => p.length > 1).slice(0, 200);
  const parts: string[] = [];
  parts.push(`Their tags (count, then examples):\n${tags.map((t) => `#${t.tag} (${t.count})${t.samples.length ? `: ${t.samples.map((s) => JSON.stringify(s)).join("; ")}` : ""}`).join("\n")}`);
  parts.push(`Their groups so far:\n${groups.length ? groups.map((g) => `${g.name}: ${g.tags.map((t) => `#${t}`).join(", ") || "(empty)"}`).join("\n") : "(none yet)"}`);
  if (apart.length) parts.push(`Not the same (they said so):\n${apart.map((p) => p.map((t) => `#${t}`).join(" and ")).join("\n")}`);
  return { text: parts.join("\n\n"), tags, groups, apart };
}

// Claude's answer, checked: their groups kept as they were, each tag in one
// group only, every tag placed, and merges only between real tags.
export function tidy(out: { groups?: Group[]; same?: { tags: string[]; keep: string }[] }, ctx: ReturnType<typeof prompt>) {
  const known = new Set(ctx.tags.map((t) => t.tag));
  const placed = new Set<string>();
  const groups: Group[] = ctx.groups.map((g) => {
    const tags = g.tags.filter((t) => !placed.has(t));
    tags.forEach((t) => placed.add(t));
    return { name: g.name, tags };
  });
  for (const g of out.groups ?? []) {
    const name = str(g?.name, 60).replace(/^#/, "");
    if (!name) continue;
    const add = (g.tags ?? []).map(clean).filter((t) => known.has(t) && !placed.has(t));
    add.forEach((t) => placed.add(t));
    const have = groups.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (have) have.tags.push(...add);
    else if (add.length) groups.push({ name, tags: add });
  }
  const left = ctx.tags.map((t) => t.tag).filter((t) => !placed.has(t));
  if (left.length) {
    const other = groups.find((g) => g.name.toLowerCase() === "other");
    if (other) other.tags.push(...left);
    else groups.push({ name: "Other", tags: left });
  }
  const apart = new Set(ctx.apart.map((p) => [...p].sort().join("|")));
  const same: { tags: string[]; keep: string }[] = [];
  for (const s of out.same ?? []) {
    const tags = [...new Set((s?.tags ?? []).map(clean).filter((t) => known.has(t)))];
    if (tags.length < 2 || apart.has([...tags].sort().join("|"))) continue;
    const keep = tags.includes(clean(s.keep)) ? clean(s.keep) : tags[0];
    same.push({ tags, keep });
  }
  return { groups, same: same.slice(0, 30) };
}

export async function sortTags(client: Anthropic, body: TagsBody): Promise<Response> {
  const ctx = prompt(body);
  if (!ctx.tags.length) return json({ error: "There are no tags to sort yet." }, 400);
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: ctx.text }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") return json({ error: "Claude wouldn't sort these tags." }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "Claude's answer was cut off. Try again." }, 502);
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No answer came back. Try again." }, 502);
    return json(tidy(JSON.parse(text.text), ctx));
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
}
