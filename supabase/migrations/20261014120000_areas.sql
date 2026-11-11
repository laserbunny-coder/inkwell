-- Areas (Business, Filmmaking, Personal…) sit above projects. An area is a
-- row of kind 'area'; a top-level project names its area in area_id.
alter table public.items add column if not exists kind text check (kind in ('area'));
alter table public.items add column if not exists area_id text;

-- Everyone already using Daybook starts with three areas, and their existing
-- projects go under Personal. The ids match the ones the app would make, so a
-- phone that gets there first doesn't create a second set.
insert into public.items (id, user_id, kind, title, sort)
select 'area-' || a.slug || '-' || u.user_id, u.user_id, 'area', a.title, a.pos
from (select distinct user_id from public.items) u
cross join (values ('business', 'Business', 1), ('filmmaking', 'Filmmaking', 2), ('personal', 'Personal', 3)) as a(slug, title, pos)
on conflict (id) do nothing;

update public.items p
set area_id = 'area-personal-' || p.user_id
where p.parent_id is null and p.kind is null and p.area_id is null and not p.deleted
  and (p.color is not null or exists (select 1 from public.items c where c.parent_id = p.id and not c.deleted));
