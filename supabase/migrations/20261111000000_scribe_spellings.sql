-- Spellings Scribe remembers: a name fixed by voice on the Scribe keyboard
-- ("Nate, N A T E", then Remember) is kept here, and the speech service is
-- told it from then on so it comes back spelled right. Only the server step
-- reads and writes it; the Scribe app lists them and can take one out.
create table if not exists public.scribe_spellings (
  user_id     uuid not null references auth.users on delete cascade,
  term        text not null check (char_length(term) between 2 and 49),
  created_at  timestamptz not null default now(),
  primary key (user_id, term)
);

alter table public.scribe_spellings enable row level security;
revoke all on public.scribe_spellings from anon, authenticated;
