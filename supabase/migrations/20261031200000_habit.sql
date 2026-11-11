-- A habit: a task (usually repeating) that shows on its days but doesn't count toward the week's scheduled hours
-- on the Roadmap (or the connector's get_free_hours). Null reads as false.
alter table public.items add column if not exists habit boolean default false;
