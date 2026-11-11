-- The dragon games (Quest, Hold the Keep, Don't Feed the Dragon) moved out of Daybook.
-- Stop their background jobs: the every-minute reminder sender and the daily voice-line tidy.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daybook-remind') then perform cron.unschedule('daybook-remind'); end if;
  if exists (select 1 from cron.job where jobname = 'daybook-voice-tidy') then perform cron.unschedule('daybook-voice-tidy'); end if;
end $$;

-- Quest's reminder tables: the schedule of game reminders and the browsers signed up for them.
-- push_config stays (Inkwell's digest and the other jobs use its cron secret).
drop table if exists public.push_plan;
drop table if exists public.push_subs;
