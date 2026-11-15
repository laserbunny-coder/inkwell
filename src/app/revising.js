// Revising: fresh eyes, print, drafts, compare, Claude's notes.
import { children, getEntry } from '../db.js';
import { ask, askText, toast } from '../menu.js';
import { wordCount } from '../model.js';
import { titleOf } from '../notebook.js';
import { currentFont } from '../fonts.js';
import { pieceDoc, pageDoc, startDraft } from '../drafts.js';
import { CompareView, BesidePane } from '../compare.js';
import { claudeNotes, TalkPanel } from '../claudenotes.js';
import { bookType, hasManuscript } from '../library.js';
import { $, alts, askServer, canAskServer, editor, inNotebook, notes, root, state, statusEl, store, view } from '../main.js';
import { notebook } from './notebookview.js';
import { go, openBook, remember } from './routing.js';
import { sync } from './syncwiring.js';
import { nameOf, plural } from './tidying.js';
import { printLater } from './sharing.js';
import { productionOwner } from './productionwiring.js';
import { hidden, setShown } from './pagesettings.js';
import { writing } from './commands.js';

// ---------- revising: fresh eyes, print, drafts, compare, Claude's notes ----------

// Fresh eyes: one switch that makes the draft look unfamiliar (another kind
// of font, a narrower page, a different page colour), so it reads like
// someone else's. Per device, like the other view settings.
const freshEyes = () => root.classList.contains('fresh-eyes');
function setFreshFont() {
  const g = currentFont().group;
  root.style.setProperty('--fresh-prose', g === 'serif' ? "'iA Writer Quattro', Consolas, monospace" : "'Literata', Georgia, serif");
}
function toggleFreshEyes(on = !freshEyes()) {
  setFreshFont();
  root.classList.toggle('fresh-eyes', on);
  try { localStorage.setItem('freshEyes', on ? '1' : '0'); } catch { /* private window */ }
  const fe = $('#fresh-eyes'); if (fe) fe.checked = on;
  notes.layout();
  toast(on ? 'Fresh eyes on: a new font, page and colour, so it reads like someone else’s' : 'Fresh eyes off');
}

// The piece the revision tools are about, from where you are.
async function revisionPiece() {
  if (view() === 'compare') return getEntry(state.compareId);
  const id = await productionOwner();
  const b = id && (await getEntry(id));
  return b && hasManuscript(b) ? b : null;
}

// Ctrl + P: the piece as a manuscript or a script, ready to print or save as a PDF.
async function printCurrent() {
  if (inNotebook() && notebook.page && !notebook.isDay) {
    await notebook.close();
    const doc = await pageDoc(notebook.page);
    printLater({ title: titleOf(notebook.page), type: 'page', chapters: doc, author: await accountName() });
    return;
  }
  const b = await revisionPiece();
  if (!b) { toast('Open a piece to print it'); return; }
  if (state.project?.id === b.id) await store.close(editor.state.doc);
  const chapters = await pieceDoc(b.id);
  const words = chapters.reduce((n, ch) => n + ch.blocks.reduce((m, x) => m + wordCount(x.text), 0), 0);
  printLater({ title: b.title, type: bookType(b), chapters, words, author: await accountName() });
}
const accountName = async () => (window.__claude ? 'Michael' : (await sync.backend?.name?.().catch(() => '')) || '');

// Start again from scratch: the draft as it is now is kept whole, and the
// piece opens empty, with the old draft beside it to read from.
async function newDraft(piece) {
  const b = await getEntry(piece.id);
  const n = (b.fields?.draft || 1);
  const ok = await ask({
    title: `Start draft ${n + 1} of “${nameOf(b)}” from scratch?`,
    body: `Draft ${n} is kept whole, exactly as it is, with its notes${bookType(b) === 'screenplay' ? ', shots' : ''} and grid notes. The piece starts empty with the same ${bookType(b) === 'screenplay' ? 'script' : 'acts and chapters'}, and Draft ${n} opens beside it to read from. Compare the two any time.`,
    ok: `Start draft ${n + 1}`
  });
  if (!ok) return;
  if (state.project?.id === b.id) { await store.close(editor.state.doc); state.chapterId = null; }
  const { draft, first } = await startDraft(b, { script: bookType(b) === 'screenplay' });
  state.project = await getEntry(b.id);
  await go({ view: 'write', chapterId: first.id });
  await beside.open(b.id, first.id, { type: 'draft', id: draft.id });
  toast(`Draft ${n + 1}: a clean page. ${draft.title} is beside it (Ctrl + Shift + B hides it).`);
}

// Keep this draft as it is and carry on from a copy: for a big new pass
// that isn't starting over. The words you go on with keep their notes, shots
// and comments; the kept draft is a copy to read, compare or take back from.
async function newDraftFrom(piece) {
  const b = await getEntry(piece.id);
  const n = (b.fields?.draft || 1);
  const ok = await ask({
    title: `Keep this as draft ${n} and carry on?`,
    body: `A copy of “${nameOf(b)}” as it is now is kept as Draft ${n}. You go on writing in the same text (with its notes${bookType(b) === 'screenplay' ? ', shots' : ''} and comments), so change as much as you like: compare the two any time (Ctrl + Shift + X), or read Draft ${n} beside it (Ctrl + Shift + B).`,
    ok: `Keep draft ${n}`
  });
  if (!ok) return;
  if (state.project?.id === b.id) await store.close(editor.state.doc);
  const { draft, first } = await startDraft(b, { copy: true });
  state.project = await getEntry(b.id);
  const ch = writing() && state.chapterId ? state.chapterId : first?.id;
  if (ch) await go({ view: 'write', chapterId: ch });
  toast(`${draft.title} is kept. Carry on: this is draft ${n + 1}.`, { label: 'Compare', run: () => go({ view: 'compare', id: b.id }) });
}

// Ctrl + Shift + B: an earlier draft (or the text as it was) beside the one you're writing.
let beside; // set in wireRevising()
async function toggleBeside() {
  if (beside.isOpen) { beside.close(); editor.commands.focus(); return; }
  if (!writing() || !state.project || !state.chapterId) { toast('Open a chapter to read another draft beside it'); return; }
  await store.close(editor.state.doc);
  await beside.open(state.project.id, state.chapterId);
}

async function pickDate() {
  const got = await askText({ title: 'The text as it was on…', type: 'date', ok: 'Show it', value: '' });
  if (!got) return null;
  const [y, m, d] = got.split('-').map(Number);
  return y ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : null;
}

// Ctrl + Shift + X: compare two drafts, or the text then and now.
let comparer; // set in wireRevising()
async function toggleCompare() {
  if (view() === 'compare') { const p = await getEntry(state.compareId); return p ? openBook(p.id) : go({ view: 'library' }); }
  const b = await revisionPiece();
  if (!b) { toast('Open a piece to compare its drafts'); return; }
  return go({ view: 'compare', id: b.id, focus: writing() ? state.chapterId : null });
}

// Claude's notes on the chapter you're in: margin notes and a fix list.
async function askClaudeNotes() {
  if (!writing() || !state.chapterId) { toast('Open a chapter for Claude to read'); return; }
  if (!canAskServer()) { toast('Sign in and go online to ask Claude'); return; }
  await store.close(editor.state.doc);
  const chapter = await getEntry(state.chapterId);
  statusEl.textContent = 'Claude is reading…';
  try {
    const ctx = await alts.context();
    const got = await claudeNotes(chapter, state.project, { ask: askServer, idea: ctx.idea });
    if (state.chapterId === chapter.id) { await notes.reloadTypes(); await notes.load(chapter.id); if (hidden().has('claude')) setShown('claude', true); notes.setVisible(true); }
    statusEl.textContent = 'Saved';
    const fixes = got.page ? (await children(got.page.id)).length : 0;
    toast(`Claude left ${plural(got.notes.length, 'note')} in the margin${fixes ? ' and a fix list' : ''}`, got.page ? { label: 'Open the fix list', run: () => go({ view: 'notebook', pageId: got.page.id }) } : null);
  } catch (e) {
    statusEl.textContent = 'Saved';
    toast(e.message || 'Couldn’t ask Claude. Try again.');
  }
}

let talk; // set in wireRevising()
async function toggleTalk() {
  if (talk.isOpen) { talk.close(); editor.commands.focus(); return; }
  if (!writing() || !state.chapterId) { toast('Open a chapter to talk it over'); return; }
  await talk.open(state.chapterId);
}

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireRevising() {
  try { if (localStorage.getItem('freshEyes') === '1') { setFreshFont(); root.classList.add('fresh-eyes'); } } catch { /* private window */ }
  beside = new BesidePane($('.beside'), {
    pickDate: () => pickDate(),
    focus: () => editor.commands.focus()
  });
  window.__beside = beside;
  // Caught before the editor sees it, which would otherwise make a block quote.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); e.stopPropagation(); toggleBeside(); }
  }, true);
  comparer = new CompareView($('#compare-view'), {
    back: (piece) => openBook(piece.id),
    pickDate: () => pickDate(),
    remember: (place) => remember(place),
    ask: (b) => askServer(b),
    canAsk: () => canAskServer(),
    toast
  });
  window.__compare = comparer;
  talk = new TalkPanel($('.talk'), {
    ask: (b) => askServer(b),
    canAsk: () => canAskServer(),
    toast,
    save: () => store.close(editor.state.doc),
    context: () => alts.context(),
    focus: () => editor.commands.focus()
  });
  window.__talk = talk;
}

export { accountName, askClaudeNotes, beside, comparer, newDraft, newDraftFrom, printCurrent, revisionPiece, talk, toggleBeside, toggleCompare, toggleFreshEyes, toggleTalk, wireRevising };
