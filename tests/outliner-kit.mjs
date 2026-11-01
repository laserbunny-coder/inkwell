// Shared helpers for the outliner tests: build a page from indented text,
// press keys, and read the page back as indented text.
//   "Kenji|"  the caret       "[+]"  a folded line     "~"  a done line
export const toDoc = (spec) => {
  const rows = spec.replace(/^\n+|\s+$/g, '').split('\n').map((l) => {
    const depth = (l.match(/^ */)[0].length) / 2;
    let text = l.trim();
    const folded = text.endsWith(' [+]'); if (folded) text = text.slice(0, -4);
    const done = text.startsWith('~'); if (done) text = text.slice(1);
    return { depth, text, folded, done };
  });
  let i = 0;
  const list = (depth) => {
    const items = [];
    while (i < rows.length && rows[i].depth === depth) {
      const r = rows[i++];
      const eid = `li_${r.text.replace(/\|/g, '').replace(/\W+/g, '_').toLowerCase() || 'empty' + i}`;
      const content = [{ type: 'paragraph', ...(r.text.replace('|', '') ? { content: [{ type: 'text', text: r.text.replace('|', '') }] } : {}) }];
      if (i < rows.length && rows[i].depth > depth) content.push(list(depth + 1));
      items.push({ type: 'listItem', attrs: { eid, done: r.done }, content });
    }
    return { type: 'bulletList', content: items };
  };
  return { doc: { type: 'doc', content: [list(0)] }, rows };
};

// Puts the outline into the page, folds what's marked [+], sets the caret at |.
export async function setOutline(page, spec, { zoom = null } = {}) {
  const { doc, rows } = toDoc(spec);
  await page.evaluate(({ doc, rows, zoom }) => {
    const ed = window.__outline, fk = window.__foldKey;
    const st = fk.getState(ed.state);
    for (const e of [...st.folded]) ed.view.dispatch(ed.state.tr.setMeta(fk, { fold: e, on: false }));
    ed.commands.setContent(doc);
    let n = 0, caret = null;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'listItem') return;
      const r = rows[n++];
      if (r.folded) ed.view.dispatch(ed.state.tr.setMeta(fk, { fold: node.attrs.eid, on: true }));
      const at = r.text.indexOf('|');
      if (at >= 0) caret = pos + 2 + at;
    });
    ed.view.dispatch(ed.state.tr.setMeta(fk, { zoom }));
    ed.commands.focus();
    if (caret != null) ed.commands.setTextSelection(caret);
  }, { doc, rows, zoom: zoom && `li_${zoom.replace(/\W+/g, '_').toLowerCase()}` });
  await new Promise((r) => setTimeout(r, 120));
}

// The page as indented text, with the caret, folds and done lines marked.
export const readOutline = (page) => page.evaluate(() => {
  const ed = window.__outline, fk = window.__foldKey;
  const st = fk.getState(ed.state);
  const { from, to } = ed.state.selection;
  const out = [];
  ed.state.doc.descendants((node, pos, _p) => {
    if (node.type.name !== 'listItem') return;
    let depth = 0;
    const $p = ed.state.doc.resolve(pos);
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'listItem') depth++;
    const para = node.firstChild;
    let text = para.textContent;
    const start = pos + 2;
    if (from === to && from >= start && from <= start + para.content.size) text = text.slice(0, from - start) + '|' + text.slice(from - start);
    const kids = node.lastChild?.type.name === 'bulletList';
    out.push('  '.repeat(depth) + (node.attrs.done ? '~' : '') + text + (kids && st.folded.has(node.attrs.eid) ? ' [+]' : ''));
  });
  return out.join('\n');
});

export const clean = (s) => s.replace(/^\n+|\s+$/g, '');
