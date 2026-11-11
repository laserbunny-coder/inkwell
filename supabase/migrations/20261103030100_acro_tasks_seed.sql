-- Starts the Acro HQ <-> Daybook task sync from where things stood on Nov 3 (Michael's own data; does
-- nothing if those items aren't there). Before this, Claude threads had copied some board tasks into Daybook
-- by hand with no link. This:
--   - links the 4 copies that match a board task (Daybook's wording kept where it's newer),
--   - leaves the NAS project's steps, the "Nate: ..." tasks (Nate's stay on the board), the cheer opening
--     milestone and Claude's own job in Daybook only,
--   - and, by marking the sync as started, lets the first run put every other open Business task on the
--     board as Michael's and bring his open board tasks into Daybook.
do $$
declare uid uuid;
begin
  select user_id into uid from public.items where id = 'area-business-59c91732-cd74-4fd5-bffb-470bf98a4a7a';
  if uid is null then return; end if;
  insert into public.acro_task_sync (user_id) values (uid) on conflict do nothing;

  insert into public.acro_task_links (item_id, user_id, task_id, seen)
  select v.item_id, uid, v.task_id, v.seen::jsonb
  from (values
    ('a81ad2e1-06d7-447f-bcdd-e4ab1842c91a', 'mvyrjy5lt9i7ihdj', null),                       -- Update the PC's Acro HQ code
    ('eed4053a-9cb9-41e2-b650-157e4052a57e', 'mvx712typ6x69ap6', '{"prefer":"daybook"}'),     -- cheer socials
    ('6031c1fa-9690-46b5-91d8-7fb966e7eb68', 'mvv7zbnwyrcetiqe', '{"prefer":"daybook"}'),     -- Mike Ad New A, B, C into Meta Ads
    ('afb6f80b-226c-4085-b9fd-da9bb97453fd', 'xrlz9wmqtlblytv97pki', '{"prefer":"daybook"}')  -- order the NAS list
  ) as v(item_id, task_id, seen)
  where exists (select 1 from public.items i where i.id = v.item_id)
  on conflict do nothing;

  -- Daybook only: the NAS project's steps, Nate's tasks, the milestone and Claude's job
  insert into public.acro_task_links (item_id, user_id, task_id, seen)
  select i.id, uid, null, null from public.items i
  where i.user_id = uid and (
    i.id in ('c5798c7c-d3fc-4841-866b-cd20ed845376', '54ea1e39-178d-449d-8141-083eaf9e52ef', '4bc35671-03ee-4a2f-b305-96a08181f374',
             '59ed0f62-f1f4-4a31-bae5-bef580fe15b5', '72d92d4e-4500-499a-8f14-8bfdc74dbc82', 'e5c3aac1-b6f8-495a-9f76-ee8b5513b0e7',
             'daac1306-f02c-4a0e-9477-a33ab4505a2f', 'dd430c04-26a1-4e94-8f17-c26617136a16')
    or i.id in (with recursive nas as (
                  select id from public.items where id = 'ce5b3f27-fcac-429a-a842-d9b4189b308e'
                  union all select c.id from public.items c join nas on c.parent_id = nas.id)
                select id from nas where id <> 'afb6f80b-226c-4085-b9fd-da9bb97453fd'))
  on conflict do nothing;
end $$;
