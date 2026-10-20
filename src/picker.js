import { byKind, putEntries } from './db.js';
import { entry, newId } from './model.js';
import { titleOf } from './notebook.js';

// The [[ link picker: a small list at the caret. Type to filter pages, days and
// chapters; Enter links the highlighted one, or makes a new page with that name.

const box = document.querySelector('.picker');
const input = box.querySelector('input');
const list = box.querySelector('ul');
let target = null;
let items = [];
let index = 0;
let all = [];

export async function openPicker(editor) {
  target = editor;
  const kinds = await Promise.all(['page', 'day', 'chapter'].map(byKind));
  all = kinds.flat().filter((e) => !e.deleted)
    .map((e) => ({ id: e.id, kind: e.kind, title: titleOf(e) }))
    .sort((a, b) => (a.kind === 'day' && b.kind === 'day' ? (a.id < b.id ? 1 : -1) : a.title.localeCompare(b.title)));
  const at = editor.view.coordsAtPos(editor.state.selection.from);
  box.style.left = `${Math.max(8, Math.min(at.left, innerWidth - 328))}px`;
  box.style.top = `${Math.min(at.bottom + 6, innerHeight - 280)}px`;
  box.hidden = false;
  input.value = '';
  filter();
  input.focus();
}

function filter() {
  const q = input.value.trim().toLowerCase();
  items = all.filter((e) => !q || e.title.toLowerCase().includes(q)).slice(0, 8);
  if (q && !all.some((e) => e.title.toLowerCase() === q)) items.push({ create: input.value.trim(), title: `New page “${input.value.trim()}”` });
  index = 0;
  render();
}

function render() {
  list.replaceChildren(...items.map((it, i) => {
    const li = document.createElement('li');
    li.setAttribute('aria-selected', String(i === index));
    li.innerHTML = '<span></span><span class="keys"></span>';
    li.firstChild.textContent = it.title;
    li.lastChild.textContent = it.create ? '' : it.kind;
    li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(it); });
    return li;
  }));
}

function close() {
  box.hidden = true;
  target?.commands.focus();
  target = null;
}

function pick(it) {
  const ed = target;
  if (!ed) return;
  target = null;
  box.hidden = true;
  let ref = it;
  if (it.create) {
    const page = entry('page', { id: newId('pg'), title: it.create });
    putEntries([page]);
    ref = { id: page.id, title: page.title };
  }
  // Insert straight away, so whatever is typed next follows the link.
  ed.chain().focus().insertContent([{ type: 'entryRef', attrs: { id: ref.id, title: ref.title } }, { type: 'text', text: ' ' }]).run();
}

input.addEventListener('input', filter);
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(index + 1, items.length - 1); render(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(index - 1, 0); render(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (items[index]) pick(items[index]); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
});
input.addEventListener('blur', () => setTimeout(() => { if (!box.hidden && document.activeElement !== input) close(); }, 100));
