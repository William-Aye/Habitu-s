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

## Search — embed-query spike

The `embed-query` Edge Function embeds search queries with `Xenova/multilingual-e5-small`
(q8, 384 dims, `"query: "` prefix) and caches results in `query_embedding_cache`.
Go/no-go spike on the hosted project (owner runs; needs network access to huggingface.co):

```bash
# 1. Deploy
npx supabase functions deploy embed-query

# 2. Cold: wait >= 15 min idle, then one call; repeat 10 times
URL=https://<project-ref>.supabase.co/functions/v1/embed-query
deno run -A supabase/functions/embed-query/bench.ts "$URL" "$SUPABASE_ANON_KEY" 1

# 3. Warm: 50 calls (unique texts, so the cache is bypassed)
deno run -A supabase/functions/embed-query/bench.ts "$URL" "$SUPABASE_ANON_KEY" 50

# 4. Parity with Python (local serve; needs the model)
npx supabase functions serve embed-query
cd importer && SUPABASE_ANON_KEY=<local anon key> uv run pytest -m edge tests/ranking/test_embed_parity.py
```

**Go** when cold <= 8 s, warm p50 <= 300 ms and no memory-limit error in the function logs,
and parity cosine >= 0.99. **No-go**: report numbers to the owner (fallback: Cloud Run, same contract).

| Measure | Threshold | Result |
|---|---|---|
| Cold call (10 runs, max) | <= 8 s | not measured yet |
| Warm p50 (50 calls) | <= 300 ms | not measured yet |
| Warm p95 (50 calls) | info | not measured yet |
| Memory-limit errors | none | not measured yet |
| Parity cosine (4 queries) | >= 0.99 | not measured yet |
