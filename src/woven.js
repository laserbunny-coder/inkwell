import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, NodeSelection, Selection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { detect } from './script.js';

// Woven: a screenplay written as flowing prose. There are no INT./EXT. lines
// on the page. A faint line marks each new scene, with your own title on it
// if you want one, and the place and time live underneath as a hidden scene
// heading: an ordinary scene-heading paragraph that Woven doesn't show. So
// the Classic view, Fountain, the PDF, scene numbers, shots, the breakdown
// and call sheets all keep working exactly as they do for any script.
//
// The hidden heading is guessed from your words while you write ("Night. The
// bakery is dark…" → INT. BAKERY - NIGHT), from the places in the world's
// bible and the ones the script already uses. A guess is only ever a guess:
// once you set a scene by hand (the dot in the margin, a slash mark, or by
// typing the heading in Classic), it is yours and is never guessed again.
//
// Titles are the script's own lowest sections (a "Scene" section, level 3,
// Fountain's ###) sitting right above the heading, so they show in the
// sidebar and the plot grid and go out to Fountain like every section.

export const WOVEN = new PluginKey('woven');
export const TITLE_LEVEL = 3;

// ---------- scene headings as data ----------

const TIME_WORDS = ['DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING', 'DAWN', 'DUSK', 'SUNRISE', 'SUNSET', 'MIDNIGHT', 'NOON', 'LATER', 'MOMENTS LATER', 'CONTINUOUS', 'SAME TIME', 'LATE NIGHT', 'NEXT DAY', 'NEXT MORNING', 'MAGIC HOUR', 'GOLDEN HOUR'];
export const TIME_CHOICES = ['DAY', 'NIGHT', 'MORNING', 'EVENING', 'DAWN', 'DUSK', 'LATER'];
export const KINDS = [
  { id: 'cut', label: 'Cut', about: 'a new scene' },
  { id: 'continuous', label: 'Continuous', about: 'straight on from the last one' },
  { id: 'intercut', label: 'Intercut', about: 'two places at once' },
  { id: 'flashback', label: 'Flashback', about: 'the past' },
  { id: 'montage', label: 'Montage', about: 'a run of moments' }
];
const isTime = (s) => { const t = (s || '').trim(); return TIME_WORDS.includes(t) || /\bLATER$/.test(t); };
const IE_RE = /^(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.|EXT\.|EST\.|INT\b|EXT\b)\s*/i;
const normIE = (s) => {
  const t = s.toUpperCase().replace(/\s+/g, '');
  if (/\//.test(t)) return 'INT./EXT.';
  if (t.startsWith('EST')) return 'EST.';
  return t.startsWith('EXT') ? 'EXT.' : 'INT.';
};

// A scene heading's text → { ie, place, time, kind, place2 }. Anything it
// doesn't say is ''.
export function parseSlug(text) {
  let t = (text || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const m = { ie: '', place: '', time: '', kind: 'cut', place2: '' };
  if (!t) return m;
  if (/\(FLASHBACK\)$/.test(t)) { m.kind = 'flashback'; t = t.replace(/\s*\(FLASHBACK\)$/, ''); }
  if (/^MONTAGE\b/.test(t)) { m.kind = 'montage'; m.place = t.replace(/^MONTAGE\s*(?:[-–—]\s*)?/, '').trim(); return m; }
  const inter = /^INTERCUT\b/.test(t);
  if (inter) { m.kind = 'intercut'; t = t.replace(/^INTERCUT\s*(?:[-–—]\s*)?/, ''); }
  const ie = t.match(IE_RE);
  if (ie) { m.ie = normIE(ie[1]); t = t.slice(ie[0].length); }
  if (/^[-–—]\s*/.test(t)) { const rest = t.replace(/^[-–—]\s*/, ''); if (isTime(rest)) { m.time = rest; t = ''; } else t = rest; }
  const parts = t.split(/\s+[-–—]\s+/);
  if (parts.length > 1 && isTime(parts.at(-1))) m.time = parts.pop().trim();
  const place = parts.join(' - ').trim().replace(/\s*[-–—]$/, '');
  if (inter) { const [a, b] = place.split(/\s*\/\s*/); m.place = (a || '').trim(); m.place2 = (b || '').trim(); } else m.place = place;
  if (m.time === 'CONTINUOUS' && m.kind === 'cut') m.kind = 'continuous';
  return m;
}

// { ie, place, time, kind, place2 } → the scene heading Classic shows.
export function buildSlug(m) {
  const up = (s) => (s || '').trim().toUpperCase();
  const place = up(m.place);
  const time = m.kind === 'continuous' ? 'CONTINUOUS' : up(m.time);
  if (m.kind === 'montage') return place ? `MONTAGE - ${place}` : 'MONTAGE';
  let s = m.kind === 'intercut'
    ? `INTERCUT - ${[place, up(m.place2)].filter(Boolean).join(' / ')}`.replace(/ - $/, '')
    : [up(m.ie), place].filter(Boolean).join(' ');
  if (time) s = s ? `${s} - ${time}` : `- ${time}`;
  if (m.kind === 'flashback') s = `${s} (FLASHBACK)`;
  return s.trim();
}

// What's still missing before a scene can be scheduled.
export function missing(m, places = []) {
  if (m.kind === 'montage') return [];
  const notime = places.find((p) => p.slug === m.place)?.notime;
  const out = [];
  if (!m.place) out.push('place');
  if (m.kind === 'intercut' && !m.place2) out.push('place2');
  if (!m.time && !notime && m.kind !== 'continuous') out.push('time');
  if (!m.ie && !notime && m.kind !== 'intercut') out.push('ie');
  return out;
}

// ---------- guessing from the words ----------

const TIMES = [
  [/^(the next morning|next morning)\b/i, 'MORNING'], [/^(early morning|this morning|that morning|morning)\b/i, 'MORNING'],
  [/^(late that night|later that night|that night|tonight|midnight|night)\b/i, 'NIGHT'], [/^(moments later|a moment later)\b/i, 'MOMENTS LATER'],
  [/^(later that day|later)\b/i, 'LATER'], [/^(that afternoon|this afternoon|afternoon)\b/i, 'AFTERNOON'],
  [/^(that evening|this evening|evening)\b/i, 'EVENING'], [/^(dawn|sunrise|first light)\b/i, 'DAWN'], [/^(dusk|sunset|twilight)\b/i, 'DUSK'],
  [/^(the next day|next day|noon|midday)\b/i, 'DAY'],
  [/^((\w+|a few) (years|months|weeks|days) (ago|earlier)|years ago|long ago|once upon a time)\b/i, 'PAST'],
  [/^(back to now|back in the present|present day)\b/i, 'NOW'], [/^(meanwhile)\b/i, 'SAME TIME']
];
export const findTime = (text) => { const t = (text || '').trim(); for (const [re, v] of TIMES) if (re.test(t)) return v; return null; };
const firstSentence = (t) => (t.match(/^[^.!?:]*[.!?:]?/) || [''])[0];
// The bit of a paragraph that says where we are: its first sentence, or the
// first two when the first is just a time ("Night. The bakery is dark.").
const placeText = (t) => {
  const f = firstSentence(t);
  return findTime(t) && f.split(/\s+/).length <= 4 ? f + (t.slice(f.length).match(/^[^.!?:]*[.!?:]?/) || [''])[0] : f;
};
const EXT_WORDS = /\b(street|alley|road|roof|rooftops?|park|beach|forest|woods|field|garden|yard|parking|outside|sidewalk|courtyard|bridge|river|lake|mountain|desert|playground|porch|driveway|square|market|harbou?r|dock|sky|cliff|meadow)\b/i;
const INT_WORDS = /\b(kitchen|room|office|bedroom|bathroom|hallway|hall|house|apartment|flat|bakery|shop|store|restaurant|caf[eé]|bar|dojo|classroom|car|inside|studio|garage|basement|attic|lobby|elevator|church|temple|library|gym|hospital|station|counter|warehouse)\b/i;
const ieFromWords = (s) => (EXT_WORDS.test(s) ? 'EXT.' : INT_WORDS.test(s) ? 'INT.' : '');

// Known places: { slug, ie, also: [words that mean it], notime }.
export function placeList(biblePlaces = [], doc = null) {
  const out = [];
  const add = (p) => {
    const slug = (p.slug || p.name || '').trim().toUpperCase();
    if (!slug) return;
    const have = out.find((x) => x.slug === slug);
    // "BAKERY - FRONT COUNTER" is also just "the bakery".
    const head = slug.includes(' - ') ? slug.split(' - ')[0].toLowerCase() : '';
    const also = [...new Set([slug.toLowerCase(), slug.toLowerCase().replace(/^the /, ''), ...(head ? [head] : []), ...(p.also || []).map((a) => a.toLowerCase().trim()).filter(Boolean)])];
    if (have) { have.also = [...new Set([...have.also, ...also])]; have.ie ||= p.ie || ''; have.notime ||= !!p.notime; return; }
    out.push({ slug, ie: p.ie || '', also, notime: !!p.notime, page: p.page || null });
  };
  biblePlaces.forEach(add);
  add({ slug: 'TALKING HEAD', also: ['straight to camera', 'talking head', 'to camera', 'to the camera', 'confessional'], notime: true });
  // Guessed headings don't count: a half-typed guess would otherwise stick.
  if (doc) doc.forEach((n) => { if (n.type.name === 'paragraph' && n.attrs.el === 'scene' && !n.attrs.guess) { const m = parseSlug(n.textContent); if (m.place) add({ slug: m.place, ie: m.ie }); if (m.place2) add({ slug: m.place2 }); } });
  return out;
}

export function findPlace(text, places) {
  const s = ` ${(text || '').toLowerCase()} `;
  let best = null;
  for (const p of places) for (const a of p.also) {
    if (a.length < 3) continue;
    const re = new RegExp(`[^\\p{L}\\p{N}]${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\p{L}\\p{N}]`, 'u');
    const m = re.exec(s);
    if (m && (!best || m.index < best.i || (m.index === best.i && a.length > best.a.length))) best = { p, i: m.index, a };
  }
  return best?.p || null;
}

// "Out in the alley, …", "Morning at the bakery counter." → ALLEY, BAKERY COUNTER.
const NOUN = /\b(?:in|into|inside|at|on|onto|outside|through|across|behind|under|up in|down in|out in|back in|back at|over at)\s+(?:the|a|an|his|her|their|our|my|its)\s+([a-z][a-z'’-]*(?:\s+[a-z][a-z'’-]*){0,2}?)(?=\s*[,.;:!?]|\s+(?:is|are|was|were|where|as|and|with|when|while|of|for|to|he|she|they|we|it)\b|\s*$)/i;
export function nounPlace(text) {
  const m = NOUN.exec(text || '');
  if (!m) return '';
  const words = m[1].trim();
  if (/^(morning|night|evening|afternoon|day|time|moment|end|middle|way|dark|light|rain)$/i.test(words)) return '';
  return words.toUpperCase();
}

// A guess at one scene's heading from its first words and the scene before.
export function guessScene(text, prev, places) {
  const t = (text || '').trim();
  if (!t) return null;
  const time = findTime(t);
  const where = placeText(t);
  let place = findPlace(where, places);
  const m = { ie: '', place: '', time: '', kind: time === 'PAST' ? 'flashback' : 'cut', place2: '' };
  if (!place && prev?.place && ['LATER', 'MOMENTS LATER'].includes(time)) place = places.find((p) => p.slug === prev.place) || { slug: prev.place, ie: prev.ie };
  // No known place: the words often say it anyway ("out in the alley").
  if (!place) { const named = nounPlace(where); if (named) place = { slug: named, ie: '' }; }
  if (place) { m.place = place.slug; m.ie = place.notime ? '' : (place.ie || ieFromWords(place.slug) || ieFromWords(where)); }
  if (time && !['PAST', 'NOW'].includes(time)) m.time = time;
  if (!m.place && !m.time && m.kind === 'cut') return null;
  return m;
}

// ---------- the scenes in a chapter ----------

// Each scene: where its hidden heading is (pos, node; null for the opening
// stretch of a chapter that has none yet), its title section, its first words.
export function scenesOf(doc) {
  const nodes = [];
  doc.forEach((node, pos) => nodes.push({ node, pos }));
  const out = [];
  let cur = null;
  const titleBefore = (k) => {
    const b = nodes[k - 1];
    return b && b.node.type.name === 'sceneBreak' && (b.node.attrs.level || 1) >= TITLE_LEVEL ? b : null;
  };
  nodes.forEach(({ node, pos }, k) => {
    const para = node.type.name === 'paragraph';
    if (para && node.attrs.el === 'scene') {
      const t = titleBefore(k);
      cur = { pos, node, eid: node.attrs.eid, at: pos, title: t?.node.attrs.title || '', titlePos: t ? t.pos : null, first: '', names: [], size: 0, text: '' };
      out.push(cur);
      return;
    }
    if (!cur) {
      if (!para || !node.textContent.trim()) return;
      const t = titleBefore(k);
      cur = { pos: null, node: null, eid: null, at: pos, title: t?.node.attrs.title || '', titlePos: t ? t.pos : null, first: '', names: [], size: 0, text: '' };
      out.push(cur);
    }
    if (!para) return;
    const el = node.attrs.el || 'action';
    const text = node.textContent.trim();
    cur.size += text.length;
    if (text && cur.text.length < 1500) cur.text += `${el === 'dialogue' || el === 'paren' ? '    ' : ''}${text}\n`;
    if (!cur.first && el === 'action' && text) cur.first = text;
    if (el === 'character' && text) cur.names.push(text.replace(/\s*\(.*\)$/, '').toUpperCase());
  });
  out.forEach((s, i) => { s.n = i + 1; s.marker = parseSlug(s.node?.textContent || ''); });
  return out;
}

// The scene the caret is in.
export function sceneAt(doc, pos) {
  let found = null;
  for (const s of scenesOf(doc)) if (s.at <= pos || (s.titlePos !== null && s.titlePos <= pos)) found = s;
  return found;
}

// New slug texts for the scenes whose headings are still guesses.
function guessesFor(doc, places) {
  const out = [];
  let prev = null;
  for (const s of scenesOf(doc)) {
    if (!s.node) continue;
    const text = s.node.textContent;
    const guessing = !text.trim() || s.node.attrs.guess;
    if (guessing) {
      const g = guessScene(s.first, prev, places);
      const slug = g ? buildSlug(g) : '';
      if (slug !== text) out.push({ pos: s.pos, node: s.node, slug });
      prev = g || prev;
    } else prev = s.marker;
  }
  return out;
}

// Writes a scene heading's text, keeping or clearing "guessed".
export function writeSlug(tr, pos, slug, guess) {
  const node = tr.doc.nodeAt(pos);
  if (!node) return tr;
  const schema = tr.doc.type.schema;
  tr.replaceWith(pos + 1, pos + 1 + node.content.size, slug ? schema.text(slug) : []);
  tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos).attrs, guess: guess ? true : null });
  return tr;
}

// ---------- the editor side ----------

const isPara = (n) => n?.type.name === 'paragraph';
const hiddenAt = (doc, pos) => {
  const n = doc.nodeAt(pos);
  if (!n) return false;
  if (isPara(n) && n.attrs.el === 'scene') return true;
  if (n.type.name === 'sceneBreak' && (n.attrs.level || 1) >= TITLE_LEVEL) {
    const next = doc.nodeAt(pos + n.nodeSize);
    return isPara(next) && next.attrs.el === 'scene';
  }
  return false;
};

// Inserts a new scene line at a doc-level position, and an empty action line
// after it when nothing follows. Returns the transaction, caret on the words.
function sceneLineAt(state, at, { withLine = false } = {}) {
  const { schema } = state;
  const tr = state.tr;
  const nodes = [schema.nodes.paragraph.create({ el: 'scene', guess: true })];
  if (withLine) nodes.push(schema.nodes.paragraph.create({ el: 'action' }));
  tr.insert(at, nodes);
  const caret = at + nodes[0].nodeSize + 1;
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size))));
  return tr;
}

// Ctrl+Shift+Enter (and the phone's Scene button): a new scene from here.
export function newScene(editor) {
  const { state } = editor;
  const { $from } = state.selection;
  if ($from.depth < 1) return false;
  const p = $from.parent;
  const start = $from.before(1);
  const end = $from.after(1);
  const prevNode = start > 0 ? state.doc.resolve(start).nodeBefore : null;
  let tr;
  if (!p.isTextblock) tr = sceneLineAt(state, end, { withLine: true });
  else if (!p.textContent.trim()) {
    if (isPara(prevNode) && prevNode.attrs.el === 'scene') return true;
    tr = state.tr.setNodeMarkup(start, undefined, { ...p.attrs, el: 'scene', guess: true, code: null });
    tr.insert(start + p.nodeSize, state.schema.nodes.paragraph.create({ el: 'action' }));
    tr.setSelection(TextSelection.create(tr.doc, start + p.nodeSize + 1));
  } else if ($from.parentOffset === 0) {
    if (isPara(prevNode) && prevNode.attrs.el === 'scene') return true;
    tr = sceneLineAt(state, start);
  } else if ($from.parentOffset === p.content.size) tr = sceneLineAt(state, end, { withLine: true });
  else {
    // In the middle of a line: split it, and the line goes between the halves.
    tr = state.tr.split($from.pos);
    const at = $from.pos + 1;
    tr.insert(at, state.schema.nodes.paragraph.create({ el: 'scene', guess: true }));
    tr.setSelection(TextSelection.create(tr.doc, at + 3));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

// Takes a scene line away (and its title), joining the scene to the one before.
export function removeScene(editor, pos) {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!isPara(node) || node.attrs.el !== 'scene') return false;
  const before = pos > 0 ? state.doc.resolve(pos).nodeBefore : null;
  const from = before?.type.name === 'sceneBreak' && (before.attrs.level || 1) >= TITLE_LEVEL ? pos - before.nodeSize : pos;
  const tr = state.tr.delete(from, pos + node.nodeSize);
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from + 1, tr.doc.content.size)), 1));
  editor.view.dispatch(tr);
  return true;
}

// Gives a scene a heading paragraph if it has none yet (the opening stretch
// of a chapter), so it has somewhere to keep its place and time. Returns its pos.
export function ensureHeading(editor, scene) {
  if (scene.node) return scene.pos;
  const at = scene.titlePos !== null ? scene.titlePos + editor.state.doc.nodeAt(scene.titlePos).nodeSize : scene.at;
  const tr = editor.state.tr.insert(at, editor.state.schema.nodes.paragraph.create({ el: 'scene', guess: true }));
  editor.view.dispatch(tr);
  return at;
}

export function setTitle(editor, scenePos, title) {
  const { state } = editor;
  const t = (title || '').trim();
  const before = scenePos > 0 ? state.doc.resolve(scenePos).nodeBefore : null;
  const has = before?.type.name === 'sceneBreak' && (before.attrs.level || 1) >= TITLE_LEVEL;
  let tr = state.tr;
  if (has && !t) tr = tr.delete(scenePos - before.nodeSize, scenePos);
  else if (has) { if (before.attrs.title === t) return; tr = tr.setNodeMarkup(scenePos - before.nodeSize, undefined, { ...before.attrs, title: t }); }
  else if (t) tr = tr.insert(scenePos, state.schema.nodes.sceneBreak.create({ level: TITLE_LEVEL, title: t }));
  else return;
  editor.view.dispatch(tr);
}

export function setMarker(editor, scenePos, marker) {
  const tr = writeSlug(editor.state.tr, scenePos, buildSlug(marker), false);
  tr.setMeta(WOVEN, { set: true });
  editor.view.dispatch(tr);
}

const statusOf = (s, places) => (!s.node || !s.node.textContent.trim() ? 'missing' : missing(s.marker, places).length ? 'missing' : s.node.attrs.guess ? 'guess' : 'set');

// The faint line, the title on it, and the dot in the margin.
function lineWidget(s, places, opts) {
  const status = statusOf(s, places);
  const code = s.node?.attrs.code || '';
  const slug = s.node?.textContent || '';
  const label = s.title ? `${code || s.n} · ${s.title}` : `${code || s.n} · name it`;
  const key = `wv:${s.eid || `top${s.at}`}:${slug}:${s.title}:${s.n}:${status}:${code}:${s.marker.kind}`;
  const make = () => {
    const dom = document.createElement('div');
    dom.className = `wv-line${s.node ? '' : ' wv-top'}${s.title ? '' : ' untitled'}`;
    dom.contentEditable = 'false';
    dom.dataset.status = status;
    dom.dataset.kind = s.marker.kind;
    if (s.eid) dom.dataset.eid = s.eid;
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'wv-dot';
    dot.tabIndex = -1;
    dot.setAttribute('aria-label', `Scene ${code || s.n}: ${slug || 'place and time not set'}. Change it`);
    dot.title = slug || 'Place and time not set yet';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'wv-title';
    title.tabIndex = -1;
    title.textContent = label;
    title.setAttribute('aria-label', s.title ? `Scene title: ${s.title}. Rename it` : 'Name this scene');
    for (const b of [dot, title]) b.addEventListener('mousedown', (e) => e.preventDefault());
    dot.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); opts.onDot?.({ eid: s.eid, at: s.at }, dot, false); });
    title.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); opts.onDot?.({ eid: s.eid, at: s.at }, title, true); });
    dom.append(dot, title);
    return dom;
  };
  return Decoration.widget(s.node ? s.pos : s.at, make, { side: -1, key, ignoreSelection: true, stopEvent: () => true });
}

// Finds a scene again after the doc has changed: by its heading's id, or the
// opening stretch at the top.
export function findScene(doc, ref) {
  const all = scenesOf(doc);
  return (ref.eid && all.find((s) => s.eid === ref.eid)) || (!ref.eid && all.find((s) => !s.node)) || null;
}

const NEXT = { character: 'dialogue', paren: 'dialogue', dialogue: 'character', action: 'action', transition: 'action', scene: 'action' };

export const Woven = Extension.create({
  name: 'woven',
  priority: 110,
  addOptions() {
    return { isWoven: () => false, busy: () => false, places: () => [], onDot: null, onBlocked: null };
  },
  addGlobalAttributes() {
    return [{
      types: ['paragraph'],
      attributes: {
        guess: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el) => (el.getAttribute('data-guess') ? true : null),
          renderHTML: (a) => (a.guess && a.el === 'scene' ? { 'data-guess': '1' } : {})
        }
      }
    }];
  },
  addKeyboardShortcuts() {
    const ed = () => this.editor;
    const on = () => this.options.isWoven() && !this.options.busy(ed().view) && ed().state.selection.empty && ed().state.selection.$from.depth === 1 && isPara(ed().state.selection.$from.parent);
    const here = () => { const { $from } = ed().state.selection; return { $from, p: $from.parent, start: $from.before(1), el: $from.parent.attrs.el || 'action' }; };
    const setEl = (el, text) => {
      const { p, start } = here();
      const tr = ed().state.tr.setNodeMarkup(start, undefined, { ...p.attrs, el, guess: null });
      if (text !== undefined) {
        tr.replaceWith(start + 1, start + 1 + p.content.size, text ? ed().state.schema.text(text) : []);
        tr.setSelection(TextSelection.create(tr.doc, start + 1 + (text === '()' ? 1 : text.length)));
      }
      ed().view.dispatch(tr.scrollIntoView());
      return true;
    };
    // A line after this one, of this element, caret in it.
    const lineAfter = (el, text = '') => {
      const { p, start } = here();
      const at = start + p.nodeSize;
      const node = ed().state.schema.nodes.paragraph.create({ el }, text ? ed().state.schema.text(text) : null);
      const tr = ed().state.tr.insert(at, node);
      tr.setSelection(TextSelection.create(tr.doc, at + 1 + (text === '()' ? 1 : text.length)));
      ed().view.dispatch(tr.scrollIntoView());
      return true;
    };
    const hop = (dir, edge) => {
      if (!on()) return false;
      const { state, view } = ed();
      if (!view.endOfTextblock(edge)) return false;
      const $f = state.selection.$from;
      const doc = state.doc;
      let pos = dir < 0 ? $f.before(1) : $f.after(1);
      let skipped = false;
      if (dir < 0) {
        for (;;) {
          const before = pos > 0 ? doc.resolve(pos).nodeBefore : null;
          if (!before || !hiddenAt(doc, pos - before.nodeSize)) break;
          pos -= before.nodeSize; skipped = true;
        }
      } else {
        while (pos < doc.content.size && hiddenAt(doc, pos)) { pos += doc.nodeAt(pos).nodeSize; skipped = true; }
      }
      if (!skipped) return false;
      const next = Selection.findFrom(doc.resolve(pos), dir, true);
      if (!next) return true;
      view.dispatch(state.tr.setSelection(dir < 0 ? TextSelection.create(doc, next.$from.end()) : TextSelection.create(doc, next.$from.start())).scrollIntoView());
      return true;
    };
    return {
      Enter: () => {
        if (!on()) return false;
        const { $from, p, start, el } = here();
        const text = p.textContent;
        if (el === 'paren') {
          // Enter anywhere in a parenthetical closes it and goes on to the words.
          const t = text.trim();
          if (!t || t === '()') return setEl('dialogue', '');
          const tr = ed().state.tr;
          if (!text.startsWith('(')) tr.insertText('(', start + 1);
          if (!text.endsWith(')')) tr.insertText(')', start + 1 + tr.doc.nodeAt(start).content.size);
          const at = start + tr.doc.nodeAt(start).nodeSize;
          tr.insert(at, ed().state.schema.nodes.paragraph.create({ el: 'dialogue' }));
          tr.setSelection(TextSelection.create(tr.doc, at + 1));
          ed().view.dispatch(tr.scrollIntoView());
          return true;
        }
        if (!text.trim()) {
          // An empty name: back to what we see. Empty words: how they say it.
          // An empty line of action: the scene ends here.
          if (el === 'character' || el === 'transition') return setEl('action');
          if (el === 'dialogue') return setEl('paren', '()');
          return newScene(ed());
        }
        let now = el;
        if (el === 'action') {
          const seen = detect(text);
          if (seen === 'scene') {
            // Typed as a heading (INT. KITCHEN - DAY): it becomes this scene's hidden one.
            const tr = ed().state.tr.setNodeMarkup(start, undefined, { ...p.attrs, el: 'scene', guess: null });
            tr.insert(start + p.nodeSize, ed().state.schema.nodes.paragraph.create({ el: 'action' }));
            tr.setSelection(TextSelection.create(tr.doc, start + p.nodeSize + 1));
            ed().view.dispatch(tr.scrollIntoView());
            return true;
          }
          if (seen) { now = seen; ed().view.dispatch(ed().state.tr.setNodeMarkup(start, undefined, { ...p.attrs, el: seen })); }
        }
        const atEnd = $from.parentOffset === p.content.size;
        return ed().chain().splitBlock().updateAttributes('paragraph', { el: atEnd ? NEXT[now] || 'action' : now }).scrollIntoView().run();
      },
      Tab: () => {
        if (!on()) return false;
        const { p, el } = here();
        const empty = !p.textContent.trim();
        if (el === 'action') return setEl('character');
        if (el === 'character') return empty ? setEl('action') : lineAfter('paren', '()');
        if (el === 'dialogue') return empty ? setEl('paren', '()') : lineAfter('paren', '()');
        if (el === 'paren') return setEl('dialogue');
        return setEl('action');
      },
      'Shift-Tab': () => (on() ? setEl('action') : false),
      // The arrows step over a hidden heading the way they'd step over a blank line.
      ArrowLeft: () => hop(-1, 'left'),
      ArrowUp: () => hop(-1, 'up'),
      ArrowRight: () => hop(1, 'right'),
      ArrowDown: () => hop(1, 'down'),
      'Mod-Shift-Enter': () => (this.options.isWoven() ? newScene(ed()) : false),
      Backspace: () => {
        if (!on()) return false;
        const { $from, start } = here();
        if ($from.parentOffset !== 0 || start === 0) return false;
        const before = ed().state.doc.resolve(start).nodeBefore;
        if (!isPara(before) || before.attrs.el !== 'scene') return false;
        // Backspace at the start of a scene's first line takes the line away.
        if (before.attrs.code) { this.options.onBlocked?.(`Scene ${before.attrs.code} is numbered for production, so its line stays. Turn the numbers off first to join it to the scene before.`); return true; }
        return removeScene(ed(), start - before.nodeSize);
      }
    };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key: WOVEN,
      state: {
        init: () => ({ v: 0 }),
        apply: (tr, v) => (tr.getMeta(WOVEN)?.redraw ? { v: v.v + 1 } : v)
      },
      appendTransaction(trs, old, state) {
        const ours = trs.every((t) => t.getMeta(WOVEN));
        let tr = null;
        // Typing a heading by hand (in Classic) makes it yours: no more guessing.
        if (!ours && trs.some((t) => t.docChanged)) {
          const $was = old.selection.$from;
          if ($was.depth === 1 && isPara($was.parent) && $was.parent.attrs.el === 'scene' && $was.parent.attrs.guess) {
            const pos = trs.reduce((p, t) => t.mapping.map(p), $was.before(1));
            const n = state.doc.nodeAt(pos);
            if (isPara(n) && n.attrs.guess) tr = state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, guess: null });
          }
        }
        if (!opts.isWoven()) return tr;
        const full = trs.some((t) => t.getMeta(WOVEN)?.full);
        if (full || (!ours && trs.some((t) => t.docChanged))) {
          const doc = tr ? tr.doc : state.doc;
          const changes = guessesFor(doc, opts.places(doc));
          if (changes.length) {
            tr = tr || state.tr;
            const base = tr.steps.length;
            for (const c of changes.reverse()) writeSlug(tr, tr.mapping.slice(base).map(c.pos), c.slug, true);
          }
        }
        // There's always a line to write on after the last scene line.
        if (full) {
          const d = tr ? tr.doc : state.doc;
          const last = d.lastChild;
          if (isPara(last) && last.attrs.el === 'scene') {
            tr = tr || state.tr;
            tr.insert(d.content.size, state.schema.nodes.paragraph.create({ el: 'action' }));
            if (hiddenAt(tr.doc, tr.selection.$from.depth ? tr.selection.$from.before(1) : 0)) tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
          }
        }
        // The caret never rests in a hidden heading or title: step over it.
        const doc = tr ? tr.doc : state.doc;
        const sel = tr ? tr.selection : state.selection;
        const at = sel instanceof NodeSelection ? sel.from : sel.empty && sel.$from.depth === 1 ? sel.$from.before(1) : null;
        if (at !== null && hiddenAt(doc, at)) {
          const dir = sel.head >= old.selection.head ? 1 : -1;
          let pos = at;
          while (hiddenAt(doc, pos) && pos < doc.content.size) pos += doc.nodeAt(pos).nodeSize;
          let next = dir > 0 || at === 0 ? Selection.findFrom(doc.resolve(pos), 1, true) : null;
          if (!next) next = Selection.findFrom(doc.resolve(at), -1, true);
          if (!next) next = Selection.findFrom(doc.resolve(pos), 1, true);
          if (next && !hiddenAt(doc, next.$from.depth ? next.$from.before(1) : next.from)) {
            tr = tr || state.tr;
            tr.setSelection(next);
          }
        }
        if (tr) tr.setMeta(WOVEN, { auto: true });
        return tr;
      },
      props: {
        decorations(state) {
          if (!opts.isWoven()) return null;
          const places = opts.places(state.doc);
          const decos = scenesOf(state.doc).map((s) => lineWidget(s, places, opts));
          return DecorationSet.create(state.doc, decos);
        }
      }
    })];
  }
});

// Runs the guessing over a whole chapter just opened (not part of undo).
export function guessAll(editor) {
  editor.view.dispatch(editor.state.tr.setMeta(WOVEN, { full: true, redraw: true }).setMeta('addToHistory', false));
}
export function redraw(editor) {
  editor.view.dispatch(editor.state.tr.setMeta(WOVEN, { redraw: true }).setMeta('addToHistory', false));
}

// ---------- the dot's card: place, time, kind, title ----------

const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-/])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

// One card at a time. It stays open while you pick (so several things can be
// filled in one go) and closes with Done, Esc or a click outside.
export class ScenePop {
  constructor(hooks) {
    this.hooks = hooks; // { editor, places(), toast(), numbered() }
    this.el = make('div', 'wv-pop');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Scene');
    this.el.hidden = true;
    document.body.append(this.el);
    this.ref = null;
    document.addEventListener('mousedown', (e) => { if (!this.el.hidden && e.target.isConnected && !this.el.contains(e.target) && !e.target.closest?.('.wv-line')) this.close(); }, true);
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(true); } });
  }

  get editor() { return this.hooks.editor(); }
  get isOpen() { return !this.el.hidden; }

  scene() { return this.ref ? findScene(this.editor.state.doc, this.ref) : null; }

  open(ref, anchor, focusTitle = false) {
    this.ref = ref;
    this.anchor = anchor;
    this.render();
    this.el.hidden = false;
    this.place();
    requestAnimationFrame(() => {
      const f = focusTitle ? this.el.querySelector('.wv-pop-title') : this.el.querySelector('.wv-pop-place');
      f?.focus(); if (focusTitle) f?.select();
    });
  }

  close(refocus = false) {
    if (this.el.hidden) return;
    this.el.querySelectorAll('input').forEach((i) => i.dispatchEvent(new Event('change')));
    this.el.hidden = true;
    this.ref = null;
    if (refocus) this.editor.commands.focus();
  }

  place() {
    const r = this.anchor?.getBoundingClientRect?.();
    const w = Math.min(340, innerWidth - 24);
    this.el.style.width = `${w}px`;
    const left = r ? Math.max(12, Math.min(innerWidth - w - 12, r.left - 8)) : 12;
    let top = r ? r.bottom + 8 : 80;
    const h = this.el.offsetHeight || 380;
    if (top + h > innerHeight - 12) top = Math.max(12, (r ? r.top - h - 8 : 12));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  // The heading for this scene, made if it's the chapter's opening stretch.
  pos() {
    const s = this.scene();
    if (!s) return null;
    if (s.node) return s.pos;
    const at = ensureHeading(this.editor, s);
    this.ref = { eid: this.editor.state.doc.nodeAt(at)?.attrs.eid || null, at };
    return at;
  }

  set(patch) {
    const pos = this.pos();
    if (pos === null) return;
    const s = this.scene();
    const m = { ...(s?.marker || parseSlug('')), ...patch };
    if (patch.kind === 'continuous' && !m.place) {
      // Straight on: same place as the scene before.
      const all = scenesOf(this.editor.state.doc);
      const i = all.findIndex((x) => x.pos === pos);
      const prev = all[i - 1]?.marker;
      if (prev?.place) { m.place = prev.place; m.ie ||= prev.ie; }
    }
    if (patch.kind && patch.kind !== 'continuous' && s?.marker.kind === 'continuous') m.time = '';
    setMarker(this.editor, pos, m);
    this.render();
  }

  render() {
    const s = this.scene();
    if (!s) { this.close(); return; }
    const m = s.marker;
    const places = this.hooks.places();
    const el = this.el;
    el.replaceChildren();
    const head = make('div', 'wv-pop-head');
    head.append(make('span', 'wv-pop-n', `Scene ${s.node?.attrs.code || s.n}`), make('span', 'wv-pop-slug', s.node?.textContent || 'Place and time not set yet'));
    if (s.node?.attrs.guess) head.append(make('span', 'wv-pop-guess', 'guessed from your words'));
    el.append(head);

    const title = make('input', 'wv-pop-title');
    title.placeholder = 'Title (only you see it)';
    title.setAttribute('aria-label', 'Scene title');
    title.value = s.title;
    title.addEventListener('change', () => { if (title.value.trim() === (this.scene()?.title || '')) return; const p = this.pos(); if (p !== null) setTitle(this.editor, p, title.value); });
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.dispatchEvent(new Event('change')); this.close(true); } });
    el.append(title);

    const chips = (label, items, cur, pick) => {
      const row = make('div', 'wv-pop-row');
      row.append(make('span', 'wv-pop-label', label));
      const box = make('div', 'wv-chips');
      for (const it of items) {
        const b = make('button', 'wv-chip', it.label);
        b.type = 'button';
        if (it.about) b.title = it.about;
        b.classList.toggle('current', it.id === cur);
        b.setAttribute('aria-pressed', String(it.id === cur));
        b.addEventListener('click', () => pick(it.id === cur && it.toggle ? '' : it.id));
        box.append(b);
      }
      row.append(box);
      el.append(row);
      return row;
    };
    const kind = m.kind;
    chips('Kind', KINDS, kind, (id) => this.set({ kind: id || 'cut' }));
    const placeRow = make('div', 'wv-pop-row');
    placeRow.append(make('span', 'wv-pop-label', kind === 'intercut' ? 'Places' : 'Place'));
    const listId = 'wv-places';
    let dl = document.getElementById(listId);
    if (!dl) { dl = make('datalist'); dl.id = listId; document.body.append(dl); }
    dl.replaceChildren(...places.filter((p) => p.slug !== 'TALKING HEAD' || true).map((p) => { const o = make('option'); o.value = titleCase(p.slug); return o; }));
    const field = (cls, value, key) => {
      const i = make('input', cls);
      i.setAttribute('list', listId);
      i.placeholder = key === 'place2' ? 'The other place' : 'Where we are';
      i.setAttribute('aria-label', key === 'place2' ? 'Second place' : 'Place');
      i.value = value ? titleCase(value) : '';
      i.addEventListener('change', () => {
        const v = i.value.trim().toUpperCase();
        if (v === (this.scene()?.marker[key] || '')) return;
        const known = places.find((p) => p.slug === v);
        const patch = { [key]: v };
        if (key === 'place' && known && !this.scene()?.marker.ie) patch.ie = known.notime ? '' : known.ie;
        this.set(patch);
      });
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.dispatchEvent(new Event('change')); } });
      return i;
    };
    placeRow.append(field('wv-pop-place', m.place, 'place'));
    if (kind === 'intercut') placeRow.append(field('wv-pop-place2', m.place2, 'place2'));
    el.append(placeRow);
    if (kind !== 'montage' && kind !== 'intercut') chips('Inside?', [{ id: 'INT.', label: 'Inside' }, { id: 'EXT.', label: 'Outside' }, { id: 'INT./EXT.', label: 'Both' }].map((x) => ({ ...x, toggle: true })), m.ie, (id) => this.set({ ie: id }));
    if (kind !== 'montage' && kind !== 'continuous') {
      const times = [...TIME_CHOICES, ...(m.time && !TIME_CHOICES.includes(m.time) ? [m.time] : [])];
      chips('Time', times.map((t) => ({ id: t, label: titleCase(t), toggle: true })), m.time, (id) => this.set({ time: id }));
    }
    const lack = missing(m, places).filter((x) => x !== 'place2');
    const foot = make('div', 'wv-pop-foot');
    if (lack.length) foot.append(make('span', 'wv-pop-lack', `Still to say: ${lack.map((x) => ({ place: 'where', time: 'when', ie: 'inside or out' }[x])).join(', ')}. Prepare for shoot can fill it in.`));
    if (s.node) {
      const rm = make('button', 'wv-pop-remove', 'Join to the scene before');
      rm.type = 'button';
      rm.addEventListener('click', () => {
        if (s.node.attrs.code) { this.hooks.toast(`Scene ${s.node.attrs.code} is numbered for production, so its line stays.`); return; }
        this.close();
        removeScene(this.editor, s.pos);
        this.hooks.toast('Scene line taken away', { label: 'Undo', run: () => this.editor.chain().focus().undo().run() });
      });
      foot.append(rm);
    }
    const done = make('button', 'pill wv-pop-done', 'Done');
    done.type = 'button';
    done.addEventListener('click', () => this.close(true));
    foot.append(done);
    el.append(foot);
    if (!el.hidden) this.place();
  }
}
