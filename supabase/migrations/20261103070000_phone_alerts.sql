-- Phone alerts: Daybook can buzz the phone (or computer) even when it's closed, through Web Push.
-- push_subs holds each browser where alerts were turned on (its Web Push address and keys).
-- alert_prefs is what the person wants to hear about, one switch per kind:
--   review  the 9 pm "Your day review" note from Inkwell
--   needs   a Claude thread raising something on Needs you (or changing its kind, say blocked -> review)
--   notes   any other note Claude leaves (off unless switched on)
-- A trigger on notes hands each new note to the alerts function, which checks the switches and sends.
-- The server's VAPID key and the secret the trigger shows are in push_config (kept from earlier).

create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  device     text,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "own push subs" on public.push_subs;
create policy "own push subs" on public.push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.alert_prefs (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  review     boolean not null default true,
  needs      boolean not null default true,
  notes      boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.alert_prefs enable row level security;
drop policy if exists "own alert prefs" on public.alert_prefs;
create policy "own alert prefs" on public.alert_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- push_config was made with Quest's reminders; make sure it's here on a fresh project too.
create table if not exists public.push_config (
  id          int primary key default 1 check (id = 1),
  vapid       jsonb,
  cron_secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.push_config enable row level security;
insert into public.push_config (id) values (1) on conflict do nothing;

create extension if not exists pg_net with schema extensions;

-- Hands a note to the alerts function, but only when this person has a device signed up.
-- pg_net sends after the note is saved and never holds it up or makes it fail.
create or replace function public.alert_on_note() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.resolved_at is not null then return new; end if;
  if tg_op = 'UPDATE' and not (new.kind is not null and old.kind is distinct from new.kind) then return new; end if;
  if not exists (select 1 from public.push_subs s where s.user_id = new.user_id) then return new; end if;
  perform net.http_post(
    url := 'https://abybjllpksjeccwolyhn.supabase.co/functions/v1/alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select cron_secret from public.push_config where id = 1)),
    body := jsonb_build_object('note', new.id));
  return new;
end $$;
revoke all on function public.alert_on_note() from public, anon, authenticated;

drop trigger if exists alert_on_note on public.notes;
create trigger alert_on_note after insert or update of kind on public.notes
  for each row execute function public.alert_on_note();
