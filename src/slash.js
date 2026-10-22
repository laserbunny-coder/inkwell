import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { keyLabel } from './keys.js';

// The / menu: type / at the start of a line or after a space and a small list
// of things to put in opens at the caret (the time, a date, a link, a tag…).
// Keep typing to narrow it; Enter or a tap picks, Esc or a space closes it.
// The caret never leaves the text, so on a phone the keyboard stays up.
// @ is left alone for mentions later.

export const slashKey = new PluginKey('slash');
const MATCH = /(?:^|\s)\/([\p{L}\p{N}]{0,20})$/u;

// main.js registers the list: (editor) => [{ id, label, hint, keys, words, more, run(editor) }].
// "more" items only show once something is typed (the weekdays, say).
let itemsFor = () => [];
export function setSlashItems(fn) { itemsFor = fn; }

const box = document.createElement('div');
box.className = 'slash';
box.setAttribute('role', 'listbox');
box.setAttribute('aria-label', 'Insert');
box.hidden = true;
const list = document.createElement('ul');
box.append(list);
document.body.append(box);

let shown = null; // { view, items, index, from, to }

function matches(items, q) {
  if (!q) return items.filter((it) => !it.more);
  const hit = (w) => w.toLowerCase().startsWith(q);
  const first = items.filter((it) => [it.id, ...(it.words || [])].some(hit));
  const rest = items.filter((it) => !first.includes(it) && it.label.toLowerCase().includes(q));
  return [...first, ...rest];
}

function render() {
  list.replaceChildren(...shown.items.map((it, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === shown.index));
    li.innerHTML = '<span class="label"></span><span class="hint"></span><span class="keys"></span>';
    li.querySelector('.label').textContent = it.label;
    li.querySelector('.hint').textContent = it.hint || '';
    li.querySelector('.keys').textContent = keyLabel(it.keys || '');
    // Held back so the caret (and a phone's keyboard) stays in the text.
    li.addEventListener('pointerdown', (e) => e.preventDefault());
    li.addEventListener('mousedown', (e) => e.preventDefault());
    li.addEventListener('click', () => pick(i));
    return li;
  }));
  list.children[shown.index]?.scrollIntoView({ block: 'nearest' });
}

function place(view, from) {
  const at = view.coordsAtPos(from);
  const vv = window.visualViewport;
  const bottom = vv ? vv.offsetTop + vv.height : innerHeight;
  const bar = [...document.querySelectorAll('.script-bar')].find((b) => !b.hidden);
  const floor = bottom - (bar ? bar.offsetHeight : 0) - 8;
  box.style.left = `${Math.max(8, Math.min(at.left, innerWidth - 288))}px`;
  const h = box.offsetHeight;
  box.style.top = `${at.bottom + 6 + h > floor ? Math.max(8, at.top - 6 - h) : at.bottom + 6}px`;
}

function hide() {
  box.hidden = true;
  shown = null;
}

function pick(i) {
  const s = shown;
  const it = s?.items[i];
  if (!it) return;
  const editor = s.view.__slashEditor;
  hide();
  editor.chain().focus().deleteRange({ from: s.from, to: s.to }).run();
  it.run(editor);
}

export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: slashKey,
      state: {
        init: () => ({ from: null, query: '', dismissed: null }),
        apply(tr, prev, _old, state) {
          const { $from, empty } = state.selection;
          const m = empty && $from.parent.isTextblock ? MATCH.exec($from.parent.textBetween(0, $from.parentOffset, null, '￼')) : null;
          if (!m) return { from: null, query: '', dismissed: null };
          const from = $from.pos - m[1].length - 1;
          const dismissed = tr.getMeta(slashKey) === 'dismiss' ? from : prev.dismissed === from ? from : null;
          // Opens only as you type the /, not when the caret wanders past an old one.
          const typed = tr.docChanged && !tr.getMeta('preventUpdate');
          const open = dismissed == null && (prev.from === from || (typed && m[1] === ''));
          return { from: open ? from : null, query: m[1].toLowerCase(), dismissed };
        }
      },
      view: (view) => {
        view.__slashEditor = editor;
        return {
          update(v) {
            const st = slashKey.getState(v.state);
            if (st.from == null || !v.hasFocus()) { if (shown?.view === v) hide(); return; }
            const items = matches(itemsFor(editor), st.query);
            if (!items.length) { if (shown?.view === v) hide(); return; }
            const same = shown?.view === v && shown.from === st.from;
            const was = same ? shown.query : null;
            shown = { view: v, items, index: same && was === st.query ? Math.min(shown.index, items.length - 1) : 0, from: st.from, to: v.state.selection.from, query: st.query };
            if (was === st.query && !box.hidden) return;
            box.hidden = false;
            render();
            place(v, st.from);
          },
          destroy() { if (shown?.view === view) hide(); }
        };
      },
      props: {
        handleKeyDown(view, e) {
          if (!shown || shown.view !== view || box.hidden) return false;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const n = shown.items.length;
            shown.index = (shown.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
            render();
            return true;
          }
          if (e.key === 'Enter' || e.key === 'Tab') { pick(shown.index); return true; }
          if (e.key === 'Escape') {
            hide();
            view.dispatch(view.state.tr.setMeta(slashKey, 'dismiss'));
            e.stopPropagation();
            return true;
          }
          return false;
        },
        handleDOMEvents: {
          blur(view) { setTimeout(() => { if (shown?.view === view && !view.hasFocus()) hide(); }, 100); return false; }
        }
      }
    })];
  }
});
