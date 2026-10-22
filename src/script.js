import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// Screenplays. A script is a chapter whose paragraphs each carry an element:
// scene heading, action, character, parenthetical, dialogue or transition.
// Enter and Tab move between elements the way script software does, and
// typing the way Fountain is written ("INT. HOUSE - DAY", a name in capitals)
// formats itself. Scripts go in and out as Fountain, the plain-text format
// every screenwriting app reads.

export const ELEMENTS = [
  { id: 'scene', label: 'Scene heading', short: 'Scene' },
  { id: 'action', label: 'Action' },
  { id: 'character', label: 'Character' },
  { id: 'paren', label: 'Parenthetical', short: 'Paren' },
  { id: 'dialogue', label: 'Dialogue' },
  { id: 'transition', label: 'Transition' }
];
export const elementLabel = (id) => ELEMENTS.find((e) => e.id === id)?.label || 'Action';

// What comes after each element when you press Enter.
const NEXT = { scene: 'action', action: 'action', character: 'dialogue', paren: 'dialogue', dialogue: 'action', transition: 'scene' };
// Tab steps through these; Shift+Tab goes back.
const CYCLE = ['action', 'character', 'dialogue', 'paren', 'transition', 'scene'];

const SCENE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const isCaps = (t) => /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t);
const isTransition = (t) => isCaps(t) && /TO:$/.test(t.trim());

// What a line typed as action really is, judged the Fountain way.
export function detect(text) {
  const t = text.trim();
  if (!t) return null;
  if (SCENE.test(t)) return 'scene';
  if (isTransition(t)) return 'transition';
  if (isCaps(t) && t.length <= 50 && !/[.!?:]$/.test(t)) return 'character';
  return null;
}

export const ScriptElements = Extension.create({
  name: 'scriptElements',
  addOptions() { return { isScript: () => false }; },
  addGlobalAttributes() {
    return [{
      types: ['paragraph'],
      attributes: {
        el: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-el'),
          renderHTML: (a) => (a.el ? { 'data-el': a.el } : {})
        }
      }
    }];
  },
  addKeyboardShortcuts() {
    const on = () => this.options.isScript() && this.editor.state.selection.$from.parent.type.name === 'paragraph';
    const current = () => this.editor.state.selection.$from.parent;
    const setEl = (el) => this.editor.commands.updateAttributes('paragraph', { el });
    const cycle = (dir) => {
      if (!on()) return false;
      const i = CYCLE.indexOf(current().attrs.el || 'action');
      return setEl(CYCLE[(i + dir + CYCLE.length) % CYCLE.length]);
    };
    return {
      Enter: () => {
        if (!on()) return false;
        const p = current();
        let el = p.attrs.el || 'action';
        if (!p.textContent.trim()) {
          // An empty line: step back to action rather than stacking blanks.
          if (el !== 'action') return setEl('action');
          return true;
        }
        if (el === 'action') {
          const seen = detect(p.textContent);
          if (seen) { setEl(seen); el = seen; }
        }
        const { $from } = this.editor.state.selection;
        const atEnd = $from.parentOffset === p.content.size;
        return this.editor.chain().splitBlock().updateAttributes('paragraph', { el: atEnd ? NEXT[el] : el }).scrollIntoView().run();
      },
      Tab: () => cycle(1),
      'Shift-Tab': () => cycle(-1)
    };
  },
  addProseMirrorPlugins() {
    const isScript = () => this.options.isScript();
    return [new Plugin({
      key: new PluginKey('scriptElements'),
      props: {
        handleTextInput(view, from, _to, text) {
          if (!isScript()) return false;
          const { $from } = view.state.selection;
          const p = $from.parent;
          // "# " at the start of a line starts a section: your own name for a
          // stretch of story, which can hold several INT./EXT. scenes.
          if (text === ' ' && p.type.name === 'paragraph' && p.textContent === '#' && $from.depth === 1) {
            const at = $from.before();
            const schema = view.state.schema;
            const tr = view.state.tr.replaceWith(at, at + p.nodeSize, [schema.nodes.sceneBreak.create(), schema.nodes.paragraph.create({ el: 'scene' })]);
            view.dispatch(tr);
            requestAnimationFrame(() => view.nodeDOM(at)?.querySelector?.('input')?.focus());
            return true;
          }
          // "(" on an empty dialogue line starts a parenthetical.
          if (text !== '(') return false;
          if (p.type.name !== 'paragraph' || p.content.size || !['dialogue', 'character'].includes(p.attrs.el)) return false;
          view.dispatch(view.state.tr.setNodeMarkup($from.before(), undefined, { ...p.attrs, el: 'paren' }).insertText('(', from));
          return true;
        }
      }
    })];
  }
});

// ---------- scene numbers ----------

// Scene numbers for production, given only when you ask ("Number the
// scenes"). Once a scene has one it keeps it for good, the way locked
// Hollywood scripts do, so file names and shot lists never point at the wrong
// scene: a scene added between 3 and 4 becomes 3A, one before 1 becomes A1,
// and new scenes at the end carry on from the highest number.

const CODE = /^([A-Z]*)(\d+)([A-Z]*)$/;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function codeOrder(a, b) {
  const x = CODE.exec(a);
  const y = CODE.exec(b);
  if (!x || !y) return String(a).localeCompare(String(b));
  return Number(x[2]) - Number(y[2]) || (x[1] ? 0 : 1) - (y[1] ? 0 : 1) || x[1].localeCompare(y[1]) || (x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0);
}
const highest = (codes) => codes.reduce((n, c) => Math.max(n, Number(CODE.exec(c)?.[2] || 0)), 0);

// codes: each scene's code (or null) in script order. before/after: the
// nearest codes in the chapters around this one; used: every code elsewhere.
// Returns the codes with every gap filled; a code used twice (a pasted scene)
// stays with the first and the copy gets its own.
export function assignCodes(codes, { before = null, after = null, used = [] } = {}) {
  const taken = new Set(used);
  const out = codes.map((c) => {
    if (!c || taken.has(c)) return null;
    taken.add(c);
    return c;
  });
  for (let i = 0; i < out.length; i++) {
    if (out[i]) continue;
    let prev = before;
    for (let j = i - 1; j >= 0; j--) if (out[j]) { prev = out[j]; break; }
    let next = after;
    for (let j = i + 1; j < out.length; j++) if (out[j]) { next = out[j]; break; }
    const fits = (c) => !taken.has(c) && (!prev || codeOrder(prev, c) < 0) && (!next || codeOrder(c, next) < 0);
    const tries = [];
    if (!next) tries.push(String(highest([...taken, ...(prev ? [prev] : [])]) + 1));
    if (prev) {
      const m = CODE.exec(prev);
      if (m?.[3]) { const last = m[3].slice(-1); const k = LETTERS.indexOf(last); for (const L of LETTERS.slice(k + 1)) tries.push(prev.slice(0, -1) + L); }
      for (const L of LETTERS) tries.push(prev + L);
    } else if (next) {
      const m = CODE.exec(next);
      if (m && !m[1]) for (const L of LETTERS) tries.push(L + m[2]);
    }
    let code = tries.find(fits);
    // Somewhere very crowded: any free code will do rather than none.
    for (let n = 0; !code; n++) if (!taken.has(`X${n}`)) code = `X${n}`;
    taken.add(code);
    out[i] = code;
  }
  return out;
}

// Keeps a numbered script numbered as you write: a new scene heading gets
// its code as soon as it's one. `numbering()` gives the chapters-around
// context, or null while the script isn't numbered.
export const NUMBER_SCENES = new PluginKey('numberScenes');
export const SceneCodes = Extension.create({
  name: 'sceneCodes',
  addOptions() { return { numbering: () => null }; },
  addGlobalAttributes() {
    return [{
      types: ['paragraph'],
      attributes: {
        code: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el) => el.getAttribute('data-code'),
          renderHTML: (a) => (a.code && a.el === 'scene' ? { 'data-code': a.code } : {})
        }
      }
    }];
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key: NUMBER_SCENES,
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged || tr.getMeta(NUMBER_SCENES))) return null;
        const ctx = opts.numbering();
        if (!ctx) return null;
        const scenes = [];
        // A scene heading gets its number once something is typed in it.
        state.doc.forEach((node, pos) => { if (node.type.name === 'paragraph' && node.attrs.el === 'scene' && node.textContent.trim()) scenes.push({ node, pos }); });
        const codes = assignCodes(scenes.map((s) => s.node.attrs.code), ctx);
        let tr = null;
        scenes.forEach((s, i) => {
          if (s.node.attrs.code === codes[i]) return;
          tr = tr || state.tr;
          tr.setNodeMarkup(s.pos, undefined, { ...s.node.attrs, code: codes[i] });
        });
        if (tr) tr.setMeta('addToHistory', false);
        return tr;
      }
    })];
  }
});

// Script lines at standard widths: [{ el, n }] where n is the line's length in characters.
const WIDTH = { scene: 60, action: 60, character: 38, paren: 25, dialogue: 35, transition: 60 };
const GAP = { scene: 2, action: 1, character: 1, paren: 0, dialogue: 0, transition: 1 };
export const LINES_PER_PAGE = 55;
export function scriptLines(items) {
  let lines = 0;
  for (const { el = 'action', n } of items) {
    if (!n) continue;
    const e = WIDTH[el] ? el : 'action';
    lines += GAP[e] + Math.ceil(n / WIDTH[e]);
  }
  return lines;
}

// Roughly how many script pages: 55 lines a page.
export function scriptPages(doc) {
  const items = [];
  doc.forEach((node) => { if (node.type.name === 'paragraph') items.push({ el: node.attrs.el || 'action', n: node.textContent.length }); });
  return Math.max(1, Math.round(scriptLines(items) / LINES_PER_PAGE));
}

// ---------- Fountain ----------

const plain = (content) => (content || []).map((n) => {
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'entryRef') return n.attrs?.title || '';
  let t = n.text || '';
  for (const m of n.marks || []) {
    if (m.type === 'bold') t = `**${t}**`;
    if (m.type === 'italic') t = `*${t}*`;
  }
  return t;
}).join('');

// rows: the script's paragraphs in order, as stored.
export function toFountain(title, rows) {
  const out = [];
  if (title) out.push(`Title: ${title}`, '');
  let prev = null;
  for (const r of rows) {
    if (r.kind === 'scene') { out.push('', `# ${r.title || 'Section'}`); prev = null; continue; }
    const el = r.fields?.el || 'action';
    const text = plain(r.content).trim();
    if (!text) continue;
    const joined = el === 'paren' || el === 'dialogue';
    if (!(joined && ['character', 'paren', 'dialogue'].includes(prev))) out.push('');
    // A numbered scene carries its number the Fountain way: INT. HOUSE - DAY #3A#
    if (el === 'scene') out.push((SCENE.test(text) ? text.toUpperCase() : `.${text.toUpperCase()}`) + (r.fields?.code ? ` #${r.fields.code}#` : ''));
    else if (el === 'character') out.push(text.toUpperCase());
    else if (el === 'paren') out.push(text.startsWith('(') ? text : `(${text})`);
    else if (el === 'dialogue') out.push(text);
    else if (el === 'transition') out.push(isTransition(text.toUpperCase()) ? text.toUpperCase() : `> ${text.toUpperCase()}`);
    else out.push(detect(text) ? `!${text}` : text);
    prev = el;
  }
  return out.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// Fountain text to { title, lines: [{ el, text }] }. Notes, sections and
// synopses are left out; everything you'd see on the page comes in.
export function fromFountain(src) {
  let text = src.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, '');
  let title = '';
  const titlePage = text.match(/^(?:[A-Za-z][A-Za-z ]*:.*\n?(?:[ \t]+.*\n?)*)+\n/);
  if (titlePage && /^title:/im.test(titlePage[0])) {
    title = (titlePage[0].match(/^title:[ \t]*(.*)$/im)?.[1] || '').replace(/[_*]/g, '').trim();
    text = text.slice(titlePage[0].length);
  }
  const lines = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    const all = block.split('\n').filter((l) => l.trim());
    // Sections (# Title) come in as sections; synopses (= …) are left out.
    while (all.length && /^\s*#/.test(all[0])) lines.push({ el: 'section', text: all.shift().replace(/^\s*#+\s*/, '').trim() });
    const rows = all.filter((l) => !/^\s*(#|=(?!=))/.test(l));
    if (!rows.length) continue;
    const first = rows[0].trim();
    if (/^===+$/.test(first)) continue;
    // A scene number (#3A#) comes in as the scene's code.
    const scene = (t) => { const m = t.match(/\s+#([^#\s]+)#$/); lines.push({ el: 'scene', text: t.replace(/\s+#[^#]+#$/, ''), ...(m ? { code: m[1].toUpperCase() } : {}) }); };
    if (/^\.[^.]/.test(first)) { scene(first.slice(1).trim()); continue; }
    if (SCENE.test(first) && rows.length === 1) { scene(first); continue; }
    if (/^>/.test(first) && !/<$/.test(first)) { lines.push({ el: 'transition', text: first.slice(1).trim() }); continue; }
    if (rows.length === 1 && isTransition(first)) { lines.push({ el: 'transition', text: first }); continue; }
    const name = first.startsWith('@') ? first.slice(1).trim() : first.replace(/\s*\^$/, '');
    if (rows.length > 1 && !first.startsWith('!') && (first.startsWith('@') || isCaps(name.replace(/\(.*?\)/g, '')))) {
      lines.push({ el: 'character', text: name });
      let speech = [];
      const say = () => { if (speech.length) lines.push({ el: 'dialogue', text: speech.join(' ') }); speech = []; };
      for (const r of rows.slice(1)) {
        const t = r.trim();
        if (/^\(.*\)$/.test(t)) { say(); lines.push({ el: 'paren', text: t }); } else speech.push(t);
      }
      say();
      continue;
    }
    for (const r of rows) {
      const t = r.trim().replace(/^!/, '').replace(/^>\s*(.*?)\s*<$/, '$1');
      lines.push({ el: 'action', text: t });
    }
  }
  return { title, lines };
}
