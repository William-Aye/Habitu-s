-- Association directory import: staging schema, run log, new association columns.
-- (importer.apply_run is added in a later task.)

create schema importer;
revoke all on schema importer from public, anon, authenticated;

alter table public.associations
  add column insee_code text,
  add column rna_published_on date,
  add column geocode_precision text check (geocode_precision in ('address', 'municipality', 'osm')),
  add column embedding_hash text,
  add column last_import_run uuid;
create index associations_insee_code on public.associations (insee_code);

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  scope text[],  -- null = all of France
  counts jsonb not null default '{}',
  error text
);
alter table public.import_runs enable row level security;
revoke all on public.import_runs from anon, authenticated;
grant select on public.import_runs to authenticated;
create policy import_runs_admin_select on public.import_runs
  for select to authenticated using (public.is_admin());

create table importer.staged_rna (
  run_id uuid not null,
  rna_id text not null,
  name text not null,
  purpose text,
  address text,
  insee_code text,
  location extensions.geography(Point, 4326),
  geocode_precision text,
  website text,
  published_on date,
  likely_not_public boolean not null,
  tag_slugs text[] not null default '{}',
  embedding extensions.vector(384),
  embedding_hash text not null,
  primary key (run_id, rna_id)
);

create table importer.staged_osm (
  run_id uuid not null,
  osm_id text not null,  -- e.g. node/123, way/456
  name text not null,
  location extensions.geography(Point, 4326) not null,
  insee_code text,
  website text,
  phone text,
  email text,
  opening_hours text,
  tag_slugs text[] not null default '{}',
  embedding extensions.vector(384),
  embedding_hash text not null,
  primary key (run_id, osm_id)
);

create table importer.geocode_cache (
  address_key text primary key,
  lon double precision,
  lat double precision,
  score real,
  precision text,
  created_at timestamptz default now()
);

revoke all on all tables in schema importer from public, anon, authenticated;
alter table importer.staged_rna enable row level security;
alter table importer.staged_osm enable row level security;
alter table importer.geocode_cache enable row level security;

create function importer.normalise_name(x text) returns text
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(x, ''))),
        '[^a-z0-9]+', ' ', 'g'),
      '(^| )(association|asso|club|amicale|l|d|de|des|du|la|le|les)(?= |$)', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

create function importer.confidence(
  p_published date, p_website boolean, p_in_osm boolean, p_claimed_verified boolean, p_today date
) returns smallint
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select (20
    + case when p_published is not null and p_published >= p_today - interval '5 years' then 20 else 0 end
    + case when coalesce(p_website, false) then 20 else 0 end
    + case when coalesce(p_in_osm, false) then 25 else 0 end
    + case when coalesce(p_claimed_verified, false) then 15 else 0 end)::smallint
$$;

revoke all on function importer.normalise_name(text) from public, anon, authenticated;
revoke all on function importer.confidence(date, boolean, boolean, boolean, date) from public, anon, authenticated;
