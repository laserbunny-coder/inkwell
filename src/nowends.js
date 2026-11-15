// Now's two ends of the day (Part 4): the morning talk, the day as it was
// heard, and the close of the day. Drawn into Now's box by now.js; the work
// (asking Claude, laying the day out, writing the page) is in dayends.js and
// app/talking.js.

import { make } from './dom.js';
import { dayFacts, ASK } from './dayends.js';

const MIC = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';

function btn(act, label, cls = '', key = '') {
  const b = make('button', `now-btn${cls ? ` ${cls}` : ''}`, label);
  b.type = 'button';
  b.dataset.now = act;
  if (key) b.title = `${label} (${key})`;
  return b;
}

// Morning: one question, a box and the mic. The box is kept through redraws.
export function talkView(now) {
  const mid = make('div', 'now-mid now-ends');
  mid.append(make('p', 'now-eyebrow', 'Talk the day through'));
  if (!now.forms.talk) {
    const form = make('form', 'now-talk');
    const q = make('label', 'now-q', 'What is in front of you today?');
    q.htmlFor = 'now-talk-box';
    const box = make('textarea', 'now-say');
    box.id = 'now-talk-box';
    box.rows = 4;
    box.placeholder = 'Say it any way it comes. Big things, small things, what’s on your mind.';
    box.value = now.talk.text;
    box.addEventListener('input', () => { now.talk.text = box.value; });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
      if (e.key === 'Escape') { e.preventDefault(); now.endMode(); }
    });
    const row = make('div', 'now-talk-row');
    const mic = make('button', 'now-mic');
    mic.type = 'button';
    mic.dataset.now = 'talk-mic';
    mic.setAttribute('aria-label', 'Say it instead');
    mic.title = 'Say it instead';
    mic.innerHTML = MIC;
    const send = btn('talk-send', 'Lay it out', 'go');
    send.type = 'submit';
    send.title = 'Lay it out (Ctrl + Enter)';
    row.append(mic, send, btn('talk-cancel', 'Not now', 'quiet'));
    form.append(q, box, row);
    form.addEventListener('submit', (e) => { e.preventDefault(); now.sendTalk(); });
    now.forms.talk = form;
  }
  const form = now.forms.talk;
  form.classList.toggle('busy', !!now.talk.busy);
  form.querySelector('textarea').disabled = !!now.talk.busy;
  form.querySelector('[data-now="talk-send"]').textContent = now.talk.busy ? 'Listening…' : 'Lay it out';
  let note = form.querySelector('.now-talk-note');
  if (!note) { note = make('p', 'now-talk-note'); note.setAttribute('role', 'status'); form.append(note); }
  note.textContent = now.talk.note || '';
  mid.append(form);
  return mid;
}

// The day as heard: the real list (drag it), Begin starts the first.
export function heardView(now, m) {
  const mid = make('div', 'now-mid now-ends now-heard');
  mid.append(make('p', 'now-eyebrow', 'The day as I heard it'));
  const h = now.heard || {};
  const notes = [];
  if (h.page) notes.push(`${h.page === 1 ? 'One more thing went' : `${h.page} more things went`} to today’s page, to be filed`);
  if (notes.length) mid.append(make('p', 'now-ref', `${notes.join('. ')}.`));
  const foot = make('div', 'now-foot open now-heard-list');
  foot.append(now.list(m));
  mid.append(foot);
  const acts = make('div', 'now-acts');
  const go = btn('heard-begin', 'Begin', 'go', 'B');
  go.disabled = !m.cand;
  acts.append(go, btn('talk-again', 'Say more', 'quiet'));
  mid.append(acts);
  mid.append(make('p', 'now-hint', 'Drag to change the order. Undo is in the message at the bottom.'));
  return mid;
}

// Evening: what the screen saw, a line for what it didn't, three questions.
export function closeView(now, m) {
  const p = now.p;
  const facts = dayFacts({ items: p.items, today: p.today, events: p.cal, marks: now.st.events });
  const mid = make('div', 'now-mid now-ends now-close');
  mid.append(make('p', 'now-eyebrow', 'Close of the day'), make('h2', 'now-close-h', 'Here is what you did'));
  const list = make('ul', 'now-did');
  for (const t of facts.done) list.append(make('li', 'did-done', t));
  for (const t of facts.worked) list.append(make('li', 'did-worked', `Worked on: ${t}`));
  for (const e of facts.events) list.append(make('li', 'did-event', `${e.at} · ${e.title}`));
  for (const t of now.close.also) list.append(make('li', 'did-also', t));
  if (!list.childElementCount) list.append(make('li', 'did-none', 'Nothing the screen saw. Add what it missed below.'));
  mid.append(list);
  if (!now.forms.close) {
    const form = make('form', 'now-closeform');
    const add = make('div', 'now-add');
    const addIn = make('input', 'now-addin');
    addIn.type = 'text';
    addIn.placeholder = 'Add what the screen did not see';
    addIn.setAttribute('aria-label', 'Add what the screen did not see');
    addIn.enterKeyHint = 'done';
    addIn.autocomplete = 'off';
    addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); now.addAlso(addIn); } });
    add.append(addIn, btn('close-add', 'Add', 'quiet'));
    form.append(add);
    const field = (key, tag) => {
      const lab = make('label', 'now-q', ASK[key]);
      const el = make(tag, 'now-say');
      el.id = `now-close-${key}`;
      lab.htmlFor = el.id;
      if (tag === 'textarea') el.rows = 2;
      else { el.type = 'text'; el.enterKeyHint = 'done'; el.autocomplete = 'off'; }
      el.value = now.close[key] || '';
      el.addEventListener('input', () => { now.close[key] = el.value; });
      form.append(lab, el);
    };
    field('alive', 'textarea');
    field('drained', 'textarea');
    field('first', 'input');
    const acts = make('div', 'now-acts');
    const save = btn('close-save', 'Close the day', 'go');
    save.type = 'submit';
    acts.append(save, btn('close-cancel', 'Not now', 'quiet'));
    form.append(acts, make('p', 'now-hint', 'Written on today’s page under “Close of the day”. What is first tomorrow goes to the top of tomorrow.'));
    form.addEventListener('submit', (e) => { e.preventDefault(); now.saveClose(); });
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); now.endMode(); } });
    now.forms.close = form;
  }
  now.forms.close.classList.toggle('busy', !!now.close.busy);
  mid.append(now.forms.close);
  return mid;
}
