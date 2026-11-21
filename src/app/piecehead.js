// The top of a piece's Outline (One home, Nov 20 2026): the piece's home.
// What it is and how it's written as one quiet line, its name, its stage as
// dots with the stage word and "→ next", and the whole thing in a sentence.
// "More ▸" holds the rest of what the Develop page had (a paragraph, who's
// in it, one page), so nothing written there is lost.
import { make } from '../dom.js';
import { getEntry, putEntries } from '../db.js';
import { popMenu } from '../menu.js';
import { bookType, formatName, kindName, nextLabel, stageOf, stagesOf, stats } from '../library.js';
import { state } from '../main.js';
import { go } from './routing.js';
import { renderCrumb, renderRail } from './rail.js';
import { KINDS, setKind, setLabel, setStage } from './tidying.js';

const MORE_KEY = 'phMore';
const more = () => { try { return localStorage.getItem(MORE_KEY) === '1'; } catch { return false; } };
const setMore = (on) => { try { localStorage.setItem(MORE_KEY, on ? '1' : '0'); } catch { /* full */ } };

async function saveDev(id, patch) {
  const fresh = await getEntry(id);
  const develop = { ...(fresh.fields?.develop || {}), ...patch };
  for (const k of Object.keys(patch)) if (develop[k] === '' || (Array.isArray(develop[k]) && !develop[k].length)) delete develop[k];
  await putEntries([{ ...fresh, fields: { ...fresh.fields, develop }, updated_at: Date.now() }]);
}

// A box that keeps what's typed into it, a moment after the typing stops.
function keeper(el, save) {
  let t = 0;
  const now = () => { if (t) { clearTimeout(t); t = 0; save(); } };
  el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(now, 600); });
  el.addEventListener('blur', now);
}

export function pieceHead(piece, world) {
  const box = make('div', 'ph1');
  box.dataset.id = piece.id;
  const dev = piece.fields?.develop || {};

  // SCREENPLAY · written as a script (tap: change either)
  const eye = make('button', 'ph1-eye');
  eye.type = 'button';
  eye.title = 'What it is, and how it’s written';
  eye.append(make('span', 'ph1-label', kindName(piece)), make('span', 'ph1-as', ` · written as ${formatName(piece) === 'Outline' ? 'an outline' : formatName(piece) === 'Prose' ? 'prose' : 'a script'}`));
  eye.addEventListener('click', () => popMenu(eye, [
    { label: 'What it is (Gag, Episode…)…', run: () => setLabel(piece) },
    { label: 'Written as', sub: KINDS.map(([id, label]) => ({ label, current: bookType(piece) === id, run: () => setKind(piece, id) })) }
  ]));

  // Its name, typed over.
  const name = make('h1', 'gv-title ph1-name', piece.title || 'Untitled');
  name.contentEditable = 'plaintext-only';
  name.spellcheck = false;
  name.setAttribute('aria-label', 'Name');
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); name.textContent = piece.title || 'Untitled'; name.blur(); }
  });
  name.addEventListener('blur', async () => {
    const t = name.textContent.trim();
    const fresh = await getEntry(piece.id);
    if (!t) { name.textContent = fresh.title || 'Untitled'; return; }
    if (t === fresh.title) return;
    await putEntries([{ ...fresh, title: t, updated_at: Date.now() }]);
    if (state.project?.id === piece.id) state.project.title = t;
    renderRail();
    renderCrumb();
  });

  // ●●○○ Writing   → Start boarding   412 words
  const list = stagesOf(piece, world);
  const at = stageOf(piece, world);
  const here = list.indexOf(at);
  const path = make('div', 'ph1-path');
  const stage = make('button', 'ph1-stage');
  stage.type = 'button';
  stage.title = 'Its stage';
  const dots = make('span', 'ph1-dots');
  list.forEach((st, i) => dots.append(make('i', i <= here ? 'f' : '')));
  stage.append(dots, make('span', 'ph1-word', at || ''));
  stage.addEventListener('click', () => popMenu(stage, list.map((st) => ({ label: st, current: st === at, run: () => setStage(piece, st) }))));
  path.append(stage);
  const nl = nextLabel(list, at);
  if (nl) {
    const next = make('button', 'ph1-next', `→ ${nl}`);
    next.type = 'button';
    next.addEventListener('click', () => setStage(piece, list[here + 1]));
    path.append(next);
  }
  const words = make('span', 'ph1-words');
  path.append(words);
  stats(piece).then((s) => { if (s.words) words.textContent = `${s.words.toLocaleString()} word${s.words === 1 ? '' : 's'}`; }).catch(() => {});

  // The whole thing in a sentence.
  const sentence = make('p', 'ph1-sentence', dev.sentence || '');
  sentence.contentEditable = 'plaintext-only';
  sentence.dataset.placeholder = 'The whole thing in a sentence';
  sentence.setAttribute('aria-label', 'The whole thing in a sentence');
  sentence.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sentence.blur(); } });
  keeper(sentence, () => saveDev(piece.id, { sentence: sentence.textContent.trim() }));

  // More ▸: the rest of Develop.
  const open = more();
  const fold = make('button', 'ph1-more', open ? 'More ▾' : 'More ▸');
  fold.type = 'button';
  fold.setAttribute('aria-expanded', String(open));
  fold.title = 'A paragraph, who’s in it, one page';
  const rest = make('div', 'ph1-dev');
  rest.hidden = !open;
  fold.addEventListener('click', () => {
    const on = rest.hidden;
    rest.hidden = !on;
    setMore(on);
    fold.textContent = on ? 'More ▾' : 'More ▸';
    fold.setAttribute('aria-expanded', String(on));
  });
  const area = (key, label, rows) => {
    const wrap = make('label', 'ph1-field');
    wrap.append(make('span', 'panel-label', label));
    const ta = make('textarea', 'st-ta');
    ta.rows = rows;
    ta.value = dev[key] || '';
    ta.setAttribute('aria-label', label);
    keeper(ta, () => saveDev(piece.id, { [key]: ta.value }));
    wrap.append(ta);
    return wrap;
  };
  rest.append(area('paragraph', 'One paragraph', 4));
  // Who's in it: what each one wants, what stops them, what they learn.
  const people = make('div', 'ph1-people');
  people.append(make('span', 'panel-label', 'Who’s in it'));
  const rows = make('div', 'st-people');
  const fields = [['name', 'Name'], ['wants', 'Wants'], ['against', 'What stops them'], ['learns', 'What they learn']];
  const personRow = (pp, i) => {
    const row = make('div', 'st-person');
    for (const [k, ph] of fields) {
      const inp = make('input', 'st-input');
      inp.value = pp[k] || '';
      inp.placeholder = ph;
      inp.setAttribute('aria-label', ph);
      keeper(inp, async () => {
        const fresh = (await getEntry(piece.id)).fields?.develop?.people || [];
        await saveDev(piece.id, { people: fresh.map((x, j) => (j === i ? { ...x, [k]: inp.value } : x)) });
      });
      row.append(inp);
    }
    return row;
  };
  (dev.people || []).forEach((pp, i) => rows.append(personRow(pp, i)));
  const add = make('button', 'ghost-btn', '+ Someone');
  add.type = 'button';
  add.addEventListener('click', async () => {
    const fresh = (await getEntry(piece.id)).fields?.develop?.people || [];
    await saveDev(piece.id, { people: [...fresh, { name: '', wants: '', against: '', learns: '' }] });
    rows.append(personRow({}, fresh.length));
    rows.lastChild.querySelector('input')?.focus();
  });
  people.append(rows, add);
  rest.append(people, area('page', 'One page', 8));
  // Claude's help to grow each step still lives on the Develop page.
  const grow = make('button', 'ghost-btn ph1-grow', 'Grow it with Claude ›');
  grow.type = 'button';
  grow.title = 'The Develop page: Claude grows each step into the next';
  grow.addEventListener('click', () => go({ view: 'stage', id: piece.id, page: 'shape' }));
  rest.append(grow);

  box.append(eye, name, path, sentence, fold, rest);
  return box;
}
