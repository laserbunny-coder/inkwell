-- A task's place in its day's list, kept apart from its place among its
-- project's steps ("sort"), so reordering one doesn't scramble the other.
alter table public.items add column if not exists day_sort double precision;
update public.items set day_sort = sort where day is not null and day_sort is null;
