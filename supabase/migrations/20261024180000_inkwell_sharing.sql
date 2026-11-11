-- Share links for Inkwell (laserbunny-coder/inkwell): a piece or a bible page
-- that someone can read, and comment on, from a link, without an account.
--
-- What a reader sees is a copy the writer's own app publishes into the share
-- row (its words, in reading order, and nothing else). Readers never touch
-- writing_entries, so a link can't reach the writer's other worlds, their day
-- pages, or anything of Daybook's. The link's secret is the share's id; the
-- inkwell-share function looks it up for readers with the service key, and
-- these tables give readers no access of their own (no anon grants).
--
-- Comments come back to the writer's app, which turns each one into a margin
-- note (an entry like everything else, so it syncs and backs up).
--
-- Built with inviting people into a world in mind: every share names its
-- world, and a later writing_members (world_id, user_id, role) can widen
-- writing_entries' policy to "this world's members" without changing these.
create table if not exists public.writing_shares (
  id           text primary key check (char_length(id) >= 20),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  root_id      text not null,
  world_id     text,
  kind         text not null default 'piece' check (kind in ('piece', 'page')),
  title        text not null default '',
  content      jsonb not null default '{}',
  can_comment  boolean not null default true,
  revoked      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists writing_shares_user on public.writing_shares (user_id);

drop trigger if exists writing_shares_touch on public.writing_shares;
create trigger writing_shares_touch before insert or update on public.writing_shares
  for each row execute function public.touch_updated_at();

alter table public.writing_shares enable row level security;

drop policy if exists "own shares" on public.writing_shares;
create policy "own shares" on public.writing_shares
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.writing_shares to authenticated;
revoke all on public.writing_shares from anon;

-- One row per comment or reply. block is the paragraph or line it's about
-- (an entry id in the shared copy), quote the words a reader picked, if any.
-- owner marks the writer's own replies.
create table if not exists public.writing_comments (
  id          uuid primary key default gen_random_uuid(),
  share_id    text not null references public.writing_shares (id) on delete cascade,
  parent_id   uuid references public.writing_comments (id) on delete cascade,
  block       text,
  quote       text not null default '',
  name        text not null default '',
  text        text not null check (char_length(text) between 1 and 4000),
  guest       text,
  user_id     uuid references auth.users on delete set null,
  owner       boolean not null default false,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists writing_comments_share on public.writing_comments (share_id, created_at);

alter table public.writing_comments enable row level security;

-- The writer reads every comment on their shares, replies, and resolves.
drop policy if exists "comments on my shares" on public.writing_comments;
create policy "comments on my shares" on public.writing_comments
  for select using (exists (select 1 from public.writing_shares s where s.id = share_id and s.user_id = auth.uid()));

drop policy if exists "reply on my shares" on public.writing_comments;
create policy "reply on my shares" on public.writing_comments
  for insert with check (
    owner and user_id = auth.uid()
    and exists (select 1 from public.writing_shares s where s.id = share_id and s.user_id = auth.uid())
  );

drop policy if exists "resolve on my shares" on public.writing_comments;
create policy "resolve on my shares" on public.writing_comments
  for update using (exists (select 1 from public.writing_shares s where s.id = share_id and s.user_id = auth.uid()));

grant select, insert on public.writing_comments to authenticated;
grant update (resolved) on public.writing_comments to authenticated;
revoke all on public.writing_comments from anon;
