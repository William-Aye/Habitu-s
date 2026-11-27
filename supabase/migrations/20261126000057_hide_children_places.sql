-- Activities with children: the place stays hidden from everyone but accepted members, the organiser
-- and admins (docs/superpowers/specs/2026-11-26-child-safety-design.md).
--
-- 1. The raw API no longer gives any place column: column grants cannot vary by row, so every read goes
--    through the security-definer functions below, which decide per row.
-- 2. The search uses a public point: the place itself, or for an activity with children the place
--    rounded to 2 decimals (about 1 km, like profiles.home_area), for the radius filter as well as for the
--    returned point and distance. Rounding only the output would let a caller find the exact place by
--    moving the search centre across a radius edge.
-- The functions are their previous definitions (newest migration) with only these changes.

alter table public.activities add column search_point extensions.geography(Point, 4326)
  generated always as (
    case when with_children
      then extensions.ST_SetSRID(extensions.ST_MakePoint(
             round(extensions.ST_X(place::extensions.geometry)::numeric, 2)::float8,
             round(extensions.ST_Y(place::extensions.geometry)::numeric, 2)::float8), 4326)::extensions.geography
      else place end) stored;
create index activities_search_point_gist on public.activities using gist (search_point);

revoke select (place, place_label) on public.activities from anon, authenticated;
-- sessions had a table-level SELECT, which a column revoke does not override.
revoke select on public.sessions from anon, authenticated;
grant select (id, activity_id, starts_at, status, cancelled_at, is_discovery) on public.sessions to anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_activity(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a public.activities;
  v_uid uuid := auth.uid();
  v_is_organiser boolean;
  v_membership text;
  v_sees_people boolean;
  v_sees_place boolean;
begin
  select * into a from public.activities where id = p_id;
  if not found then
    return null;
  end if;
  v_is_organiser := v_uid is not null and a.organiser_id = v_uid;
  if a.archived_at is not null and not v_is_organiser and not public.is_admin() then
    return null;
  end if;
  -- Blocked with the organiser, in either direction: the page does not exist for this user.
  if v_uid is not null and not v_is_organiser and public.is_blocked_between(a.organiser_id) then
    return null;
  end if;
  select m.status into v_membership from public.activity_members m
   where m.activity_id = p_id and m.user_id = v_uid;
  v_sees_people := v_is_organiser or coalesce(v_membership = 'member', false);
  -- Activities with children: the place is for accepted members, the organiser and admins only.
  v_sees_place := not a.with_children or v_sees_people or public.is_admin();

  return jsonb_build_object(
      'id', a.id,
      'title', a.title,
      'description', a.description,
      'category', (select jsonb_build_object('id', c.id, 'slug', c.slug, 'name_fr', c.name_fr,
                                             'name_en', c.name_en, 'icon', c.icon)
                     from public.categories c where c.id = a.category_id),
      'tags', coalesce((select jsonb_agg(jsonb_build_object('slug', t.slug, 'label_fr', t.label_fr,
                                                            'label_en', t.label_en) order by t.slug)
                          from public.activity_tags x join public.tags t on t.id = x.tag_id
                         where x.activity_id = a.id), '[]'::jsonb),
      -- anon: an empty object (an organiser exists, nothing identifies them); see DB-2.
      'organiser', (select case when v_uid is null then '{}'::jsonb
                           else jsonb_build_object('id', p.id, 'first_name', p.first_name, 'photo_url', p.photo_url) end
                      from public.profiles p where p.id = a.organiser_id),
      'organised_by', case
        when a.organised_by_association_id is not null then
          (select jsonb_build_object('kind', 'association', 'id', x.id, 'name', x.name)
             from public.associations x
            where x.id = a.organised_by_association_id and x.removed_at is null)
        when a.organised_by_collectif_id is not null then
          (select jsonb_build_object('kind', 'collectif', 'id', x.id, 'name', x.name)
             from public.collectifs x where x.id = a.organised_by_collectif_id)
        end,
      'place_label', case when v_sees_place then a.place_label end,
      'lon', case when v_sees_place then extensions.ST_X(a.place::extensions.geometry) end,
      'lat', case when v_sees_place then extensions.ST_Y(a.place::extensions.geometry) end,
      'with_children', a.with_children,
      'place_hidden', not v_sees_place,
      'children_requirements_missing', case
        when a.with_children and v_uid is not null and not v_is_organiser
             and coalesce(v_membership, 'none') not in ('member', 'pending')
          then to_jsonb(public.children_requirements_missing())
        else '[]'::jsonb end,
      'recurrence_kind', a.recurrence_kind,
      'recurrence_interval_days', a.recurrence_interval_days,
      'recurrence_weekdays', a.recurrence_weekdays,
      'start_date', a.start_date,
      'start_time', a.start_time,
      'duration_minutes', a.duration_minutes,
      'timezone', a.timezone,
      'max_size', a.max_size,
      'newcomer_friendly', a.newcomer_friendly,
      'approval_mode', a.approval_mode,
      'published_at', a.published_at,
      'archived_at', a.archived_at,
      'is_organiser', v_is_organiser,
      'my_status', case when v_membership in ('member', 'pending') then v_membership else 'none' end,
      'next_sessions', coalesce((select jsonb_agg(public.session_card(s.id, v_sees_people) order by s.starts_at)
                                   from (select s.id, s.starts_at from public.sessions s
                                          where s.activity_id = a.id and s.starts_at > now()
                                          order by s.starts_at limit 8) s), '[]'::jsonb))
    || case when v_sees_people then jsonb_build_object('welcome_first_name',
         (select p.first_name from public.profiles p
           where p.id = a.welcome_member_id and not public.is_blocked_between(p.id)
             and (p.id = a.organiser_id or exists (select 1 from public.activity_members wm
                   where wm.activity_id = a.id and wm.user_id = p.id and wm.status = 'member'))))
       else '{}'::jsonb end
    || case when coalesce(v_membership = 'member', false) then jsonb_build_object('my_past_attendance_count',
         (select count(*)::int from public.attendances t join public.sessions s on s.id = t.session_id
           where s.activity_id = a.id and t.user_id = v_uid and t.status = 'confirmed' and s.starts_at < now()))
       else '{}'::jsonb end;
end $function$;

CREATE OR REPLACE FUNCTION public.session_card(p_session uuid, p_with_attendees boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
      'id', s.id,
      'starts_at', s.starts_at,
      'place_label', case when a.with_children and not p_with_attendees and not public.is_admin() then null
                          else coalesce(s.place_label, a.place_label) end,
      'is_discovery', s.is_discovery,
      'status', s.status,
      'confirmed_count', c.n,
      'is_full', a.max_size is not null and c.n >= a.max_size,
      'my_attendance', (select jsonb_build_object('status', t.status, 'guest_count', t.guest_count)
                          from public.attendances t
                         where t.session_id = s.id and t.user_id = auth.uid()))
    || case when p_with_attendees then jsonb_build_object('attendees', coalesce(
         (select jsonb_agg(jsonb_build_object('id', p.id, 'first_name', p.first_name, 'photo_url', p.photo_url)
                           order by t.updated_at, p.id)
            from public.attendances t join public.profiles p on p.id = t.user_id
           where t.session_id = s.id and t.status = 'confirmed'
             and not public.is_blocked_between(t.user_id) and not public.is_banned(t.user_id)), '[]'::jsonb))
       else '{}'::jsonb end
    from public.sessions s
    join public.activities a on a.id = s.activity_id
    cross join lateral (select coalesce(sum(1 + t.guest_count), 0)::int as n
                          from public.attendances t
                         where t.session_id = s.id and t.status = 'confirmed') c
   where s.id = p_session;
$function$;

CREATE OR REPLACE FUNCTION public.my_activities()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.obj order by x.next_at nulls last, x.title, x.id)
      from (select a.id, a.title, ns.starts_at as next_at,
                   jsonb_build_object(
                     'id', a.id,
                     'title', a.title,
                     'place_label', case when not a.with_children or a.organiser_id = v_uid or m.status = 'member'
                                         then a.place_label end,
                     'with_children', a.with_children,
                     'category_icon', c.icon,
                     'is_organiser', a.organiser_id = v_uid,
                     'my_status', case when m.status in ('member', 'pending') then m.status else 'none' end,
                     'next_session', case when ns.id is not null then
                       public.session_card(ns.id, a.organiser_id = v_uid or m.status = 'member') end) as obj
              from public.activities a
              join public.categories c on c.id = a.category_id
              left join public.activity_members m on m.activity_id = a.id and m.user_id = v_uid
              left join lateral (select s.id, s.starts_at from public.sessions s
                                  where s.activity_id = a.id and s.status = 'scheduled'
                                    and s.starts_at > now()
                                  order by s.starts_at limit 1) ns on true
             where a.archived_at is null
               and (a.organiser_id = v_uid or m.status in ('member', 'pending'))) x),
    '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION search.explore_rows(p_point extensions.geography, p_radius_m double precision, p_query text, p_query_embedding extensions.vector, p_kinds text[], p_weekday smallint, p_newcomer_friendly boolean, p_interest_slugs text[], p_discovery_only boolean DEFAULT false)
 RETURNS TABLE(kind text, id uuid, distance_m double precision, score smallint, keyword boolean, penalty integer, is_new boolean, source_label text)
 LANGUAGE sql
 STABLE
AS $function$
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
      and a.removed_at is null
      and (p_query is not null or cardinality(p_interest_slugs) = 0
           or exists (select 1 from public.association_tags at join public.tags t on t.id = at.tag_id
                      where at.association_id = a.id and t.slug = any(p_interest_slugs)))
  ),
  act as (
    select 'activity'::text, x.id, extensions.ST_Distance(x.search_point, p_point), 0,
           x.published_at > now() - pg_catalog.make_interval(days => p.new_days),
           false, null::text,
           case when p_query is not null then extensions.word_similarity(p.q_norm, search.normalise_name(x.title)) end,
           case when p_query is not null then x.search_tsv @@ p.tsq end,
           case when p_query is not null then 1 - (x.embedding operator(extensions.<=>) p_query_embedding) end
    from public.activities x, p, blk
    where 'activity' = any(p_kinds)
      and extensions.ST_DWithin(x.search_point, p_point, p_radius_m)
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
      -- a collectif whose last responsable or organiser is gone (banned, say) is hidden
      and exists (select 1 from public.collectif_members m where m.collectif_id = c.id and m.status = 'active')
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
$function$;

CREATE OR REPLACE FUNCTION public.search_explore(p_lon double precision, p_lat double precision, p_radius_km integer DEFAULT 10, p_query text DEFAULT NULL::text, p_query_embedding extensions.vector DEFAULT NULL::extensions.vector, p_kinds text[] DEFAULT '{activity,association}'::text[], p_weekday smallint DEFAULT NULL::smallint, p_newcomer_friendly boolean DEFAULT false, p_interest_category_ids uuid[] DEFAULT '{}'::uuid[], p_sort text DEFAULT 'best'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_discovery_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'search', 'extensions', 'pg_temp'
 SET jit TO 'off'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
  prm record;
  v_point geography;
  v_query text := nullif(btrim(p_query), '');
  v_mode text;
  v_slugs text[] := '{}';
  v_results jsonb;
  v_strong int;
  v_has_more boolean;
  v_strong_50 int;
  v_suggest int;
  v_miss text;
  v_emb extensions.vector := p_query_embedding;
  v_match text;
begin
  select * into prm from search.params();
  if p_radius_km is null or p_radius_km not in (5, 10, 25, 50) then
    raise exception 'radius must be 5, 10, 25 or 50 km' using errcode = '22023';
  end if;
  if p_lon is null or p_lat is null or p_lon not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and prm.max_limit then
    raise exception 'limit must be between 1 and %', prm.max_limit using errcode = '22023';
  end if;
  if p_offset is null or p_offset not between 0 and prm.max_offset then
    raise exception 'offset must be between 0 and %', prm.max_offset using errcode = '22023';
  end if;
  if char_length(p_query) > 200 then
    raise exception 'query too long' using errcode = '22023';
  end if;
  if p_query_embedding is not null and vector_dims(p_query_embedding) <> 384 then
    raise exception 'query embedding must have 384 dimensions' using errcode = '22023';
  end if;
  if p_sort is null or p_sort not in ('best', 'nearest') then
    raise exception 'sort must be best or nearest' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_kinds), 0) = 0 or not p_kinds <@ '{activity,association}'::text[]
     or array_position(p_kinds, null) is not null then
    raise exception 'kinds must be activity and/or association' using errcode = '22023';
  end if;
  if p_weekday is not null and p_weekday not between 1 and 7 then
    raise exception 'weekday must be between 1 and 7' using errcode = '22023';
  end if;

  v_point := ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography;
  if v_query is not null and p_query_embedding is not null then
    v_match := 'given';
  elsif v_query is not null then
    select r.embedding, r.method into v_emb, v_match from search.resolve_query(v_query) r;
  end if;
  v_mode := case when v_query is null then 'browse'
                 when v_emb is not null then 'search' else 'keyword_only' end;
  if v_mode = 'browse' and cardinality(p_interest_category_ids) > 0 then
    select coalesce(array_agg(c.slug), '{}') into v_slugs
    from categories c
    where c.id = any(p_interest_category_ids) or c.parent_id = any(p_interest_category_ids);
    if cardinality(v_slugs) = 0 then v_slugs := '{""}'; end if;  -- unknown ids match nothing
  end if;

  with r as (
    select e.*, coalesce(e.score < prm.weak, false) as is_weak
    from search.explore_rows(v_point, p_radius_km * 1000.0, v_query,
           case when v_mode = 'search' then v_emb end,
           p_kinds, p_weekday, coalesce(p_newcomer_friendly, false), v_slugs,
           coalesce(p_discovery_only, false)) e
  ),
  ranked as (
    select r.*, row_number() over (order by
             case when v_mode = 'browse' then r.penalty > 0 else r.is_weak end,
             case when v_mode <> 'browse' and p_sort = 'best' then floor(r.score / prm.tie_window::float8) end desc,
             r.distance_m, r.id) as rn
    from r
  ),
  page as (
    select * from ranked where rn > p_offset and rn <= p_offset + p_limit
  ),
  items as (
    select pg.rn, jsonb_build_object(
             'kind', pg.kind, 'id', pg.id, 'title', d.title, 'subtitle', d.subtitle,
             'snippet', left(d.body, 140),
             'lon', ST_X(d.pt::geometry), 'lat', ST_Y(d.pt::geometry),
             'distance_km', round((pg.distance_m / 1000)::numeric, 1),
             'score', pg.score,
             'label', case when pg.score is null then null
                           when pg.score >= prm.strong then 'very_relevant'
                           when pg.score >= prm.weak then 'relevant' else 'weak' end,
             'is_weak', pg.is_weak, 'is_new', pg.is_new, 'source_label', pg.source_label,
             'tag_slugs', to_jsonb(d.tag_slugs), 'with_children', d.with_children) as item
    from page pg
    cross join lateral (
      select a.name as title, a.city as subtitle, a.purpose as body, a.town_point as pt,
             array(select t.slug from association_tags at join tags t on t.id = at.tag_id
                   where at.association_id = a.id order by t.slug) as tag_slugs, false as with_children
      from associations a where pg.kind = 'association' and a.id = pg.id
      union all
      select x.title, case when x.with_children then null else x.place_label end, x.description, x.search_point,
             array(select t.slug from activity_tags at join tags t on t.id = at.tag_id
                   where at.activity_id = x.id order by t.slug), x.with_children
      from activities x where pg.kind = 'activity' and x.id = pg.id
      union all
      select c.name, c.town_label, c.description, c.town_point, '{}'::text[], false
      from collectifs c where pg.kind = 'collectif' and c.id = pg.id
    ) d
  )
  select coalesce((select jsonb_agg(item order by rn) from items), '[]'::jsonb),
         (select count(*) from ranked where score >= prm.strong),
         -- No next page past max_offset: the app would request an offset the guard rejects.
         p_offset + p_limit < prm.max_offset
           and exists (select 1 from ranked where rn = p_offset + p_limit + 1)
    into v_results, v_strong, v_has_more;

  if v_mode <> 'browse' and v_strong < prm.widen_min and p_radius_km < 50 then
    select count(*) into v_strong_50
    from search.explore_rows(v_point, 50000, v_query,
           case when v_mode = 'search' then v_emb end,
           p_kinds, p_weekday, coalesce(p_newcomer_friendly, false), v_slugs,
           coalesce(p_discovery_only, false)) e
    where e.score >= prm.strong;
    if v_strong_50 > v_strong then v_suggest := 50; end if;
  end if;

  if v_mode <> 'browse' and p_offset = 0 and v_strong = 0 then
    v_miss := search.anonymise_query(v_query);
    if char_length(v_miss) >= 2 then
      -- created_at carries the day only, like `day`: a miss never records when it was searched.
      insert into search_misses (query, area_label, day, created_at)
      values (v_miss,
              (select a.city from associations a
               where a.city is not null and a.town_point is not null
               order by a.town_point <-> v_point limit 1),
              current_date, current_date::timestamptz)
      on conflict (query, (coalesce(area_label, '')), day)
        do update set hits = search_misses.hits + 1;
    end if;
  end if;

  if v_mode <> 'browse' and p_offset = 0 and v_match in ('words', 'none') then
    perform search.log_vocab_request(v_query, v_match);
  end if;

  return jsonb_build_object('mode', v_mode, 'query_match', v_match, 'results', v_results,
    'strong_count', v_strong,
    'strong_count_50km', v_strong_50, 'suggest_radius_km', v_suggest, 'has_more', v_has_more);
end
$function$;
