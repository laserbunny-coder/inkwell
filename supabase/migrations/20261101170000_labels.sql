-- Labels cut across areas ("Building", "Client work"): rows of kind 'label' (name in title, colour in color),
-- and each item lists the labels it wears, as label ids: ["<label id>", ...]. Steps of a labelled project count too.
alter table public.items drop constraint if exists items_kind_check;
alter table public.items add constraint items_kind_check check (kind in ('area', 'block', 'label'));
alter table public.items add column if not exists labels jsonb;
