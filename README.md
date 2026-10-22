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

Search combines keyword matching with semantic ranking. The query-vocabulary
description (how queries get their embedding) is written in a later step of
`docs/plans/2026-10-22-query-vocabulary.md`.

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
