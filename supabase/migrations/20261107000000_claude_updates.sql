-- Claude updates: one line from a Claude thread each time it posts a result,
-- so the person can catch up on what happened across all their Claude
-- projects today (Inkwell's Catch-up page). A thread logs through the Daybook
-- connector (log_update), the same way it raises Needs you items, since every
-- Claude project has that connector. link is the thread; thread is its title.
-- state: done (a step finished), live (it's out and working for real), or
-- working (started, or still going). place is where the work lives besides the
-- thread, such as its page in Inkwell or its project in Daybook (Inkwell and
-- Daybook always link to each other's place).
create table if not exists public.claude_updates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  project      text not null,
  project_link text,
  link         text not null,
  thread       text,
  text         text not null,
  place        text,
  state        text not null default 'done' check (state in ('done', 'live', 'working')),
  created_at   timestamptz not null default now()
);

create index if not exists claude_updates_user_created on public.claude_updates (user_id, created_at desc);

alter table public.claude_updates enable row level security;

drop policy if exists "own updates" on public.claude_updates;
create policy "own updates" on public.claude_updates
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The apps only read them; Claude writes them through the connector (server key).
revoke all on public.claude_updates from anon, authenticated;
grant select on public.claude_updates to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.claude_updates;
exception when duplicate_object then null;
end $$;

-- Later on a Needs you item: it steps aside until this time (on the Catch-up
-- page and in Daybook's Needs you list), then comes back on its own.
alter table public.notes add column if not exists snoozed_until timestamptz;
grant update (snoozed_until) on public.notes to authenticated;
