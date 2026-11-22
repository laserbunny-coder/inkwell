// The plan in a novel (Nov 20 2026, Part 3 of the plan under the scene line).
// The chapter's name sits at the top of the chapter (it is part of the book,
// so it always shows); a tap on it unfolds the chapter's plan: its summary,
// one line per story thread, and lines under any of them. A scene break
// (· · ·) unfolds its own plan the same way, for a chapter that needs more
// detail. Everything is kept where the plot grid already reads it:
//   - the chapter's summary is the chapter's fields.synopsis, its thread
//     lines are notes on the chapter (the grid's chapter row);
//   - a scene break's title and summary are the break's own, its thread lines
//     are notes on the break (the grid's scene row).
// Typing "# " at the start of an empty paragraph makes a scene break with
// the caret in its title (Ctrl + Shift + Enter still makes one too).
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { plain as make } from './dom.js';
import { ScenePlan } from './sceneplan.js';

const NOVEL = new PluginKey('novelPlan');

// The scene breaks in a chapter, in order.
export function breaksOf(doc) {
  const out = [];
  doc.forEach((node, pos) => {
    if (node.type.name !== 'sceneBreak' || !node.attrs.eid) return;
    out.push({ eid: node.attrs.eid, pos, at: pos, node, title: node.attrs.title || '', synopsis: node.attrs.synopsis || '' });
  });
  return out;
}

// "Chapter 3" over the chapter's own name, unless its name already says so.
export function chapterLabel(ch, n, word = 'Chapter') {
  const title = (ch?.title || '').trim();
  const plain = new RegExp(`^${word}\\s+\\d+$`, 'i').test(title);
  return { over: plain || !n ? '' : `${word} ${n}`, title: title || `${word} ${n || ''}`.trim() };
}

export class NovelPlan extends ScenePlan {
  // hooks: those of ScenePlan, plus
  //   on()            a novel's chapter is open in Write
  //   chapter()       the chapter entry ({ id, title, fields })
  //   chapterN()      its number in the book, from 1
  //   chapterWord()   what the book calls a chapter
  //   saveChapter(fn)  keeps a change to the chapter: fn(fresh) gives what changes
  //   head()          the element at the top of the page that holds the chapter's name
  constructor(hooks) {
    super(hooks);
    this.hooks.steady ||= (change) => change();
  }

  // ---------- where things are kept ----------

  find(ref) {
    const ch = this.hooks.chapter();
    if (ch && ref.eid === ch.id) return { eid: ch.id, at: 0, chapter: true, title: ch.title || '', synopsis: ch.fields?.synopsis || '' };
    return breaksOf(this.editor.state.doc).find((b) => b.eid === ref.eid) || null;
  }
  anchor(ref) { return this.find(ref); }
  keyOf(s) { return s.eid; }
  putTitle(sc, v) {
    if (sc.chapter) { if (v) this.hooks.saveChapter(() => ({ title: v })); return; }
    this.setAttr(sc, { title: v });
  }
  putSummary(sc, v) {
    if (sc.chapter) {
      this.hooks.saveChapter((fresh) => {
        const { synopsis: _s, ...fields } = fresh.fields || {};
        return { fields: v ? { ...fields, synopsis: v } : fields };
      });
      return;
    }
    this.setAttr(sc, { synopsis: v });
  }
  setAttr(sc, attrs) {
    const { state } = this.editor;
    const node = state.doc.nodeAt(sc.pos);
    if (node?.type.name !== 'sceneBreak') return;
    this.editor.view.dispatch(state.tr.setNodeMarkup(sc.pos, undefined, { ...node.attrs, ...attrs }));
  }
  words(s) {
    if (s.chapter) {
      const word = this.hooks.chapterWord();
      return { title: `${word} name`, titleAria: `${word} name`, sum: `What happens in this ${word.toLowerCase()}` };
    }
    return { title: 'Name this scene (only you see it)', titleAria: 'Scene title (only you see it)', sum: 'What happens in this scene' };
  }

  // ---------- drawing ----------

  redrawDoc() {
    if (this.editor.isDestroyed) return;
    this.editor.view.dispatch(this.editor.state.tr.setMeta(NOVEL, { redraw: true }).setMeta('addToHistory', false));
    for (const el of this.editor.view.dom.querySelectorAll('.scene-break[data-eid]')) el.classList.toggle('open', this.hooks.on() && this.isOpen(el.dataset.eid));
    this.drawHead();
  }

  // The chapter's name at the top of the page; a tap unfolds its plan.
  drawHead() {
    const box = this.hooks.head();
    if (!box) return;
    const ch = this.hooks.on() ? this.hooks.chapter() : null;
    box.hidden = !ch;
    box.replaceChildren();
    if (!ch) return;
    const k = ch.id;
    const open = this.isOpen(k);
    const { over, title } = chapterLabel(ch, this.hooks.chapterN(), this.hooks.chapterWord());
    box.dataset.key = k;
    box.classList.toggle('open', open);
    const b = make('button', 'nv-ch');
    b.type = 'button';
    b.setAttribute('aria-expanded', String(open));
    if (!this.hooks.touch()) b.title = open ? 'Fold the plan' : 'The plan for this chapter: summary and threads';
    if (over) b.append(make('span', 'nv-cn', over));
    b.append(make('span', 'nv-ct', title));
    b.addEventListener('click', () => this.toggle({ eid: k, key: k }));
    box.append(b);
    if (open) {
      const plan = this.planBlock({ eid: k, at: 0, chapter: true, title: ch.title || '', synopsis: ch.fields?.synopsis || '' });
      // The chapter's name is the line above: no second title field.
      plan.querySelector('.wv-p-title')?.remove();
      box.append(plan);
    }
  }

  // The caret goes back into the words: after the scene break, or to the top.
  backToText(ref) {
    if (this.hooks.touch()) { document.activeElement?.blur(); return; }
    const s = this.find(ref);
    if (!s || s.chapter) { this.editor.commands.focus('start', { scrollIntoView: false }); return; }
    this.editor.commands.focus(Math.min(s.pos + s.node.nodeSize + 1, this.editor.state.doc.content.size), { scrollIntoView: false });
  }

  // A search result in a plan: that plan unfolded, in view.
  showPlan(eid) {
    super.showPlan(eid);
    requestAnimationFrame(() => document.querySelector(`.nv-head[data-key="${CSS.escape(eid)}"]`)?.scrollIntoView({ block: 'center' }));
  }

  // Thread lines on the chapter or a scene break live in its plan, not the margin.
  inPlan(note) {
    if (!note.fields?.thread || !this.hooks.on()) return false;
    if (note.parent_id === this.hooks.chapter()?.id) return true;
    return breaksOf(this.editor.state.doc).some((b) => b.eid === note.parent_id);
  }
}

// The plan unfolded under each open scene break, and "# " for a new one.
export const NovelPlanLines = Extension.create({
  name: 'novelPlan',
  priority: 120,
  addOptions() { return { plan: null, on: () => false }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    const plan = () => (typeof opts.plan === 'function' ? opts.plan() : opts.plan);
    return [new Plugin({
      key: NOVEL,
      props: {
        decorations(state) {
          const p = plan();
          if (!p || !opts.on()) return null;
          const decos = [];
          for (const b of breaksOf(state.doc)) {
            const open = p.isOpen(b.eid);
            if (!open) continue;
            const key = `nv:${b.eid}:${p.version(b.eid)}:${b.title}:${b.synopsis}`;
            decos.push(Decoration.widget(b.pos + b.node.nodeSize, () => {
              const dom = make('div', 'nv-plan');
              dom.contentEditable = 'false';
              dom.dataset.key = b.eid;
              dom.append(p.planBlock(b));
              return dom;
            }, { side: -1, key, ignoreSelection: true, stopEvent: () => true }));
          }
          return decos.length ? DecorationSet.create(state.doc, decos) : null;
        },
        handleTextInput(view, _from, _to, text) {
          const p = plan();
          if (text !== ' ' || !p || !opts.on()) return false;
          const { $from } = view.state.selection;
          const para = $from.parent;
          if (para.type.name !== 'paragraph' || para.textContent !== '#' || $from.depth !== 1) return false;
          const at = $from.before();
          const { schema } = view.state;
          view.dispatch(view.state.tr.replaceWith(at, at + para.nodeSize, [schema.nodes.sceneBreak.create(), schema.nodes.paragraph.create()]).scrollIntoView());
          p.openTitle(at);
          return true;
        }
      }
    })];
  }
});
