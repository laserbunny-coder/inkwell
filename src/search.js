import { allEntries, isTrashed } from './db.js';
import { titleOf } from './notebook.js';

// Search inside everything written: paragraphs in chapters, lines on pages and
// daily pages, notes beside the text, and the names of books, chapters and
// pages. Every word typed has to appear (in any order); case and accents
// don't matter. The Trash isn't searched.

const fold = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TEXT = ['para', 'heading', 'line', 'note', 'scene'];
const NAMED = ['project', 'chapter', 'page', 'area'];

export async function searchIndex() {
  const rows = (await allEntries()).filter((r) => !r.deleted && !isTrashed(r));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = [];
  for (const r of rows) {
    // A mirror's words are its original's, which is found already.
    if (r.fields?.mirror) continue;
    const text = TEXT.includes(r.kind) ? (r.kind === 'scene' ? r.title : r.text) : NAMED.includes(r.kind) ? r.title : '';
    if (text && text.trim()) items.push({ row: r, text, key: fold(text), named: NAMED.includes(r.kind) });
  }
  // Where a piece lives: "Chapter 3 · My Novel", "Harbour (page)", "Tuesday, October 21".
  const whereCache = new Map();
  const where = (r) => {
    if (whereCache.has(r.id)) return whereCache.get(r.id);
    let home = r.kind === 'note' ? byId.get(r.parent_id) : r;
    const seen = new Set();
    while (home && !['chapter', 'page', 'day', 'project', 'area'].includes(home.kind) && !seen.has(home.id)) { seen.add(home.id); home = byId.get(home.parent_id); }
    let label = '';
    if (home?.kind === 'chapter') {
      let b = byId.get(home.parent_id);
      if (b?.kind === 'act') b = byId.get(b.parent_id);
      label = r.id === home.id ? `Chapter · ${b?.title || ''}` : `${home.title} · ${b?.title || ''}`;
    } else if (home?.kind === 'page') label = r.id === home.id ? (byId.get(home.parent_id)?.title ? `Page · ${byId.get(home.parent_id).title}` : 'Page') : home.title || 'Untitled page';
    else if (home?.kind === 'day') label = titleOf(home);
    else if (home?.kind === 'project') label = 'Book';
    else if (home?.kind === 'area') label = 'Area';
    if (r.kind === 'note') label = `Note · ${label}`;
    whereCache.set(r.id, label);
    return label;
  };
  return {
    size: items.length,
    find(query, limit = 50) {
      const words = fold(query).split(/\s+/).filter(Boolean);
      if (!words.length || query.trim().length < 2) return [];
      const hits = items.filter((it) => words.every((w) => it.key.includes(w)));
      // Names first, then whole-phrase matches, then the most recently changed.
      const phrase = words.join(' ');
      hits.sort((a, b) => (b.named - a.named) || (b.key.includes(phrase) - a.key.includes(phrase)) || (b.row.updated_at - a.row.updated_at));
      return hits.slice(0, limit).map((it) => ({ row: it.row, snippet: snippet(it.text, it.key, words[0]), where: where(it.row) }));
    }
  };
}

// A short piece of the text around the first word found.
function snippet(text, key, word) {
  const at = key.indexOf(word);
  if (text.length <= 110 || at < 0) return text.length > 110 ? `${text.slice(0, 108)}…` : text;
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, start + 110);
  return `${start ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
