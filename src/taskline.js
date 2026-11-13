// A task where it's written. Any line in an outline can be a task (Ctrl +
// Shift + Enter): it gets a box to tick and, after its words, a small quiet
// label saying which day it's planned for and how long it should take. Click
// the label to change either. What makes a line a task is kept beside its
// words (see tasks.js), not in the text, so the label here is only drawn.
//
// The same pass marks loose lines (see loose.js): ones on a day's page that
// haven't been filed yet get a ring where their bullet is.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration } from '@tiptap/pm/view';
import { lineDecos } from './linedecos.js';

export const taskKey = new PluginKey('taskLine');

export const TaskLine = Extension.create({
  name: 'taskLine',
  // task(eid) → the line's task fields or null; label(task) → the words on
  // the label; onChip(eid, el) → the label was clicked; onToggle(eid) → Ctrl +
  // Shift + Enter on a line; loose(eid) → is this line still unfiled (only
  // asked for lines straight on the page).
  addOptions() { return { task: () => null, label: () => '', onChip: () => {}, onToggle: () => {}, loose: () => false }; },
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-Enter': () => {
        const { $head } = this.editor.state.selection;
        for (let d = $head.depth; d > 0; d--) {
          if ($head.node(d).type.name === 'listItem') { const eid = $head.node(d).attrs.eid; if (eid) this.options.onToggle(eid); return true; }
        }
        return false;
      }
    };
  },
  addProseMirrorPlugins() {
    const { task, label, onChip, loose } = this.options;
    // Line by line, so a key press redraws only the lines it touched; new task
    // details or filing redraw them all (redrawTasks).
    const make = (node, pos, state) => {
      const decos = [];
      if (!node.firstChild || !node.attrs.eid) return decos;
      const t = task(node.attrs.eid);
      if (!t) {
        // doc > list > item: only lines straight on the page can be loose.
        if (state.doc.resolve(pos).depth === 1 && loose(node.attrs.eid)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-loose' }));
        return decos;
      }
      const words = label(t, !!node.attrs.done);
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-task' }));
      const end = pos + 1 + node.firstChild.nodeSize - 1;
      decos.push(Decoration.widget(end, () => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'task-chip';
        b.tabIndex = -1;
        b.contentEditable = 'false';
        b.dataset.eid = node.attrs.eid;
        b.textContent = words;
        b.title = 'A task: click to change its day or how long it takes';
        return b;
      }, { side: 1, key: `t-${node.attrs.eid}-${words}`, ignoreSelection: true }));
      return decos;
    };
    const chip = (event) => event.target.closest?.('.task-chip');
    return [new Plugin({
      key: taskKey,
      state: lineDecos({ key: taskKey, make, rebuild: (tr) => !!tr.getMeta(taskKey) }),
      props: {
        decorations(state) { return this.getState(state).set; },
        handleDOMEvents: {
          pointerdown(_view, event) { if (!chip(event)) return false; event.preventDefault(); return true; },
          mousedown(_view, event) { if (!chip(event)) return false; event.preventDefault(); return true; },
          click(_view, event) {
            const b = chip(event);
            if (!b) return false;
            event.preventDefault();
            onChip(b.dataset.eid, b);
            return true;
          }
        }
      }
    })];
  }
});

// Draw the labels and rings again: a task or a line's filing changed somewhere other than in the words.
export const redrawTasks = (editor) => editor.view.dispatch(editor.state.tr.setMeta(taskKey, true).setMeta('addToHistory', false));
