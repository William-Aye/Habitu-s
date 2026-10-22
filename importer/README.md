# Association directory importer

Monthly import of French associations (RNA) and OpenStreetMap clubs into the Habitues directory.
Run with `uv` from the repo root: `uv run --project importer python -m importer run ...`.

## Local sample run

Start the local Supabase stack from the repo root (`npm run db:start`, then `npm run db:reset`).
Local Postgres listens on port 55322 (the local stack uses the 553xx range, see the root README).

```bash
cd importer && uv sync
uv run python -m importer run \
  --db-url postgresql://postgres:postgres@127.0.0.1:55322/postgres \
  --departements 69 \
  --rna-zip tests/fixtures/rna_sample.csv \
  --osm-geojsonseq tests/fixtures/osm_sample.geojsonseq \
  --embedder fake
```

Unit tests: `uv run pytest`. Integration tests (need the local DB): `uv run pytest -m integration`.

## Scheduled import

`.github/workflows/import.yml` runs on the 5th of each month at 03:00 UTC, and can be started by hand
(Actions > Association import > Run workflow) with an optional `departements` list. Only one import runs at a time.

### Secret

Create the GitHub Actions secret `IMPORTER_DB_URL`: the hosted Supabase project's **direct or
session-mode** Postgres connection string. Do **not** use the transaction pooler (port 6543): the import
uses a session advisory lock, a server-side cursor and a long COPY, which need a real session.
Store it only as a GitHub Actions secret, never in a file.

### First full run: in batches

The first run embeds about 1 to 1.5 million texts, which does not fit in one job. Start it by manual
dispatch, one batch at a time, waiting for each to succeed:

1. `01,02,03,...,30`
2. `31,32,...,60`
3. `61,62,...,95,2A,2B`
4. `971,972,973,974,976`

Later monthly runs cover all of France and only embed rows that changed.

Supabase **Pro is required before the first full run** (the free plan's database size is too small).

### OSM coverage

The Geofabrik `france` extract covers metropolitan France only. Overseas OSM clubs are a later addition
(overseas associations still come from RNA).

## When a run fails

- Check the latest row of `import_runs` (column `error`) in the Supabase SQL editor.
- Live data stays as it was: a failed run does not change what users see.
- If the run stopped because counts dropped sharply, find out why first. Re-run with `--allow-large-drop`
  only once you have confirmed the drop is genuine.
- A run stuck in status `running` is marked `abandoned` automatically after 24 hours; until then a new
  run refuses to start.
