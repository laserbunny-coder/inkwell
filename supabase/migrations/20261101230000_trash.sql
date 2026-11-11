-- Trash. Deleting (in the app or by Claude through the connector) has always
-- kept the row and set deleted; now the database also stamps deleted_at, so
-- what was deleted can be listed and restored for 30 days, then cleared out.
-- Restoring clears it. A repeat that a rule change took away (series_id set,
-- occurs_on null) isn't something anyone deleted, so it gets no stamp.
alter table public.items add column if not exists deleted_at timestamptz;

create or replace function public.items_stamp_deleted() returns trigger
language plpgsql as $$
begin
  if not new.deleted or (new.series_id is not null and new.occurs_on is null) then
    new.deleted_at := null;
  elsif new.deleted_at is null then
    new.deleted_at := now();
  end if;
  return new;
end $$;

drop trigger if exists items_stamp_deleted on public.items;
create trigger items_stamp_deleted before insert or update on public.items
  for each row execute function public.items_stamp_deleted();

-- What was deleted before today: its last change is when it was deleted, near enough
update public.items set deleted_at = updated_at
 where deleted and deleted_at is null and not (series_id is not null and occurs_on is null);

create index if not exists items_user_deleted on public.items (user_id, deleted_at) where deleted_at is not null;

-- Once a day, things in the Trash for more than 30 days go for good. Kept:
-- areas (a device with no areas at all would make the starting three again),
-- and a skipped repeat of a series that's still there (it's what keeps that
-- day skipped).
create or replace function public.items_empty_trash() returns void
language sql security definer set search_path = public as $$
  delete from public.items i
   where i.deleted and i.deleted_at < now() - interval '30 days'
     and i.kind is distinct from 'area'
     and not (i.series_id is not null and i.occurs_on is not null
              and exists (select 1 from public.items s where s.id = i.series_id and not s.deleted));
$$;
revoke all on function public.items_empty_trash() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule('daybook-empty-trash') where exists (select 1 from cron.job where jobname = 'daybook-empty-trash');
select cron.schedule('daybook-empty-trash', '41 3 * * *', $$select public.items_empty_trash()$$);
