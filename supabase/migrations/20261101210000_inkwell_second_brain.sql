-- Inkwell as a second brain for Claude: what the connector (inkwell-mcp) needs
-- to find things quickly as the notes grow. Nothing here changes how the app
-- stores or syncs entries; it adds indexes and read-only search helpers that
-- only the server functions can call.
--
-- Two new kinds of entry live in writing_entries, both written by Claude and
-- kept out of sight in the app unless Michael opens them:
--   about   a one-line "what this is" for a world, piece, page or chapter.
--           id 'ab-' || the thing's id, parent_id = the thing.
--   digest  a weekly or monthly summary of what was written, made by the
--           inkwell-digest function. id 'dg-week-YYYY-MM-DD' (the Monday) or
--           'dg-month-YYYY-MM'.

-- The words a search looks through: the title and text, plus what's kept
-- beside them (a voice recording's word-for-word original, a shared link's
-- snapshot, a script section's summary). Title counts most.
create or replace function public.inkwell_search_doc(p_title text, p_text text, p_fields jsonb)
returns tsvector
language sql immutable parallel safe
as $$
  select setweight(to_tsvector('english'::regconfig, coalesce(p_title, '')), 'A')
      || setweight(to_tsvector('english'::regconfig, coalesce(p_text, '')), 'B')
      || setweight(to_tsvector('english'::regconfig,
           coalesce(p_fields -> 'snapshot' ->> 'title', '') || ' ' ||
           coalesce(p_fields -> 'snapshot' ->> 'summary', '') || ' ' ||
           coalesce(p_fields -> 'voice' ->> 'raw', '') || ' ' ||
           coalesce(p_fields ->> 'synopsis', '') || ' ' ||
           coalesce(p_fields ->> 'keywords', '')), 'C')
$$;

create index if not exists writing_entries_search
  on public.writing_entries using gin (public.inkwell_search_doc(title, text, fields));
create index if not exists writing_entries_tags on public.writing_entries using gin (tags);
create index if not exists writing_entries_links on public.writing_entries using gin (links jsonb_path_ops);
create index if not exists writing_entries_user_created on public.writing_entries (user_id, created_at);

-- Is this entry live (not deleted, not in the Trash, not a mirror of another)?
create or replace function public.inkwell_live(p_deleted boolean, p_fields jsonb)
returns boolean
language sql immutable parallel safe
as $$
  select not p_deleted
     and coalesce(p_fields -> 'trashed', 'null'::jsonb) in ('null'::jsonb, 'false'::jsonb)
     and coalesce(p_fields -> 'mirror', 'null'::jsonb) in ('null'::jsonb, 'false'::jsonb)
$$;

-- Search. Words are matched by meaning of the word ("drafts" finds "draft"),
-- ranked best first; when nothing matches that way, falls back to finding the
-- letters anywhere (names, half words). Every filter is optional:
--   p_kinds  which kinds of entry
--   p_tag    only entries carrying this tag
--   p_under  only entries inside this world, piece, page or chapter
--   p_since / p_until  written between these times
--   p_newest newest first instead of best first
create or replace function public.inkwell_search(
  p_user uuid,
  p_query text default null,
  p_kinds text[] default null,
  p_tag text default null,
  p_under text default null,
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_newest boolean default false,
  p_limit integer default 20
)
returns table (id text, kind text, parent_id text, title text, text text, tags text[], links jsonb, fields jsonb,
               created_at timestamptz, updated_at timestamptz, rank real)
language plpgsql stable security definer set search_path = public
as $$
declare
  kinds text[] := coalesce(p_kinds, array['line','para','heading','scene','page','note','chapter','world','project','review','shot','about','digest']);
  q tsquery := case when coalesce(btrim(p_query), '') = '' then null else websearch_to_tsquery('english', p_query) end;
  inside text[];
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if p_under is not null then
    with recursive down as (
      select e.id from writing_entries e where e.user_id = p_user and e.id = p_under
      union
      select c.id from writing_entries c join down d on c.parent_id = d.id
       where c.user_id = p_user and not c.deleted
    )
    select array_agg(down.id) into inside from down;
    if inside is null then return; end if;
  end if;

  return query
    select e.id, e.kind, e.parent_id, e.title, e.text, e.tags, e.links, e.fields, e.created_at, e.updated_at,
           case when q is null then 0::real else ts_rank_cd(inkwell_search_doc(e.title, e.text, e.fields), q) end
      from writing_entries e
     where e.user_id = p_user and inkwell_live(e.deleted, e.fields) and e.kind = any(kinds)
       and (q is null or inkwell_search_doc(e.title, e.text, e.fields) @@ q)
       and (p_tag is null or e.tags @> array[lower(ltrim(p_tag, '#'))])
       and (inside is null or e.id = any(inside))
       and (p_since is null or e.created_at >= p_since)
       and (p_until is null or e.created_at < p_until)
     order by case when p_newest or q is null then 0::real
                   else ts_rank_cd(inkwell_search_doc(e.title, e.text, e.fields), q) end desc,
              e.updated_at desc
     limit lim;

  -- Nothing by word? Look for the letters anywhere (every word must appear).
  if not found and q is not null then
    return query
      select e.id, e.kind, e.parent_id, e.title, e.text, e.tags, e.links, e.fields, e.created_at, e.updated_at, 0::real
        from writing_entries e
       where e.user_id = p_user and inkwell_live(e.deleted, e.fields) and e.kind = any(kinds)
         and not exists (
           select 1 from unnest(regexp_split_to_array(lower(btrim(p_query)), '\s+')) w
            where w <> '' and position(w in lower(e.title || ' ' || e.text || ' ' ||
                  coalesce(e.fields -> 'voice' ->> 'raw', '') || ' ' || coalesce(e.fields -> 'snapshot' ->> 'summary', ''))) = 0)
         and (p_tag is null or e.tags @> array[lower(ltrim(p_tag, '#'))])
         and (inside is null or e.id = any(inside))
         and (p_since is null or e.created_at >= p_since)
         and (p_until is null or e.created_at < p_until)
       order by e.updated_at desc
       limit lim;
  end if;
end $$;

-- Every tag in use, with how many live entries carry it and when it was last
-- used; optionally only inside one world, piece or page.
create or replace function public.inkwell_tags(p_user uuid, p_under text default null)
returns table (tag text, n integer, last timestamptz)
language sql stable security definer set search_path = public
as $$
  with recursive down as (
    select e.id from writing_entries e where p_under is not null and e.user_id = p_user and e.id = p_under
    union
    select c.id from writing_entries c join down d on c.parent_id = d.id where c.user_id = p_user and not c.deleted
  )
  select t, count(*)::integer, max(e.updated_at)
    from writing_entries e, unnest(e.tags) t
   where e.user_id = p_user and inkwell_live(e.deleted, e.fields)
     and (p_under is null or e.id in (select id from down))
   group by t
   order by count(*) desc, max(e.updated_at) desc
$$;

-- Where everything lives, counted: for each world, top-level page and daily
-- page, how many live entries are inside it, when it was last touched, and
-- its most used tags. One pass, for the connector's map.
create or replace function public.inkwell_rollup(p_user uuid)
returns table (home text, n integer, last timestamptz, top_tags text[])
language sql stable security definer set search_path = public
as $$
  with recursive live as (
    select e.id, e.parent_id, e.kind, e.tags, e.updated_at from writing_entries e
     where e.user_id = p_user and inkwell_live(e.deleted, e.fields)
       and e.kind not in ('version', 'tally', 'about', 'digest', 'file', 'workflow')
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

-- What links to these entries: every live entry whose links name one of them.
create or replace function public.inkwell_linked_from(p_user uuid, p_ids text[], p_limit integer default 50)
returns table (id text, kind text, parent_id text, title text, text text, links jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select e.id, e.kind, e.parent_id, e.title, e.text, e.links, e.updated_at
    from writing_entries e
   where e.user_id = p_user and inkwell_live(e.deleted, e.fields)
     and exists (select 1 from unnest(p_ids) x where e.links @> jsonb_build_array(x))
   order by e.updated_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

revoke all on function public.inkwell_search(uuid, text, text[], text, text, timestamptz, timestamptz, boolean, integer) from public, anon, authenticated;
revoke all on function public.inkwell_tags(uuid, text) from public, anon, authenticated;
revoke all on function public.inkwell_rollup(uuid) from public, anon, authenticated;
revoke all on function public.inkwell_linked_from(uuid, text[], integer) from public, anon, authenticated;

-- Weekly and monthly summaries: at 4 am in Los Angeles each day, the digest
-- function writes up any finished week (Monday to Sunday) or month that has
-- no summary yet, so a missed night catches up the next. The hour is checked
-- here so daylight saving looks after itself.
select cron.schedule('inkwell-digest', '23 * * * *', $job$
  select net.http_post(
    url := 'https://abybjllpksjeccwolyhn.supabase.co/functions/v1/inkwell-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select cron_secret from public.push_config where id = 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000)
   where extract(hour from now() at time zone 'America/Los_Angeles') = 4
$job$);
