-- Notes Claude leaves for this person through the connector (post_note), such as
-- what the morning plan check changed. The app shows unread ones as a card and
-- keeps them all in Notes. link is the Claude chat the note came from; task_ids
-- are the items it changed. read_at is set when the person taps Got it, on
-- whichever device, and syncs to the others.
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  author      text not null default 'Claude',
  title       text not null,
  body        text not null,
  link        text not null,
  task_ids    text[] not null default '{}',
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  updated_at  timestamptz not null default now()
);

create index if not exists notes_user_created on public.notes (user_id, created_at desc);

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before insert or update on public.notes
  for each row execute function public.touch_updated_at();

alter table public.notes enable row level security;

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The app reads its notes and can only mark them read; Claude writes them
-- through the connector, which uses the server's own key.
revoke all on public.notes from anon, authenticated;
grant select on public.notes to authenticated;
grant update (read_at) on public.notes to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null;
end $$;
