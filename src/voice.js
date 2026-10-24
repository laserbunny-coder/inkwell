import { Node, mergeAttributes } from '@tiptap/core';
import { putEntries, getEntry, children, getMeta, setMeta, CLAUDE } from './db.js';
import { entry, newId, tagsIn } from './model.js';
import { placeSorts, bySort } from './order.js';

// Walk-and-talk: what you say is written up in one of your modes (the same
// modes as Scribe, kept on your account, so one made in either app shows in
// both). Claude picks the mode after hearing it; a small chip on the line says
// which, and a tap on it shows the same words in another mode, or word for
// word. The word-for-word text is always kept.
//
// On a day page, a capture's line holds the recording, the time, the chip and
// the first paragraph; the rest go under it, with anything said as a note to
// self set apart. Every version made is kept on the line (fields.voice), so
// flipping back and forth costs nothing and keeps your edits.
//
// Aimed at a chapter, what you say goes straight into the draft as
// paragraphs, a paragraph per beat, each with what you really said one flip
// away as its other version, and notes to self in the margin.

// ---------- modes ----------

export const RAW = 'raw';
// Until the account's own modes have been fetched once.
const STARTER = [
  { id: 'text', name: 'Text message' }, { id: 'email', name: 'Email' }, { id: 'clean', name: 'Clean only' },
  { id: 'idea', name: 'Idea' }, { id: 'journal', name: 'Journal' }, { id: 'scene', name: 'Scene' }
];
export async function knownModes() { return (await getMeta('voiceModes')) || STARTER; }
export async function fetchModes(ask) {
  const out = await ask({ mode: 'voice-modes' });
  if (Array.isArray(out?.modes) && out.modes.length) await setMeta('voiceModes', out.modes);
  return knownModes();
}
export const modeName = async (id) => (id === RAW ? 'Word for word' : (await knownModes()).find((m) => m.id === id)?.name || 'Written up');

// The #tag a capture carries for its mode, so journaling doesn't land in #idea.
const MODE_TAGS = { idea: 'idea', journal: 'journal', scene: 'scene', text: 'message', email: 'message', clean: 'said', raw: 'said' };
export const tagForMode = (id, name = '') => MODE_TAGS[id] || name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'said';

// ---------- the chip ----------

// Set by the app: what a tap on a chip does (the line it's on, and the chip).
let chipHandler = () => {};
export function onVoiceChip(fn) { chipHandler = fn; }

export const VoiceChip = Node.create({
  name: 'voice',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      mode: { default: '', parseHTML: (el) => el.getAttribute('data-voice') || '', renderHTML: () => ({}) },
      name: { default: '', parseHTML: (el) => el.textContent || '', renderHTML: () => ({}) }
    };
  },
  // Not words: the chip never counts or shows in search text.
  extendNodeSchema(ext) { return ext.name === 'voice' ? { leafText: () => '' } : {}; },
  parseHTML() { return [{ tag: 'button[data-voice]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['button', mergeAttributes(HTMLAttributes, { 'data-voice': node.attrs.mode, class: 'voice-chip', type: 'button', contenteditable: 'false' }), node.attrs.name || 'Written up'];
  },
  renderText() { return ''; },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('button');
      dom.type = 'button';
      dom.className = 'voice-chip';
      dom.contentEditable = 'false';
      dom.dataset.voice = node.attrs.mode;
      dom.textContent = node.attrs.name || 'Written up';
      dom.title = 'How this was written up. Tap for other versions, or word for word';
      dom.addEventListener('mousedown', (e) => e.preventDefault());
      dom.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const host = dom.closest('[data-eid]')?.dataset.eid;
        if (host) chipHandler(host.replace(/-v0$/, ''), dom);
      });
      return { dom, ignoreMutation: () => true, stopEvent: (e) => e.type === 'click' || e.type === 'mousedown' };
    };
  }
});

// ---------- versions of a capture ----------

const textOf = (content) => (content || []).map((n) => (n.type === 'text' ? n.text : n.type === 'entryRef' ? n.attrs?.title || '' : '')).join('');
const TAILTAGS = /((?:\s+#[\p{L}\p{N}_-]+)+)\s*$/u;
const isVoiceKid = (id, line) => id.startsWith(`${line}-v`) || id.startsWith(`${line}-n`) || id.startsWith(`${line}-s`);
const rawVersion = (raw) => ({ blocks: raw.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((text) => ({ text, el: 'paragraph', new_scene: false })), notes: [] });
const sameVersion = (a, b) => JSON.stringify(a?.blocks?.map((x) => x.text) || []) === JSON.stringify(b?.blocks?.map((x) => x.text) || []) &&
  JSON.stringify(a?.notes?.map((x) => x.text) || []) === JSON.stringify(b?.notes?.map((x) => x.text) || []);
const NOTE = 'Note to self: ';

// The version showing now, read back from the page (with any edits made to it).
function readShowing(line, kids) {
  const v = line.fields.voice;
  const hostId = v.host || line.id;
  const host = hostId === line.id ? line : kids.find((k) => k.id === hostId);
  const content = host?.content || [];
  const at = content.findIndex((n) => n.type === 'voice');
  const first = textOf(content.slice(at + 1)).replace(TAILTAGS, '').trim();
  const blocks = first ? [{ text: first, el: 'paragraph', new_scene: false }] : [];
  const mine = kids.filter((k) => !k.deleted && isVoiceKid(k.id, line.id) && k.id !== hostId).sort(bySort);
  let scene = false;
  const notes = [];
  for (const k of mine) {
    if (k.id.startsWith(`${line.id}-s`)) { scene = true; continue; }
    if (k.id.startsWith(`${line.id}-n`)) { notes.push({ text: (k.text || '').replace(/^Note to self:\s*/i, '').trim(), after: Math.max(0, blocks.length - 1) }); continue; }
    if ((k.text || '').trim()) blocks.push({ text: k.text.trim(), el: 'paragraph', new_scene: scene });
    scene = false;
  }
  return { blocks, notes };
}

// Writes `version` onto the capture's line and the lines under it, in place
// of what was showing. Returns the rows to save.
function showVersion(line, kids, mode, name, version) {
  const now = Date.now();
  const v = line.fields.voice;
  const hostId = v.host || line.id;
  const rows = [];
  const [first, ...rest] = version.blocks.length ? version.blocks : [{ text: '', el: 'paragraph', new_scene: false }];
  const chip = { type: 'voice', attrs: { mode, name } };
  const kid = (id, text, sort, by) => {
    const prev = kids.find((k) => k.id === id);
    return { ...(prev || entry('line', { id })), kind: 'line', parent_id: line.id, sort, text, content: text ? [{ type: 'text', text }] : null, tags: tagsIn(text), links: [], deleted: false, updated_at: now, fields: { ...(prev?.fields || {}), done: false, gather: null, gathered: null, mirror: null }, ...(by ? { _by: by } : {}) };
  };
  const by = mode === RAW ? null : CLAUDE;
  // The line: everything up to the chip stays (the recording and its time), then
  // the first paragraph, then the tags it ends with (the mode's own swapped in).
  const oldTag = v.tag || 'idea';
  const newTag = tagForMode(mode, name);
  const fix = (tags) => (tags || '').replace(new RegExp(`(\\s)#${oldTag}(?=\\s|$)`, 'u'), `$1#${newTag}`);
  let line2 = line;
  const hostRow = hostId === line.id ? line : kids.find((k) => k.id === hostId);
  const was = hostRow?.content || [];
  const at = was.findIndex((n) => n.type === 'voice');
  const head = at >= 0 ? was.slice(0, at) : [];
  const tags = hostId === line.id ? fix(textOf(was.slice(at + 1)).match(TAILTAGS)?.[1] || ` #${newTag}`) : '';
  const content = [...head, chip, { type: 'text', text: ` ${first.text}${tags}` }];
  const hostText = textOf(content);
  const fields = { ...line.fields, voice: { ...v, mode, tag: hostId === line.id ? newTag : oldTag, v: { ...v.v, [mode]: version } } };
  if (hostId === line.id) {
    line2 = { ...line, content, text: hostText, tags: tagsIn(hostText), fields, updated_at: now, ...(by ? { _by: by } : {}) };
  } else {
    line2 = { ...line, fields, updated_at: now };
    rows.push({ ...kid(hostId, '', 0, by), content, text: hostText, tags: tagsIn(hostText) });
  }
  rows.unshift(line2);
  // Under it: the other paragraphs (4, 8, 12…), a break before a new scene,
  // and notes to self just after the paragraph they were said with. All
  // small numbers, so anything you've added under the line stays below.
  const keep = new Set([hostId]);
  rest.forEach((b, i) => {
    const n = i + 1;
    if (b.new_scene) { rows.push(kid(`${line.id}-s${n}`, '* * *', 4 * n - 1)); keep.add(`${line.id}-s${n}`); }
    rows.push(kid(`${line.id}-v${n}`, b.text, 4 * n, by));
    keep.add(`${line.id}-v${n}`);
  });
  version.notes.forEach((note, k) => {
    const id = `${line.id}-n${String(k + 1).padStart(2, '0')}`;
    const row = kid(id, `${NOTE}${note.text}`, 4 * Math.max(0, note.after) + 1, by);
    rows.push({ ...row, fields: { ...row.fields, aside: true } });
    keep.add(id);
  });
  for (const k of kids) if (isVoiceKid(k.id, line.id) && !keep.has(k.id) && !k.deleted) rows.push({ ...k, deleted: true, updated_at: now });
  return rows;
}

// A capture's write-up arrives: the line gets the chip and its words. If you
// already wrote on the line, it all goes just under it instead, so nothing you
// typed is touched.
export async function placeVoice(it, answer, { withTag = (row) => row } = {}) {
  const line = await getEntry(it.line);
  if (!line || line.deleted) return [];
  const raw = String(answer.raw || '').trim();
  if (!raw) return [];
  const kids = await children(line.id);
  const written = answer.blocks?.length ? { blocks: answer.blocks, notes: answer.notes || [] } : null;
  const mode = written ? answer.mode : RAW;
  const name = await modeName(mode);
  const edited = line.text !== it.wrote;
  const voice = { raw, mode, tag: 'idea', host: edited ? `${line.id}-v0` : line.id, v: { [RAW]: rawVersion(raw), ...(written ? { [mode]: written } : {}) } };
  let start = { ...line, fields: { ...line.fields, voice } };
  if (!edited) {
    // The recording and its time stay; the chip goes after them.
    const was = line.content || [];
    const upTo = was.findLastIndex((n) => n.type !== 'text');
    const said = line.fields?.said ? ` ${line.fields.said} ` : ' ';
    start = { ...start, content: [...was.slice(0, upTo + 1), { type: 'text', text: said }, { type: 'voice', attrs: { mode, name } }, { type: 'text', text: ' #idea' }] };
  } else {
    kids.push({ ...entry('line', { id: `${line.id}-v0` }), parent_id: line.id, sort: 0, content: [{ type: 'voice', attrs: { mode, name } }] });
  }
  const rows = showVersion(start, kids, mode, name, voice.v[mode]);
  if (answer.tag) rows[0] = withTag(rows[0], answer.tag);
  // Links to anything it named go last, under everything else.
  (answer.refs || []).filter((r) => r?.label && /^https?:\/\//.test(r.url || '')).slice(0, 6).forEach((r, i) => {
    rows.push({ ...entry('line', { id: `${line.id}-r${i + 1}` }), parent_id: line.id, sort: 1e6 + i, text: r.label, content: [{ type: 'text', text: r.label, marks: [{ type: 'link', attrs: { href: r.url } }] }], fields: { done: false, gather: null, gathered: null, mirror: null }, _by: CLAUDE });
  });
  await putEntries(rows);
  return rows;
}

// Shows a capture in another mode (or word for word). Edits to the version
// showing are kept with it first. `ask` reaches the server when that mode
// hasn't been written yet. Returns the rows written.
export async function switchVoice(lineId, mode, ask) {
  const line = await getEntry(lineId);
  const v = line?.fields?.voice;
  if (!v) return [];
  const kids = await children(line.id);
  const showing = readShowing(line, kids);
  const versions = { ...v.v };
  if (v.mode && !sameVersion(showing, versions[v.mode])) versions[v.mode] = { ...showing, edited: true };
  let version = versions[mode];
  if (!version) {
    const out = await ask({ mode: 'voice', transcript: v.raw, use: mode, place: 'day' });
    if (!out?.blocks?.length) throw new Error(out?.warning || 'Claude couldn’t write it up that way this time.');
    version = { blocks: out.blocks, notes: out.notes || [] };
  }
  const rows = showVersion({ ...line, fields: { ...line.fields, voice: { ...v, v: versions } } }, kids, mode, await modeName(mode), version);
  await putEntries(rows);
  return rows;
}

// The version showing, as plain text to paste somewhere else (a message, an email).
export async function voiceText(lineId) {
  const line = await getEntry(lineId);
  if (!line?.fields?.voice) return '';
  return readShowing(line, await children(line.id)).blocks.map((b) => b.text).join('\n\n');
}
export async function voiceInfo(lineId) {
  const line = await getEntry(lineId);
  const v = line?.fields?.voice;
  return v ? { mode: v.mode, made: Object.keys(v.v || {}) } : null;
}

// ---------- talking into a draft ----------

// The paragraphs Claude wrote go into the chapter after the paragraph you
// were on, each holding what you really said as its other version. Notes to
// self become margin notes on the paragraph they were said with. Returns the
// rows written, or null if the chapter is gone.
export async function placeDraft(into, answer, { script = false, noteType = null } = {}) {
  const chapter = await getEntry(into.chapter);
  if (!chapter || chapter.deleted) return null;
  const blocks = answer.blocks?.length ? answer.blocks : rawVersion(answer.raw || '').blocks.map((b) => ({ ...b, said: b.text }));
  if (!blocks.length) return [];
  const now = Date.now();
  const kids = (await children(chapter.id)).filter((k) => ['para', 'heading', 'scene'].includes(k.kind)).sort(bySort);
  let at = into.after === 'start' ? 0 : kids.findIndex((k) => k.id === into.after) + 1;
  if (at <= 0 && into.after !== 'start') at = kids.length;
  // An empty paragraph where you were (the caret on a fresh line) is filled, not left above.
  const rows = [];
  const spot = kids[at - 1];
  if (spot && spot.id === into.after && spot.kind === 'para' && !(spot.text || '').trim() && !spot.content?.length) {
    rows.push({ ...spot, deleted: true, updated_at: now });
    kids.splice(at - 1, 1);
    at -= 1;
  }
  const fresh = [];
  const fromClaude = !!answer.blocks?.length;
  blocks.forEach((b, i) => {
    if (b.new_scene && i > 0 && !(script && b.el === 'scene')) fresh.push(entry('scene', { id: newId('sc'), title: '' }));
    const el = script ? (b.el === 'paragraph' ? 'action' : b.el) : null;
    const said = (b.said || '').trim();
    const versions = fromClaude && said && said !== b.text ? [[{ type: 'text', text: b.text }], [{ type: 'text', text: said }]] : null;
    fresh.push(entry('para', {
      id: newId('pa'), text: b.text, content: [{ type: 'text', text: b.text }], tags: tagsIn(b.text),
      fields: { ...(el ? { el } : {}), ...(versions ? { versions, pvi: 0, claude: [b.text] } : {}), voice: into.line || true },
      ...(fromClaude ? { _by: CLAUDE } : {})
    }));
  });
  const paras = fresh.filter((r) => r.kind === 'para');
  const list = [...kids.slice(0, at), ...fresh.map((r) => ({ ...r, sort: undefined, _new: true })), ...kids.slice(at)];
  const sorts = placeSorts(list.map((r) => r.sort));
  list.forEach((r, i) => {
    if (r._new) { const { _new, ...row } = r; rows.push({ ...row, parent_id: chapter.id, sort: sorts[i], created_at: now, updated_at: now }); }
    else if (r.sort !== sorts[i]) rows.push({ ...r, sort: sorts[i], updated_at: now });
  });
  (answer.notes || []).forEach((n) => {
    const p = paras[Math.max(0, Math.min(paras.length - 1, n.after))];
    rows.push({ ...entry('note', { parent_id: p.id, type: noteType, text: n.text, tags: tagsIn(n.text), fields: { chapter_id: chapter.id } }), _by: CLAUDE });
  });
  await putEntries(rows);
  return rows;
}
