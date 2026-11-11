// Checks the connector's tools against a small pretend vault, with no
// database: run with  node --experimental-strip-types supabase/functions/inkwell-mcp/tools.test.ts
// The pretend database does roughly what the SQL functions in
// migrations/20261101210000_inkwell_second_brain.sql do.
import assert from "node:assert/strict";
import { type Db, type Entry, type Find, aboutHistory, aboutStale, dayStart, handle, INSTRUCTIONS } from "./tools.ts";

const T = (d: string) => new Date(d).toISOString();
const e = (id: string, kind: string, parent_id: string | null, more: Partial<Entry> = {}): Entry => ({
  id, kind, parent_id, sort: 1, title: "", text: "", content: null, tags: [], type: null, fields: {}, area_id: null, links: [], deleted: false,
  created_at: T("2026-10-27T18:00:00Z"), updated_at: T("2026-10-27T18:00:00Z"), ...more,
});

const rows: Entry[] = [
  e("area-writing", "area", null, { title: "Writing" }),
  e("wd-ninja", "world", null, { title: "The Ninja Bunch", area_id: "area-writing", updated_at: T("2026-10-30T18:00:00Z") }),
  e("pg-kenji", "page", "wd-ninja", { title: "Kenji" }),
  e("li-k1", "line", "pg-kenji", { text: "Kenji is afraid of the dentist #gag", tags: ["gag"], links: ["pg-dentist"] }),
  e("pg-dentist", "page", "wd-ninja", { title: "Dentist reel" }),
  e("pr-reel", "project", "wd-ninja", { title: "Reel 4", fields: { type: "screenplay", label: "Reel" } }),
  e("ab-wd-ninja", "about", "wd-ninja", { text: "Anime mockumentary musical told in reels.", fields: { by: "claude", edited_by: "claude" } }),
  e("ab-pg-dentist", "about", "pg-dentist", { text: "My own note", fields: { by: "me", edited_by: "me" } }),
  e("day-2026-10-27", "day", null, { title: "2026-10-27" }),
  e("li-d1", "line", "day-2026-10-27", {
    text: "Gift idea for Mom: a ramen kit #gift", tags: ["gift"], created_at: T("2026-10-27T17:00:00Z"),
    fields: { voice: { raw: "um so gift idea for mom uh a ramen kit" } },
  }),
  e("li-d2", "line", "day-2026-10-27", { text: "Drafting the dentist scene tonight", links: ["pg-dentist"], created_at: T("2026-10-28T05:00:00Z") }),
  e("pg-loose", "page", null, { title: "Research: cats" }),
  e("dg-week-2026-10-26", "digest", null, { title: "Week of Oct 26 – Nov 1, 2026", text: "You worked on the Ninja Bunch.\n\nMore.", fields: { period: "week", by: "claude" } }),
];

const live = (r: Entry) => !r.deleted && !r.fields?.trashed && !r.fields?.mirror;
const under = (root: string): Set<string> => {
  const out = new Set([root]);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (r.parent_id && out.has(r.parent_id) && !out.has(r.id)) { out.add(r.id); grew = true; } }
  return out;
};
const homeOf = (r: Entry): string => {
  let x: Entry | undefined = r;
  while (x && !["world", "day"].includes(x.kind) && x.parent_id) x = rows.find((y) => y.id === x!.parent_id);
  return x!.id;
};
const updates: unknown[] = [];

const db: Db = {
  outline: async () => rows.filter((r) => ["area", "world", "project", "page", "act", "chapter"].includes(r.kind) && !r.deleted),
  get: async (ids) => rows.filter((r) => ids.includes(r.id)),
  kids: async (ids) => rows.filter((r) => r.parent_id && ids.includes(r.parent_id) && !r.deleted),
  find: async (o: Find) => {
    const inside = o.under ? under(o.under) : null;
    const words = (o.query ?? "").toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, ""));
    return rows.filter((r) => live(r)
      && (o.kinds ?? ["line", "para", "page", "note", "chapter", "world", "project", "about", "digest"]).includes(r.kind)
      && words.every((w) => `${r.title} ${r.text} ${(r.fields?.voice as any)?.raw ?? ""}`.toLowerCase().includes(w))
      && (!o.tag || r.tags.includes(o.tag))
      && (!inside || inside.has(r.id))
      && (!o.since || r.created_at! >= o.since) && (!o.until || r.created_at! < o.until)).slice(0, o.limit);
  },
  tags: async (u) => {
    const inside = u ? under(u) : null;
    const n = new Map<string, number>();
    for (const r of rows) if (live(r) && (!inside || inside.has(r.id))) for (const t of r.tags) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n].map(([tag, c]) => ({ tag, n: c, last: T("2026-10-27T18:00:00Z") }));
  },
  rollup: async () => {
    const m = new Map<string, { home: string; n: number; last: string; top_tags: string[] }>();
    for (const r of rows) {
      if (!live(r) || ["about", "digest", "area"].includes(r.kind)) continue;
      const h = homeOf(r);
      const x = m.get(h) ?? { home: h, n: 0, last: "", top_tags: [] };
      x.n++; if (r.updated_at! > x.last) x.last = r.updated_at!;
      for (const t of r.tags) if (!x.top_tags.includes(t)) x.top_tags.push(t);
      m.set(h, x);
    }
    return [...m.values()];
  },
  linkedFrom: async (ids) => rows.filter((r) => live(r) && r.links.some((l) => ids.includes(l))),
  byKind: async (kinds) => rows.filter((r) => kinds.includes(r.kind) && !r.deleted),
  updateAbout: async (id, patch) => { updates.push({ id, ...patch }); },
  // The database stamps each new row.
  insert: async (rs) => { for (const r of rs) { r.created_at ??= new Date().toISOString(); r.updated_at ??= r.created_at; } rows.push(...rs); },
  timeZone: async () => "America/Los_Angeles",
  change: async (id, was, patch) => {
    const r = rows.find((x) => x.id === id);
    if (!r || ["about", "digest", "change", "tidy"].includes(r.kind) || (was && r.updated_at !== was)) return false;
    Object.assign(r, patch, { updated_at: new Date(Date.parse(r.updated_at!) + 1000).toISOString() });
    return true;
  },
  markChange: async (id, fields) => { const r = rows.find((x) => x.id === id && x.kind === "change"); if (r) r.fields = fields; },
};

let n = 0;
async function call(name: string, args: Record<string, unknown> = {}) {
  const r: any = await handle({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }, db);
  const text = r.result.content[0].text;
  return r.result.isError ? { error: text } : JSON.parse(text);
}

// The tools are offered.
const list: any = await handle({ jsonrpc: "2.0", id: 0, method: "tools/list" }, db);
const names = list.result.tools.map((t: any) => t.name);
for (const t of ["map", "search", "tags", "links", "set_about", "read", "list_worlds"]) assert.ok(names.includes(t), t);

// Map: worlds with abouts and counts, daily pages, tags, summaries, what needs an about.
const m = await call("map");
assert.equal(m.areas[0].area, "Writing");
const ninja = m.areas[0].worlds[0];
assert.equal(ninja.about, "Anime mockumentary musical told in reels.");
assert.equal(ninja.pieces, 1);
assert.equal(ninja.bible_pages, 2);
assert.ok(ninja.entries >= 5);
assert.equal(m.daily_pages.count, 1);
assert.equal(m.daily_pages.recent[0].date, "2026-10-27");
assert.ok(m.tags.most_used.some((t: string) => t.startsWith("#gift")));
assert.equal(m.summaries.weeks[0].id, "dg-week-2026-10-26");
assert.equal(m.summaries.weeks[0].gist, "You worked on the Ninja Bunch.");
assert.equal(m.loose_pages.count, 1);
assert.ok(m.needs_about.some((x: any) => x.id === "pg-kenji"));
assert.ok(!m.needs_about.some((x: any) => x.id === "wd-ninja"));

// Search: words, the voice original, tags, places, dates.
let s = await call("search", { query: "ramen" });
assert.equal(s.results[0].id, "li-d1");
assert.equal(s.results[0].where, "Daily page 2026-10-27");
assert.equal(s.results[0].written, "2026-10-27");
assert.equal(s.results[0].said_word_for_word, "um so gift idea for mom uh a ramen kit");
s = await call("search", { tag: "#gift" });
assert.deepEqual(s.results.map((r: any) => r.id), ["li-d1"]);
s = await call("search", { in: "wd-ninja", kinds: ["lines"] });
assert.deepEqual(s.results.map((r: any) => r.id), ["li-k1"]);
assert.equal(s.results[0].where, "The Ninja Bunch › Kenji");
s = await call("search", { since: "2026-10-27", until: "2026-10-27", kinds: ["lines"] });
// 2026-10-28T05:00Z is 10 pm on the 27th in Los Angeles.
assert.deepEqual(s.results.map((r: any) => r.id).sort(), ["li-d1", "li-d2", "li-k1"]);
s = await call("search", { kinds: ["summaries"] });
assert.ok(s.results.some((r: any) => r.kind === "summary"));
assert.ok(s.results.some((r: any) => r.kind === "about" && r.id === "wd-ninja"));
assert.ok((await call("search", {})).error);
assert.ok((await call("search", { kinds: ["dogs"] })).error);

// Dates: the start of a day where the person is.
assert.equal(dayStart("2026-10-27", "America/Los_Angeles"), "2026-10-27T07:00:00.000Z");
assert.equal(dayStart("2026-12-01", "America/Los_Angeles"), "2026-12-01T08:00:00.000Z");

// Tags, everywhere or in one world.
const tg = await call("tags", { in: "wd-ninja" });
assert.deepEqual(tg.tags.map((t: any) => t.tag), ["#gag"]);

// Links both ways.
const lk = await call("links", { id: "pg-dentist" });
assert.deepEqual(lk.linked_from.map((r: any) => r.id).sort(), ["li-d2", "li-k1"]);
const lk2 = await call("links", { id: "pg-kenji" });
assert.deepEqual(lk2.links_to.map((r: any) => r.id), ["pg-dentist"]);

// Abouts: Claude writes its own, updates its own, leaves the person's alone.
let a = await call("set_about", { id: "pg-kenji", about: "Kenji, the nervous ninja: fears, habits, running gags." });
assert.equal(a.about, "Kenji, the nervous ninja: fears, habits, running gags.");
const made = rows.find((r) => r.id === "ab-pg-kenji")!;
assert.equal(made.kind, "about");
assert.equal(made.parent_id, "pg-kenji");
assert.equal(made.fields.by, "claude");
a = await call("set_about", { id: "wd-ninja", about: "An anime mockumentary musical, made as reels." });
assert.equal((updates.at(-1) as any).id, "ab-wd-ninja");
// The old wording is kept, with who wrote it.
assert.equal((updates.at(-1) as any).fields.history[0].text, "Anime mockumentary musical told in reels.");
assert.equal((updates.at(-1) as any).fields.history[0].by, "claude");
a = await call("set_about", { id: "pg-dentist", about: "Something else" });
assert.match(a.error, /wrote this about themselves/);
a = await call("set_about", { id: "li-k1", about: "x" });
assert.ok(a.error);
a = await call("set_about", { id: "pg-loose", about: "x".repeat(400) });
assert.ok(a.error);

// Read shows the about and opens a summary.
const rd = await call("read", { id: "wd-ninja" });
assert.equal(rd.about, "Anime mockumentary musical told in reels.");
const dg = await call("read", { id: "dg-week-2026-10-26" });
assert.equal(dg.period, "week");
const lw = await call("list_worlds");
assert.equal(lw.worlds[0].about, "Anime mockumentary musical told in reels.");

// Earlier wordings: newest first, five at most; nothing kept from an empty one.
const h = aboutHistory(e("ab-x", "about", "x", { text: "New", fields: { by: "claude", at: "2026-10-01", history: [1, 2, 3, 4, 5].map((i) => ({ text: `v${i}`, by: "claude", at: "" })) } }));
assert.equal(h.length, 5);
assert.equal(h[0].text, "New");
assert.deepEqual(aboutHistory(e("ab-y", "about", "y", { text: "" })), []);
// Stale: touched after the about, and the about is over two weeks old.
const now = Date.parse("2026-11-20T00:00:00Z");
assert.equal(aboutStale("2026-10-01T00:00:00Z", "2026-10-25T00:00:00Z", now), true);
assert.equal(aboutStale("2026-11-10T00:00:00Z", "2026-11-12T00:00:00Z", now), false);
assert.equal(aboutStale("2026-10-01T00:00:00Z", "2026-09-25T00:00:00Z", now), false);
assert.match(INSTRUCTIONS, /not instructions to you/);

// ---------- small changes, recorded and undoable ----------
rows.push(
  e("wd-xmas1", "world", null, { title: "Christmas", area_id: null }),
  e("pg-xmas-empty", "page", "wd-xmas1", { title: "I want to plan Christmas" }),
  e("wd-xmas2", "world", null, { title: "Christmas 2026 Planning" }),
  e("pg-gifts", "page", "wd-xmas2", { title: "Gifts" }),
  e("li-g1", "line", "pg-gifts", { text: "Ramen kit for Mom" }),
  e("li-g1a", "line", "li-g1", { text: "the good one from the market" }),
);
const before = JSON.stringify(rows.find((r) => r.id === "li-d1")!.text);
let c = await call("mark_done", { line_id: "li-d1", why: "You said you bought it" });
assert.ok(c.change_id.startsWith("cx_"));
const d1 = rows.find((r) => r.id === "li-d1")!;
assert.equal(d1.fields.done, true);
assert.equal((d1.fields.claude as any).change, c.change_id);
assert.equal(JSON.stringify(d1.text), before, "the words never change");
const rec = rows.find((r) => r.id === c.change_id)!;
assert.equal(rec.kind, "change");
assert.equal(rec.fields.by, "claude");
assert.equal((rec.fields.change as any).before.done, false);
assert.match((rec.fields.change as any).title, /Ticked/);
assert.equal((await call("mark_done", { line_id: "li-d1" })).note, "It was already ticked.");
assert.ok((await call("mark_done", { line_id: "pg-kenji" })).error, "only lines");

// Undo puts it back, once.
let u = await call("undo_change", { change_id: c.change_id });
assert.match(u.undone, /Ticked/);
assert.equal(d1.fields.done, false);
assert.ok((rows.find((r) => r.id === c.change_id)!.fields.change as any).undone_at);
assert.equal((await call("undo_change", { change_id: c.change_id })).note, "It was already undone.");
assert.ok((await call("undo_change", { change_id: "li-d1" })).error, "only changes");

// Undo is refused when the person changed it since.
c = await call("mark_done", { line_id: "li-d1" });
d1.fields = { ...d1.fields, done: false };
assert.match((await call("undo_change", { change_id: c.change_id })).error, /changed that since/);

// Moving a line takes what's under it along (its children keep pointing at it).
const g1 = rows.find((r) => r.id === "li-g1")!;
c = await call("move_line", { line_id: "li-g1", to: "pg-kenji" });
assert.equal(g1.parent_id, "pg-kenji");
assert.equal(rows.find((r) => r.id === "li-g1a")!.parent_id, "li-g1");
assert.ok(g1.sort > rows.find((r) => r.id === "li-k1")!.sort, "goes at the end");
assert.equal(g1.text, "Ramen kit for Mom");
// Nested under a line on the target page.
c = await call("move_line", { line_id: "li-g1", to: "pg-kenji", under_line_id: "li-k1" });
assert.equal(g1.parent_id, "li-k1");
assert.ok((await call("move_line", { line_id: "li-g1", to: "pg-gifts", under_line_id: "li-k1" })).error, "under a line on another page");
assert.match((await call("move_line", { line_id: "li-g1", to: "pg-kenji", under_line_id: "li-g1a" })).error, /inside itself/);
// To a daily page that doesn't exist yet: the day is made.
c = await call("move_line", { line_id: "li-g1", to: "2026-11-02" });
assert.equal(g1.parent_id, "day-2026-11-02");
assert.ok(rows.some((r) => r.id === "day-2026-11-02" && r.kind === "day"));
u = await call("undo_change", { change_id: c.change_id });
assert.equal(g1.parent_id, "li-k1", "back where it was");
assert.ok((await call("move_line", { line_id: "li-g1", to: "pr-reel" })).error, "not into a script");

// Life projects.
c = await call("set_life_project", { world_id: "wd-xmas2" });
const x2 = rows.find((r) => r.id === "wd-xmas2")!;
assert.equal(x2.fields.life, true);
u = await call("undo_change", { change_id: c.change_id });
assert.equal("life" in x2.fields, false);
assert.ok((await call("set_life_project", { world_id: "pg-gifts" })).error);

// The list of changes, newest first with undone ones marked.
const ch = await call("changes", {});
assert.ok(ch.changes.length >= 5);
assert.ok(ch.changes.some((x: any) => x.undone && x.undone_by === "Claude"));

// A row changed in the app between read and write isn't overwritten.
const realChange = db.change;
db.change = async () => false;
assert.match((await call("mark_done", { line_id: "li-k1" })).error, /just changed/);
db.change = realChange;

// Suggestions wait for a yes; nothing changes.
const sg = await call("suggest_tidy", { suggestions: [
  { type: "merge", a: "wd-xmas1", b: "wd-xmas2", why: "Both are your Christmas list." },
  { type: "trash_empty", a: "wd-xmas1", why: "A first try with nothing in it." },
  { type: "trash_empty", a: "wd-ninja", why: "x" },
  { type: "tags", text: "#gift #gifts", why: "Same thing." },
  { type: "area", a: "wd-xmas2", b: "Writing", why: "x" },
  { type: "rename", a: "wd-xmas2", text: "Christmas 2026", why: "Shorter." },
  { type: "life", a: "pg-gifts", why: "x" },
] });
assert.equal(sg.added.length, 5);
assert.equal(sg.left_out.length, 2);
const batch = rows.find((r) => r.kind === "tidy")!;
assert.equal((batch.fields.tidy as any).items[0].key, "merge:wd-xmas1:wd-xmas2");
assert.equal((batch.fields.tidy as any).items[0].choice, null);
assert.equal(rows.find((r) => r.id === "wd-xmas1")!.deleted, false);
assert.ok((await call("suggest_tidy", { suggestions: [{ type: "life", a: "pg-gifts", why: "x" }] })).error);

const tl: any = await handle({ jsonrpc: "2.0", id: 0, method: "tools/list" }, db);
for (const t of ["mark_done", "move_line", "set_life_project", "changes", "undo_change", "suggest_tidy"]) assert.ok(tl.result.tools.some((x: any) => x.name === t), t);

// ---------- production: shots out to the AI tools and results back ----------
const kept = new Map<string, { bytes: Uint8Array; type: string }>();
const fetched: string[] = [];
Object.assign(db, {
  fileLinks: async (ids: string[]) => ids.map((id) => (kept.has(id) || rows.some((r) => r.id === id && r.kind === "file") ? `https://files.test/${id}?sig=1` : null)),
  keepFile: async (id: string, bytes: Uint8Array, type: string) => { kept.set(id, { bytes, type }); },
  fetchFile: async (url: string) => {
    fetched.push(url);
    if (url.includes("big")) return null;
    if (url.endsWith(".html")) return { bytes: new Uint8Array([60]), type: "text/html", name: "page.html" };
    return { bytes: new Uint8Array([1, 2, 3]), type: url.endsWith(".mp4") ? "video/mp4" : "image/png", name: url.split("/").at(-1)! };
  },
});
const ninjaWorld = rows.find((r) => r.id === "wd-ninja")!;
ninjaWorld.fields = { production: { code: "NB", style: "Flat cel shading", aspect: "9:16", fps: "24", constraints: "Kenji is always a head shorter than Mom." } };
const reel = rows.find((r) => r.id === "pr-reel")!;
reel.fields = { ...reel.fields, code: "E01", numbered: true, gen: { model: "Kling 3.0", tries: 2 } };
rows.push(
  e("ac-r", "act", "pr-reel", { title: "Screenplay" }),
  e("ch-r", "chapter", "ac-r", { title: "Script" }),
  e("pp-1", "para", "ch-r", { sort: 1, text: "INT. KITCHEN - MORNING", fields: { el: "scene", code: "1" } }),
  e("pp-2", "para", "ch-r", { sort: 2, text: "Mother flips a pancake.", fields: { el: "action" } }),
  e("pp-3", "para", "ch-r", { sort: 3, text: "KENJI", fields: { el: "character" } }),
  e("pp-4", "para", "ch-r", { sort: 4, text: "Sit.", fields: { el: "dialogue" } }),
  e("pp-5", "para", "ch-r", { sort: 5, text: "EXT. DOJO - DAY", fields: { el: "scene", code: "2" } }),
  e("pp-6", "para", "ch-r", { sort: 6, text: "Rain at the dojo gate.", fields: { el: "action" } }),
  e("pg-chars", "page", "wd-ninja", { title: "Characters", sort: 5 }),
  e("pg-mom", "page", "pg-chars", { title: "Mom", fields: { element: { type: "character", also: ["Mother"], snippet: "Short, calm, grey bun", views: { front: "fi-front" }, ids: { soul: "soul_123" }, look: "mom_v2" } } }),
  e("pg-kitchen", "page", "wd-ninja", { title: "Kitchen", sort: 6, fields: { element: { type: "location", lighting: "Low morning sun through blinds" } } }),
  e("fi-front", "file", null, { title: "Mom front.png", fields: { type: "image/png" } }),
  e("fi-s1", "file", null, { title: "NB-E01-S01-01 a.png", fields: { type: "image/png", shot: "sh-1" } }),
  e("sh-1", "shot", "pp-1", { sort: 1, text: "Mom flips the pancake", fields: { n: "1", framing: "Medium", piece: "pr-reel", still: "Mom at the stove", video: "She flips it high", gen: { secs: 4 }, tries: [{ id: "tr-1", at: Date.parse("2026-11-03T20:00:00Z"), by: "me", still: "Mom at the stove", video: "She flips it high", files: ["fi-s1"] }] } }),
  e("sh-2", "shot", "pp-1", { sort: 2, text: "Pancake in the air", fields: { n: "2", piece: "pr-reel", gen: { secs: 3 } } }),
  e("sh-3", "shot", "pp-5", { sort: 1, text: "The gate in the rain", fields: { n: "1", piece: "pr-reel", made: "live" } }),
);

// Reading a piece's production: rules, the kit with links, scenes and shots with codes.
const pr = await call("production", { piece_id: "pr-reel" });
assert.equal(pr.rules.frame, "9:16");
assert.equal(pr.rules.always_and_never, "Kenji is always a head shorter than Mom.");
const mom = pr.kit.find((k: any) => k.name === "Mom");
assert.deepEqual(mom.tool_ids, { higgsfield_soul_id: "soul_123", comfyui_lora: "mom_v2" });
assert.equal(mom.sheet.front, "https://files.test/fi-front?sig=1");
assert.equal(pr.kit.find((k: any) => k.name === "Kitchen").lighting, "Low morning sun through blinds");
assert.equal(pr.scenes.length, 2);
assert.deepEqual(pr.scenes[0].elements, ["Mom", "Kitchen"], "Mom by another name, the kitchen in the heading");
const s1 = pr.scenes[0].shots[0];
assert.equal(s1.code, "NB-E01-S01-01");
assert.equal(s1.stage, "renders in");
assert.equal(s1.generation.model, "Kling 3.0", "the piece's model for finals where the shot has none");
assert.equal(s1.generation.seconds, 4);
assert.equal(s1.tries[0].files[0].url, "https://files.test/fi-s1?sig=1");
assert.equal(pr.scenes[1].shots[0].made, "filmed live");
// Estimate: shots 1 and 2 at Kling 3.0 ($0.08/s), 7 s, 2 tries; the live one isn't generated.
assert.equal(pr.cost.estimate_usd, 1.12);
assert.equal(pr.cost.prices_checked, "2026-11-03");
const one1 = await call("production", { piece_id: "pr-reel", scene: "2" });
assert.equal(one1.scenes.length, 1);
assert.ok((await call("production", { piece_id: "pr-reel", scene: "9" })).error);
assert.ok((await call("production", { piece_id: "pg-kenji" })).error);

// New prompts: the old ones are kept with their try; generation details; a group with the next shot.
const up = await call("update_shot", { shot_id: "sh-1", still_prompt: "Mom at the stove, low sun", model: "Seedance 2.0", seconds: 6, first_frame: "fi-s1", timed_to: "KENJI: Sit.", group_with_next: true });
assert.ok(up.changed.includes("still prompt"));
let sh1 = rows.find((r) => r.id === "sh-1")!;
assert.equal(sh1.fields.still, "Mom at the stove, low sun");
assert.equal(sh1.fields.video, "She flips it high");
assert.equal(sh1.fields.prompt_by, "claude");
assert.equal((sh1.fields.tries as any[]).length, 1, "the old prompts were already kept with their try");
assert.deepEqual(sh1.fields.gen, { secs: 6, model: "Seedance 2.0", first: "fi-s1", sync: "KENJI: Sit." });
assert.ok(sh1.fields.group);
assert.equal(rows.find((r) => r.id === "sh-2")!.fields.group, sh1.fields.group, "the next shot joined");
assert.ok((await call("update_shot", { shot_id: "sh-1", first_frame: "fi-nope" })).error, "frames come from the shot's own tries");
assert.ok((await call("update_shot", { shot_id: "sh-3", group_with_next: true })).error, "the last shot has no next");
assert.ok((await call("update_shot", { shot_id: "sh-1" })).error, "nothing to change");
const grouped = await call("production", { piece_id: "pr-reel", scene: "1" });
assert.deepEqual(grouped.scenes[0].shots[0].generation.one_generation_with, ["NB-E01-S01-02"]);
// One generation of 9 s at Seedance 2.0 ($0.30/s), 2 tries.
assert.equal(grouped.cost.estimate_usd, 5.4);
await call("update_shot", { shot_id: "sh-1", seconds: "", timed_to: "" });
assert.deepEqual(rows.find((r) => r.id === "sh-1")!.fields.gen, { model: "Seedance 2.0", first: "fi-s1" });

// Results come home: kept as files (a page stays a link), with model, settings and cost.
const tr = await call("add_try", { shot_id: "sh-1", results: ["https://cdn.gen.test/a/take1.mp4", { url: "https://cdn.gen.test/a/still.png", name: "NB-E01-S01-01 hf.png" }, "https://cdn.gen.test/view.html"], model: "Seedance 2.0", seconds: 6, settings: "seed 42, 1080p", cost_usd: 1.8 });
assert.equal(tr.kept.length, 2);
assert.deepEqual(tr.as_links, ["https://cdn.gen.test/view.html"]);
assert.equal(tr.cost_usd, 1.8);
sh1 = rows.find((r) => r.id === "sh-1")!;
const last = (sh1.fields.tries as any[]).at(-1);
assert.equal(last.by, "claude");
assert.equal(last.model, "Seedance 2.0");
assert.equal(last.settings, "seed 42, 1080p");
assert.equal(last.still, "Mom at the stove, low sun", "made with the shot's current prompts");
assert.equal(last.files.length, 2);
assert.equal(kept.size, 2);
const fileRow = rows.find((r) => r.id === tr.kept[1].file_id)!;
assert.equal(fileRow.title, "NB-E01-S01-01 hf.png");
assert.equal(fileRow.fields.shot, "sh-1", "the file knows its shot, so the app can put it back if a try is lost");
assert.equal(fileRow.fields.by, "claude");
// Without a cost: estimated from the price list.
const tr2 = await call("add_try", { shot_id: "sh-2", results: ["https://cdn.gen.test/b.mp4"], model: "Kling 3.0", seconds: 5 });
assert.equal(tr2.cost_usd, 0.4);
assert.equal(tr2.cost_estimated_from_prices, true);
const tr3 = await call("add_try", { shot_id: "sh-2", results: ["https://cdn.gen.test/big.mp4"] });
assert.deepEqual(tr3.as_links, ["https://cdn.gen.test/big.mp4"]);
assert.ok((await call("add_try", { shot_id: "sh-2", results: ["http://insecure.test/a.png"] })).error);
assert.ok((await call("add_try", { shot_id: "sh-2" })).error);

// Star: the video and the still each have their own star; off takes it away.
const vid = tr.kept.find((k: any) => k.type === "video/mp4").file_id;
await call("star", { shot_id: "sh-1", file_id: vid });
await call("star", { shot_id: "sh-1", file_id: "fi-s1" });
assert.deepEqual(rows.find((r) => r.id === "sh-1")!.fields.star, { video: vid, still: "fi-s1" });
await call("star", { shot_id: "sh-1", file_id: "fi-s1", off: true });
assert.deepEqual(rows.find((r) => r.id === "sh-1")!.fields.star, { video: vid });
assert.ok((await call("star", { shot_id: "sh-2", file_id: vid })).error, "only the shot's own results");
const after = await call("production", { piece_id: "pr-reel", scene: "1" });
assert.equal(after.scenes[0].shots[0].stage, "take picked");
assert.equal(after.scenes[0].shots[0].starred.video.url, `https://files.test/${vid}?sig=1`);
assert.equal(after.cost.spent_usd, 2.2);

// A shot changed in the app between read and write: read again and retry.
let flips = 0;
const realChange2 = db.change;
db.change = async (id, was, patch) => (flips++ < 1 ? false : realChange2(id, was, patch));
assert.ok(!(await call("update_shot", { shot_id: "sh-2", video_prompt: "It spins" })).error);
db.change = realChange2;
assert.equal(rows.find((r) => r.id === "sh-2")!.fields.video, "It spins");

// Prices: the starting list, then Claude's updates (the person's own are left unless there's a source).
const p0 = await call("prices");
assert.ok(p0.note);
assert.ok(p0.prices.some((p: any) => p.model === "Kling 3.0" && p.usd === 0.08));
const pu = await call("update_prices", { prices: [{ model: "Kling 3.0", usd: 0.07, source: "https://higgsfield.ai/pricing" }, { model: "Kling 4.5", usd: 0.25, tool: "Kling API" }], remove: ["MiniMax H3"] });
assert.deepEqual(pu.updated, ["Kling 3.0", "Kling 4.5"]);
assert.deepEqual(pu.removed, ["MiniMax H3"]);
let pl = rows.find((r) => r.id === "prices")!;
assert.equal(pl.kind, "prices");
const k3 = (pl.fields.list as any[]).find((p) => p.model === "Kling 3.0");
assert.equal(k3.usd, 0.07);
assert.equal(k3.by, "claude");
assert.equal(k3.source, "https://higgsfield.ai/pricing");
assert.ok(!(pl.fields.list as any[]).some((p) => p.model === "MiniMax H3"));
(pl.fields.list as any[]).find((p) => p.model === "Kling 4.5").by = "me";
const pu2 = await call("update_prices", { prices: [{ model: "Kling 4.5", usd: 0.3 }, { model: "Wan 3.0", usd: 0.09 }] });
assert.deepEqual(pu2.left_as_the_person_set_them, ["Kling 4.5"], JSON.stringify(pu2));
pl = rows.find((r) => r.id === "prices")!;
assert.equal((pl.fields.list as any[]).find((p) => p.model === "Kling 4.5").usd, 0.25);
assert.ok((await call("update_prices", { prices: [{ model: "X", usd: -1 }] })).error);
assert.equal((await call("production", { piece_id: "pr-reel", scene: "1" })).cost.estimate_usd, 4.8, "Seedance 2.0 is still $0.30/s, now 5 s + 3 s");

const tl2: any = await handle({ jsonrpc: "2.0", id: 0, method: "tools/list" }, db);
for (const t of ["production", "update_shot", "add_try", "star", "prices", "update_prices"]) assert.ok(tl2.result.tools.some((x: any) => x.name === t), t);

console.log("inkwell-mcp tools: all checks passed");
