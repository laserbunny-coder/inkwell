-- Quest reminders: phone and computer notifications before the dragon swoops.
-- push_subs holds each browser that turned reminders on (its Web Push address and keys).
-- push_plan is what to send and when: the app works it out from the plan for the coming week
-- and replaces it whenever the plan changes, so the server only has to send what's due.
-- push_config keeps the server's own VAPID key (made on first use) and the secret the
-- every-minute job shows the remind function. Nobody but the server can read it.
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "own push subs" on public.push_subs;
create policy "own push subs" on public.push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.push_plan (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key     text not null,
  at      timestamptz not null,
  title   text not null,
  body    text,
  tag     text,
  sent_at timestamptz,
  primary key (user_id, key)
);
create index if not exists push_plan_due on public.push_plan (at) where sent_at is null;
alter table public.push_plan enable row level security;
drop policy if exists "own push plan" on public.push_plan;
create policy "own push plan" on public.push_plan for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.push_config (
  id          int primary key default 1 check (id = 1),
  vapid       jsonb,
  cron_secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.push_config enable row level security;
insert into public.push_config (id) values (1) on conflict do nothing;

-- Every minute, if anything is due, wake the remind function.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.schedule('daybook-remind', '* * * * *', $job$
  select net.http_post(
    url := 'https://abybjllpksjeccwolyhn.supabase.co/functions/v1/remind',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select cron_secret from public.push_config where id = 1)),
    body := '{}'::jsonb)
  where exists (select 1 from public.push_plan where sent_at is null and at <= now() and at > now() - interval '30 minutes');
$job$);
