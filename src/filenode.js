import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { addFile, fileUrl, isImage, isAudio, sizeLabel, lengthLabel, MAX_BYTES } from './files.js';

// A picture or file in a paragraph or line. Pictures show in the text at
// reading width; other files show as a small chip that opens the file.
// Paste or drop to add one, or use "Add a picture or file…" in Ctrl + K.
// A recording shows as a chip with a play button and its length.

// A short word after a recording's length while something is being done with
// it ("writing out…"), on every chip that shows it.
const notes = new Map();
export function setFileNote(id, text) {
  if (text) notes.set(id, text); else notes.delete(id);
  for (const el of document.querySelectorAll(`[data-file="${CSS.escape(id)}"] .note`)) el.textContent = text ? ` · ${text}` : '';
}

export const FileEmbed = Node.create({
  name: 'file',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return { onTooBig: () => {} };
  },
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-file'), renderHTML: () => ({}) },
      name: { default: '', parseHTML: (el) => el.getAttribute('data-name') || '', renderHTML: () => ({}) },
      type: { default: '', parseHTML: (el) => el.getAttribute('data-type') || '', renderHTML: () => ({}) },
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-size')) || 0, renderHTML: () => ({}) },
      duration: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-duration')) || 0, renderHTML: () => ({}) }
    };
  },
  // Not words: a picture doesn't change a word count or show in search text.
  // (Tiptap asks every extension about every node, so only answer for this one.)
  extendNodeSchema(ext) { return ext.name === 'file' ? { leafText: () => '' } : {}; },
  parseHTML() { return [{ tag: 'span[data-file]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs;
    return ['span', mergeAttributes(HTMLAttributes, { 'data-file': a.id, 'data-name': a.name, 'data-type': a.type, 'data-size': a.size, ...(a.duration ? { 'data-duration': a.duration } : {}), class: 'file-embed' }), a.name];
  },
  renderText({ node }) { return `[${node.attrs.name}]`; },
  addNodeView() {
    return ({ node }) => {
      const a = node.attrs;
      const dom = document.createElement('span');
      dom.contentEditable = 'false';
      dom.dataset.file = a.id || '';
      if (isImage(a.type)) {
        dom.className = 'file-embed picture';
        const img = document.createElement('img');
        img.alt = a.name;
        img.draggable = false;
        dom.append(img);
        // One sent from another device may still be on its way up; try again a few times.
        const show = (tries) => fileUrl(a.id).then((url) => {
          if (url) { img.src = url; dom.classList.remove('missing'); dom.title = ''; return; }
          dom.classList.add('missing');
          dom.title = 'This picture hasn’t reached this device yet';
          if (tries < 4) setTimeout(() => { if (dom.isConnected) show(tries + 1); }, [5, 30, 120, 600][tries] * 1000);
        });
        show(0);
      } else if (isAudio(a.type)) {
        dom.className = 'file-embed chip audio';
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'play';
        play.setAttribute('aria-label', 'Play the recording');
        const label = document.createElement('small');
        label.textContent = lengthLabel(a.duration) || 'Recording';
        const note = document.createElement('small');
        note.className = 'note';
        note.textContent = notes.has(a.id) ? ` · ${notes.get(a.id)}` : '';
        // Once played, a bar opens beside the button to scrub through it.
        const scrub = document.createElement('input');
        scrub.type = 'range';
        scrub.className = 'scrub';
        scrub.min = '0';
        scrub.step = '0.1';
        scrub.value = '0';
        scrub.draggable = false;
        scrub.setAttribute('aria-label', 'Where in the recording');
        dom.append(play, scrub, label, note);
        const total = () => (Number.isFinite(audio?.duration) && audio.duration > 0 ? audio.duration : (a.duration || 0) / 1000);
        const showTime = () => {
          const at = audio ? audio.currentTime : 0;
          scrub.max = String(total() || 1);
          if (!scrub.matches(':active')) scrub.value = String(at);
          label.textContent = `${lengthLabel(at * 1000) || '0:00'} / ${lengthLabel(total() * 1000) || '–'}`;
        };
        let audio = null;
        const load = async () => {
          if (audio) return audio;
          const url = await fileUrl(a.id);
          if (!url) { dom.title = 'This recording hasn’t reached this device yet'; return null; }
          audio = new Audio(url);
          audio.preload = 'auto';
          audio.addEventListener('play', () => dom.classList.add('playing'));
          audio.addEventListener('pause', () => dom.classList.remove('playing'));
          audio.addEventListener('ended', () => dom.classList.remove('playing'));
          audio.addEventListener('timeupdate', showTime);
          audio.addEventListener('durationchange', showTime);
          dom.classList.add('open');
          showTime();
          return audio;
        };
        play.addEventListener('mousedown', (e) => e.preventDefault());
        play.addEventListener('click', async (e) => {
          e.preventDefault();
          if (audio && !audio.paused) { audio.pause(); return; }
          if (await load()) audio.play().catch(() => {});
        });
        scrub.addEventListener('input', async () => {
          if (!(await load())) return;
          audio.currentTime = Number(scrub.value);
          showTime();
        });
      } else {
        dom.className = 'file-embed chip';
        const link = document.createElement('a');
        link.textContent = a.name || 'File';
        link.title = `Open ${a.name}`;
        const size = document.createElement('small');
        size.textContent = sizeLabel(a.size);
        dom.append(link, size);
        link.addEventListener('mousedown', (e) => e.preventDefault());
        link.addEventListener('click', async (e) => {
          e.preventDefault();
          const url = await fileUrl(a.id);
          if (!url) { dom.title = 'This file hasn’t reached this device yet'; return; }
          const go = document.createElement('a');
          go.href = url;
          go.target = '_blank';
          go.rel = 'noopener';
          if (!/^(application\/pdf|text\/)/.test(a.type)) go.download = a.name;
          go.click();
        });
      }
      // The scrub bar is the chip's own: the editor leaves its clicks and drags alone.
      return { dom, ignoreMutation: () => true, stopEvent: (e) => !!e.target?.closest?.('.scrub') };
    };
  },
  addProseMirrorPlugins() {
    const type = this.type;
    const tooBig = this.options.onTooBig;
    return [new Plugin({
      key: new PluginKey('fileDrop'),
      props: {
        handlePaste(view, event) {
          const files = [...(event.clipboardData?.files || [])];
          if (!files.length) return false;
          insertFiles(view, type, files, null, tooBig);
          return true;
        },
        handleDrop(view, event, _slice, moved) {
          if (moved) return false;
          const files = [...(event.dataTransfer?.files || [])];
          if (!files.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          insertFiles(view, type, files, at ? at.pos : null, tooBig);
          return true;
        }
      }
    })];
  }
});

// Keeps each file, then puts it in the text at `pos` (or where the caret is).
export async function insertFiles(view, type, files, pos = null, tooBig = () => {}) {
  let at = pos;
  for (const f of files) {
    if (f.size > MAX_BYTES) { tooBig(f); continue; }
    const row = await addFile(f);
    if (!row || view.isDestroyed) continue;
    const node = type.create({ id: row.id, name: row.title, type: row.fields.type, size: row.fields.size });
    const where = at ?? view.state.selection.from;
    const tr = view.state.tr;
    // Only inside text (a paragraph or line); a spot between blocks moves in.
    const $p = tr.doc.resolve(Math.min(where, tr.doc.content.size));
    const inside = $p.parent.inlineContent ? where : null;
    if (inside === null) {
      view.dispatch(tr.replaceSelectionWith(node).scrollIntoView());
      at = view.state.selection.from;
    } else {
      view.dispatch(tr.insert(inside, node).scrollIntoView());
      at = inside + node.nodeSize;
    }
  }
}
