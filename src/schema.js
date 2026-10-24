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
// optional and editable in place. In a script it's a section: your own name
// for a stretch of story above the INT./EXT. scene headings. Sections nest
// (act, then sequence, then your own named scenes, any depth: Fountain's
// #, ## and ###), and each can carry a one-line summary that the plot grid
// shows and that never prints.
export const SECTION_NAMES = ['Act', 'Sequence', 'Scene', 'Beat', 'Beat', 'Beat'];
export const MAX_LEVEL = 6;
export const sectionName = (level, names = SECTION_NAMES) => names[Math.min(level, names.length) - 1] || 'Section';

export const SceneBreak = Node.create({
  name: 'sceneBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() { return { names: () => SECTION_NAMES }; },
  addAttributes() {
    return {
      eid: { default: null, parseHTML: (el) => el.getAttribute('data-eid'), renderHTML: (a) => (a.eid ? { 'data-eid': a.eid } : {}) },
      title: { default: '', parseHTML: (el) => el.getAttribute('data-title') || '', renderHTML: (a) => ({ 'data-title': a.title }) },
      level: { default: 1, parseHTML: (el) => Number(el.getAttribute('data-level')) || 1, renderHTML: (a) => (a.level > 1 ? { 'data-level': a.level } : {}) },
      synopsis: { default: '', parseHTML: (el) => el.getAttribute('data-synopsis') || '', renderHTML: (a) => (a.synopsis ? { 'data-synopsis': a.synopsis } : {}) }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-scene-break]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-scene-break': '', class: 'scene-break' }), '· · ·'];
  },
  addNodeView() {
    const names = () => this.options.names();
    return ({ node, getPos, editor }) => {
      const script = () => document.documentElement.classList.contains('script');
      const dom = document.createElement('div');
      dom.className = 'scene-break';
      dom.contentEditable = 'false';
      dom.dataset.eid = node.attrs.eid || '';
      dom.dataset.level = node.attrs.level || 1;
      const dots = document.createElement('span');
      dots.textContent = '·  ·  ·';
      dots.setAttribute('aria-hidden', 'true');
      const input = document.createElement('input');
      input.className = 'scene-title';
      const named = (level) => {
        // In a script this is a section: your own name for a stretch of story.
        input.placeholder = script() ? `${sectionName(level, names())} title` : 'scene';
        input.setAttribute('aria-label', script() ? `${sectionName(level, names())} title` : 'Scene title');
      };
      named(node.attrs.level || 1);
      input.value = node.attrs.title;
      const summary = document.createElement('input');
      summary.className = 'scene-synopsis';
      summary.placeholder = 'What happens here (only you see this)';
      summary.setAttribute('aria-label', 'Summary');
      summary.value = node.attrs.synopsis || '';
      dom.classList.toggle('has-synopsis', !!summary.value);
      const set = (attrs) => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const now = editor.view.state.doc.nodeAt(pos).attrs;
        if (Object.keys(attrs).every((k) => now[k] === attrs[k])) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...now, ...attrs }));
      };
      input.addEventListener('change', () => set({ title: input.value.trim() }));
      summary.addEventListener('change', () => set({ synopsis: summary.value.trim() }));
      const leave = () => {
        // Back into the script just below the section.
        const pos = getPos();
        if (typeof pos === 'number') editor.commands.focus(pos + editor.view.state.doc.nodeAt(pos).nodeSize + 1);
        else editor.commands.focus();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.dispatchEvent(new Event('change')); leave(); }
        // Tab goes a level deeper (act, sequence, scene…), Shift+Tab back up.
        if (e.key === 'Tab' && script()) {
          e.preventDefault();
          const level = Math.max(1, Math.min(MAX_LEVEL, (editor.view.state.doc.nodeAt(getPos())?.attrs.level || 1) + (e.shiftKey ? -1 : 1)));
          set({ title: input.value.trim(), level });
          requestAnimationFrame(() => input.focus());
        }
        if (e.key === 'ArrowDown' && script()) { e.preventDefault(); summary.focus(); }
      });
      summary.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); summary.dispatchEvent(new Event('change')); leave(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); input.focus(); }
      });
      dom.append(dots, input, summary);
      return {
        dom,
        update(updated) {
          if (updated.type.name !== 'sceneBreak') return false;
          dom.dataset.eid = updated.attrs.eid || '';
          dom.dataset.level = updated.attrs.level || 1;
          named(updated.attrs.level || 1);
          if (document.activeElement !== input) input.value = updated.attrs.title;
          if (document.activeElement !== summary) summary.value = updated.attrs.synopsis || '';
          dom.classList.toggle('has-synopsis', !!(updated.attrs.synopsis || ''));
          return true;
        },
        stopEvent: (e) => e.target === input || e.target === summary,
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
