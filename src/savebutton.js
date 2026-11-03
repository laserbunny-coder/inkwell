// "Save to Inkwell" for a computer's browser, where Inkwell isn't in the share
// menu: a bookmark that, clicked on any page (a post on X, a video, an
// article), opens Inkwell with that page's address. It lands on today's page
// the way a share from the phone does, and Claude's snapshot follows.

const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function bookmarklet(base) {
  const app = base.split('#')[0].split('?')[0];
  return `javascript:(()=>{window.open(${JSON.stringify(app)}+'?save='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'inkwell')})()`;
}

export function showSaveButton(base = location.href) {
  const back = make('div', 'ask-backdrop');
  const box = make('div', 'ask save-button');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const steps = make('ol', 'save-steps');
  for (const s of [
    'Press Ctrl + Shift + B in your browser to show the bookmarks bar.',
    'Drag the Save to Inkwell button below up onto that bar.',
    'On any page (a post on X, a video, an article), click it. The page lands on today, and Claude adds its title, a short summary and a tag.'
  ]) steps.append(make('li', '', s));
  const button = make('a', 'pill primary save-drag', 'Save to Inkwell');
  button.href = bookmarklet(base);
  button.title = 'Drag me to the bookmarks bar';
  button.addEventListener('click', (e) => e.preventDefault());
  const tip = make('p', 'save-tip', 'Or copy the link and paste it on a line of its own, anywhere in Inkwell. It gets the same title, summary and tag.');
  const row = make('div', 'ask-actions');
  const done = make('button', 'ghost-btn', 'Done');
  row.append(done);
  box.append(make('h2', '', 'Save links from your browser'), steps, make('div', 'save-drag-row'), tip, row);
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
