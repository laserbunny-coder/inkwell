// Shortcut labels are written the Mac way (⌘⇧N) and shown the Windows way
// (Ctrl+Shift+N) everywhere else. One place does the swap so new labels,
// menus and tooltips come out right without each needing to remember it.

export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform);

// Chrome on Windows keeps Ctrl+Shift+N for a private window, so a note there is Alt+N.
const SWAPS = [['⌘⇧N', 'Alt+N'], ['⌘', 'Ctrl+'], ['⌥', 'Alt+'], ['⇧', 'Shift+'], ['↵', 'Enter']];
export const keyLabel = (t) => (isMac || !t ? t : SWAPS.reduce((s, [a, b]) => s.replaceAll(a, b), t));

const MARKS = /[⌘⌥⇧]/;
const editable = (el) => el?.closest?.('[contenteditable="true"], input, textarea');

function fix(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (MARKS.test(node.data) && !editable(node.parentElement)) node.data = keyLabel(node.data);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || editable(node)) return;
  for (const el of [node, ...node.querySelectorAll('[title]')]) if (MARKS.test(el.title)) el.title = keyLabel(el.title);
  const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) if (MARKS.test(t.data) && !editable(t.parentElement)) t.data = keyLabel(t.data);
}

// Rewrites the page now and whatever is added to it later (menus, notes, tooltips).
export function showKeysForThisComputer(root = document.body) {
  if (isMac) return;
  fix(root);
  new MutationObserver((changes) => {
    for (const c of changes) {
      if (c.type === 'attributes') { if (MARKS.test(c.target.title)) c.target.title = keyLabel(c.target.title); continue; }
      if (c.type === 'characterData') { fix(c.target); continue; }
      c.addedNodes.forEach(fix);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] });
}
