// Page width and text size (per device), and the Aa panel.
import { isNarrow } from '../device.js';
import { keyLabel } from '../keys.js';
import { StatsPanel, record as recordProgress } from '../stats.js';
import { toast } from '../menu.js';
import { outline } from '../model.js';
import { resetLinkPics } from '../filenode.js';
import { SHOWS, SHOW_GROUPS, groupFor } from '../shows.js';
import { nowFace, setNowFace } from '../now.js';
import { FONTS, FONT_GROUPS, DEFAULT_FONT, setFont, currentFont, loadPreviews } from '../fonts.js';
import { inPane } from '../panes.js';
import { make } from '../dom.js';
import { addCommands, mod } from './commandlist.js';
import { $, body, inNotebook, isScript, notes, root, state } from '../main.js';
import { placeScriptBar, touch } from './scriptbar.js';
import { currentEditor, notebook, placeOutlineBar, toggleTypewriter } from './notebookview.js';
import { go } from './routing.js';
import { wovenPick } from './manuscript.js';
import { box, roomTags, writing } from './commands.js';
import { deskPage, plan } from './talking.js';
import { panes, syncBeside } from './beside.js';

// ---------- panels revealed by edges ----------

// The browser can fire a stray hover when the layout shifts (like turning focus on), so edges ignore it then.
let edgesQuietUntil = 0;

// ---------- page width and text size (per device) ----------

const DEFAULT_WIDTH = 660;
const defaultSize = () => (isNarrow() ? 18 : 21);
const currentWidth = () => Number(localStorage.getItem('pageWidth')) || DEFAULT_WIDTH;
const currentSize = () => Number(localStorage.getItem('textSize')) || defaultSize();

function setPage(width, size) {
  width = Math.max(420, Math.min(1100, width));
  size = Math.max(14, Math.min(30, size));
  root.style.setProperty('--page-width', `${width}px`);
  root.style.setProperty('--text-size', `${size}px`);
  localStorage.setItem('pageWidth', String(width));
  localStorage.setItem('textSize', String(size));
  $('#page-width').value = width;
  $('#text-size').value = size;
  $('#width-value').textContent = `${width}px`;
  $('#size-value').textContent = `${size}px`;
  notes.layout();
}

// The Aa panel in three tabs: Look (the looks, motion), Text (size, width,
// font, a script's view) and Show (what shows, in five folded groups, opening
// on the group for where you are). Made once, from what index.html and
// frame.js put in it.
function lookPanel(panel) {
  const tabs = make('div', 'ps-tabs');
  tabs.setAttribute('role', 'tablist');
  const panes = {};
  for (const [id, label] of [['look', 'Look'], ['text', 'Text'], ['show', 'Show']]) {
    const b = make('button', 'ps-tab', label);
    b.type = 'button';
    b.dataset.pane = id;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => lookTab(id));
    tabs.append(b);
    panes[id] = make('div', 'ps-pane');
    panes[id].dataset.pane = id;
  }
  const show = panel.querySelector('.ps-show');
  panes.look.append(panel.querySelector('.look-pick'));
  for (const el of [panel.querySelector('.woven-pick'), $('#page-width').closest('label'), $('#text-size').closest('label'), panel.querySelector('.font-pick')]) panes.text.append(el);
  panes.show.append(show);
  panel.prepend(tabs, panes.look, panes.text, panes.show);
  // Show: one folding group each, its switches made from shows.js.
  const touchOnly = touch.matches;
  for (const g of SHOW_GROUPS) {
    const rows = SHOWS.filter((r) => r.group === g.id && (!r.phone || touchOnly));
    const box = make('div', 'ps-group');
    box.dataset.group = g.id;
    const head = make('button', 'ps-ghead');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    head.append(make('span', '', g.label), make('span', 'ps-gcount'));
    head.addEventListener('click', () => box.classList.toggle('open') ? head.setAttribute('aria-expanded', 'true') : head.setAttribute('aria-expanded', 'false'));
    const body = make('div', 'ps-gbody');
    let chipRow = null;
    for (const r of rows) {
      if (r.chip) {
        if (!chipRow) { chipRow = make('div', 'ps-chips'); chipRow.append(make('span', '', 'On a project’s page:')); body.append(chipRow); }
        const c = make('button', 'ps-chip', r.chip);
        c.type = 'button';
        c.dataset.show = r.id;
        c.addEventListener('click', () => setShown(r.id, hidden().has(r.id)));
        chipRow.append(c);
        continue;
      }
      // A choice of a few (how Now looks): one row of buttons, kept on this device.
      if (r.choice) {
        const row = make('div', 'ps-choice');
        row.append(make('span', 'ps-choice-l', r.label));
        const seg = make('div', 'ps-seg');
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', r.label);
        for (const [v, l] of r.choice) {
          const b = make('button', '', l);
          b.type = 'button';
          b.dataset.choice = r.id;
          b.dataset.v = v;
          b.setAttribute('role', 'radio');
          b.addEventListener('click', () => { setChoice(r.id, v); });
          seg.append(b);
        }
        row.append(seg);
        body.append(row);
        continue;
      }
      const label = make('label', `switch${r.under ? ' sub' : ''}`);
      const input = make('input');
      input.type = 'checkbox';
      if (r.id === 'typewriter') input.id = 'typewriter-mode';
      else if (r.id === 'manypanes') input.id = 'many-panes';
      else input.dataset.show = r.id;
      label.append(input, ` ${r.label}`);
      if (r.keys) { const k = make('span', 'keys', keyLabel(r.keys)); label.append(' ', k); }
      body.append(label);
    }
    head.querySelector('.ps-gcount').textContent = String(rows.filter((r) => !r.chip).length + (chipRow ? 1 : 0));
    box.append(head, body);
    show.append(box);
  }
}
function lookTab(id) {
  const panel = $('.page-settings');
  panel.dataset.tab = id;
  panel.querySelectorAll('.ps-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pane === id)));
  panel.querySelectorAll('.ps-pane').forEach((p) => { p.hidden = p.dataset.pane !== id; });
  panel.scrollTop = 0;
}
function togglePageSettings(tab = 'look') {
  const panel = $('.page-settings');
  if (!panel.hidden) { panel.hidden = true; if (!touch.matches) currentEditor().commands.focus(); return; }
  setPage(currentWidth(), currentSize());
  loadPreviews();
  showFonts();
  wovenPick();
  // Show opens on the group for where you are; the others are folded.
  const here = groupFor(roomTags()[0]);
  panel.querySelectorAll('.ps-group').forEach((g) => { const on = g.dataset.group === here; g.classList.toggle('open', on); g.querySelector('.ps-ghead').setAttribute('aria-expanded', String(on)); });
  lookTab(tab);
  panel.hidden = false;
  if (!touch.matches) panel.querySelector('.ps-tab[aria-selected="true"]')?.focus();
}

// Display switches, per device: anything beyond the text can be turned off.
const hidden = () => { try { return new Set(JSON.parse(localStorage.getItem('hide') || '[]')); } catch { return new Set(); } };
function setShown(name, on) {
  const h = hidden();
  if (on) h.delete(name); else h.add(name);
  localStorage.setItem('hide', JSON.stringify([...h]));
  root.classList.toggle(`hide-${name}`, !on);
  if (name === 'claude' || name === 'comments') notes.render();
  if (name === 'linkpics') resetLinkPics();
  if (name === 'panes') { if (!on) panes?.closeAll(); panes?.layout(); }
  if (name === 'closedtag' && deskPage?.showing() && deskPage.now) deskPage.render({ now: deskPage.now, failed: false });
  if (['estimates', 'woven', 'planview', 'foldearlier', 'areahours', 'aheadhours', 'donetasks', 'nowgate', 'smallsgo', 'rowdetails'].includes(name)) { if (plan) { plan.peekDone = false; plan.just = null; plan.took = null; } plan?.refresh(); }
  if (name === 'nextstep') deskPage?.refresh();
  syncSwitches();
}
// Reading a script through: only the script pages, no sections, notes or tools.
function toggleReading() {
  const on = !root.classList.contains('reading');
  if (on !== root.classList.contains('focus')) toggleFocus();
  root.classList.toggle('reading', on);
}

function toggleFocus() {
  const on = !root.classList.contains('focus');
  root.classList.toggle('focus', on);
  if (!on) root.classList.remove('reading');
  // Focus is only the words: what's beside steps out, and is back when you leave.
  if (!inPane) { panes?.layout(); syncBeside(); }
  localStorage.setItem('focus', on ? '1' : '0');
  edgesQuietUntil = Date.now() + 600;
  body.classList.remove('show-outline', 'show-top', 'bar-peek');
  syncSwitches();
  placeScriptBar(); placeOutlineBar();
  box?.refreshQuick?.();
}
// A script's own section titles and summaries (not the INT./EXT. ones), on or
// off where you are: in Focus they stay away unless you ask for them, outside
// it they show unless you put them away.
function toggleFocusSections(on = !root.classList.contains('focus-sections')) {
  root.classList.toggle('focus-sections', on);
  localStorage.setItem('focusSections', on ? '1' : '0');
  syncSwitches();
}
function toggleSections() {
  const showing = root.classList.contains('focus') ? root.classList.contains('focus-sections') : !hidden().has('sections');
  if (root.classList.contains('focus')) toggleFocusSections(!showing); else setShown('sections', !showing);
  if (writing() && isScript()) toast(showing ? 'Section titles hidden' : 'Section titles showing');
}
// The phone's bar rests as a tab in Focus, and in a draft (a chapter or a
// script) unless "Quiet drafts" is off. The computer's rail never covers the
// text, so there only Focus counts (the tab in the corner, frame.css).
function syncQuiet() {
  const draft = (root.dataset.view || 'write') === 'write';
  const quiet = root.classList.contains('focus') || (touch.matches && draft && !hidden().has('quietdrafts'));
  body.classList.toggle('bar-quiet', quiet);
  if (!quiet) body.classList.remove('bar-peek');
}
// A choice row (shows.js `choice`): only Now's face for now.
const choiceOf = (id) => (id === 'nowface' ? nowFace() : null);
function setChoice(id, v) {
  if (id === 'nowface') { setNowFace(v); plan?.redraw(); }
  syncSwitches();
}
function syncSwitches() {
  const h = hidden();
  document.querySelectorAll('[data-choice]').forEach((b) => b.setAttribute('aria-checked', String(choiceOf(b.dataset.choice) === b.dataset.v)));
  document.querySelectorAll('[data-show]').forEach((c) => { c.checked = !h.has(c.dataset.show); });
  $('#many-panes').checked = localStorage.getItem('manyPanes') === '1';
  $('#focus-toggle').setAttribute('aria-pressed', String(root.classList.contains('focus')));
  document.querySelectorAll('.ps-show .switch input').forEach((c) => c.closest('.switch').classList.toggle('on', c.checked));
  document.querySelectorAll('.ps-chip[data-show]').forEach((b) => b.setAttribute('aria-pressed', String(!hidden().has(b.dataset.show))));
}

// Next or previous chapter in the book, or day on a daily page.
async function step(dir) {
  if (inNotebook()) return notebook.step(dir);
  if (!writing() || !state.project) return;
  const chapters = (await outline(state.project.id)).flatMap((a) => a.chapters);
  const i = chapters.findIndex((c) => c.id === state.chapterId);
  const next = chapters[i + dir];
  if (next) go({ view: 'write', chapterId: next.id });
}

let progressPanel; // set in wirePageSettings()
const toggleShortcuts = () => { const s = $('.shortcuts'); s.hidden = !s.hidden; if (s.hidden) currentEditor().commands.focus(); };

// Font picker: Serif / Sans / Mono, then each font written in its own face.
let fontGroup = null;
function showFonts() {
  const cur = currentFont();
  fontGroup ||= cur.group;
  $('#font-value').textContent = cur.name;
  $('.font-groups').replaceChildren(...FONT_GROUPS.map(([g, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.setAttribute('role', 'tab');
    b.classList.toggle('current', g === fontGroup);
    b.setAttribute('aria-selected', String(g === fontGroup));
    b.addEventListener('click', () => { fontGroup = g; showFonts(); });
    return b;
  }));
  $('.font-list').replaceChildren(...FONTS.filter((f) => f.group === fontGroup).map((f) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.font = f.id; b.setAttribute('role', 'radio');
    const name = document.createElement('span'), about = document.createElement('span');
    name.className = 'font-name'; name.textContent = f.name;
    about.className = 'font-about'; about.textContent = f.about;
    b.append(name, about);
    b.classList.toggle('current', f === cur);
    b.setAttribute('aria-checked', String(f === cur));
    b.addEventListener('click', () => pickFont(f.id));
    return b;
  }));
}
function pickFont(id) {
  setFont(id);
  fontGroup = currentFont().group;
  showFonts();
  notes.layout();
}

// Its commands in the box (Ctrl + K); commandinfo.js has their hints and words.
addCommands(() => [
  { group: 'go', label: 'Next chapter (or day)', keys: `${mod}⌥↓`, run: () => step(1), when: () => writing() || inNotebook() },
  { group: 'go', label: 'Previous chapter (or day)', keys: `${mod}⌥↑`, run: () => step(-1), when: () => writing() || inNotebook() },
  { group: 'view', label: 'Read it through: just the script pages', keys: 'Esc to stop', run: toggleReading, when: () => writing() && isScript() },
  { group: 'view', label: 'Focus: just the text (on / off)', keys: `${mod}.`, run: toggleFocus },
  { group: 'view', label: 'Show or hide "Linked from"', keys: '', run: () => setShown('links', hidden().has('links')) },
  { group: 'view', label: 'Show or hide alternate marks', keys: '', run: () => setShown('alts', hidden().has('alts')) },
  { group: 'plan', label: 'Hide done tasks (or show them again, where they were)', keys: '', run: () => { const show = hidden().has('donetasks'); setShown('donetasks', show); toast(show ? 'Done tasks show again, where they were' : 'Done tasks are out of sight (tap “N done” to see them)'); } },
  { group: 'view', label: 'Show or hide pictures on shared links', keys: '', run: () => setShown('linkpics', hidden().has('linkpics')) },
  { group: 'view', label: 'Progress: words and pages over time (stats)', keys: `${mod}⇧P`, run: () => progressPanel.open() },
  { group: 'view', label: 'Keyboard shortcuts (all the keys)', keys: `${mod}/`, run: toggleShortcuts },
  { group: 'page', label: 'Look, page and text settings (Aa)', keys: '', words: ['look', 'looks', 'theme', 'themes', 'colour', 'colours', 'color', 'colors', 'dark', 'light', 'appearance', 'aa', 'settings', 'midnight', 'lamplight', 'ember', 'candle', 'night shift', 'graphite', 'typewriter', 'paper', 'motion', 'text size', 'font'], run: togglePageSettings },
  { group: 'page', label: 'Wider page', keys: 'Alt+]', run: () => setPage(currentWidth() + 40, currentSize()) },
  { group: 'page', label: 'Narrower page', keys: 'Alt+[', run: () => setPage(currentWidth() - 40, currentSize()) },
  { group: 'page', label: 'Larger text', keys: 'Alt+=', run: () => setPage(currentWidth(), currentSize() + 1) },
  { group: 'page', label: 'Smaller text', keys: 'Alt+−', run: () => setPage(currentWidth(), currentSize() - 1) },
  { group: 'view', label: 'Show or hide scene numbers', keys: '', run: () => setShown('codes', hidden().has('codes')), when: () => writing() && isScript() },
  { group: 'view', label: 'Show or hide section titles', keys: '⌘⇧.', run: () => toggleSections(), when: () => writing() && isScript() },
  { group: 'view', label: 'Show or hide Claude’s notes in the margin', keys: '', run: () => setShown('claude', hidden().has('claude')) },
  { group: 'view', label: 'Show or hide readers’ comments in the margin', keys: '', run: () => setShown('comments', hidden().has('comments')) }
]);

// Runs once at start-up, from main.js, in the place this code had there
// (what it sets up depends on what came before it).
function wirePageSettings() {
  new MutationObserver(syncQuiet).observe(root, { attributes: true, attributeFilter: ['class', 'data-view'] });
  touch.addEventListener?.('change', syncQuiet);
  progressPanel = new StatsPanel($('.stats'), { onClose: () => currentEditor().commands.focus() });
  if (!inPane) {
    document.addEventListener('visibilitychange', () => { if (document.hidden) recordProgress().catch(() => {}); });
    // Once things have settled after opening.
    setTimeout(() => recordProgress().catch((e) => console.error(e)), 20000);
  }
  document.querySelectorAll('[data-show]').forEach((c) => c.addEventListener('change', () => setShown(c.dataset.show, c.checked)));
  // One pane beside unless you ask for a row of them. Back to one: the last one stays.
  $('#many-panes').addEventListener('change', (e) => {
    if (e.target.checked) localStorage.setItem('manyPanes', '1');
    else { localStorage.removeItem('manyPanes'); for (const p of (panes?.panes || []).slice(0, -1)) panes.close(p.id); }
  });
  $('#typewriter-mode').checked = root.classList.contains('typewriter');
  $('#typewriter-mode').addEventListener('change', toggleTypewriter);
  syncSwitches();
  syncQuiet();
  $('#page-width').addEventListener('input', (e) => setPage(Number(e.target.value), currentSize()));
  $('#text-size').addEventListener('input', (e) => setPage(currentWidth(), Number(e.target.value)));
  $('#page-reset').addEventListener('click', () => { setPage(DEFAULT_WIDTH, defaultSize()); pickFont(DEFAULT_FONT); });
  $('#page-done').addEventListener('click', () => togglePageSettings());
}

export { currentSize, currentWidth, edgesQuietUntil, hidden, lookPanel, lookTab, progressPanel, setPage, setShown, step, toggleFocus, togglePageSettings, toggleReading, toggleSections, toggleShortcuts, wirePageSettings };
