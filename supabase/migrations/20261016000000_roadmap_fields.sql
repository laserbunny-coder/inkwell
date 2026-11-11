-- What the Roadmap needs. A project or sub-project can have a start date next
-- to its due date. A task can be a milestone (a diamond on the roadmap), and a
-- milestone can be a hard deadline (its date can't move). Any item can wait on
-- another item, such as "List footage" waiting on "NAS live".
alter table public.items add column if not exists start date;
alter table public.items add column if not exists milestone boolean not null default false;
alter table public.items add column if not exists hard_deadline boolean not null default false;
alter table public.items add column if not exists waits_on text;
