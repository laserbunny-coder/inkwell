-- Daily area targets: hours an area gets on each day of the week (minutes by weekday, such as {"mon":180,"wed":0}),
-- and a hint for when in the day it fits best.
alter table public.items add column if not exists day_targets jsonb;
alter table public.items add column if not exists time_pref text check (time_pref is null or time_pref in ('morning', 'afternoon', 'evening'));
