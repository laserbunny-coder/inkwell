-- Scribe, the dictation app (phone keyboard, later a Windows app), reaches its
-- server step with a device secret made in Inkwell ("Connect Scribe"). Each
-- device has its own, so one can be turned off alone. Only a hash is kept;
-- connecting the same device again replaces its old secret.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.scribe_tokens (
  user_id     uuid not null references auth.users on delete cascade,
  device      text not null,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  primary key (user_id, device)
);

alter table public.scribe_tokens enable row level security;
revoke all on public.scribe_tokens from anon, authenticated;

create or replace function public.new_scribe_token(device text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token text := encode(gen_random_bytes(24), 'hex');
  name text := left(coalesce(nullif(trim(device), ''), 'phone'), 40);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.scribe_tokens (user_id, device, token_hash, created_at)
  values (auth.uid(), name, encode(digest(token, 'sha256'), 'hex'), now())
  on conflict (user_id, device) do update
    set token_hash = excluded.token_hash, created_at = now();
  return token;
end $$;

create or replace function public.revoke_scribe_tokens()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.scribe_tokens where user_id = auth.uid();
$$;

revoke all on function public.new_scribe_token(text) from public, anon;
revoke all on function public.revoke_scribe_tokens() from public, anon;
grant execute on function public.new_scribe_token(text) to authenticated;
grant execute on function public.revoke_scribe_tokens() to authenticated;

-- Scribe's modes (Text message, Email, …): how a dictation is rewritten.
-- Kept per person so the phone and the computer share them, and so they can
-- be made or changed by voice from the keyboard. The server step reads and
-- writes them; the starting set comes from scribe/modes.ts.
create table if not exists public.scribe_modes (
  user_id     uuid not null references auth.users on delete cascade,
  id          text not null,
  name        text not null,
  prompt      text not null default '',
  apps        text[] not null default '{}',
  sort        int not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.scribe_modes enable row level security;
revoke all on public.scribe_modes from anon;
create policy "own scribe modes" on public.scribe_modes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
