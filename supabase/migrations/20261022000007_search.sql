-- Explore and search: scoring helpers, town-level columns, waiters and the query-embedding cache.
-- Deploy note: the stored generated columns added below rewrite `associations` (~1.5 M rows) and
-- hold an ACCESS EXCLUSIVE lock while they do; apply this migration to the hosted project when
-- no directory import is running.

create schema search;
revoke all on schema search from public, anon, authenticated;
-- Functions created below (and by later migrations) are not executable by API roles unless granted.
alter default privileges in schema search revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers. Immutable so generated columns and indexes may use them. Every name is qualified.

create function search.unaccent(x text) returns text
language sql immutable
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, x) $$;

-- Signed-in users insert community associations through the API, and the generated column
-- name_norm is computed with their privileges. They cannot execute importer functions, so this
-- definer wrapper (same result) is what the column calls.
create function search.normalise_name(x text) returns text
language sql immutable security definer
set search_path = pg_catalog, pg_temp
as $$ select importer.normalise_name(x) $$;

-- Every threshold of the ranking lives here and nowhere else.
-- It returns a named row type rather than OUT parameters: the planner folds an immutable,
-- argument-less function to a constant only when it does not return `record`, so
-- (search.params()).strong costs nothing per row.
create type search.param_set as (
  sim_floor float8, sim_ceil float8, keyword_boost int, strong int, weak int,
  min_score int, tie_window int, name_sim real, penalty_not_public int,
  penalty_low_confidence int, penalty_community int, new_boost int, new_days int,
  hidden_below int, low_confidence int, dormant_years int, widen_min int,
  max_limit int, max_offset int
);
-- Tuned against the ranking set (importer/tests/ranking, real e5-small embeddings) around Lyon.
-- Changed from the first draft (floor .75, ceil .88, not-public penalty 15): the floor/ceiling
-- window narrows to .77 - .865 so that a good keyword-less match scores >= 70, and the not-public
-- penalty rises to 25 so a flagged listing that mentions the query stays below the very-relevant
-- line. Raw cosine similarity seen per query (best matches .. weakest fixture row):
--   coder           .846 (Python Lyon) .838 (Arduino) .836 (Club informatique) .. decoys <= .815 .. .757
--   jeu de go       .869 (Soiree) .861 .854 (go clubs) .849 (copropriete) .828 (Gogo) .. decoys <= .821 .. .770
--   danse bretonne  .873 (Cercle celtique) .868 (Bretons) .830 (Gogo) .829 (Salsa) .. decoys <= .819 .. .777
--   escalade        .866 .863 .852 (the three climbing rows) .835 (L'Escale solidaire) .. decoys <= .821 .. .765
-- Expected rows need no keyword boost to clear 70 (Arduino, 72); the closest decoy (L'Escale
-- solidaire) scores 68. Change these only together with a green ranking run.
create function search.params() returns search.param_set
language sql immutable
as $$
  select row(0.77::float8, 0.865::float8, 8, 70, 50, 15, 5, 0.6::real, 25, 10, 10, 5, 14, 20, 50, 10, 5,
             50, 500)::search.param_set
$$;

-- The per-row helpers below run on every search candidate (up to ~150k rows), so their bodies are
-- a single expression with no FROM: the planner inlines them, and search.params() (immutable, no
-- arguments) folds to a constant.

-- Score before penalty and Nouvelle boost; unclamped above (similarity 1 + keyword gives 108).
create function search.base_score(p_sim float8, p_keyword boolean, p_name_sim real) returns float8
language sql immutable
as $$
  select case
    when p_sim is not null then
      least(greatest((p_sim - (search.params()).sim_floor)
                     / ((search.params()).sim_ceil - (search.params()).sim_floor), 0), 1) * 100
        + case when p_keyword then (search.params()).keyword_boost else 0 end
    when p_keyword then 60 + 30 * p_name_sim
    else 0 end
$$;

create function search.score(
  p_sim float8, p_keyword boolean, p_name_sim real, p_penalty int, p_is_new boolean
) returns smallint
language sql immutable
as $$
  select round(least(greatest(
    search.base_score(p_sim, p_keyword, p_name_sim) - p_penalty
      + case when p_is_new then (search.params()).new_boost else 0 end, 0), 100)::numeric)::smallint
$$;

create function search.penalty(
  p_likely_not_public boolean, p_confidence smallint, p_source text, p_verified boolean
) returns int
language sql immutable
as $$
  select case when p_likely_not_public then (search.params()).penalty_not_public else 0 end
    + case when p_source = 'community' and not coalesce(p_verified, false)
             then (search.params()).penalty_community
           when p_confidence < (search.params()).low_confidence then (search.params()).penalty_low_confidence
           else 0 end
$$;

create function search.is_hidden(p_confidence smallint, p_source text) returns boolean
language sql immutable
as $$ select p_source <> 'community' and p_confidence < (search.params()).hidden_below $$;

-- The one place that decides the "Ajouté par la communauté" / "non vérifié" label.
create function search.source_label(p_source text, p_verified boolean, p_confidence smallint) returns text
language sql immutable
as $$
  select case when p_source = 'community' and not p_verified then 'community'
              when p_confidence < (search.params()).low_confidence then 'unverified' end
$$;

create function search.is_dormant(
  p_website text, p_osm_id text, p_claimed_by uuid, p_rna_published_on date, p_source text, p_today date
) returns boolean
language sql immutable
as $$
  select p_website is null and p_osm_id is null and p_claimed_by is null and p_source <> 'community'
    and (p_rna_published_on is null
         or p_rna_published_on < (p_today - make_interval(years => (search.params()).dormant_years))::date)
$$;

-- Query normalisation (NFC, trim, single spaces, lower case, 200 chars) as in the app, then
-- tokens that look like contact details are dropped before a miss is stored.
create function search.anonymise_query(x text) returns text
language sql immutable
as $$
  select btrim(left(coalesce(string_agg(s.t, ' ' order by s.n), ''), 100))
  from regexp_split_to_table(
         left(lower(btrim(regexp_replace(normalize(coalesce(x, ''), nfc), '\s+', ' ', 'g'))), 200), ' '
       ) with ordinality as s(t, n)
  where s.t <> '' and s.t !~ '@' and s.t !~ '[0-9]{6,}'
$$;

revoke all on all functions in schema search from public, anon, authenticated;
-- Only what generated columns on API-writable tables evaluate as the inserting user.
grant usage on schema search to authenticated;
grant execute on function search.unaccent(text), search.normalise_name(text) to authenticated;
grant usage on schema search to service_role;

-- ---------------------------------------------------------------------------------------------
-- Town-level columns and full-text search

alter table public.associations
  add column town_point geography(Point, 4326)
    generated always as (ST_SnapToGrid(location::geometry, 0.01)::geography) stored,
  add column name_norm text generated always as (search.normalise_name(name)) stored,
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('french', search.unaccent(coalesce(name, ''))), 'A')
    || setweight(to_tsvector('french', search.unaccent(coalesce(purpose, ''))), 'B')) stored;
create index associations_town_point_gist on public.associations using gist (town_point);
create index associations_search_tsv_gin on public.associations using gin (search_tsv);

alter table public.activities
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('french', search.unaccent(coalesce(title, ''))), 'A')
    || setweight(to_tsvector('french', search.unaccent(coalesce(description, ''))), 'B')) stored;
create index activities_search_tsv_gin on public.activities using gin (search_tsv);

-- The API never exposes the exact address or position. Admin access to the address comes through
-- an admin RPC (sub-project 7).
revoke select on public.associations from anon, authenticated;
grant select (id, name, purpose, rna_id, osm_id, website, phone, email, opening_hours, confidence,
  likely_not_public, source, claimed_by, verified, locked_fields, attribution, created_by, created_at,
  updated_at, insee_code, postcode, city, rna_published_on, geocode_precision, last_import_run,
  town_point, name_norm)
  on public.associations to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Waiters: "Me prévenir quand ce club arrive"

create table public.association_waiters (
  association_id uuid not null references public.associations on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (association_id, user_id)
);
alter table public.association_waiters enable row level security;
revoke all on public.association_waiters from anon, authenticated;
grant select, insert, delete on public.association_waiters to authenticated;
create policy waiters_select_own on public.association_waiters for select to authenticated
  using (user_id = auth.uid());
create policy waiters_insert_own on public.association_waiters for insert to authenticated
  with check (user_id = auth.uid());
create policy waiters_delete_own on public.association_waiters for delete to authenticated
  using (user_id = auth.uid());
create policy waiters_admin on public.association_waiters for select to authenticated
  using (public.is_admin());

-- Search misses are aggregated per (query, area, day) by the service role.
alter table public.search_misses
  add column day date not null default current_date,
  add column hits int not null default 1;
-- The existing log was never aggregated: all rows now carry today's day, so collapse duplicates
-- into one row per (query, area) whose hits counts the rows merged.
with dup as (
  select min(id) as keep_id, count(*)::int as n
  from public.search_misses group by query, coalesce(area_label, '') having count(*) > 1
)
update public.search_misses m set hits = dup.n from dup where m.id = dup.keep_id;
delete from public.search_misses m
using public.search_misses k
where m.id > k.id and m.query = k.query and coalesce(m.area_label, '') = coalesce(k.area_label, '')
  and m.day = k.day;
create unique index search_misses_agg on public.search_misses (query, coalesce(area_label, ''), day);

-- ---------------------------------------------------------------------------------------------
-- Query embedding cache (service role only), pruned daily

create table public.query_embedding_cache (
  model text not null,
  query_norm text not null,
  embedding vector(384) not null,
  created_at timestamptz not null default now(),
  primary key (model, query_norm)
);
alter table public.query_embedding_cache enable row level security;
revoke all on public.query_embedding_cache from anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('prune-query-embedding-cache', '10 4 * * *',
  $$ delete from public.query_embedding_cache where created_at < now() - interval '60 days' $$);

-- ---------------------------------------------------------------------------------------------
-- Explore and search

-- Visible rows within p_radius_m of p_point after the filters, with their score. Search modes
-- (p_query not null) score and drop; browse (p_query null) returns score null and applies the
-- interest slugs. Candidates come from the GiST indexes first; similarity is only computed for
-- them (never the HNSW index: post-filtering by distance would lose results).
create function search.explore_rows(
  p_point geography, p_radius_m float8, p_query text, p_query_embedding extensions.vector,
  p_kinds text[], p_weekday smallint, p_newcomer_friendly boolean, p_interest_slugs text[]
) returns table (
  kind text, id uuid, distance_m float8, score smallint, keyword boolean, penalty int, is_new boolean,
  source_label text
)
language sql stable
set search_path = public, search, extensions, pg_temp
as $$
  with p as (
    select prm.*, search.normalise_name(p_query) as q_norm,
           case when p_query is not null
             then websearch_to_tsquery('french', search.unaccent(p_query)) end as tsq
    from search.params() prm
  ),
  assoc as (
    select 'association'::text as kind, a.id, ST_Distance(a.town_point, p_point) as distance_m,
           search.penalty(a.likely_not_public, a.confidence, a.source, a.verified) as penalty,
           false as is_new,
           search.is_dormant(a.website, a.osm_id, a.claimed_by, a.rna_published_on, a.source, current_date)
             as dormant,
           search.source_label(a.source, a.verified, a.confidence) as source_label,
           case when p_query is not null then word_similarity(p.q_norm, a.name_norm) end as name_sim,
           case when p_query is not null then a.search_tsv @@ p.tsq end as fts,
           case when p_query is not null then 1 - (a.embedding <=> p_query_embedding) end as sim
    from associations a, p
    where 'association' = any(p_kinds) and p_weekday is null and not p_newcomer_friendly
      and ST_DWithin(a.town_point, p_point, p_radius_m)
      and not search.is_hidden(a.confidence, a.source)
      and (p_query is not null or cardinality(p_interest_slugs) = 0
           or exists (select 1 from association_tags at join tags t on t.id = at.tag_id
                      where at.association_id = a.id and t.slug = any(p_interest_slugs)))
  ),
  act as (
    select 'activity'::text, x.id, ST_Distance(x.place, p_point), 0,
           x.published_at > now() - make_interval(days => p.new_days),
           false, null::text,
           case when p_query is not null then word_similarity(p.q_norm, search.normalise_name(x.title)) end,
           case when p_query is not null then x.search_tsv @@ p.tsq end,
           case when p_query is not null then 1 - (x.embedding <=> p_query_embedding) end
    from activities x, p
    where 'activity' = any(p_kinds)
      and ST_DWithin(x.place, p_point, p_radius_m)
      and x.archived_at is null and x.published_at <= now()
      and (auth.uid() is null or not public.is_blocked_between(x.organiser_id))
      and (not p_newcomer_friendly or x.newcomer_friendly)
      and (p_query is not null or cardinality(p_interest_slugs) = 0
           or exists (select 1 from activity_tags at join tags t on t.id = at.tag_id
                      where at.activity_id = x.id and t.slug = any(p_interest_slugs)))
      and (p_weekday is null or case x.recurrence_kind
             when 'weekly' then extract(isodow from x.start_date) = p_weekday
             when 'weekdays' then p_weekday = any(x.recurrence_weekdays)
             else true end)
  ),
  scored as (
    select c.*, k.keyword,
           case when p_query is not null then
             search.score(c.sim, k.keyword, coalesce(c.name_sim, 0), c.penalty, c.is_new) end as score,
           p.min_score, p.strong, p.name_sim as name_sim_min
    from (select * from assoc union all select * from act) c
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
  boolean, text[]) from public, anon, authenticated;

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
  p_limit int default 20, p_offset int default 0
) returns jsonb
language plpgsql volatile security definer
set search_path = public, search, extensions, pg_temp
-- JIT compiles the scoring expressions for ~450 ms of the scan over a 150k-row candidate set and
-- never pays back on this workload (measured: p95 1.6 s with it, 1.35 s without).
set jit = off
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
  v_mode := case when v_query is null then 'browse'
                 when p_query_embedding is not null then 'search' else 'keyword_only' end;
  if v_mode = 'browse' and cardinality(p_interest_category_ids) > 0 then
    select coalesce(array_agg(c.slug), '{}') into v_slugs
    from categories c
    where c.id = any(p_interest_category_ids) or c.parent_id = any(p_interest_category_ids);
    if cardinality(v_slugs) = 0 then v_slugs := '{""}'; end if;  -- unknown ids match nothing
  end if;

  with r as (
    select e.*, coalesce(e.score < prm.weak, false) as is_weak
    from search.explore_rows(v_point, p_radius_km * 1000.0, v_query,
           case when v_mode = 'search' then p_query_embedding end,
           p_kinds, p_weekday, coalesce(p_newcomer_friendly, false), v_slugs) e
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
    ) d
  )
  select coalesce((select jsonb_agg(item order by rn) from items), '[]'::jsonb),
         (select count(*) from ranked where score >= prm.strong),
         exists (select 1 from ranked where rn = p_offset + p_limit + 1)
    into v_results, v_strong, v_has_more;

  if v_mode <> 'browse' and v_strong < prm.widen_min and p_radius_km < 50 then
    select count(*) into v_strong_50
    from search.explore_rows(v_point, 50000, v_query,
           case when v_mode = 'search' then p_query_embedding end,
           p_kinds, p_weekday, coalesce(p_newcomer_friendly, false), v_slugs) e
    where e.score >= prm.strong;
    if v_strong_50 > v_strong then v_suggest := 50; end if;
  end if;

  if v_mode <> 'browse' and p_offset = 0 and v_strong = 0 then
    v_miss := search.anonymise_query(v_query);
    if char_length(v_miss) >= 2 then
      insert into search_misses (query, area_label, day)
      values (v_miss,
              (select a.city from associations a
               where a.city is not null and a.town_point is not null
               order by a.town_point <-> v_point limit 1),
              current_date)
      on conflict (query, (coalesce(area_label, '')), day)
        do update set hits = search_misses.hits + 1;
    end if;
  end if;

  return jsonb_build_object('mode', v_mode, 'results', v_results, 'strong_count', v_strong,
    'strong_count_50km', v_strong_50, 'suggest_radius_km', v_suggest, 'has_more', v_has_more);
end
$$;
revoke all on function public.search_explore(float8, float8, int, text, extensions.vector, text[], smallint,
  boolean, uuid[], text, int, int) from public;
grant execute on function public.search_explore(float8, float8, int, text, extensions.vector, text[], smallint,
  boolean, uuid[], text, int, int) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Association page. Never returns the address or exact position; the position is town_point.

create function public.get_association(p_id uuid) returns jsonb
language sql stable security definer
set search_path = public, search, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'purpose', a.purpose, 'city', a.city, 'postcode', a.postcode,
    'lon', ST_X(a.town_point::geometry), 'lat', ST_Y(a.town_point::geometry),
    'website', a.website, 'phone', a.phone, 'email', a.email, 'opening_hours', a.opening_hours,
    'source', a.source, 'verified', a.verified, 'claimed', a.claimed_by is not null,
    'source_label', search.source_label(a.source, a.verified, a.confidence),
    'attribution_keys', coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(a.attribution) k), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('slug', t.slug, 'label_fr', t.label_fr,
                                                          'label_en', t.label_en) order by t.slug)
                      from association_tags at join tags t on t.id = at.tag_id
                      where at.association_id = a.id), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title)
                                             order by x.start_date, x.id)
                            from activities x
                            where x.organised_by_association_id = a.id and x.archived_at is null), '[]'::jsonb),
    'can_wait', a.claimed_by is null and a.website is null and a.phone is null and a.email is null,
    'is_waiting', exists (select 1 from association_waiters w
                          where w.association_id = a.id and w.user_id = auth.uid())
  )
  from associations a
  where a.id = p_id and not search.is_hidden(a.confidence, a.source)
$$;
revoke all on function public.get_association(uuid) from public;
grant execute on function public.get_association(uuid) to anon, authenticated;
