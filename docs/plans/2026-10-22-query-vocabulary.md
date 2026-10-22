# Query Embeddings Without a Server (Sub-project 3, follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Semantic search works in production at **zero extra cost and with no new account**: the meaning of a search query is looked up in a precomputed **query vocabulary** stored in Postgres (phrases embedded offline by the same `multilingual-e5-small` model, on GitHub Actions), instead of being computed live by a server.

**Architecture:** The importer (Python, already running monthly on GitHub Actions) extracts the words and short phrases people are likely to type — 1–3-word phrases that occur in the names and purposes of the 1.5 M associations, every category and tag name, the tagging keywords, and queries users actually typed (anonymised, seen at least twice) — embeds them with `"query: "` exactly like a live query would be, and stores them in a private table `search.query_vocab`. At search time `public.search_explore` resolves the query inside the database: exact phrase → closest spelling (typo) → the most specific known word or phrase of the query → otherwise keyword-only, as today. The Supabase Edge Function `embed-query`, which cannot run within Supabase's limits, is removed.

**Tech Stack:** Supabase Postgres (pgvector `vector(384)`, pg_trgm GiST for nearest spelling, pg_cron), pgTAP; Python 3.12 importer (sentence-transformers, psycopg 3, pytest); GitHub Actions (monthly import job + nightly short job); Expo app (Jest).

**Spec:** `docs/specs/2026-10-21-friend-app-design.md` — §3 (cost: "embedding model … Free"; budget ~€25/month), §6 (semantic + full-text search, "the query is embedded with the same model"), §13 (ranking tests), §18 (minimisation, `search_misses` holds no user id). Builds on `docs/plans/2026-10-22-explore-search.md` (branch `feat/explore-search`), whose decision 1 (Edge Function) failed in CI: every request hit the Edge runtime's **CPU limit (~2 s)** then its **memory limit** (run 18, commit 5adacf0).

## Why this approach (owner to confirm)

What we need is: turn the user's query text into the same kind of 384-number vector the associations already have, using **the same model** (`intfloat/multilingual-e5-small`), so that "coder" lands near "Atelier Arduino". The model needs ~120 MB of weights, a few hundred MB of RAM and ~0.1–1 s of CPU per call. Options:

| Option | Monthly cost | Needs | Main drawbacks |
|---|---|---|---|
| A. Supabase Edge Function (tried) | €0 | — | **Fails**: Edge limits (~2 s CPU, small memory) cannot hold the model |
| B. Google Cloud Run (Paris) | ~€0 within the free tier (2 M requests, 180 k vCPU-s per month) | Google account **with a bank card / billing account**, a deploy secret | Bill if traffic or abuse exceeds the free tier (alerts do not cap spending); 5–10 s cold start after idle; one more cloud account to run |
| C. Hugging Face Spaces (free CPU) | €0 | HF account | Sleeps after 48 h without traffic (~1 min wake-up); hosted in the US (RGPD transfer); not meant for production APIs |
| D. Oracle Cloud "Always Free" VM | €0 | Account **with a bank card** | You maintain a Linux server (updates, security) |
| E. Model inside the app | €0 | — | +120 MB download per phone; slow on low-end phones |
| F. Cloudflare Workers AI | €0 within 10 k "neurons"/day | Cloudflare account | Different model → all 1.5 M associations must be re-embedded; daily quota |
| **G. Precomputed query vocabulary (this plan)** | **€0** | Nothing new: existing Supabase + GitHub Actions | Queries made of words never seen anywhere are approximated (their most specific known phrase) or fall back to keyword search |

**Recommendation: G.** It costs nothing, adds no account, no server and no cold start (lookups take milliseconds inside the search query), and its vectors are produced by the **exact** Python model the ranking set was tuned on, so the parity problem disappears. Its limit is long, unusual sentences — rare in this app, where people type "escalade", "jeu de go", "danse bretonne". If one day money allows, option B can be added on top without changing anything: `search_explore` keeps its optional `p_query_embedding` parameter, which a live service could fill.

Decisions to confirm:
1. **Approach G** instead of a paid or card-backed service. *Owner to confirm.*
2. **Remove the Edge Function `embed-query`** and everything around it (cache table, CI steps, app call, Deno tests). Nothing was ever deployed. *Owner to confirm.*
3. **Vocabulary size:** at most **150,000** phrases (≈ 230 MB in the database), chosen by how many associations use them: single words used by ≥ 3 associations, 2–3-word phrases by ≥ 5; categories, tags, keywords and watch-list phrases always included. *Owner to confirm.*
4. **Learning from users:** a query that is not in the vocabulary is recorded **anonymised** (same rule as search misses, no user id, no position) in `search.vocab_requests`; once **seen twice**, the nightly job adds it to the vocabulary and deletes the request. Requests older than 90 days are deleted. *Owner to confirm.*
5. **Free up ~2 GB:** drop the two HNSW vector indexes (`associations_embedding_hnsw`, `activities_embedding_hnsw`). Search never uses them (it scans within the radius; the perf test already drops one), and they would push the database past the 8 GB of Supabase Pro once the vocabulary is added. *Owner to confirm.*

## Global Constraints

- **No new paid service, account or secret.** Everything runs in the existing Supabase project and GitHub Actions.
- **Same model and recipe as documents, query side:** `intfloat/multilingual-e5-small`, input `"query: " + normalised phrase`, mean pooling, L2-normalised, 384 dims (`E5Embedder.embed_queries`). Vocabulary rows carry `model = 'e5-small-v1'`; a different value means "re-embed".
- **Query normalisation, identical in SQL, Python and the app:** Unicode NFC, trim and collapse whitespace using the explicit class `[ \t\n\r\f\v   -     　﻿]`, lower-case, cut to 200 code points. Shared fixture: `shared/normalise_cases.json` (moved from `supabase/functions/embed-query/`).
- **Tokenisation, identical in SQL and Python:** split the normalised text on `[ '’\-.,;:!?()"/«»…]+`; drop empty tokens. Stop-words: `importer/importer/data/stopwords_fr.txt` (single source; the migration seeds `search.stopwords` from the same list and a test checks they match): `a à au aux avec ce ces d dans de des du en et l la le les leur leurs mon ma mes ou par pour sa se ses son sur ta te tes ton un une vos votre nos notre club association asso`.
- **Resolution order (first that succeeds):** `exact` phrase → `fuzzy` (closest phrase by trigram, similarity ≥ **0.5** ("escalde" → "escalade" scores 0.55; "yoda" → "yoga" 0.25), only for queries of ≥ **4** characters) → `words` (the vector of the single most specific unit — non-stop-word token or run of 2–3 adjacent tokens — found in the vocabulary: most tokens first, then lowest `doc_freq` (every phrase, curated ones included, gets its real association count on a full build; only a phrase inserted by a requests-only build has 0 until the next full build), then alphabetical; only if the matched units cover ≥ **50 %** of its non-stop-word tokens) → `none` (keyword-only search, unchanged behaviour). A `p_query_embedding` passed by a caller wins over all of these.
  - *Averaging the matched units was dropped: multilingual-e5 vectors share a large common component, so the average collapsed toward it and every association scored alike (CI run 27).*
- **Privacy:** `search.vocab_requests` stores only `search.anonymise_query(...)` output, a hit count and dates — never a user id, position or precise time (`first_seen`/`last_seen` are dates). Only API-unreachable schemas (`search`) hold vocabulary data.
- **Ranking:** `search.params()` values are not changed by this plan unless the ranking set requires it; any change goes with a green ranking run (README rule).
- Local Supabase ports 553xx. No Docker in the cloud build container: pgTAP runs on the local PG16 harness (pgvector 0.6 — hence `vector(384)`, no `halfvec`, no `l2_normalize`; cosine distance ignores vector length). CI runs real Supabase.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Normalisation drift between SQL and Python** (e.g. `lower()` not lower-casing `É` under the database's `C` collation): a vocabulary built in Python would never match the query normalised in SQL, and every search would silently fall back. → shared-fixture test run against real Supabase in Task 2 and against SQL from Python in Task 4.
2. **A common query missing from the vocabulary** degrades to keyword-only without anyone noticing. → watch-list coverage report (Task 3) printed by every build, the `words` fallback tests (Task 4), and the request-learning path (Tasks 2–3).
3. **Fuzzy match grabbing the wrong phrase** for short or ambiguous queries ("go" → "gol", "yoga" → "yoda"). → exact first, fuzzy only ≥ 4 characters and ≥ 0.5; tests in Task 2.
4. **User text becoming permanent vocabulary** (a name or phone number typed in the search bar). → only anonymised text, only after 2 sightings, 90-day pruning; tests in Task 2 and Task 3.
5. **Hosted database size and build time** (1.5 M associations): the build must stream, be incremental (second run embeds 0 phrases) and stay under the cap. → idempotency test in Task 3, size report in Task 5.

---

## File Map

```
shared/normalise_cases.json                          (moved) normalisation fixture for SQL, Python, app
supabase/migrations/20261022000007_search.sql        (modify) drop query_embedding_cache + its cron job; drop HNSW indexes
supabase/migrations/20261022000008_query_vocab.sql   search.normalise_query, search.tokens, search.stopwords,
                                                     search.query_vocab, search.vocab_requests,
                                                     search.resolve_query(), search_explore uses it, pruning job
supabase/tests/09_query_vocab.test.sql               pgTAP for resolution, logging, privacy, access
supabase/functions/embed-query/                      (delete)
supabase/config.toml                                 (modify) remove [functions.embed-query]
importer/importer/embed.py                           (modify) comment points to shared fixture
importer/importer/vocab.py                           phrase extraction, sources, incremental build, coverage
importer/importer/data/stopwords_fr.txt              stop-words (single source)
importer/importer/data/vocab_watchlist.txt           phrases whose coverage every build reports
importer/importer/cli.py                             (modify) `vocab` command
importer/tests/test_vocab.py                         unit tests (FakeEmbedder)
importer/tests/test_vocab_integration.py             build against local DB (marker integration)
importer/tests/ranking/conftest.py                   (modify) build vocabulary from the fixture; production path
importer/tests/ranking/test_search_ranking.py        (modify) spec queries through the vocabulary; fallback tests
importer/tests/ranking/test_normalise_sql.py         SQL vs Python normalisation/tokens on the shared fixture
importer/tests/ranking/{edge_client,test_edge_client,test_embed_parity}.py   (delete)
importer/pyproject.toml                              (modify) drop `edge` marker
app/src/features/explore/{api,useExploreSearch,types}.ts   (modify) no embedding call
app/__tests__/{explore-api,explore-hooks,explore-normalise}.test.*   (modify)
.github/workflows/ci.yml                             (modify) drop edge job and serve/parity steps
.github/workflows/import.yml                         (modify) vocabulary build after the import
.github/workflows/vocab.yml                          nightly requests-only build
README.md                                            (modify) Search section: vocabulary, runbook, costs
```

---

### Task 1: Remove the Edge Function path

**Files:**
- Delete: `supabase/functions/embed-query/` (all files), `importer/tests/ranking/edge_client.py`, `importer/tests/ranking/test_edge_client.py`, `importer/tests/ranking/test_embed_parity.py`
- Move: `supabase/functions/embed-query/normalise_cases.json` → `shared/normalise_cases.json`
- Modify: `supabase/config.toml`, `supabase/migrations/20261022000007_search.sql`, `supabase/tests/07_search.test.sql`, `importer/pyproject.toml`, `importer/importer/embed.py`, `importer/tests/test_embed.py`, `importer/tests/ranking/conftest.py`, `app/src/features/explore/{api.ts,useExploreSearch.ts,types.ts}`, `app/__tests__/{explore-api.test.ts,explore-hooks.test.tsx,explore-normalise.test.ts}`, `.github/workflows/ci.yml`, `README.md`, `.gitignore`

**Interfaces:**
- Produces (app): `searchExplore(p: ExploreParams, page: { limit: number; offset: number }): Promise<ExploreResponse>` — no embedding argument; it never sends `p_query_embedding`. `embedQuery` and the embedding cache in `useExploreSearch` are removed. `normaliseQuery` stays (debounce key), its comment points to `shared/normalise_cases.json`.
- Produces (SQL, migration 007 edited in place — it has never been applied to a hosted database): no `public.query_embedding_cache`, no `prune-query-embedding-cache` cron job; `drop index if exists associations_embedding_hnsw, activities_embedding_hnsw` (decision 5). `search_explore` keeps `p_query_embedding` (optional, unchanged semantics).
- Produces (CI): no `edge` job; the `ranking` job keeps only Supabase start, uv, model cache, `RANKING_REPORT=1 uv run pytest -m ranking -s`, with job `timeout-minutes: 45`.

- [ ] **Step 1: Update the tests first** — app: `explore-api.test.ts` asserts `searchExplore` sends no `p_query_embedding` key; `explore-hooks.test.tsx`: typing a query calls `searchExplore` once after 350 ms with no embedding fetch; `explore-normalise.test.ts` reads `../../shared/normalise_cases.json`. pgTAP 07: `hasnt_table('public', 'query_embedding_cache')`, `hasnt_index('public', 'associations', 'associations_embedding_hnsw')`. Python `test_embed.py` reads `shared/normalise_cases.json`.
- [ ] **Step 2: Run to verify they fail** — `cd app && npm test`; `db.sh reset && db.sh test` (or `npm run db:reset && npm run db:test` with Docker); `cd importer && uv run pytest`. Expected: the new assertions fail.
- [ ] **Step 3: Delete and edit** per Files/Interfaces; README "Search" loses the Edge/spike sections (replaced in Task 5); `.gitignore` drops `/deno.lock`.
- [ ] **Step 4: Run everything** — app `npm test && npx tsc --noEmit && npm run lint`; all db suites; `uv run pytest`; `npx --yes js-yaml .github/workflows/ci.yml`. Expected: all pass, no reference to `embed-query` left (`grep -rn "embed-query\|embedQuery" --exclude-dir=node_modules .` returns only docs/plans).
- [ ] **Step 5: Commit** — `git commit -m "refactor(search): remove the embed-query Edge Function path"`

---

### Task 2: Vocabulary tables and in-database query resolution

**Files:**
- Create: `supabase/migrations/20261022000008_query_vocab.sql`, `supabase/tests/09_query_vocab.test.sql`

**Interfaces:**
- Consumes: schema `search` (private), `search.anonymise_query`, `search.params()`, `public.search_explore`.
- Produces:
  - `search.normalise_query(text) returns text` immutable — Global Constraints rule. NFC via `normalize(x, NFC)`; lower-case via `lower(x collate "und-x-icu")` if `lower('É')` under the default collation is not `'é'` on Supabase (the fixture test decides; use the ICU collation if the plain call fails the test).
  - `search.tokens(text) returns text[]` immutable — tokenises an already-normalised string per Global Constraints.
  - `search.stopwords(word text primary key)` seeded with the Global Constraints list.
  - `search.query_vocab(phrase text primary key, embedding extensions.vector(384) not null, source text not null check (source in ('ngram','category','tag','keyword','watchlist','request')), doc_freq int not null default 0, model text not null default 'e5-small-v1', updated_at timestamptz not null default now())`; index `query_vocab_phrase_trgm using gist (phrase gist_trgm_ops)`.
  - `search.vocab_requests(phrase text primary key, hits int not null default 1, first_seen date not null default current_date, last_seen date not null default current_date)`.
  - `search.params()` gains: `vocab_fuzzy_sim real = 0.5`, `vocab_fuzzy_min_len int = 4`, `vocab_words_cover real = 0.5`, `vocab_request_min_hits int = 2`, `vocab_request_days int = 90`.
  - `search.resolve_query(p_query text) returns table(embedding extensions.vector, method text, matched text)` stable — `method` in `exact|fuzzy|words|none`; `matched` = the vocabulary phrase (exact/fuzzy), the chosen unit (words), or null. Fuzzy uses `order by phrase <-> q limit 1` then checks `similarity(phrase, q) >= vocab_fuzzy_sim`. Words returns the vector of the most specific unit found exactly among the non-stop-word tokens and runs of 2–3 adjacent tokens (`"danse bretonne"`): most tokens, then lowest `doc_freq`, then phrase — no average; coverage = distinct covered non-stop-word tokens / non-stop-word tokens.
  - `search.log_vocab_request(p_query text) returns void` — when `method` is `words` or `none` and `search.anonymise_query(p_query)` has ≥ 2 characters: upsert into `search.vocab_requests` (`hits + 1`, `last_seen = current_date`).
  - `public.search_explore`: when `p_query_embedding` is null and the query is not blank, take the embedding from `search.resolve_query(p_query)`; `mode` stays `search` when an embedding was found, `keyword_only` otherwise; on `p_offset = 0` call `search.log_vocab_request`. The response gains `"query_match": "exact"|"fuzzy"|"words"|"none"|"given"|null` (null in browse).
  - pg_cron job `prune-vocab-requests` at `20 4 * * *`: delete requests with `last_seen < current_date - vocab_request_days`.
  - Privileges: nothing in this migration is granted to `anon`, `authenticated` or `service_role` beyond what `search_explore` (security definer) already has.

- [ ] **Step 1: Write the failing test** `09_query_vocab.test.sql` (vectors from a local `tests.vec(s)` helper like 07, so similarity is exact). As superuser insert vocabulary rows `('escalade', vec .99)`, `('jeu de go', …)`, `('danse', …)`, `('bretonne', …)`, `('danse bretonne', …)`, `('yoga', …)`, `('go', …)`. Assertions:
  - normalisation: `search.normalise_query('  Jeu  de GO ')` = `'jeu de go'`; `search.normalise_query('ÉCHECS')` = `'échecs'`; a 250-character input gives 200 characters; NBSP and `U+FEFF` are whitespace (the full shared fixture is checked from Python in Task 4).
  - tokens: `search.tokens('cours d''escalade pour débutants')` = `{cours,d,escalade,pour,débutants}`.
  - resolution: `'Jeu de GO'` → `exact`, matched `jeu de go`; `'escalde'` → `fuzzy`, matched `escalade`; `'go'` (2 chars, absent variant `'gol'`) → only exact may match: `'gol'` → `none`, not `fuzzy`; `'cours de danse bretonne'` → `words` with matched `danse bretonne` and exactly that phrase's vector; two matched pairs → the lower `doc_freq` wins; `'xyzzy plugh'` → `none`, embedding null; `'yoda'` → `none` (similarity to `yoga` 0.25 < 0.5).
  - search: `search_explore(4.835, 45.764, 10, 'escalde')` returns `mode = 'search'` and `query_match = 'fuzzy'`; with `p_query_embedding => tests.vec(1.0)` → `query_match = 'given'`; `'xyzzy plugh'` → `mode = 'keyword_only'`.
  - learning and privacy: two searches for `'cours de danse bretonne'` → one `vocab_requests` row with `hits = 2`; a search for `'appelez 0612345678 yoga'` stores `'appelez yoga'`; an `exact` match stores nothing; a page-2 call (`p_offset => 20`) stores nothing; `first_seen` is a `date`.
  - access: as `anon` and `authenticated`, `select` on `search.query_vocab` and `search.vocab_requests` raises `42501`; `has_function_privilege('anon', 'search.resolve_query(text)', 'execute')` is false.
- [ ] **Step 2: Run to verify it fails** — `db.sh test …/09_query_vocab.test.sql`; Expected: FAIL (functions missing).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run all suites** — `db.sh reset && db.sh test`; Expected: 10 files ok (07 and 08 unchanged results).
- [ ] **Step 5: Commit** — `git commit -m "feat(db): query vocabulary and in-database query resolution"`

---

### Task 3: Vocabulary builder in the importer

**Files:**
- Create: `importer/importer/vocab.py`, `importer/importer/data/stopwords_fr.txt`, `importer/importer/data/vocab_watchlist.txt`, `importer/tests/test_vocab.py`, `importer/tests/test_vocab_integration.py`
- Modify: `importer/importer/cli.py`

**Interfaces:**
- Consumes: `E5Embedder.embed_queries`, `FakeEmbedder.embed_queries`, `normalise_query` (embed.py), `importer/importer/data/keywords.csv`, tables `associations`, `categories`, `tags`, `search.query_vocab`, `search.vocab_requests`.
- Produces (`vocab.py`):
  - `STOPWORDS: frozenset[str]` (from the data file); `tokens(normalised: str) -> list[str]` — same split as `search.tokens`.
  - `phrases(text: str) -> set[str]` — the distinct 1-, 2- and 3-token phrases of `normalise_query(text)` that neither start nor end with a stop-word, contain at least one letter and have ≥ 2 characters (inner stop-words kept: `"jeu de go"`).
  - `count_document_phrases(rows: Iterable[tuple[str, str | None]]) -> Counter[str]` — each association (name, purpose) counts a phrase once.
  - `select_phrases(counts: Counter[str], *, min_df_unigram: int = 3, min_df_multi: int = 5, cap: int = 150_000, always: Iterable[str] = ()) -> dict[str, int]` — `always` phrases (categories, tags, keywords, watch-list, requests) are kept regardless and count against the cap first; the rest by descending document frequency, ties alphabetical.
  - `build(conn, embedder: Embedder, *, requests_only: bool = False, min_df_unigram=3, min_df_multi=5, cap=150_000, batch_size=512) -> BuildReport` — streams associations with a server-side cursor; skips phrases already present with `model = 'e5-small-v1'`; embeds only new ones (`embed_queries`); loads them with `COPY` into a temp table and upserts into `search.query_vocab`; updates `doc_freq` of existing rows; deletes `ngram` rows that fell out of the selection; moves requests with `hits >= vocab_request_min_hits` into the vocabulary (`source = 'request'`) and deletes them from `search.vocab_requests`. `requests_only=True` processes only requests and the watch-list.
  - `BuildReport` dataclass: `phrases_total`, `embedded_new`, `removed`, `requests_added`, `table_mb`, `coverage: dict[str, str]` (watch-list phrase → `exact|fuzzy|words|none`, from `search.resolve_query`).
  - `vocab_watchlist.txt`: `coder`, `programmation`, `jeu de go`, `échecs`, `danse bretonne`, `escalade`, `arduino`, `python`, `yoga`, `randonnée`, `chorale`, `théâtre`, `course à pied`, `jeux de société`, `couture`, `photographie`, `bénévolat`, `anglais`, `méditation`, `vélo`.
- Produces (`cli.py`): `python -m importer vocab --db-url URL [--requests-only] [--embedder e5|fake] [--cap N]` — prints the `BuildReport` as JSON; exit 1 on error; prints a warning line (exit 0) for every watch-list phrase whose coverage is `none`.

- [ ] **Step 1: Write the failing tests**
  - `test_vocab.py` (FakeEmbedder): `phrases("Club de Go de Lyon")` = `{"go", "lyon", "go de lyon"}`; `phrases("Jeu de go")` contains `"jeu de go"` and not `"de go"`; `tokens` equals the SQL expectation of Task 2 for the same input; the stop-word file equals the list in the migration (parse the `insert into search.stopwords` line); `select_phrases` keeps an `always` phrase with df 0, drops a unigram with df 2 and a bigram with df 4, honours `cap`, and is deterministic on ties; `count_document_phrases` counts a phrase repeated inside one purpose once.
  - `test_vocab_integration.py` (marker `integration`, local DB): insert 6 associations whose purposes repeat "escalade en salle" ≥ 5 times; `build(..., min_df_unigram=1, min_df_multi=1)` creates rows for `escalade`, `escalade en salle` and every seeded category name; a second `build` reports `embedded_new == 0`; a `vocab_requests` row with `hits = 2` becomes a `request` vocabulary row and disappears from requests, one with `hits = 1` stays; `requests_only=True` does not touch `ngram` rows; `coverage` reports a watch-list phrase present in the DB as `exact`.
- [ ] **Step 2: Run to verify they fail** — `cd importer && uv run pytest tests/test_vocab.py` and `-m integration tests/test_vocab_integration.py`; Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `vocab.py`, the data files and the CLI command.
- [ ] **Step 4: Run** — `uv run pytest` and `uv run pytest -m integration`; Expected: pass. Time a `--embedder fake` build on 150,000 synthetic associations on the local harness and note phrases/second in the report (the real model is ~5× slower; GitHub runners have 4 CPUs).
- [ ] **Step 5: Commit** — `git commit -m "feat(importer): query vocabulary builder"`

---

### Task 4: Ranking set through the vocabulary (production path)

**Files:**
- Modify: `importer/tests/ranking/conftest.py`, `importer/tests/ranking/test_search_ranking.py`
- Create: `importer/tests/ranking/test_normalise_sql.py`

**Interfaces:**
- Consumes: `vocab.build`, `search.normalise_query`, `search.tokens`, `search_explore` without `p_query_embedding`.
- Conftest: after loading the Lyon fixture, call `vocab.build(conn, E5Embedder(), min_df_unigram=1, min_df_multi=1)` (the fixture is tiny, so every phrase counts), then add the four spec queries (`coder`, `jeu de go`, `danse bretonne`, `escalade`) as `watchlist` rows — in production their presence is checked by the coverage report, which runs on the real data (Task 5). The `search` fixture calls `search_explore` with the query only. `RANKING_REPORT` also prints `query_match` per query.

- [ ] **Step 1: Write the failing tests**
  - Spec set: the four existing tests keep every expectation and now also assert `query_match == 'exact'`.
  - Fallbacks: `"cours de danse bretonne pour débutants"` → `query_match == 'words'`, "Cercle celtique de Lyon" in the top 3; `"escalde"` → `query_match == 'fuzzy'`, "Club alpin Lyon-Villeurbanne" in the top 3; `"zzz qqq"` → `mode == 'keyword_only'` and no error.
  - `test_normalise_sql.py` (marker `ranking`, needs the DB): for every case of `shared/normalise_cases.json`, `select search.normalise_query(%s)` equals both the expected value and Python `normalise_query`; for 20 varied phrases (accents, apostrophes, hyphens, `«»`), `search.tokens(search.normalise_query(x))` equals `vocab.tokens(normalise_query(x))`.
- [ ] **Step 2: Run to verify they fail** — CI only (huggingface.co is blocked in the cloud build container): push and read the `ranking` job; locally `uv run pytest -m ranking --collect-only` collects. Expected: FAIL (`query_match` missing before Task 2 lands, or vocabulary missing).
- [ ] **Step 3: Implement** the conftest changes.
- [ ] **Step 4: Run** — CI ranking job green. If a spec expectation fails, read `RANKING_REPORT`; exact-path vectors are identical to the ones the parameters were tuned on, so a failure means a resolution bug, not a tuning need — fix the bug, do not change `search.params()`.
- [ ] **Step 5: Commit** — `git commit -m "test(search): ranking set through the query vocabulary"`

---

### Task 5: Scheduled builds, runbook and costs

**Files:**
- Modify: `.github/workflows/import.yml`, `README.md`
- Create: `.github/workflows/vocab.yml`

**Interfaces:**
- `import.yml`: after the import step, `uv run --project importer python -m importer vocab --db-url "$IMPORTER_DB_URL"` (same secret, same model cache key `e5-small-v1`). A vocabulary failure fails the job but leaves the previous vocabulary in place (the build commits only at the end).
- `vocab.yml`: `schedule: cron '17 2 * * *'` and `workflow_dispatch`; `concurrency: import` (never alongside an import); `timeout-minutes: 30`; runs `python -m importer vocab --requests-only`.
- README "Search" section: how query meaning is resolved (exact → fuzzy → words → keyword-only); what the nightly and monthly jobs do; how to read the coverage report and add a phrase (append to `vocab_watchlist.txt`, rerun `vocab.yml` by hand); the size check (`select pg_size_pretty(pg_total_relation_size('search.query_vocab'))`, expected ≈ 230 MB at the cap); costs (€0: Supabase Pro already paid, GitHub Actions minutes — ≈ 3 min per nightly run, ≈ 30–60 min per monthly build, inside the free 2,000 min/month of a private repository); the upgrade path (a live embedding service can pass `p_query_embedding` later); first run: trigger `import.yml` (or `vocab.yml` with the full build input) once after deploying the migrations.

- [ ] **Step 1: Write the workflows and README section.**
- [ ] **Step 2: Validate YAML** — `npx --yes js-yaml .github/workflows/vocab.yml > /dev/null && npx --yes js-yaml .github/workflows/import.yml > /dev/null`; Expected: no error.
- [ ] **Step 3: Run every local suite once** — db suites, `uv run pytest`, app `npm test && npx tsc --noEmit && npm run lint`; Expected: all pass. Push and confirm the CI run is green (database, importer, app, ranking).
- [ ] **Step 4: Commit** — `git commit -m "ci(search): monthly and nightly query vocabulary builds; runbook"`

---

## Out of scope

- A live embedding service (option B or others): possible later through `p_query_embedding`, no code needed now.
- Semantic suggestions from interests (sub-project 4): interests are categories, which are in the vocabulary, so sub-project 4 can call `search.resolve_query(category name)`.
- Admin views of vocabulary coverage and requests (sub-project 14).
