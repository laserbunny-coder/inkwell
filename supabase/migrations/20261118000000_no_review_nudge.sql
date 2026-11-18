-- The 9 pm day review is gone from Inkwell (Nov 18 2026): Michael no longer
-- wants it. Its hourly job stops and its function goes, so nothing writes the
-- "Your day review" note or buzzes for it any more. Reviews already made stay
-- where they are (writing_entries of kind 'review'); nothing is deleted.
-- alert_prefs stays as a table, but the alerts function no longer reads it:
-- only Needs you buzzes now, on every device that turned alerts on.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'inkwell-review-nudge') then
    perform cron.unschedule('inkwell-review-nudge');
  end if;
end $$;

drop function if exists public.inkwell_review_nudge(timestamptz);
