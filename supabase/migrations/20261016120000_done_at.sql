-- How fast things really get done. done_at is when a task was checked off,
-- stamped by the database so every way of checking off (the app on any device,
-- Claude through the connector) records it the same way. Reopening clears it.
-- A write that sets done_at itself (Claude backdating "I finished that
-- yesterday") keeps that time. actual_minutes is how long a task really took,
-- filled in by hand or by Claude when it was far off the plan.
alter table public.items add column if not exists done_at timestamptz;
alter table public.items add column if not exists actual_minutes integer;
alter table public.items drop constraint if exists items_actual_minutes_check;
alter table public.items add constraint items_actual_minutes_check check (actual_minutes is null or actual_minutes between 1 and 10080);

create or replace function public.items_stamp_done() returns trigger
language plpgsql as $$
begin
  if not new.done then
    new.done_at := null;
  elsif tg_op = 'INSERT' then
    new.done_at := coalesce(new.done_at, now());
  elsif not old.done and new.done_at is not distinct from old.done_at then
    new.done_at := now();
  end if;
  return new;
end $$;

drop trigger if exists items_stamp_done on public.items;
create trigger items_stamp_done before insert or update on public.items
  for each row execute function public.items_stamp_done();
