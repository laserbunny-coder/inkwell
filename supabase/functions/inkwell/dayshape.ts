// What Claude heard in the morning talk, made safe before the app lays the
// day out (day.ts asks; dayshape.test.ts checks). No imports, so the server
// checks can run it with plain Node.

export type DayItem = { task: string; text: string; small: boolean };
export type DayShape = { items: DayItem[]; thoughts: string[]; said: string };

// Tasks already on today keep their id (once each); new ones need words.
// Thoughts are kept in his words. Everything is clipped.
export function cleanDay(out: unknown, ids: Set<string>): DayShape {
  const o = (out && typeof out === "object" ? out : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const items: DayItem[] = [];
  for (const raw of Array.isArray(o.items) ? o.items.slice(0, 40) : []) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const task = String(r.task ?? "").trim();
    const text = String(r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const small = r.small === true;
    if (task) {
      if (!ids.has(task) || seen.has(task)) continue;
      seen.add(task);
      items.push({ task, text: "", small });
    } else if (text) {
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ task: "", text, small });
    }
  }
  const thoughts = (Array.isArray(o.thoughts) ? o.thoughts : [])
    .map((t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 12);
  return { items, thoughts, said: String(o.said ?? "").trim().slice(0, 160) };
}
