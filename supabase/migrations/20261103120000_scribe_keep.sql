-- Scribe keeps its recordings in Inkwell: a mode with keep on files each
-- recording, with what was heard and what was typed, on that day's Inkwell
-- page. On for the writing modes (Idea, Journal, Scene), off for messages.
alter table public.scribe_modes add column if not exists keep boolean not null default false;
update public.scribe_modes set keep = true where id in ('idea', 'journal', 'scene');
