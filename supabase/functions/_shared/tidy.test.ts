// Checks the tidy pass helpers: node --experimental-strip-types supabase/functions/_shared/tidy.test.ts
import assert from "node:assert/strict";
import { checkTidy, keyOf, mondayOf, oneSuggestion, tidyPrompt, type Input, type Row } from "./tidy.ts";

const r = (id: string, kind: string, parent_id: string | null, more: Partial<Row> = {}): Row => ({
  id, kind, parent_id, title: "", text: "", tags: [], links: [], fields: {}, area_id: null, created_at: "2026-10-21T20:00:00Z", ...more,
});
const outline = [
  r("area-personal", "area", null, { title: "Personal" }),
  r("wd-x1", "world", null, { title: "Christmas" }),
  r("pg-x1", "page", "wd-x1", { title: "I want to plan Christmas with gifts for everyone" }),
  r("wd-x2", "world", null, { title: "Christmas 2026 Planning" }),
  r("pg-gifts", "page", "wd-x2", { title: "Gifts" }),
  r("wd-ninja", "world", null, { title: "The Ninja Bunch" }),
  r("pg-kenji", "page", "wd-ninja", { title: "Kenji" }),
  r("pr-reel", "project", "wd-ninja", { title: "Reel 4", fields: { label: "Reel" } }),
  r("gone", "world", null, { title: "Trashed", fields: { trashed: true } }),
];
const input: Input = {
  outline,
  abouts: new Map([["wd-x2", "Christmas 2026 gift list and plans."]]),
  rollup: new Map([["wd-x2", { n: 12, last: "2026-11-01T00:00:00Z" }]]),
  empty: new Set(["wd-x1", "pg-x1"]),
  tags: [{ tag: "ai", n: 4 }, { tag: "ai-tools", n: 9 }, { tag: "drawer", n: 2 }],
  dayLines: [
    { ...r("li-1", "line", "day-2026-11-01", { text: "Kenji should sing about the dentist", links: ["pg-kenji"] }), day: "2026-11-01" },
    { ...r("li-2", "line", "day-2026-11-01", { text: "A heist film where the vault is a bakery" }), day: "2026-11-01" },
    { ...r("li-3", "line", "day-2026-11-01", { text: "Filed already", links: ["wd-ninja"], fields: { filed: ["pg-kenji"] } }), day: "2026-11-01" },
  ],
  declined: [{ key: "life:wd-ninja", title: "Make The Ninja Bunch a life project" }],
  waiting: [],
  today: "2026-11-02",
};
const p = tidyPrompt(input);
assert.match(p.text, /Today is 2026-11-02/);
assert.match(p.text, /W1: "Christmas", in no area, made 2026-10-21, EMPTY/);
assert.match(p.text, /About: Christmas 2026 gift list/);
assert.doesNotMatch(p.text, /Trashed/);
assert.doesNotMatch(p.text, /Filed already/);
assert.match(p.text, /Kenji should sing.*\n\s+could go in W\d "The Ninja Bunch": P\d Kenji; K\d Reel 4/);
assert.match(p.text, /Other recent day lines[\s\S]*bakery/);
assert.match(p.text, /Already turned down[\s\S]*Ninja Bunch a life project/);
const L = (id: string) => [...p.byLabel].find(([, v]) => v.id === id)![0];

const items = checkTidy({ items: [
  { type: "trash_empty", a: L("wd-x1"), b: "", text: "", why: "A first try with nothing in it." },
  { type: "merge", a: L("wd-x1"), b: L("wd-x2"), text: "", why: "Touches wd-x1 twice: dropped." },
  { type: "trash_empty", a: L("wd-x2"), b: "", text: "", why: "Not empty: dropped." },
  { type: "file", a: L("li-1"), b: L("pg-kenji"), text: "", why: "It's about Kenji." },
  { type: "file", a: L("li-2"), b: L("pg-kenji"), text: "", why: "No link to the world: dropped." },
  { type: "drawer", a: L("li-2"), b: "", text: "", why: "A film idea with no home." },
  { type: "tags", a: "#ai", b: "#ai-tools", text: "", why: "Same thing." },
  { type: "tags", a: "#drawer", b: "#ai", text: "", why: "Never the drawer tag." },
  { type: "life", a: L("wd-ninja"), b: "", text: "", why: "Turned down before: dropped." },
  { type: "life", a: L("wd-x2"), b: "", text: "", why: "It's real life." },
  { type: "area", a: L("wd-x2"), b: L("area-personal"), text: "", why: "x" },
  { type: "rename", a: L("wd-x2"), b: "", text: "Christmas 2026", why: "Shorter." },
  { type: "rename", a: "Z99", b: "", text: "x", why: "No such label." },
  { type: "nonsense", a: "", b: "", text: "", why: "" },
] }, p, input);
assert.deepEqual(items.map((i) => i.type), ["trash_empty", "file", "drawer", "tags", "life", "area", "rename"]);
assert.equal(items[0].title, "Put the empty world “Christmas” in the Trash");
assert.equal(items[1].title, "File “Kenji should sing about the dentist” on “Kenji”");
assert.deepEqual([items[3].a, items[3].b], ["ai", "ai-tools"]);
assert.equal(items[6].title, "Rename “Christmas 2026 Planning” to “Christmas 2026”");
assert.ok(items.every((i) => i.choice === null && i.by === "claude"));
assert.equal(keyOf("tags", "#AI", "ai-tools"), "tags:ai>ai-tools");

// One suggestion from a chat.
const s = oneSuggestion("tags", undefined, undefined, "#ai #ai-tools", "Same.", new Set(["ai"]));
assert.equal(typeof s === "object" && s.key, "tags:ai>ai-tools");
assert.match(String(oneSuggestion("merge", outline[1], outline[5].kind === "world" ? outline[6] : undefined, "", "x", new Set())), /two worlds/);
assert.match(String(oneSuggestion("life", outline[1], undefined, "", "", new Set())), /why/);
assert.equal(mondayOf("2026-11-03"), "2026-11-02");
assert.equal(mondayOf("2026-11-08"), "2026-11-02");
console.log("tidy: ok");
