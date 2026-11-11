-- Time tracking. time_log holds the stretches of time someone really worked on a
-- task or project, oldest first, each a JSON object {"start": ISO, "end": ISO or
-- null while it's still recording}. "guess": true marks one the app filled in when
-- a task was checked off without recording: it ends at the check-off and lasts as
-- long as planned. planned remembers where a task was planned ({"day", "start_min",
-- "duration_min"}) before checking it off moved it to when it was really done.
alter table public.items add column if not exists time_log jsonb;
alter table public.items add column if not exists planned jsonb;
