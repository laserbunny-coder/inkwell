-- Once a day, clear out the dragon's one-off spoken lines older than two weeks (his stock lines stay).
select cron.schedule('daybook-voice-tidy', '17 4 * * *', $job$
  select net.http_post(
    url := 'https://abybjllpksjeccwolyhn.supabase.co/functions/v1/voice',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select cron_secret from public.push_config where id = 1)),
    body := '{"action":"tidy"}'::jsonb,
    timeout_milliseconds := 60000)
$job$);
