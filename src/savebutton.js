import { plain as make } from './dom.js';
// "Save to Inkwell" for a computer's browser, where Inkwell isn't in the share
// menu: a bookmark that, clicked on any page (a post on X, a video, an
// article), saves that page's address to today's page. It opens a little
// window (save.html) that hands the link to the Inkwell already open in this
// browser and closes itself; only when none is open does Inkwell open.
// Claude's snapshot follows either way.


export function bookmarklet(base) {
  const save = new URL('save.html', base.split('#')[0].split('?')[0]).href;
  return `javascript:(()=>{var w=380,h=150;window.open(${JSON.stringify(save)}+'?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'inkwell-save','popup,width='+w+',height='+h+',left='+Math.round((screen.availWidth-w)/2)+',top='+Math.round((screen.availHeight-h)/3))})()`;
}

export function showSaveButton(base = location.href) {
  const back = make('div', 'ask-backdrop');
  const box = make('div', 'ask save-button');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const steps = make('ol', 'save-steps');
  const redo = make('p', 'save-tip', 'Already have the button from before? Right-click it on the bookmarks bar, Delete, and drag this new one up. The new one saves into the Inkwell you have open instead of opening another.');
  for (const s of [
    'Press Ctrl + Shift + B in your browser to show the bookmarks bar.',
    'Drag the Save to Inkwell button below up onto that bar.',
    'On any page (a post on X, a video, an article), click it. A little window says Saved and closes. The page lands on today in the Inkwell you have open (Inkwell opens only if it isn’t), and Claude adds its title, a short summary and a tag.'
  ]) steps.append(make('li', '', s));
  const button = make('a', 'pill primary save-drag', 'Save to Inkwell');
  button.href = bookmarklet(base);
  button.title = 'Drag me to the bookmarks bar';
  button.addEventListener('click', (e) => e.preventDefault());
  const tip = make('p', 'save-tip', 'Or copy the link and paste it on a line of its own, anywhere in Inkwell. It gets the same title, summary and tag.');
  const row = make('div', 'ask-actions');
  const done = make('button', 'ghost-btn', 'Done');
  row.append(done);
  box.append(make('h2', '', 'Save links from your browser'), steps, make('div', 'save-drag-row'), redo, tip, row);
  box.querySelector('.save-drag-row').append(button);
  back.append(box);
  document.body.append(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', key, true); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', key, true);
  done.addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  done.focus();
}
