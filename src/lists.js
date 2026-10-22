import { putEntries, getEntry, children, getMeta, setMeta } from './db.js';

// Watch and read lists: a page you mark as one (Ctrl + K, while it's open)
// gets Claude's help. Type a title on its own line, and once you've moved on
// Claude finds the film, show or book and links the line to its page (IMDb,
// Goodreads or Open Library). Your words stay as you typed them; only the
// link is added. A line that already has a link is left alone, and each line
// is looked up once for the words it has.

export const LISTS = { watch: 'Watch list', read: 'Read list' };
export const listOf = (page) => (page && LISTS[page.fields?.list] ? page.fields.list : null);

export async function setList(pageId, list) {
  const page = await getEntry(pageId);
  if (!page) return null;
  const fields = { ...(page.fields || {}) };
  if (list) fields.list = list; else delete fields.list;
  const row = { ...page, fields, updated_at: Date.now() };
  await putEntries([row]);
  return row;
}

const linked = (content) => (content || []).some((n) => n.marks?.some((m) => m.type === 'link') || n.type === 'entryRef');

// The lines on a list page that still need a link: top-level, with words, not
// linked, and not already looked up for these exact words.
async function needing(page, skip) {
  const tried = (await getMeta('listTried')) || {};
  return (await children(page.id)).filter((l) => l.kind === 'line' && !l.deleted && l.id !== skip && l.text.trim().length > 1 &&
    !linked(l.content) && tried[l.id] !== l.text && l.fields?.lookup?.for !== l.text);
}

async function noteTried(id, text) {
  const tried = (await getMeta('listTried')) || {};
  tried[id] = text;
  await setMeta('listTried', tried);
}

// Puts the link on the words only: #tags and the spaces around them stay plain.
function linkWords(content, mark) {
  const out = [];
  const push = (n, text, marked) => { if (text) out.push({ ...n, text, ...(marked ? { marks: [...(n.marks || []), mark] } : {}) }); };
  for (const n of content) {
    if (n.type !== 'text') { out.push(n); continue; }
    for (const part of n.text.split(/(#[\p{L}\p{N}_-]+)/u)) {
      if (part.startsWith('#')) { push(n, part, false); continue; }
      const [, lead, core, trail] = part.match(/^(\s*)([\s\S]*?)(\s*)$/);
      push(n, lead, false); push(n, core, true); push(n, trail, false);
    }
  }
  return out;
}

let busy = null;
let again = null;
// Looks up what's waiting on a list page. `skip` is the line being typed on.
// Asked again while it's busy, it goes round once more when it's done.
export function fillList(page, opts) {
  const { ask, canAsk, onRows, skip = null } = opts;
  if (!listOf(page) || !canAsk()) return Promise.resolve();
  if (busy) { again = [page, opts]; return busy; }
  busy = (async () => {
    for (const line of await needing(page, skip)) {
      let found;
      try {
        found = await ask({ mode: 'lookup', text: line.text, list: listOf(page) });
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 429) await noteTried(line.id, line.text);
        continue;
      }
      await noteTried(line.id, line.text);
      if (!found?.url) continue;
      // Only if the line still says what was looked up.
      const now = await getEntry(line.id);
      if (!now || now.deleted || now.text !== line.text || linked(now.content)) continue;
      const content = linkWords(now.content || [], { type: 'link', attrs: { href: found.url } });
      const row = { ...now, content, fields: { ...now.fields, lookup: { for: now.text, label: found.label || '', url: found.url, note: found.note || '' } }, updated_at: Date.now() };
      await putEntries([row]);
      onRows([row]);
    }
  })().catch((e) => console.error(e)).finally(() => {
    busy = null;
    if (again) { const [p, o] = again; again = null; fillList(p, o); }
  });
  return busy;
}
