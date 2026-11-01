import { getEntry, putEntries, byKind, CLAUDE } from './db.js';
import { entry } from './model.js';

// What Claude knows: the notes Claude keeps to find its way around Inkwell
// (see the connector, inkwell-mcp in the Daybook repo). They're out of sight
// everywhere else; this is the one place to look at them.
//
// - A one-line "about" for a world, piece, page or chapter: an entry of kind
//   'about', id 'ab-' + the thing's id, inside the thing. Claude writes it when
//   it reads the thing. You can write your own instead (Claude leaves yours
//   alone), hand it back to Claude, or switch it off (Claude won't write one).
// - Weekly and monthly summaries of what you wrote: entries of kind 'digest',
//   written early each Monday (and at the start of a month) by the
//   inkwell-digest function.

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
export const aboutId = (id) => `ab-${id}`;
const KIND = { world: 'world', project: 'piece', page: 'page', chapter: 'chapter' };
const shortDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** The about for a thing, as stored (or null). */
export async function aboutFor(id) {
  const r = await getEntry(aboutId(id));
  return r && !r.deleted ? r : null;
}

/** Saves a change to an about: your own words, back to Claude, or off. */
export async function setAbout(thing, { text = null, off = null, toClaude = false } = {}) {
  const old = await getEntry(aboutId(thing.id));
  const now = Date.now();
  const base = old && !old.deleted ? old : { ...entry('about', { id: aboutId(thing.id) }), parent_id: thing.id, created_at: now };
  const fields = { ...(base.fields || {}), of: thing.id };
  if (off !== null) fields.off = off || null;
  let row = { ...base, parent_id: thing.id, deleted: false, updated_at: now, fields };
  // Keep the earlier wording (who wrote it and when) when it changes: the last five.
  const was = (base.text || '').trim();
  const history = Array.isArray(fields.history) ? fields.history : [];
  if ((toClaude || text !== null) && was && was !== (text ?? '').replace(/\s+/g, ' ').trim()) {
    fields.history = [{ text: was, by: fields.edited_by || fields.by || CLAUDE, at: new Date(base.updated_at || now).toISOString() }, ...history].slice(0, 5);
  }
  if (toClaude) {
    // Empty and marked as Claude's, so Claude writes a fresh one next time it reads this.
    row = { ...row, text: '', fields: { ...fields, off: null, by: CLAUDE, edited_by: CLAUDE }, _by: CLAUDE };
  } else if (text !== null) {
    // Yours from now on, even if you kept Claude's words: Claude leaves it alone.
    row = { ...row, text: text.replace(/\s+/g, ' ').trim().slice(0, 300), fields: { ...fields, off: null, edited_by: 'me' } };
  }
  await putEntries([row]);
  return row;
}

/** Everything the panel shows for one thing (or none: just the summaries). */
async function load(thing) {
  const about = thing ? await aboutFor(thing.id) : null;
  const digests = (await byKind('digest')).sort((a, b) => (a.fields?.from < b.fields?.from ? 1 : -1));
  return { about, weeks: digests.filter((d) => d.fields?.period === 'week'), months: digests.filter((d) => d.fields?.period === 'month') };
}

// The panel. `thing` is the world, piece, page or chapter you're in, or null.
export async function openClaudeKnows(thing, { toast = () => {} } = {}) {
  document.querySelector('.ck-backdrop')?.remove();
  const back = make('div', 'ask-backdrop ck-backdrop');
  const box = make('div', 'ask ck');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'What Claude knows');
  back.append(box);
  document.body.append(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });

  const draw = async () => {
    const { about, weeks, months } = await load(thing);
    box.replaceChildren();
    const head = make('div', 'ck-head');
    head.append(make('h2', '', 'What Claude knows'), Object.assign(make('button', 'ghost-btn ck-close', '✕'), { title: 'Close (Esc)', onclick: close }));
    box.append(head);
    box.append(make('p', 'ck-lead', 'Notes Claude keeps so it can find things for you. You never have to look at them.'));

    if (thing) {
      const sec = make('section', 'ck-about');
      sec.append(make('h3', '', `About this ${KIND[thing.kind] || 'page'}`));
      const off = !!about?.fields?.off;
      const mine = about && (about.fields?.edited_by || about.fields?.by) !== CLAUDE && (about.text || '').trim();
      if (off) {
        sec.append(make('p', 'ck-note', 'Switched off: Claude won’t write one for this.'));
        const on = make('button', 'pill', 'Switch back on');
        on.onclick = async () => { await setAbout(thing, { off: false, toClaude: true }); draw(); };
        sec.append(make('div', 'ck-actions'));
        sec.lastChild.append(on);
      } else {
        const input = make('textarea', 'ask-input ck-input');
        input.rows = 2;
        input.maxLength = 300;
        input.value = about?.text || '';
        input.placeholder = 'Claude writes one line here the next time it reads this. Or write your own.';
        input.setAttribute('aria-label', 'About this');
        const who = make('p', 'ck-note', about && (about.text || '').trim()
          ? `${mine ? 'Written by you' : 'Written by Claude'} · ${shortDate(about.updated_at || about.created_at)}`
          : 'Nothing yet.');
        const row = make('div', 'ck-actions');
        const save = make('button', 'pill primary', 'Save as mine');
        save.onclick = async () => { await setAbout(thing, { text: input.value }); toast('Saved. Claude will leave your line as it is.'); draw(); };
        const give = make('button', 'ghost-btn', 'Let Claude write it');
        give.onclick = async () => { await setAbout(thing, { toClaude: true }); toast('Claude will write a fresh one next time it reads this.'); draw(); };
        const stop = make('button', 'ghost-btn', 'Switch off');
        stop.onclick = async () => { await setAbout(thing, { off: true }); draw(); };
        row.append(save, ...(mine ? [give] : []), stop);
        sec.append(input, who, row);
      }
      box.append(sec);
    }

    const list = make('section', 'ck-digests');
    list.append(make('h3', '', 'Weekly and monthly summaries'));
    if (!weeks.length && !months.length) list.append(make('p', 'ck-note', 'Claude writes the first one early on Monday morning, from the week before.'));
    for (const [label, rows] of [['Months', months], ['Weeks', weeks]]) {
      if (!rows.length) continue;
      list.append(make('h4', '', label));
      for (const d of rows) {
        const det = make('details', 'ck-digest');
        det.append(make('summary', '', d.title || d.id));
        for (const para of (d.text || '').split(/\n\s*\n/)) if (para.trim()) det.append(make('p', '', para.trim()));
        const threads = Array.isArray(d.fields?.threads) ? d.fields.threads : [];
        if (threads.length) {
          const ul = make('ul', 'ck-threads');
          for (const t of threads) {
            const li = make('li');
            li.append(make('strong', '', t.title), document.createTextNode(t.gist ? ` ${t.gist}` : ''));
            ul.append(li);
          }
          det.append(ul);
        }
        list.append(det);
      }
    }
    box.append(list);
  };
  await draw();
  box.querySelector('textarea, button')?.focus();
}
