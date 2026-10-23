-- Search for collectifs and discovery sessions; collectif page; fingerprints for the nightly job.
-- Collectifs are shown at town level (collectifs.town_point is already a commune centre snapped to
-- 0.01 degrees), labelled `collectif`, and ranked like community-added listings (same penalty).

alter table public.collectifs
  add column embedding extensions.vector(384),
  add column embedding_hash text,
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('french', search.unaccent(coalesce(name, ''))), 'A')
    || setweight(to_tsvector('french', search.unaccent(coalesce(description, ''))), 'B')) stored;
create index collectifs_town_point_gist on public.collectifs using gist (town_point);
create index collectifs_search_tsv_gin on public.collectifs using gin (search_tsv);

-- Activities already have `embedding`; the nightly job needs to know which text it was computed from.
alter table public.activities add column embedding_hash text;

-- Fingerprints are written by the nightly job (service role / postgres) only: API roles cannot
-- set or change them, otherwise a forged vector would rank a listing and its public hash would
-- stop the job from ever correcting it. Admins keep access.
create function public.pin_embedding() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.embedding := null;
      new.embedding_hash := null;
    else
      new.embedding := old.embedding;
      new.embedding_hash := old.embedding_hash;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.pin_embedding() from public, anon, authenticated;
create trigger activities_pin_embedding before insert or update on public.activities
  for each row execute function public.pin_embedding();
create trigger collectifs_pin_embedding before insert or update on public.collectifs
  for each row execute function public.pin_embedding();

-- A collectif is blocked for the caller when any of its active members has a block with the caller.
create function public.collectif_blocked_for_me(p_collectif uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null
     and exists (select 1 from public.collectif_members m
                  where m.collectif_id = p_collectif and m.status = 'active'
                    and public.is_blocked_between(m.user_id))
$$;
revoke all on function public.collectif_blocked_for_me(uuid) from public, anon;
grant execute on function public.collectif_blocked_for_me(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- explore_rows: + collectifs, + discovery filter. Same attributes as before (no SET clause, so it
-- is inlined into search_explore). The new trailing parameter has a default so the old 8-argument
-- call keeps working.

drop function search.explore_rows(geography, float8, text, extensions.vector, text[], smallint,
  boolean, text[]);

create function search.explore_rows(
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
    from public.activities x, p
    where 'activity' = any(p_kinds)
      and extensions.ST_DWithin(x.place, p_point, p_radius_m)
      and x.archived_at is null and x.published_at <= now()
      and (auth.uid() is null or not public.is_blocked_between(x.organiser_id))
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
    from public.collectifs c, p
    where 'association' = any(p_kinds) and p_weekday is null and not p_newcomer_friendly
      and not p_discovery_only and cardinality(p_interest_slugs) = 0
      and extensions.ST_DWithin(c.town_point, p_point, p_radius_m)
      and (auth.uid() is null or not public.collectif_blocked_for_me(c.id))
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
revoke all on function search.explore_rows(geography, float8, text, extensions.vector, text[], smallint,
  boolean, text[], boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- search_explore: as in 20261022000008_query_vocab.sql, plus p_discovery_only and collectif rows
-- (kind 'collectif', requested through 'association'). The 12-argument version is replaced.

drop function public.search_explore(float8, float8, int, text, extensions.vector, text[], smallint,
  boolean, uuid[], text, int, int);

create function public.search_explore(
  p_lon float8, p_lat float8,
  p_radius_km int default 10,
  p_query text default null,
  p_query_embedding extensions.vector default null,
  p_kinds text[] default '{activity,association}',
  p_weekday smallint default null,
  p_newcomer_friendly boolean default false,
  p_interest_category_ids uuid[] default '{}',
  p_sort text default 'best',
  p_limit int default 20, p_offset int default 0,
  p_discovery_only boolean default false
) returns jsonb
language plpgsql volatile security definer
set search_path = public, search, extensions, pg_temp
-- JIT compiles the scoring expressions for ~450 ms of the scan over a 150k-row candidate set and
-- never pays back on this workload (measured: p95 1.6 s with it, 1.35 s without).
set jit = off
-- A generic plan (chosen after five calls in a session) cannot fold the inlined explore_rows on
-- the call's mode and filters: measured 1.3 s against 0.75 s per radius-10 search at 150k rows.
set plan_cache_mode = force_custom_plan
as $$
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
             'tag_slugs', to_jsonb(d.tag_slugs)) as item
    from page pg
    cross join lateral (
      select a.name as title, a.city as subtitle, a.purpose as body, a.town_point as pt,
             array(select t.slug from association_tags at join tags t on t.id = at.tag_id
                   where at.association_id = a.id order by t.slug) as tag_slugs
      from associations a where pg.kind = 'association' and a.id = pg.id
      union all
      select x.title, x.place_label, x.description, x.place,
             array(select t.slug from activity_tags at join tags t on t.id = at.tag_id
                   where at.activity_id = x.id order by t.slug)
      from activities x where pg.kind = 'activity' and x.id = pg.id
      union all
      select c.name, c.town_label, c.description, c.town_point, '{}'::text[]
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
$$;
revoke all on function public.search_explore(float8, float8, int, text, extensions.vector, text[], smallint,
  boolean, uuid[], text, int, int, boolean) from public;
grant execute on function public.search_explore(float8, float8, int, text, extensions.vector, text[], smallint,
  boolean, uuid[], text, int, int, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Collectif page: first names and photos of active organisers only.

create function public.get_collectif(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'description', c.description,
    'town_label', c.town_label,
    'lon', ST_X(c.town_point::geometry), 'lat', ST_Y(c.town_point::geometry),
    'organisers', coalesce((select jsonb_agg(jsonb_build_object(
                     'first_name', p.first_name, 'photo_url', p.photo_url, 'role', m.role)
                     order by (m.role = 'responsable') desc, m.accepted_at, m.user_id)
                   from public.collectif_members m join public.profiles p on p.id = m.user_id
                  where m.collectif_id = c.id and m.status = 'active'), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'title', x.title,
                     'next_starts_at', (select min(s.starts_at) from public.sessions s
                                         where s.activity_id = x.id and s.status = 'scheduled'
                                           and s.starts_at > now()))
                     order by x.start_date, x.id)
                   from public.activities x
                  where x.organised_by_collectif_id = c.id and x.archived_at is null
                    and x.published_at <= now()
                    and (auth.uid() is null or not public.is_blocked_between(x.organiser_id))),
                   '[]'::jsonb),
    'my_role', (select m.role from public.collectif_members m
                 where m.collectif_id = c.id and m.user_id = auth.uid() and m.status = 'active'))
  from public.collectifs c
  where c.id = p_id and not public.collectif_blocked_for_me(c.id)
$$;
revoke all on function public.get_collectif(uuid) from public;
grant execute on function public.get_collectif(uuid) to anon, authenticated;
