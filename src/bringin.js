import { putEntries, getEntry, byKind, children } from './db.js';
import { entry, newId, tagsIn } from './model.js';
import { worlds, worldTree } from './library.js';
import { setAbout } from './claudeknows.js';
import { taskFor, queueTask } from './daybook.js';
import { trash, inTrash } from './trash.js';

// Bring in old notes: a section copied (or exported) out of Thymer, Tana,
// Workflowy or OneNote, pasted or dropped here, becomes an ordinary page with
// its nesting kept. Nothing is bulk-imported: you pick what's worth keeping,
// one piece at a time. Claude (when asked, and when it can be reached)
// suggests where it goes, a title, a one-line about and a few tags, and which
// old to-dos still look alive; you change anything before it comes in.
//
// What it makes: a page (kind 'page') with fields.from = { app, at, name },
// lines under it (kind 'line', nested), the page's tags, and its about line.
// "Into the drawer" makes one #drawer line holding the whole thing on the loose
// page "Brought in" instead. Old to-dos never come in as checkboxes; the live
// ones can go to Daybook's Inbox from the same box.

export const APPS = [['thymer', 'Thymer'], ['tana', 'Tana'], ['workflowy', 'Workflowy'], ['onenote', 'OneNote'], ['other', 'Somewhere else']];
const APP_NAME = Object.fromEntries(APPS);
export const DRAWER_PAGE = 'pg_brought-in';
const GAP = 1024;
const BLANK = { done: false, gather: null, gathered: null, mirror: null };

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

// ---------- reading what came in ----------
// Every reader gives { title, lines }, where a line is { text, content, kids, todo }.

const node = (text, content, todo = false) => ({ text, content: content?.length ? content : (text ? [{ type: 'text', text }] : null), kids: [], todo });

// Markdown's inline bits: links, bold, italic and code become marks; images
// become a link to the picture; Tana's [[references]] keep their words.
export function inline(src) {
  const out = [];
  let s = src.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => `[${alt || 'picture'}](${url})`).replace(/\[\[([^\]]+)\]\]/g, '$1');
  const re = /\[([^\]]+)\]\(([^)\s]+)[^)]*\)|\*\*([^*]+)\*\*|__([^_]+)__|(?<![\w*])\*([^*\s][^*]*)\*(?!\w)|(?<![\w_])_([^_\s][^_]*)_(?!\w)|`([^`]+)`|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: 'text', text: m[1], marks: [{ type: 'link', attrs: { href: m[2] } }] });
    else if (m[3] ?? m[4]) out.push({ type: 'text', text: m[3] ?? m[4], marks: [{ type: 'bold' }] });
    else if (m[5] ?? m[6]) out.push({ type: 'text', text: m[5] ?? m[6], marks: [{ type: 'italic' }] });
    else if (m[7]) out.push({ type: 'text', text: m[7], marks: [{ type: 'code' }] });
    else if (m[8]) out.push({ type: 'text', text: m[8], marks: [{ type: 'link', attrs: { href: m[8] } }] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
  return out.filter((n) => n.text);
}
const plainOf = (content) => (content || []).map((n) => n.text || '').join('');

// Markdown or plain text (also what Workflowy and Tana copy): headings nest
// what follows them, bullets nest by their indent, other lines are lines.
export function fromMarkdown(src, name = '') {
  let text = src.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  let title = '';
  const front = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (front) { title = (front[1].match(/^title:\s*["']?(.*?)["']?\s*$/m) || [])[1] || ''; text = text.slice(front[0].length); }
  const root = { kids: [], level: 0 };
  const heads = [root]; // open headings, by level
  let list = []; // open bullets in the current list: [{ width, node }]
  let fence = false;
  const under = () => heads[heads.length - 1];
  for (const raw of text.split('\n')) {
    if (/^\s*```/.test(raw)) { fence = !fence; continue; }
    if (!raw.trim()) continue;
    if (!fence && /^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) continue;
    const h = !fence && raw.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      while (heads.length > 1 && under().level >= level) heads.pop();
      const n = { ...node(h[2], inline(h[2])), level };
      under().kids.push(n);
      heads.push(n);
      list = [];
      continue;
    }
    const width = raw.match(/^[\t ]*/)[0].replace(/\t/g, '    ').length;
    const b = !fence && raw.trim().match(/^([-*+•◦▪‣]|\d+[.)])\s+(.*)$/);
    let body = b ? b[2] : raw.trim();
    let todo = false;
    const box = body.match(/^\[([ xX])\]\s+/);
    if (box) { todo = box[1] === ' '; body = body.slice(box[0].length); }
    const n = node(plainOf(inline(body)), inline(body), todo);
    // Bullets and indented lines nest under the line above with less indent.
    while (list.length && list[list.length - 1].width >= width) list.pop();
    (list.length ? list[list.length - 1].node.kids : under().kids).push(n);
    list.push({ width, node: n });
  }
  let lines = root.kids;
  // One heading at the top holding everything: that's the title.
  if (!title && lines.length === 1 && lines[0].level === 1) { title = lines[0].text; lines = lines[0].kids; }
  if (!title && lines.length && lines[0].level === 1) { title = lines[0].text; lines = [...lines[0].kids, ...lines.slice(1)]; }
  // One line holding everything under it (a page copied with its title): that's the title too.
  if (!title && !name && lines.length === 1 && lines[0].kids.length) { title = lines[0].text; lines = lines[0].kids; }
  return { title: title || name || firstWords(lines), lines: lines.map(strip) };
}
const firstWords = (lines) => (lines[0]?.text || '').replace(/\s+/g, ' ').slice(0, 80);
const strip = (n) => ({ text: n.text, content: n.content, todo: !!n.todo, kids: (n.kids || []).map(strip) });

// OPML, as Workflowy exports it: outlines nest, _note becomes a line inside,
// _complete="true" marks done (kept as a plain line).
export function fromOPML(src, name = '') {
  const doc = new DOMParser().parseFromString(src, 'text/xml');
  if (doc.querySelector('parsererror')) return null;
  const body = doc.querySelector('body');
  if (!body) return null;
  const walk = (el) => [...el.children].filter((c) => c.tagName === 'outline').map((o) => {
    const t = (o.getAttribute('text') || o.getAttribute('title') || '').trim();
    const words = t.includes('<') ? (new DOMParser().parseFromString(t, 'text/html').body.textContent || '') : t;
    const n = node(words, inline(words));
    const note = (o.getAttribute('_note') || '').trim();
    if (note) n.kids.push(...note.split(/\n+/).filter((l) => l.trim()).map((l) => node(l.trim(), inline(l.trim()))));
    n.kids.push(...walk(o));
    return n;
  });
  let lines = walk(body);
  let title = (doc.querySelector('head > title')?.textContent || '').trim();
  if (lines.length === 1 && lines[0].kids.length) { title = lines[0].text; lines = lines[0].kids; }
  return { title: title || name, lines };
}

// Rich text pasted from OneNote, Thymer or a web page: headings, paragraphs
// and lists keep their shape; links, bold and italic come along.
export function fromHTML(html, name = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, meta, title, head').forEach((e) => e.remove());
  const root = { kids: [], level: 0 };
  const heads = [root];
  const under = () => heads[heads.length - 1];
  const BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|TABLE|TR|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER|MAIN)$/;
  const runs = (el, marks = []) => {
    const out = [];
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { const t = c.textContent.replace(/\s+/g, ' '); if (t) out.push({ type: 'text', text: t, ...(marks.length ? { marks } : {}) }); continue; }
      if (c.nodeType !== 1 || BLOCK.test(c.tagName)) continue;
      if (c.tagName === 'BR') { out.push({ type: 'br' }); continue; }
      let m = marks;
      const st = (c.getAttribute('style') || '').toLowerCase();
      if (c.tagName === 'A' && c.getAttribute('href')) m = [...m.filter((x) => x.type !== 'link'), { type: 'link', attrs: { href: c.getAttribute('href') } }];
      if (/^(B|STRONG)$/.test(c.tagName) || /font-weight:\s*(bold|[6-9]00)/.test(st)) m = [...m, { type: 'bold' }];
      if (/^(I|EM)$/.test(c.tagName) || /font-style:\s*italic/.test(st)) m = [...m, { type: 'italic' }];
      if (c.tagName === 'IMG') { const src = c.getAttribute('src'); if (src && !src.startsWith('data:')) out.push({ type: 'text', text: c.getAttribute('alt') || 'picture', marks: [{ type: 'link', attrs: { href: src } }] }); continue; }
      out.push(...runs(c, m));
    }
    return out;
  };
  // Inline runs split at <br>, each piece a line, with spaces tidied.
  const linesOf = (el) => {
    const parts = [[]];
    for (const r of runs(el)) { if (r.type === 'br') parts.push([]); else parts[parts.length - 1].push(r); }
    return parts.map((p) => {
      const c = p.map((r) => ({ ...r }));
      if (c.length) { c[0].text = c[0].text.replace(/^\s+/, ''); c[c.length - 1].text = c[c.length - 1].text.replace(/\s+$/, ''); }
      const content = c.filter((r) => r.text);
      return node(plainOf(content), content);
    }).filter((n) => n.text.trim());
  };
  const listItems = (list) => [...list.children].filter((c) => c.tagName === 'LI').map((li) => {
    const n = linesOf(li)[0] || node('', null);
    for (const c of li.children) if (/^(UL|OL)$/.test(c.tagName)) n.kids.push(...listItems(c));
    else if (/^(P|DIV)$/.test(c.tagName)) { const more = linesOf(c); if (!n.text && more.length) Object.assign(n, more.shift(), { kids: n.kids }); n.kids.push(...more); }
    const box = n.text.match(/^\[([ xX])\]\s+/) || (li.querySelector(':scope > input[type=checkbox]') && [null, li.querySelector(':scope > input').checked ? 'x' : ' ']);
    if (box) { n.todo = box[1] === ' '; if (box[0]) { n.text = n.text.slice(box[0].length); if (n.content?.[0]) n.content[0].text = n.content[0].text.replace(/^\[[ xX]\]\s+/, ''); } }
    return n;
  }).filter((n) => n.text || n.kids.length);
  const walk = (el) => {
    for (const c of el.children) {
      const tag = c.tagName;
      const h = tag.match(/^H([1-6])$/);
      if (h) {
        const level = Number(h[1]);
        while (heads.length > 1 && under().level >= level) heads.pop();
        const n = { ...(linesOf(c)[0] || node(c.textContent.trim(), null)), level };
        if (!n.text) continue;
        under().kids.push(n);
        heads.push(n);
      } else if (tag === 'UL' || tag === 'OL') under().kids.push(...listItems(c));
      else if (tag === 'TABLE') {
        for (const tr of c.querySelectorAll('tr')) {
          const cells = [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
          if (cells.length) under().kids.push(node(cells.join(' · '), null));
        }
      } else if ([...c.children].some((k) => BLOCK.test(k.tagName))) {
        // A wrapper (OneNote puts everything in divs): its own words first, then what's inside.
        const own = linesOf(c);
        under().kids.push(...own);
        walk(c);
      } else under().kids.push(...linesOf(c));
    }
  };
  walk(doc.body);
  let lines = root.kids;
  let title = '';
  if (lines.length && lines[0].level === 1) { title = lines[0].text; lines = [...lines[0].kids, ...lines.slice(1)]; }
  return { title: title || name, lines: lines.map(strip) };
}

// Is there real structure in pasted rich text, worth reading over the plain copy?
export const richEnough = (html) => !!html && (html.match(/<(p|li|h[1-6]|div|br|tr)\b/gi) || []).length > 1;

/** Reads whatever came in. `kind` is 'opml', 'html' or anything else (Markdown/plain). */
export function readIn({ text = '', html = '', name = '' }) {
  const t = text.trim();
  if (/^<\?xml|<opml\b/i.test(t)) { const got = fromOPML(t, name); if (got) return got; }
  if (html && richEnough(html)) { const got = fromHTML(html, name); if (got.lines.length) return got; }
  if (/^\s*<(html|body|div|p|h[1-6]|ul)\b/i.test(t)) return fromHTML(t, name);
  return fromMarkdown(text, name);
}

// Which app it most likely came from, to start the picker on.
export function guessApp({ text = '', html = '', file = '' }) {
  if (/\.opml$/i.test(file) || /<opml\b/i.test(text)) return 'workflowy';
  if (/urn:schemas-microsoft-com:office|onenote/i.test(html)) return 'onenote';
  if (/::\s|\btana\b/i.test(text) || /%%tana%%/.test(text)) return 'tana';
  if (/thymer/i.test(html + text)) return 'thymer';
  return '';
}

// Lines as indented text, for Claude to read, each with a short id.
export function outlineText(lines, max = 12000) {
  const out = [];
  let n = 0;
  const walk = (list, depth) => {
    for (const l of list) {
      l.ref = `l${++n}`;
      out.push(`${'  '.repeat(depth)}- [${l.ref}]${l.todo ? ' (to-do)' : ''} ${l.text}`);
      walk(l.kids, depth + 1);
    }
  };
  walk(lines, 0);
  const s = out.join('\n');
  return s.length > max ? `${s.slice(0, max)}\n…` : s;
}
export function countLines(lines) { return lines.reduce((s, l) => s + 1 + countLines(l.kids), 0); }
export function todosIn(lines, acc = []) { for (const l of lines) { if (l.todo) acc.push(l); todosIn(l.kids, acc); } return acc; }

// ---------- where it can go ----------

/** Worlds and life projects, and the pages in their bibles: [{ id, label, title, kind, depth }]. */
export async function homes() {
  const out = [];
  const ws = (await worlds()).filter((w) => !w.deleted).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  for (const w of ws) {
    if (await inTrash(w.id)) continue;
    const life = !!w.fields?.life;
    out.push({ id: w.id, title: w.title || 'Untitled', kind: life ? 'life' : 'world', depth: 0 });
    const { pages } = await worldTree(w.id);
    for (const { row, depth } of pages.slice(0, 60)) out.push({ id: row.id, title: row.title || 'Untitled page', kind: 'page', depth: depth + 1, world: w.title || 'Untitled' });
  }
  return out;
}

// ---------- making the page ----------

const lineRow = (l, parent, sort, by) => {
  const text = l.text;
  const content = l.content?.length ? l.content : (text ? [{ type: 'text', text }] : null);
  return { ...entry('line', { id: newId('li'), parent_id: parent, sort }), text, content, tags: tagsIn(text), fields: { ...BLANK }, ...(by ? { _by: by } : {}) };
};
function rowsFor(lines, parent) {
  const rows = [];
  const map = new Map();
  const walk = (list, pid) => list.forEach((l, i) => {
    const r = lineRow(l, pid, (i + 1) * GAP);
    rows.push(r);
    map.set(l, r);
    walk(l.kids, r.id);
  });
  walk(lines, parent);
  return { rows, map };
}

async function drawerPage() {
  const have = await getEntry(DRAWER_PAGE);
  if (have && !have.deleted) return have;
  const page = entry('page', { id: DRAWER_PAGE, parent_id: null, title: 'Brought in', sort: 0 });
  await putEntries([page]);
  return page;
}

/**
 * Brings it in. `into` is a world, life project or page id, '' for a loose
 * page, or 'drawer'. `toDaybook` lists the to-do lines (from `got.lines`) to
 * send. Returns { page, line, rows, tasks }: `line` is the drawer line when
 * it went to the drawer.
 */
export async function bringIn(got, { into = '', title = '', about = '', tags = [], app = 'other', name = '', toDaybook = [], base = '' } = {}) {
  const now = Date.now();
  const from = { app, at: new Date(now).toISOString(), ...(name ? { name } : {}) };
  const name0 = (title || got.title || 'Untitled').trim();
  const tagList = [...new Set(tags.map((t) => String(t).trim().replace(/^#/, '').toLowerCase()).filter(Boolean))];
  let page;
  let holder;
  const pre = [];
  if (into === 'drawer') {
    page = await drawerPage();
    const at = (await children(page.id)).length + 1;
    const text = `${name0}${tagList.map((t) => ` #${t}`).join('')} #drawer`;
    holder = { ...entry('line', { id: newId('li'), parent_id: page.id, sort: at * GAP }), text, content: [{ type: 'text', text }], tags: tagsIn(text), fields: { ...BLANK, from } };
    pre.push(holder);
  } else {
    const sort = into ? (await children(into)).filter((r) => r.kind === 'page').length + 1 : 0;
    page = entry('page', { id: newId('pg'), parent_id: into || null, title: name0, sort, tags: tagList, fields: { from } });
    holder = page;
    pre.push(page);
  }
  const { rows, map } = rowsFor(got.lines, holder.id);
  const tasks = [];
  for (const l of toDaybook) {
    const r = map.get(l);
    if (!r) continue;
    const task = taskFor(r, base);
    r.fields = { ...r.fields, daybook: { id: task.id, at: now } };
    tasks.push(task);
  }
  await putEntries([...pre, ...rows]);
  for (const t of tasks) await queueTask(t);
  if (into !== 'drawer' && about.trim()) await setAbout(page, { text: about });
  return { page, line: into === 'drawer' ? holder : null, rows: [...pre, ...rows], tasks };
}

/** Everything brought in so far, newest first: pages and drawer lines with fields.from. */
export async function broughtIn() {
  const pages = (await byKind('page')).filter((p) => !p.deleted && p.fields?.from);
  const lines = (await children(DRAWER_PAGE)).filter((l) => l.fields?.from);
  const all = [...pages, ...lines];
  const out = [];
  for (const r of all) if (!(await inTrash(r.id))) out.push(r);
  return out.sort((a, b) => (b.fields.from.at || '').localeCompare(a.fields.from.at || ''));
}

// ---------- the box ----------

/**
 * Opens the Bring in box. hooks: { ask, canAsk, toast, open(row), applied(rows),
 * sendTasks(), relink(fromLink, toLink), base, tags() }.
 */
export async function openBringIn(hooks) {
  document.querySelector('.bi-backdrop')?.remove();
  const back = make('div', 'ask-backdrop bi-backdrop');
  const box = make('div', 'ask bi');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Bring in old notes');
  back.append(box);
  document.body.append(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });

  const where = await homes();
  let src = { text: '', html: '', name: '', file: '' };
  let files = []; // several dropped files wait their turn
  let got = null;
  let asked = null; // Claude's suggestion for this one
  let asking = 0;

  const head = make('div', 'ck-head');
  head.append(make('h2', '', 'Bring in old notes'), Object.assign(make('button', 'ghost-btn ck-close', '✕'), { title: 'Close (Esc)', onclick: close }));
  const lead = make('p', 'bi-lead', 'Copy a section in Thymer, Tana, Workflowy or OneNote and paste it here, or drop an exported file (.md, .txt, .opml). Only what you bring in comes over.');
  const area = make('textarea', 'ask-input bi-paste');
  area.rows = 5;
  area.placeholder = 'Paste here (Ctrl + V)';
  area.setAttribute('aria-label', 'What to bring in');
  area.spellcheck = false;
  const fileBtn = make('button', 'ghost-btn', 'Choose files…');
  fileBtn.type = 'button';
  const queueNote = make('span', 'hint bi-queue');
  const pick = make('div', 'ask-file');
  pick.append(fileBtn, queueNote);

  const preview = make('section', 'bi-preview');
  const done = make('section', 'bi-done');
  box.append(head, lead, pick, area, preview, done);

  const takeFile = async (f) => {
    const text = await f.text();
    src = { text, html: /\.html?$/i.test(f.name) ? text : '', name: f.name.replace(/\.[^.]+$/, ''), file: f.name };
    area.value = text.length > 20000 ? `${text.slice(0, 20000)}\n…` : text;
    await read();
  };
  const takeFiles = async (list) => {
    files = [...list].filter((f) => /\.(md|markdown|txt|opml|html?)$/i.test(f.name));
    if (!files.length) { hooks.toast('Those aren’t files it can read: .md, .txt, .opml or .html'); return; }
    await takeFile(files.shift());
  };
  fileBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.md,.markdown,.txt,.opml,.html,.htm,text/plain,text/markdown';
    input.addEventListener('change', () => { if (input.files?.length) takeFiles(input.files); });
    input.click();
  });
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('bi-drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('bi-drop'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('bi-drop'); if (e.dataTransfer?.files?.length) takeFiles(e.dataTransfer.files); });
  area.addEventListener('paste', (e) => {
    const html = e.clipboardData?.getData('text/html') || '';
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!html && !text) return;
    e.preventDefault();
    src = { text, html, name: '', file: '' };
    area.value = text;
    read();
  });
  let typing;
  area.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => { src = { text: area.value, html: '', name: src.name, file: src.file }; read(); }, 400);
  });

  async function read() {
    got = src.text.trim() || src.html ? readIn(src) : null;
    asked = null;
    drawPreview();
    if (got?.lines.length && hooks.canAsk()) suggest();
  }

  async function suggest() {
    const mine = ++asking;
    status.textContent = 'Claude is looking at it…';
    try {
      const tagsNow = (await hooks.tags?.()) || [];
      const res = await hooks.ask({
        mode: 'bringin',
        app: APP_NAME[appPick.value] || '',
        title: got.title,
        text: outlineText(got.lines),
        homes: where.map((h) => ({ id: h.id, title: h.kind === 'page' ? `${h.world} › ${h.title}` : h.title, kind: h.kind })),
        tags: tagsNow.slice(0, 300)
      });
      if (mine !== asking) return;
      asked = res || {};
      const refs = new Map();
      const walk = (list) => list.forEach((l) => { refs.set(l.ref, l); walk(l.kids); });
      walk(got.lines);
      asked.todoLines = (asked.todos || []).map((r) => refs.get(r)).filter(Boolean);
      apply();
      status.textContent = 'Claude’s suggestions are filled in. Change anything.';
    } catch (e) {
      console.warn(e);
      if (mine === asking) status.textContent = 'Claude couldn’t look at it just now. Fill it in yourself, or bring it in as it is.';
    }
  }

  // The fields of the preview, kept between redraws.
  const titleIn = make('input', 'ask-input bi-title');
  titleIn.setAttribute('aria-label', 'Title');
  const placeSel = make('select', 'ask-input bi-place');
  placeSel.setAttribute('aria-label', 'Where it goes');
  placeSel.add(new Option('The Drawer (an idea with no home yet)', 'drawer'));
  placeSel.add(new Option('A loose page in the Library', ''));
  for (const h of where) placeSel.add(new Option(h.kind === 'page' ? `${h.world} › ${h.title}` : `${h.title}${h.kind === 'life' ? ' (life project)' : ''}`, h.id));
  placeSel.value = '';
  const appPick = make('select', 'ask-input bi-app');
  appPick.setAttribute('aria-label', 'Came from');
  for (const [id, label] of APPS) appPick.add(new Option(label, id));
  const aboutIn = make('input', 'ask-input bi-about');
  aboutIn.setAttribute('aria-label', 'One line about it');
  aboutIn.placeholder = 'One line about it (optional)';
  aboutIn.maxLength = 300;
  const tagsIn_ = make('input', 'ask-input bi-tags');
  tagsIn_.setAttribute('aria-label', 'Tags');
  tagsIn_.placeholder = 'Tags, like ninja-bunch, songs';
  const thymerIn = make('input', 'ask-input bi-thymer');
  thymerIn.setAttribute('aria-label', 'Thymer link');
  thymerIn.placeholder = 'The Thymer page’s link (optional): Daybook tasks pointing there will open this instead';
  const status = make('p', 'hint bi-status');
  let todoBoxes = [];

  function apply() {
    if (!asked) return;
    if (asked.title && !titleIn.dataset.touched) titleIn.value = asked.title;
    if (asked.home !== undefined && !placeSel.dataset.touched && [...placeSel.options].some((o) => o.value === asked.home)) placeSel.value = asked.home;
    if (asked.about && !aboutIn.dataset.touched) aboutIn.value = asked.about;
    if (asked.tags?.length && !tagsIn_.dataset.touched) tagsIn_.value = asked.tags.join(', ');
    drawTodos();
  }
  for (const el of [titleIn, placeSel, aboutIn, tagsIn_]) el.addEventListener('input', () => { el.dataset.touched = '1'; });
  placeSel.addEventListener('change', () => { placeSel.dataset.touched = '1'; });
  appPick.addEventListener('change', () => { thymerRow.hidden = appPick.value !== 'thymer'; });

  const field = (label, el) => { const l = make('label', 'bi-field'); l.append(make('span', '', label), el); return l; };
  const thymerRow = field('Thymer link', thymerIn);
  const todoBox = make('div', 'bi-todos');
  const tree = make('ul', 'bi-tree');
  const go = make('button', 'pill primary bi-go', 'Bring it in');
  go.type = 'button';
  const again = make('button', 'ghost-btn', 'Ask Claude again');
  again.type = 'button';
  again.addEventListener('click', () => { if (got?.lines.length && hooks.canAsk()) { for (const el of [titleIn, placeSel, aboutIn, tagsIn_]) delete el.dataset.touched; suggest(); } });

  function drawTodos() {
    todoBox.replaceChildren();
    todoBoxes = [];
    const all = got ? todosIn(got.lines) : [];
    if (!all.length) return;
    const live = new Set(asked?.todoLines || []);
    todoBox.append(make('p', 'bi-sub', `Old to-dos (${all.length}). They come in as plain lines. Tick any to send to Daybook’s Inbox too${asked ? '; Claude ticked the ones that still look alive' : ''}.`));
    for (const l of all.slice(0, 30)) {
      const row = make('label', 'bi-todo');
      const cb = make('input');
      cb.type = 'checkbox';
      cb.checked = live.has(l);
      row.append(cb, document.createTextNode(` ${l.text}`));
      todoBox.append(row);
      todoBoxes.push([cb, l]);
    }
  }

  function drawPreview() {
    preview.replaceChildren();
    if (!got) return;
    if (!got.lines.length) { preview.append(make('p', 'hint', 'Nothing to bring in yet.')); return; }
    if (!titleIn.dataset.touched) titleIn.value = got.title || '';
    const g = guessApp(src);
    if (g) appPick.value = g;
    thymerRow.hidden = appPick.value !== 'thymer';
    tree.replaceChildren();
    let shown = 0;
    const walk = (list, ul) => {
      for (const l of list) {
        if (shown >= 14) return;
        shown += 1;
        const li = make('li', '', l.text);
        ul.append(li);
        if (l.kids.length) { const sub = make('ul'); li.append(sub); walk(l.kids, sub); }
      }
    };
    walk(got.lines, tree);
    const n = countLines(got.lines);
    const actions = make('div', 'ask-actions');
    actions.append(again, go);
    preview.append(
      make('p', 'bi-sub', `${n} line${n === 1 ? '' : 's'}${n > shown ? `, first ${shown} shown` : ''}`), tree,
      field('Title', titleIn), field('Goes in', placeSel), field('About', aboutIn), field('Tags', tagsIn_), field('Came from', appPick), thymerRow,
      todoBox, status, actions
    );
    drawTodos();
    again.hidden = !hooks.canAsk();
    if (!hooks.canAsk()) status.textContent = 'Fill in where it goes, or bring it in as it is.';
  }

  go.addEventListener('click', async () => {
    if (!got?.lines.length) return;
    go.disabled = true;
    try {
      const res = await bringIn(got, {
        into: placeSel.value, title: titleIn.value, about: aboutIn.value,
        tags: tagsIn_.value.split(/[,\s]+/), app: appPick.value, name: src.file,
        toDaybook: todoBoxes.filter(([cb]) => cb.checked).map(([, l]) => l), base: hooks.base
      });
      await hooks.applied?.(res.rows);
      let note = '';
      if (res.tasks.length) { const sent = await hooks.sendTasks?.(); note = sent ? `, ${res.tasks.length} to Daybook` : ', to-dos go to Daybook once you’re online'; }
      const link = thymerIn.value.trim();
      if (appPick.value === 'thymer' && link && into(res) && hooks.relink) {
        try { const n = await hooks.relink(link, `${hooks.base}?open=${encodeURIComponent(into(res).id)}`); if (n) note += `, ${n} Daybook task${n === 1 ? '' : 's'} now open it`; } catch (e) { console.warn(e); note += ', couldn’t switch the Daybook links (try again online)'; }
      }
      hooks.toast(`“${(res.line || res.page).title || titleIn.value || 'It'}” is in${note}`.replace(/“”/, 'It'));
      // Ready for the next one.
      got = null; asked = null; src = { text: '', html: '', name: '', file: '' };
      area.value = '';
      for (const el of [titleIn, placeSel, aboutIn, tagsIn_]) delete el.dataset.touched;
      aboutIn.value = ''; tagsIn_.value = ''; thymerIn.value = ''; titleIn.value = '';
      preview.replaceChildren();
      await drawDone();
      if (files.length) await takeFile(files.shift());
      else area.focus();
    } finally { go.disabled = false; }
  });
  const into = (res) => res.line || res.page;

  async function drawDone() {
    queueNote.textContent = files.length ? `${files.length} more file${files.length === 1 ? '' : 's'} after this one` : '';
    done.replaceChildren();
    const list = await broughtIn();
    if (!list.length) return;
    const det = make('details', 'bi-list');
    det.append(make('summary', '', `Brought in so far (${list.length})`));
    const ul = make('ul');
    for (const r of list.slice(0, 100)) {
      const li = make('li');
      const open = make('button', 'link-btn', (r.kind === 'line' ? r.text.replace(/\s*#[\p{L}\p{N}_-]+/gu, '').trim() : r.title) || 'Untitled');
      open.addEventListener('click', () => { close(); hooks.open(r); });
      const when = new Date(r.fields.from.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const undo = make('button', 'ghost-btn bi-undo', 'Undo');
      undo.title = 'Send it to the Trash';
      undo.addEventListener('click', async () => { const n = await trash(r); await hooks.applied?.([]); hooks.toast(`In the Trash (${n} line${n === 1 ? '' : 's'} with it)`); drawDone(); });
      li.append(open, make('span', 'hint', ` ${APP_NAME[r.fields.from.app] || ''} · ${when}${r.kind === 'line' ? ' · Drawer' : ''} `), undo);
      ul.append(li);
    }
    det.append(ul);
    done.append(det);
  }
  await drawDone();
  area.focus();
}

