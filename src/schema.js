import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { newId } from './model.js';

const BLOCKS = ['paragraph', 'heading', 'sceneBreak'];

// Gives every paragraph a stable id so it can be stored, linked, tagged and
// noted as its own entry. Splitting a paragraph keeps the id on the first half;
// the new half gets a fresh one.
export const EntryIds = Extension.create({
  name: 'entryIds',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        eid: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-eid'),
          renderHTML: (attrs) => (attrs.eid ? { 'data-eid': attrs.eid } : {})
        }
      }
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('entryIds'),
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null;
        const seen = new Set();
        let tr = null;
        state.doc.forEach((node, pos) => {
          if (!BLOCKS.includes(node.type.name)) return;
          const id = node.attrs.eid;
          if (!id || seen.has(id)) {
            tr = tr || state.tr;
            const fresh = newId(node.type.name === 'sceneBreak' ? 'sc' : 'pa');
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, eid: fresh });
            seen.add(fresh);
          } else {
            seen.add(id);
          }
        });
        if (tr) tr.setMeta('addToHistory', false);
        return tr;
      }
    })];
  }
});

// A soft divider between scenes inside a continuous chapter. Its title is
// optional and editable in place.
export const SceneBreak = Node.create({
  name: 'sceneBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      eid: { default: null, parseHTML: (el) => el.getAttribute('data-eid'), renderHTML: (a) => (a.eid ? { 'data-eid': a.eid } : {}) },
      title: { default: '', parseHTML: (el) => el.getAttribute('data-title') || '', renderHTML: (a) => ({ 'data-title': a.title }) }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-scene-break]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-scene-break': '', class: 'scene-break' }), '· · ·'];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'scene-break';
      dom.contentEditable = 'false';
      dom.dataset.eid = node.attrs.eid || '';
      const dots = document.createElement('span');
      dots.textContent = '·  ·  ·';
      dots.setAttribute('aria-hidden', 'true');
      const input = document.createElement('input');
      input.className = 'scene-title';
      // In a script this is a section: your own name for a stretch of story.
      input.placeholder = document.documentElement.classList.contains('script') ? 'Section title' : 'scene';
      input.setAttribute('aria-label', 'Scene title');
      input.value = node.attrs.title;
      input.addEventListener('change', () => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...editor.view.state.doc.nodeAt(pos).attrs, title: input.value.trim() }));
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); editor.commands.focus(); }
      });
      dom.append(dots, input);
      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'sceneBreak') return false;
          dom.dataset.eid = updated.attrs.eid || '';
          if (document.activeElement !== input) input.value = updated.attrs.title;
          return true;
        },
        stopEvent: (e) => e.target === input,
        ignoreMutation: () => true
      };
    };
  },
  addCommands() {
    return {
      insertSceneBreak: () => ({ commands }) => commands.insertContent([{ type: 'sceneBreak' }, { type: 'paragraph' }])
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-Enter': () => this.editor.commands.insertSceneBreak() };
  }
});
