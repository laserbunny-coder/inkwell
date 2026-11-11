-- The writing app (laserbunny-coder/writing-app) keeps its manuscripts, notes
-- and vault entries here. It shares this database with Daybook so both apps
-- use the same sign-in and the same life areas (items of kind 'area', which an
-- entry names in area_id). Daybook itself never reads this table.
create table if not exists public.writing_entries (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  kind        text not null,
  parent_id   text,
  sort        double precision not null default 0,
  title       text not null default '',
  text        text not null default '',
  content     jsonb,
  tags        text[] not null default '{}',
  type        text,
  fields      jsonb not null default '{}',
  area_id     text,
  links       jsonb not null default '[]',
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists writing_entries_user_updated on public.writing_entries (user_id, updated_at);
create index if not exists writing_entries_parent on public.writing_entries (user_id, parent_id);

-- Same server-side clock as items, so devices agree on what changed when.
drop trigger if exists writing_entries_touch on public.writing_entries;
create trigger writing_entries_touch before insert or update on public.writing_entries
  for each row execute function public.touch_updated_at();

alter table public.writing_entries enable row level security;

drop policy if exists "own writing" on public.writing_entries;
create policy "own writing" on public.writing_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.writing_entries to authenticated;
revoke all on public.writing_entries from anon;

do $$ begin
  alter publication supabase_realtime add table public.writing_entries;
exception when duplicate_object then null;
end $$;
