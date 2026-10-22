# Explore and Search (Sub-project 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone, with or without an account, can search activities and associations near them by meaning ("coder" finds "Atelier Arduino") and by French keywords, see results ranked by the spec's rules in a list or on a map, open an association page, and ask "Me prévenir quand ce club arrive".

**Architecture:** The query text is embedded by a Supabase Edge Function (`embed-query`, Transformers.js running the same `multilingual-e5-small` model as the importer, prefix `"query: "`), with a database cache of recent queries. All ranking happens in **one** security-definer SQL function, `public.search_explore(...)`, callable by `anon`, which filters by radius, scores (semantic + full-text + penalties + "Nouvelle" boost), hides hidden/dormant listings, paginates, logs anonymised misses and returns JSON with public columns only. If the embedding is unavailable the same function runs in keyword-only mode. The app (Explore tab, association page) calls only these two endpoints plus `public.get_association(id)`; the map is MapLibre with OpenFreeMap tiles.

**Tech Stack:** Supabase Postgres (pgvector, PostGIS, pg_trgm, unaccent, French text search, pg_cron), pgTAP; Supabase Edge Functions (Deno) with `@huggingface/transformers` 3.x and `Xenova/multilingual-e5-small` (q8 ONNX); Python 3.12 + pytest in `importer/` for the ranking test set (reuses `E5Embedder`); Expo + expo-router, `expo-location`, `@maplibre/maplibre-react-native`, i18next, Lucide, Jest + Testing Library.

**Spec:** `docs/specs/2026-10-21-friend-app-design.md` — sections 6 (search and ranking), 8 (Explore tab, club/association page), 12 (location refused), 13 (search ranking tests), 14 Release 1 item 3, 17 ("Me prévenir quand ce club arrive", dormant listings). Builds on `docs/plans/2026-10-21-foundation.md` and `docs/plans/2026-10-22-association-directory.md`.

## Decisions for the owner to confirm

1. **Query embedding — Edge Function with Transformers.js (recommended).** `supabase/functions/embed-query` loads `Xenova/multilingual-e5-small` (q8 ONNX, ~118 MB) lazily and caches results in `public.query_embedding_cache`. Free within Supabase Pro quotas, no extra service. Risk: cold start and the Edge memory/CPU limits; Task 4 is a **go/no-go spike** (cold ≤ 8 s, warm p50 ≤ 300 ms, cosine ≥ 0.99 against the importer's Python model). If it fails, fallback is the same HTTP contract served by Google Cloud Run (Paris, `europe-west9`, scale to zero, free tier) running sentence-transformers. Supabase's built-in `gte-small` is a different model and is **never** used. On-device embedding was rejected (+120 MB app size). *Owner to confirm: Edge Function first, Cloud Run as fallback.*
2. **Map — MapLibre + OpenFreeMap (recommended).** `@maplibre/maplibre-react-native` with the free, keyless OpenFreeMap "liberty" style (`https://tiles.openfreemap.org/styles/liberty`), attribution kept visible ("© OpenMapTiles © OpenStreetMap contributors"). No Google account, API key or billing, and the same style works on the web later (sub-project 8). `tile.openstreetmap.org` is not used (its usage policy forbids app traffic). *Owner to confirm: MapLibre + OpenFreeMap.*
3. **API shape — one security-definer function (recommended).** `public.search_explore(...) returns jsonb` (results + counts for the divider and widen banner, paginated by `limit`/`offset`), plus `public.get_association(id) returns jsonb` for the page. Direct table reads of `associations.address` and `associations.location` are revoked from API roles so town-level is the only precision anyone gets. *Owner to confirm: single RPC + page RPC, and the column revoke.*
4. **Initial thresholds (tuned only through the ranking test set in Task 5):** semantic similarity mapped linearly from 0.75 → 0 % to 0.88 → 100 %; exact keyword boost +8; strong match ≥ 70 ("Très pertinent"); "Moins proche de votre recherche" divider below 50; results below 15 dropped unless they hit a keyword; tie-break window 5 points (same 5-point band → nearer first); name match = trigram word similarity ≥ 0.6; penalties −15 `likely_not_public`, −10 confidence < 50, −10 unchecked community (instead of the confidence one); "Nouvelle" +5 for activities published < 14 days ago; widen suggestion when fewer than 5 strong results and more exist at 50 km. *Owner to confirm the starting values.*

## Global Constraints

- **Radius values:** 5 / 10 / 25 / 50 km only (default 10). Distance is a filter, never a ranking factor except as tie-break and in "Plus proche".
- **Embedding model:** `intfloat/multilingual-e5-small`, 384 dimensions, queries encoded as `"query: " + normalised text`, mean-pooled, L2-normalised. Documents were encoded with `"passage: "` by the importer. Never mix with `gte-small` or any other model.
- **Query normalisation (identical in TypeScript and Python):** Unicode NFC, trim, collapse whitespace to one space, lower-case, cut to 200 characters.
- **Hidden:** associations with `confidence < 20` and `source <> 'community'` are never returned by search or `get_association`. Community-added rows (confidence 0 by design) are shown, labelled and ranked down.
- **Dormant:** `website is null and osm_id is null and claimed_by is null and source <> 'community' and (rna_published_on is null or rna_published_on < today − 10 years)` → excluded from browsing and suggestions; returned in a search only when its name matches (word similarity ≥ 0.6) or its pre-penalty score is ≥ the strong threshold (70).
- **Labels:** confidence < 50 → "non vérifié"; `source = 'community' and not verified` → "Ajouté par la communauté"; score ≥ 70 "Très pertinent", 50–69 "Pertinent", < 50 "Peu pertinent" (after the divider).
- **Town-level only:** associations are placed and measured from `town_point` = location snapped to a 0.01° grid (~1 km). Exact address/location never leave the database through the API.
- **Search misses:** anonymised (no user id, no coordinates; digit runs ≥ 6 and tokens containing `@` removed; ≤ 100 chars), area = town of the nearest association, aggregated per (query, area, day).
- **Explore copy (French source, exact):** search placeholder "Rechercher une activité, un club, une association…"; chips "Activités", "Clubs et associations", "Jour", "Distance", "Débutants bienvenus"; sort "Meilleure correspondance" / "Plus proche"; divider "Moins proche de votre recherche"; widen "3 résultats pertinents à 10 km — 11 à 50 km" pattern; association page "Ajouté par la communauté", "non vérifié", "C'est mon association", "Signaler une erreur / Retirer cette fiche", "Me prévenir quand ce club arrive".
- No hard-coded UI text, no emoji, Lucide icons always with a text label, screen-reader labels on all controls; no account needed for anything in this plan except storing a waiter row.
- Local Supabase ports 553xx (API `http://127.0.0.1:55321`, DB `postgresql://postgres:postgres@127.0.0.1:55322/postgres`).
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Embedding mismatch** (missing `"query: "` prefix, no normalisation, wrong pooling, q8 drift): semantic scores silently degrade while everything "works". → parity test in Task 4, ranking set in Task 5.
2. **Community-added clubs** (confidence 0, no embedding, no RNA date) wrongly treated as hidden or dormant: they must appear on a keyword match, labelled "Ajouté par la communauté". → test in Task 2.
3. **Embedding service down, slow or cold**: the user must still get keyword results, never an error screen or an endless spinner. → tests in Task 2 (`p_query_embedding` null → `mode = 'keyword_only'`) and Task 6 (`embedQuery` resolves `null` after 8 s).
4. **Hostile or malformed RPC input from anon** (3-dimension vector, radius 7, limit 10000, negative offset, 5,000-character query, latitude 200): a clean `22023` error, no full-table scan. → tests in Task 2.
5. **Address precision leak**: an RNA address is often a volunteer's home; neither direct table reads nor search distances may reveal more than the town. → tests in Task 1 (column revoke, snapping) and Task 3 (page returns `town_point` only).

---

## File Map

```
supabase/migrations/20261022000007_search.sql   search schema + helpers, new columns, column grants,
                                                association_waiters, search_misses aggregation,
                                                query_embedding_cache, search_explore(), get_association()
supabase/tests/07_search.test.sql                helpers, privileges, search_explore rules
supabase/tests/08_association_page.test.sql      get_association, association_waiters RLS
supabase/functions/embed-query/
  index.ts                                       Deno.serve entry: wires real model + cache
  handler.ts                                     createHandler(deps) — pure, unit-tested
  normalise.ts                                   normaliseQuery()
  model.ts                                       lazy Transformers.js pipeline
  handler_test.ts                                Deno unit tests
supabase/config.toml                             (modify) [functions.embed-query]
importer/importer/embed.py                       (modify) E5Embedder.embed_queries(), normalise_query()
importer/tests/ranking/
  fixture_lyon.json                              ~30 associations + 4 activities around Lyon
  conftest.py                                    loads fixture with real passage embeddings
  test_search_ranking.py                         spec §13 query set (markers: integration, slow)
  test_embed_parity.py                           Edge Function vs Python cosine (marker: edge)
  test_search_perf.py                            150k-row timing check (marker: perf)
app/src/features/explore/
  types.ts                                       ExploreParams, ExploreResult, ExploreResponse, AssociationDetail
  api.ts                                         embedQuery, searchExplore, getAssociation, addWaiter, searchTowns
  useExploreLocation.ts                          stored location, GPS, town fallback
  useExploreSearch.ts                            debounced search + pagination
  components/SearchBar.tsx, FilterChips.tsx, ResultCard.tsx, ResultsList.tsx,
             ResultsMap.tsx, LocationPicker.tsx, TownMap.tsx
  map.ts                                         MAP_STYLE_URL, ATTRIBUTION
app/src/app/(tabs)/index.tsx                     (modify) Explore screen
app/src/app/associations/[id].tsx                association page
app/src/app/activites/[id].tsx                   placeholder until sub-project 5
app/src/i18n/locales/fr.json, en.json            (modify) explore.*, association.*
app/__tests__/explore-*.test.tsx, association-page.test.tsx, explore-api.test.ts
app/app.json, app/package.json                   (modify) expo-location, maplibre plugin
.github/workflows/ci.yml                         (modify) deno tests + ranking job
README.md                                        (modify) search section + edge function serve
```

---

### Task 1: Search schema, helpers, privileges and new tables

**Files:**
- Create: `supabase/migrations/20261022000007_search.sql` (all but the two RPCs), `supabase/tests/07_search.test.sql` (first part)

**Interfaces:**
- Consumes: `public.associations` (incl. `insee_code`, `postcode`, `city`, `rna_published_on`), `public.activities`, `public.search_misses`, `importer.normalise_name(text)`, `public.is_admin()`.
- Produces:
  - Schema `search`, all privileges revoked from `public, anon, authenticated`.
  - `search.unaccent(text) returns text` immutable — `extensions.unaccent('extensions.unaccent'::regdictionary, $1)`.
  - `search.params()` immutable, OUT columns: `sim_floor float8 = 0.75`, `sim_ceil float8 = 0.88`, `keyword_boost int = 8`, `strong int = 70`, `weak int = 50`, `min_score int = 15`, `tie_window int = 5`, `name_sim real = 0.6`, `penalty_not_public int = 15`, `penalty_low_confidence int = 10`, `penalty_community int = 10`, `new_boost int = 5`, `new_days int = 14`, `hidden_below int = 20`, `low_confidence int = 50`, `dormant_years int = 10`, `widen_min int = 5`, `max_limit int = 50`, `max_offset int = 500`. Every threshold is read from here, never repeated.
  - `search.score(p_sim float8, p_keyword boolean, p_name_sim real, p_penalty int, p_is_new boolean) returns smallint` immutable: when `p_sim` is not null, `base = clamp((p_sim − sim_floor)/(sim_ceil − sim_floor), 0, 1)·100 + (p_keyword ? keyword_boost : 0)`; when null, `base = p_keyword ? 60 + 30·p_name_sim : 0`; result `round(clamp(base − p_penalty + (p_is_new ? new_boost : 0), 0, 100))`.
  - `search.base_score(...)` same arguments minus penalty/new → the pre-penalty value used for the dormant rule.
  - `search.penalty(p_likely_not_public boolean, p_confidence smallint, p_source text, p_verified boolean) returns int` immutable: +15 if not public; community and not verified → +10; otherwise confidence < 50 → +10.
  - `search.is_hidden(p_confidence smallint, p_source text) returns boolean`; `search.is_dormant(p_website text, p_osm_id text, p_claimed_by uuid, p_rna_published_on date, p_source text, p_today date) returns boolean` (rule in Global Constraints).
  - `search.anonymise_query(text) returns text` — normalise like the app, drop tokens containing `@` and digit runs ≥ 6, collapse spaces, cut to 100.
  - New `public.associations` columns: `town_point geography(Point,4326) generated always as (ST_SnapToGrid(location::geometry, 0.01)::geography) stored` (GiST index), `name_norm text generated always as (importer.normalise_name(name)) stored`, `search_tsv tsvector generated always as (setweight(to_tsvector('french', search.unaccent(coalesce(name,''))), 'A') || setweight(to_tsvector('french', search.unaccent(coalesce(purpose,''))), 'B')) stored` (GIN index).
  - New `public.activities` column `search_tsv` (title A, description B, same rule) with GIN index.
  - Column privileges: `revoke select on public.associations from anon, authenticated`, then `grant select (id, name, purpose, rna_id, osm_id, website, phone, email, opening_hours, confidence, likely_not_public, source, claimed_by, verified, locked_fields, attribution, created_by, created_at, updated_at, insee_code, postcode, city, rna_published_on, geocode_precision, last_import_run, town_point, name_norm)` to both. Not granted: `address, location, embedding, embedding_hash, search_tsv`. (Admin access to the address comes through an admin RPC in sub-project 7.)
  - `public.association_waiters(association_id uuid references associations on delete cascade, user_id uuid references profiles on delete cascade, created_at timestamptz default now(), primary key (association_id, user_id))`; RLS: `authenticated` select/insert/delete own rows (`user_id = auth.uid()`), admin select all; anon nothing.
  - `public.search_misses`: add `day date not null default current_date`, `hits int not null default 1`; unique index `search_misses_agg on (query, coalesce(area_label, ''), day)`.
  - `public.query_embedding_cache(model text not null, query_norm text not null, embedding vector(384) not null, created_at timestamptz not null default now(), primary key (model, query_norm))`; RLS enabled, no policies, all revoked from `anon, authenticated` (service role only). `create extension if not exists pg_cron`; job `prune-query-embedding-cache` daily at 04:10 deletes rows older than 60 days.

- [ ] **Step 1: Write the failing test** `supabase/tests/07_search.test.sql` (first part)

```sql
begin;
\ir helpers.inc
select plan(30);
select has_schema('search');
select is(search.score(0.88, false, 0, 0, false), 100::smallint, 'top similarity = 100');
select is(search.score(0.75, false, 0, 0, false), 0::smallint, 'floor similarity = 0');
select is(search.score(0.815, false, 0, 0, false), 50::smallint, 'midpoint = 50');
select is(search.score(0.815, true, 0, 0, false), 58::smallint, 'keyword boost +8');
select is(search.score(0.815, false, 0, 15, false), 35::smallint, 'penalty subtracts');
select is(search.score(0.815, false, 0, 0, true), 55::smallint, 'Nouvelle +5');
select is(search.score(null, true, 1.0, 0, false), 90::smallint, 'keyword-only full name match');
select is(search.score(null, false, 0.9, 0, false), 0::smallint, 'keyword-only without hit');
select is(search.penalty(true, 85::smallint, 'rna', false), 15, 'not public');
select is(search.penalty(true, 40::smallint, 'rna', false), 25, 'not public + low confidence');
select is(search.penalty(false, 0::smallint, 'community', false), 10, 'community counted once');
select ok(search.is_hidden(0::smallint, 'rna'), 'confidence 0 hidden');
select ok(not search.is_hidden(20::smallint, 'osm'), '20 visible');
select ok(not search.is_hidden(0::smallint, 'community'), 'community never hidden by confidence');
select ok(search.is_dormant(null, null, null, '2016-10-21', 'rna', '2026-10-22'), 'over 10 years');
select ok(not search.is_dormant(null, null, null, '2016-10-23', 'rna', '2026-10-22'), 'under 10 years');
select ok(search.is_dormant(null, null, null, null, 'rna', '2026-10-22'), 'never published');
select ok(not search.is_dormant('https://x.fr', null, null, null, 'rna', '2026-10-22'), 'website');
select ok(not search.is_dormant(null, 'node/1', null, null, 'rna+osm', '2026-10-22'), 'osm match');
select ok(not search.is_dormant(null, null, null, null, 'community', '2026-10-22'), 'community');
select is(search.anonymise_query('  Yoga   LYON '), 'yoga lyon', 'normalised');
select is(search.anonymise_query('appelez 0612345678 yoga'), 'appelez yoga', 'phone removed');
select is(search.anonymise_query('jean@exemple.fr cours'), 'cours', 'email removed');

insert into associations (id, name, source, confidence, location)
values ('00000000-0000-0000-0000-00000000f001', 'Club de Go de Lyon', 'rna', 60,
        'SRID=4326;POINT(4.83456 45.76789)');
select is(ST_AsText((select town_point from associations where id = '00000000-0000-0000-0000-00000000f001')),
          'POINT(4.83 45.77)', 'town_point snapped to 0.01 degree');
select tests.act_as_anon();
select throws_ok($$ select address from associations $$, '42501', null, 'anon cannot read address');
select throws_ok($$ select location from associations $$, '42501', null, 'anon cannot read location');
select lives_ok($$ select name, city, town_point from associations $$, 'anon reads public columns');
select throws_ok($$ select * from query_embedding_cache $$, '42501', null, 'cache is service-only');
select throws_ok($$ insert into association_waiters (association_id, user_id)
                    values ('00000000-0000-0000-0000-00000000f001', gen_random_uuid()) $$,
                 '42501', null, 'anon cannot wait');
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails** — `npm run db:test`; Expected: FAIL `07_search` (schema `search` missing).
- [ ] **Step 3: Write the migration** (everything in Interfaces except `search_explore` and `get_association`). Comment at the top that adding the stored columns rewrites `associations` (~1.5 M rows) and must be applied on the hosted project when no import is running.
- [ ] **Step 4: Run** — `npm run db:reset && npm run db:test`; Expected: all files `ok` (the existing `02_associations` and `06_import` tests still pass: they read only granted columns as API roles).
- [ ] **Step 5: Commit** — `git commit -m "feat(db): search schema, scoring helpers, town-level columns and waiters"`

---

### Task 2: `public.search_explore` — filtering, ranking, pagination, misses

**Files:**
- Modify: `supabase/migrations/20261022000007_search.sql` (append), `supabase/tests/07_search.test.sql` (append)

**Interfaces:**
- Consumes: Task 1 helpers and columns; `public.is_blocked_between(uuid)`, `association_tags`, `activity_tags`, `tags`, `categories`.
- Produces:

```sql
public.search_explore(
  p_lon float8, p_lat float8,
  p_radius_km int default 10,                 -- 5 | 10 | 25 | 50
  p_query text default null,                  -- null/blank = browse mode
  p_query_embedding extensions.vector default null,
  p_kinds text[] default '{activity,association}',
  p_weekday smallint default null,            -- ISO 1..7, activities only
  p_newcomer_friendly boolean default false,  -- activities only
  p_interest_category_ids uuid[] default '{}',-- browse mode; sub-project 4 passes real ids
  p_sort text default 'best',                 -- 'best' | 'nearest'
  p_limit int default 20, p_offset int default 0
) returns jsonb
```
  `volatile security definer set search_path = public, search, extensions, pg_temp`; execute granted to `anon, authenticated`. Response:
  `{"mode": "search"|"keyword_only"|"browse", "results": [ExploreResult], "strong_count": int, "strong_count_50km": int|null, "suggest_radius_km": 50|null, "has_more": bool}` where each result is
  `{"kind": "association"|"activity", "id", "title", "subtitle" (city | place_label), "snippet" (first 140 chars of purpose/description), "lon", "lat", "distance_km" (1 decimal), "score" (0–100 | null in browse), "label": "very_relevant"|"relevant"|"weak"|null, "is_weak": bool, "is_new": bool, "source_label": "community"|"unverified"|null, "tag_slugs": [text]}`.

Rules, in order:
1. **Validate** (raise `22023` with a short message): radius in (5,10,25,50); lon in [−180,180], lat in [−90,90]; `p_limit` 1..`max_limit`; `p_offset` 0..`max_offset`; `char_length(p_query) ≤ 200`; `vector_dims(p_query_embedding) = 384` when not null; `p_sort` in ('best','nearest'); `p_kinds` ⊆ {activity, association}, non-empty; `p_weekday` null or 1..7.
2. **Candidates** within `p_radius_km` (and within 50 km when the widen count is needed): associations by `ST_DWithin(town_point, point, m)`, excluding `search.is_hidden`; activities by `ST_DWithin(place, point, m)` with `archived_at is null and published_at <= now()`, excluding organisers where `auth.uid() is not null and is_blocked_between(organiser_id)`. `p_weekday` and `p_newcomer_friendly` keep only activities (weekly → `isodow(start_date) = d`; weekdays → `d = any(recurrence_weekdays)`; every_n_days → kept).
3. **Mode:** blank query → `browse`; query with embedding → `search`; query without embedding → `keyword_only`.
4. **Search / keyword_only scoring:** `keyword = search_tsv @@ websearch_to_tsquery('french', search.unaccent(q)) or word_similarity(importer.normalise_name(q), name_norm|title) ≥ name_sim`; `sim = 1 − (embedding <=> p_query_embedding)` (null when either is null); `score = search.score(sim, keyword, name_sim_value, penalty, is_new)`; drop rows with `score < min_score and not keyword`; dormant associations kept only when `name_sim_value ≥ name_sim or search.base_score(...) ≥ strong`.
5. **Order:** `best` → `is_weak` (score < weak) false first, then `floor(score / tie_window)` desc, `distance` asc, `id`; `nearest` → `is_weak` false first, `distance` asc, `id`.
6. **Counts:** `strong_count` = rows with score ≥ strong in radius; when `strong_count < widen_min and p_radius_km < 50`, compute `strong_count_50km` and set `suggest_radius_km = 50` if it is greater; otherwise both null.
7. **Browse:** no score; exclude dormant; when `p_interest_category_ids` is non-empty keep only rows tagged with those categories' slugs or their children's slugs; order `penalty > 0`, `distance`, `id`.
8. **Page:** `offset/limit` over the ordered list, `has_more` from fetching `limit + 1`.
9. **Miss log:** mode ≠ browse, `p_offset = 0`, `strong_count = 0`, anonymised query ≥ 2 chars → upsert `search_misses (query, area_label = city of the nearest association with a city, day)` incrementing `hits`.

- [ ] **Step 1: Write the failing tests** (append; raise `plan()`). Fixture as superuser around Lyon `(4.835, 45.764)`, with `tests.vec(s float8)` defined in the file as `(array[s, sqrt(1 - s*s)] || array_fill(0::float8, array[382]))::extensions.vector` and query embedding `tests.vec(1.0)`, so each row's similarity is exactly `s`. Assertions:
  - **radius:** a match at 12 km is absent with radius 10 and present with radius 25;
  - **order:** sim 0.87 at 8 km ranks above sim 0.80 at 1 km; two rows with scores in the same 5-point band → the nearer one first; `p_sort = 'nearest'` orders non-weak rows by distance;
  - **divider:** every row with `is_weak` comes after every row without; a score 40 row has `label = 'weak'`, a score 75 row `'very_relevant'`;
  - **penalties:** a `likely_not_public` twin of an identical row ranks below it; confidence 40 → `source_label = 'unverified'`;
  - **community:** a `source = 'community'` row with confidence 0, no embedding, name "Les Joueurs de Molkky de la Guillotière" is returned for query `molkky` with `source_label = 'community'`;
  - **hidden:** an `rna` row with confidence 0 is never returned, even for its exact name;
  - **dormant:** an old unclaimed RNA row without website/OSM is absent in browse mode, absent for a generic query with similarity 0.80, present for a query equal to its name;
  - **new:** an activity published 3 days ago has `is_new = true` and scores 5 above its twin published 20 days ago;
  - **keyword:** query `echecs` matches "Club d'Échecs de Lyon" (accent-insensitive, `mode = 'search'`); query `arduinno` matches "Atelier Arduino" through name similarity;
  - **keyword_only:** same call with `p_query_embedding => null` returns the FTS match with `mode = 'keyword_only'`;
  - **widen:** 1 strong row in 10 km and 3 in 50 km → `strong_count = 1`, `strong_count_50km = 3`, `suggest_radius_km = 50`; 6 strong rows in 10 km → both null;
  - **filters:** `p_kinds => '{association}'` returns no activity; `p_weekday => 2` keeps a weekly activity starting on a Tuesday and drops one on a Thursday and every association; `p_newcomer_friendly` keeps only `newcomer_friendly` activities;
  - **interests:** browse with the `games-go` category id returns only the go-tagged row;
  - **blocks:** an activity whose organiser blocked user U is absent for U and present for anon;
  - **pagination:** 25 matches, pages `(0,10)`, `(10,10)`, `(20,10)` return 25 distinct ids and `has_more` true, true, false;
  - **misses:** query `curling` with no strong result → one `search_misses` row `('curling', 'Lyon', current_date, hits 1)`; the same call again → `hits = 2`; with `p_offset = 10` → unchanged; a query with strong results → no row;
  - **input:** each of radius 7, `vector '[1,2,3]'`, limit 10000, offset −1, a 5,000-character query, latitude 200, sort `'random'` raises `22023`;
  - **access:** `anon` can execute `search_explore`; results never contain the keys `address`, `location` or `embedding`.
- [ ] **Step 2: Run to verify they fail** — `npm run db:test`; Expected: FAIL (function does not exist).
- [ ] **Step 3: Implement `public.search_explore`** (plpgsql; one CTE pipeline, `jsonb_agg` at the end).
- [ ] **Step 4: Run** — `npm run db:reset && npm run db:test`; Expected: all `ok`.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): search_explore ranking, filters, pagination and miss log"`

---

### Task 3: `public.get_association` and waiters

**Files:**
- Modify: `supabase/migrations/20261022000007_search.sql` (append)
- Create: `supabase/tests/08_association_page.test.sql`

**Interfaces:**
- Produces: `public.get_association(p_id uuid) returns jsonb` — `stable security definer`, execute to `anon, authenticated`. Returns `null` when the row does not exist or `search.is_hidden`. Otherwise `{"id", "name", "purpose", "city", "postcode", "lon", "lat"` (from `town_point`)`, "website", "phone", "email", "opening_hours", "source", "verified": bool, "claimed": bool, "source_label": "community"|"unverified"|null, "attribution_keys": [text], "tags": [{"slug","label_fr","label_en"}], "activities": [{"id","title"}]` (non-archived activities with `organised_by_association_id = p_id`)`, "can_wait": bool` (`claimed_by is null and website, phone, email all null`)`, "is_waiting": bool` (a waiter row exists for `auth.uid()`; false for anon)`}`.

- [ ] **Step 1: Write the failing test** `08_association_page.test.sql`:
  - anon gets `name`, `city`, `lon = 4.83`, `lat = 45.77` for a listing at `(4.83456, 45.76789)`; the JSON has no `address` key;
  - a confidence-0 RNA row → `null`; a community row → `source_label = 'community'`; confidence 45 → `'unverified'`; a listing with a phone → `can_wait = false`;
  - a non-archived organised activity appears in `activities`, an archived one does not;
  - signed-in U inserts a waiter row for an unclaimed contactless listing → `is_waiting = true` for U, `false` for V; V cannot read or delete U's row (0 rows); U deletes own row; admin reads all rows;
  - inserting a waiter row for another user's id → `42501` (RLS `with check`).
- [ ] **Step 2: Run to verify it fails** — `npm run db:test`; Expected: FAIL.
- [ ] **Step 3: Implement `get_association`.**
- [ ] **Step 4: Run** — `npm run db:reset && npm run db:test`; Expected: all `ok`. Then `npm run db:types`.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): association page RPC and waiter list"`

---

### Task 4: `embed-query` Edge Function (go/no-go spike)

**Files:**
- Create: `supabase/functions/embed-query/{index.ts,handler.ts,normalise.ts,model.ts,handler_test.ts}`, `importer/tests/ranking/test_embed_parity.py`
- Modify: `supabase/config.toml` (`[functions.embed-query] verify_jwt = true`), `importer/importer/embed.py`

**Interfaces:**
- Produces (`normalise.ts`): `normaliseQuery(text: string): string` — Global Constraints rule.
- Produces (`handler.ts`): `MODEL_ID = 'multilingual-e5-small-q8-v1'`; `createHandler(deps: { embed(text: string): Promise<number[]>; cacheGet(model: string, q: string): Promise<number[] | null>; cachePut(model: string, q: string, v: number[]): Promise<void> }): (req: Request) => Promise<Response>`. `POST {"text": string}` → `200 {"embedding": number[384], "model": MODEL_ID, "cached": boolean}`; empty after normalisation or longer than 200 chars → `400 {"error":"invalid_text"}`; other methods → `405`. Cache read before the model; cache write failures are ignored (logged).
- Produces (`model.ts`): `embedQueryText(q: string): Promise<number[]>` — lazily creates `pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' })` once per instance and runs it on `"query: " + q` with `{ pooling: 'mean', normalize: true }`.
- `index.ts`: `Deno.serve(createHandler({ embed: embedQueryText, cacheGet/cachePut via supabase-js with SUPABASE_SERVICE_ROLE_KEY on query_embedding_cache }))`.
- Produces (`importer/importer/embed.py`): `normalise_query(text: str) -> str` (same rule) and `E5Embedder.embed_queries(texts: list[str])` (prefix `"query: "`, normalised, `normalize_embeddings=True`); `FakeEmbedder.embed_queries` = `embed` on `"query: " + text`.

- [ ] **Step 1: Write the failing tests**
  - `handler_test.ts` (fake deps): `"  Jeu  de GO "` → `embed` called once with `"jeu de go"`, response length 384, `cached = false`; second identical call with a cache returning a vector → `embed` not called, `cached = true`; `""` and a 201-char text → 400; `GET` → 405; `cachePut` throwing → still 200.
  - `test_embed_parity.py` (marker `edge`; needs `npx supabase functions serve embed-query`): for `coder`, `jeu de go`, `danse bretonne`, `escalade`, cosine(edge vector, `E5Embedder().embed_queries([q])[0]`) ≥ 0.99.
  - Add to `importer/tests/test_embed.py`: `normalise_query("  Jeu  de GO ") == "jeu de go"`.
- [ ] **Step 2: Run to verify they fail** — `deno test supabase/functions/embed-query`; `cd importer && uv run pytest tests/test_embed.py`; Expected: FAIL.
- [ ] **Step 3: Implement** the five files and the Python additions.
- [ ] **Step 4: Run** — `deno test supabase/functions/embed-query` and `uv run pytest`; then serve locally and run `uv run pytest -m edge tests/ranking/test_embed_parity.py`; Expected: all pass.
- [ ] **Step 5: Spike measurement on the hosted project** — `npx supabase functions deploy embed-query`, then 10 calls after ≥ 15 min idle and 50 warm calls (script in README). **Go** when cold ≤ 8 s, warm p50 ≤ 300 ms, no memory-limit error. Record the numbers in `README.md` under "Search". **No-go** → stop and report to the owner with the numbers; the fallback (Cloud Run, same contract) gets its own short plan.
- [ ] **Step 6: Commit** — `git commit -m "feat(search): embed-query edge function with e5-small and cache"`

---

### Task 5: Ranking test set (spec §13) and performance check

**Files:**
- Create: `importer/tests/ranking/{fixture_lyon.json,conftest.py,test_search_ranking.py,test_search_perf.py}`
- Modify: `importer/pyproject.toml` (markers `ranking`, `edge`, `perf`; default `-m` excludes them)

**Interfaces:**
- Consumes: `E5Embedder`, `embedding_text`, `normalise_query`; `public.search_explore`.
- Fixture (invented names, all within 10 km of `(4.835, 45.764)` unless noted, confidence 60 unless noted): "Club informatique de la Croix-Rousse", "Atelier Arduino Villeurbanne", "Python Lyon" (meetup association), "Club de Go de Lyon", "Go Club Lyon Sud", "Club d'Échecs de Lyon", "Gogo Danse Fitness", "Cercle celtique de Lyon" (danses et musique bretonnes), "Association des Bretons de Lyon", "Salsa Lyon", "Club alpin Lyon-Villeurbanne" (escalade, alpinisme), "Salle d'escalade Vertical Lyon" (OSM), "L'Escale solidaire" (aide alimentaire), "Chorale Saint-Jean", "Copropriété Les Tilleuls" (`likely_not_public`), plus ~15 unrelated decoys (sport, culture, social) and one go club at 40 km; 4 activities (one "Soirée jeu de go" published 5 days ago).
- `conftest.py`: loads the fixture as postgres after `npm run db:reset`, with real `E5Embedder` passage embeddings; deletes it afterwards.

- [ ] **Step 1: Write the failing tests** `test_search_ranking.py` (markers `integration`, `slow`, `ranking`), each calling `search_explore(4.835, 45.764, 10, q, embed_queries([q])[0])`:
  - `coder` → "Club informatique de la Croix-Rousse", "Atelier Arduino Villeurbanne", "Python Lyon" all in the top 5; "Chorale Saint-Jean" not in the top 10;
  - `jeu de go` → rank 1 is "Club de Go de Lyon" or the "Soirée jeu de go" activity, both in the top 3 with "Go Club Lyon Sud"; "Gogo Danse Fitness" not in the top 5; the 40 km go club absent;
  - `danse bretonne` → "Cercle celtique de Lyon" rank 1, "Association des Bretons de Lyon" in the top 3, "Salsa Lyon" ranked below both;
  - `escalade` → "Club alpin Lyon-Villeurbanne" and "Salle d'escalade Vertical Lyon" in the top 3; "L'Escale solidaire" not in the top 3;
  - every expected top result has `label = 'very_relevant'`; "Copropriété Les Tilleuls" is never above an unflagged result with a higher similarity.
- [ ] **Step 2: Run to verify they fail** — `npm run db:reset && cd importer && uv run pytest -m ranking`; Expected: FAIL only where tuning is needed (functions exist from Task 2).
- [ ] **Step 3: Tune** only `search.params()` values (new migration lines in the same file before merge) until all pass; record the final values and the similarity range seen per query in a comment above `search.params()`. Never special-case a query.
- [ ] **Step 4: Run** — `uv run pytest -m ranking` and `npm run db:test` (score unit tests updated if params changed); Expected: all pass.
- [ ] **Step 5: Performance check** `test_search_perf.py` (marker `perf`, local only): insert 150,000 associations with random unit embeddings within 50 km of Paris `(2.3522, 48.8566)`, `analyze`, then 5 calls at radius 50 with a real query embedding → p95 < 1,500 ms. If it fails, add a covering index or lower `max_offset` before tuning anything else, and note the timing in README.
- [ ] **Step 6: Commit** — `git commit -m "test(search): ranking test set and large-city timing check"`

---

### Task 6: App data layer — types, API, location, search hook

**Files:**
- Create: `app/src/features/explore/{types.ts,api.ts,useExploreLocation.ts,useExploreSearch.ts}`, `app/__tests__/explore-api.test.ts`, `app/__tests__/explore-hooks.test.tsx`
- Modify: `app/package.json` (`npx expo install expo-location`), `app/app.json` (expo-location plugin, French permission text "Pour vous montrer les activités et associations près de chez vous.")

**Interfaces:**
- Produces (`types.ts`): `Radius = 5 | 10 | 25 | 50`; `ExploreKind = 'activity' | 'association'`; `ExploreParams { query: string; center: { lon: number; lat: number }; radiusKm: Radius; kinds: ExploreKind[]; weekday: 1|2|3|4|5|6|7|null; newcomerFriendly: boolean; interestCategoryIds: string[]; sort: 'best' | 'nearest' }`; `ExploreResult` and `ExploreResponse` mirror Task 2's JSON in camelCase; `AssociationDetail` mirrors Task 3.
- Produces (`api.ts`):
  - `embedQuery(text: string, timeoutMs = 8000): Promise<number[] | null>` — `supabase.functions.invoke('embed-query')`; `null` on error, timeout or a vector that is not 384 numbers.
  - `searchExplore(p: ExploreParams, page: { limit: number; offset: number }, embedding: number[] | null): Promise<ExploreResponse>` — `supabase.rpc('search_explore', …)`, snake_case ↔ camelCase mapping, throws `ExploreError` on RPC error.
  - `getAssociation(id: string): Promise<AssociationDetail | null>`; `addWaiter(associationId: string): Promise<'added' | 'signed_out'>` (no session → `'signed_out'` without a call); `removeWaiter(associationId: string): Promise<void>`.
  - `searchTowns(q: string): Promise<Town[]>`, `Town { label: string; lon: number; lat: number }` — `https://geo.api.gouv.fr/communes?nom=<q>&fields=nom,centre,codesPostaux&boost=population&limit=5`; label `"Lyon (69001)"`.
- Produces (`useExploreLocation.ts`): `useExploreLocation(): { location: StoredLocation | null; status: 'loading'|'ready'|'needed'; requestGps(): Promise<'ok'|'denied'>; setTown(t: Town): Promise<void> }`; `StoredLocation { label: string; lon: number; lat: number; source: 'gps'|'town' }` persisted in AsyncStorage key `explore.location`; GPS label is the translation key `explore.location.myPosition`.
- Produces (`useExploreSearch.ts`): `useExploreSearch(params: ExploreParams | null): { response: ExploreResponse | null; results: ExploreResult[]; loading: boolean; error: boolean; loadMore(): void }` — debounce 350 ms on `query`, embedding fetched once per distinct normalised query (in-memory map), page size 20, stale responses discarded.

- [ ] **Step 1: Write the failing tests**
  - `explore-api.test.ts` (mock `supabase`): `embedQuery` resolves `null` when `invoke` rejects, when it never resolves (fake timers, 8 s), and when it returns 3 numbers; `searchExplore` sends `p_radius_km: 10, p_query_embedding: null` and maps `distance_km` → `distanceKm`; `addWaiter` without a session returns `'signed_out'` and makes no insert; `searchTowns` maps the geo.api payload to `{ label: 'Lyon (69001)', lon: 4.835, lat: 45.758 }` (mocked `fetch`).
  - `explore-hooks.test.tsx`: typing three characters quickly triggers **one** search after 350 ms; when `embedQuery` returns `null` the RPC is still called (with `null`); `loadMore` requests offset 20 and appends; a slower earlier response does not overwrite a newer one; `requestGps` with permission denied returns `'denied'` and keeps `status = 'needed'`; `setTown` persists to `explore.location`.
- [ ] **Step 2: Run to verify they fail** — `cd app && npm test -- explore-`; Expected: FAIL.
- [ ] **Step 3: Implement** the four modules.
- [ ] **Step 4: Run** — `npm test && npx tsc --noEmit && npm run lint`; Expected: pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(app): explore data layer, location and debounced search"`

---

### Task 7: Explore screen — search bar, chips, results list

**Files:**
- Create: `app/src/features/explore/components/{SearchBar,FilterChips,ResultCard,ResultsList,LocationPicker}.tsx`, `app/__tests__/explore-screen.test.tsx`
- Modify: `app/src/app/(tabs)/index.tsx`, `app/src/i18n/locales/fr.json`, `en.json`, `app/__tests__/tabs.test.tsx` (the search field becomes editable)

**Interfaces:**
- Consumes: Task 6 hooks and types.
- Produces: `ResultsList({ response, results, onEndReached, onWiden, onOpen })` renders cards in order and inserts a divider row before the first `isWeak` result; `ResultCard({ result, onPress })` shows title, subtitle, distance (`"2,4 km"`, French decimal comma via `Intl.NumberFormat(i18n.language)`), match label, "Nouvelle", source label; `FilterChips({ params, onChange })`; `LocationPicker({ onGps, onTown })`.
- Screen layout (top to bottom): search bar (always first, `editable`), chips row (Activités, Clubs et associations, Jour, Distance, Débutants bienvenus), location line "Autour de {{place}}" + "Modifier", sort switch (only with a query), list/map toggle "Liste"/"Carte" with Lucide `List`/`Map` icons, results. Without a location, `LocationPicker` replaces the results ("Utiliser ma position" / "Saisir une ville"). Browse mode heading "Près de chez vous". Empty results: "Aucun résultat pertinent près d'ici" + "Créer une activité" and "Une idée ? Un problème ?" buttons (both show `common.comingSoon` until sub-projects 5 and 7).
- Chip behaviour: Activités / Clubs et associations are toggles that can never both be off; Jour opens a sheet "Tous les jours, Lundi … Dimanche"; Distance opens "5 km, 10 km, 25 km, 50 km"; Jour or Débutants bienvenus set → Clubs et associations shown disabled with hint "Ce filtre concerne les activités".
- i18n keys added in both locales: `explore.filters.*`, `explore.sort.best|nearest`, `explore.view.list|map`, `explore.weakDivider`, `explore.widen_one|_other` ("{{count}} résultat pertinent à {{radius}} km — {{wide}} à 50 km" / "{{count}} résultats pertinents à {{radius}} km — {{wide}} à 50 km"), `explore.widenAction` ("Élargir à 50 km"), `explore.label.veryRelevant|relevant|weak` ("Très pertinent", "Pertinent", "Peu pertinent"), `explore.new` ("Nouvelle"), `explore.source.community|unverified`, `explore.nearby`, `explore.empty`, `explore.createActivity`, `explore.feedback`, `explore.location.*`, `explore.days.*`, `explore.activitiesOnly`.

- [ ] **Step 1: Write the failing test** `explore-screen.test.tsx` (mock the hooks):
  - the search field is the first focusable element, editable, with the French placeholder;
  - the five chip labels render in French; turning off "Activités" then "Clubs et associations" leaves "Clubs et associations" on;
  - with results `[75, 55, 40, 30]` (scores) the divider text "Moins proche de votre recherche" appears exactly once, between the 55 and 40 cards; labels "Très pertinent", "Pertinent", "Peu pertinent" render;
  - response `{ strongCount: 3, strongCount50km: 11, suggestRadiusKm: 50 }` at 10 km shows "3 résultats pertinents à 10 km — 11 à 50 km"; pressing "Élargir à 50 km" sets `radiusKm` to 50;
  - an activity with `isNew` shows "Nouvelle"; a community result shows "Ajouté par la communauté";
  - distance `2.4` renders "2,4 km";
  - no location → "Utiliser ma position" and "Saisir une ville" visible, no results list;
  - empty response with a query → "Créer une activité" and "Une idée ? Un problème ?" visible;
  - no rendered text contains an emoji (regex `\p{Extended_Pictographic}`).
- [ ] **Step 2: Run to verify it fails** — `npm test -- explore-screen`; Expected: FAIL.
- [ ] **Step 3: Implement** components, screen and translations (English kept in sync; `translations.test.ts` enforces parity).
- [ ] **Step 4: Run** — `npm test && npx tsc --noEmit && npm run lint`; Expected: pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(app): explore screen with filters, ranked list and widen banner"`

---

### Task 8: Map view (MapLibre + OpenFreeMap)

**Files:**
- Create: `app/src/features/explore/map.ts`, `app/src/features/explore/components/{ResultsMap,TownMap}.tsx`, `app/__tests__/explore-map.test.tsx`, `app/__mocks__/@maplibre/maplibre-react-native.tsx`
- Modify: `app/package.json` (`npx expo install @maplibre/maplibre-react-native`), `app/app.json` (its config plugin), `app/src/app/(tabs)/index.tsx` (list/map toggle)

**Interfaces:**
- Produces (`map.ts`): `MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'`; `ATTRIBUTION = '© OpenMapTiles © OpenStreetMap contributors'`.
- Produces: `ResultsMap({ results, center, radiusKm, onOpen })` — one marker per result at `lon/lat` with the result title as `accessibilityLabel`, camera fitted to the radius; tapping a marker shows a compact `ResultCard`. `TownMap({ lon, lat, label })` — fixed camera zoom 12, a ~1 km translucent circle instead of a pin (town-level), non-interactive.
- Both keep the MapLibre attribution control enabled and render `ATTRIBUTION` text below the map.

- [ ] **Step 1: Write the failing test** `explore-map.test.tsx` (manual mock renders markers as `View`s with their labels): toggling "Carte" renders `ResultsMap` with one marker per result and hides the list; toggling "Liste" restores it; `ResultsMap` passes `MAP_STYLE_URL`; the attribution text is rendered and `attributionEnabled` is not `false`; `TownMap` renders a circle layer and no point marker.
- [ ] **Step 2: Run to verify it fails** — `npm test -- explore-map`; Expected: FAIL.
- [ ] **Step 3: Implement**; rebuild the dev client (`npx expo run:android`) and check tiles load on the emulator.
- [ ] **Step 4: Run** — `npm test && npx tsc --noEmit && npm run lint`; Expected: pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(app): list/map toggle with MapLibre and OpenFreeMap"`

---

### Task 9: Association page and "Me prévenir quand ce club arrive"

**Files:**
- Create: `app/src/app/associations/[id].tsx`, `app/src/app/activites/[id].tsx`, `app/__tests__/association-page.test.tsx`
- Modify: `fr.json`, `en.json` (`association.*`, `activity.placeholder`)

**Interfaces:**
- Consumes: `getAssociation`, `addWaiter`, `removeWaiter`, `TownMap`.
- Page (top to bottom): name; labels row (`source_label` → "Ajouté par la communauté" / "non vérifié"; `verified` → "Association vérifiée"); purpose; tags (French or English label by UI language); `TownMap` with "{{city}} ({{postcode}})"; contact block (website, phone, email, opening hours — each only when present, opened with `Linking`); "Activités organisées" list linking to `/activites/[id]`; "Me prévenir quand ce club arrive" button only when `can_wait` (signed out → message "Connectez-vous pour être prévenu(e)." with no write; signed in → `addWaiter`, then "Nous vous préviendrons" + "Annuler" calling `removeWaiter`); "C'est mon association" button and "Signaler une erreur / Retirer cette fiche" link, both showing `common.comingSoon` until sub-project 7; source line from `attribution_keys` ("Source : Répertoire national des associations (Licence Ouverte / Etalab 2.0)", "© les contributeurs d'OpenStreetMap (ODbL)"). `null` → "Cette fiche n'est plus disponible".
- `activites/[id].tsx`: title from the route param's result and `common.comingSoon` (the real activity page is sub-project 5).

- [ ] **Step 1: Write the failing test** `association-page.test.tsx` (mock `api`):
  - community listing shows "Ajouté par la communauté"; confidence-45 listing shows "non vérifié";
  - listing with a phone has no "Me prévenir quand ce club arrive" button; a contactless unclaimed one has it;
  - signed out: pressing it shows "Connectez-vous pour être prévenu(e)." and `addWaiter` returns `'signed_out'` without an insert; signed in: `addWaiter` called once, then "Nous vous préviendrons" is shown;
  - "C'est mon association" and "Signaler une erreur / Retirer cette fiche" are present and labelled for screen readers;
  - both attribution lines render for a listing with keys `rna` and `osm`;
  - `null` → "Cette fiche n'est plus disponible";
  - no address text is rendered (the fixture's `address` would not be in the payload; assert no text matches `/\d+ rue/`).
- [ ] **Step 2: Run to verify it fails** — `npm test -- association-page`; Expected: FAIL.
- [ ] **Step 3: Implement** both screens and translations.
- [ ] **Step 4: Run** — `npm test && npx tsc --noEmit && npm run lint`; Expected: pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(app): association page with labels, town map and waiter button"`

---

### Task 10: CI, runbook and end-to-end check

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- `ci.yml`: new job `edge` — `denoland/setup-deno@v2`, `deno test supabase/functions/embed-query`; new job `ranking` — `npx supabase start`, `astral-sh/setup-uv@v5`, cache `~/.cache/huggingface` (key `e5-small-v1`), `cd importer && uv sync && uv run pytest -m ranking`. Parity (`edge`) and `perf` stay local/manual.
- `README.md` "Search" section: serving the function locally (`npx supabase functions serve embed-query`), the app env (`EXPO_PUBLIC_SUPABASE_URL` reaches functions at `/functions/v1/embed-query`), the spike numbers from Task 4, the rule "change `search.params()` only together with a green ranking run", the hosted migration note (table rewrite; apply outside import runs), map attribution requirement.

- [ ] **Step 1: Write the workflow jobs and README section.**
- [ ] **Step 2: Validate YAML** — `npx --yes js-yaml .github/workflows/ci.yml > /dev/null`; Expected: no error.
- [ ] **Step 3: Run all suites** — `npm run db:reset && npm run db:test`; `deno test supabase/functions/embed-query`; `cd importer && uv run pytest && uv run pytest -m ranking`; `cd app && npm test && npx tsc --noEmit && npm run lint`; Expected: all pass.
- [ ] **Step 4: Manual check on the emulator** against local Supabase with the ranking fixture loaded: search "jeu de go" around Lyon → go club first, "Très pertinent"; switch to "Carte" → markers; open an association → town circle, labels, waiter button; turn the function off → keyword results still appear.
- [ ] **Step 5: Commit** — `git commit -m "ci: edge function and search ranking jobs; search runbook"`

---

## Out of scope (owned elsewhere)

- Interest picker and `user_interests` (sub-project 4); the API already takes `p_interest_category_ids`. Spec §6 "each interest runs a semantic search" becomes tag-based here and semantic once categories get embeddings (sub-project 4).
- Real sign-in for the waiter button (sub-project 4), activity page and "Créer une activité" / "Lancez-la vous-même" flows, séance découverte filter (sub-project 5).
- Claim flow, reports, admin views of search misses and of listings with the most waiters, "12 personnes attendent votre club" (sub-projects 7 and 14).
- Public web pages, slugs, "not found" for hidden listings to search engines (sub-project 8).
- Saved searches with alerts, seasonal suggestions (Release 2, sub-project 11); native ads in the list (sub-project 15).
