-- search_explore regression fix: the per-collectif NOT EXISTS on collectif_members became an anti join
-- that scanned the table once per collectif (4-16 s with 5,000 collectifs, even for anonymous callers).
-- The collectifs holding a blocked active member are computed once, through collectif_members_user,
-- and the filter is a membership test on that small array. Otherwise identical to migration 22.
create or replace function search.explore_rows(
  p_point geography, p_radius_m float8, p_query text, p_query_embedding extensions.vector,
  p_kinds text[], p_weekday smallint, p_newcomer_friendly boolean, p_interest_slugs text[],
  p_discovery_only boolean default false
) returns table (
  kind text, id uuid, distance_m float8, score smallint, keyword boolean, penalty int, is_new boolean,
  source_label text
)
language sql stable
-- No SET clause and every name qualified: PostgreSQL inlines a SQL function only without one, and
-- inlined into search_explore's query the planner sees the caller's values (mode, kinds, filters)
-- and folds the branches they rule out. Called as a function it ran about twice as slow.
as $$
  with p as (
    select prm.*, search.normalise_name(p_query) as q_norm,
           case when p_query is not null
             then pg_catalog.websearch_to_tsquery('french', search.unaccent(p_query)) end as tsq
    from search.params() prm
  ),
  -- Everyone the caller has a block with, in either direction (empty when signed out).
  blk as (
    select coalesce(array_agg(case when b.blocker_id = auth.uid() then b.blocked_id else b.blocker_id end),
                    '{}'::uuid[]) as ids
    from public.blocks b
    where auth.uid() is not null and (b.blocker_id = auth.uid() or b.blocked_id = auth.uid())
  ),
  -- Collectifs with an active member among them: found through the user index, once per search.
  blkc as (
    select coalesce(array_agg(distinct m.collectif_id), '{}'::uuid[]) as ids
    from blk
    cross join lateral unnest(blk.ids) as bu(uid)
    join public.collectif_members m on m.user_id = bu.uid and m.status = 'active'
  ),
  assoc as (
    select 'association'::text as kind, a.id, extensions.ST_Distance(a.town_point, p_point) as distance_m,
           search.penalty(a.likely_not_public, a.confidence, a.source, a.verified) as penalty,
           false as is_new,
           search.is_dormant(a.website, a.osm_id, a.claimed_by, a.rna_published_on, a.source, current_date)
             as dormant,
           search.source_label(a.source, a.verified, a.confidence) as source_label,
           case when p_query is not null then extensions.word_similarity(p.q_norm, a.name_norm) end as name_sim,
           case when p_query is not null then a.search_tsv @@ p.tsq end as fts,
           case when p_query is not null then 1 - (a.embedding operator(extensions.<=>) p_query_embedding) end as sim
    from public.associations a, p
    where 'association' = any(p_kinds) and p_weekday is null and not p_newcomer_friendly
      and not p_discovery_only
      and extensions.ST_DWithin(a.town_point, p_point, p_radius_m)
      and not search.is_hidden(a.confidence, a.source)
      and (p_query is not null or cardinality(p_interest_slugs) = 0
           or exists (select 1 from public.association_tags at join public.tags t on t.id = at.tag_id
                      where at.association_id = a.id and t.slug = any(p_interest_slugs)))
  ),
  act as (
    select 'activity'::text, x.id, extensions.ST_Distance(x.place, p_point), 0,
           x.published_at > now() - pg_catalog.make_interval(days => p.new_days),
           false, null::text,
           case when p_query is not null then extensions.word_similarity(p.q_norm, search.normalise_name(x.title)) end,
           case when p_query is not null then x.search_tsv @@ p.tsq end,
           case when p_query is not null then 1 - (x.embedding operator(extensions.<=>) p_query_embedding) end
    from public.activities x, p, blk
    where 'activity' = any(p_kinds)
      and extensions.ST_DWithin(x.place, p_point, p_radius_m)
      and x.archived_at is null and x.published_at <= now()
      and not (x.organiser_id = any(blk.ids))
      and (not p_newcomer_friendly or x.newcomer_friendly)
      and (not p_discovery_only
           or exists (select 1 from public.sessions s
                      where s.activity_id = x.id and s.is_discovery and s.status = 'scheduled'
                        and s.starts_at > now() and s.starts_at <= now() + interval '14 days'))
      and (p_query is not null or cardinality(p_interest_slugs) = 0
           or exists (select 1 from public.categories c
                      where c.id = x.category_id and c.slug = any(p_interest_slugs))
           or exists (select 1 from public.activity_tags at join public.tags t on t.id = at.tag_id
                      where at.activity_id = x.id and t.slug = any(p_interest_slugs)))
      and (p_weekday is null or case x.recurrence_kind
             when 'weekly' then extract(isodow from x.start_date) = p_weekday
             when 'weekdays' then p_weekday = any(x.recurrence_weekdays)
             else true end)
  ),
  -- Collectifs travel with 'association' (the app has two kinds). Like a community listing that is
  -- not verified: penalty_community. They have no tags, so an interest-filtered browse skips them.
  col as (
    select 'collectif'::text, c.id, extensions.ST_Distance(c.town_point, p_point),
           p.penalty_community,
           false, false, 'collectif'::text,
           case when p_query is not null then extensions.word_similarity(p.q_norm, search.normalise_name(c.name)) end,
           case when p_query is not null then c.search_tsv @@ p.tsq end,
           case when p_query is not null then 1 - (c.embedding operator(extensions.<=>) p_query_embedding) end
    from public.collectifs c, p, blkc
    where 'association' = any(p_kinds) and p_weekday is null and not p_newcomer_friendly
      and not p_discovery_only and cardinality(p_interest_slugs) = 0
      and extensions.ST_DWithin(c.town_point, p_point, p_radius_m)
      and not (c.id = any(blkc.ids))
  ),
  scored as (
    select c.*, k.keyword,
           case when p_query is not null then
             search.score(c.sim, k.keyword, coalesce(c.name_sim, 0), c.penalty, c.is_new) end as score,
           p.min_score, p.strong, p.name_sim as name_sim_min
    from (select * from assoc union all select * from act union all select * from col) c
    cross join p
    cross join lateral (select coalesce(c.fts, false) or coalesce(c.name_sim, 0) >= p.name_sim as keyword) k
  )
  select s.kind, s.id, s.distance_m, s.score, s.keyword, s.penalty, s.is_new, s.source_label
  from scored s
  where case
    when p_query is null then not s.dormant
    else
      (s.score >= s.min_score or s.keyword)
      and (not s.dormant or coalesce(s.name_sim, 0) >= s.name_sim_min
           or search.base_score(s.sim, s.keyword, coalesce(s.name_sim, 0)) >= s.strong)
    end
$$;

-- Generic text for a cancelled session: it says cancelled, still without any name.
create or replace function public.notif_text(p_kind text, p_lang text) returns table (title text, body text)
language sql immutable set search_path = public, pg_temp as $$
  select case when p_lang = 'en' then t.title_en else t.title_fr end,
         case when p_lang = 'en' then t.body_en else t.body_fr end
    from (values
      ('session_reminder', 'Rappel', 'Vous avez une activité demain. Serez-vous là ?',
                           'Reminder', 'You have an activity tomorrow. Will you be there?'),
      ('new_member', 'Nouveau membre', 'Quelqu''un a rejoint votre activité.',
                     'New member', 'Someone joined your activity.'),
      ('join_request', 'Nouvelle demande', 'Une personne souhaite rejoindre votre activité.',
                       'New request', 'Someone would like to join your activity.'),
      ('request_accepted', 'Demande acceptée', 'Votre demande a été acceptée.',
                           'Request accepted', 'Your request was accepted.'),
      ('late_cancellation', 'Désistement tardif', 'Une personne ne viendra pas à une prochaine séance.',
                             'Late cancellation', 'Someone can no longer make an upcoming session.'),
      ('session_cancelled', 'Séance annulée', 'Une séance de votre activité est annulée.',
                             'Session cancelled', 'A session of your activity is cancelled.'),
      ('session_moved', 'Séance modifiée', 'Une séance de votre activité a changé.',
                         'Session changed', 'A session of your activity has changed.'),
      ('session_rule_changed', 'Séance modifiée', 'Une séance de votre activité a changé.',
                                'Session changed', 'A session of your activity has changed.'),
      ('collectif_invitation', 'Invitation', 'Vous êtes invité à organiser un collectif.',
                                'Invitation', 'You are invited to organise a collective.')
    ) as t(kind, title_fr, body_fr, title_en, body_en)
   where t.kind = p_kind
  union all
  select case when p_lang = 'en' then 'Notification' else 'Notification' end,
         case when p_lang = 'en' then 'Open the app to see the details.' else 'Ouvrez l''application pour voir le détail.' end
   where p_kind not in ('session_reminder', 'new_member', 'join_request', 'request_accepted', 'late_cancellation',
                        'session_cancelled', 'session_moved', 'session_rule_changed', 'collectif_invitation');
$$;

-- A block removes active and pending memberships only: a 'removed' row survives block then unblock,
-- so the organiser's removal still holds.
create or replace function public.blocks_clear_pending() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.activity_members m
   using public.activities a
   where m.activity_id = a.id and m.status in ('member', 'pending')
     and ((a.organiser_id = new.blocker_id and m.user_id = new.blocked_id)
       or (a.organiser_id = new.blocked_id and m.user_id = new.blocker_id));
  delete from public.collectif_members m
   where m.status = 'invited'
     and ((m.user_id = new.blocked_id and exists (
             select 1 from public.collectif_members r
              where r.collectif_id = m.collectif_id and r.user_id = new.blocker_id
                and r.role = 'responsable' and r.status = 'active'))
       or (m.user_id = new.blocker_id and exists (
             select 1 from public.collectif_members r
              where r.collectif_id = m.collectif_id and r.user_id = new.blocked_id
                and r.role = 'responsable' and r.status = 'active')));
  return null;
end $$;

