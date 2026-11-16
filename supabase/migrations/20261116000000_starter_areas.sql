-- The four starter areas (Writing, Filmmaking, Business, Personal) were only
-- ever made on each device with fixed ids and kept local, so the server never
-- had them: the connector showed their projects as "No area" and could not
-- make a world in "Business". Make them real rows for every account whose
-- projects already point at them. A device's local copy (updated 0) gives way
-- to these. Ids are fixed, so this does nothing a second time.
insert into public.writing_entries (id, user_id, kind, title, sort, fields)
select s.id, u.user_id, 'area', s.title, s.sort, jsonb_build_object('color', s.color)
from (values
  ('area-writing', 'Writing', 1, '#9A4A2E'),
  ('area-filmmaking', 'Filmmaking', 2, '#1F6F64'),
  ('area-business', 'Business', 3, '#5B6E8C'),
  ('area-personal', 'Personal', 4, '#8C5B7A')
) as s(id, title, sort, color)
cross join lateral (
  select we.user_id from public.writing_entries we
  where we.area_id = s.id or we.parent_id = s.id
  group by we.user_id order by count(*) desc limit 1
) u
on conflict (id) do nothing;
