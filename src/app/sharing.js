// Share links: read and comment.
import { getEntry } from '../db.js';
import { ask, toast } from '../menu.js';
import { titleOf } from '../notebook.js';
import { isLife } from '../pages.js';
import { inPane } from '../panes.js';
import { Sharing, linkFor, commentsOn } from '../sharelink.js';
import { ago, worldOf } from '../library.js';
import { make } from '../dom.js';
import { editor, hidden, inNotebook, notes, productionOwner, setShown, state, store } from '../main.js';
import { currentEditor, notebook } from './notebookview.js';
import { openEntry } from './routing.js';
import { sync } from './syncwiring.js';
import { plural } from './tidying.js';

// ---------- share links: read and comment ----------

let sharing; // set in wireSharing()

// What's shared from where you are: the piece, or the bible page.
async function shareTarget() {
  if (inNotebook() && notebook.page?.kind === 'page') return notebook.page;
  const id = await productionOwner();
  return id ? getEntry(id) : null;
}

async function openShare(target) {
  target = target || (await shareTarget());
  if (!target) { toast('Open a piece or a page to share it'); return; }
  if (isLife(await worldOf(target))) { toast('Life projects are never shared'); return; }
  if (state.project?.id === target.id) await store.close(editor.state.doc);
  if (inNotebook()) await notebook.close();
  document.querySelector('.share-panel')?.remove();
  const back = make('div', 'ask-backdrop');
  const box = make('div', 'ask share-panel');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Share a link');
  back.append(box);
  document.body.append(back);
  const close = () => { back.remove(); currentEditor().commands.focus(); };
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  const draw = async () => {
    const share = await sharing.current(target);
    box.replaceChildren(make('h2', '', `Share “${titleOf(target)}”`));
    const btn = (label, cls, run) => { const b = make('button', cls, label); b.type = 'button'; b.addEventListener('click', run); return b; };
    if (!share) {
      box.append(make('p', '', `Anyone with the link can read ${target.kind === 'page' ? 'this page' : 'this piece'} and leave comments, without an account. Nothing else of yours is shared: not your notes, other pieces or day pages. It stays up to date as you write, and you can turn it off any time.`));
      const l = make('label', 'switch');
      const c = make('input');
      c.type = 'checkbox';
      c.checked = true;
      l.append(c, document.createTextNode(' Readers can comment'));
      box.append(l);
      const row = make('div', 'ask-actions');
      row.append(btn('Cancel', 'ghost-btn', close));
      if (!sharing.ready) {
        box.append(make('p', 'hint', sync.user ? 'You’re offline. Links are made online.' : 'Sign in to sync first: links are made through your account.'));
        if (!sync.user && sync.available) row.append(btn('Sign in', 'pill primary', () => sync.signIn()));
      } else {
        row.append(btn('Make a link', 'pill primary', async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Making it…';
          try { await sharing.start(target, { comments: c.checked }); await draw(); } catch (err) { e.target.disabled = false; e.target.textContent = 'Make a link'; toast(err.message || 'Couldn’t make the link. Try again.'); }
        }));
      }
      box.append(row);
      row.querySelector('.primary')?.focus();
      return;
    }
    const url = linkFor(share.fields.token);
    const field = make('input', 'ask-input share-url');
    field.readOnly = true;
    field.value = url;
    field.setAttribute('aria-label', 'The link');
    field.addEventListener('focus', () => field.select());
    const copy = btn('Copy the link', 'pill primary', async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { field.select(); } });
    const urlRow = make('div', 'share-row');
    urlRow.append(field, copy);
    box.append(urlRow);
    const l = make('label', 'switch');
    const c = make('input');
    c.type = 'checkbox';
    c.checked = !!share.fields.comments;
    c.addEventListener('change', async () => { try { await sharing.setComments(share, c.checked); } catch (err) { c.checked = !c.checked; toast(err.message || 'Couldn’t change that. Try again.'); } });
    l.append(c, document.createTextNode(' Readers can comment'));
    box.append(l, make('p', 'hint', share.fields.sent ? `Readers see it as of ${ago(share.fields.sent)}; new words go up every couple of minutes.` : 'Sending…'));
    const list = await commentsOn(share);
    if (list.length) {
      box.append(make('div', 'panel-label', `Comments (${list.length})`));
      const ul = make('ul', 'share-comments');
      for (const n of list.slice(0, 30)) {
        const li = make('li', n.fields.resolved ? 'resolved' : '');
        const b = make('button', '');
        b.type = 'button';
        b.append(make('b', '', n.fields.comment.name || 'A reader'), document.createTextNode(` ${n.text}`));
        b.addEventListener('click', async () => { close(); await openEntry(n.parent_id); if (n.fields.chapter_id) { if (hidden().has('comments')) setShown('comments', true); notes.setVisible(true); } });
        li.append(b);
        ul.append(li);
      }
      box.append(ul);
    }
    const row = make('div', 'ask-actions');
    row.append(btn('Stop sharing…', 'ghost-btn danger-text', async () => {
      const ok = await ask({ title: 'Turn this link off?', body: 'Anyone who opens it sees that it’s been turned off. Comments already in stay in your margin. A new link later is a new address.', ok: 'Turn it off', danger: true });
      if (!ok) return;
      try { await sharing.stop(share); await draw(); toast('Link turned off'); } catch (err) { toast(err.message || 'Couldn’t turn it off. Try again.'); }
    }), btn('Done', 'pill', close));
    box.append(row);
    copy.focus();
  };
  await draw();
}

// The rooms loaded on demand (Make and Deliver, a world's pages and the Drawer, print, Woven's prep for the
// shoot, Bring in) are fetched a little after start, when the app is idle,
// so the service worker keeps them and they open offline too. Fetching runs
// each module's top level only, which just defines things.
function warmRooms() {
  const later = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));
  setTimeout(() => later(() => Promise.all([import('../prodview.js'), import('../stagepage.js'), import('../print.js'), import('../wovenprep.js'), import('../bringin.js')]).catch(() => { /* offline: next time */ })), 4000);
}

// Print (or save as PDF), loaded when first asked for.
const printLater = async (what) => (await import('../print.js')).printPiece(what);

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireSharing() {
  sharing = new Sharing({
    backend: () => sync.backend,
    user: () => sync.user,
    onComments: async (fresh) => {
      if (state.chapterId && fresh.some((n) => n.fields?.chapter_id === state.chapterId)) await notes.load(state.chapterId);
      const where = [...new Set(fresh.map((n) => n.fields?.comment?.share))].length === 1 ? (await getEntry(fresh[0].fields.comment.share))?.title : null;
      toast(`${plural(fresh.length, 'new comment')}${where ? ` on “${where}”` : ''}`, fresh[0].fields?.chapter_id ? { label: 'Show', run: () => openEntry(fresh[0].parent_id).then(() => { if (hidden().has('comments')) setShown('comments', true); notes.setVisible(true); }) } : null);
    }
  });
  window.__sharing = sharing;
  notes.comments = { reply: (n, t) => sharing.reply(n, t), resolve: (n) => sharing.resolve(n), toast };
  notes.skip = (n) => (n.type === 'claude' && hidden().has('claude')) || (n.type === 'comment' && hidden().has('comments'));
  if (!inPane) {
    setInterval(() => sharing.refresh().catch((e) => console.warn(e)), 120000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) sharing.refresh().catch(() => {}); });
    setTimeout(() => sharing.refresh().catch(() => {}), 8000);
  }
}

export { openShare, printLater, sharing, warmRooms, wireSharing };
