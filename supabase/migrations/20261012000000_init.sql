-- Projects, sub-projects and tasks all live in one table. A row with
-- children is a project; parent_id builds the tree.
create table if not exists public.items (
  id            text primary key,
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  parent_id     text,
  title         text not null default '',
  notes         text,
  done          boolean not null default false,
  day           date,
  start_min     integer check (start_min between 0 and 1439),
  duration_min  integer not null default 60 check (duration_min between 5 and 1440),
  sort          double precision not null default 0,
  color         text,
  due           date,
  deleted       boolean not null default false,
  updated_at    timestamptz not null default now()
);

create index if not exists items_user_updated on public.items (user_id, updated_at);

-- The server stamps every write, so devices with slightly different clocks
-- still agree on what changed when.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.touch_updated_at();

alter table public.items enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Signed-in people reach the table through the API; row level security above
-- limits each person to their own rows. Signed-out visitors get nothing.
grant select, insert, update, delete on public.items to authenticated;
revoke all on public.items from anon;

-- Live updates so the phone and the computer see each other's changes.
do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null;
end $$;

-- Google refresh tokens, used only by the calendar function. The app can
-- save its own token through save_google_token() but can never read it back.
create table if not exists public.google_tokens (
  user_id        uuid primary key references auth.users on delete cascade,
  refresh_token  text not null,
  updated_at     timestamptz not null default now()
);

alter table public.google_tokens enable row level security;
revoke all on public.google_tokens from anon, authenticated;

create or replace function public.save_google_token(refresh text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.google_tokens (user_id, refresh_token, updated_at)
  values (auth.uid(), refresh, now())
  on conflict (user_id) do update
    set refresh_token = excluded.refresh_token, updated_at = now();
$$;

revoke all on function public.save_google_token(text) from public, anon;
grant execute on function public.save_google_token(text) to authenticated;

create or replace function public.has_google_token()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.google_tokens where user_id = auth.uid());
$$;

revoke all on function public.has_google_token() from public, anon;
grant execute on function public.has_google_token() to authenticated;
