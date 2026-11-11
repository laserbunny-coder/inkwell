-- Letting Claude tidy Inkwell (the writing app).
--
-- Two more kinds of entry live in writing_entries, both made by Claude and
-- kept out of sight in the app except on the tidy pass:
--   tidy    a batch of tidy suggestions (merge two worlds, file a line, fold
--           one tag into another…). id 'td-week-YYYY-MM-DD' for the weekly
--           one (the Monday), 'td_…' for others. The person ticks yes or no
--           in the app, which keeps the answers (and how to undo) on it.
--   change  one thing Claude changed through the connector (marked a line
--           done, moved a line to a page, made a world a life project), with
--           what it was before, so it can be undone from the app or by Claude.
--           id 'cx_…'.
-- Neither ever holds the person's writing.

-- The map's counts leave them out, like abouts and summaries.
create or replace function public.inkwell_rollup(p_user uuid)
returns table (home text, n integer, last timestamptz, top_tags text[])
language sql stable security definer set search_path = public
as $$
  with recursive live as (
    select e.id, e.parent_id, e.kind, e.tags, e.updated_at from writing_entries e
     where e.user_id = p_user and inkwell_live(e.deleted, e.fields)
       and e.kind not in ('version', 'tally', 'about', 'digest', 'file', 'workflow', 'tidy', 'change')
  ),
  up as (
    select l.id as src, l.id as cur, l.parent_id, l.kind, 0 as depth from live l
    union all
    select up.src, p.id, p.parent_id, p.kind, up.depth + 1
      from up join live p on p.id = up.parent_id
     where up.kind not in ('world', 'day') and up.depth < 60
  ),
  homes as (
    select distinct on (src) src, cur as home from up
     where kind in ('world', 'day') or parent_id is null
     order by src, depth
  ),
  counted as (
    select h.home, count(*)::integer as n, max(l.updated_at) as last from homes h join live l on l.id = h.src group by h.home
  ),
  tagged as (
    select home, array_agg(t order by c desc) filter (where rn <= 6) as top_tags from (
      select h.home, t, count(*) as c, row_number() over (partition by h.home order by count(*) desc) as rn
        from homes h join live l on l.id = h.src, unnest(l.tags) t group by h.home, t
    ) x group by home
  )
  select c.home, c.n, c.last, coalesce(t.top_tags, '{}') from counted c left join tagged t using (home)
$$;

-- Worlds and pages with no words anywhere inside them (no line, paragraph or
-- note with any text), for the tidy pass to spot leftovers such as a blank
-- starter world. Their own titles don't count as words.
create or replace function public.inkwell_empty(p_user uuid)
returns table (id text)
language sql stable security definer set search_path = public
as $$
  with recursive live as (
    select e.id, e.parent_id, e.kind, e.text from writing_entries e
     where e.user_id = p_user and inkwell_live(e.deleted, e.fields)
       and e.kind not in ('version', 'tally', 'about', 'digest', 'file', 'workflow', 'tidy', 'change')
  ),
  -- union (not union all) drops ids already found, so this always ends.
  worded (id) as (
    select l.parent_id from live l
     where l.kind in ('line', 'para', 'heading', 'scene', 'note') and btrim(l.text) <> '' and l.parent_id is not null
    union
    select l.parent_id from worded w join live l on l.id = w.id
     where l.parent_id is not null
  )
  select l.id from live l
   where l.kind in ('world', 'page')
     and not exists (select 1 from worded w where w.id = l.id)
$$;

revoke all on function public.inkwell_rollup(uuid) from public, anon, authenticated;
revoke all on function public.inkwell_empty(uuid) from public, anon, authenticated;

-- The Monday note from Inkwell can offer things you said you'd do last week,
-- each one tap from a Daybook task: [{ id, title, link, day }]. The task is
-- made with that id, so a second tap (or another device) never makes two.
alter table public.notes add column if not exists offers jsonb not null default '[]';
