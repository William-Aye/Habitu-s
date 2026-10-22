# Association Directory Import (Sub-project 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monthly, re-runnable import that fills `public.associations` with every active French association (RNA) plus OpenStreetMap clubs: geocoded, merged, tagged, embedded for semantic search, scored for confidence, and reported in an `import_runs` table — without ever overwriting what an association edited itself.

**Architecture:** A Python package in `importer/` does everything that needs the outside world (download, parse, geocode, tag, embed) and writes rows into **staging tables** in a private `importer` schema with `COPY`. One SQL function, `importer.apply_run(run_id, scope)`, then does all merging inside Postgres in a single transaction (PostGIS distance + `pg_trgm` similarity): upsert, RNA↔OSM match, community-club merge, removal of dissolved listings, tags, confidence. If anything fails before `apply_run` commits, the live data is untouched. GitHub Actions runs it monthly.

**Tech Stack:** Python 3.12 (managed by `uv`), httpx, psycopg 3 (binary), sentence-transformers with `intfloat/multilingual-e5-small`, unidecode, pytest + respx; osmium-tool (CLI, Linux runners only) to pre-filter the OSM extract; Supabase Postgres (PostGIS, pg_trgm, pgvector); pgTAP; GitHub Actions.

**Spec:** `docs/specs/2026-10-21-friend-app-design.md` — sections 5 (directory), 6 (embedding model), 11 (Import health), 12 (import failure), 13 (import tests). Builds on the foundation plan `docs/plans/2026-10-21-foundation.md` (tables `associations`, `association_tags`, `tags`, `categories`, `association_claims`, `activities`).

## Global Constraints

- **Keep every association except those officially dissolved.** No thematic filtering. Unlikely-public types get `likely_not_public = true` and are kept.
- **Never overwrite fields listed in `associations.locked_fields`.** Never delete a listing that is claimed (`claimed_by is not null`) or referenced by an activity; set its `confidence` to 0 instead.
- **A run limited to some départements must never modify or delete listings outside those départements.**
- **Failure safety:** any error before `apply_run` commits leaves live data exactly as it was; the run row records `status = 'failed'` and the error.
- **Embedding model:** `intfloat/multilingual-e5-small`, 384 dimensions, documents encoded with the prefix `"passage: "` and L2-normalised. (Search in sub-project 3 must use `"query: "`.)
- **Matching thresholds:** same organisation = trigram similarity of normalised names **≥ 0.6** and distance **≤ 300 m**.
- **Confidence (0–100), computed only in SQL:** 20 base; +20 if published/updated in the RNA within the last 5 years; +20 if it has a website; +25 if matched in OSM (or OSM-only); +15 if claimed **and** verified. Listings with confidence **< 20 are hidden** from search; **< 50 are labelled "non vérifié"** (labelling is sub-project 3's job; this plan stores the number).
- **Attribution:** RNA rows `{"rna": "Licence Ouverte / Etalab 2.0"}`, OSM rows `{"osm": "© OpenStreetMap contributors, ODbL 1.0"}`; merged rows carry both keys.
- **No personal data:** never import RNA director/contact-person fields (e.g. `dir_civilite`) or any named individual.
- **Purpose-code mapping is out of scope:** tagging uses keyword rules on name + purpose only (the official RNA purpose-code nomenclature could not be verified offline). Semantic search covers what keywords miss. Recorded deviation from spec §5 step 6.
- Local Supabase API/DB ports are 553xx (DB `postgresql://postgres:postgres@127.0.0.1:55322/postgres`).
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Partial runs** (`--departements 69`): listings of other départements, including ones absent from this run, must be untouched. → test in Task 2.
2. **Claimed / locked / referenced listings** when the source changes or the association is dissolved: locked fields keep their values, claimed or activity-referenced listings are kept with confidence 0. → tests in Task 2.
3. **Broken source files** (missing column, renamed header, empty or truncated file): the run fails before any DB write, naming the missing columns. → tests in Task 4.
4. **Encoding**: the RNA CSV may be UTF-8 or Windows-1252; accents (`É`, `ç`, `œ`) must survive either way. → test in Task 4.
5. **Ambiguous matches**: two OSM clubs near one RNA association (and vice versa) — only the single best pair merges; the other stays separate. → test in Task 2.

---

## File Map

```
supabase/migrations/20261022000006_import.sql   importer schema, staging tables, import_runs, new association columns, apply_run()
supabase/tests/06_import.test.sql               pgTAP for apply_run and import_runs access
importer/
  pyproject.toml                                uv project, deps, pytest config
  README.md                                     runbook (local sample run, first full run in batches)
  importer/__init__.py
  importer/__main__.py                          `python -m importer` → cli.main()
  importer/cli.py                               argument parsing + run orchestration
  importer/models.py                            dataclasses shared by all modules
  importer/text.py                              normalise_name(), is_likely_not_public(), clean_website()
  importer/rna.py                               find_latest_rna_url(), read_rna_zip()
  importer/osm.py                               read_osm_geojsonseq()
  importer/geocode.py                           Geocoder (BAN/Géoplateforme CSV + commune fallback)
  importer/tagging.py                           Tagger (keyword rules)
  importer/embed.py                             Embedder protocol, E5Embedder, FakeEmbedder, text_hash()
  importer/db.py                                start_run(), existing_hashes(), stage(), apply(), finish_run()
  importer/data/keywords.csv                    keyword → category slug
  importer/data/not_public_keywords.txt         one phrase per line
  tests/fixtures/rna_sample.csv                 ~12 rows (UTF-8) incl. dissolved, accents, bad website
  tests/fixtures/rna_sample_cp1252.csv          same rows, Windows-1252
  tests/fixtures/osm_sample.geojsonseq          ~6 features (node + closed way)
  tests/test_text.py, test_rna.py, test_osm.py, test_geocode.py, test_tagging.py, test_embed.py
  tests/test_integration.py                     full run against local Supabase (marker: integration)
.github/workflows/import.yml                    monthly + manual import
.github/workflows/ci.yml                        (modify) add importer unit tests job
```

---

### Task 1: Import schema, run log and new association columns

**Files:**
- Create: `supabase/migrations/20261022000006_import.sql` (schema part), `supabase/tests/06_import.test.sql` (access part)

**Interfaces:**
- Produces:
  - Schema `importer` — no grants to `anon`/`authenticated` (not exposed through the API).
  - New columns on `public.associations`: `insee_code text`, `rna_published_on date`, `geocode_precision text check (geocode_precision in ('address','municipality','osm'))`, `embedding_hash text`, `last_import_run uuid`. Index on `insee_code`.
  - `public.import_runs` — `id uuid pk default gen_random_uuid()`, `started_at timestamptz not null default now()`, `finished_at timestamptz`, `status text not null default 'running' check (status in ('running','succeeded','failed'))`, `scope text[]` (null = all of France), `counts jsonb not null default '{}'`, `error text`. RLS: admin select only; no API writes (service role/postgres write it).
  - `importer.staged_rna` — `run_id uuid not null`, `rna_id text not null`, `name text not null`, `purpose text`, `address text`, `insee_code text`, `location geography(Point,4326)`, `geocode_precision text`, `website text`, `published_on date`, `likely_not_public boolean not null`, `tag_slugs text[] not null default '{}'`, `embedding vector(384)`, `embedding_hash text not null`; primary key `(run_id, rna_id)`.
  - `importer.staged_osm` — `run_id uuid not null`, `osm_id text not null` (e.g. `node/123`, `way/456`), `name text not null`, `location geography(Point,4326) not null`, `insee_code text`, `website text`, `phone text`, `email text`, `opening_hours text`, `tag_slugs text[] not null default '{}'`, `embedding vector(384)`, `embedding_hash text not null`; primary key `(run_id, osm_id)`.
  - `importer.geocode_cache` — `address_key text pk`, `lon double precision`, `lat double precision`, `score real`, `precision text`, `created_at timestamptz default now()`.
  - `importer.normalise_name(text) returns text` (immutable SQL): `lower(unaccent(x))`, remove the words `association`, `asso`, `club`, `amicale`, `l'`, `d'`, `de`, `des`, `du`, `la`, `le`, `les`, punctuation → space, collapse spaces, trim. Must give the same result as Python `normalise_name` (Task 3) on the shared test strings. `unaccent` is only `stable`, so call it in its two-argument form `extensions.unaccent('extensions.unaccent'::regdictionary, x)` inside this function so declaring it `immutable` is safe (needed for indexes later).
  - `importer.confidence(p_published date, p_website boolean, p_in_osm boolean, p_claimed_verified boolean) returns smallint` (immutable) — formula from Global Constraints, using `current_date` passed in as `p_today date` (add a 5th parameter so it stays immutable/testable).

- [ ] **Step 1: Write the failing test** `supabase/tests/06_import.test.sql` (first part)

```sql
begin;
\ir helpers.inc
select plan(10);
select has_schema('importer');
select has_table('public', 'import_runs', 'import_runs exists');
select has_column('public', 'associations', 'embedding_hash', 'associations.embedding_hash');
select is(importer.normalise_name('Association Le Club de Go d''Évry !'), 'go evry', 'normalise_name strips filler words and accents');
select is(importer.confidence(current_date - 365, true, true, true, current_date), 100::smallint, 'max confidence');
select is(importer.confidence(null, false, false, false, current_date), 20::smallint, 'base confidence');
select is(importer.confidence(current_date - 6*365, false, false, false, current_date), 20::smallint, 'old publication adds nothing');

select tests.create_user('u@test.fr', 'U') as u \gset
select tests.act_as(:'u');
select throws_ok($$ select * from importer.staged_rna $$, '42501', null, 'API roles cannot read staging');
select is((select count(*) from import_runs)::int, 0, 'non-admin sees no runs');
select tests.act_as_anon();
select throws_ok($$ select * from import_runs $$, '42501', null, 'anon cannot read runs');
select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails** — `npm run db:test`; Expected: FAIL `06_import` (schema `importer` missing).
- [ ] **Step 3: Write the migration** (schema part only; `apply_run` comes in Task 2). Revoke all on schema `importer` and its tables from `anon, authenticated, public`; `import_runs` gets `revoke all from anon`, `grant select to authenticated`, RLS policy `using (public.is_admin())`.
- [ ] **Step 4: Run tests** — `npm run db:reset && npm run db:test`; Expected: all files `ok`.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): importer schema, staging tables and import_runs"`

---

### Task 2: `importer.apply_run` — the merge, in one transaction

**Files:**
- Modify: `supabase/migrations/20261022000006_import.sql` (append function)
- Modify: `supabase/tests/06_import.test.sql` (append merge tests)

**Interfaces:**
- Consumes: Task 1 objects; `public.associations`, `association_tags`, `tags`, `categories`, `association_claims`, `activities.organised_by_association_id`.
- Produces: `importer.apply_run(p_run uuid, p_scope text[]) returns jsonb` — `security definer`, `set search_path = public, importer, extensions, pg_temp`; execute revoked from public/anon/authenticated (service role / postgres only). `p_scope` = list of département codes (`'69'`, `'2A'`, `'971'`), `null` = all France. A listing is "in scope" when `left(insee_code, 2)` (or `left(insee_code, 3)` for codes starting `97`) is in `p_scope`, or `p_scope is null`. Returns counts: `{"inserted":n,"updated":n,"osm_matched":n,"osm_only":n,"community_merged":n,"removed":n,"kept_dissolved":n}` and writes them to `import_runs.counts`.

Steps inside `apply_run`, in this order:
1. **Tags sync:** `insert into tags (slug, label_fr, label_en) select slug, name_fr, name_en from categories on conflict (slug) do nothing`.
2. **Upsert RNA** from `staged_rna` by `rna_id` (`source` becomes `'rna'`, or stays `'rna+osm'` if already matched). For every updatable column (`name, purpose, address, insee_code, location, geocode_precision, website, rna_published_on, likely_not_public`), keep the existing value when the column name is in `locked_fields`. `embedding`/`embedding_hash` are replaced only when the staged `embedding is not null`. Set `last_import_run = p_run`, `attribution = attribution || '{"rna": "Licence Ouverte / Etalab 2.0"}'`.
3a. **Place OSM rows in a département:** the importer stages each OSM feature with the INSEE code of the commune with the nearest centre (`importer/place.py`, the same rule that filters OSM by `--departements`). Only for a staged row without a code, set `staged_osm.insee_code` to the `insee_code` of the nearest association with a non-null `insee_code` within 5 km (PostGIS KNN `<->`). When `p_scope is not null`, staged OSM rows with no derived code or a code outside the scope are ignored by every later step.
3. **Match OSM → associations:** candidate pairs = staged OSM × in-scope associations with `source in ('rna','rna+osm')` where `ST_DWithin(location, osm.location, 300)` and `similarity(importer.normalise_name(a.name), importer.normalise_name(o.name)) >= 0.6`. Keep only mutual best pairs (highest similarity, then shortest distance, each side used once). For matched: `osm_id`, `source = 'rna+osm'`, `phone`/`opening_hours`/`email` filled when null, `website` filled when null, `location` replaced by the OSM point and `geocode_precision = 'osm'` unless `location` is locked; attribution gains the `osm` key.
4. **OSM-only:** unmatched staged OSM upserted by `osm_id` with `source = 'osm'`.
5. **Community merge:** each in-scope `source = 'community'` row whose best imported match (same thresholds) exists is merged into the imported row: copy `claimed_by`, `verified`, `locked_fields` and the values of locked fields when the community row was claimed; repoint `activities.organised_by_association_id` and `association_claims.association_id`; delete the community row.
6. **Removed / dissolved:** in-scope rows with `source in ('rna','rna+osm')` whose `rna_id` is not in this run's `staged_rna`, and in-scope `source = 'osm'` rows whose `osm_id` is not in `staged_osm`: delete when `claimed_by is null` and no activity references them; otherwise set `confidence = 0` (counted as `kept_dissolved`).
7. **Tags:** for rows touched in this run, replace `association_tags` with the staged `tag_slugs` (union of RNA and OSM slugs for merged rows), resolving slugs via `tags.slug`; unknown slugs are ignored.
8. **Confidence:** for touched rows, `confidence = importer.confidence(rna_published_on, website is not null, osm_id is not null, claimed_by is not null and verified, current_date)` — except rows set to 0 in step 6.
9. Delete this run's staging rows; update `import_runs` (`status = 'succeeded'`, `finished_at`, `counts`).

- [ ] **Step 1: Write the failing tests** (append to `06_import.test.sql`, raise `plan()` accordingly). As superuser create a run row and stage fixtures, then call `importer.apply_run(:'run', array['69'])`. Assertions:
  - a staged RNA row is inserted with `source = 'rna'`, attribution has key `rna`;
  - RNA "Club de Go de Lyon" at (4.835, 45.764) + OSM "Go Club Lyon" 120 m away → one row, `source = 'rna+osm'`, `osm_id` set, phone copied, `geocode_precision = 'osm'`;
  - **ambiguity:** two OSM clubs "Club de Go de Lyon" at 50 m and "Club de Go Lyon Sud" at 250 m → only the 50 m one merges; the other is a separate `source = 'osm'` row;
  - an existing listing with `locked_fields = '{purpose}'` keeps its purpose while `website` updates;
  - an existing in-scope RNA listing absent from staging and unclaimed → deleted; absent but claimed → kept with `confidence = 0`; absent but referenced by an activity → kept with `confidence = 0`;
  - **scope:** an existing listing with `insee_code = '75056'` absent from a `{'69'}` run is untouched (same `confidence`, same `last_import_run`);
  - **scope (OSM):** a staged OSM club 100 m from that Paris listing is ignored by a `{'69'}` run (no insert, no merge);
  - a claimed community row "Atelier Arduino Villeurbanne" 80 m from staged RNA "Atelier Arduino de Villeurbanne" → merged: the RNA row now has `claimed_by` of the community claimant, the activity pointing at the community row now points at the RNA row, the community row is gone;
  - `association_tags` of a touched row equal its staged slugs; an unknown slug is ignored;
  - confidence of a fresh RNA row with website, recent publication, OSM-matched, unclaimed = 85;
  - `import_runs.status = 'succeeded'` and `counts->>'inserted'` matches; staging rows for the run are gone;
  - `authenticated` cannot execute `importer.apply_run` (42501).
- [ ] **Step 2: Run to verify they fail** — `npm run db:test`; Expected: FAIL (function does not exist).
- [ ] **Step 3: Implement `importer.apply_run`** per the numbered steps (plpgsql; temp tables for best-pair selection are fine).
- [ ] **Step 4: Run tests** — `npm run db:reset && npm run db:test`; Expected: all `ok`.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): importer.apply_run merge with scope, locks and community merge"`

---

### Task 3: Python project, shared models and text helpers

**Files:**
- Create: `importer/pyproject.toml`, `importer/importer/__init__.py`, `importer/importer/__main__.py`, `importer/importer/models.py`, `importer/importer/text.py`, `importer/importer/data/not_public_keywords.txt`, `importer/tests/test_text.py`

**Interfaces:**
- Produces (`importer/importer/models.py`, frozen dataclasses):
  - `RnaRecord(rna_id: str, name: str, purpose: str | None, address: str | None, postcode: str | None, insee_code: str | None, city: str | None, website: str | None, published_on: date | None)`
  - `OsmRecord(osm_id: str, name: str, lon: float, lat: float, website: str | None, phone: str | None, email: str | None, opening_hours: str | None, kind: str)` (`kind` e.g. `"club=sport"`, `"leisure=sports_centre"`)
  - `GeoPoint(lon: float, lat: float, precision: Literal['address','municipality'])`
  - `StagedRna` = `RnaRecord` fields needed by `importer.staged_rna` + `location: GeoPoint | None`, `likely_not_public: bool`, `tag_slugs: list[str]`, `embedding: list[float] | None`, `embedding_hash: str`
  - `StagedOsm` likewise for `importer.staged_osm` (`insee_code` is always None from Python; `apply_run` derives it, Task 2 step 3a).
- Produces (`importer/importer/text.py`):
  - `normalise_name(name: str) -> str` — identical rule to SQL `importer.normalise_name` (Task 1).
  - `is_likely_not_public(name: str, purpose: str | None) -> bool` — true when the accent-free, lower-cased name or purpose contains any phrase in `data/not_public_keywords.txt`.
  - `clean_website(raw: str | None) -> str | None` — trims; adds `https://` when no scheme; returns None for empty, for values without a dot, or for e-mail addresses.

`pyproject.toml`: `requires-python = ">=3.12,<3.13"`; dependencies `httpx>=0.27`, `psycopg[binary]>=3.2`, `sentence-transformers>=3`, `unidecode>=1.3`; dev group `pytest>=8`, `respx>=0.21`; pytest `markers = ["integration: needs local Supabase", "slow: downloads the embedding model"]`, default `-m "not integration and not slow"`.

`not_public_keywords.txt` (one per line): `copropriete`, `syndic`, `association syndicale`, `association fonciere`, `amicale du personnel`, `comite d'entreprise`, `comite social et economique`, `association de gestion`, `oeuvres sociales du personnel`, `lotissement`.

- [ ] **Step 1: Init** — `cd importer && uv init --package --name importer --python 3.12 .` (or write files by hand), then `uv add httpx "psycopg[binary]" sentence-transformers unidecode` and `uv add --dev pytest respx`.
- [ ] **Step 2: Write the failing test** `importer/tests/test_text.py`

```python
import pytest
from importer.text import normalise_name, is_likely_not_public, clean_website

@pytest.mark.parametrize("raw, expected", [
    ("Association Le Club de Go d'Évry !", "go evry"),
    ("CLUB D'ÉCHECS DE LYON", "echecs lyon"),
    ("  Amicale  des   Boulistes ", "boulistes"),
])
def test_normalise_name_matches_sql_rule(raw, expected):
    assert normalise_name(raw) == expected

@pytest.mark.parametrize("name, purpose, expected", [
    ("Syndicat de copropriété Les Tilleuls", None, True),
    ("Amicale du personnel de la mairie", "loisirs des agents", True),
    ("Club de Go de Lyon", "pratique du jeu de go", False),
])
def test_is_likely_not_public(name, purpose, expected):
    assert is_likely_not_public(name, purpose) is expected

@pytest.mark.parametrize("raw, expected", [
    ("www.clubgo-lyon.fr", "https://www.clubgo-lyon.fr"),
    ("http://exemple.org/", "http://exemple.org/"),
    ("contact@exemple.org", None), ("", None), ("néant", None), (None, None),
])
def test_clean_website(raw, expected):
    assert clean_website(raw) == expected
```

- [ ] **Step 3: Run to verify it fails** — `cd importer && uv run pytest tests/test_text.py`; Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `models.py` and `text.py`; `__main__.py` calls `importer.cli.main()` (stub `cli.py` with `main()` that prints usage until Task 8).
- [ ] **Step 5: Run** — `uv run pytest`; Expected: all pass. Also add the three `normalise_name` cases to `06_import.test.sql` if not already identical (keeps SQL and Python in step).
- [ ] **Step 6: Commit** — `git commit -m "feat(importer): project scaffold, models and text helpers"`

---

### Task 4: RNA download and parsing

**Files:**
- Create: `importer/importer/rna.py`, `importer/tests/test_rna.py`, `importer/tests/fixtures/rna_sample.csv`, `importer/tests/fixtures/rna_sample_cp1252.csv`

**Interfaces:**
- Consumes: `RnaRecord`.
- Produces:
  - `RNA_DATASET_API = "https://www.data.gouv.fr/api/1/datasets/repertoire-national-des-associations/"`
  - `find_latest_rna_url(client: httpx.Client) -> str` — GET the dataset; among resources whose `title` starts with `rna_waldec` (case-insensitive) and ends in `.zip`, return the `url` of the one with the latest `last_modified`. Raise `RnaSourceError("no rna_waldec resource found")` if none.
  - `REQUIRED_COLUMNS = ("id", "titre", "objet", "position", "date_publi", "date_disso", "adrs_numvoie", "adrs_typevoie", "adrs_libvoie", "adrs_codepostal", "adrs_codeinsee", "adrs_libcommune", "siteweb")`
  - `read_rna_zip(path: Path, departements: set[str] | None) -> Iterator[RnaRecord]` — reads every `.csv` member of the zip; separator `;`; decodes UTF-8 and falls back to `cp1252` per file on `UnicodeDecodeError`; before yielding anything checks each file's header contains all `REQUIRED_COLUMNS` (else `RnaSourceError` listing the missing names); skips rows where `position != 'A'` or `date_disso` is non-empty; skips rows outside `departements` (by INSEE code prefix: 2 chars, or 3 for codes starting with `97`); `address` = `" ".join(non-empty numvoie, typevoie, libvoie)` or None; `published_on` parsed from `date_publi` (`YYYY-MM-DD`), None if empty/invalid; never reads any `dir_*` column. Raises `RnaSourceError("RNA file contained no active association")` if zero rows were yielded overall (empty/truncated download).
  - `class RnaSourceError(Exception)`.
- `read_rna_zip` also accepts a plain `.csv` path (for fixtures): same rules.

Fixture `rna_sample.csv` (header = `REQUIRED_COLUMNS` plus `dir_civilite`, `id_ex`, `objet_social1`), 12 rows: 8 active in 69 (incl. "Club d'Échecs de Lyon", "Club de Go de Lyon" with `siteweb` `www.clubgo-lyon.fr`, a "Syndicat de copropriété …", "Atelier Arduino de Villeurbanne", one with `œ` in the purpose), 1 active in 75, 1 in 971, 1 with `position = D`, 1 active but with `date_disso` filled. `rna_sample_cp1252.csv` is the same content saved as Windows-1252. All names are invented; `dir_civilite` holds `"M."`.

- [ ] **Step 1: Write the failing tests** `importer/tests/test_rna.py`:
  - `test_reads_active_rows_and_skips_dissolved` — 10 records with no filter; none of the two dissolved ids.
  - `test_departement_filter` — `{'69'}` → 8; `{'971'}` → 1; `{'75','69'}` → 9.
  - `test_cp1252_and_utf8_give_identical_records` — the two fixtures yield equal lists; a name equals `"Club d'Échecs de Lyon"`.
  - `test_missing_column_fails_before_yielding` — a CSV without `adrs_codeinsee` raises `RnaSourceError` whose message contains `adrs_codeinsee`, and `next()` is never reached for a row.
  - `test_empty_file_fails` — header only → `RnaSourceError`.
  - `test_no_personal_fields` — `RnaRecord` has no attribute containing `dir`.
  - `test_find_latest_rna_url` — respx mock returning three resources (`rna_import_…zip`, `rna_waldec_20260901.zip`, `rna_waldec_20261001.zip` with later `last_modified`) → returns the 20261001 URL; with no waldec resource → `RnaSourceError`.
- [ ] **Step 2: Run to verify they fail** — `uv run pytest tests/test_rna.py`; Expected: FAIL.
- [ ] **Step 3: Implement `rna.py`** and the fixtures.
- [ ] **Step 4: Run** — `uv run pytest`; Expected: all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(importer): RNA download discovery and resilient CSV parsing"`

---

### Task 5: OpenStreetMap clubs

**Files:**
- Create: `importer/importer/osm.py`, `importer/tests/test_osm.py`, `importer/tests/fixtures/osm_sample.geojsonseq`

**Interfaces:**
- Consumes: `OsmRecord`.
- Produces:
  - `OSMIUM_FILTER = ["nwr/club", "nwr/leisure=sports_centre,sports_hall,dance,fitness_centre", "nwr/amenity=community_centre,social_centre,arts_centre"]` — used by the workflow (Task 9): `osmium tags-filter france-latest.osm.pbf <OSMIUM_FILTER…> -o filtered.osm.pbf` then `osmium export filtered.osm.pbf -f geojsonseq -o clubs.geojsonseq`.
  - `read_osm_geojsonseq(path: Path) -> Iterator[OsmRecord]` — one GeoJSON feature per line (lines may start with the RS character `\x1e`; strip it). Keep features with a non-empty `name`. Point → its coordinates; Polygon/MultiPolygon → mean of the outer ring's vertices (first polygon for multi); other geometries skipped. `osm_id` = `@type/@id` from properties when present, else feature `id`. `website` from `website` or `contact:website` (through `clean_website`), `phone` from `phone` or `contact:phone`, `email` from `email` or `contact:email`, `opening_hours`. `kind` = first matching of `club=<v>`, `leisure=<v>`, `amenity=<v>`.

Fixture: 6 features — node `club=sport` "Go Club Lyon" (with `contact:phone`), node `club=sport` "Club de Go Lyon Sud", closed-way polygon `leisure=sports_centre` "Gymnase Jean Jaurès", node without name, a LineString `club=*` (skipped), node `amenity=community_centre` "Maison des Associations de Villeurbanne".

- [ ] **Step 1: Write the failing tests** `test_osm.py`: count = 4; polygon centroid within 1e-6 of the expected mean; `osm_id` format `node/…`/`way/…`; phone taken from `contact:phone`; RS-prefixed lines parse.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `osm.py`** and the fixture.
- [ ] **Step 4: Run** — `uv run pytest`; Expected: all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(importer): read OSM clubs from osmium GeoJSON export"`

---

### Task 6: Geocoding with cache and commune fallback

**Files:**
- Create: `importer/importer/geocode.py`, `importer/tests/test_geocode.py`

**Interfaces:**
- Consumes: `RnaRecord`, `GeoPoint`.
- Produces:
  - `GEOCODER_CSV_URL` default `"https://data.geopf.fr/geocodage/search/csv"`, overridable by env var `GEOCODER_CSV_URL`.
  - `COMMUNES_URL = "https://geo.api.gouv.fr/communes?fields=code,centre&format=json&geometry=centre"`
  - `address_key(rec: RnaRecord) -> str` — `normalise`-free key: `f"{address or ''}|{postcode or ''}|{insee_code or ''}"`, lower-cased, whitespace collapsed.
  - `class Geocoder(client: httpx.Client, cache: MutableMapping[str, GeoPoint | None], batch_size: int = 5000, min_score: float = 0.4)`
    - `geocode(records: list[RnaRecord]) -> dict[str, GeoPoint | None]` keyed by `rna_id`. Steps: look up `address_key` in `cache`; for misses with an address, POST batches as multipart CSV (`data` file with columns `key,address,postcode,citycode`; form fields `columns=address`, `postcode=postcode`, `citycode=citycode`; read back `latitude`, `longitude`, `result_score`); score ≥ `min_score` → `GeoPoint(…, 'address')`; otherwise, or when there is no address, fall back to the commune centre for `insee_code` (`'municipality'`); no commune → None. Store every outcome (including None) in `cache`. Retry each batch up to 3 times with 2 s, 4 s, 8 s backoff on network errors or 5xx; after that, fall back to commune centres for that batch (never abort the run for geocoding).
    - commune centres loaded once from `COMMUNES_URL` (`[{ "code": "69123", "centre": {"coordinates": [lon, lat]} }, …]`).
- `importer.db` (Task 8) supplies `cache` backed by `importer.geocode_cache`.

- [ ] **Step 1: Write the failing tests** (respx): address hit with score 0.8 → `'address'`; score 0.2 → commune centre; no address → commune centre, no geocoder call; cache hit → no HTTP call; 500 three times → commune fallback and exactly 3 attempts (patch `time.sleep`); batch splitting: 12 records with `batch_size=5` → 3 POSTs; results are stored in the cache dict.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `geocode.py`.**
- [ ] **Step 4: Run** — `uv run pytest`; Expected: all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(importer): batch geocoding with cache and commune fallback"`

---

### Task 7: Keyword tagging and embeddings

**Files:**
- Create: `importer/importer/tagging.py`, `importer/importer/data/keywords.csv`, `importer/importer/embed.py`, `importer/tests/test_tagging.py`, `importer/tests/test_embed.py`

**Interfaces:**
- Produces (`tagging.py`):
  - `class Tagger(rules_path: Path = DATA/"keywords.csv")` — CSV `keyword,category_slug` (header row). Keywords are accent-free lower-case; a keyword matches when it appears as a whole word or whole phrase in the accent-free lower-cased `name + " " + purpose`.
  - `Tagger.tags_for(name: str, purpose: str | None) -> list[str]` — sorted unique category slugs; when a child slug matches, its parent slug (part before the first `-`) is added too.
  - `keywords.csv` covers **every** seeded sub-category slug from `supabase/seed.sql` with 3–8 French keywords each (e.g. `go,games-go`, `jeu de go,games-go`, `echecs,games-chess`, `escalade,sport-climbing`, `arduino,tech-electronics`, `chorale,music-choir`). Use the real slugs from `seed.sql`.
- Produces (`embed.py`):
  - `class Embedder(Protocol)`: `dim: int`; `embed(texts: list[str]) -> list[list[float]]`.
  - `class E5Embedder(model_name="intfloat/multilingual-e5-small", batch_size=128)` — `sentence_transformers.SentenceTransformer`; prepends `"passage: "`; `normalize_embeddings=True`; `dim = 384`.
  - `class FakeEmbedder` — deterministic 384-dim unit vectors derived from `sha256(text)`; for tests and `--embedder fake`.
  - `embedding_text(name: str, purpose: str | None) -> str` = `name` + `"\n"` + (`purpose` or `""`), whitespace-collapsed, truncated to 1,000 characters.
  - `text_hash(text: str) -> str` — hex sha256 of `"e5-small-v1\n" + text` (version prefix forces re-embedding if the model changes).

- [ ] **Step 1: Write the failing tests**
  - `test_tagging.py`: "Club de Go de Lyon" → contains `games-go` and `games`; "Gogo dancers" does **not** get `games-go` (whole word); "Atelier Arduino" → `tech-electronics`, `tech`; every slug in `keywords.csv` exists in `supabase/seed.sql` (parse the seed with a regex for `'<slug>'` inside the categories inserts); every seeded child slug has ≥ 3 keywords.
  - `test_embed.py`: `FakeEmbedder` returns 384-dim vectors with norm ≈ 1, same text → same vector; `text_hash` stable and differs when purpose changes; `embedding_text` truncates at 1,000 chars. A `@pytest.mark.slow` test loads `E5Embedder`, checks `dim == 384`, and that cos("club de jeu de go", "association des joueurs de go") > cos("club de jeu de go", "chorale paroissiale").
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** both modules and `keywords.csv`.
- [ ] **Step 4: Run** — `uv run pytest` then `uv run pytest -m slow` once (downloads the model ~120 MB); Expected: all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(importer): keyword tagging and e5 embeddings"`

---

### Task 8: Database loading and the `run` command

**Files:**
- Create: `importer/importer/db.py`, `importer/importer/cli.py` (replace stub), `importer/tests/test_integration.py`

**Interfaces:**
- Consumes: everything above; `importer.apply_run`, `import_runs`, `importer.staged_*`, `importer.geocode_cache`.
- Produces (`db.py`, all take a `psycopg.Connection`):
  - `start_run(conn, scope: list[str] | None) -> UUID` — inserts `import_runs` row, commits.
  - `existing_hashes(conn) -> tuple[dict[str, str], dict[str, str]]` — `rna_id → embedding_hash`, `osm_id → embedding_hash`.
  - `GeocodeCache(conn)` — `MutableMapping[str, GeoPoint | None]` backed by `importer.geocode_cache` (reads lazily per key batch; writes with upsert).
  - `stage(conn, run_id, rna: Iterable[StagedRna], osm: Iterable[StagedOsm]) -> None` — `COPY … FROM STDIN` into the staging tables (points as `SRID=4326;POINT(lon lat)`, vectors as `[x,y,…]` text).
  - `apply(conn, run_id, scope) -> dict` — `select importer.apply_run(%s, %s)`, commit, return counts.
  - `fail_run(conn, run_id, error: str) -> None` — rollback, delete this run's staging rows, set `status='failed'`, `finished_at`, `error` (first 2,000 chars).
- Produces (`cli.py`): `python -m importer run --db-url URL [--departements 69,75] [--rna-zip PATH] [--osm-geojsonseq PATH] [--skip-osm] [--embedder e5|fake]`
  - `--db-url` defaults to env `IMPORTER_DB_URL`.
  - Without `--rna-zip`, downloads the latest RNA zip (Task 4) to a temp dir (streamed).
  - Order: start_run → read RNA (fails here on bad file, before any staging) → read OSM → geocode RNA → tag → embed only rows whose `text_hash` differs from `existing_hashes` (others staged with `embedding = None`) → stage → apply → print counts as JSON.
  - Any exception after `start_run` → `fail_run` and exit code 1. Exit 0 with counts on success.
  - Logs progress every 50,000 rows to stderr.

- [ ] **Step 1: Write the failing integration test** `test_integration.py` (marker `integration`; needs `npm run db:reset` first; DB URL `postgresql://postgres:postgres@127.0.0.1:55322/postgres`):
  - run `cli.main(["run", "--db-url", URL, "--departements", "69", "--rna-zip", "tests/fixtures/rna_sample.csv", "--osm-geojsonseq", "tests/fixtures/osm_sample.geojsonseq", "--embedder", "fake"])` with the geocoder and commune HTTP calls mocked by respx (commune centres for 69123 and 69266);
  - assert: 8 RNA listings in 69; "Club de Go de Lyon" is `rna+osm` with the OSM phone; "Club de Go Lyon Sud" exists as `osm`; the copropriété listing has `likely_not_public = true`; `association_tags` for "Club de Go de Lyon" include `games-go`; every listing has a 384-dim embedding; last `import_runs` row `succeeded`;
  - run the same command again: counts show `inserted = 0`, and the fake embedder was called with **zero** texts (hashes unchanged);
  - run with a CSV missing `adrs_codeinsee`: exit code 1, last run `failed` with the column name in `error`, listing count unchanged.
- [ ] **Step 2: Run to verify it fails** — `npm run db:reset` (repo root), then `cd importer && uv run pytest -m integration`; Expected: FAIL.
- [ ] **Step 3: Implement `db.py` and `cli.py`.**
- [ ] **Step 4: Run** — `uv run pytest -m integration` and `uv run pytest`; Expected: all pass. Also `npm run db:test` still green.
- [ ] **Step 5: Commit** — `git commit -m "feat(importer): staging loader and run command"`

---

### Task 9: Scheduled import, CI and runbook

**Files:**
- Create: `.github/workflows/import.yml`, `importer/README.md`
- Modify: `.github/workflows/ci.yml` (add `importer` job), root `README.md` (one line linking the importer runbook)

**Interfaces:**
- Consumes: `python -m importer run`, `OSMIUM_FILTER`.
- `import.yml`:
  - triggers: `schedule: cron '0 3 5 * *'` (05th of each month, 03:00 UTC) and `workflow_dispatch` with input `departements` (string, default empty = all France);
  - one job on `ubuntu-latest`, `timeout-minutes: 350`, `concurrency: import` (never two imports at once);
  - steps: checkout; `astral-sh/setup-uv@v5`; `sudo apt-get install -y osmium-tool`; cache `~/.cache/huggingface` (key `e5-small-v1`); download `https://download.geofabrik.de/europe/france-latest.osm.pbf`; `osmium tags-filter` + `osmium export` with `OSMIUM_FILTER`; `uv run --project importer python -m importer run --osm-geojsonseq clubs.geojsonseq ${{ inputs.departements && format('--departements {0}', inputs.departements) || '' }}` with env `IMPORTER_DB_URL: ${{ secrets.IMPORTER_DB_URL }}`.
- `ci.yml` new job `importer`: checkout, setup-uv, `cd importer && uv sync && uv run pytest` (unit tests only; integration needs Supabase and runs locally; the database job already covers `06_import.test.sql`).
- `importer/README.md` runbook: local sample run (commands from Task 8 test); secrets (`IMPORTER_DB_URL` = the hosted project's **direct** Postgres connection string, stored only in GitHub secrets); **first full run in batches** via manual dispatch (`01,02,…,30`, then `31…60`, `61…95,2A,2B`, then `971,972,973,974,976`) because the first run embeds ~1–1.5 M texts; later monthly runs only embed changed rows; Supabase Pro is required before the first full run (DB size); what to do when a run fails (check `import_runs.error`; data stays live); OSM coverage note (Geofabrik `france` extract = metropolitan France; overseas OSM clubs are a later addition).

- [ ] **Step 1: Write the workflows and README.**
- [ ] **Step 2: Validate YAML** — `npx --yes js-yaml .github/workflows/import.yml > /dev/null && npx --yes js-yaml .github/workflows/ci.yml > /dev/null`; Expected: no error. (Workflows run for real once the repo is on GitHub and the secret is set.)
- [ ] **Step 3: Run all local suites once** — `npm run db:test`, `cd importer && uv run pytest`, `cd app && npm test`; Expected: all pass.
- [ ] **Step 4: Commit** — `git commit -m "ci: monthly association import and importer tests"`
