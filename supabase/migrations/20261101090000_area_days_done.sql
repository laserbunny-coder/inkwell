-- Areas can be marked done for a day ("finished with Business today"): a list of local dates, such as ["2026-11-01"].
alter table public.items add column if not exists days_done jsonb;
