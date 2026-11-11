-- Two more phone alert switches, for Inkwell's letters in Daybook:
--   week   the Monday "Your week" note (last week's gist, things you said you'd do, the tidy pass)
--   month  the "Your month" note when a month's summary is written
-- Both on at first; each has its own switch in Phone alerts.
alter table public.alert_prefs add column if not exists week boolean not null default true;
alter table public.alert_prefs add column if not exists month boolean not null default true;
