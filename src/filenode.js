import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { addFile, fileUrl, isImage, sizeLabel, MAX_BYTES } from './files.js';

// A picture or file in a paragraph or line. Pictures show in the text at
// reading width; other files show as a small chip that opens the file.
// Paste or drop to add one, or use "Add a picture or file…" in Ctrl + K.

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
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-size')) || 0, renderHTML: () => ({}) }
    };
  },
  // Not words: a picture doesn't change a word count or show in search text.
  // (Tiptap asks every extension about every node, so only answer for this one.)
  extendNodeSchema(ext) { return ext.name === 'file' ? { leafText: () => '' } : {}; },
  parseHTML() { return [{ tag: 'span[data-file]' }]; },
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs;
    return ['span', mergeAttributes(HTMLAttributes, { 'data-file': a.id, 'data-name': a.name, 'data-type': a.type, 'data-size': a.size, class: 'file-embed' }), a.name];
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
      return { dom, ignoreMutation: () => true };
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
