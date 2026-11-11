-- Area time: a time block for a whole area or project ("Filmmaking, 9 to 12").
-- A block is an item of kind 'block'; focus_on names the area or project it's for.
-- It can repeat like a task, and it records time like one (time_log), but it's never checked off.
-- week_minutes on an area: roughly how much time a week the person wants to give it (optional).
alter table public.items drop constraint if exists items_kind_check;
alter table public.items add constraint items_kind_check check (kind in ('area', 'block'));
alter table public.items add column if not exists focus_on text;
alter table public.items add column if not exists week_minutes integer check (week_minutes is null or (week_minutes > 0 and week_minutes <= 10080));
