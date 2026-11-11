// What Claude can do in Daybook through the connector, and the small part of
// the MCP protocol needed to offer it. Kept free of Deno and Supabase imports
// so it can be tested on its own; index.ts supplies the database.

export type Row = {
  id: string;
  parent_id: string | null;
  title: string;
  notes: string | null;
  done: boolean;
  day: string | null;
  start_min: number | null;
  after_min: number | null;
  duration_min: number;
  sort: number;
  /** Place in its day's list; sort is its place among its project's steps. */
  day_sort?: number | null;
  color: string | null;
  due: string | null;
  link: string | null;
  kind: string | null;
  area_id: string | null;
  /** Roadmap: when a project or sub-project starts. */
  start?: string | null;
  /** Roadmap: a milestone task shows as a diamond; a hard deadline's date can't move. */
  milestone?: boolean;
  hard_deadline?: boolean;
  /** Roadmap: the id of the item this one is waiting on. */
  waits_on?: string | null;
  /** When a task was checked off (ISO timestamp). The database stamps it; only sent when set on purpose. */
  done_at?: string | null;
  /** How long a task really took, when someone filled it in. */
  actual_minutes?: number | null;
  /** Time really worked on it, recorded in the app: ISO start and end (end null while recording). guess: filled in at check-off, not recorded. */
  time_log?: { start: string; end: string | null; guess?: boolean; est?: boolean }[] | null;
  /** Where a task was planned before checking it off moved its block to when it was really done. */
  planned?: { day: string | null; start_min: number | null; duration_min: number | null } | null;
  /** A repeating task (a series): how it repeats. Its day is the day it starts. */
  repeat_rule?: Rule | null;
  /** A stored repeat of a series: the series' id, and the date it was due. */
  series_id?: string | null;
  occurs_on?: string | null;
  /** Area time: on a block (kind 'block'), the area or project it's time for. */
  focus_on?: string | null;
  /** On an area: roughly how many minutes a week the person wants to give it. */
  week_minutes?: number | null;
  /** An area's target minutes for each weekday, such as { mon: 180, wed: 0 }. */
  day_targets?: Record<string, number> | null;
  days_done?: string[] | null;
  /** When in the day the area fits best: morning, afternoon or evening (a hint only). */
  time_pref?: string | null;
  /** A habit: a task (usually repeating) whose time doesn't count toward the week's scheduled hours. */
  habit?: boolean | null;
  /** The ids of the labels it wears (rows of kind 'label'); its steps wear them too. */
  labels?: string[] | null;
  deleted: boolean;
  /** When it was deleted (the database stamps it); only on rows from loadDeleted. */
  deleted_at?: string | null;
};

/** How a series repeats. days: 0 is Sunday. dom: day of the month. until: its last day. */
export type Rule = { every: "day" | "weekday" | "week" | "month" | "days" | "times"; days?: number[]; interval?: number; dom?: number; n?: number; per?: "week" | "month"; until?: string; off?: [string, string][]; mins?: number; hc?: string };

export type Db = {
  /** Every item this person has that isn't deleted, plus skipped repeats (deleted, with occurs_on). */
  load(): Promise<Row[]>;
  /** Deleted items (deleted_at stamped) deleted since this ISO time, newest first: the Trash. */
  loadDeleted(sinceIso: string): Promise<Row[]>;
  /** Inserts or replaces these items. */
  save(rows: Row[]): Promise<void>;
  /** The Roadmap's free hours per week, null when never set. */
  getFreeHours(): Promise<number | null>;
  setFreeHours(hours: number): Promise<void>;
  /** The person's time zone (the app records it), such as Europe/Berlin; null if unknown. */
  timeZone(): Promise<string | null>;
  /** Notes left for the person (post_note), newest first. */
  listNotes(limit: number, unreadOnly: boolean): Promise<Note[]>;
  addNote(n: Pick<Note, "author" | "title" | "body" | "link" | "task_ids">): Promise<Note>;
  /** Needs you items (raise_needs_you), newest first; cleared ones only when asked. */
  listNeeds(limit: number, includeCleared: boolean): Promise<Note[]>;
  /** The open item a thread raised, by the thread's link. */
  openNeed(link: string): Promise<Note | null>;
  addNeed(n: Pick<Note, "author" | "title" | "body" | "link" | "kind" | "project" | "project_link">): Promise<Note>;
  updateNeed(id: string, patch: Partial<Pick<Note, "author" | "title" | "body" | "kind" | "project" | "project_link" | "created_at" | "resolved_at">>): Promise<Note>;
  getNeed(id: string): Promise<Note | null>;
  /** Claude updates (log_update): what threads did, newest first, since this ISO time. */
  listUpdates(sinceIso: string, limit: number): Promise<Update[]>;
  addUpdate(u: Omit<Update, "id" | "created_at">): Promise<Update>;
};

/** One line a Claude thread logged when it posted a result, for the person's Catch-up. */
export type Update = { id: string; project: string; project_link: string | null; link: string; thread: string | null; text: string; place: string | null; state: UpdateState; created_at: string };
export type UpdateState = "done" | "live" | "working";
const STATES: UpdateState[] = ["done", "live", "working"];

/** A note Claude left for the person, shown in the app until they tap Got it, and kept in Notes after. */
export type Note = { id: string; author: string; title: string; body: string; link: string; task_ids: string[]; created_at: string; read_at: string | null;
  /** Needs you items only: decision, blocked or review, the Claude project it came from, and when it was cleared. */
  kind?: Kind | null; project?: string | null; project_link?: string | null; resolved_at?: string | null };
export type Kind = "decision" | "blocked" | "review";
const KINDS: Kind[] = ["decision", "blocked", "review"];

/** What the Roadmap assumes until free hours are set (the app shows the same). */
const FREE_DEFAULT = 10;

const PALETTE = ["#4B6CB7", "#2E8B6E", "#B7791F", "#9B5BA5", "#C0564B", "#3E8E9E", "#7A7F2E", "#B0567F"];
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const INSTRUCTIONS = `Daybook is this person's own task and calendar app.
- Everything is an item in a tree. An item with steps under it is a project; steps can be sub-projects or tasks. Checking off tasks moves the parent project's progress.
- Top-level projects are grouped into areas, such as Business, Filmmaking and Personal; list_projects shows them. When you add a project, put it in the area it clearly belongs to, or ask. A task can also sit right in an area without being part of a project (a standalone task, such as a bigger one-off in Filmmaking); it becomes a project in that area once it gets steps.
- A task can sit on a day without a time ("sometime that day"), or in a time block on that day (start_time plus duration). Leave the time empty unless the person asks for a specific time.
- Any item can carry a link back to where its notes live, often a Thymer page. When you make a task from something in Thymer, set its link to that page and put a short summary in notes, so the person can glance at it and tap through for the rest. A Thymer page link looks like https://NAME.thymer.com/?open=WORKSPACE.PAGEID; if you can't tell the address, look at the links on existing tasks for the pattern, or ask.
- Dates are the person's local dates as YYYY-MM-DD, and times are 24-hour HH:MM.
- The Roadmap shows each top-level project as a bar from its start date to its due date (sub-projects as thinner bars under it). Set start and due on projects and sub-projects to place them. A task marked milestone shows as a diamond on its due date (or its day); hard_deadline marks a milestone whose date can't move. waiting_on links an item to another item it waits on, such as "List footage" waiting on "NAS live".
- The Roadmap's top strip weighs each week's scheduled task hours and area time against the person's free hours per week (get_free_hours / set_free_hours), so over-planned weeks stand out. When planning a week, keep its scheduled hours within that number.
- Checking off a task records when (done_at, in the person's local time); reopening clears it. If they say they finished something earlier, pass done_at with update_item to backdate it. actual_minutes is how long a task really took, next to its planned duration_minutes; fill it in when they tell you, or when it was far off. list_tasks with done_since lists what was finished since a date, to see their real pace.
- Time tracking: the person records time in the app with a ▶ on a task or project (one at a time). time_log lists each stretch really worked (start, end, minutes; end is "recording now" while it runs). Checking a task off moves its block (day, start_time, duration_minutes) to when it was really done, and planned keeps where and how long it was planned, so compare planned with the real block and actual_minutes (the recorded total) to learn their pace. A stretch marked guessed wasn't recorded: it was checked off without the timer, so the app assumed it ended then and took as long as planned; don't read its length as real. A stretch marked estimated is how long the person said it took right after checking it off (the app asks): a rough number from them, much better than a guess, so use it for their pace. Time on a project's steps is recorded on the project as a whole.
- A task can repeat (daily, weekdays, weekly on chosen days, every N weeks, or monthly), with an optional last day: pass repeat to add_task or update_item. The task is then a series that starts on its day. Each repeat shows on its own day and is checked off on its own. list_tasks with from and to lists the repeats in that range: each has its own id (series id~date) and a series_id. To change one day's repeat (move it, check it off, rename it), use its id; to change every repeat, use the series_id. A repeat moved off the plan (day null) is skipped. repeat: null stops a series repeating. Repeating tasks count in each week's scheduled hours but have no bar on the Roadmap.
- Notes: post_note leaves the person a note they see in the app as a card the next time they open it (unread notes stack into one card), with a button back to the chat it came from, and it stays in their Notes history. Use it to tell them what a scheduled check changed, such as a morning plan check, with a short title, a few lines, the link to this chat, and the ids of the tasks you changed. list_notes reads back what you already told them, and whether they've read it.
- Needs you: a line on the person's Plan lists what's waiting on them across all their Claude projects, grouped by project, oldest first. When this chat needs them (a decision only they can make, work blocked on them, or something ready for them to review or try), raise_needs_you with one short line, the kind, the Claude project's name, and the link to this chat. A chat has at most one open item: raising again from the same link updates it (blocked → review, say) instead of adding another. clear_needs_you as soon as it no longer needs them, such as once they've answered. list_needs_you shows what's open.
- Updates: each time this chat posts a result to the person (something finished, went live, or started), log_update with one plain line of what changed, the state (done, live or working), the Claude project's name, this chat's title and its link, plus place (its Inkwell page or Daybook project) when the work has one. They read these on the Catch-up page in Inkwell to see what happened across all their Claude threads today, so write it for someone who wasn't watching ("Woven scripts are live: hidden scene headings, genre looks"), not a status code. One line per result, not per step; list_updates reads back what's been logged.
- Area time: the person prefers to plan blocks of time for a whole area or a big project ("Filmmaking, 9 to 12", every Mon/Wed/Fri) over timing every task. In the app a block opens to the next step of each project in that area, so they pick what to do when they get there, and it fills with the time really worked. list_blocks shows them; add_block, update_block and remove_block change them (a block can repeat like a task). Areas can have rough hours a week (set_area_hours; list_projects shows them with this week's blocked hours). When planning their week, place area blocks around their calendar so each area gets about its hours, and only time single tasks that have a deadline or must happen at a set time. Blocks count as busy time.
- Daily area targets: each area can have target hours for each day of the week (get_area_targets / set_area_targets), such as Business 3 h on weekdays and Personal 0 on Wednesday. To make up for a slow week, raise an area's hours for one date or add a block for it; there is no separate catch-up. The app shows a card per area at the top of each day's List with the target and the hours logged so far; the person starts and stops the area's own timer as often as they like, and time on any task, project or block in the area counts too. A single date can override its weekday's hours (set_area_targets with date and hours, such as a lighter Friday before a trip); progress and the app use the override for that day. time_pref (morning, afternoon, evening) is only a hint for when it fits. get_area_progress shows, per day and area, the target, the hours logged and which tasks the time went to: use it to see how the days really went before planning.
- Order: every item has a place among its siblings (a project's steps; the projects and standalone tasks of an area; the inbox). position is its place, from 1, and sort is the number that keeps it there; the app's lists show the same order. Lists under a project or area come back in that order. reorder_items puts a project's steps or an area's items in a new order; update_item's position moves one item (first, last, or after another). Priority is an item's rank in its area, counting its projects and standalone tasks together (1 is first), so a standalone task can come before a project; set_project_priority changes it, and it's the order the person sees when dragging in the app's area lists.
- get_next_task gives what to work on next in an area or project: the first open step in order that isn't waiting on something unfinished or planned for a later day (for an area: its projects and standalone tasks in priority order). A project waiting on something unfinished is skipped as a whole, and the two after it. The app shows the same next task on each area block in List view.
- A task marked habit (usually a repeating one, such as a daily walk) still shows on its days, but its time doesn't count toward the week's scheduled hours or get_free_hours.
- Labels (such as Building, Color grading, or a client's name) cut across areas: a project stays in its area and also wears labels, so Inkwell is Filmmaking time and Building time at once. A label on a project counts for all its steps; a single task can wear its own. Items show the labels they wear; set_labels changes them, and list_labels gives each label's recorded hours for a range, split by area and project. Use them to answer "how much time went into X" across areas, or to see how much of the week a kind of work is taking.
- Deleting: delete_item removes a task or project the way the app's Delete does. It's a soft delete: the item goes to the app's Trash for 30 days (then it's cleared out for good), and restore_item brings it back. A project goes with all its steps (and any area-time blocks planned for it), and restoring it brings those back together. For a repeating task, a repeat's id (series id~date) skips just that day, and the series_id deletes the whole series. list_deleted shows what's in the Trash. Deleted items are left out of everything else: lists, next task, area progress, the Roadmap, the week's hours and recorded time. Only delete when the person asks, or clearly agrees, and say what you deleted; prefer checking off something that was done, since deleting it drops it from their record.
- Say what you changed in plain words, since the person sees your reply, not the tool calls.`;

const str = (description: string) => ({ type: "string", description });
const REPEAT = {
  type: "object",
  description: "Makes it a repeating task that starts on its day (today if it has none). every: day, weekday (Monday to Friday), week, month, days or times. For week: days, such as [\"mon\", \"thu\"] (defaults to the start day's weekday), and interval for every 2, 3… weeks. A monthly task repeats on its start day's date. days: every interval days (2 to 90). times: times (a number) per week or month on any days, such as a workout twice a week; it shows every day until that many are done. until: its last day, YYYY-MM-DD (optional).",
  properties: {
    every: { type: "string", enum: ["day", "weekday", "week", "month", "days", "times"] },
    times: { type: "integer", description: "For every: times, how many times each week or month." },
    per: { type: "string", enum: ["week", "month"], description: "For every: times, counted per week (default) or month." },
    days: { type: "array", items: { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] } },
    interval: { type: "integer", description: "Weeks between repeats for week (1 to 12, default 1), or days between repeats for days (2 to 90)." },
    until: { type: ["string", "null"], description: "Last day it repeats, YYYY-MM-DD." },
  },
  required: ["every"],
};
const orNull = (type: string, description: string) => ({ type: [type, "null"], description });

export const TOOLS = [
  {
    name: "list_tasks",
    title: "List tasks",
    description: "Lists tasks (items with no steps under them), with their project, day, time, duration and link. Filter by a date range, by project, by words in the title, or ask for unscheduled ones. With from and/or to, a repeating task is listed as each of its repeats in that range (up to a year); without dates, once, with how it repeats. Done tasks are left out unless include_done is true.",
    inputSchema: {
      type: "object",
      properties: {
        from: str("First day to include, YYYY-MM-DD."),
        to: str("Last day to include, YYYY-MM-DD."),
        unscheduled: { type: "boolean", description: "Only tasks with no day of their own and no scheduled project above them (steps of a scheduled project are worked on with it)." },
        project_id: str("Only tasks anywhere under this project. Without dates they come back in the project's order."),
        area: str("Only tasks in this area, by name (its projects' steps and its standalone tasks). Without dates they come back in priority order (projects and standalone tasks ranked together)."),
        query: str("Only tasks whose title contains these words."),
        include_done: { type: "boolean", description: "Include tasks already checked off." },
        done_since: str("Only tasks checked off on or after this local date, YYYY-MM-DD (includes done tasks)."),
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_projects",
    title: "List projects",
    description: "Lists the person's areas, and their projects and sub-projects with area, progress, start and due dates, what they wait on, and link. Projects come in order: area by area, each area's projects by priority (an item's priority is its rank in its area, 1 first), each followed by its sub-projects in order. position is an item's place among its siblings.",
    inputSchema: { type: "object", properties: { include_done: { type: "boolean", description: "Include finished projects." } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_item",
    title: "Open an item",
    description: "Everything about one task or project: full notes, link, schedule, its place among its siblings (position, sort), and the steps under it in order.",
    inputSchema: { type: "object", required: ["id"], properties: { id: str("The item's id.") } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_task",
    title: "Add a task",
    description: "Adds a task to the inbox, right in an area, or under a project, optionally on a day or in a time block, with notes and a link.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: str("What to do, short."),
        project_id: str("Put it under this project or task. Leave out for the inbox or an area."),
        area: str("Put it right in this area, by name, without a project. Not with project_id."),
        day: str("Day to do it, YYYY-MM-DD. Leave out to keep it unscheduled."),
        start_time: str("Start time, HH:MM 24-hour. Needs a day. Leave out for 'sometime that day'."),
        duration_minutes: { type: "integer", description: "How long it takes, 5 to 1440. Defaults to 60." },
        notes: str("Notes for when the person sits down to do it, such as a short summary of the source."),
        link: str("Web address the notes came from, such as the Thymer page. Must start with https:// or http://."),
        due: str("Due date, YYYY-MM-DD. For a milestone, the date its diamond sits on."),
        start: str("Start date, YYYY-MM-DD, for an item that will get steps of its own (a sub-project)."),
        milestone: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "Mark it as a milestone: a diamond on the Roadmap on its due date (or its day)." },
        hard_deadline: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "A milestone whose date can't move (drawn red). Makes it a milestone too." },
        waiting_on: str("Id of another item this one waits on."),
        repeat: REPEAT,
        habit: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "A habit, such as a daily walk: it shows on its days, but its time doesn't count toward the week's scheduled hours." },
      },
    },
  },
  {
    name: "add_project",
    title: "Add a project",
    description: "Adds a new top-level project. Add its tasks afterwards with add_task or add_steps.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: str("The project's name."),
        area: str("The area it belongs in, by name, such as Business (see list_projects)."),
        notes: str("Goal or notes."),
        link: str("Web address with more notes."),
        start: str("Start date, YYYY-MM-DD: where its bar begins on the Roadmap."),
        due: str("Due date, YYYY-MM-DD: where its bar ends on the Roadmap."),
        waiting_on: str("Id of another item this project waits on."),
      },
    },
  },
  {
    name: "add_steps",
    title: "Add steps",
    description: "Breaks a task or project down by adding steps under it, in order.",
    inputSchema: {
      type: "object",
      required: ["parent_id", "steps"],
      properties: {
        parent_id: str("The task or project to add steps to."),
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["title"],
            properties: { title: { type: "string" }, duration_minutes: { type: "integer", description: "Defaults to 30." } },
          },
        },
      },
    },
  },
  {
    name: "get_free_hours",
    title: "Free hours per week",
    description: "How many hours a week the person has for the tasks in Daybook. The Roadmap compares each week's scheduled task hours and area time with this, so over-planned weeks stand out. Also gives the scheduled hours for this week and the next three.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "set_free_hours",
    title: "Set free hours per week",
    description: "Sets how many hours a week the person has for the tasks in Daybook (1 to 168). Only change it when they tell you their number.",
    inputSchema: { type: "object", required: ["hours"], properties: { hours: { type: ["integer", "string"], description: "Whole hours per week, 1 to 168." } } },
  },
  {
    name: "post_note",
    title: "Leave a note",
    description: "Leaves the person a note in Daybook: a card at the top of the app the next time they open it, on phone or computer, with a Talk about this button that opens link, and the tasks it mentions to tap. Unread notes stack into one card with a count. Tapping Got it marks it read; every note stays in their Notes history. Use it to say what you did, for example after a morning plan check moved tasks.",
    inputSchema: {
      type: "object",
      required: ["title", "message", "link"],
      properties: {
        title: str("Short title, such as Morning plan check (up to 120 characters). The card reads 'Claude: <title>'."),
        message: str("The note itself, a few lines. Markdown is fine: **bold**, *italic*, lists, links (up to 6000 characters)."),
        link: str("The Claude chat this note came from, so the person can talk about it there. Must start with https:// or http://."),
        task_ids: { type: "array", items: { type: "string" }, description: "Ids of the tasks or projects the note is about, such as the ones you moved (up to 50). They show as tappable chips." },
        from: str("Who it's from, shown before the title. Defaults to Claude."),
      },
    },
  },
  {
    name: "list_notes",
    title: "List notes",
    description: "The notes already left for the person with post_note, newest first: title, message, link, the tasks they mention, when, and whether they've read it (read_at).",
    inputSchema: {
      type: "object",
      properties: {
        unread_only: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "Only notes they haven't marked read yet." },
        limit: { type: ["integer", "string"], description: "How many, 1 to 100. Defaults to 20." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "raise_needs_you",
    title: "Raise a Needs you item",
    description: "Puts an item on the person's Needs you list in Daybook: the line on their Plan that shows what's waiting on them across all their Claude projects. Use it when this chat needs them: a decision only they can make, work blocked on them, or something ready for them to review or try. One item per chat: raising again with the same link updates the open item (its kind, title, details) instead of adding a second. Clear it with clear_needs_you once it no longer needs them.",
    inputSchema: {
      type: "object",
      required: ["kind", "title", "project", "link"],
      properties: {
        kind: { type: "string", enum: KINDS, description: "decision: they need to choose something. blocked: work can't go on until they do something. review: something is ready for them to look at or try." },
        title: str("One short line saying what's needed, such as Pick a look for the overview board (up to 120 characters)."),
        project: str("The name of the Claude project this chat belongs to, such as Life Planning. Use the same name every time; the list groups by it."),
        link: str("The address of this chat, so the person can jump straight to it. Must start with https:// or http://."),
        project_link: str("The address of the Claude project itself, if you know it. Worked out from a claude.ai project thread link when left out."),
        details: str("A few more lines, optional. Markdown is fine (up to 2000 characters)."),
        from: str("Who it's from. Defaults to Claude."),
      },
    },
  },
  {
    name: "clear_needs_you",
    title: "Clear a Needs you item",
    description: "Takes an item off the person's Needs you list once it no longer needs them, such as after they've answered or it's unblocked. Pass the chat's link (clears that chat's open item) or the item's id.",
    inputSchema: {
      type: "object",
      properties: {
        link: str("The chat's address, as passed to raise_needs_you."),
        id: str("The item's id, from raise_needs_you or list_needs_you."),
      },
    },
  },
  {
    name: "list_needs_you",
    title: "List Needs you items",
    description: "What's on the person's Needs you list: open items, oldest first, with their kind, Claude project, link and how long they've been waiting. include_cleared also lists recently cleared ones.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("Only items from this Claude project."),
        include_cleared: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "Also list cleared items, newest first after the open ones." },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "log_update",
    title: "Log what this chat did",
    description: "Adds one line to the person's Catch-up (in Inkwell): what this chat just did, so they can see what happened across all their Claude threads today. Call it each time you post a result to them: something finished (done), something now live for real (live), or work started or still going (working). Not for every small step.",
    inputSchema: {
      type: "object",
      required: ["text", "project", "link"],
      properties: {
        text: str("One plain line of what changed, written for someone who wasn't watching, such as Woven scripts are live: hidden scene headings and genre looks (up to 200 characters)."),
        state: { type: "string", enum: STATES, description: "done: a result is ready. live: it's out and working for real (deployed, posted, sent). working: started, or still going. Defaults to done." },
        project: str("The name of the Claude project this chat belongs to, the same name you use for Needs you, such as Inkwell."),
        thread: str("This chat's title, such as Build Woven scripts (up to 80 characters)."),
        link: str("The address of this chat, so the person can jump straight to it. Must start with https:// or http://."),
        project_link: str("The address of the Claude project itself, if you know it. Worked out from a claude.ai project thread link when left out."),
        place: str("Where this work lives besides the chat, if it has a home: its page or world in Inkwell (an Inkwell link with ?open=) or its project in Daybook. Give it whenever there is one, so the person can go straight there."),
      },
    },
  },
  {
    name: "list_updates",
    title: "List logged updates",
    description: "What Claude threads have logged with log_update, newest first: what changed, its state, project, thread and link, and when.",
    inputSchema: {
      type: "object",
      properties: {
        since: str("Only updates on or after this day, YYYY-MM-DD (the person's local date). Defaults to today."),
        project: str("Only updates from this Claude project."),
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_blocks",
    title: "List area time",
    description: "Lists the blocks of time for areas and projects (area time) between two days, a repeating block once on each day it falls on. Each has its id, what it's for, day, start time and length, and whether it repeats.",
    inputSchema: { type: "object", properties: { from: str("First day, YYYY-MM-DD. Defaults to today."), to: str("Last day, YYYY-MM-DD. Defaults to two weeks after from.") } },
  },
  {
    name: "add_block",
    title: "Block time for an area or project",
    description: "Adds a block of time for a whole area (by name) or a project (by id) on a day, optionally repeating, such as Filmmaking every Mon, Wed and Fri 9:00 to 12:00.",
    inputSchema: {
      type: "object",
      required: ["day", "start_time"],
      properties: {
        area: str("The area it's time for, by name. Give this or project_id."),
        project_id: str("The project or sub-project it's time for. Give this or area."),
        day: str("Day, YYYY-MM-DD (the first day, for a repeating block)."),
        start_time: str("Start time, HH:MM 24-hour."),
        duration_minutes: { type: "integer", description: "How long, 15 to 720. Defaults to 90." },
        repeat: REPEAT,
      },
    },
  },
  {
    name: "update_block",
    title: "Move or resize a block",
    description: "Moves a block of area time to another day or time, or changes its length. On one repeat of a repeating block (an id with ~date) it changes that day only; on the series it changes every repeat still to come.",
    inputSchema: { type: "object", required: ["id"], properties: { id: str("The block's id, from list_blocks."), day: str("New day, YYYY-MM-DD."), start_time: str("New start time, HH:MM 24-hour."), duration_minutes: { type: "integer", description: "New length, 15 to 720." } } },
  },
  {
    name: "remove_block",
    title: "Remove a block",
    description: "Removes a block of area time. On one repeat of a repeating block it skips that day only; on the series it removes every repeat. Time already recorded stays with the work.",
    inputSchema: { type: "object", required: ["id"], properties: { id: str("The block's id, from list_blocks.") } },
  },
  {
    name: "set_area_hours",
    title: "Set an area's hours a week",
    description: "Sets roughly how many hours a week the person wants to give an area. The app shows each area's week as hours worked and still blocked against this. 0 clears it.",
    inputSchema: { type: "object", required: ["area", "hours"], properties: { area: str("The area, by name."), hours: { type: "number", description: "Hours a week, 0 to 80, halves allowed. 0 clears it." } } },
  },
  {
    name: "get_area_targets",
    title: "Get daily area targets",
    description: "Lists each area's target hours for each day of the week, its weekly total, and when in the day it fits best (a hint).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_area_targets",
    title: "Set daily area targets",
    description: "Sets an area's target hours for days of the week, and/or when in the day it fits best. Only the days you pass change; 0 means no target that day. With date and hours instead, sets the target for that one date only, replacing that weekday's usual hours for that day (hours null removes the override).",
    inputSchema: {
      type: "object",
      required: ["area"],
      properties: {
        area: str("The area, by name."),
        days: { type: "object", description: "Hours by weekday, such as {\"mon\": 3, \"wed\": 0, \"sat\": 2}. Keys mon, tue, wed, thu, fri, sat, sun; also \"weekdays\", \"weekend\" or \"every_day\" to set several at once (a single day given too wins). Hours 0 to 16, halves allowed.", additionalProperties: { type: "number" } },
        time_pref: { type: ["string", "null"], enum: ["morning", "afternoon", "evening", null], description: "When in the day it fits best (a hint only); null clears it." },
        date: str("A single date, YYYY-MM-DD, to override: its target becomes hours, in place of that weekday's usual hours, for that day only."),
        hours: { type: ["number", "null"], description: "With date: hours for that date only (0 to 16, halves allowed; 0 means no target that day). null removes the override so the weekday's usual hours apply again." },
      },
    },
  },
  {
    name: "list_labels",
    title: "List labels and their time",
    description: "Every label (such as Building or a client) with the hours recorded under it from from to to (default: this week so far), split by area and by project, and the items that wear it.",
    inputSchema: { type: "object", properties: { from: str("First day, YYYY-MM-DD. Defaults to this Monday."), to: str("Last day, YYYY-MM-DD. Defaults to today.") } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "set_labels",
    title: "Set an item's labels",
    description: "Sets the labels a task or project wears, by name, replacing its own ones (labels it gets from its project stay). A name that isn't a label yet becomes a new one. On a repeat, it changes the whole series.",
    inputSchema: { type: "object", required: ["id", "labels"], properties: { id: str("The item's id."), labels: { type: "array", items: { type: "string" }, description: "Label names, such as [\"Building\"]. An empty list takes its own labels off." } } },
  },
  {
    name: "get_area_progress",
    title: "Get area progress by day",
    description: "For each day from from to to (at most 62 days) and each area: the target hours, the hours logged (time recorded on the area itself, on anything in it, and on blocks for it), and which tasks or projects the time went to.",
    inputSchema: { type: "object", required: ["from", "to"], properties: { from: str("First day, YYYY-MM-DD."), to: str("Last day, YYYY-MM-DD.") } },
  },
  {
    name: "update_item",
    title: "Change an item",
    description: "Changes a task or project: move it to another day or time, unschedule it, check it off, rename it, change its notes or link, set its start and due dates, mark it a milestone or hard deadline, set what it's waiting on, move it under another project, or make it repeat. Only the fields you pass change; pass null to clear one. Changing the day without a start_time makes it 'sometime that day'. For a repeating task: a repeat's id (series id~date) changes only that day's repeat (day null skips it); the series_id changes every repeat (its day is the day the series starts).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: str("The item's id."),
        title: str("New title."),
        day: orNull("string", "New day, YYYY-MM-DD, or null to unschedule."),
        start_time: orNull("string", "New start time, HH:MM 24-hour, or null for 'sometime that day'."),
        duration_minutes: { type: "integer", description: "How long it takes, 5 to 1440." },
        done: { type: "boolean", description: "Check off (true) or reopen (false). On a project this applies to every step under it. Checking off records the time in done_at; reopening clears it." },
        done_at: str("When it was really finished, to backdate a check-off: YYYY-MM-DD HH:MM in the person's local time (or just YYYY-MM-DD, read as noon), or ISO 8601 with an offset. The item must be done, or pass done: true too. Not in the future."),
        actual_minutes: { type: ["integer", "string", "null"], description: "How long it really took, in minutes (1 to 10080), or null to clear." },
        notes: orNull("string", "Replaces the notes. null clears them."),
        link: orNull("string", "Replaces the link. null removes it."),
        due: orNull("string", "Due date, YYYY-MM-DD, or null."),
        start: orNull("string", "Start date of a project or sub-project, YYYY-MM-DD, or null."),
        milestone: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "Make it a milestone (true) or a plain task (false, which also clears hard_deadline)." },
        hard_deadline: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "Mark a milestone's date as one that can't move. true also makes it a milestone." },
        waiting_on: orNull("string", "Id of the item this one waits on, or null to clear."),
        project_id: orNull("string", "Move under this project, or null to move to the inbox."),
        area: orNull("string", "For a top-level project or task: move it to this area, by name, or null for no area (a task goes back to the inbox)."),
        repeat: { ...REPEAT, type: ["object", "null"], description: REPEAT.description + " On a series (or one of its repeats) this changes how the whole series repeats; null stops it repeating, leaving it a plain task on its next day." },
        habit: { type: ["boolean", "string"], enum: [true, false, "true", "false"], description: "Mark it a habit (true): it still shows on its days, but its time doesn't count toward the week's scheduled hours. On a repeating task, pass the series_id." },
        position: str("Move it within its list (its project's steps, its area, or the inbox): \"first\", \"last\", or \"after:<item id>\" to go right after that item. Works with project_id or area, to place it in its new list."),
      },
    },
  },
  {
    name: "reorder_items",
    title: "Reorder steps or an area",
    description: "Puts the items in one list in a new order: a project's steps, an area's projects and standalone tasks, or the inbox. The ids you list go first, in that order; any you leave out keep their order after them. The app shows the same order.",
    inputSchema: {
      type: "object",
      required: ["parent", "ids"],
      properties: {
        parent: str("Whose list: a project's id, an area by name, or \"inbox\"."),
        ids: { type: "array", items: { type: "string" }, description: "Item ids in the new order. Each must already be in that list (move items with update_item first)." },
      },
    },
  },
  {
    name: "set_project_priority",
    title: "Set priority in an area",
    description: "Sets the priority order of an area's projects and standalone tasks, ranked together: the first id is its top priority, so a standalone task can come before a project. Items you leave out keep their order after the ones you list. get_next_task and the app's lists follow this order.",
    inputSchema: {
      type: "object",
      required: ["area", "project_ids"],
      properties: {
        area: str("The area, by name, such as Business."),
        project_ids: { type: "array", items: { type: "string" }, description: "Ids of that area's top-level projects and standalone tasks, most important first." },
      },
    },
  },
  {
    name: "get_next_task",
    title: "Next task in an area or project",
    description: "What to work on next in an area or project: the first open task in order that isn't done, isn't waiting on something unfinished, and isn't planned for a later day. For an area it looks through its projects and standalone tasks in priority order (ranked together), and skips a whole project that is waiting on something unfinished. Returns that task, its project, and the next two after it. The app shows the same next task on each area block in List view.",
    inputSchema: {
      type: "object",
      properties: {
        area: str("The area, by name. Give this or project_id."),
        project_id: str("The project or sub-project. Give this or area."),
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "delete_item",
    title: "Delete a task or project",
    description: "Deletes a task or project the way the app does: it goes to the Trash (nothing is lost; restore_item brings it back for 30 days). A project goes with all its steps, and with any area-time blocks planned for it. For a repeating task, pass one repeat's id (series id~date) to skip just that day, or the series_id to delete the whole series with all its repeats. Areas and labels aren't deleted here; time blocks go with remove_block.",
    inputSchema: { type: "object", required: ["id"], properties: { id: str("The item's id: a task, a project, one repeat (series id~date), or a whole series (its series_id).") } },
    annotations: { destructiveHint: true },
  },
  {
    name: "restore_item",
    title: "Restore from the Trash",
    description: "Brings back something deleted in the last 30 days (by you or in the app): a task, a project with the steps that were deleted along with it, a whole series with its repeats, or one skipped repeat. If it sat inside a project that's also deleted, that project comes back too (without its other deleted steps). list_deleted gives the ids.",
    inputSchema: { type: "object", required: ["id"], properties: { id: str("The id of the deleted item, from list_deleted or from what delete_item returned.") } },
  },
  {
    name: "list_deleted",
    title: "What's in the Trash",
    description: "Lists what was deleted recently (in the app or by you), newest first: each deleted task, project, series or single repeat with when it was deleted, where it was, and how many steps went with it. The app keeps these for 30 days in its Trash, then clears them out.",
    inputSchema: { type: "object", properties: { days: { type: "integer", description: "How many days back to look, 1 to 30. Default 30." } } },
    annotations: { readOnlyHint: true },
  },
];

export class Bad extends Error {}

function dayArg(v: unknown, name: string): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + "T00:00:00Z")) || new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v) {
    throw new Bad(`${name} must be a date like 2026-10-14.`);
  }
  return v;
}
function timeArg(v: unknown): number {
  const m = typeof v === "string" ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v) : null;
  if (!m) throw new Bad("start_time must be a 24-hour time like 09:30.");
  return +m[1] * 60 + +m[2];
}
function durArg(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 5 || v > 1440) throw new Bad("duration_minutes must be a whole number from 5 to 1440.");
  return v;
}
function linkArg(v: unknown): string {
  if (typeof v !== "string" || v.length > 2000) throw new Bad("link must be a web address.");
  let u: URL;
  try { u = new URL(v.trim()); } catch { throw new Bad("link must be a full web address starting with https://."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Bad("link must start with https:// or http://.");
  return u.href;
}
function textArg(v: unknown, name: string, max: number): string {
  if (typeof v !== "string") throw new Bad(`${name} must be text.`);
  if (v.length > max) throw new Bad(`${name} is too long (over ${max} characters).`);
  return v;
}
const hhmm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const now = () => Date.now() / 1000;

/* Repeating tasks, worked out the same way as the app (js/repeat.js). A series' repeats aren't stored;
   one is only stored once it's changed, checked off or skipped: id "<series id>~<date>". */
const utc = (s: string) => new Date(s + "T00:00:00Z");
const addDays = (s: string, n: number) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const dow = (s: string) => utc(s).getUTCDay();
const mondayOf = (s: string) => addDays(s, -((dow(s) + 6) % 7));
const between = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 864e5);
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_TEXT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function repeatsOn(r: Rule | null | undefined, start: string | null, d: string): boolean {
  if (!r || !start || d < start || (r.until && d > r.until)) return false;
  if (r.off?.some(([a, b]) => d >= a && d <= b)) return false; // put away (archived) for a while
  const w = dow(d);
  switch (r.every) {
    case "day": case "times": return true; // "times": due any day until the week (or month) has its n done
    case "days": return between(start, d) % Math.max(1, r.interval || 1) === 0;
    case "weekday": return w >= 1 && w <= 5;
    case "week": {
      if (!(r.days?.length ? r.days : [dow(start)]).includes(w)) return false;
      const n = Math.max(1, r.interval || 1);
      return n === 1 || (between(mondayOf(start), mondayOf(d)) / 7) % n === 0;
    }
    case "month": {
      const x = utc(d), last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
      return x.getUTCDate() === Math.min(r.dom || utc(start).getUTCDate(), last);
    }
  }
  return false;
}
function ruleText(r: Rule, start: string): string {
  let t = "";
  if (r.every === "day") t = "every day";
  else if (r.every === "weekday") t = "weekdays";
  else if (r.every === "week") {
    const days = r.days?.length ? r.days : [dow(start)], n = r.interval || 1;
    const names = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAY_TEXT[d]).join(", ");
    t = n > 1 ? `every ${n} weeks on ${names}` : `every ${names}`;
  } else if (r.every === "days") t = `every ${r.interval || 2} days`;
  else if (r.every === "times") t = `${r.n || 1} times a ${r.per === "month" ? "month" : "week"}, on any days`;
  else t = `monthly on day ${r.dom || utc(start).getUTCDate()}`;
  return t + (r.until ? ` until ${r.until}` : "");
}
/** A repeat rule from Claude: an object (or the same as JSON text). */
function repeatArg(v: unknown, start: string): Rule {
  let o = v;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch { o = { every: o.trim().toLowerCase() }; } }
  if (!o || typeof o !== "object") throw new Bad("repeat must be an object such as {\"every\": \"week\", \"days\": [\"mon\"]}.");
  const a = o as Record<string, unknown>;
  const every = String(a.every ?? "").trim().toLowerCase().replace(/^(daily|days)$/, "day").replace(/^(weekdays)$/, "weekday").replace(/^(weekly|weeks)$/, "week").replace(/^(monthly|months)$/, "month");
  if (!["day", "weekday", "week", "month", "days", "times"].includes(every)) throw new Bad("repeat.every must be day, weekday, week, month, days or times.");
  const r: Rule = { every: every as Rule["every"] };
  if (every === "week") {
    const raw = a.days == null ? [] : Array.isArray(a.days) ? a.days : [a.days];
    const days = raw.map((d) => {
      const i = typeof d === "number" ? d : DAY_NAMES.indexOf(String(d).trim().toLowerCase().slice(0, 3));
      if (!Number.isInteger(i) || i < 0 || i > 6) throw new Bad(`repeat.days: ${JSON.stringify(d)} isn't a weekday. Use mon, tue, wed, thu, fri, sat or sun.`);
      return i;
    });
    r.days = [...new Set(days.length ? days : [dow(start)])].sort((x, y) => x - y);
    const n = a.interval == null ? 1 : Number(a.interval);
    if (!Number.isInteger(n) || n < 1 || n > 12) throw new Bad("repeat.interval must be a whole number of weeks from 1 to 12.");
    r.interval = n;
  } else if (every === "days") {
    const n = Number(a.interval ?? 2);
    if (!Number.isInteger(n) || n < 2 || n > 90) throw new Bad("repeat.interval must be a whole number of days from 2 to 90 for every: days.");
    r.interval = n;
  } else if (every === "times") {
    const per = String(a.per ?? "week").toLowerCase() === "month" ? "month" : "week", n = Number(a.times ?? a.n ?? 2);
    if (!Number.isInteger(n) || n < 1 || n > (per === "month" ? 30 : 6)) throw new Bad(`repeat.times must be a whole number from 1 to ${per === "month" ? 30 : 6}.`);
    r.per = per; r.n = n;
  } else if (a.days != null || (a.interval != null && Number(a.interval) !== 1)) throw new Bad("repeat.days are only for every: week, and interval for week or days.");
  if (every === "month") r.dom = utc(start).getUTCDate();
  if (a.until != null && a.until !== "") {
    r.until = dayArg(a.until, "repeat.until");
    if (r.until < start) throw new Bad(`repeat.until (${r.until}) is before the day it starts (${start}).`);
  }
  return r;
}
// What a stored repeat shares with its series, and what a change to the series hands down to them
const SHARED: (keyof Row)[] = ["parent_id", "title", "notes", "start_min", "after_min", "duration_min", "sort", "day_sort", "color", "link", "area_id", "waits_on", "kind", "focus_on", "labels"];
const FOLLOW: (keyof Row)[] = ["parent_id", "title", "notes", "start_min", "duration_min", "color", "link", "waits_on", "area_id", "focus_on", "labels"];

/** Order among siblings: sort, then (for equal sorts) the order they were made in. */
const bySort = (a: Row, b: Row) => (a.sort || 0) - (b.sort || 0);

/** The person's items as a tree, with the lookups the tools need. */
class Tree {
  byId = new Map<string, Row>();
  /** The person's time zone, for showing done_at; UTC when unknown. */
  tz: string | null = null;
  kids = new Map<string, Row[]>();
  /** Areas (Business, Personal…) are rows too, kept apart from the items. */
  areas: Row[];
  /** Stored repeats of each series by the date they were due (skipped ones too), and the ones still on the plan. */
  occ = new Map<string, Map<string, Row>>();
  occLive = new Map<string, Row>();
  series: Row[] = [];
  raw: Row[];
  /** Blocks of area time, kept apart from the items (see blockTree). */
  blockRows: Row[];
  /** Labels (Building, a client…), which cut across areas. */
  labelRows: Row[];
  constructor(all: Row[]) {
    this.raw = all;
    this.labelRows = all.filter((r) => r.kind === "label" && !r.deleted).sort(bySort);
    all = all.filter((r) => r.kind !== "label");
    this.blockRows = all.filter((r) => r.kind === "block");
    all = all.filter((r) => r.kind !== "block");
    this.areas = all.filter((r) => r.kind === "area" && !r.deleted).sort((a, b) => a.sort - b.sort);
    for (const r of all) if (r.series_id) {
      if (r.occurs_on) { const m = this.occ.get(r.series_id) ?? new Map(); m.set(r.occurs_on, r); this.occ.set(r.series_id, m); }
      if (!r.deleted) this.occLive.set(r.id, r);
    }
    const rows = all.filter((r) => r.kind !== "area" && !r.deleted && !r.series_id);
    this.series = rows.filter((r) => r.repeat_rule);
    for (const r of rows) this.byId.set(r.id, r);
    for (const r of rows) if (r.parent_id && this.byId.has(r.parent_id)) {
      const k = this.kids.get(r.parent_id) ?? [];
      k.push(r);
      this.kids.set(r.parent_id, k);
    }
    for (const k of this.kids.values()) k.sort(bySort);
  }
  get(id: unknown): Row {
    const r = typeof id === "string" ? this.byId.get(id) ?? this.occLive.get(id) ?? this.ghost(id) : undefined;
    if (!r) throw new Bad(`No item with id ${JSON.stringify(id)}. Use list_tasks or list_projects to find ids.`);
    return r;
  }
  /** A repeat that isn't stored, worked out from its series (not saved until it's changed). */
  ghost(id: string): Row | undefined {
    const m = /^(.+)~(\d{4}-\d{2}-\d{2})$/.exec(id);
    const s = m ? this.byId.get(m[1]) : undefined;
    if (!m || !s?.repeat_rule || !repeatsOn(s.repeat_rule, s.day, m[2]) || this.occ.get(s.id)?.has(m[2])) return undefined;
    return this.virt(s, m[2]);
  }
  virt(s: Row, d: string): Row {
    const r = newRow({ id: `${s.id}~${d}`, day: d, series_id: s.id, occurs_on: d, repeat_rule: null });
    for (const k of SHARED) (r as Record<string, unknown>)[k] = s[k] ?? null;
    return r;
  }
  /** Every repeat on day d: stored ones on it, and worked-out ones due that day. */
  occOn(d: string): Row[] {
    const out = [...this.occLive.values()].filter((r) => r.day === d);
    for (const s of this.series) if (repeatsOn(s.repeat_rule, s.day, d) && !this.occ.get(s.id)?.has(d)) out.push(this.virt(s, d));
    return out;
  }
  occBetween(from: string, to: string): Row[] {
    const out: Row[] = [];
    for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) out.push(...this.occOn(d));
    return out;
  }
  /** This tree with some rows changed or added. */
  with(changed: Row[]) {
    const ids = new Set(changed.map((c) => c.id));
    const t = new Tree([...this.raw.filter((r) => !ids.has(r.id)), ...changed]);
    t.tz = this.tz;
    return t;
  }
  /** The blocks as a tree of their own, so repeating blocks work out their repeats the way tasks do. */
  blockTree() { const b = new Tree(this.blockRows.map((r) => ({ ...r, kind: null }))); b.tz = this.tz; return b; }
  children = (id: string) => this.kids.get(id) ?? [];
  /** Every label an item wears: its own, its project's (all the way up), and for a repeat, its series'. */
  labelsOf(r: Row): Row[] {
    const out: Row[] = [], seen = new Set<string>();
    let h: Row | undefined = r.series_id ? this.byId.get(r.series_id) ?? r : r;
    for (let i = 0; h && i < 60; i++) {
      for (const id of h.labels ?? []) { const l = this.labelRows.find((x) => x.id === id); if (l && !seen.has(id)) { seen.add(id); out.push(l); } }
      h = h.parent_id ? this.byId.get(h.parent_id) : undefined;
    }
    return out;
  }
  areaOf = (r: Row) => (r.parent_id == null && r.area_id ? this.areas.find((a) => a.id === r.area_id) : undefined);
  area(v: unknown): Row {
    const name = typeof v === "string" ? v.trim().toLowerCase() : "";
    const a = this.areas.find((x) => x.id === v || x.title.trim().toLowerCase() === name);
    if (!a) throw new Bad(`No area called ${JSON.stringify(v)}. The areas are: ${this.areas.map((x) => x.title).join(", ") || "none yet"}.`);
    return a;
  }
  isProject = (r: Row) => this.children(r.id).length > 0 || (r.parent_id == null && !!r.color);
  /** Which list an item sits in, the way the app groups them: a project's steps (p:<id>), an area's projects and
   *  standalone tasks (a:<area id>, or a: for projects in no area), or the inbox (loose). */
  groupOf(r: Row): string {
    if (r.parent_id) return "p:" + r.parent_id;
    const a = r.area_id && this.areas.some((x) => x.id === r.area_id) ? r.area_id : "";
    return this.isProject(r) || a ? "a:" + a : "loose";
  }
  /** The items in a list, in order. */
  group(key: string): Row[] {
    if (key.startsWith("p:")) return this.children(key.slice(2));
    return [...this.byId.values()].filter((r) => r.parent_id == null && this.groupOf(r) === key).sort(bySort);
  }
  position = (r: Row) => this.group(this.groupOf(r)).findIndex((x) => x.id === r.id) + 1;
  /** Priority: a top-level project's or standalone task's rank in its area (both ranked together), 1 first. */
  priority(r: Row): number | null {
    if (r.parent_id || !this.areaOf(r)) return null;
    return this.position(r);
  }
  /** These items and everything under them, depth first, in order. */
  flat(rows: Row[]): Row[] { return rows.flatMap((r) => [r, ...this.flat(this.children(r.id))]); }
  /** An area's projects and standalone tasks in priority order. */
  areaItems = (a: Row): Row[] => this.group("a:" + a.id);
  /** A habit: on the item, or on the series a repeat belongs to. */
  isHabit = (r: Row) => !!(r.habit || (r.series_id && this.byId.get(r.series_id)?.habit));
  /** What to work on next under these items, in order: open tasks that aren't waiting on something unfinished or
   *  planned for a later day (nor inside a project that is). Repeating tasks are left out; they come on their days. */
  nextUp(roots: Row[], today: string): Row[] {
    const blocked = (r: Row) => {
      if (r.day && r.day > today) return true;
      if (r.waits_on) { const w = this.byId.get(r.waits_on); if (w && !this.isDone(w)) return true; }
      return false;
    };
    const walk = (r: Row): Row[] => {
      if (blocked(r)) return [];
      const k = this.children(r.id);
      if (k.length) return k.flatMap(walk);
      return r.done || r.repeat_rule || (r.parent_id == null && r.color) ? [] : [r];
    };
    return roots.flatMap(walk);
  }
  leaves(r: Row): Row[] {
    const k = this.children(r.id);
    return k.length ? k.flatMap((c) => this.leaves(c)) : [r];
  }
  progress(r: Row) {
    const L = this.children(r.id).length ? this.leaves(r).filter((l) => !l.repeat_rule) : []; // a repeating task never finishes
    return { done: L.filter((l) => l.done).length, total: L.length };
  }
  isDone(r: Row) {
    if (!this.children(r.id).length) return r.done;
    const p = this.progress(r);
    return p.total > 0 && p.done === p.total;
  }
  ancestors(r: Row): Row[] {
    const a: Row[] = [];
    let p = r.parent_id ? this.byId.get(r.parent_id) : undefined;
    while (p && a.length < 50) { a.unshift(p); p = p.parent_id ? this.byId.get(p.parent_id) : undefined; }
    return a;
  }
  describe(r: Row, full = false) {
    const o: Record<string, unknown> = { id: r.id, title: r.title };
    const path = this.ancestors(r).map((a) => a.title).join(" › ");
    if (path) o.project = path;
    const area = this.areaOf(this.ancestors(r)[0] ?? r);
    if (area) o.area = area.title;
    if (this.children(r.id).length) { const p = this.progress(r); o.progress = `${p.done}/${p.total} done`; }
    else {
      o.done = r.done;
      if (r.done && r.done_at) o.done_at = localStamp(r.done_at, this.tz);
    }
    if (r.actual_minutes) o.actual_minutes = r.actual_minutes;
    if (r.time_log?.length) o.time_log = r.time_log.map((e) => ({
      start: localStamp(e.start, this.tz), end: e.end ? localStamp(e.end, this.tz) : "recording now",
      minutes: Math.max(0, Math.round(((e.end ? Date.parse(e.end) : Date.now()) - Date.parse(e.start)) / 60000)), ...(e.guess ? { guessed: true } : {}), ...(e.est ? { estimated: true } : {}),
    }));
    if (r.planned) o.planned = { day: r.planned.day, ...(r.planned.start_min != null ? { start_time: hhmm(r.planned.start_min) } : {}), duration_minutes: r.planned.duration_min };
    if (r.repeat_rule && r.day) {
      o.repeats = ruleText(r.repeat_rule, r.day); o.starts = r.day;
      o.repeat = { every: r.repeat_rule.every, ...(r.repeat_rule.every === "week" ? { days: (r.repeat_rule.days ?? []).map((d) => DAY_NAMES[d]), interval: r.repeat_rule.interval ?? 1 } : {}), ...(r.repeat_rule.until ? { until: r.repeat_rule.until } : {}) };
      delete o.done;
    } else if (r.day) o.day = r.day;
    if (r.series_id) { o.series_id = r.series_id; const s = this.byId.get(r.series_id); if (s?.repeat_rule && s.day) o.repeats = ruleText(s.repeat_rule, s.day); }
    if (r.start_min != null) o.start_time = hhmm(r.start_min);
    if (!this.isProject(r)) o.duration_minutes = r.duration_min;
    if (r.start) o.start = r.start;
    if (r.due) o.due = r.due;
    if (r.milestone) o.milestone = true;
    if (r.hard_deadline) o.hard_deadline = true;
    if (r.waits_on) { const w = this.byId.get(r.waits_on); if (w) o.waiting_on = { id: w.id, title: w.title }; }
    if (r.link) o.link = r.link;
    { const lb = this.labelsOf(r).map((l) => l.title); if (lb.length) o.labels = lb; }
    if (this.isHabit(r)) o.habit = true;
    if (this.byId.get(r.id) === r) { // its place in its list (repeats sit on their days instead)
      o.position = this.position(r); o.sort = r.sort;
      const pr = this.priority(r); if (pr) o.priority = pr;
    }
    if (r.notes) o.notes = full || r.notes.length <= 200 ? r.notes : r.notes.slice(0, 200) + "…";
    return o;
  }
}

function newRow(fields: Partial<Row>): Row {
  return { id: crypto.randomUUID(), parent_id: null, title: "", notes: null, done: false, day: null, start_min: null, after_min: null, duration_min: 60, sort: now(), color: null, due: null, link: null, kind: null, area_id: null, start: null, milestone: false, hard_deadline: false, waits_on: null, focus_on: null, deleted: false, ...fields };
}

/** true or false, also written as the text "true" or "false" (some clients send flags as text). */
function boolArg(v: unknown, name: string): boolean {
  if (typeof v === "boolean") return v;
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "true" || t === "false") return t === "true";
  throw new Bad(`${name} must be true or false.`);
}
/** Start, due, milestone, hard deadline and waiting on, shared by add_task, add_project and update_item. */
function roadmapArgs(t: Tree, args: Record<string, unknown>, r: Partial<Row> & { id?: string }) {
  if (has(args, "start")) r.start = args.start === null ? null : dayArg(args.start, "start");
  if (has(args, "milestone")) { r.milestone = boolArg(args.milestone, "milestone"); if (!r.milestone) r.hard_deadline = false; }
  if (has(args, "hard_deadline")) { r.hard_deadline = boolArg(args.hard_deadline, "hard_deadline"); if (r.hard_deadline) r.milestone = true; }
  if (has(args, "waiting_on")) {
    if (args.waiting_on === null || args.waiting_on === "") r.waits_on = null;
    else {
      const w = t.get(args.waiting_on);
      if (w.id === r.id) throw new Bad("An item can't wait on itself.");
      r.waits_on = w.id;
    }
  }
  if (r.start && r.due && r.start > r.due) throw new Bad(`start (${r.start}) is after due (${r.due}). Change both together, or pass the other one too.`);
}

/** The wall-clock parts of an instant in a time zone, and that zone's offset from UTC in minutes. */
function zoned(ms: number, tz: string | null) {
  let p: Record<string, string>;
  try {
    p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz ?? "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  } catch { return zoned(ms, null); } // an unknown zone name
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, off: Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000) };
}
/** done_at as the person reads it: local time with its offset, such as 2026-10-16T14:05+02:00. */
function localStamp(iso: string, tz: string | null): string {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return iso;
  const z = zoned(ms, tz), a = Math.abs(z.off);
  return `${z.date}T${z.time}${z.off ? (z.off < 0 ? "-" : "+") + String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0") : "Z"}`;
}
/** A finish time from Claude: local wall time (in tz), a bare date (noon), or ISO 8601 with an offset. */
function doneAtArg(v: unknown, tz: string | null, nowMs = Date.now()): string {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(v.trim()) : null;
  if (!m) throw new Bad("done_at must be a local time like 2026-10-14 16:30, a date like 2026-10-14, or ISO 8601 with an offset.");
  const [, y, mo, d, h = "12", mi = "00", sec = "00", zone] = m;
  dayArg(`${y}-${mo}-${d}`, "done_at");
  if (+h > 23) throw new Bad("done_at's hour must be 0 to 23.");
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  let ms: number;
  if (zone) {
    const z = zone.toUpperCase() === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (+zone.slice(1, 3) * 60 + +zone.slice(-2));
    ms = wall - z * 60000;
  } else {
    ms = wall - zoned(wall, tz).off * 60000;
    ms = wall - zoned(ms, tz).off * 60000; // settle the offset near a clock change
  }
  if (ms > nowMs + 5 * 60000) throw new Bad("done_at can't be in the future.");
  if (ms < Date.UTC(2000, 0, 1)) throw new Bad("done_at is too far back.");
  return new Date(ms).toISOString();
}
function minutesArg(v: unknown): number {
  const n = typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 10080) throw new Bad("actual_minutes must be a whole number of minutes from 1 to 10080.");
  return n;
}

function idList(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || !v.length || v.length > 500 || v.some((x) => typeof x !== "string")) throw new Bad(`${name} must be a list of item ids.`);
  if (new Set(v).size !== v.length) throw new Bad(`${name} lists an id twice.`);
  return v as string[];
}
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

function hoursArg(v: unknown): number {
  const n = typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 168) throw new Bad("hours must be a whole number from 1 to 168.");
  return n;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Scheduled task hours (and area time) in each of the next weeks (Monday first), as the Roadmap counts them: every repeat counts. */
function weekLoad(t: Tree, free: number, today = new Date(), weeks = 4) {
  const rows = [...t.byId.values()].filter((r) => !r.repeat_rule && !t.isHabit(r)); // habits don't count
  const mon = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  mon.setUTCDate(mon.getUTCDate() - (mon.getUTCDay() + 6) % 7);
  return Array.from({ length: weeks }, (_, i) => {
    const a = new Date(mon); a.setUTCDate(a.getUTCDate() + i * 7);
    const b = new Date(a); b.setUTCDate(b.getUTCDate() + 6);
    const from = ymd(a), to = ymd(b);
    const bt = t.blockTree(), blocks = [...bt.byId.values()].filter((r) => !r.repeat_rule && !r.done && r.day && r.day >= from && r.day <= to).concat(bt.occBetween(from, to).filter((r) => !r.done)); // area time counts too
    const h = [...rows.filter((r) => r.day && r.day >= from && r.day <= to), ...t.occBetween(from, to).filter((r) => !t.isHabit(r)), ...blocks].reduce((s, r) => s + (r.duration_min || 60) / 60, 0);
    const hours = Math.round(h * 2) / 2;
    return { week_of: from, scheduled_hours: hours, ...(hours > free ? { over_by: Math.round((hours - free) * 2) / 2 } : {}) };
  });
}

/** A note as Claude reads it back: local times, and the tasks it mentions by name. */
function noteOut(t: Tree, n: Note) {
  const tasks = n.task_ids.map((id) => { try { const r = t.get(id); return { id, title: r.title, ...(t.isDone(r) ? { done: true } : {}) }; } catch { return { id, title: null, deleted: true }; } });
  return { id: n.id, from: n.author, title: n.title, message: n.body, link: n.link, ...(tasks.length ? { tasks } : {}), posted_at: localStamp(n.created_at, t.tz), read: !!n.read_at, ...(n.read_at ? { read_at: localStamp(n.read_at, t.tz) } : {}) };
}

/** A Needs you item as Claude reads it back. */
function needOut(n: Note, tz: string | null) {
  const days = Math.floor((Date.now() - Date.parse(n.created_at)) / 864e5);
  return { id: n.id, kind: n.kind, title: n.title, ...(n.body ? { details: n.body } : {}), project: n.project, link: n.link, ...(n.project_link ? { project_link: n.project_link } : {}), from: n.author,
    since: localStamp(n.created_at, tz), waiting_days: days, open: !n.resolved_at, ...(n.resolved_at ? { cleared_at: localStamp(n.resolved_at, tz) } : {}) };
}
/** A claude.ai project thread link (…/project/ID?thread=…) points into its project; the project's own address drops the thread. */
function projectLinkOf(link: string): string | null {
  const m = /^(https:\/\/claude\.ai\/(?:code\/)?project\/[\w-]+)[?#]/.exec(link);
  return m ? m[1] : null;
}

export async function runNeeds(name: string, args: Record<string, unknown>, db: Db): Promise<unknown> {
  const tz = await db.timeZone();
  if (name === "raise_needs_you") {
    const kind = String(args.kind ?? "") as Kind;
    if (!KINDS.includes(kind)) throw new Bad("kind must be decision, blocked or review.");
    const title = textArg(args.title, "title", 120).trim(), project = textArg(args.project, "project", 60).trim();
    if (!title) throw new Bad("title can't be empty.");
    if (!project) throw new Bad("project can't be empty: the name of the Claude project this chat belongs to.");
    if (!has(args, "link")) throw new Bad("link is required: the address of this chat, so the person can jump to it.");
    const link = linkArg(args.link);
    const body = has(args, "details") ? textArg(args.details, "details", 2000).trim() : "";
    const project_link = has(args, "project_link") && args.project_link ? linkArg(args.project_link) : projectLinkOf(link);
    const author = has(args, "from") ? textArg(args.from, "from", 40).trim() || "Claude" : "Claude";
    const open = await db.openNeed(link);
    if (open) {
      // Still the same wait keeps its age; a new kind of wait starts over
      const n = await db.updateNeed(open.id, { kind, title, body, project, project_link, author, ...(open.kind !== kind ? { created_at: new Date().toISOString() } : {}) });
      return { updated: needOut(n, tz) };
    }
    return { raised: needOut(await db.addNeed({ kind, title, body, project, project_link, link, author }), tz) };
  }
  if (name === "clear_needs_you") {
    let n: Note | null = null;
    if (has(args, "id") && args.id) { n = await db.getNeed(String(args.id)); if (!n) throw new Bad(`No Needs you item with id ${args.id}.`); }
    else if (has(args, "link") && args.link) n = await db.openNeed(linkArg(args.link));
    else throw new Bad("Pass the chat's link or the item's id.");
    if (!n) return { cleared: null, note: "Nothing open for that link; it may already be cleared." };
    if (n.resolved_at) return { cleared: needOut(n, tz), note: "It was already cleared." };
    return { cleared: needOut(await db.updateNeed(n.id, { resolved_at: new Date().toISOString() }), tz) };
  }
  const all = has(args, "include_cleared") ? boolArg(args.include_cleared, "include_cleared") : false;
  const proj = typeof args.project === "string" ? args.project.trim().toLowerCase() : "";
  let rows = await db.listNeeds(200, all);
  if (proj) rows = rows.filter((n) => (n.project ?? "").toLowerCase() === proj);
  const open = rows.filter((n) => !n.resolved_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const done = rows.filter((n) => n.resolved_at).slice(0, 30);
  return { open: open.map((n) => needOut(n, tz)), ...(all ? { cleared: done.map((n) => needOut(n, tz)) } : {}), ...(open.length ? {} : { note: "Nothing is waiting on them." }) };
}

/** An update as Claude reads it back. */
function updateOut(u: Update, tz: string | null) {
  return { id: u.id, text: u.text, state: u.state, project: u.project, ...(u.thread ? { thread: u.thread } : {}), link: u.link, ...(u.place ? { place: u.place } : {}), at: localStamp(u.created_at, tz) };
}

export async function runUpdates(name: string, args: Record<string, unknown>, db: Db): Promise<unknown> {
  const tz = await db.timeZone();
  if (name === "log_update") {
    const text = textArg(args.text, "text", 200).trim(), project = textArg(args.project, "project", 60).trim();
    if (!text) throw new Bad("text can't be empty: one line of what changed.");
    if (!project) throw new Bad("project can't be empty: the name of the Claude project this chat belongs to.");
    if (!has(args, "link")) throw new Bad("link is required: the address of this chat, so the person can jump to it.");
    const state = (has(args, "state") && args.state ? String(args.state) : "done") as UpdateState;
    if (!STATES.includes(state)) throw new Bad("state must be done, live or working.");
    const link = linkArg(args.link);
    const thread = has(args, "thread") && args.thread ? textArg(args.thread, "thread", 80).trim() || null : null;
    const project_link = has(args, "project_link") && args.project_link ? linkArg(args.project_link) : projectLinkOf(link);
    const place = has(args, "place") && args.place ? linkArg(args.place) : null;
    return { logged: updateOut(await db.addUpdate({ text, state, project, thread, link, project_link, place }), tz) };
  }
  const day = has(args, "since") && args.since ? dayArg(args.since, "since") : zoned(Date.now(), tz).date;
  const proj = typeof args.project === "string" ? args.project.trim().toLowerCase() : "";
  // A day starts at local midnight; a day back is plenty of slack for any time zone
  let rows = (await db.listUpdates(new Date(Date.parse(day + "T00:00:00Z") - 864e5).toISOString(), 300)).filter((u) => zoned(Date.parse(u.created_at), tz).date >= day);
  if (proj) rows = rows.filter((u) => u.project.toLowerCase() === proj);
  return { since: day, updates: rows.map((u) => updateOut(u, tz)), ...(rows.length ? {} : { note: "Nothing logged yet." }) };
}

export async function runTool(name: string, args: Record<string, unknown>, db: Db): Promise<unknown> {
  if (["raise_needs_you", "clear_needs_you", "list_needs_you"].includes(name)) return runNeeds(name, args, db);
  if (name === "log_update" || name === "list_updates") return runUpdates(name, args, db);
  if (name === "set_free_hours") { const h = hoursArg(args.hours); await db.setFreeHours(h); return { free_hours_per_week: h }; }
  const t = new Tree(await db.load());
  if (["list_tasks", "list_projects", "get_item", "update_item", "add_task", "post_note", "list_notes", "get_next_task", "get_area_progress", "get_area_targets", "set_area_targets"].includes(name)) t.tz = await db.timeZone();
  const today = () => zoned(Date.now(), t.tz).date;
  switch (name) {
    case "get_free_hours": {
      const set = await db.getFreeHours(), free = set ?? FREE_DEFAULT;
      return { free_hours_per_week: free, ...(set == null ? { note: `Not set yet; the Roadmap assumes ${FREE_DEFAULT}.` } : {}), weeks: weekLoad(t, free) };
    }
    case "list_tasks": {
      const from = has(args, "from") ? dayArg(args.from, "from") : null;
      const to = has(args, "to") ? dayArg(args.to, "to") : null;
      const under = has(args, "project_id") ? t.get(args.project_id) : null;
      const inArea = has(args, "area") ? t.area(args.area) : null;
      if (under && inArea) throw new Bad("Give either project_id or area, not both.");
      const words = typeof args.query === "string" ? args.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
      let rows = [...t.byId.values()].filter((r) => !t.isProject(r));
      const since = has(args, "done_since") ? dayArg(args.done_since, "done_since") : null;
      // With dates, a repeating task is each of its repeats in the range; without, the series itself
      if (from || to) {
        const lo = from ?? (to! < today() ? to! : today()), hi = to ?? addDays(lo, 31);
        rows = rows.filter((r) => !r.repeat_rule).concat(hi >= lo ? t.occBetween(lo, hi < addDays(lo, 366) ? hi : addDays(lo, 366)) : []);
      } else if (since) rows = rows.concat([...t.occLive.values()].filter((r) => r.done));
      if (since) rows = rows.filter((r) => r.done && r.done_at && zoned(Date.parse(r.done_at), t.tz).date >= since);
      else if (!args.include_done) rows = rows.filter((r) => !r.done);
      if (args.unscheduled) rows = rows.filter((r) => !r.day && !t.ancestors(r).some((a) => a.day));
      if (from) rows = rows.filter((r) => r.day && r.day >= from);
      if (to) rows = rows.filter((r) => r.day && r.day <= to);
      if (under) rows = rows.filter((r) => t.ancestors(r).includes(under));
      if (inArea) rows = rows.filter((r) => t.areaOf(t.ancestors(r)[0] ?? r) === inArea);
      if (words.length) rows = rows.filter((r) => words.every((w) => r.title.toLowerCase().includes(w)));
      const scope = under ? t.flat(t.children(under.id)) : inArea ? t.flat(t.areaItems(inArea)) : null;
      if (scope && !from && !to && !since) { const at = new Map(scope.map((r, i) => [r.id, i])); rows.sort((a, b) => (at.get(a.id) ?? 1e9) - (at.get(b.id) ?? 1e9)); } // the project's or area's own order
      else if (since) rows.sort((a, b) => (a.done_at ?? "").localeCompare(b.done_at ?? ""));
      else rows.sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999") || (a.start_min ?? 1e4) - (b.start_min ?? 1e4) || (a.day_sort ?? a.sort) - (b.day_sort ?? b.sort));
      const out = rows.slice(0, 300).map((r) => t.describe(r));
      return rows.length > 300 ? { tasks: out, note: `Showing 300 of ${rows.length}. Narrow it down with dates or a project.` } : { tasks: out };
    }
    case "post_note": {
      const title = textArg(args.title, "title", 120).trim(), body = textArg(args.message, "message", 6000).trim();
      if (!title) throw new Bad("title can't be empty.");
      if (!body) throw new Bad("message can't be empty.");
      if (!has(args, "link")) throw new Bad("link is required: the address of this Claude chat, so the person can come back to it.");
      const link = linkArg(args.link);
      const author = has(args, "from") ? textArg(args.from, "from", 40).trim() || "Claude" : "Claude";
      const raw = has(args, "task_ids") ? args.task_ids : [];
      if (!Array.isArray(raw)) throw new Bad("task_ids must be a list of item ids.");
      if (raw.length > 50) throw new Bad("task_ids can list up to 50 items.");
      const task_ids = [...new Set(raw.map((id) => t.get(id).id))];
      const n = await db.addNote({ author, title, body, link, task_ids });
      return { posted: noteOut(t, n) };
    }
    case "list_notes": {
      const unread = has(args, "unread_only") ? boolArg(args.unread_only, "unread_only") : false;
      const lim = has(args, "limit") ? Number(args.limit) : 20;
      if (!Number.isInteger(lim) || lim < 1 || lim > 100) throw new Bad("limit must be a whole number from 1 to 100.");
      const notes = await db.listNotes(lim, unread);
      return { notes: notes.map((n) => noteOut(t, n)), ...(notes.length ? {} : { note: unread ? "No unread notes." : "No notes yet." }) };
    }
    case "list_projects": {
      // Area by area, projects by priority, each followed by its sub-projects in order; then projects in no area
      const tops = [...t.areas.map((a) => t.group("a:" + a.id)), t.group("a:")].flat().filter((r) => t.isProject(r));
      const rows = t.flat(tops).filter((r) => t.isProject(r) && (args.include_done || !t.isDone(r)));
      return { areas: t.areas.map((a) => a.title), projects: rows.map((r) => t.describe(r)) };
    }
    case "get_item": {
      const r = t.get(args.id);
      return { ...t.describe(r, true), steps: t.children(r.id).map((c) => t.describe(c)) };
    }
    case "add_task": {
      const f: Partial<Row> = { title: textArg(args.title, "title", 500).trim() };
      if (!f.title) throw new Bad("title can't be empty.");
      if (has(args, "project_id")) f.parent_id = t.get(args.project_id).id;
      if (has(args, "area")) { if (f.parent_id) throw new Bad("Give either project_id or area, not both."); f.area_id = t.area(args.area).id; }
      if (has(args, "day")) f.day = dayArg(args.day, "day");
      if (has(args, "start_time")) { if (!f.day) throw new Bad("start_time needs a day."); f.start_min = timeArg(args.start_time); }
      if (has(args, "duration_minutes")) f.duration_min = durArg(args.duration_minutes);
      if (has(args, "notes")) f.notes = textArg(args.notes, "notes", 20000) || null;
      if (has(args, "link")) f.link = linkArg(args.link);
      if (has(args, "due")) f.due = dayArg(args.due, "due");
      roadmapArgs(t, args, f);
      if (has(args, "repeat")) {
        if (f.milestone) throw new Bad("A repeating task can't be a milestone.");
        if (!f.day) f.day = today();
        f.repeat_rule = repeatArg(args.repeat, f.day);
      }
      if (has(args, "habit")) f.habit = boolArg(args.habit, "habit");
      const r = newRow(f);
      await db.save([r]);
      return { added: t.with([r]).describe(r) };
    }
    case "add_project": {
      const used = new Set([...t.byId.values()].filter((r) => r.parent_id == null && r.color).map((r) => r.color));
      const f: Partial<Row> = { title: textArg(args.title, "title", 500).trim(), color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[t.byId.size % PALETTE.length] };
      if (!f.title) throw new Bad("title can't be empty.");
      if (has(args, "area")) { f.area_id = t.area(args.area).id; f.color = "area"; } // wears its area's colour
      if (has(args, "notes")) f.notes = textArg(args.notes, "notes", 20000) || null;
      if (has(args, "link")) f.link = linkArg(args.link);
      if (has(args, "due")) f.due = dayArg(args.due, "due");
      roadmapArgs(t, args, f);
      const r = newRow(f);
      await db.save([r]);
      return { added: { id: r.id, title: r.title, ...(f.area_id ? { area: t.area(f.area_id).title } : {}), ...(r.start ? { start: r.start } : {}), ...(r.due ? { due: r.due } : {}) } };
    }
    case "add_steps": {
      const p = t.get(args.parent_id);
      if (p.repeat_rule || p.series_id) throw new Bad("A repeating task can't have steps.");
      if (!Array.isArray(args.steps) || !args.steps.length || args.steps.length > 50) throw new Bad("steps must list 1 to 50 steps.");
      const base = Math.max(now(), ...t.children(p.id).map((c) => c.sort));
      const rows = args.steps.map((s: Record<string, unknown>, i: number) => {
        const title = textArg(s?.title, "step title", 500).trim();
        if (!title) throw new Bad("A step's title can't be empty.");
        return newRow({ parent_id: p.id, title, duration_min: s.duration_minutes == null ? 30 : durArg(s.duration_minutes), sort: base + (i + 1) / 1000 });
      });
      await db.save(rows);
      return { added: rows.map((r) => ({ id: r.id, title: r.title })), under: p.title };
    }
    case "reorder_items": {
      const p = typeof args.parent === "string" ? args.parent.trim() : "";
      if (!p) throw new Bad("parent must be a project's id, an area's name, or \"inbox\".");
      const key = p.toLowerCase() === "inbox" ? "loose" : t.byId.has(p) ? "p:" + p : "a:" + t.area(p).id;
      const ids = idList(args.ids, "ids");
      const list = t.group(key), out = ids.map((id) => {
        const r = list.find((x) => x.id === id);
        if (!r) throw new Bad(`${JSON.stringify(id)} isn't in that list. Its items are: ${list.map((x) => `${x.title} (${x.id})`).join(", ") || "none"}. Move an item there with update_item first.`);
        return r;
      });
      const order = [...out, ...list.filter((x) => !ids.includes(x.id))];
      const changed = order.map((x, j) => ({ ...x, sort: j })).filter((x, j) => list[j]?.id !== x.id || list[j].sort !== j);
      if (changed.length) await db.save(changed);
      const after = t.with(changed);
      return { order: after.group(key).map((x) => ({ position: after.position(x), id: x.id, title: x.title })) };
    }
    case "set_project_priority": {
      const a = t.area(args.area), key = "a:" + a.id, ids = idList(args.project_ids, "project_ids");
      // Projects and standalone tasks are ranked together: the listed ones first, the rest after in their order
      const list = t.group(key);
      const picked = ids.map((id) => {
        const r = list.find((x) => x.id === id);
        if (!r) throw new Bad(`${JSON.stringify(id)} isn't a top-level project or standalone task in ${a.title}. Its items are: ${list.map((x) => `${x.title} (${x.id})`).join(", ") || "none"}.`);
        return r;
      });
      const order = [...picked, ...list.filter((x) => !ids.includes(x.id))];
      const changed = order.map((x, j) => ({ ...x, sort: j })).filter((x, j) => list[j].id !== x.id || list[j].sort !== j);
      if (changed.length) await db.save(changed);
      const after = t.with(changed);
      return { area: a.title, priority: after.group(key).map((x) => ({ priority: after.priority(x), id: x.id, title: x.title, kind: after.isProject(x) ? "project" : "task" })) };
    }
    case "get_next_task": {
      if (has(args, "area") === has(args, "project_id")) throw new Bad("Give either area or project_id.");
      const a = has(args, "area") ? t.area(args.area) : null, p = a ? null : t.get(args.project_id);
      if (p && (p.series_id || p.repeat_rule)) throw new Bad("That's a repeating task; get_next_task is for an area or a project.");
      const next = t.nextUp(a ? t.areaItems(a) : [p!], today());
      const ofIt = (r: Row) => { const top = t.ancestors(r)[0]; const proj = t.ancestors(r).at(-1); return proj ? { id: proj.id, title: t.ancestors(r).map((x) => x.title).join(" › "), ...(top && t.priority(top) ? { priority: t.priority(top) } : {}) } : null; };
      if (!next.length) return { next: null, note: `Nothing open in ${a ? a.title : p!.title} that's ready now (not done, not waiting on something unfinished, not planned for a later day).` };
      return { [a ? "area" : "in"]: a ? a.title : p!.title, next: { ...t.describe(next[0]), project: ofIt(next[0]) }, after_that: next.slice(1, 3).map((r) => ({ ...t.describe(r), project: ofIt(r) })) };
    }
    case "list_blocks": case "add_block": case "update_block": case "remove_block": case "set_area_hours":
      return runBlocks(name, args, t, db, today());
    case "get_area_targets": case "set_area_targets": case "get_area_progress":
      return runTargets(name, args, t, db);
    case "list_labels": case "set_labels": t.tz = await db.timeZone(); return runLabels(name, args, db, t, today);
    case "delete_item": case "restore_item": case "list_deleted":
      t.tz = await db.timeZone(); return runTrash(name, args, t, db);
    case "update_item": {
      const r = { ...t.get(args.id) };
      const changed: Row[] = [];
      const occ = !!r.series_id, series = !!r.repeat_rule, before = { ...r };
      if (occ) {
        // One day's repeat: changing it stores it. How it repeats, and where it sits, belong to the series.
        if (has(args, "repeat")) {
          if (Object.keys(args).some((k) => k !== "id" && k !== "repeat" && has(args, k))) throw new Bad(`repeat changes the whole series; pass it on its own, or use the series_id (${r.series_id}).`);
          return runTool(name, { id: r.series_id, repeat: args.repeat }, db);
        }
        for (const k of ["project_id", "area", "start", "due", "milestone", "hard_deadline", "habit", "position"]) if (has(args, k)) throw new Bad(`${k} belongs to the whole series; pass its series_id (${r.series_id}) instead.`);
      }
      if (series) {
        if (has(args, "done") || has(args, "done_at") || has(args, "actual_minutes")) throw new Bad("Check off one day's repeat, not the whole series: list_tasks with from and to gives each repeat's id.");
        if (has(args, "day") && args.day === null) throw new Bad("A repeating task needs the day it starts. To stop it repeating, pass repeat: null.");
        if (args.milestone === true || args.hard_deadline === true) throw new Bad("A repeating task can't be a milestone.");
      }
      if (has(args, "title")) { r.title = textArg(args.title, "title", 500).trim(); if (!r.title) throw new Bad("title can't be empty."); }
      if (has(args, "day")) {
        const d = args.day === null ? null : dayArg(args.day, "day");
        if (d !== r.day && series) r.day = d; // the day the series starts; its time stays
        else if (d !== r.day) { r.day = d; r.start_min = null; r.after_min = null; r.day_sort = now(); }
      }
      if (has(args, "start_time")) {
        if (args.start_time === null) r.start_min = null;
        else { if (!r.day) throw new Bad("start_time needs a day; pass day too."); r.start_min = timeArg(args.start_time); }
      }
      if (!r.day) r.start_min = null;
      if (has(args, "duration_minutes")) r.duration_min = durArg(args.duration_minutes);
      if (has(args, "notes")) r.notes = args.notes === null ? null : textArg(args.notes, "notes", 20000) || null;
      if (has(args, "link")) r.link = args.link === null || args.link === "" ? null : linkArg(args.link);
      if (has(args, "due")) r.due = args.due === null ? null : dayArg(args.due, "due");
      roadmapArgs(t, args, r);
      if (has(args, "project_id")) {
        if (args.project_id === null) r.parent_id = null;
        else {
          const p = t.get(args.project_id);
          if (p.id === r.id || t.ancestors(p).some((a) => a.id === r.id)) throw new Bad("Can't move an item under itself or one of its own steps.");
          r.parent_id = p.id;
        }
        r.sort = now();
      }
      if (has(args, "area")) {
        if (r.parent_id != null) throw new Bad("Only top-level projects and tasks sit in an area; this item is inside another project.");
        if (args.area === null && r.color === "area") r.color = t.areaOf(r)?.color ?? null; // keep the colour it had
        r.area_id = args.area === null ? null : t.area(args.area).id;
        if (r.area_id !== before.area_id && !has(args, "position")) r.sort = now(); // last in its new area
      }
      if (has(args, "habit")) r.habit = boolArg(args.habit, "habit");
      // Its place in its list (after any move): the list is numbered again in the new order, as the app does
      const placed: Row[] = [];
      if (has(args, "position")) {
        const list = t.group(t.groupOf(r)).filter((x) => x.id !== r.id);
        const pos = typeof args.position === "string" ? args.position.trim() : "";
        let i: number;
        if (pos.toLowerCase() === "first") i = 0;
        else if (pos.toLowerCase() === "last") i = list.length;
        else {
          const id = pos.replace(/^after\s*:\s*/i, "");
          if (!pos || id === r.id) throw new Bad("position must be \"first\", \"last\" or \"after:<item id>\".");
          i = list.findIndex((x) => x.id === id) + 1;
          if (!i) throw new Bad(`${JSON.stringify(id)} isn't in the same list as this item (${t.groupOf(r).startsWith("p:") ? "the steps of " + (t.byId.get(t.groupOf(r).slice(2))?.title ?? "its project") : t.groupOf(r) === "loose" ? "the inbox" : "its area"}). Use an item from that list, "first" or "last".`);
        }
        list.splice(i, 0, r);
        list.forEach((x, j) => { if (x === r) r.sort = j; else if (x.sort !== j) placed.push({ ...x, sort: j }); });
      }
      // done_at isn't sent unless set on purpose, so the database stamps check-offs itself
      const k = t.children(r.id);
      delete r.done_at;
      if (has(args, "actual_minutes")) {
        if (k.length) throw new Bad("actual_minutes is for a task; set it on the steps.");
        r.actual_minutes = args.actual_minutes === null || args.actual_minutes === "" ? null : minutesArg(args.actual_minutes);
      }
      const at = has(args, "done_at") ? doneAtArg(args.done_at, t.tz) : undefined;
      if (has(args, "done")) {
        const done = boolArg(args.done, "done");
        if (at && !done) throw new Bad("done_at is for a finished item; it can't go with done: false.");
        if (k.length) {
          for (const l of t.leaves(r)) if (l.done !== done || at) { const c: Row = { ...l, done }; delete c.done_at; if (at) c.done_at = at; changed.push(c); }
        } else r.done = done;
      } else if (at && (k.length ? !t.isDone(r) : !r.done)) throw new Bad("This isn't checked off yet; pass done: true with done_at.");
      else if (at && k.length) for (const l of t.leaves(r)) { const c: Row = { ...l }; c.done_at = at; changed.push(c); }
      if (at && !k.length) r.done_at = at;
      if (has(args, "repeat")) {
        if (args.repeat === null) {
          if (series) { // a plain task again, on its next repeat's day; its stored repeats that aren't done go
            const next = t.occBetween(today() > r.day! ? today() : r.day!, addDays(today() > r.day! ? today() : r.day!, 400)).find((o) => o.series_id === r.id && !o.done);
            r.repeat_rule = null; r.day = next?.day ?? r.day; r.done = false;
            if (next) for (const k of SHARED) (r as Record<string, unknown>)[k] = next[k] ?? null;
            for (const o of t.occLive.values()) if (o.series_id === r.id && !o.done) changed.push({ ...o, deleted: true, occurs_on: null });
          }
        } else {
          if (k.length) throw new Bad("A project can't repeat; make one of its tasks repeat instead.");
          if (!series && (r.milestone || r.hard_deadline)) throw new Bad("A milestone can't repeat.");
          if (!r.day) r.day = today();
          r.repeat_rule = repeatArg(args.repeat, r.day);
          r.done = false;
        }
      }
      if (r.repeat_rule && r.repeat_rule.until && r.day && r.repeat_rule.until < r.day) throw new Bad(`The series would end (${r.repeat_rule.until}) before it starts (${r.day}).`);
      if (series && r.repeat_rule) {
        // A change to the series goes to its stored repeats that were still the same as the series (not done ones),
        // and those no longer on its days (a new rule, start or end) go
        for (const o0 of t.occLive.values()) {
          if (o0.series_id !== r.id || o0.done) continue;
          const o = { ...o0 }; let ch = false;
          for (const key of FOLLOW) if ((r[key] ?? null) !== (before[key] ?? null) && (o[key] ?? null) === (before[key] ?? null)) { (o as Record<string, unknown>)[key] = r[key]; ch = true; }
          if (!repeatsOn(r.repeat_rule, r.day, o.occurs_on!)) { o.deleted = true; o.occurs_on = null; ch = true; }
          if (ch) changed.push(o);
        }
      }
      if (occ && !r.day) { r.deleted = true; r.start_min = null; r.day = before.day; } // a repeat taken off the plan is skipped
      changed.unshift(r);
      const extra = changed.length - 1;
      changed.push(...placed.filter((p) => !changed.some((c) => c.id === p.id)));
      await db.save(changed);
      if (r.deleted) return { skipped: { id: r.id, title: r.title, day: r.occurs_on, series_id: r.series_id } };
      for (const c of changed) if (c.done_at === undefined) { const o = t.byId.get(c.id) ?? t.occLive.get(c.id); c.done_at = !c.done ? null : o?.done ? o.done_at ?? null : new Date().toISOString(); } // what the database stamped
      const after = t.with(changed);
      return { updated: after.describe(after.get(r.id)), ...(extra ? { [series ? "stored_repeats_changed" : "steps_changed"]: extra } : {}), ...(placed.length ? { list: after.group(after.groupOf(r)).map((x) => ({ position: after.position(x), id: x.id, title: x.title })) } : {}) };
    }
  }
  throw new Bad(`Unknown tool ${name}.`);
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** Answers one JSON-RPC message. Returns null for notifications. */
/* Area time: blocks of time for a whole area or project (rows of kind 'block'; focus_on names the area or project) */
async function runBlocks(name: string, args: Record<string, unknown>, t: Tree, db: Db, todayStr: string): Promise<unknown> {
  const bt = t.blockTree();
  const forOf = (r: Row) => { const a = t.areas.find((x) => x.id === r.focus_on); if (a) return { area: a.title }; const p = r.focus_on ? t.byId.get(r.focus_on) : undefined; return p ? { project: p.title, project_id: p.id } : { removed: true }; };
  const out = (r: Row, day: string) => {
    const o: Record<string, unknown> = { id: r.id, ...forOf(r), day, ...(r.start_min != null ? { start_time: hhmm(r.start_min) } : { start_time: null }), duration_minutes: r.duration_min };
    const s = r.series_id ? bt.byId.get(r.series_id) : r.repeat_rule ? r : undefined;
    if (s?.repeat_rule && s.day) { o.repeats = ruleText(s.repeat_rule, s.day); o.series_id = s.id; }
    if (r.done) o.skipped_or_answered = true;
    const mins = (r.time_log ?? []).reduce((a, e) => a + Math.max(0, Math.round(((e.end ? Date.parse(e.end) : Date.now()) - Date.parse(e.start)) / 60000)), 0);
    if (mins) o.recorded_on_block_minutes = mins;
    return o;
  };
  const len = (v: unknown) => { if (typeof v !== "number" || !Number.isInteger(v) || v < 15 || v > 720) throw new Bad("duration_minutes must be a whole number from 15 to 720."); return v; };
  const save = (rows: Row[]) => db.save(rows.map((r) => ({ ...r, kind: "block" })));
  switch (name) {
    case "list_blocks": {
      const from = has(args, "from") ? dayArg(args.from, "from") : todayStr, to = has(args, "to") ? dayArg(args.to, "to") : addDays(from, 13);
      if (to < from || to > addDays(from, 92)) throw new Bad("to must be on or after from, and at most 92 days later.");
      const rows = [...bt.byId.values()].filter((r) => !r.repeat_rule && r.day && r.day >= from && r.day <= to).concat(bt.occBetween(from, to));
      rows.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "") || (a.start_min ?? 0) - (b.start_min ?? 0));
      const areas = t.areas.map((a) => ({ area: a.title, ...(a.week_minutes ? { hours_a_week: Math.round(a.week_minutes / 6) / 10 } : {}) }));
      return { blocks: rows.map((r) => out(r, r.day!)), areas, ...(rows.length ? {} : { note: "No area time planned in those days." }) };
    }
    case "add_block": {
      let focus: string;
      if (has(args, "area") && has(args, "project_id")) throw new Bad("Give either area or project_id, not both.");
      if (has(args, "area")) focus = t.area(args.area).id;
      else if (has(args, "project_id")) { const p = t.get(args.project_id); if (!t.isProject(p)) throw new Bad(`${p.title} is a task, not a project. Block time for its project or area instead.`); focus = p.id; }
      else throw new Bad("Say what the time is for: area (by name) or project_id.");
      const day = dayArg(args.day, "day"), start = timeArg(args.start_time), dur = has(args, "duration_minutes") ? len(args.duration_minutes) : 90;
      const title = t.areas.find((a) => a.id === focus)?.title ?? t.byId.get(focus)!.title;
      const r = newRow({ kind: "block", focus_on: focus, title, day, start_min: start, duration_min: dur, day_sort: now(), ...(has(args, "repeat") ? { repeat_rule: repeatArg(args.repeat, day) } : {}) });
      await save([r]);
      return { added: out(r, day) };
    }
    case "update_block": {
      const id = String(args.id ?? "");
      const r = { ...(bt.byId.get(id) ?? bt.occLive.get(id) ?? bt.ghost(id) ?? (() => { throw new Bad(`No block with id ${JSON.stringify(args.id)}. Use list_blocks to find ids.`); })()) };
      if (has(args, "day")) { if (r.repeat_rule) throw new Bad("That's the repeating series: move one day's repeat by its id (with ~date), or remove the series and add it again on new days."); r.day = dayArg(args.day, "day"); }
      if (has(args, "start_time")) r.start_min = timeArg(args.start_time);
      if (has(args, "duration_minutes")) r.duration_min = len(args.duration_minutes);
      const rows = [r];
      if (r.repeat_rule) { const old = bt.byId.get(r.id)!; for (const o of bt.occ.get(r.id)?.values() ?? []) if (!o.deleted && !o.done && o.day && o.day >= todayStr && o.start_min === old.start_min && o.duration_min === old.duration_min) rows.push({ ...o, start_min: r.start_min, duration_min: r.duration_min }); }
      await save(rows);
      return { changed: out(r, r.day ?? todayStr) };
    }
    case "remove_block": {
      const id = String(args.id ?? "");
      const r = bt.byId.get(id) ?? bt.occLive.get(id) ?? bt.ghost(id);
      if (!r) throw new Bad(`No block with id ${JSON.stringify(args.id)}. Use list_blocks to find ids.`);
      const rows = [{ ...r, deleted: true }];
      if (r.repeat_rule) for (const o of bt.occ.get(r.id)?.values() ?? []) if (!o.deleted) rows.push({ ...o, deleted: true, occurs_on: null });
      await save(rows);
      return { removed: { id: r.id, ...forOf(r), ...(r.series_id ? { day: r.occurs_on, note: "Just this day; the rest of the series stays." } : r.repeat_rule ? { note: "Every repeat." } : { day: r.day }) } };
    }
    case "set_area_hours": {
      const a = { ...t.area(args.area) };
      const h = typeof args.hours === "string" ? Number(args.hours) : args.hours;
      if (typeof h !== "number" || !isFinite(h) || h < 0 || h > 80) throw new Bad("hours must be a number from 0 to 80.");
      a.week_minutes = h ? Math.round(h * 2) * 30 : null;
      await db.save([a]);
      return { area: a.title, hours_a_week: a.week_minutes ? a.week_minutes / 60 : null };
    }
  }
  throw new Bad(`Unknown tool ${name}`);
}

/* The Trash: deleting keeps the row (deleted, and the database stamps deleted_at), so it can be restored for 30 days. */
const NEAR = 5000; // things deleted together (a project and its steps) are stamped within moments of each other
const ago = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) : Infinity);
/** The rows a row hangs from: its project, its series, and for a block the project it's time for. */
const hostsOf = (r: Row) => [r.parent_id, r.series_id, r.kind === "block" ? r.focus_on : null].filter((x): x is string => !!x);
const closeOpen = (r: Row): Row => (r.time_log?.some((e) => !e.end) ? { ...r, time_log: r.time_log.map((e) => (e.end ? e : { ...e, end: new Date().toISOString() })) } : r);
async function runTrash(name: string, args: Record<string, unknown>, t: Tree, db: Db): Promise<unknown> {
  const strip = (r: Row) => { const c = { ...r }; delete c.deleted_at; delete c.done_at; return c; };
  if (name === "delete_item") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (t.areas.some((a) => a.id === id)) throw new Bad("That's an area. Areas are deleted in the app (their projects stay, with no area).");
    if (t.labelRows.some((l) => l.id === id)) throw new Bad("That's a label. set_labels takes it off items; labels themselves are deleted in the app.");
    if (t.blockRows.some((b) => b.id === id) || /~\d{4}-\d{2}-\d{2}$/.test(id) && t.blockRows.some((b) => b.id === id.replace(/~.*$/, ""))) throw new Bad("That's a time block; use remove_block.");
    const r = t.get(id);
    if (r.series_id) { // one repeat: skipped, the rest of the series stays
      await db.save([strip(closeOpen({ ...r, deleted: true }))]);
      return { deleted: { id: r.id, title: r.title, what: "one repeat", day: r.occurs_on, series_id: r.series_id }, note: "Just this day; the rest of the series stays. restore_item with this id brings it back." };
    }
    const kill = t.flat([r]), ids = new Set(kill.map((x) => x.id));
    const rows: Row[] = [...kill];
    for (const o of t.occLive.values()) if (o.series_id && ids.has(o.series_id)) rows.push(o); // stored repeats keep their days, so restoring brings them back as they were
    const blocks = t.blockRows.filter((b) => !b.deleted && b.focus_on && ids.has(b.focus_on));
    rows.push(...blocks);
    await db.save(rows.map((x) => strip(closeOpen({ ...x, deleted: true }))));
    const what = t.isProject(r) ? "project" : r.repeat_rule ? "repeating task (every repeat)" : "task";
    return { deleted: { id: r.id, title: r.title, what, ...(kill.length > 1 ? { steps_deleted: kill.length - 1 } : {}), ...(blocks.length ? { time_blocks_removed: blocks.filter((b) => !b.series_id).length } : {}) }, note: "It's in the app's Trash for 30 days; restore_item with this id brings it back." };
  }
  const days = has(args, "days") ? Number(args.days) : 30;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Bad("days must be a whole number from 1 to 30.");
  const gone = await db.loadDeleted(new Date(Date.now() - (name === "list_deleted" ? days : 30) * 864e5).toISOString());
  const byId = new Map(gone.map((r) => [r.id, r]));
  const live = new Map(t.raw.filter((r) => !r.deleted).map((r) => [r.id, r]));
  const any = (id: string) => byId.get(id) ?? live.get(id);
  /** What went with it: rows hanging from it (all the way down) deleted at the same moment. */
  const withIt = (r: Row) => {
    const out: Row[] = [], seen = new Set([r.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const c of gone) if (!seen.has(c.id) && hostsOf(c).some((h) => seen.has(h)) && ago(c.deleted_at, r.deleted_at) <= NEAR) { seen.add(c.id); out.push(c); grew = true; }
    }
    return out;
  };
  /** Deleted on its own, not as part of something else deleted at the same moment. */
  const own = (r: Row) => !hostsOf(r).some((h) => { const p = byId.get(h); return p && ago(p.deleted_at, r.deleted_at) <= NEAR; });
  const pathOf = (r: Row) => { const a: string[] = []; let h = r.series_id ? any(r.series_id) : r; for (let i = 0; h?.parent_id && i < 50; i++) { h = any(h.parent_id); if (h) a.unshift(h.title); } return { path: a.join(" › "), top: h }; };
  const out = (r: Row) => {
    const kids = withIt(r).filter((c) => c.kind !== "block" && !c.series_id);
    const { path, top } = pathOf(r), area = top && !top.parent_id && top.area_id ? t.areas.find((a) => a.id === top.area_id)?.title : undefined;
    const what = r.series_id ? "one repeat" : kids.length || (!r.parent_id && r.color) ? "project" : r.repeat_rule ? "repeating task" : "task";
    return { id: r.id, title: r.title || (r.series_id ? any(r.series_id)?.title : "") || "Untitled", what, deleted_at: localStamp(r.deleted_at!, t.tz), ...(path ? { project: path } : {}), ...(area ? { area } : {}), ...(kids.length ? { steps: kids.length } : {}), ...(r.series_id ? { day: r.occurs_on, series_id: r.series_id } : r.day && !r.repeat_rule ? { day: r.day } : {}), ...(r.done ? { done: true } : {}) };
  };
  const shown = (r: Row) => r.kind !== "area" && r.kind !== "label" && r.kind !== "block";
  if (name === "list_deleted") {
    const L = gone.filter((r) => shown(r) && own(r));
    return { deleted: L.slice(0, 100).map(out), ...(L.length ? {} : { note: `Nothing deleted in the last ${days} days.` }), ...(L.length > 100 ? { more: L.length - 100 } : {}) };
  }
  // restore_item
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const r = byId.get(id);
  if (!r) throw new Bad(live.has(id) || t.byId.has(id) ? "That item isn't deleted." : `Nothing deleted in the last 30 days has the id ${JSON.stringify(args.id)}. list_deleted shows what's there.`);
  if (!shown(r)) throw new Bad("Areas, labels and time blocks can't be restored here.");
  const back = [r, ...withIt(r)];
  // Whatever it hangs from that's deleted too comes back as well (just that row), so it has somewhere to show
  const up: Row[] = [];
  for (let h = hostsOf(r).map((x) => byId.get(x)).find(Boolean), i = 0; h && i < 50; h = hostsOf(h).map((x) => byId.get(x)).find(Boolean), i++) if (!back.includes(h) && !up.includes(h)) up.push(h);
  await db.save([...back, ...up].map((x) => ({ ...strip(x), deleted: false, deleted_at: null })));
  const after = t.with([...back, ...up].map((x) => ({ ...strip(x), deleted: false })));
  let item: unknown; try { item = after.describe(after.get(r.id)); } catch { item = { id: r.id, title: r.title }; }
  const steps = back.filter((c) => c !== r && c.kind !== "block" && !c.series_id).length;
  return { restored: item, ...(steps ? { steps_restored: steps } : {}), ...(up.length ? { also_restored: up.map((x) => ({ id: x.id, title: x.title })), note: "It sat inside something that was deleted too, so that came back as well." } : {}) };
}

/* Daily area targets */
const WDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const hoursOf = (m: number) => Math.round(m / 6) / 10;
function daysArg(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Bad("days must be an object of hours by weekday, such as {\"mon\": 3, \"sat\": 2}.");
  const out: Record<string, number> = {}, put = (keys: string[], h: unknown) => {
    const n = typeof h === "string" ? Number(h) : h;
    if (typeof n !== "number" || !isFinite(n) || n < 0 || n > 16) throw new Bad("Each day's hours must be a number from 0 to 16.");
    for (const k of keys) out[k] = Math.round(n * 2) * 30;
  };
  const e = v as Record<string, unknown>;
  const group: Record<string, string[]> = { every_day: WORDER, weekdays: WORDER.slice(0, 5), weekend: ["sat", "sun"] };
  for (const g of ["every_day", "weekdays", "weekend"]) if (g in e) put(group[g], e[g]);
  for (const [k, h] of Object.entries(e)) {
    if (k in group) continue;
    const key = k.trim().toLowerCase().slice(0, 3);
    if (!WDAYS.includes(key)) throw new Bad(`Unknown day ${JSON.stringify(k)}. Use mon, tue, wed, thu, fri, sat, sun, weekdays, weekend or every_day.`);
    put([key], h);
  }
  return out;
}
const weekdayOf = (d: string) => WDAYS[new Date(d + "T12:00:00Z").getUTCDay()];
/** Date overrides from today on, oldest first. */
const overridesOf = (o: Record<string, number> | null | undefined, from: string) =>
  Object.entries(o ?? {}).filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k >= from).sort(([x], [y]) => (x < y ? -1 : 1)).map(([date, m]) => ({ date, hours: hoursOf(Math.max(0, m)) }));
const byDay = (dg: Record<string, number> | null | undefined) => Object.fromEntries(WORDER.map((k) => [k, hoursOf(Math.max(0, dg?.[k] ?? 0))]));

async function runTargets(name: string, args: Record<string, unknown>, t: Tree, db: Db): Promise<unknown> {
  const todayStr = zoned(Date.now(), t.tz).date;
  // One date's override: set it, or remove it with hours null. Overrides older than 120 days are dropped.
  const setDate = (o: Record<string, number> | null | undefined) => {
    const d = dayArg(args.date, "date"), x: Record<string, number> = { ...(o ?? {}) };
    if (args.hours === null) delete x[d];
    else {
      const n = typeof args.hours === "string" ? Number(args.hours) : args.hours;
      if (typeof n !== "number" || !isFinite(n) || n < 0 || n > 16) throw new Bad("With date, pass hours: a number from 0 to 16, or null to remove the override.");
      x[d] = Math.round(n * 2) * 30;
    }
    const cut = addDays(todayStr, -120);
    for (const k of Object.keys(x)) if (/^\d{4}-/.test(k) && k < cut) delete x[k];
    return { x, d };
  };
  if (name === "get_area_targets") {
    return {
      areas: t.areas.map((a) => {
        const d = byDay(a.day_targets), week = Object.values(d).reduce((x, y) => x + y, 0);
        const ov = overridesOf(a.day_targets, todayStr);
        return { area: a.title, area_id: a.id, hours_by_day: d, hours_a_week: week, ...(a.time_pref ? { time_pref: a.time_pref } : {}), ...(ov.length ? { overrides: ov } : {}) };
      }),
    };
  }
  if (name === "set_area_targets") {
    if (args.date !== undefined) {
      const a = { ...t.area(args.area) }, { x, d } = setDate(a.day_targets);
      a.day_targets = x;
      await db.save([a]);
      return { area: a.title, date: d, hours: d in x ? hoursOf(x[d]) : null, usual_hours: hoursOf(x[weekdayOf(d)] ?? 0), note: d in x ? "For this date only." : "Override removed; the weekday's usual hours apply." };
    }
    const a = { ...t.area(args.area) };
    if (args.days !== undefined) a.day_targets = { ...(a.day_targets ?? {}), ...daysArg(args.days) };
    if (args.time_pref !== undefined) {
      if (args.time_pref !== null && !["morning", "afternoon", "evening"].includes(String(args.time_pref))) throw new Bad("time_pref must be morning, afternoon, evening or null.");
      a.time_pref = (args.time_pref as string | null) ?? null;
    }
    if (args.days === undefined && args.time_pref === undefined) throw new Bad("Pass days, time_pref or both.");
    await db.save([a]);
    const d = byDay(a.day_targets);
    return { area: a.title, hours_by_day: d, hours_a_week: Object.values(d).reduce((x, y) => x + y, 0), ...(a.time_pref ? { time_pref: a.time_pref } : {}) };
  }
  // get_area_progress
  const from = dayArg(args.from, "from"), to = dayArg(args.to, "to");
  if (to < from) throw new Bad("to is before from.");
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { days.push(d); if (days.length > 62) throw new Bad("At most 62 days at a time."); }
  const all = new Map(t.raw.map((r) => [r.id, r]));
  const areaIdOf = (r: Row): string | null => {
    let h: Row | undefined = r.series_id ? all.get(r.series_id) ?? r : r;
    if (h.kind === "block") h = h.focus_on ? all.get(h.focus_on) : undefined;
    for (let i = 0; h && i < 50; i++) {
      if (h.kind === "area") return h.id;
      if (!h.parent_id) return h.area_id ?? null;
      h = all.get(h.parent_id);
    }
    return null;
  };
  const nameOf = (r: Row) => { const h = r.series_id ? all.get(r.series_id) ?? r : r; return h.kind === "area" ? "(the area itself)" : h.kind === "block" ? `${all.get(h.focus_on ?? "")?.title ?? "?"} block` : h.title; };
  const projOf = (r: Row) => { let h: Row | undefined = r.series_id ? all.get(r.series_id) ?? r : r; let top: Row | undefined; for (let i = 0; h && h.parent_id && i < 50; i++) { h = all.get(h.parent_id); if (h) top = h; } return top && top.kind !== "area" ? top.title : undefined; };
  // minutes by day, area, item
  const L = new Map<string, Map<string, Map<string, number>>>();
  const start = Date.parse(from + "T00:00:00Z") - 36 * 3600000, end = Date.parse(addDays(to, 1) + "T00:00:00Z") + 36 * 3600000;
  for (const r of t.raw) {
    if (!r.time_log?.length || r.deleted) continue; // deleted things, skipped repeats too, never count
    const aid = areaIdOf(r); if (!aid) continue;
    const key = r.series_id && all.get(r.series_id) ? r.series_id : r.id;
    for (const e of r.time_log) {
      let a = Date.parse(e.start); const b = e.end ? Date.parse(e.end) : Date.now();
      if (!(b > a) || b < start || a > end) continue;
      while (a < b) { // split at the person's local midnights
        const z = zoned(a, t.tz), next = Date.parse(addDays(z.date, 1) + "T00:00:00Z") - z.off * 60000, c = Math.min(b, next > a ? next : b);
        if (z.date >= from && z.date <= to) {
          const dm = L.get(z.date) ?? new Map(); L.set(z.date, dm);
          const am = dm.get(aid) ?? new Map(); dm.set(aid, am);
          am.set(key, (am.get(key) ?? 0) + (c - a) / 60000);
        }
        a = c;
      }
    }
  }
  return {
    time_zone: t.tz ?? "UTC",
    days: days.map((d) => {
      const wd = weekdayOf(d), dm = L.get(d) ?? new Map<string, Map<string, number>>();
      const areas = t.areas.map((a) => {
        const ov = !!a.day_targets && d in a.day_targets, target = Math.max(0, (ov ? a.day_targets![d] : a.day_targets?.[wd]) ?? 0), items = dm.get(a.id) ?? new Map<string, number>();
        const logged = [...items.values()].reduce((x, y) => x + y, 0);
        if (!target && logged < 1) return null;
        const tasks = [...items.entries()].filter(([, m]) => m >= 1).sort((x, y) => y[1] - x[1]).map(([id, m]) => { const r = all.get(id)!; const p = projOf(r); return { id, title: nameOf(r), ...(p ? { project: p } : {}), hours: hoursOf(m) }; });
        return { area: a.title, target_hours: hoursOf(target), ...(ov ? { target_overridden: true } : {}), logged_hours: hoursOf(logged), ...(a.time_pref ? { time_pref: a.time_pref } : {}), ...(a.days_done?.includes(d) ? { done_for_day: true } : {}), tasks };
      }).filter(Boolean);
      return { date: d, weekday: wd, areas };
    }),
  };
}

/* Labels cut across areas: list_labels adds up their time, set_labels puts them on an item */
const LABEL_COLORS = ["#C9A6FF", "#E58FB0", "#8FD0E5", "#E5C48F", "#A6E59B", "#F0A07A", "#9BA8FF", "#D9D9D9"];
async function runLabels(name: string, args: Record<string, unknown>, db: Db, t: Tree, today: () => string) {
  if (name === "set_labels") {
    const r0 = t.get(args.id), r = r0.series_id ? t.byId.get(r0.series_id) ?? r0 : r0;
    if (!Array.isArray(args.labels)) throw new Bad("labels must be a list of names, such as [\"Building\"].");
    const names = [...new Set(args.labels.map((x) => String(x ?? "").trim().slice(0, 40)).filter(Boolean))];
    const made: Row[] = [], ids: string[] = [];
    for (const n of names) {
      let l = [...t.labelRows, ...made].find((x) => x.title.trim().toLowerCase() === n.toLowerCase());
      if (!l) {
        const used = new Set([...t.labelRows, ...made].map((x) => x.color));
        l = newRow({ kind: "label", title: n, color: LABEL_COLORS.find((c) => !used.has(c)) ?? LABEL_COLORS[(t.labelRows.length + made.length) % LABEL_COLORS.length], duration_min: 60 });
        made.push(l);
      }
      if (!ids.includes(l.id)) ids.push(l.id);
    }
    const item = { ...r, labels: ids.length ? ids : null };
    // Stored repeats that still had the series' labels follow it
    const occ = [...(t.occ.get(r.id)?.values() ?? [])].filter((o) => !o.deleted && !o.done && JSON.stringify(o.labels ?? null) === JSON.stringify(r.labels ?? null)).map((o) => ({ ...o, labels: item.labels }));
    await db.save([...made, item, ...occ]);
    const t2 = t.with([...made, item, ...occ]);
    return { item: { id: item.id, title: item.title }, labels: t2.labelsOf(item).map((l) => l.title), ...(made.length ? { new_labels: made.map((l) => l.title) } : {}) };
  }
  // list_labels
  let from = has(args, "from") ? dayArg(args.from, "from") : null; const to = has(args, "to") ? dayArg(args.to, "to") : today();
  if (!from) { from = to; for (let i = 0; i < 6 && weekdayOf(from) !== "mon"; i++) from = addDays(from, -1); }
  if (to < from) throw new Bad("to is before from.");
  const all = new Map(t.raw.map((r) => [r.id, r]));
  const areaName = (r: Row) => { let h: Row | undefined = r; for (let i = 0; h && i < 50; i++) { if (h.kind === "area") return h.title; if (!h.parent_id) return h.area_id ? all.get(h.area_id)?.title ?? "No area" : "No area"; h = all.get(h.parent_id); } return "No area"; };
  const topOf = (r: Row) => { let h = r; for (let i = 0; h.parent_id && i < 50; i++) { const p = all.get(h.parent_id); if (!p || p.kind === "area") break; h = p; } return h.title; };
  const start = Date.parse(from + "T00:00:00Z") - 36 * 3600000, end = Date.parse(addDays(to, 1) + "T00:00:00Z") + 36 * 3600000;
  const M = new Map<string, { m: number; areas: Map<string, number>; projects: Map<string, number> }>();
  let total = 0;
  for (const r of t.raw) {
    if (!r.time_log?.length || r.deleted) continue; // deleted things, skipped repeats too, never count
    let h: Row | undefined = r.series_id ? all.get(r.series_id) ?? r : r;
    if (h.kind === "block") h = h.focus_on ? all.get(h.focus_on) : undefined;
    if (!h || h.kind === "label") continue;
    const labs = h.kind === "area" ? [] : t.labelsOf(h);
    let m = 0;
    for (const e of r.time_log) {
      let a = Date.parse(e.start); const b = e.end ? Date.parse(e.end) : Date.now();
      if (!(b > a) || b < start || a > end) continue;
      while (a < b) {
        const z = zoned(a, t.tz), next = Date.parse(addDays(z.date, 1) + "T00:00:00Z") - z.off * 60000, c = Math.min(b, next > a ? next : b);
        if (z.date >= from && z.date <= to) m += (c - a) / 60000;
        a = c;
      }
    }
    if (m <= 0) continue;
    total += m;
    for (const l of labs) {
      const x = M.get(l.id) ?? { m: 0, areas: new Map(), projects: new Map() }; M.set(l.id, x);
      x.m += m; const an = areaName(h), pn = h.kind === "area" ? "(the area itself)" : topOf(h);
      x.areas.set(an, (x.areas.get(an) ?? 0) + m); x.projects.set(pn, (x.projects.get(pn) ?? 0) + m);
    }
  }
  const split = (mp: Map<string, number>) => [...mp].filter(([, m]) => m >= 1).sort((a, b) => b[1] - a[1]).map(([name, m]) => ({ name, hours: hoursOf(m) }));
  return {
    from, to, time_zone: t.tz ?? "UTC", all_hours: hoursOf(total),
    labels: t.labelRows.map((l) => {
      const x = M.get(l.id);
      const wearing = [...t.byId.values()].filter((r) => (r.labels ?? []).includes(l.id)).map((r) => ({ id: r.id, title: r.title }));
      return { label: l.title, hours: hoursOf(x?.m ?? 0), share_of_all: total ? Math.round((x?.m ?? 0) / total * 100) + "%" : "0%", by_area: x ? split(x.areas) : [], by_project: x ? split(x.projects) : [], worn_by: wearing };
    }),
  };
}

export async function handle(msg: Rpc, db: Db): Promise<unknown | null> {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
    return msg && "id" in msg ? { jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32600, message: "Invalid request" } } : null;
  }
  if (msg.id === undefined) return null; // a notification, such as notifications/initialized
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const p = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const want = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return ok({
        protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "daybook", title: "Daybook", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(p.name ?? "");
      const args = (p.arguments && typeof p.arguments === "object" ? p.arguments : {}) as Record<string, unknown>;
      try {
        const out = await runTool(name, args, db);
        return ok({ content: [{ type: "text", text: JSON.stringify(out) }] });
      } catch (e) {
        if (e instanceof Bad) return ok({ content: [{ type: "text", text: e.message }], isError: true });
        console.error(e);
        return ok({ content: [{ type: "text", text: "Daybook couldn't do that just now. Try again in a moment." }], isError: true });
      }
    }
  }
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } };
}
