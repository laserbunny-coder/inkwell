// The script bar: the element you're on in a script, and changing it.
import { keyboard } from '../keyboard.js';
import { media } from '../device.js';
import { flip, altsHere } from '../alts.js';
import { $, alts, body, captureHere, editor, insertSection, isScript, root, setElement, toggleFocus, writing } from '../main.js';
import { caretSoon, placeOutlineBar } from './notebookview.js';

// ---------- script bar ----------

// On a phone there's no Tab key, so a row of element buttons rides just above
// the keyboard while you write a script. Tapping one changes the line you're on.
// The alternates buttons sit at the far end of the same row (the whole row
// when it isn't a script), reached by scrolling it sideways.
let scriptBar; // set in wireScriptBar()
let touch; // set in wireScriptBar()
function placeScriptBar() {
  const script = isScript();
  const focus = root.classList.contains('focus');
  const withAlts = !root.classList.contains('hide-alts') && !focus;
  // Only while the keyboard is really up (keyboard.js). Focus with no script
  // leaves just the row's end: Focus, and the keyboard down.
  const show = touch.matches && keyboard.up && writing() && editor.isFocused;
  const back = show && scriptBar.hidden;
  scriptBar.hidden = !show;
  if (back) scriptBar.scrollLeft = 0; // a row that comes back starts with the mic in view
  scriptBar.classList.toggle('scripting', script);
  scriptBar.classList.toggle('only-end', focus && !script);
  scriptBar.querySelector('[data-end="focus"]').setAttribute('aria-pressed', String(focus));
  scriptBar.classList.toggle('no-alts', !withAlts);
  body.classList.toggle('script-bar-on', show);
  if (!show) return;
  const vv = window.visualViewport;
  const bottom = vv ? window.innerHeight - (vv.offsetTop + vv.height) : 0;
  scriptBar.style.bottom = `${Math.max(0, bottom)}px`;
  const p = editor.state.selection.$from.parent;
  const el = p.type.name === 'paragraph' ? p.attrs.el || 'action' : null;
  scriptBar.querySelectorAll('button[data-el]').forEach((b) => b.classList.toggle('current', b.dataset.el === el));
  if (!withAlts) return;
  const here = altsHere(editor.state);
  const button = (name) => scriptBar.querySelector(`[data-alt="${name}"]`);
  button('word').textContent = here.word ? `Alternates · ${here.word.n}` : 'Alternates';
  button('para').textContent = here.para ? `Paragraph ${here.para.i + 1} of ${here.para.n}` : 'Paragraph';
  button('word').classList.toggle('current', alts.isOpen && alts.scope === 'word');
  button('para').classList.toggle('current', alts.isOpen && alts.scope === 'para');
  for (const name of ['prev', 'next']) button(name).classList.toggle('idle', !here.word && !here.para);
}
// Types # or / at the caret, with a space before it if it would touch a word
// (the + on the phone rows types the / that opens the insert menu).
function typeHere(ed, ch) {
  const { $from } = ed.state.selection;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset);
  ed.chain().focus().insertContent(before && before !== ' ' ? ` ${ch}` : ch).run();
}

// The rows above the keyboard: a quick tap runs a button; holding (or sliding)
// scrolls the row instead, so a thumb resting on a button never sets it off.
// pointerdown is held back so the keyboard stays up.
const TAP_MS = 280;

// Room kept below the caret when the page scrolls to it: the row above the
// keyboard plus a line or so. (ProseMirror measures the visual viewport, which
// already ends at the keyboard, so the keyboard isn't counted again here.)
const ROOM_ABOVE = 60;
const ROOM_BELOW = 48;
let caretRoom; // set in wireScriptBar()

function tapBar(bar, selector, run) {
  let start = null;
  let hold = null;
  const end = () => { clearTimeout(hold); bar.classList.remove('holding'); };
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const b = e.target.closest(selector);
    start = b ? { b, x: e.clientX, y: e.clientY, t: performance.now(), left: bar.scrollLeft } : null;
    clearTimeout(hold);
    hold = setTimeout(() => bar.classList.add('holding'), TAP_MS);
  });
  bar.addEventListener('pointerup', (e) => {
    end();
    const s = start;
    start = null;
    if (!s) return;
    const tap = performance.now() - s.t < TAP_MS && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10 && Math.abs(bar.scrollLeft - s.left) < 4;
    if (tap) { run(s.b); caretSoon(80); }
  });
  bar.addEventListener('pointercancel', () => { end(); start = null; });
}
// The fixed end of both writing rows: Focus, and the keyboard down.
function rowEnd(what) {
  if (what === 'down') { keyboard.down(); return; }
  toggleFocus();
  placeScriptBar(); placeOutlineBar();
}

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wireScriptBar() {
  scriptBar = $('.script-bar');
  touch = media('touch');
  caretRoom = {
    top: ROOM_ABOVE, left: 5, right: 5,
    get bottom() {
      const bar = [scriptBar, $('.outline-bar')].find((b) => b && !b.hidden);
      return (bar ? bar.offsetHeight : 0) + ROOM_BELOW;
    }
  };
  tapBar(scriptBar, 'button[data-el], button[data-alt], button[data-ins], button[data-talk], button[data-end]', (b) => {
    if (b.dataset.end) return rowEnd(b.dataset.end);
    const what = b.dataset.alt;
    if (b.dataset.talk) captureHere({ start: true });
    else if (b.dataset.ins) typeHere(editor, '/');
    else if (what === 'word' || what === 'para') alts.toggle({ scope: what });
    else if (what === 'ask') {
      if (!alts.isOpen) alts.open({ scope: 'word' });
      alts.askClaude();
    } else if (what === 'prev' || what === 'next') flip(editor, what === 'prev' ? -1 : 1);
    else if (b.dataset.el === 'section') {
      insertSection(editor.state.selection.$from.before(1));
    } else setElement(b.dataset.el);
    placeScriptBar();
  });
  editor.on('transaction', placeScriptBar);
  editor.on('focus', placeScriptBar);
  editor.on('blur', () => setTimeout(placeScriptBar, 50));
  window.visualViewport?.addEventListener('resize', placeScriptBar);
  window.visualViewport?.addEventListener('scroll', placeScriptBar);
  // The rows follow the keyboard, not the caret.
  keyboard.onChange(() => { placeScriptBar(); placeOutlineBar(); });
}

export { ROOM_ABOVE, ROOM_BELOW, caretRoom, placeScriptBar, rowEnd, scriptBar, tapBar, touch, typeHere, wireScriptBar };
