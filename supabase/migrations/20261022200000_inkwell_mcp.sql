-- The secret address that lets Claude reach Inkwell (the writing app) as a
-- connector. It's separate from Daybook's, so either can be turned off alone.
-- Only a hash of the secret is kept; making a new one turns the old one off.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.inkwell_mcp_tokens (
  user_id     uuid primary key references auth.users on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now()
);

alter table public.inkwell_mcp_tokens enable row level security;
revoke all on public.inkwell_mcp_tokens from anon, authenticated;

create or replace function public.new_inkwell_mcp_token()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token text := encode(gen_random_bytes(24), 'hex');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.inkwell_mcp_tokens (user_id, token_hash, created_at)
  values (auth.uid(), encode(digest(token, 'sha256'), 'hex'), now())
  on conflict (user_id) do update
    set token_hash = excluded.token_hash, created_at = now();
  return token;
end $$;

create or replace function public.revoke_inkwell_mcp_token()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.inkwell_mcp_tokens where user_id = auth.uid();
$$;

create or replace function public.has_inkwell_mcp_token()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.inkwell_mcp_tokens where user_id = auth.uid());
$$;

revoke all on function public.new_inkwell_mcp_token() from public, anon;
revoke all on function public.revoke_inkwell_mcp_token() from public, anon;
revoke all on function public.has_inkwell_mcp_token() from public, anon;
grant execute on function public.new_inkwell_mcp_token() to authenticated;
grant execute on function public.revoke_inkwell_mcp_token() to authenticated;
grant execute on function public.has_inkwell_mcp_token() to authenticated;
