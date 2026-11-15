// First light (Part 5): pure helpers for the ESV chapter fetch, no imports so
// they can be checked on their own (esvref.test.ts).

// "2 Kings 4", "Psalm 23", "Song of Solomon 3": a book name and a chapter.
export function cleanRef(ref: unknown): string | null {
  const s = String(ref ?? "").replace(/\s+/g, " ").trim();
  if (s.length > 40) return null;
  const m = /^([1-3] )?([A-Za-z]+(?: [A-Za-z]+){0,2}) (\d{1,3})$/.exec(s);
  if (!m) return null;
  const ch = Number(m[3]);
  return ch >= 1 && ch <= 150 ? s : null;
}

// One chapter as plain text: verse numbers in brackets, headings, no
// footnotes, and the copyright notice the API sends at the end.
export function esvUrl(ref: string): string {
  const q = new URLSearchParams({
    q: ref,
    "include-passage-references": "false",
    "include-verse-numbers": "true",
    "include-first-verse-numbers": "true",
    "include-footnotes": "false",
    "include-footnote-body": "false",
    "include-headings": "true",
    "include-short-copyright": "false",
    "include-copyright": "true",
    "indent-paragraphs": "0",
    "indent-poetry": "true",
    "indent-poetry-lines": "2",
    "indent-declares": "0",
    "indent-psalm-doxology": "0",
  });
  return `https://api.esv.org/v3/passage/text/?${q}`;
}

// The API's answer → { text, notice }: the notice is the last paragraph when
// it is the copyright; the words themselves are left exactly as sent.
export function splitNotice(raw: unknown): { text: string; notice: string } | null {
  const p = (raw as { passages?: unknown })?.passages;
  if (!Array.isArray(p) || typeof p[0] !== "string" || !p[0].trim()) return null;
  const all = p[0].replace(/\s+$/, "");
  const at = all.search(/\n\s*\n[^\n]*(Scripture quotations|Crossway|\(ESV\))[\s\S]*$/);
  if (at < 0) return { text: all, notice: "" };
  return { text: all.slice(0, at).replace(/\s+$/, ""), notice: all.slice(at).trim() };
}
