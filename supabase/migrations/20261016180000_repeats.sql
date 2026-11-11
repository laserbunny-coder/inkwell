-- Repeating tasks. A series is one item with a repeat rule, such as
-- {"every":"week","days":[1,3]} (Sunday is 0); its day is the day it starts and
-- "until" in the rule is an optional last day. Its repeats aren't stored: the app and
-- the connector work them out. A repeat is only stored once it's changed, checked off
-- or skipped, with id "<series id>~<date>", series_id naming the series and occurs_on
-- the date it was due. A deleted one with occurs_on set is a skipped repeat.
alter table public.items add column if not exists repeat_rule jsonb;
alter table public.items add column if not exists series_id text;
alter table public.items add column if not exists occurs_on date;
create index if not exists items_series on public.items (user_id, series_id) where series_id is not null;
