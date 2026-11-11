-- new_scribe_token's "on conflict (user_id, device)" clashed with its own
-- "device" argument (Postgres can't tell the column from the variable), so
-- Connect Scribe always failed. Same function, told to read it as the column.
create or replace function public.new_scribe_token(device text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  token text := encode(gen_random_bytes(24), 'hex');
  name text := left(coalesce(nullif(trim(new_scribe_token.device), ''), 'phone'), 40);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.scribe_tokens (user_id, device, token_hash, created_at)
  values (auth.uid(), name, encode(digest(token, 'sha256'), 'hex'), now())
  on conflict (user_id, device) do update
    set token_hash = excluded.token_hash, created_at = now();
  return token;
end $$;
