// What every command in the box is, in plain words: its group, one line on
// what it does (hint), more words that find it (what it does, not only its
// name), the rooms it fits (where: shown under "Right here" there), and why
// it can't run when it can't (needs: shown dimmed with that reason instead
// of hidden, so the whole list can be learned).
//
// Keyed by the command's label (each part of the app adds its own commands
// with addCommands, app/commandlist.js). tests/box.mjs checks that every
// command has a group, a hint and words, so a new or renamed command can't
// be left out.
//
// Rooms (where): today (a day's page), plan (Plan), calendar (Calendar's
// day, week and six weeks), desk, library (also the Drawer and Tags), write
// (a chapter), script (a script), page (a page that isn't a day), world
// (a project's own pages).

// The groups, in the order they're listed. Used lately and Right here sit above them.
export const GROUPS = [
  { id: 'go', label: 'Go', hint: 'Rooms, places, back and forward' },
  { id: 'plan', label: 'Plan and tasks', hint: 'Tasks, days, When, going through, calendars, repeats' },
  { id: 'new', label: 'New', hint: 'Projects, pages, chapters, voice captures, bringing things in' },
  { id: 'write', label: 'Write', hint: 'Lines, links, notes, alternates, script parts, history' },
  { id: 'view', label: 'View', hint: 'Focus, panes, what shows on the page, grid, production' },
  { id: 'page', label: 'Page and text', hint: 'Look, width, text size, font, light or dark' },
  { id: 'revise', label: 'Revise and share', hint: 'Compare drafts, new draft, Claude’s notes, print, share a link' },
  { id: 'tidy', label: 'Organize', hint: 'Rename, move, change kind, meetings, Trash' },
  { id: 'sync', label: 'Sync and backup', hint: 'Sync, export, back up, connect Claude, Scribe and calendars' }
];

// Why a command can't run here (shared words).
const N = {
  chapter: 'Open a chapter or script first',
  text: 'Click into a chapter, page or day first',
  script: 'Open a script first',
  woven: 'Open a script in the Woven view first',
  line: 'Click into a page or day first',
  onLine: 'Click on a line first',
  piece: 'Open a piece first',
  book: 'Open a book first',
  world: 'Open a project first',
  day: 'Open a day’s page first',
  page: 'Open a page (not a day) first',
  pane: 'Not inside a pane, or with Beside switched off (Look)',
  computer: 'On a computer only',
  signedIn: 'Sign in to sync first',
  meeting: 'Open a meeting page first',
  meetingOnline: 'Open a meeting page while signed in and online',
  recording: 'Click on a recording’s line while signed in and online'
};

// { l: label, g: group, h: hint, w: words, at: rooms, n: why it can't run }
export const INFO = [
  // ---------- Go ----------
  { l: 'Back to the last place', g: 'go', h: 'Straight back to where you just were. Enter in a just-opened box does it too.', w: ['back', 'return', 'previous', 'last', 'jump'] },
  { l: 'Today’s page', g: 'go', h: 'Today’s daily page, from anywhere.', w: ['day', 'daily', 'journal', 'diary', 'today'] },
  { l: 'Desk: every project, what needs you and who’s working on it', g: 'go', h: 'The Desk: your projects in your order, the calls waiting on you and the Claude threads at work.', w: ['projects', 'threads', 'claude', 'needs you', 'calls', 'stage'] },
  { l: 'Library', g: 'go', h: 'Your areas and the projects in them, on shelves.', w: ['shelves', 'areas', 'books', 'worlds', 'projects', 'all'] },
  { l: 'The Drawer: ideas with no home yet', g: 'go', h: 'Ideas you’ve put away until they find a project.', w: ['ideas', 'someday', 'parked', 'jackie chan'] },
  { l: 'Tags: every tag, grouped', g: 'go', h: 'Every #tag you’ve used, and the lines that carry each one.', w: ['hashtag', 'labels', '#'] },
  { l: 'Catch-up: what your Claude threads did (bottom of the Desk)', g: 'go', h: 'What each Claude thread has reported, newest first, at the bottom of the Desk.', w: ['catch up', 'catchup', 'threads', 'updates', 'claude', 'news', 'reports'] },
  { l: 'History: every Claude thread, newest first', g: 'go', h: 'Every Claude thread there has been, to search and reopen.', w: ['threads', 'closed', 'finished', 'old', 'past', 'find a thread'], at: ['desk'] },
  { l: 'Search inside all your writing', g: 'go', h: 'Finds any word in anything you’ve written, not only names.', w: ['find', 'look for', 'full text', 'every word', 'grep'] },
  { l: 'Back to writing', g: 'go', h: 'Back to the chapter you were writing.', w: ['write', 'manuscript', 'chapter', 'return'], n: 'You’re already writing' },
  { l: 'Next chapter (or day)', g: 'go', h: 'On to the next chapter, or the next day on a daily page.', w: ['forward', 'following', 'tomorrow'], n: N.text },
  { l: 'Previous chapter (or day)', g: 'go', h: 'Back to the chapter before, or the day before.', w: ['back', 'before', 'yesterday', 'earlier'], n: N.text },
  { l: 'Side panel with today’s lines, beside what you’re doing', g: 'go', h: 'Keeps today’s lines open at the side while you write elsewhere.', w: ['panel', 'side', 'today', 'glance'] },

  // ---------- Plan and tasks ----------
  { l: 'Add a task', g: 'plan', h: 'From anywhere: type it in this box. A word at the end sets the day (fri, tomorrow, next week).', w: ['new task', 'todo', 'to-do', 'remember', 'jot', 'reminder'] },
  { l: 'Now: the one thing you’re on', g: 'plan', h: 'Today’s first view: the one thing you’re on, in large type, with Done and Not now. Alt + 1 from anywhere.', w: ['now', 'one thing', 'focus', 'current', 'today', 'next', 'single', 'one at a time'], at: ['today', 'plan', 'calendar'] },
  { l: 'Today: today’s page with its plan', g: 'plan', h: 'Today’s page with the day’s tasks in order (Page, Alt + 2).', w: ['today', 'plan', 'day', 'tasks', 'page', 'agenda'] },
  { l: 'Now: Done with the one thing', g: 'plan', h: 'Ticks the one thing done, then shows what’s next and waits for Begin. On Now, the D key does it.', w: ['done', 'finished', 'tick', 'check', 'complete'], n: 'Open Now (Alt + 1) first' },
  { l: 'Now: Not now (later today, enough for today, another day)', g: 'plan', h: 'Sets the one thing aside: to the end of today, back tomorrow counted as worked on, or off today under Not planned. On Now, the N key.', w: ['not now', 'later', 'tomorrow', 'set aside', 'postpone', 'another day', 'worked on', 'skip'], n: 'Begin something on Now (Alt + 1) first' },
  { l: 'Now: Begin the next thing', g: 'plan', h: 'Makes what Now offers next the one thing you’re on. On Now, the B key.', w: ['begin', 'start', 'next', 'go', 'gate'], n: 'Open Now (Alt + 1) with nothing begun' },
  { l: 'Now: what is next today (show or hide the list)', g: 'plan', h: 'Opens the rest of today under the one thing, to drag into order or pick another. On Now, the Space bar.', w: ['next', 'list', 'more today', 'choose another', 'queue', 'reorder'], n: 'Open Now (Alt + 1) first' },
  { l: 'Now: the day beside the one thing, or one column', g: 'plan', h: 'On a computer: the one thing on the left and the day as a line on the right, or back to one column. Alt + P on Now.', w: ['side by side', 'column', 'beside', 'layout', 'flip', 'two columns'], n: 'Open Now (Alt + 1) on a computer first' },
  { l: 'Show the one thing: Alone', g: 'plan', h: 'Now shows the one thing alone, with one quiet line for what’s next.', w: ['now', 'face', 'alone', 'minimal', 'look'] },
  { l: 'Show the one thing: With what is next', g: 'plan', h: 'Now shows the one thing, with the names of what’s next fading out beneath it.', w: ['now', 'face', 'next', 'queue', 'look'] },
  { l: 'Show the one thing: The day as a line', g: 'plan', h: 'Now shows the day on one thin line: what’s done, the one thing, what’s next.', w: ['now', 'face', 'line', 'thread', 'timeline', 'look'] },
  { l: 'Show or hide the pause before the next thing', g: 'plan', h: 'After Done or Not now, Now shows what’s next and waits for Begin. Off: the next one starts by itself.', w: ['gate', 'begin', 'next', 'pause', 'decide', 'automatic'] },
  { l: 'Show or hide small things as one entry', g: 'plan', h: 'In Now, today’s small things and habits ride as one entry, done one after another.', w: ['small things', 'small', 'habits', 'minor', 'group', 'batch'] },
  { l: 'While you write a draft, show: Nothing', g: 'plan', h: 'In a chapter or script only the text shows: no strip, no dot. A calendar event still says its name five minutes before (if that is on).', w: ['draft', 'writing', 'nothing', 'only the text', 'distraction', 'strip'] },
  { l: 'While you write a draft, show: A small dot', g: 'plan', h: 'In a chapter or script a faint dot sits top right; tap it to see the one thing for that visit.', w: ['draft', 'writing', 'dot', 'small', 'strip'] },
  { l: 'While you write a draft, show: The strip', g: 'plan', h: 'In a chapter or script the strip with the one thing, Done and Not now stays under the top bar.', w: ['draft', 'writing', 'strip', 'one thing'] },
  { l: 'Show or hide where the one thing lives', g: 'plan', h: 'The faint line under the one thing in Now that names where it lives and opens it (Enter or O).', w: ['where', 'place', 'open', 'script', 'page', 'now'] },
  { l: 'Show or hide the strip that travels', g: 'plan', h: 'Away from Today, a thin strip under the top bar keeps the one thing in view: its name (back to Now), Done and Not now.', w: ['strip', 'bar', 'reminder', 'one thing', 'now', 'travel'] },
  { l: 'Show or hide fixed times while you write', g: 'plan', h: 'Five minutes before a calendar event its name shows in the strip, in a draft and in Focus too.', w: ['calendar', 'event', 'meeting', 'lesson', 'draft', 'focus', 'fixed times'] },
  { l: 'Show or hide the line to get it out of your head', g: 'plan', h: 'The line at the bottom of Now (and its mic): a thought goes on today’s page and you stay on the one thing.', w: ['thought', 'capture', 'brain dump', 'idea', 'now'] },
  { l: 'Talk the day through (what is in front of you today)', g: 'plan', h: 'In the morning, say what is in front of you today, typed or with the mic. Claude lays the day out as one list you can drag, with what was already on today in it. Undo puts it back. T on Now.', w: ['morning', 'talk', 'lay out', 'plan the day', 'now'] },
  { l: 'Close the day (what you did, two questions, first thing tomorrow)', g: 'plan', h: 'What you did today, a line for what the screen did not see, where you felt alive and where drained, and what is first tomorrow. Written on today’s page; the first thing goes to the top of tomorrow. C on Now after 5 pm.', w: ['evening', 'close', 'reflect', 'tomorrow', 'wrap up'] },
  { l: 'Training: the sessions and their exercises', g: 'go', h: 'The Training page: the sessions in the order they take turns, an exercise per line, a ladder’s steps under it. Tap an exercise’s amounts to change them.', w: ['training', 'workout', 'sessions'] },
  { l: 'Show or hide Training', g: 'plan', h: 'A line “Training” on each day but Sunday, one exercise at a time in Now, and your training goals on the Desk.', w: ['training', 'workout', 'exercise', 'session'] },
  { l: 'Show or hide the reading streak', g: 'plan', h: 'On the Desk: days you read in a row and twelve weeks of dots, seven days a week. Tap a day in the past week to correct it. A missed day just starts the count again.', w: ['streak', 'days in a row', 'reading', 'bible'] },
  { l: 'Show or hide the reading progress', g: 'plan', h: 'On the Desk: where you are in each of the four reading tracks, with a thin bar of how far through it you are.', w: ['progress', 'reading', 'bible', 'tracks'] },
  { l: 'Show or hide the training streak', g: 'plan', h: 'On the Desk: days in a row and twelve weeks of dots. Sundays never count and never break it. A missed day just starts the count again.', w: ['streak', 'days in a row', 'dots', 'training'] },
  { l: 'Show or hide the training charts', g: 'plan', h: 'On the Desk: tap a training goal for its chart over the last twelve weeks, and a quiet “Best yet” after a session.', w: ['chart', 'charts', 'graph', 'progress', 'training'] },
  { l: 'Today’s reading (First light)', g: 'plan', h: 'Your six chapters for today in Now: read them there, or say you read them. Set where you are in each of the four tracks.', w: ['bible', 'reading', 'esv', 'scripture', 'first light', 'chapters'] },
  { l: 'Show or hide First light', g: 'plan', h: 'Today’s Bible reading in Now, the first time Today opens each day, before anything else.', w: ['bible', 'reading', 'first light', 'morning'] },
  { l: 'Show or hide the morning talk on Now', g: 'plan', h: '“Talk the day through” on Now, when nothing is laid out for today yet.', w: ['morning', 'talk', 'day', 'now'] },
  { l: 'Show or hide the close of the day', g: 'plan', h: '“Close the day” on Now after 5 pm, and on the 9 pm card on today’s page.', w: ['evening', 'close', 'reflect', 'now'] },
  { l: 'Show or hide where a thought was filed', g: 'plan', h: 'The quiet note after a thought on today’s page saying where Claude filed it.', w: ['filed', 'drawer', 'workshop', 'look up', 'thought'] },
  { l: 'Show or hide the five big things limit', g: 'plan', h: 'A sixth big thing added to today waits in Plan under Not planned, with Undo. Drags in Plan are never stopped.', w: ['five', 'limit', 'cap', 'too much', 'big things', 'overload'] },
  { l: 'Show or hide details on plan rows', g: 'plan', h: 'Plan rows show only the tick and the words. On: where it’s written, its day, whose it is, the timer and the estimate come back.', w: ['details', 'plain', 'rows', 'project', 'place', 'meta', 'clutter', 'minimal'] },
  { l: 'Plan: today, tomorrow, this week, next week, this month, later, not planned', g: 'plan', h: 'One list from today outward, to put things in order and drag them between days.', w: ['what’s when', 'whats when', 'when', 'planning', 'schedule', 'later', 'month', 'next week', 'loose', 'not planned', 'outline', 'list'] },
  { l: 'When: plan this line (today, this week, next week, later…)', g: 'plan', h: 'Moves a task (or makes this line one) to a day, a week, a month or later.', w: ['when', 'move', 'reschedule', 'postpone', 'defer', 'push', 'snooze', 'schedule', 'plan', 'day', 'tomorrow', 'friday', 'monday', 'week', 'month', 'later', 'date', 'due'], at: ['plan', 'page'], n: 'Click on a line, or pick a task in a plan, first' },
  { l: 'Task: put this line on a day’s plan (again: a plain line)', g: 'plan', h: 'Turns the line you’re on into a task (or back into a plain line).', w: ['todo', 'to-do', 'make task', 'plan', 'schedule', 'today', 'action'], at: ['page'], n: N.line },
  { l: 'Bring earlier days to today (every task left from before, onto today)', g: 'plan', h: 'Every task left from earlier days moves onto today in one go. Undo puts them back.', w: ['carried', 'earlier', 'overdue', 'late', 'move', 'today', 'left over', 'catch up', 'roll over'], at: ['today', 'plan'] },
  { l: 'Go through the tasks left from earlier days: keep, not today, or delete', g: 'plan', h: 'One task at a time from earlier days: keep it for today, not today, done or delete.', w: ['carried', 'overdue', 'old tasks', 'pile', 'triage', 'clear', 'review', 'earlier days'], at: ['today'] },
  { l: 'From a project: open one next to the plan, to drag its steps in', g: 'plan', h: 'Opens a project beside the plan, so you can drag its steps onto a day.', w: ['pull', 'project', 'beside', 'plan', 'drag', 'split', 'steps', 'pull from a project'], at: ['today', 'plan', 'calendar'] },
  { l: 'Calendar: day (today’s hours)', g: 'plan', h: 'The day as a calendar: hours down the side, tasks placed where you put them.', w: ['calendar', 'day', 'hours', 'time', 'schedule', 'timeline', 'see the day as a calendar'], at: ['today', 'calendar'] },
  { l: 'Calendar: week (seven days, and what’s for any day this week)', g: 'plan', h: 'Seven days side by side, with a tray for things that can go any day this week.', w: ['calendar', 'week', 'plan', 'tasks', 'schedule', 'tray', 'any day', 'seven days'], at: ['plan', 'calendar'] },
  { l: 'Calendar: six weeks (a lane for each project)', g: 'plan', h: 'Six weeks ahead, with a lane for each project and its dates.', w: ['calendar', 'weeks ahead', 'ahead', 'six weeks', 'roadmap', 'weeks', 'months', 'dates', 'deadline', 'milestone', 'schedule', 'timeline', 'stretch'], at: ['calendar'] },
  { l: 'Calendar: pace (what you planned against what it really took)', g: 'plan', h: 'What you planned beside what it really took, looking back.', w: ['calendar', 'pace', 'plan', 'tasks', 'time', 'estimate', 'looking back', 'hours'], n: 'Turn on Time estimates (Look) first' },
  { l: 'Go through loose lines: the last week’s unfiled lines, one at a time', g: 'plan', h: 'The last week’s lines that aren’t filed anywhere, one at a time, to file, plan or let go.', w: ['sort', 'file', 'loose', 'triage', 'review', 'inbox', 'tidy', 'unfiled'], at: ['today'] },
  { l: 'Go through what needs you: the Desk’s calls, one at a time', g: 'plan', h: 'The calls waiting on you from Claude threads, one at a time.', w: ['calls', 'needs you', 'decide', 'desk', 'triage', 'waiting', 'answer'], at: ['desk'] },
  { l: 'Review the day with Claude (what to plan, what to keep thinking about)', g: 'plan', h: 'Claude reads the day’s lines and suggests what to plan and what to keep thinking about.', w: ['review', 'evening', 'end of day', 'reflect', 'claude', 'plan tomorrow'], n: N.day },
  { l: 'Done: strike this line through', g: 'plan', h: 'Ticks the line you’re on off (strikes it through). Again to undo.', w: ['tick', 'complete', 'finish', 'check off', 'strike'], n: N.line },
  { l: 'Checklist: tick boxes on the lines under this one', g: 'plan', h: 'Gives every line under this one a box to tick.', w: ['todo', 'to-do', 'list', 'checkbox', 'tick', 'boxes'] },
  { l: 'Not a checklist (take the boxes off the lines under this one)', g: 'plan', h: 'Takes the tick boxes off the lines under this one.', w: ['checklist', 'checkbox', 'remove boxes'] },
  { l: 'Box on this line (tick it when done; or type [ ] at the start)', g: 'plan', h: 'A tick box on just this line.', w: ['checkbox', 'todo', 'to-do', 'tick'] },
  { l: 'No box on this line (a note, not a thing to do)', g: 'plan', h: 'Takes the tick box off this line: it’s a note, not a thing to do.', w: ['checkbox', 'tick', 'remove box'] },
  { l: 'Phone alerts (day review, Needs you, your week and month)…', g: 'plan', h: 'Which reminders reach your phone: the day review, Needs you, your week and month.', w: ['notifications', 'reminders', 'push', 'phone', 'alarm', 'nudge'] },

  // ---------- New ----------
  { l: 'New project: what are you making?', g: 'new', h: 'A new project: a story, a show, a life project. It asks what you’re making.', w: ['world', 'universe', 'collection', 'life', 'start', 'create'], at: ['library'] },
  { l: 'New page', g: 'new', h: 'A blank page for notes, here (in the project you’re in) or loose.', w: ['note', 'blank', 'create', 'bible page'], at: ['library', 'world'] },
  { l: 'New piece in this world (a gag, an episode, a season…)', g: 'new', h: 'Something new to make in this project: a gag, an episode, a season, a film.', w: ['episode', 'gag', 'season', 'short', 'reel', 'create'], at: ['world'], n: N.world },
  { l: 'Capture an idea by voice (it lands where you are)', g: 'new', h: 'Talk; Claude writes it up where you are (on today when you’re not in a text).', w: ['dictate', 'voice', 'walk', 'speak', 'talk', 'draft', 'record', 'mic'] },
  { l: 'Capture from a recording file…', g: 'new', h: 'Turns an audio file you already have into lines, like a voice capture.', w: ['audio', 'voice memo', 'upload', 'draft', 'mp3', 'file'] },
  { l: 'Make meeting notes from a recording (summary, decisions, tasks, who said what)…', g: 'new', h: 'From a recording: a summary, the decisions, the tasks and who said what.', w: ['meeting', 'minutes', 'call', 'transcript', 'nate', 'recording'] },
  { l: 'New novel', g: 'new', h: 'A new novel, written in chapters.', w: ['book', 'prose', 'fiction', 'create'] },
  { l: 'New screenplay', g: 'new', h: 'A new script, in screenplay form.', w: ['script', 'film', 'movie', 'create'] },
  { l: 'New notes collection', g: 'new', h: 'A new book of notes rather than a story.', w: ['notebook', 'research', 'create'] },
  { l: 'New show (seasons, episodes)', g: 'new', h: 'A new show, with seasons that hold episodes.', w: ['series', 'tv', 'reels', 'episodes', 'create'] },
  { l: 'New book series', g: 'new', h: 'A run of books under one name.', w: ['series', 'trilogy', 'saga', 'create'] },
  { l: 'New chapter', g: 'new', h: 'A new chapter in the book you’re writing.', w: ['chapter', 'add', 'create'], n: N.book },
  { l: 'New act', g: 'new', h: 'A new act (a group of chapters) in the book you’re writing.', w: ['act', 'part', 'section', 'create'], n: N.book },
  { l: 'New area', g: 'new', h: 'A new area on the Library’s shelves (Writing, Filmmaking…).', w: ['area', 'shelf', 'category', 'folder', 'create'] },
  { l: 'Bring in a script (Fountain file or pasted text)…', g: 'new', h: 'Brings in a script from a Fountain file or pasted text.', w: ['import', 'fountain', 'final draft', 'paste', 'upload'] },
  { l: 'Bring in old notes (from Thymer, Tana, Workflowy, OneNote)…', g: 'new', h: 'Paste or drop notes from another app; they become pages here.', w: ['import', 'paste', 'opml', 'markdown', 'migrate', 'old apps', 'thymer', 'tana', 'workflowy', 'onenote'], at: ['library'] },
  { l: 'Save links from your browser (Save to Inkwell button)…', g: 'new', h: 'A button for your browser’s bar that saves the page you’re on to Inkwell.', w: ['bookmark', 'bookmarklet', 'share', 'save link', 'twitter', 'x', 'web page', 'computer', 'desktop'], n: N.computer },

  // ---------- Write ----------
  { l: 'Link to a page…', g: 'write', h: 'Puts a link to another page where the caret is (or type [[).', w: ['link', 'reference', 'connect', '[['], at: ['page'], n: N.text },
  { l: 'Insert something (time, date, link…)', g: 'write', h: 'The / menu: the time, a date, a link, a picture and more.', w: ['slash', 'insert', 'menu', '/'], n: N.text },
  { l: 'Insert the time', g: 'write', h: 'Types the time now where the caret is.', w: ['clock', 'now', 'timestamp'], n: N.text },
  { l: 'Insert today’s date', g: 'write', h: 'Puts today’s date where the caret is, as a link to today’s page.', w: ['date', 'today', 'day', 'timestamp'], n: N.text },
  { l: 'Add a picture or file…', g: 'write', h: 'Puts a picture or file from this device where the caret is.', w: ['image', 'photo', 'attach', 'upload', 'file'], n: N.text },
  { l: 'Move this line to another page or day…', g: 'write', h: 'Moves the line you’re on, with everything under it, to another page or day.', w: ['move', 'send', 'file', 'relocate'], at: ['page', 'today'], n: N.line },
  { l: 'Zoom into this line', g: 'write', h: 'Shows only this line and what’s under it.', w: ['zoom', 'focus', 'drill', 'open line'], n: N.line },
  { l: 'Zoom out', g: 'write', h: 'Back out from a line you zoomed into (Esc).', w: ['zoom', 'up', 'back out'], n: 'Zoom into a line first' },
  { l: 'Fold or unfold this line', g: 'write', h: 'Hides or shows the lines under this one.', w: ['collapse', 'expand', 'fold', 'hide'], n: N.line },
  { l: 'Gather a #tag onto this page…', g: 'write', h: 'Collects every line with a #tag onto this page, and keeps it up to date.', w: ['gather', 'collect', 'tag', 'pull together'], at: ['page'], n: N.line },
  { l: 'Bring back gathered lines I deleted', g: 'write', h: 'Lines you deleted from a gathering come back.', w: ['gather', 'restore', 'undo'] },
  { l: 'Stop gathering on this line', g: 'write', h: 'This line stops collecting its #tag.', w: ['gather', 'stop', 'tag'] },
  { l: 'Add a note to this paragraph', g: 'write', h: 'A note in the margin on the paragraph you’re in.', w: ['comment', 'margin', 'annotate', 'note'], at: ['write'], n: N.chapter },
  { l: 'Note categories: add, rename, recolour', g: 'write', h: 'The kinds of margin note you can pick from, and their colours.', w: ['note types', 'colours', 'categories', 'labels'] },
  { l: 'Alternates for this word (or the selection)', g: 'write', h: 'Keeps other words to try in this spot, to flip between later.', w: ['alternatives', 'options', 'synonym', 'other word', 'variant'], at: ['write'], n: N.chapter },
  { l: 'Versions of this paragraph', g: 'write', h: 'The other versions you’ve written of this paragraph.', w: ['alternates', 'rewrites', 'variants'], n: N.chapter },
  { l: 'New version of this paragraph to rewrite', g: 'write', h: 'Keeps this paragraph and gives you a copy to rewrite.', w: ['rewrite', 'copy', 'alternate', 'variant'], n: N.chapter },
  { l: 'Next alternate (word, or else paragraph)', g: 'write', h: 'Flips to the next alternate word or paragraph.', w: ['flip', 'cycle', 'alternates'], n: N.chapter },
  { l: 'Previous alternate', g: 'write', h: 'Flips back to the alternate before.', w: ['flip', 'cycle', 'alternates'], n: N.chapter },
  { l: 'Scene break', g: 'write', h: 'A break between scenes in prose.', w: ['divider', 'separator', 'break', '***'], n: N.chapter },
  { l: 'History: drag back through earlier versions of this chapter or page', g: 'write', h: 'A strip to drag back through time and see this chapter or page as it was.', w: ['versions', 'earlier', 'undo', 'go back', 'restore', 'scrub', 'timeline', 'rewind'], at: ['write', 'page'], n: N.text },
  { l: 'History as a list, and what was deleted (this chapter or page)', g: 'write', h: 'Earlier versions as a list, and what was deleted, to bring back.', w: ['deleted', 'versions', 'bring back', 'restore', 'lost'], n: N.text },
  { l: 'Your voice modes (shared with Scribe)…', g: 'write', h: 'How voice captures are written up (journal, scene, idea, email), shared with Scribe.', w: ['journal', 'scene', 'idea', 'email', 'mode', 'voice', 'dictation'] },
  { l: 'Script view: Woven (flowing, scene headings hidden)', g: 'write', h: 'Reads the script as flowing text, with scene headings tucked away.', w: ['woven', 'flowing', 'prose', 'quiet', 'view'], at: ['script'] },
  { l: 'Script view: Classic (the standard screenplay page)', g: 'write', h: 'Back to the standard screenplay page.', w: ['woven', 'classic', 'standard', 'view', 'courier'], at: ['script'] },
  { l: 'Woven: new scene here', g: 'write', h: 'Starts a new scene where the caret is.', w: ['scene', 'cut', 'line', 'break'], n: N.woven },
  { l: 'Woven: this scene’s place, time and title…', g: 'write', h: 'Where and when this scene happens, and its title.', w: ['scene', 'place', 'time', 'slug', 'heading', 'title'], n: N.woven },
  { l: 'Woven: prepare for shoot (fill in every scene’s place and time)', g: 'write', h: 'Claude fills in every scene’s place and time, ready for production.', w: ['shoot', 'production', 'slug', 'headings', 'breakdown', 'claude'], n: N.woven },
  { l: 'Script: Section (your own heading)', g: 'write', h: 'A heading of your own in the script (an act, a sequence).', w: ['section', 'act', 'sequence', 'heading', 'part'], n: N.script },
  { l: 'Number the scenes (for production)…', g: 'write', h: 'Gives every scene a number that never changes, for shooting.', w: ['scene numbers', 'production', 'lock', 'numbering'], at: ['script'], n: 'Open a script whose scenes aren’t numbered yet' },
  { l: 'Scene numbers: turn off', g: 'write', h: 'Takes the scene numbers away.', w: ['scene numbers', 'unlock', 'numbering'] },

  // ---------- View ----------
  { l: 'Focus: just the text (on / off)', g: 'view', h: 'Hides everything but the words you’re writing.', w: ['distraction free', 'zen', 'clean', 'hide everything', 'full screen', 'quiet', 'quiet mode'], i: 0 },
  { l: 'Now, from anywhere', g: 'go', h: 'The one thing you’re on, from wherever you are, even while you type (Alt + `).', w: ['now', 'one thing', 'ruler', 'zoom', 'current'] },
  { l: 'Month: the next four weeks', g: 'go', h: 'Four weeks ahead, a lane for each project on stage (1). Press 1 again, or tap Month again, for the Year.', w: ['month', 'four weeks', 'weeks', 'ahead', 'zoom', 'ruler'] },
  { l: 'Year: twelve months from now', g: 'go', h: 'The furthest out in time, on the Month stop (1 twice): each month’s planned lines and dates to hit, and what’s for sometime this year.', w: ['year', 'months', 'zoom', 'ruler', 'sometime this year', 'later'] },
  { l: 'Zoom out one step', g: 'go', h: 'One stop further out on the ruler: Now to Today to Week to Month to Year, or a piece to its project to the Desk to the Library.', w: ['zoom', 'out', 'step out', 'further', 'ruler', 'back'] },
  { l: 'Zoom in one step', g: 'go', h: 'One stop closer to Now on the ruler.', w: ['zoom', 'in', 'step in', 'closer', 'ruler'] },
  { l: 'Classic layout: the rail, the phone’s bottom bar and Today’s switch (on / off)', g: 'view', h: 'The way Inkwell looked before the ruler: the rail of rooms, the phone’s bottom bar and Today’s Now, Page, Plan, Calendar switch. Off: the ruler at the bottom.', w: ['classic', 'old', 'rail', 'bottom bar', 'layout', 'ruler', 'zoom', 'safety', 'back to how it was'] },
  { l: 'Typewriter mode: the line you’re on stays put', g: 'view', h: 'Keeps the line you’re typing in the middle of the screen.', w: ['scroll', 'center', 'middle', 'typewriter'] },
  { l: 'Plan beside the page, or on top in one column', g: 'view', h: 'On Today: the plan at the side of the page, or above it in one column.', w: ['plan', 'side', 'column', 'top', 'layout', 'flip', 'one column'], at: ['today'], n: N.computer },
  { l: 'Show or hide earlier days (under the day page)', g: 'view', h: 'The days before, under today’s page.', w: ['earlier days', 'past days', 'yesterday', 'scroll back'], n: N.day },
  { l: 'Beside: today’s plan next to this page (again: put it away)', g: 'view', h: 'Today’s plan in a pane next to what you’re doing. Again puts it away.', w: ['pane', 'side by side', 'split', 'beside', 'plan', 'tasks', 'today'], n: N.pane },
  { l: 'Talk it through with Claude, beside where you are', g: 'view', h: 'Talk your plan or a problem over with Claude in a pane beside you.', w: ['claude', 'talk', 'think', 'plan', 'week', 'moves', 'ask', 'beside', 'overwhelmed', 'too much', 'chat'], at: ['desk', 'today'], n: N.pane },
  { l: 'Open where you are in a pane beside (middle-click opens anything beside)', g: 'view', h: 'Opens what you’re looking at again in a pane beside, to see two places at once.', w: ['pane', 'side by side', 'split', 'beside', 'two', 'compare'], n: N.pane },
  { l: 'In the Beside pane: this draft’s notes, listed next to it', g: 'view', h: 'This draft’s margin notes as a list, in a pane beside.', w: ['pane', 'side by side', 'beside', 'notes', 'margin', 'comments'], n: N.chapter },
  { l: 'Show the panes beside', g: 'view', h: 'Brings back the panes you put away.', w: ['pane', 'peek', 'side by side'] },
  { l: 'Close the pane you’re in', g: 'view', h: 'Closes this pane.', w: ['pane', 'side by side', 'close'] },
  { l: 'Close all the panes beside', g: 'view', h: 'Closes every pane beside.', w: ['pane', 'side by side', 'close all'] },
  { l: 'Sidebar (keep open)', g: 'view', h: 'Keeps the list of chapters and pages open at the left.', w: ['contents', 'outline', 'chapters', 'left', 'tree', 'navigator'] },
  { l: 'Notes beside the text', g: 'view', h: 'Shows or hides the margin notes next to the text.', w: ['margin', 'comments', 'notes'], n: N.chapter },
  { l: 'Read it through: just the script pages', g: 'view', h: 'The script as clean pages, to read through (Esc to stop).', w: ['read', 'preview', 'pages', 'proof'], at: ['script'], n: N.script },
  { l: 'Plot grid (the story as a table)', g: 'view', h: 'The story as a table: scenes or chapters across, threads down.', w: ['grid', 'table', 'beat sheet', 'board', 'structure', 'plot'], at: ['world'], n: 'Open a project or piece first' },
  { l: 'Back to the text from the grid', g: 'view', h: 'Back from the plot grid to the text.', w: ['grid', 'back', 'text'] },
  { l: 'Production (shots, kit, shoot days, posting)', g: 'view', h: 'Shots, kit, shoot days and posting for this piece.', w: ['shots', 'shoot', 'kit', 'posting', 'production', 'make'], at: ['world'], n: 'Open a project or piece first' },
  { l: 'Back to the text from production', g: 'view', h: 'Back from production to the text.', w: ['production', 'back', 'text'] },
  { l: 'Progress: words and pages over time (stats)', g: 'view', h: 'How many words and pages you’ve written, day by day.', w: ['stats', 'word count', 'pages', 'streak', 'progress', 'numbers'] },
  { l: 'What Claude knows: its one-line note on this, and weekly summaries', g: 'view', h: 'Claude’s one-line note on what this is, and its weekly and monthly summaries.', w: ['about', 'summary', 'second brain', 'memory', 'digest', 'weekly', 'monthly'] },
  { l: 'Show or hide "Linked from"', g: 'view', h: 'The list under a page of what links to it.', w: ['backlinks', 'linked', 'references'] },
  { l: 'Show or hide alternate marks', g: 'view', h: 'The marks on words and paragraphs that have alternates.', w: ['alternates', 'marks', 'underline'] },
  { l: 'Hide done tasks (or show them again, where they were)', g: 'plan', h: 'Ticked tasks stay where they were in your order; this puts them out of sight, under a faint “3 done” line.', w: ['done', 'completed', 'checked', 'ticked', 'finished', 'hide', 'clean', 'minimal', 'declutter'], at: ['today', 'plan', 'world'] },
  { l: 'Show or hide pictures on shared links', g: 'view', h: 'The preview pictures on links you’ve saved.', w: ['previews', 'images', 'thumbnails', 'links'] },
  { l: 'Show or hide scene numbers', g: 'view', h: 'The production numbers beside scenes.', w: ['scene numbers', 'codes'], n: N.script },
  { l: 'Show or hide section titles', g: 'view', h: 'Your own section headings in a script, and their summaries.', w: ['sections', 'headings', 'acts'], n: N.script },
  { l: 'Show or hide Claude’s notes in the margin', g: 'view', h: 'Claude’s notes beside the text.', w: ['claude', 'notes', 'margin', 'feedback'] },
  { l: 'Show or hide readers’ comments in the margin', g: 'view', h: 'Comments from people you shared a link with.', w: ['comments', 'readers', 'feedback', 'margin'] },
  { l: 'Woven: this script’s look (line, names, title font)…', g: 'view', h: 'How this Woven script looks: its line, character names and title font.', w: ['look', 'genre', 'style', 'font', 'colour', 'color', 'kung fu'], n: N.woven },
  { l: 'Keyboard shortcuts (all the keys)', g: 'view', h: 'Every key, named for this computer.', w: ['keys', 'hotkeys', 'keyboard', 'cheat sheet', 'help'] },

  // ---------- Page and text ----------
  { l: 'Look, page and text settings (Aa)', g: 'page', h: 'Colours, font, text size and what shows: every switch in one panel.', w: ['look', 'looks', 'theme', 'themes', 'colour', 'colours', 'color', 'colors', 'dark', 'light', 'appearance', 'aa', 'settings', 'preferences', 'options', 'switches', 'midnight', 'lamplight', 'ember', 'candle', 'night shift', 'graphite', 'typewriter', 'paper', 'motion', 'text size', 'font'] },
  { l: 'Light / dark', g: 'page', h: 'Switches between the light and dark looks.', w: ['dark mode', 'light mode', 'night', 'theme', 'colours'] },
  { l: 'Change the writing font', g: 'page', h: 'The typeface you write in.', w: ['typeface', 'mono', 'serif', 'font'] },
  { l: 'Wider page', g: 'page', h: 'Makes the page wider.', w: ['width', 'wide', 'bigger'] },
  { l: 'Narrower page', g: 'page', h: 'Makes the page narrower.', w: ['width', 'narrow', 'smaller'] },
  { l: 'Larger text', g: 'page', h: 'Makes the text bigger.', w: ['font size', 'bigger', 'zoom in', 'size'] },
  { l: 'Smaller text', g: 'page', h: 'Makes the text smaller.', w: ['font size', 'smaller', 'zoom out', 'size'] },
  { l: 'Name the section levels (Act, Sequence, Scene…)', g: 'page', h: 'What your script’s section levels are called (Act, Sequence…).', w: ['levels', 'acts', 'names', 'sections'], n: N.script },
  { l: 'Stop Claude linking titles on this page', g: 'page', h: 'This page goes back to a plain page; Claude stops linking each title.', w: ['list', 'watch list', 'read list', 'plain'] },
  { l: 'Fresh eyes: a new font, page and colour, to reread it cold', g: 'view', h: 'A different font, page and colour for a while, so you reread it as a stranger would.', w: ['reread', 'revise', 'unfamiliar', 'fresh', 'cold read'], at: ['write', 'script'] },

  // ---------- Revise and share ----------
  { l: 'Compare drafts, or the text then and now', g: 'revise', h: 'Two drafts, or the text then and now, with the changes marked.', w: ['diff', 'versions', 'changes', 'compare'], n: 'You’re already comparing' },
  { l: 'Back to the text from comparing', g: 'revise', h: 'Back from comparing to the text.', w: ['compare', 'back', 'text'] },
  { l: 'Read an earlier draft beside this one', g: 'revise', h: 'An earlier draft open next to this one, to read side by side.', w: ['side by side', 'old draft', 'previous draft'], n: N.chapter },
  { l: 'New draft from this one: keep a copy of this draft and carry on…', g: 'revise', h: 'Saves this draft as it is and carries on in a new one.', w: ['save draft', 'version', 'draft 2', 'snapshot', 'copy'], n: N.piece },
  { l: 'Start a new draft from scratch (the old one is kept whole)…', g: 'revise', h: 'A blank new draft; the old one is kept whole to look back at.', w: ['rewrite', 'draft 2', 'blank', 'over'], n: N.piece },
  { l: 'Claude’s notes on this chapter (margin notes and a fix list)', g: 'revise', h: 'Claude reads the chapter and leaves margin notes and a list of fixes.', w: ['feedback', 'editor', 'critique', 'review', 'claude'], at: ['write'], n: N.chapter },
  { l: 'Talk this chapter over with Claude', g: 'revise', h: 'A conversation with Claude about the chapter you’re in.', w: ['chat', 'conversation', 'feedback', 'claude', 'discuss'], n: N.chapter },
  { l: 'Print, or save as PDF (manuscript or screenplay format)', g: 'revise', h: 'Prints it, or saves a PDF, in manuscript or screenplay form.', w: ['pdf', 'export', 'print', 'paper'], at: ['script'], n: 'Open a chapter, script or page first' },
  { l: 'Share a link to read and comment…', g: 'revise', h: 'A link others can open to read and leave comments.', w: ['share', 'feedback', 'reader', 'link', 'send'], n: 'Open a piece or page first' },

  // ---------- Organize ----------
  { l: 'This page: rename, move to a world or trash…', g: 'tidy', h: 'Rename this page, move it to a project, or put it in the Trash.', w: ['rename', 'move', 'delete', 'trash', 'page menu'], n: N.page },
  { l: 'This piece: rename, label, stage, move or trash…', g: 'tidy', h: 'Rename this piece, change its label or stage, move it, or put it in the Trash.', w: ['rename', 'move', 'delete', 'trash', 'stage', 'label'], n: N.piece },
  { l: 'This world: rename, move to an area or trash…', g: 'tidy', h: 'Rename this project, move it to another area, or put it in the Trash.', w: ['rename', 'move', 'delete', 'trash', 'project', 'area'], at: ['world'], n: N.world },
  { l: 'Finish this project (put it away, keep everything)…', g: 'tidy', h: 'Puts this project on the Finished shelf in the Library: off the Desk, the sidebar and your plan, with everything still in it.', w: ['finish', 'done', 'complete', 'archive', 'close', 'put away', 'shelve', 'project'], at: ['world'], n: N.world },
  { l: 'Reopen this project', g: 'tidy', h: 'Brings a finished project back to the Desk, the sidebar and your plan, with its open tasks.', w: ['reopen', 'unarchive', 'unfinish', 'restore', 'bring back', 'project'], at: ['world'], n: N.world },
  { l: 'This chapter: rename, move or trash…', g: 'tidy', h: 'Rename this chapter, move it, or put it in the Trash.', w: ['rename', 'move', 'delete', 'trash', 'chapter'], n: 'Open a chapter first' },
  { l: 'This area: rename, move or trash…', g: 'tidy', h: 'Rename this area of the Library, move it, or put it in the Trash.', w: ['rename', 'move', 'delete', 'trash', 'area', 'shelf'], n: 'Open an area in the Library first' },
  { l: 'Change how this piece is written (prose, script, outline)…', g: 'tidy', h: 'Switches this piece between prose, a script and an outline.', w: ['kind', 'type', 'convert', 'prose', 'script', 'outline'], n: N.piece },
  { l: 'Send selection to… a chapter, page or day', g: 'tidy', h: 'Moves the paragraphs or lines you’ve picked to another chapter, page or day.', w: ['move', 'send', 'cut', 'relocate', 'selection'], n: N.text },
  { l: 'Send this meeting to Acro HQ (summary and tasks, for you and Nate)', g: 'tidy', h: 'Puts this meeting’s summary and tasks on the Acro HQ board, for you and Nate.', w: ['acro', 'hq', 'board', 'nate', 'meeting', 'share'], n: N.meetingOnline },
  { l: 'Fix a speaker’s name in this meeting…', g: 'tidy', h: 'Puts the right name on a speaker everywhere in this meeting.', w: ['speaker', 'name', 'rename', 'who', 'meeting'], n: N.meeting },
  { l: 'Write out this recording again', g: 'tidy', h: 'Sends the recording on this line to be written out again.', w: ['transcribe', 'voice', 'retry', 'audio', 'again'], n: N.recording },
  { l: 'Tidy pass: Claude’s suggested tidy-ups, and what it changed', g: 'tidy', h: 'Claude’s suggestions to tidy up (merge, move, rename) to say yes or no to, and what it changed.', w: ['tidy', 'clean up', 'merge', 'duplicates', 'undo claude', 'claude changes', 'suggestions'], at: ['library'] },
  { l: 'Trash: bring things back', g: 'tidy', h: 'Everything you’ve put in the Trash, to bring back.', w: ['deleted', 'restore', 'undelete', 'bin', 'recycle', 'trash'] },

  // ---------- Sync and backup ----------
  { l: 'Sync now', g: 'sync', h: 'Sends and fetches changes with your other devices right now.', w: ['sync', 'refresh', 'update', 'upload', 'devices'], n: N.signedIn },
  { l: 'Sign in to sync between devices', g: 'sync', h: 'Sign in so your phone and computer keep the same writing.', w: ['login', 'log in', 'account', 'sync', 'devices'] },
  { l: 'Sign out of sync', g: 'sync', h: 'Signs this device out; what’s here stays here.', w: ['logout', 'log out', 'account'] },
  { l: 'Two versions to check', g: 'sync', h: 'Two devices changed the same thing; pick which to keep.', w: ['conflict', 'clash', 'versions', 'sync'] },
  { l: 'Back up everything (download all as files)', g: 'sync', h: 'Downloads everything you’ve written as files, to keep a copy.', w: ['backup', 'download', 'export', 'zip', 'save', 'copy'] },
  { l: 'Export this chapter as Markdown', g: 'sync', h: 'Downloads this chapter as a Markdown text file.', w: ['export', 'download', 'markdown', 'md', 'text'], n: 'Open a prose chapter first' },
  { l: 'Export the whole book as Markdown', g: 'sync', h: 'Downloads the whole book as one Markdown text file.', w: ['export', 'download', 'markdown', 'md', 'book'], n: 'Open a prose book first' },
  { l: 'Export this script as Fountain', g: 'sync', h: 'Downloads this script as a Fountain file for other screenplay apps.', w: ['export', 'download', 'fountain', 'final draft', 'script'], n: N.script },
  { l: 'Pictures and files: space used', g: 'sync', h: 'How much room your pictures and files take up.', w: ['storage', 'space', 'size', 'files', 'pictures'] },
  { l: 'Connect Claude to Inkwell (a connector address)…', g: 'sync', h: 'The address that lets Claude read and add to Inkwell.', w: ['connector', 'mcp', 'claude', 'connect', 'link'] },
  { l: 'Connect Scribe, the dictation keyboard…', g: 'sync', h: 'Links Scribe, your dictation keyboard, to Inkwell.', w: ['scribe', 'dictation', 'keyboard', 'connect', 'voice'] },
  { l: 'Google Calendar: show your events on Today and the week…', g: 'sync', h: 'Shows your Google Calendar events among the day’s and the week’s tasks.', w: ['calendar', 'google', 'connect', 'events', 'meetings', 'appointments'] }
];

// The generated commands (a page of a project, a script part, a page list):
// one line each, worked out from their label.
export function infoFor(label) {
  let m;
  if ((m = /^Page: (.+)$/.exec(label))) return { g: 'go', h: `This project’s ${m[1]} page.`, w: ['tab', 'page', 'project', m[1].toLowerCase()], at: [], n: N.world };
  if ((m = /^Script: (.+)$/.exec(label))) return { g: 'write', h: `Makes the paragraph you’re in a ${m[1].toLowerCase()}.`, w: ['element', 'format', 'script', m[1].toLowerCase()], n: N.script };
  if ((m = /^Make this page a (.+) \(Claude links each title\)$/.exec(label))) return { g: 'page', h: `Each line on this page is a title; Claude links it to what it is (a ${m[1]}).`, w: ['list', 'watch', 'read', 'films', 'books', m[1]], n: N.page };
  return null;
}

const byLabel = new Map(INFO.map((x, i) => [x.l, { ...x, i }]));
// Fills in a command's group, hint, words, rooms and reason from the table.
export function describe(c) {
  const x = byLabel.get(c.label) || infoFor(c.label);
  if (!x) return c;
  c.group = x.g;
  c.hint = x.h;
  c.words = [...new Set([...(c.words || []), ...(x.w || [])])];
  if (x.at) c.where = x.at;
  if (x.n) c.needs = x.n;
  c.rank = x.i ?? 900;
  return c;
}
