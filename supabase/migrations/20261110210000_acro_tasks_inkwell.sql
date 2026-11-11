-- Acro HQ tasks move from Daybook to Inkwell: once Daybook has been brought into Inkwell (its lines have
-- ids li-db-...), the acro-tasks job syncs the board with Inkwell's Acro project instead of Daybook's
-- Business area, and mirrors HQ's meetings there read-only. target says which side the job is on now;
-- the first Inkwell run carries Daybook's links over to the imported lines.
alter table public.acro_task_sync add column if not exists target text not null default 'daybook';
-- The Inkwell world the board syncs with, once chosen (so renaming the project doesn't lose it).
alter table public.acro_task_sync add column if not exists world_id text;
