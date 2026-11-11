-- Every 2 minutes, after the seed (20261103030100) is in. The function only looks, so the wake carries nothing.
create extension if not exists pg_net with schema extensions;
select cron.schedule('acro-tasks', '*/2 * * * *', $job$
  select net.http_post(
    url := 'https://abybjllpksjeccwolyhn.supabase.co/functions/v1/acro-tasks',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000)
$job$);
