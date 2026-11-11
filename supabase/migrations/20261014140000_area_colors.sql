-- Each area has a colour, and a project whose colour is 'area' wears its
-- area's colour (its tasks follow). Starting areas get their colours, and
-- projects already filed in an area switch to following it; any project can
-- still be given its own colour in the app.
update public.items set color = case
    when id like 'area-business-%' then '#7FA8FF'
    when id like 'area-filmmaking-%' then '#FFC56B'
    when id like 'area-personal-%' then '#4FE3C1'
    else '#D58CFF' end
where kind = 'area' and color is null;

update public.items p set color = 'area'
where p.parent_id is null and p.kind is null and not p.deleted and p.area_id is not null
  and exists (select 1 from public.items a where a.id = p.area_id and a.kind = 'area' and not a.deleted);
