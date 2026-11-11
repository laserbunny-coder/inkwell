-- Inkwell's Capture and walk-and-talk drafting share Scribe's modes. Two new
-- modes join everyone's set (Journal, for light cleanup, and Scene, for
-- drafting a story out loud), and Idea becomes an outline, unless it was
-- already changed. Same text as scribe/modes.ts.
insert into public.scribe_modes (user_id, id, name, prompt, apps, model, sort)
select u.user_id, m.id, m.name, m.prompt, '{}', 'opus', u.top + m.n * 10
from (select user_id, max(sort) as top from public.scribe_modes group by user_id) u
cross join (values
  ('journal', 'Journal', 'Journaling or thinking out loud. Light cleanup only: keep my words, my voice and everything I said, in the order I said it. Take out ums, false starts and repeats, fix punctuation, and start a new paragraph where the thought turns.', 1),
  ('scene', 'Scene', 'A scene or passage of a story I''m drafting out loud. Write it as finished prose in my words and my voice, a paragraph per beat, keeping every action, image and line of dialogue I said. For a screenplay, write it in screenplay format. Don''t add story of your own.', 2)
) as m(id, name, prompt, n)
on conflict (user_id, id) do nothing;

update public.scribe_modes
set prompt = 'A note to self about an idea, often a long ramble. Start with the idea itself in a sentence or two, then a short outline, one line per point, labelled where it fits (Premise, Characters, World, Moments, Images, Lines, Questions, Links). Keep every idea, image, line and question I said, in my words; merge repeats; don''t judge or add to the idea.', updated_at = now()
where id = 'idea' and prompt = 'A note to self about an idea, often a long ramble. Keep every idea, image, line and question they said, in their words, but put it in a sensible order, merge repeats, and break it into short paragraphs. Don''t judge or add to the idea.';
