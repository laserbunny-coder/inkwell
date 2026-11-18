// What shows: the one list behind the Show tab of the Aa panel and the
// "Show or hide …" commands, so the two can't drift apart.
//
// The short panel (Nov 17 2026, Michael's keep-or-go page): eight switches in
// one list, and nothing else. Everything else is simply how Inkwell is now
// (REMOVED, below), or went. A new visible element does NOT get a switch here
// by default: ask in the design thread before adding a ninth.
//
// Each row: id (the `hide-<id>` class on <html> and the entry in
// localStorage "hide"), label (the panel), cmd (the command's label, so
// commandinfo.js finds it), off (starts off), keys, special (wired by hand).

export const SHOWS = [
  { id: 'donetasks', label: 'Done tasks stay in the list, where they were', cmd: 'Hide done tasks (or show them again, where they were)' },
  { id: 'linkpics', label: 'Pictures on shared links', cmd: 'Show or hide pictures on shared links', off: true },
  { id: 'claude', label: 'Claude’s notes in the margin', cmd: 'Show or hide Claude’s notes in the margin' },
  { id: 'comments', label: 'Readers’ comments in the margin', cmd: 'Show or hide readers’ comments in the margin' },
  { id: 'typewriter', label: 'Typewriter: the line you’re on stays put', special: true },
  { id: 'sections', label: 'Section titles and summaries in scripts', keys: '⌘⇧.', cmd: 'Show or hide section titles' },
  { id: 'codes', label: 'Scene numbers in scripts', cmd: 'Show or hide scene numbers' },
  { id: 'manypanes', label: 'Up to three panes in a row', special: true }
];

// Switches that went for good. Forced back on (shown) once per device, with
// their CSS and commands gone. Bullets is the one forced the other way: off.
export const REMOVED = [
  'dots', 'handle', 'taskgrip', 'scenedots', 'voice', 'woven', 'taskchips', 'tasknotes', 'repeatmark', 'repeatahead', 'marks', 'closedtag',
  'hoursleft', 'took', 'aheadhours', 'areahours', 'synopsis', 'plan', 'planview', 'projdaybook',
  // Nov 17 2026, with the old layout (zoom Part 6): these two are simply always on now.
  'deskcount', 'pagetabs',
  // Nov 17 2026, the short panel: he kept each of these, so they are always on.
  'calendar', 'dayparts', 'nowout', 'nowfiled', 'firstlight', 'readstreak', 'readprogress', 'training', 'trainstreak', 'traincharts',
  'nowtalk', 'nowclose', 'nowevents', 'nextstep', 'projsteps', 'projcrew', 'panes', 'links', 'alts',
  // Nov 17 2026, the short panel: these features went with their switches.
  'nowgate', 'smallsgo', 'fivebig', 'review', 'nudge', 'tidy', 'loose', 'deskread', 'projrecent', 'calzoom'
];
