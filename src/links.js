import { getEntry, linkedFrom, putEntries } from './db.js';
import { titleOf } from './notebook.js';

// A [[link]] keeps the name of the page it points to, so it reads well
// anywhere (exports included). When a page, chapter or book is renamed, every
// link to it is updated to the new name, here and on other devices through
// sync. Opening a page also checks its links, in case a rename arrived from
// elsewhere while this device was away.

const RENAMEABLE = new Set(['page', 'chapter', 'project', 'world', 'area']);

function retitle(nodes, id, title) {
  let changed = false;
  const walk = (list) => (list || []).map((n) => {
    if (n.type === 'entryRef' && n.attrs?.id === id && n.attrs.title !== title) {
      changed = true;
      return { ...n, attrs: { ...n.attrs, title } };
    }
    return n.content ? { ...n, content: walk(n.content) } : n;
  });
  const content = walk(nodes);
  return changed ? content : null;
}

function textOf(nodes) {
  return (nodes || []).map((n) => (n.type === 'text' ? n.text : n.type === 'entryRef' ? n.attrs?.title || '' : textOf(n.content))).join('');
}

// Called after local writes: rewrites links to anything whose name changed.
// Returns true if any link was updated.
export async function retitleLinks(rows) {
  const out = [];
  for (const row of rows) {
    if (!RENAMEABLE.has(row.kind) || row.deleted) continue;
    const title = titleOf(row);
    for (const from of await linkedFrom(row.id)) {
      const content = retitle(from.content, row.id, title);
      if (content) out.push({ ...from, content, text: textOf(content), updated_at: Date.now() });
    }
  }
  // Only a name inside a link changed: whoever wrote the line still did.
  if (out.length) await putEntries(out, { stamp: false });
  return out.length > 0;
}

// Brings the link names in an open editor up to date.
export async function freshenRefs(editor) {
  const ids = new Set();
  editor.state.doc.descendants((node) => { if (node.type.name === 'entryRef' && node.attrs.id) ids.add(node.attrs.id); });
  if (!ids.size) return;
  const titles = new Map();
  for (const id of ids) {
    const e = await getEntry(id);
    // A paragraph or line has no name of its own: its link keeps the words it was made with.
    if (e && !e.deleted && (RENAMEABLE.has(e.kind) || e.kind === 'day')) titles.set(id, titleOf(e));
  }
  if (editor.isDestroyed) return;
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'entryRef') return;
    const title = titles.get(node.attrs.id);
    if (title && title !== node.attrs.title) tr.setNodeMarkup(pos, undefined, { ...node.attrs, title });
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false));
}
