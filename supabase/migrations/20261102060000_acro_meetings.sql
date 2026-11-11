-- Acro HQ's meeting recordings: Acro HQ wakes the acro-meetings function the
-- moment a recording is added; this checks every 5 minutes as well, so a
-- missed wake, a retry or a run that died still gets done. The function only
-- looks (through HQ's connector), so the wake carries nothing.
create extension if not exists pg_net with schema extensions;
select cron.schedule('acro-meetings', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://abybjllpksjeccwolyhn.supabase.co/functions/v1/acro-meetings',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000)
$job$);
