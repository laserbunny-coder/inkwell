// What shows: the one list behind the Show tab of the Aa panel and the
// "Show or hide …" commands, so the two can't drift apart.
//
// Decided with Michael on Nov 14 2026 (thread "Make the bottom menu easy to
// reach"): the 46 switches of the old flat list became these rows in five
// groups. The rest are simply how Inkwell is now (REMOVED, below); Focus still
// hides all of it at once.
//
// Each row: id (the `hide-<id>` class on <html> and the entry in
// localStorage "hide"), label (the panel), cmd (the command's label; the
// older ones keep theirs so commandinfo.js still finds them), hint and words
// for the box, under (drawn as a child of that row), off (starts off), phone
// (only on a touch screen), keys.

export const SHOW_GROUPS = [
  { id: 'writing', label: 'Writing' },
  { id: 'pages', label: 'Pages and outlines' },
  { id: 'today', label: 'Today and plan' },
  { id: 'desk', label: 'Desk and projects' },
  { id: 'around', label: 'Getting around' }
];

export const SHOWS = [
  // Writing
  { id: 'claude', group: 'writing', label: 'Claude’s notes in the margin', cmd: 'Show or hide Claude’s notes in the margin' },
  { id: 'comments', group: 'writing', label: 'Readers’ comments in the margin', cmd: 'Show or hide readers’ comments in the margin' },
  { id: 'alts', group: 'writing', label: 'Marks on words and paragraphs with alternates', cmd: 'Show or hide alternate marks' },
  { id: 'typewriter', group: 'writing', label: 'Typewriter: the line you’re on stays put', special: true },
  { id: 'sections', group: 'writing', label: 'Section titles and summaries in scripts', keys: '⌘⇧.', cmd: 'Show or hide section titles' },
  { id: 'codes', group: 'writing', label: 'Scene numbers in scripts', cmd: 'Show or hide scene numbers' },
  // Pages and outlines
  { id: 'links', group: 'pages', label: 'Linked from, under a page', cmd: 'Show or hide "Linked from"' },
  { id: 'linkpics', group: 'pages', label: 'Pictures on shared links', cmd: 'Show or hide pictures on shared links', off: true },
  { id: 'loose', group: 'pages', label: 'A ring on lines you haven’t filed, and their count under the day', cmd: 'Show or hide the ring on lines you haven’t filed', hint: 'The small ring on lines that aren’t filed anywhere yet, and how many there are under the day.', words: ['loose', 'unfiled', 'ring', 'file', 'count'] },
  // Today and plan
  { id: 'review', group: 'today', label: 'Day review on day pages', cmd: 'Show or hide the day review', hint: 'The day review card at the bottom of a day’s page.', words: ['day review', 'evening', 'review', 'end of day'] },
  { id: 'nudge', group: 'today', under: 'review', label: 'After 9 pm, a reminder on today to review it', cmd: 'Show or hide the 9 pm review reminder', hint: 'After 9 pm, a card on today asking you to review the day.', words: ['nudge', 'reminder', 'evening', 'night', '9 pm'] },
  { id: 'tidy', group: 'today', label: 'Tidy pass reminder on Today', cmd: 'Show or hide the tidy pass reminder', hint: 'The line on Today that says Claude’s tidy-ups are waiting.', words: ['tidy', 'reminder', 'suggestions', 'clean up'] },
  { id: 'calendar', group: 'today', label: 'Your Google Calendar’s events in the plan', cmd: 'Show or hide Google Calendar events', hint: 'Your Google Calendar’s events among the tasks on Today and in Calendar.', words: ['google', 'calendar', 'events', 'meetings', 'appointments'] },
  { id: 'calzoom', group: 'today', label: 'Zoom buttons (− Fit day +) on the Calendar’s Day', cmd: 'Show or hide the Calendar’s zoom buttons', hint: 'The − Fit day + buttons on the Calendar’s Day. Pinch, or Ctrl + scroll, zooms either way.', words: ['zoom', 'calendar', 'day', 'fit day', 'buttons'] },
  { id: 'estimates', group: 'today', label: 'Time estimates: how long tasks take, the hours left, and “How long did it take?”', cmd: 'Show or hide time estimates', off: true, hint: 'How long each task takes, the hours left today and each week, and the “How long did it take?” question when you tick one.', words: ['estimates', 'hours', 'minutes', 'duration', 'time', 'left today', 'how long'] },
  { id: 'donetasks', group: 'today', label: 'Done tasks stay in the list, where they were', cmd: 'Hide done tasks (or show them again, where they were)' },
  // Desk and projects
  { id: 'deskread', group: 'desk', label: 'Claude’s one-line read on the Desk', cmd: 'Show or hide Claude’s read on the Desk', hint: 'The line at the top of the Desk where Claude says what matters most.', words: ['desk', 'read', 'summary', 'claude'] },
  { id: 'deskcount', group: 'desk', label: 'How many things need you, beside Desk', cmd: 'Show or hide the count beside Desk', hint: 'The number beside Desk of the calls waiting on you.', words: ['count', 'badge', 'needs you', 'number'] },
  { id: 'nextstep', group: 'desk', label: 'Next step on Desk cards', cmd: 'Show or hide the next step on Desk cards', hint: 'Each project card’s first open step, with its circle to tick.', words: ['next step', 'desk', 'cards', 'step'] },
  { id: 'projsteps', group: 'desk', chip: 'Steps', label: 'Steps on a project’s page', cmd: 'Show or hide Steps on a project’s page', hint: 'The Steps list on a project’s own page.', words: ['steps', 'project', 'tasks'] },
  { id: 'projcrew', group: 'desk', chip: 'Crew', label: 'Crew and Turns on a project’s page', cmd: 'Show or hide Crew on a project’s page', hint: 'Who’s working on a project (people and Claude threads) on its own page.', words: ['crew', 'turns', 'nate', 'threads', 'people'] },
  { id: 'projrecent', group: 'desk', chip: 'Recently', label: '“Recently” on a project’s page', cmd: 'Show or hide Recently on a project’s page', hint: 'What changed lately, on a project’s own page.', words: ['recently', 'recent', 'changes', 'activity'] },
  // Getting around
  { id: 'pagetabs', group: 'around', label: 'Page tabs at the top', keys: '⌥0–6', cmd: 'Show or hide the page tabs', hint: 'A project’s pages (Overview, Gather, Shape, Write…) as tabs at the top.', words: ['tabs', 'pages', 'overview', 'gather', 'shape', 'top'] },
  { id: 'panes', group: 'around', label: 'Beside: a pane next to the page, and middle-click opens things there', keys: '⌘\\', cmd: 'Show or hide the Beside pane', hint: 'A pane next to the page (today’s plan, notes, anything you middle-click).', words: ['beside', 'pane', 'split', 'side by side'] },
  { id: 'manypanes', group: 'around', under: 'panes', label: 'Up to three panes in a row', special: true },
  { id: 'quietdrafts', group: 'around', phone: true, label: 'Quiet drafts: in a chapter or script the bar rests as a tab', cmd: 'Quiet drafts: the bar rests as a tab in a draft (on / off)', hint: 'On the phone, in a chapter or script with the keyboard down, the bar waits as a small tab you tap.', words: ['bar', 'bottom bar', 'tab', 'quiet', 'hide the bar', 'menu'] }
];

// Switches that went for good. Forced back on (shown) once per device, with
// their CSS and commands gone. Bullets is the one forced the other way: off.
export const REMOVED = [
  'dots', 'handle', 'taskgrip', 'scenedots', 'voice', 'woven', 'taskchips', 'tasknotes', 'repeatmark', 'repeatahead', 'marks', 'closedtag',
  'hoursleft', 'took', 'aheadhours', 'areahours', 'synopsis', 'plan', 'planview', 'projdaybook'
];

// The group to open on, for where you are.
export function groupFor(room) {
  if (room === 'script' || room === 'write') return 'writing';
  if (room === 'today' || room === 'plan' || room === 'calendar') return 'today';
  if (room === 'desk' || room === 'world') return 'desk';
  return 'pages';
}
