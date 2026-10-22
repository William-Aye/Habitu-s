-- Association directory import: staging schema, run log, new association columns.
-- importer.apply_run (end of file) merges one staged run into the live tables in a single transaction.

create schema importer;
revoke all on schema importer from public, anon, authenticated;

alter table public.associations
  add column insee_code text,
  add column postcode text,
  add column city text,
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
  postcode text,
  city text,
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
  likely_not_public boolean not null default false,
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

-- ---------------------------------------------------------------------------------------------
-- Merge of one import run. Everything below runs inside the caller's transaction: any error
-- rolls back every change to live data.

-- Département of an INSEE commune code ('69123' -> '69', '2A004' -> '2A', '97105' -> '971').
-- departement and in_scope run once per listing (~1.5M rows), so they are inlinable: no
-- `set search_path` (it blocks inlining); every name is schema-qualified instead.
create function importer.departement(p_insee text) returns text
language sql immutable
as $$
  select case when p_insee is null then null
              when p_insee operator(pg_catalog.~~) '97%' then pg_catalog.left(p_insee, 3)
              else pg_catalog.left(p_insee, 2) end
$$;

-- Same position within 1e-7 degree (~1 cm): a point read back from the geocode cache can differ
-- from the freshly geocoded one in the last bit, which must not count as a change.
create function importer.same_point(a extensions.geography, b extensions.geography) returns boolean
language sql immutable
as $$
  select (a is null and b is null)
      or (a is not null and b is not null
          and pg_catalog.abs(extensions.st_x(a::extensions.geometry) operator(pg_catalog.-)
                             extensions.st_x(b::extensions.geometry)) operator(pg_catalog.<) 1e-7
          and pg_catalog.abs(extensions.st_y(a::extensions.geometry) operator(pg_catalog.-)
                             extensions.st_y(b::extensions.geometry)) operator(pg_catalog.<) 1e-7)
$$;

-- null scope = all of France; otherwise a listing without a known département is out of scope.
create function importer.in_scope(p_insee text, p_scope text[]) returns boolean
language sql immutable
as $$
  select p_scope is null
      or coalesce(importer.departement(p_insee) operator(pg_catalog.=) any (p_scope), false)
$$;

-- Greedy one-to-one pairing over pg_temp._ar_cand(l, r, sim, dist) into pg_temp._ar_pairs(l, r):
-- repeatedly keep the pairs that are each other's best (highest similarity, then shortest
-- distance, ids as tie-break), then drop every candidate that reuses a paired side. The global
-- best pair is always mutual, so each round makes progress.
create function importer.pick_pairs() returns void
language plpgsql
set search_path = public, importer, extensions, pg_temp
as $$
begin
  loop
    with ranked as (
      select l, r,
             row_number() over (partition by l order by sim desc, dist, r) as rank_l,
             row_number() over (partition by r order by sim desc, dist, l) as rank_r
      from pg_temp._ar_cand)
    insert into pg_temp._ar_pairs (l, r)
    select l, r from ranked where rank_l = 1 and rank_r = 1;
    exit when not found;
    delete from pg_temp._ar_cand c
     where exists (select 1 from pg_temp._ar_pairs p where p.l = c.l or p.r = c.r);
  end loop;
end $$;

-- Fold listing p_from into p_into: carry over the claim, verification, locks and locked values
-- (when p_from is claimed), repoint activities and claims, delete p_from. Refuses (returns false)
-- when both rows are claimed by different people.
create function importer.merge_into(p_from uuid, p_into uuid) returns boolean
language plpgsql
set search_path = public, importer, extensions, pg_temp
as $$
declare
  f public.associations;
  t public.associations;
begin
  select * into strict f from public.associations where id = p_from;
  select * into strict t from public.associations where id = p_into;
  if f.claimed_by is not null and t.claimed_by is not null and f.claimed_by <> t.claimed_by then
    return false;
  end if;
  if f.claimed_by is not null then
    update public.associations a set
      claimed_by = f.claimed_by,
      verified = f.verified or a.verified,
      locked_fields = array(select distinct x from unnest(a.locked_fields || f.locked_fields) x order by x),
      name = case when 'name' = any(f.locked_fields) then f.name else a.name end,
      purpose = case when 'purpose' = any(f.locked_fields) then f.purpose else a.purpose end,
      address = case when 'address' = any(f.locked_fields) then f.address else a.address end,
      postcode = case when 'address' = any(f.locked_fields) then f.postcode else a.postcode end,
      city = case when 'address' = any(f.locked_fields) then f.city else a.city end,
      location = case when 'location' = any(f.locked_fields) then f.location else a.location end,
      geocode_precision = case when 'location' = any(f.locked_fields) then f.geocode_precision
                               else a.geocode_precision end,
      website = case when 'website' = any(f.locked_fields) then f.website else a.website end,
      phone = case when 'phone' = any(f.locked_fields) then f.phone else a.phone end,
      email = case when 'email' = any(f.locked_fields) then f.email else a.email end,
      opening_hours = case when 'opening_hours' = any(f.locked_fields) then f.opening_hours
                           else a.opening_hours end,
      likely_not_public = case when 'likely_not_public' = any(f.locked_fields) then f.likely_not_public
                               else a.likely_not_public end
    where a.id = p_into;
  end if;
  update public.activities set organised_by_association_id = p_into where organised_by_association_id = p_from;
  update public.association_claims set association_id = p_into where association_id = p_from;
  delete from public.associations where id = p_from;
  return true;
end $$;

-- A monthly run sees ~1.5M listings, most of them unchanged: every write below only touches a row
-- whose values actually change (an unchanged row keeps its tuple, last_import_run and updated_at).
-- "Rows of this run" (the RNA rows of the scope and the OSM-only rows refreshed by it) are kept
-- in pg_temp._ar_rows for the later steps.
create function importer.apply_run(p_run uuid, p_scope text[]) returns jsonb
language plpgsql security definer
set search_path = public, importer, extensions, pg_temp
as $$
declare
  c_rna constant jsonb := '{"rna": "Licence Ouverte / Etalab 2.0"}';
  c_osm constant jsonb := '{"osm": "© OpenStreetMap contributors, ODbL 1.0"}';
  -- Null scope: a département with at least this many live RNA listings must have staged rows.
  c_guard_min constant int := 50;
  v_inserted int := 0;
  v_updated int := 0;
  v_osm_matched int := 0;
  v_osm_only int := 0;
  v_community int := 0;
  v_removed int := 0;
  v_kept int := 0;
  v_unlinked int := 0;
  v_downgraded int := 0;
  v_osm_staged boolean;
  v_missing text;
  v_live bigint;
  v_counts jsonb;
  m record;
begin
  -- One merge at a time; the run must exist, be running and have RNA rows staged (an empty
  -- staging table would otherwise read as "every listing in scope was dissolved").
  perform pg_advisory_xact_lock(hashtext('importer.apply_run'));
  perform 1 from import_runs where id = p_run and status = 'running' for update;
  if not found then
    raise exception 'import run % not found or not running', p_run;
  end if;
  -- Every département of the scope must have staged RNA rows: a département whose download
  -- failed would otherwise read as "every listing there was dissolved".
  if p_scope is not null and cardinality(p_scope) = 0 then
    raise exception 'import run %: empty scope array (use null for all of France)', p_run;
  end if;
  if p_scope is null then
    if not exists (select 1 from staged_rna where run_id = p_run) then
      raise exception 'import run % has no staged RNA rows; refusing to merge', p_run;
    end if;
    -- All of France: every département that has a real number of live RNA listings must
    -- still have staged rows (listings kept at confidence 0 are not expected in the source).
    select e.d, e.n into v_missing, v_live
    from (select importer.departement(a.insee_code) as d, count(*) as n
          from associations a
          where a.rna_id is not null and a.confidence > 0 and a.insee_code is not null
          group by 1
          having count(*) >= c_guard_min) e
    where e.d not in (select distinct importer.departement(s.insee_code) from staged_rna s
                      where s.run_id = p_run and s.insee_code is not null)
    order by e.d
    limit 1;
    if found then
      raise exception 'import run %: no staged RNA rows for département % (% live listings); refusing to merge',
        p_run, v_missing, v_live;
    end if;
  else
    select d into v_missing
    from unnest(p_scope) d
    where not exists (select 1 from staged_rna s
                      where s.run_id = p_run and importer.departement(s.insee_code) = d)
    limit 1;
    if found then
      raise exception 'import run %: no staged RNA rows for département %; refusing to merge', p_run, v_missing;
    end if;
  end if;

  drop table if exists pg_temp._ar_osm, pg_temp._ar_match, pg_temp._ar_cand, pg_temp._ar_pairs,
                       pg_temp._ar_gone, pg_temp._ar_rows, pg_temp._ar_want;
  create temp table _ar_cand (l text not null, r uuid not null, sim real not null, dist float8 not null)
    on commit drop;
  create temp table _ar_pairs (l text not null, r uuid not null) on commit drop;
  create temp table _ar_rows (id uuid primary key) on commit drop;

  -- 1. Tags mirror categories.
  insert into tags (slug, label_fr, label_en)
  select slug, name_fr, name_en from categories
  on conflict (slug) do nothing;

  -- 2. Upsert RNA rows (in scope only; never an existing row outside the scope). Locked
  -- columns keep their value. The new values are computed against the existing row (e), and
  -- the update only happens when they differ from it.
  with up as (
    insert into associations as a (
      rna_id, name, purpose, address, postcode, city, insee_code, location, geocode_precision, website,
      rna_published_on, likely_not_public, embedding, embedding_hash, source, attribution, last_import_run)
    select s.rna_id,
      case when 'name' = any(e.locked_fields) then e.name else s.name end,
      case when 'purpose' = any(e.locked_fields) then e.purpose else s.purpose end,
      case when 'address' = any(e.locked_fields) then e.address else s.address end,
      -- postcode and city belong to the address.
      case when 'address' = any(e.locked_fields) or 'postcode' = any(e.locked_fields) then e.postcode
           else s.postcode end,
      case when 'address' = any(e.locked_fields) or 'city' = any(e.locked_fields) then e.city else s.city end,
      case when 'insee_code' = any(e.locked_fields) then e.insee_code else s.insee_code end,
      case when k.keep_location then e.location else s.location end,
      case when k.keep_location then e.geocode_precision else s.geocode_precision end,
      case when 'website' = any(e.locked_fields) then e.website
           -- A listing linked to OSM keeps the website step 3 took from the feature, unless the
           -- staged feature now has another one (step 3 then refills it).
           when s.website is null and e.source = 'rna+osm'
                and not exists (select 1 from staged_osm o
                                where o.run_id = p_run and o.osm_id = e.osm_id
                                  and o.website is distinct from e.website)
             then e.website
           else s.website end,
      case when 'rna_published_on' = any(e.locked_fields) then e.rna_published_on else s.published_on end,
      case when 'likely_not_public' = any(e.locked_fields) then e.likely_not_public else s.likely_not_public end,
      coalesce(s.embedding, e.embedding),
      case when s.embedding is not null then s.embedding_hash else e.embedding_hash end,
      case when e.source = 'rna+osm' then 'rna+osm' else 'rna' end,
      coalesce(e.attribution, '{}') || c_rna,
      p_run
    from staged_rna s
    left join associations e on e.rna_id = s.rna_id
    cross join lateral (select coalesce(
      'location' = any(e.locked_fields) or 'geocode_precision' = any(e.locked_fields)
      -- Geocoding failed this month: keep the previous position.
      or s.location is null
      -- Linked to an OSM feature: step 3 places it on the feature.
      or (e.osm_id is not null and e.geocode_precision = 'osm')
      -- Only the commune was found this month for an address that was found before.
      or (s.geocode_precision = 'municipality' and e.geocode_precision = 'address'
          and s.address is not distinct from e.address and s.insee_code is not distinct from e.insee_code),
      false) as keep_location) k
    where s.run_id = p_run and importer.in_scope(s.insee_code, p_scope)
    on conflict (rna_id) do update set
      name = excluded.name, purpose = excluded.purpose, address = excluded.address,
      postcode = excluded.postcode, city = excluded.city, insee_code = excluded.insee_code,
      location = excluded.location, geocode_precision = excluded.geocode_precision,
      website = excluded.website, rna_published_on = excluded.rna_published_on,
      likely_not_public = excluded.likely_not_public, embedding = excluded.embedding,
      embedding_hash = excluded.embedding_hash, source = excluded.source,
      attribution = excluded.attribution, last_import_run = p_run
    where importer.in_scope(a.insee_code, p_scope)
      and ((a.name, a.purpose, a.address, a.postcode, a.city, a.insee_code,
            a.geocode_precision, a.website, a.rna_published_on, a.likely_not_public, a.embedding_hash,
            a.source, a.attribution)
           is distinct from
           (excluded.name, excluded.purpose, excluded.address, excluded.postcode, excluded.city,
            excluded.insee_code, excluded.geocode_precision, excluded.website,
            excluded.rna_published_on, excluded.likely_not_public, excluded.embedding_hash,
            excluded.source, excluded.attribution)
           or not importer.same_point(a.location, excluded.location))
    returning (xmax = 0) as is_insert
  )
  select count(*) filter (where is_insert), count(*) filter (where not is_insert)
    into v_inserted, v_updated
  from up;

  insert into _ar_rows (id)
  select a.id
  from staged_rna s join associations a on a.rna_id = s.rna_id
  where s.run_id = p_run and importer.in_scope(s.insee_code, p_scope) and importer.in_scope(a.insee_code, p_scope);

  -- 3a. Place OSM features in a département: nearest listing with an INSEE code within 5 km.
  update staged_osm o set insee_code = (
    select a.insee_code from associations a
    where a.insee_code is not null and ST_DWithin(a.location, o.location, 5000)
    order by a.location <-> o.location
    limit 1)
  where o.run_id = p_run and o.insee_code is null;

  create temp table _ar_osm on commit drop as
  select * from staged_osm o
  where o.run_id = p_run and importer.in_scope(o.insee_code, p_scope);
  -- No OSM staged for the scope (e.g. a failed Overpass extract): never unlink or remove
  -- anything on the OSM side.
  v_osm_staged := exists (select 1 from _ar_osm);

  -- Stale links: an RNA row of this run whose OSM feature is no longer mapped loses the link
  -- (and goes back to its geocoded position).
  if v_osm_staged then
    update associations a set osm_id = null, source = 'rna', attribution = a.attribution - 'osm',
      location = case when 'location' = any(a.locked_fields) or s.location is null then a.location
                      else s.location end,
      geocode_precision = case when 'location' = any(a.locked_fields) or s.location is null
                               then a.geocode_precision else s.geocode_precision end,
      last_import_run = p_run
    from _ar_rows r, staged_rna s
    where a.id = r.id and s.run_id = p_run and s.rna_id = a.rna_id and a.source = 'rna+osm'
      and not exists (select 1 from staged_osm o where o.run_id = p_run and o.osm_id = a.osm_id);
    get diagnostics v_unlinked = row_count;
  end if;

  -- 3. Match OSM -> RNA rows of this run. A feature already linked to such a row stays linked.
  create temp table _ar_match (osm_id text primary key, assoc_id uuid not null unique) on commit drop;
  insert into _ar_match (osm_id, assoc_id)
  select o.osm_id, a.id
  from _ar_osm o join associations a on a.osm_id = o.osm_id join _ar_rows r on r.id = a.id
  where a.source in ('rna', 'rna+osm');

  insert into _ar_cand (l, r, sim, dist)
  select o.osm_id, a.id,
         similarity(importer.normalise_name(a.name), importer.normalise_name(o.name)),
         ST_Distance(a.location, o.location)
  from _ar_osm o
  join associations a on ST_DWithin(a.location, o.location, 300)
  join _ar_rows r on r.id = a.id
  where a.source in ('rna', 'rna+osm')
    and not exists (select 1 from _ar_match x where x.osm_id = o.osm_id or x.assoc_id = a.id)
    and similarity(importer.normalise_name(a.name), importer.normalise_name(o.name)) >= 0.6;
  perform importer.pick_pairs();
  insert into _ar_match (osm_id, assoc_id) select l, r::uuid from _ar_pairs;

  -- A newly matched feature may already be held by another listing: an in-scope OSM-only
  -- listing is folded into the RNA row; an in-scope RNA listing absent from this run releases
  -- it; anything else (out of scope, conflicting claims) cancels the match.
  for m in
    select x.osm_id, x.assoc_id, h.id as holder_id, h.source as holder_source, h.insee_code as holder_insee
    from _ar_match x join associations h on h.osm_id = x.osm_id and h.id <> x.assoc_id
  loop
    if not importer.in_scope(m.holder_insee, p_scope) then
      delete from _ar_match where osm_id = m.osm_id;
    elsif m.holder_source in ('rna', 'rna+osm') then
      update associations a set osm_id = null, source = 'rna', attribution = a.attribution - 'osm',
        confidence = importer.confidence(a.rna_published_on, a.website is not null, false,
                                         a.claimed_by is not null and a.verified, current_date)
      where a.id = m.holder_id;
    elsif m.holder_source <> 'osm' or not importer.merge_into(m.holder_id, m.assoc_id) then
      delete from _ar_match where osm_id = m.osm_id;
    end if;
  end loop;
  select count(*) into v_osm_matched from _ar_match;

  update associations a set
    osm_id = v.osm_id, source = 'rna+osm', phone = v.phone, email = v.email,
    opening_hours = v.opening_hours, website = v.website, location = v.location,
    geocode_precision = v.geocode_precision, attribution = v.attribution, last_import_run = p_run
  from (
    select b.id, o.osm_id,
      case when b.phone is null and not 'phone' = any(b.locked_fields) then o.phone else b.phone end as phone,
      case when b.email is null and not 'email' = any(b.locked_fields) then o.email else b.email end as email,
      case when b.opening_hours is null and not 'opening_hours' = any(b.locked_fields)
           then o.opening_hours else b.opening_hours end as opening_hours,
      case when b.website is null and not 'website' = any(b.locked_fields) then o.website
           else b.website end as website,
      case when 'location' = any(b.locked_fields) then b.location else o.location end as location,
      case when 'location' = any(b.locked_fields) then b.geocode_precision else 'osm' end as geocode_precision,
      b.attribution || c_osm as attribution
    from _ar_match x join _ar_osm o on o.osm_id = x.osm_id join associations b on b.id = x.assoc_id
  ) v
  where a.id = v.id
    and ((a.osm_id, a.source, a.phone, a.email, a.opening_hours, a.website, a.geocode_precision,
          a.attribution)
         is distinct from
         (v.osm_id, 'rna+osm', v.phone, v.email, v.opening_hours, v.website, v.geocode_precision,
          v.attribution)
         or not importer.same_point(a.location, v.location));

  -- An in-scope rna+osm listing whose RNA record disappeared but whose OSM feature is still
  -- mapped (and unmatched) lives on as an OSM listing; step 4 then refreshes it.
  update associations a set source = 'osm', rna_id = null, rna_published_on = null,
         attribution = a.attribution - 'rna', last_import_run = p_run
  from _ar_osm o
  where a.osm_id = o.osm_id and a.source = 'rna+osm' and importer.in_scope(a.insee_code, p_scope)
    and not exists (select 1 from staged_rna s where s.run_id = p_run and s.rna_id = a.rna_id)
    and not exists (select 1 from _ar_match x where x.osm_id = o.osm_id);
  get diagnostics v_downgraded = row_count;

  -- 4. OSM-only features. An existing row with the same osm_id is refreshed only if it is an
  -- in-scope OSM-only listing, and only when something changed.
  insert into associations as a (
    osm_id, name, location, insee_code, geocode_precision, website, phone, email, opening_hours,
    likely_not_public, embedding, embedding_hash, source, attribution, last_import_run)
  select o.osm_id,
    case when 'name' = any(e.locked_fields) then e.name else o.name end,
    case when 'location' = any(e.locked_fields) then e.location else o.location end,
    case when 'location' = any(e.locked_fields) or o.insee_code is null then e.insee_code
         else o.insee_code end,
    coalesce(e.geocode_precision, 'osm'),
    case when 'website' = any(e.locked_fields) then e.website else o.website end,
    case when 'phone' = any(e.locked_fields) then e.phone else o.phone end,
    case when 'email' = any(e.locked_fields) then e.email else o.email end,
    case when 'opening_hours' = any(e.locked_fields) then e.opening_hours else o.opening_hours end,
    case when 'likely_not_public' = any(e.locked_fields) then e.likely_not_public else o.likely_not_public end,
    coalesce(o.embedding, e.embedding),
    case when o.embedding is not null then o.embedding_hash else e.embedding_hash end,
    'osm',
    coalesce(e.attribution, '{}') || c_osm,
    p_run
  from _ar_osm o
  left join associations e on e.osm_id = o.osm_id
  where not exists (select 1 from _ar_match x where x.osm_id = o.osm_id)
  on conflict (osm_id) do update set
    name = excluded.name, location = excluded.location, insee_code = excluded.insee_code,
    website = excluded.website, phone = excluded.phone, email = excluded.email,
    opening_hours = excluded.opening_hours, likely_not_public = excluded.likely_not_public,
    embedding = excluded.embedding, embedding_hash = excluded.embedding_hash,
    attribution = excluded.attribution, last_import_run = p_run
  where a.source = 'osm' and importer.in_scope(a.insee_code, p_scope)
    and ((a.name, a.insee_code, a.website, a.phone, a.email, a.opening_hours,
          a.likely_not_public, a.embedding_hash, a.attribution)
         is distinct from
         (excluded.name, excluded.insee_code, excluded.website, excluded.phone,
          excluded.email, excluded.opening_hours, excluded.likely_not_public, excluded.embedding_hash,
          excluded.attribution)
         or not importer.same_point(a.location, excluded.location));

  insert into _ar_rows (id)
  select a.id
  from _ar_osm o join associations a on a.osm_id = o.osm_id
  where a.source = 'osm' and importer.in_scope(a.insee_code, p_scope)
    and not exists (select 1 from _ar_match x where x.osm_id = o.osm_id)
  on conflict (id) do nothing;
  get diagnostics v_osm_only = row_count;

  -- 5. Community listings that duplicate an imported listing of this run are folded into it.
  -- A community row without an INSEE code takes the département of its nearest coded listing.
  truncate _ar_cand, _ar_pairs;
  insert into _ar_cand (l, r, sim, dist)
  select c.id::text, a.id,
         similarity(importer.normalise_name(a.name), importer.normalise_name(c.name)),
         ST_Distance(a.location, c.location)
  from associations c
  join associations a on ST_DWithin(a.location, c.location, 300)
  join _ar_rows r on r.id = a.id
  where c.source = 'community'
    and a.source in ('rna', 'rna+osm', 'osm')
    and similarity(importer.normalise_name(a.name), importer.normalise_name(c.name)) >= 0.6
    and importer.in_scope(coalesce(c.insee_code, (
          select n.insee_code from associations n
          where n.insee_code is not null and n.id <> c.id and ST_DWithin(n.location, c.location, 5000)
          order by n.location <-> c.location
          limit 1)), p_scope);
  perform importer.pick_pairs();
  for m in select l::uuid as from_id, r as into_id from _ar_pairs loop
    if importer.merge_into(m.from_id, m.into_id) then
      v_community := v_community + 1;
    end if;
  end loop;

  -- 6. Imported listings in scope that are no longer published: delete, unless claimed or
  -- referenced by an activity (then confidence 0). OSM-only rows are only considered when OSM
  -- data was staged for the scope.
  create temp table _ar_gone on commit drop as
  select a.id,
         (a.claimed_by is not null
          or exists (select 1 from activities x where x.organised_by_association_id = a.id)) as keep
  from associations a
  where importer.in_scope(a.insee_code, p_scope)
    and ((a.source in ('rna', 'rna+osm')
          and not exists (select 1 from staged_rna s where s.run_id = p_run and s.rna_id = a.rna_id))
      or (v_osm_staged and a.source = 'osm'
          and not exists (select 1 from staged_osm s where s.run_id = p_run and s.osm_id = a.osm_id)));
  delete from associations a using _ar_gone g where a.id = g.id and not g.keep;
  get diagnostics v_removed = row_count;
  update associations a set confidence = 0 from _ar_gone g where a.id = g.id and g.keep and a.confidence <> 0;
  select count(*) into v_kept from _ar_gone where keep;

  -- 7. Tags of this run's rows = staged slugs (RNA + OSM); unknown slugs are ignored. Only the
  -- difference is written.
  create temp table _ar_want on commit drop as
  select distinct a.id as association_id, t.id as tag_id
  from _ar_rows r
  join associations a on a.id = r.id
  join lateral (
    select unnest(s.tag_slugs) as slug from staged_rna s where s.run_id = p_run and s.rna_id = a.rna_id
    union
    select unnest(o.tag_slugs) from staged_osm o where o.run_id = p_run and o.osm_id = a.osm_id
  ) sl on true
  join tags t on t.slug = sl.slug;
  delete from association_tags t using _ar_rows r
  where t.association_id = r.id
    and not exists (select 1 from _ar_want w where w.association_id = t.association_id and w.tag_id = t.tag_id);
  insert into association_tags (association_id, tag_id)
  select w.association_id, w.tag_id from _ar_want w
  where not exists (select 1 from association_tags t
                    where t.association_id = w.association_id and t.tag_id = w.tag_id);

  -- 8. Confidence of this run's rows, where it changes.
  update associations a set confidence = importer.confidence(
    a.rna_published_on, a.website is not null, a.osm_id is not null, a.claimed_by is not null and a.verified,
    current_date)
  from _ar_rows r
  where a.id = r.id
    and a.confidence <> importer.confidence(a.rna_published_on, a.website is not null, a.osm_id is not null,
                                            a.claimed_by is not null and a.verified, current_date);

  -- 9. Clean up staging and close the run.
  delete from staged_rna where run_id = p_run;
  delete from staged_osm where run_id = p_run;
  v_counts := jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'osm_matched', v_osm_matched, 'osm_only', v_osm_only,
    'community_merged', v_community, 'removed', v_removed, 'kept_dissolved', v_kept,
    'osm_unlinked', v_unlinked, 'downgraded_to_osm', v_downgraded, 'osm_removal_skipped', not v_osm_staged);
  update import_runs set status = 'succeeded', finished_at = now(), counts = v_counts where id = p_run;
  return v_counts;
end $$;

revoke all on function importer.departement(text) from public, anon, authenticated;
revoke all on function importer.in_scope(text, text[]) from public, anon, authenticated;
revoke all on function importer.same_point(extensions.geography, extensions.geography) from public, anon, authenticated;
revoke all on function importer.pick_pairs() from public, anon, authenticated;
revoke all on function importer.merge_into(uuid, uuid) from public, anon, authenticated;
revoke all on function importer.apply_run(uuid, text[]) from public, anon, authenticated;
grant usage on schema importer to service_role;
grant execute on function importer.apply_run(uuid, text[]) to service_role;
