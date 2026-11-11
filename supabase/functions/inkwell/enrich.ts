// Claude's light touch on what's captured in Inkwell: one #tag for each
// capture (from the tags already in use where one fits), links for films,
// shows and books a capture names, and links for titles on watch and read
// list pages. It adds; it never changes the writer's words.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";

type Ref = { label: string; url: string };

const TAG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tag"],
  properties: { tag: { type: "string", description: "One tag, lowercase, letters, digits and hyphens only, no #; empty if nothing fits." } },
};

const TAG_SYSTEM = `You help a writer and filmmaker keep their notes findable without sorting them by hand. Given something they just captured (an idea they said out loud, or a link they saved), pick ONE tag that says what it's for or what it's about, so it gathers with related notes later.
- Strongly prefer one of the tags they already use when it fits (a project, a show, a theme). Make a new one only when none fits; keep it short (one or two words, hyphenated), like a project name or a topic.
- Never "idea", "link", "note", "inspiration" or anything that would fit everything. If nothing specific fits, return an empty tag.`;

const clean = (t: unknown) => String(t ?? "").toLowerCase().replace(/^#/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export async function tagFor(client: Anthropic, text: string, tags: unknown): Promise<string> {
  if (!text.trim()) return "";
  const have = Array.isArray(tags) ? tags.map(clean).filter(Boolean).slice(0, 60) : [];
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 2000,
    system: TAG_SYSTEM,
    messages: [{ role: "user", content: `Tags they already use, most used first: ${have.length ? have.join(", ") : "(none yet)"}\n\nWhat they captured:\n${text.slice(0, 8000)}` }],
    output_config: { effort: "low", format: { type: "json_schema", schema: TAG_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: server-side fallback parameter (beta)
    fallbacks: "default",
  });
  if (response.stop_reason !== "end_turn") return "";
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return "";
  const tag = clean(JSON.parse(block.text).tag);
  return ["idea", "ideas", "link", "links", "note", "notes", "inspiration"].includes(tag) ? "" : tag;
}

// Runs Claude with web search until it gives its final answer, and reads the
// JSON object at the end of it.
async function searchFor(client: Anthropic, system: string, prompt: string): Promise<Record<string, unknown> | null> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  for (let turn = 0; turn < 4; turn++) {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      system,
      messages,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }] as never,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    });
    if (response.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: response.content }); continue; }
    if (response.stop_reason !== "end_turn") return null;
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const found = text.match(/\{[\s\S]*\}/);
    if (!found) return null;
    try { return JSON.parse(found[0]); } catch { return null; }
  }
  return null;
}

const goodUrl = (u: unknown) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; } };

const REFS_SYSTEM = `A writer and filmmaker recorded an idea out loud. If it names specific films, TV shows, books, comics, games, plays or songs (for example "like the diner scene in Heat"), find each one's page: IMDb for films and TV, Goodreads or Open Library for books, otherwise Wikipedia. Use web search only to confirm the right page; never guess an address.
Only things actually named. Vague references ("some old samurai movie") get nothing. Most recordings name nothing; then answer with an empty list without searching.
Finish with only a JSON object, nothing after it: {"refs": [{"label": "Heat (1995)", "url": "https://www.imdb.com/title/tt0113277/"}]}. The label is the title with its year (and author for a book).`;

export async function refsIn(client: Anthropic, transcript: string): Promise<Ref[]> {
  if (transcript.split(/\s+/).length < 4) return [];
  const out = await searchFor(client, REFS_SYSTEM, `The recording, written out:\n\n${transcript.slice(0, 20000)}`);
  const refs = Array.isArray(out?.refs) ? out.refs as Array<Record<string, unknown>> : [];
  return refs.map((r) => ({ label: String(r.label ?? "").trim().slice(0, 120), url: goodUrl(r.url) })).filter((r) => r.label && r.url).slice(0, 6);
}

const LOOKUP_SYSTEM = `A writer keeps lists of films, shows and books to watch or read. Given one line from such a list, work out what title it means and find its page: IMDb for films and TV, Goodreads or Open Library for books. Use web search to confirm the right page; never guess an address. If the line is a note rather than a title, or you can't tell which title it means, return an empty url.
Finish with only a JSON object, nothing after it: {"label": "Heat (1995)", "url": "https://www.imdb.com/title/tt0113277/", "note": "Michael Mann, crime"}. The label is the title with its year (and author for a book); the note is two to four words (director or author, genre).`;

export async function lookup(client: Anthropic, text: string, list: string): Promise<{ label: string; url: string; note: string }> {
  const kind = list === "read" ? "a list of things to read" : list === "watch" ? "a list of things to watch" : "a list of things to watch or read";
  const out = await searchFor(client, LOOKUP_SYSTEM, `From ${kind}:\n${text.slice(0, 500)}`);
  return { label: String(out?.label ?? "").trim().slice(0, 120), url: goodUrl(out?.url), note: String(out?.note ?? "").trim().slice(0, 80) };
}
