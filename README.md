# Friend App

Une application francaise pour se faire des amis grace a des activites recurrentes (Expo Android + Supabase).

## Prerequisites

- Node 22 LTS or newer
- Docker Desktop (running)
- Android Studio with an emulator (API 34+)
- Git

Directory import runbook: [importer/README.md](importer/README.md)

## Local database

```bash
npm install
npm run db:start   # start local Supabase
npm run db:reset   # apply migrations
npm run db:test    # run pgTAP tests
npm run db:types   # generate TypeScript types
```

## Local ports

The local Supabase stack uses ports in the 553xx range instead of the 543xx defaults, because Windows reserves TCP 54190-54589 (Hyper-V/WSL) and `supabase start` fails to bind there.

| Service | Port |
| --- | --- |
| API (use `http://127.0.0.1:55321`) | 55321 |
| Database | 55322 |
| Studio | 55323 |
| Inbucket (mail) | 55324 |
| Analytics | 55327 |
| Pooler | 55329 |
| Shadow database | 55320 |

## Search

Search combines keyword matching with semantic ranking. The semantic side needs an
embedding for the user's query; the database finds it in the query vocabulary
(`search.query_vocab`) instead of calling an embedding service at request time.

### How a query gets its meaning

`search.resolve_query` normalises the query and tries, in order (first match wins):

1. **exact**: the normalised phrase is in the vocabulary.
2. **fuzzy**: typo tolerance. Only for queries of at least 4 characters, the closest phrase
   by trigram similarity (at least 0.5) with the same number of words ("escalde" finds "escalade").
3. **words**: the single most specific known phrase inside the query (most tokens, then the
   rarest), used only if the known words cover at least 50 % of the query's non-stop-word
   tokens. Averaging vectors was dropped: e5 vectors share a large common component.
4. **none**: keyword-only search, as before.

The response field `query_match` says which one applied. A `p_query_embedding` passed by a
caller wins over all of these.

### Vocabulary builds

Both jobs run `python -m importer vocab` and use the same model as documents
(`intfloat/multilingual-e5-small`, rows tagged `e5-small-v1`). The build commits only at the
end, so a failure leaves the previous vocabulary in place (and fails the job).

- **Monthly** (`import.yml`, 5th, after the association import): full build from all
  associations (names, categories, words) plus user requests. Estimate: 30-60 minutes. The build is a
  separate job (`vocab`, needs `import`, 120 minute limit). If it fails, the monthly import run is marked failed although the imported data is
  committed; the previous vocabulary stays in place.
- **Nightly** (`vocab.yml`, 02:17 UTC): `--requests-only`, adds the anonymised phrases users
  searched that the vocabulary did not already understand (exact and fuzzy matches are not
  logged). A phrase is learned only after it was searched at least twice
  (`vocab_request_min_hits`). Estimate: about 3 minutes (mostly setup).
- **Manual**: Actions, "Query vocabulary", Run workflow; tick `full` for a full build.
  `vocab.yml` shares the `import` concurrency group, so it never runs alongside an import.

Measured on 150,000 synthetic associations with the fake embedder: counting 21.7 s, first
build 79.8 s, rebuild 23.5 s, peak memory 123 MB, temporary disk 138 MB (about 1.4 GB at
1.5 M associations, an extrapolation). The real e5 model embeds roughly 5 times slower than the fake
one (an estimate).

### Coverage report and adding a phrase

The command prints a JSON build report. Phrases from
`importer/importer/data/vocab_watchlist.txt` (queries that must work) whose coverage is
`none` are listed as warnings on stderr in the job log. To cover one, append the phrase to
`vocab_watchlist.txt` (one per line), merge, then run `vocab.yml` by hand (a nightly run also
picks it up).

Size check (expected about 262 MB at the 150,000 cap):

```sql
select pg_size_pretty(pg_total_relation_size('search.query_vocab'));
```

### Costs

EUR 0 extra: no new account, card or secret. Supabase Pro is already paid (the vocabulary
fits in it). GitHub Actions minutes: private repositories get 2,000 free minutes a month;
nightly runs are about 3 minutes each (about 90 a month, estimate) and the monthly build adds
30-60 (estimate), well inside the free tier.

Upgrade path: a live embedding service can be added later and pass `p_query_embedding`; no
database change is needed.

### First run

After deploying migrations 007 and 008 to the hosted project, trigger `import.yml` once (it
builds the vocabulary after the import), or run `vocab.yml` with `full` ticked to build it
without an import. Until then queries fall back to keyword-only search.

### Ranking rule

Change `search.params()` only together with a green ranking run:

```bash
cd importer && RANKING_REPORT=1 uv run pytest -m ranking -s
```

`RANKING_REPORT=1` prints per-query diagnostics (ranks and scores) so a parameter change
can be judged, not just pass/fail. CI runs the same job (`ranking`).

### Checks

- Perf (local only, not in CI): `cd importer && uv run pytest -m perf -s` (150k associations
  near Paris, document vectors clustered around cosine 0.8 to the query direction; target p95
  < 1.5 s). Last measured on a local PG16 (4 cores), 2026-10-22: radius 50 with an unrelated
  query p95 971 ms; radius 10 with the widen count over 50 km p95 895 ms.

### Hosted migration note

Adding the stored generated columns rewrites the `associations` table (about 1.5M rows)
under an ACCESS EXCLUSIVE lock. Apply that migration outside import runs.

### Map attribution

The map uses the OpenFreeMap style (`https://tiles.openfreemap.org/styles/liberty`).
Keep its attribution (OpenMapTiles, OpenStreetMap contributors) visible on every map.
