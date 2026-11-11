-- Needs you: what's waiting on this person across their Claude projects. A thread
-- in any Claude project raises an item through the connector (raise_needs_you):
-- a decision to make, something blocked, or work ready to review. It lives in
-- notes, since it is a note with three more things: the Claude project it came
-- from, its kind, and whether it's been cleared. Plain notes keep kind null.
-- link is the thread; a thread has at most one open item, which it updates as
-- things change and clears once it no longer needs the person.
alter table public.notes
  add column if not exists kind         text check (kind in ('decision', 'blocked', 'review')),
  add column if not exists project      text,
  add column if not exists project_link text,
  add column if not exists resolved_at  timestamptz;

create unique index if not exists notes_open_needs on public.notes (user_id, link)
  where kind is not null and resolved_at is null;

-- The app can clear an item, or take a clear back.
grant update (resolved_at) on public.notes to authenticated;
