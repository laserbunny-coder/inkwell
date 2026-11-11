-- The 9 pm nudge for Inkwell's day review. Every hour, a check runs here in the
-- database; when it's 9 pm in Los Angeles, each person who wrote something on
-- today's page in Inkwell and hasn't reviewed it yet gets a note in Daybook
-- (once a day) with a link that opens the review. Pacific time follows
-- daylight saving on its own.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

create or replace function public.inkwell_review_nudge(moment timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  here timestamp := moment at time zone 'America/Los_Angeles';
  d text := to_char(here, 'YYYY-MM-DD');
  review_link text := 'https://laserbunny-coder.github.io/inkwell/?review=' || to_char(here, 'YYYY-MM-DD');
  sent integer;
begin
  if extract(hour from here) <> 21 then return 0; end if;
  insert into public.notes (user_id, author, title, body, link)
  select distinct w.user_id, 'Inkwell', 'Your day review',
    'Claude can look back over today''s page with you: a few lines on how the day went, then what''s on it, sorted into things to add to Daybook, things to keep thinking about, and things to let go. Nothing goes anywhere until you say.',
    review_link
  from public.writing_entries w
  where w.parent_id = 'day-' || d and w.kind = 'line' and not w.deleted and btrim(w.text) <> ''
    and not exists (select 1 from public.writing_entries r
                    where r.user_id = w.user_id and r.kind = 'review' and r.parent_id = 'day-' || d and not r.deleted)
    and not exists (select 1 from public.notes n where n.user_id = w.user_id and n.link = review_link);
  get diagnostics sent = row_count;
  return sent;
end $$;

revoke all on function public.inkwell_review_nudge(timestamptz) from public, anon, authenticated;

-- Named, so running this again replaces the job rather than adding another.
select cron.schedule('inkwell-review-nudge', '0 * * * *', $$select public.inkwell_review_nudge()$$);
