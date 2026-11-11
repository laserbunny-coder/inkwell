-- Where a task sits among the day's calendar events in the List view,
-- without an exact time: the start minute of the event it comes after.
-- Empty means before the first event.
alter table public.items add column if not exists after_min integer check (after_min between 0 and 1439);
