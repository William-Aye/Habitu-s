-- Explore and search: scoring helpers, town-level columns, waiters and the query-embedding cache.
-- Deploy note: the stored generated columns added below rewrite `associations` (~1.5 M rows) and
-- hold an ACCESS EXCLUSIVE lock while they do; apply this migration to the hosted project when
-- no directory import is running.

create schema search;
revoke all on schema search from public, anon, authenticated;

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
create function search.params(
  out sim_floor float8, out sim_ceil float8, out keyword_boost int, out strong int, out weak int,
  out min_score int, out tie_window int, out name_sim real, out penalty_not_public int,
  out penalty_low_confidence int, out penalty_community int, out new_boost int, out new_days int,
  out hidden_below int, out low_confidence int, out dormant_years int, out widen_min int,
  out max_limit int, out max_offset int
) language sql immutable
as $$ select 0.75::float8, 0.88::float8, 8, 70, 50, 15, 5, 0.6::real, 15, 10, 10, 5, 14, 20, 50, 10, 5, 50, 500 $$;

-- Score before penalty and Nouvelle boost; unclamped above (similarity 1 + keyword gives 108).
create function search.base_score(p_sim float8, p_keyword boolean, p_name_sim real) returns float8
language sql immutable
as $$
  select case
    when p_sim is not null then
      least(greatest((p_sim - p.sim_floor) / (p.sim_ceil - p.sim_floor), 0), 1) * 100
        + case when p_keyword then p.keyword_boost else 0 end
    when p_keyword then 60 + 30 * p_name_sim
    else 0 end
  from search.params() p
$$;

create function search.score(
  p_sim float8, p_keyword boolean, p_name_sim real, p_penalty int, p_is_new boolean
) returns smallint
language sql immutable
as $$
  select round(least(greatest(
    search.base_score(p_sim, p_keyword, p_name_sim) - p_penalty
      + case when p_is_new then p.new_boost else 0 end, 0), 100)::numeric)::smallint
  from search.params() p
$$;

create function search.penalty(
  p_likely_not_public boolean, p_confidence smallint, p_source text, p_verified boolean
) returns int
language sql immutable
as $$
  select case when p_likely_not_public then p.penalty_not_public else 0 end
    + case when p_source = 'community' and not coalesce(p_verified, false) then p.penalty_community
           when p_confidence < p.low_confidence then p.penalty_low_confidence
           else 0 end
  from search.params() p
$$;

create function search.is_hidden(p_confidence smallint, p_source text) returns boolean
language sql immutable
as $$ select p_source <> 'community' and p_confidence < p.hidden_below from search.params() p $$;

create function search.is_dormant(
  p_website text, p_osm_id text, p_claimed_by uuid, p_rna_published_on date, p_source text, p_today date
) returns boolean
language sql immutable
as $$
  select p_website is null and p_osm_id is null and p_claimed_by is null and p_source <> 'community'
    and (p_rna_published_on is null
         or p_rna_published_on < (p_today - make_interval(years => p.dormant_years))::date)
  from search.params() p
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
