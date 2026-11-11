-- Pictures and files added to Inkwell (laserbunny-coder/inkwell). Each person
-- has a folder named by their user id in a private bucket; only they can read
-- or write it. The app keeps a small "file" entry in writing_entries for each
-- one (name, type, size) and stores the file itself here at <user id>/<entry id>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('writing-files', 'writing-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "own writing files: read" on storage.objects;
create policy "own writing files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'writing-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own writing files: add" on storage.objects;
create policy "own writing files: add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'writing-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own writing files: change" on storage.objects;
create policy "own writing files: change" on storage.objects
  for update to authenticated
  using (bucket_id = 'writing-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'writing-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own writing files: remove" on storage.objects;
create policy "own writing files: remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'writing-files' and (storage.foldername(name))[1] = auth.uid()::text);
