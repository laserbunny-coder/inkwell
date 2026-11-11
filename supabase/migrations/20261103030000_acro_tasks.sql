-- Acro HQ tasks <-> Daybook (Michael, Nov 3): the acro-tasks function keeps Michael's HQ board tasks and
-- Daybook's Business area in step (supabase/functions/acro-tasks/sync.ts). These two tables are only for that
-- function (service role); the app never reads them, so a stale app write can't undo a link.
create table if not exists public.acro_task_links (
  item_id    text primary key,
  user_id    uuid not null,
  task_id    text,                -- HQ board task id; null = an item the sync leaves alone
  seen       jsonb,               -- both sides as of the last sync: {v, b:{title,notes,due,done}, i:{...}}
  updated_at timestamptz not null default now()
);
create unique index if not exists acro_task_links_task on public.acro_task_links (task_id) where task_id is not null;
alter table public.acro_task_links enable row level security;

create table if not exists public.acro_task_sync (
  user_id      uuid primary key,
  locked_until timestamptz not null default 'epoch',
  last_run     timestamptz,
  last_result  jsonb
);
alter table public.acro_task_sync enable row level security;
