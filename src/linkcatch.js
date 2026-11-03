import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { bareLink, linkLabel } from './share.js';

// A web address on a line of its own, on any day or page, is kept the way a
// link shared from the phone is: the line shows the site's name as a link at
// once, and Claude's snapshot (the page's real title, its picture, a short
// summary under it and a tag) follows when there's a connection.
//
// Pasting it on an empty line catches it at once. Typed, it's caught when the
// caret leaves the line (Enter, a click elsewhere, leaving the page), so a
// half-typed address is never sent. Only lines written on here are caught:
// an old line that already holds a bare address stays as it is.

const key = new PluginKey('linkCatch');

function lineAt($pos) {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'listItem') return { node, pos: $pos.before(d) };
  }
  return null;
}

function findLine(doc, eid) {
  let found = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'listItem' && node.attrs.eid === eid) { found = { node, pos }; return false; }
  });
  return found;
}

// The line's words become the site's name, linked to the address.
function linkLine(view, line, url) {
  const { state } = view;
  const para = line.node.firstChild;
  const link = state.schema.marks.link;
  if (!para || !link) return false;
  const from = line.pos + 2;
  const to = from + para.content.size;
  const text = state.schema.text(linkLabel(url), [link.create({ href: url })]);
  const tr = state.tr.replaceWith(from, to, text).setMeta(key, { caught: line.node.attrs.eid });
  // A caret that was on the line stays at its end, and what's typed next
  // isn't part of the link.
  if (state.selection.from >= from && state.selection.from <= to) tr.setSelection(TextSelection.create(tr.doc, from + text.nodeSize)).setStoredMarks([]);
  view.dispatch(tr);
  return true;
}

export const LinkCatch = Extension.create({
  name: 'linkCatch',
  addOptions() { return { onCatch: () => {} }; },
  addProseMirrorPlugins() {
    const { onCatch } = this.options;
    const written = new Set();
    const tryLine = (view, eid) => {
      if (!eid || !written.has(eid)) return;
      const line = findLine(view.state.doc, eid);
      if (!line || line.node.attrs.mirror) return;
      const url = bareLink(line.node.firstChild?.textContent || '');
      if (!url) return;
      written.delete(eid);
      if (linkLine(view, line, url)) onCatch(eid, url);
    };
    return [new Plugin({
      key,
      // Only lines written on count: a page being loaded or refreshed from
      // another device (setContent, which doesn't tell the app it changed)
      // isn't writing.
      state: {
        init: () => null,
        apply(tr) {
          if (tr.docChanged && !tr.getMeta('preventUpdate') && !tr.getMeta(key)) {
            const eid = lineAt(tr.selection.$head)?.node.attrs.eid;
            if (eid) written.add(eid);
          }
          return null;
        }
      },
      view: () => ({
        update(view, prev) {
          const was = lineAt(prev.selection.$head)?.node.attrs.eid;
          const now = lineAt(view.state.selection.$head)?.node.attrs.eid;
          // After this update is done, not inside it.
          if (was && was !== now) setTimeout(() => tryLine(view, was));
        }
      }),
      props: {
        handlePaste(view, event) {
          const text = event.clipboardData?.getData('text/plain') || '';
          const url = bareLink(text);
          if (!url || !view.state.selection.empty) return false;
          const line = lineAt(view.state.selection.$head);
          if (!line || line.node.attrs.mirror || (line.node.firstChild?.textContent || '').trim()) return false;
          if (!linkLine(view, line, url)) return false;
          onCatch(line.node.attrs.eid, url);
          return true;
        },
        handleDOMEvents: {
          blur(view) { tryLine(view, lineAt(view.state.selection.$head)?.node.attrs.eid); return false; }
        }
      }
    })];
  }
});
