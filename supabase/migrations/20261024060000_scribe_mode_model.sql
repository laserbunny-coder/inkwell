-- Each Scribe mode picks which Claude rewrites it: haiku (quick and cheap,
-- for texts and clean-ups), sonnet (emails), or opus (writing that matters,
-- long idea dumps, characters). Existing modes get the same defaults.
alter table public.scribe_modes add column if not exists model text not null default 'opus'
  check (model in ('haiku', 'sonnet', 'opus'));

update public.scribe_modes set model = case id
  when 'text' then 'haiku'
  when 'clean' then 'haiku'
  when 'email' then 'sonnet'
  else 'opus' end;
