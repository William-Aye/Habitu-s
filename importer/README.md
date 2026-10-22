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

**Merging the workflow enables the monthly schedule.** A scheduled run covers all of France in one job,
which the first load cannot do (see below). Do not create the `IMPORTER_DB_URL` secret until the batched
first load is done (without it the scheduled run fails at once and changes nothing), or disable the
workflow's schedule (Actions > Association import > Disable workflow) until then and re-enable it after.

### Secret

Create the GitHub Actions secret `IMPORTER_DB_URL`: the hosted Supabase project's **Supavisor
session-mode pooler** connection string (Connect > Session pooler), of the form
`postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.

- Not the direct connection (`db.<ref>.supabase.co`): it is IPv6-only unless the project has the IPv4
  add-on, and GitHub-hosted runners have no IPv6, so the job cannot reach it.
- Never the transaction pooler (port 6543): the import uses a session advisory lock, a server-side
  cursor and a long COPY, which need a real session.

Store it only as a GitHub Actions secret, never in a file.

### First full run: in batches

The first run embeds about 1 to 1.5 million texts, which does not fit in one job (6 h limit).

**Before the batches: time one large département.** Dispatch the workflow by hand with `75` alone, note
how long the "Run import" step took, and extrapolate from the number of RNA records it read (logged as
`RNA records read`) to each batch below. Split a batch that would not finish well inside the limit
(batch 3, `61` to `95`, holds Paris and its suburbs and is the most likely one to need splitting). This timing run
is a real import of `75`; batch 3 then re-reads it without embedding it again.

Then start the first load by manual dispatch, one batch at a time, waiting for each to succeed. Paste
each list as is (Corsica is `2A` and `2B`; there is no département `20`, and a code with no RNA record
fails the run before anything is geocoded):

1. `01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16,17,18,19,2A,2B,21,22,23,24,25,26,27,28,29,30`
2. `31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60`
3. `61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95`
4. `971,972,973,974,976`

Batch 4 leaves out `975` (Saint-Pierre-et-Miquelon), `977`, `978` (Saint-Barthélemy, Saint-Martin) and the
`98x` codes (Pacific territories): they arrive with the first full monthly run. Later monthly runs cover
all of France and only embed rows that changed (and only rewrite listings that changed).

The embedding model runs on the CPU. `uv sync` installs the default PyTorch wheel, which on Linux also
pulls the CUDA libraries (several GB, slow to install, unused on a runner). Optionally point uv at the
CPU-only wheels in `pyproject.toml`:

```toml
[[tool.uv.index]]
name = "pytorch-cpu"
url = "https://download.pytorch.org/whl/cpu"
explicit = true

[tool.uv.sources]
torch = { index = "pytorch-cpu" }
```

Supabase **Pro is required before the first full run** (the free plan's database size is too small).

### OSM coverage

The Geofabrik `france` extract covers metropolitan France only. Overseas OSM clubs are a later addition
(overseas associations still come from RNA).

## When a run fails

- Check the latest row of `import_runs` (column `error`) in the Supabase SQL editor.
- Live data stays as it was: a failed run does not change what users see.
- If the run stopped because counts dropped sharply, find out why first. Re-run with `--allow-large-drop`
  only once you have confirmed the drop is genuine.
- Only one import runs at a time: a run holds a database lock for as long as its connection lives. If
  the job dies (cancelled, timed out, runner lost), the connection closes and the lock is released, so
  a new run can start straight away. The dead run's row stays in status `running`; the next run that
  starts more than 24 hours after it marks it `failed` with error `abandoned`.

## `--skip-osm`

`--skip-osm` stages no OSM data. In that run: no OSM feature is matched or newly linked, existing
`rna+osm` links are kept as they are (not checked against the map), OSM-only listings are neither
refreshed nor removed, the OSM volume check is skipped, and RNA listings linked to OSM keep their OSM
position and the contact details taken from the map. Use it when the OSM extract is unavailable; the
next normal run catches up.
