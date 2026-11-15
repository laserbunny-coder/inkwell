// What Claude says about where a thought belongs, made safe before the app
// acts on it (thoughts.ts asks; filing.test.ts checks). No imports, so the
// server checks can run it with plain Node.

export type Place = { where: "drawer" | "later" | "workshop" | "lookup"; text: string };
export type Move = { type: "add_today" | "first" | "last" | "off_today"; task: string; text: string; first: boolean };
export type Filing = { kind: "plan" | "file" | "none"; places: Place[]; moves: Move[]; said: string };

const WHERE = new Set(["drawer", "later", "workshop", "lookup"]);
const MOVES = new Set(["add_today", "first", "last", "off_today"]);

// What came back, made safe: known places once each, moves only on today's
// tasks, and a plan answer with no usable move becomes "none".
export function cleanFiling(out: unknown, ids: Set<string>, dump = false): Filing {
  const o = (out && typeof out === "object" ? out : {}) as Record<string, unknown>;
  let kind = ["plan", "file", "none"].includes(String(o.kind)) ? String(o.kind) as Filing["kind"] : "none";
  const seen = new Set<string>();
  const places: Place[] = (Array.isArray(o.places) ? o.places : [])
    .map((p) => ({ where: String((p as Place)?.where ?? ""), text: String((p as Place)?.text ?? "").trim().slice(0, 200) }))
    .filter((p) => WHERE.has(p.where) && !seen.has(p.where) && seen.add(p.where))
    .slice(0, 3) as Place[];
  const moves: Move[] = (Array.isArray(o.moves) ? o.moves : [])
    .map((m) => ({ type: String((m as Move)?.type ?? ""), task: String((m as Move)?.task ?? ""), text: String((m as Move)?.text ?? "").trim().slice(0, 200), first: !!(m as Move)?.first }))
    .filter((m) => MOVES.has(m.type) && (m.type === "add_today" ? !!m.text : ids.has(m.task)))
    .slice(0, 3) as Move[];
  const said = String(o.said ?? "").trim().slice(0, 120);
  // A brain dump on the page is only filed: its lines never change the plan.
  if (kind === "plan" && (dump || !moves.length)) kind = places.length ? "file" : "none";
  if (kind === "file" && !places.length) kind = "none";
  return { kind, places: kind === "file" ? places : [], moves: kind === "plan" ? moves : [], said };
}

