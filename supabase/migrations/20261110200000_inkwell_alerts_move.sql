-- Phone alerts move to Inkwell. Each device sign-up now says which app it
-- belongs to. As soon as a person has an Inkwell device signed up, alerts go
-- to Inkwell's devices only (Daybook's stay signed up but are skipped), so a
-- phone doesn't buzz twice while both apps are installed.
alter table public.push_subs add column if not exists app text not null default 'daybook';
do $$ begin
  alter table public.push_subs add constraint push_subs_app check (app in ('daybook', 'inkwell'));
exception when duplicate_object then null;
end $$;
