"""Database side of a run: run log, existing hashes, geocode cache, staging (COPY) and merge."""
from collections.abc import Iterable, Iterator, MutableMapping
from uuid import UUID

import psycopg

from importer.models import GeoPoint, StagedOsm, StagedRna

# Volume sanity check (before staging): fewer than VOLUME_MIN_RATIO of the existing listings
# read from a source aborts the run, unless --allow-large-drop. Only applies when at least
# VOLUME_MIN_EXISTING listings exist, so first runs and small test databases are exempt. RNA is
# checked for the whole scope and per département (a full-France run must not lose one
# département unnoticed among a hundred).
VOLUME_MIN_RATIO = 0.8
VOLUME_MIN_EXISTING = 100

# Value of existing_hashes()[1] for an OSM feature linked to an RNA listing ("rna+osm"): such a
# listing carries the RNA text's embedding, so the feature itself needs no embedding.
LINKED = "rna+osm"

_CACHE_READ_BATCH = 10_000
_CACHE_WRITE_BATCH = 5_000
_ERROR_MAX = 2_000

_DEPARTEMENT_SQL = (
    "case when insee_code like '97%%' then left(insee_code, 3) else left(insee_code, 2) end"
)


# Session-level advisory lock held by the run's connection for the whole run (released when it
# closes). Distinct from apply_run's transaction lock (hashtext('importer.apply_run')).
RUN_LOCK_KEY = 0x46524E445F494D50  # "FRND_IMP"
STALE_AFTER = "24 hours"


class VolumeDropError(RuntimeError):
    pass


class ImportAlreadyRunning(RuntimeError):
    pass


def start_run(conn: psycopg.Connection, scope: list[str] | None) -> UUID:
    """Take the run lock, mark abandoned runs failed, insert the run row and commit.

    Raises ImportAlreadyRunning (no row created) when another import holds the lock.
    """
    locked = conn.execute("select pg_try_advisory_lock(%s)", (RUN_LOCK_KEY,)).fetchone()[0]
    if not locked:
        conn.rollback()
        raise ImportAlreadyRunning("another import is running")
    conn.execute(
        "update public.import_runs set status = 'failed', finished_at = now(), error = 'abandoned' "
        "where status = 'running' and started_at < now() - %s::interval",
        (STALE_AFTER,),
    )
    run_id = conn.execute(
        "insert into public.import_runs (scope) values (%s::text[]) returning id", (scope,)
    ).fetchone()[0]
    conn.commit()
    return run_id


def existing_hashes(conn: psycopg.Connection) -> tuple[dict[str, str], dict[str, str]]:
    """rna_id -> embedding_hash and osm_id -> embedding_hash of the live listings.

    An OSM feature held by an "rna+osm" listing maps to LINKED (that listing's hash is the RNA
    text's). Listings without a stored hash are left out, so they get embedded.
    """
    rna: dict[str, str] = {}
    osm: dict[str, str] = {}
    with conn.cursor(name="importer_existing_hashes") as cur:
        cur.itersize = 10_000
        cur.execute(
            "select rna_id, osm_id, source, embedding_hash from public.associations "
            "where rna_id is not null or osm_id is not null"
        )
        for rna_id, osm_id, source, h in cur:
            if rna_id is not None and h is not None:
                rna[rna_id] = h
            if osm_id is not None:
                if source == "rna+osm":
                    osm[osm_id] = LINKED
                elif h is not None:
                    osm[osm_id] = h
    conn.commit()
    return rna, osm


def existing_counts(conn: psycopg.Connection, scope: list[str] | None) -> tuple[int, int]:
    """(listings with an rna_id, listings with an osm_id) in the scope, ignoring listings kept at
    confidence 0 (dissolved but claimed or referenced), which no source is expected to list."""
    where = " and confidence > 0"
    if scope is not None:
        where += f" and {_DEPARTEMENT_SQL} = any(%(scope)s::text[])"
    row = conn.execute(
        "select count(*) filter (where rna_id is not null"
        + where
        + "), count(*) filter (where osm_id is not null"
        + where
        + ") from public.associations",
        {"scope": scope},
    ).fetchone()
    conn.commit()
    return int(row[0]), int(row[1])


def existing_rna_by_departement(conn: psycopg.Connection, scope: list[str] | None) -> dict[str, int]:
    """Département -> live listings with an rna_id (confidence > 0) in the scope."""
    where = "rna_id is not null and confidence > 0 and insee_code is not null"
    if scope is not None:
        where += f" and {_DEPARTEMENT_SQL} = any(%(scope)s::text[])"
    rows = conn.execute(
        f"select {_DEPARTEMENT_SQL} as d, count(*) from public.associations where {where} group by 1",
        {"scope": scope},
    ).fetchall()
    conn.commit()
    return {d: int(n) for d, n in rows}


def departement_volume_problems(read: dict[str, int], existing: dict[str, int]) -> list[str]:
    problems = []
    for d, n in sorted(existing.items()):
        got = read.get(d, 0)
        if n >= VOLUME_MIN_EXISTING and got < VOLUME_MIN_RATIO * n:
            problems.append(
                f"RNA département {d}: read {got} records but {n} listings with an rna_id exist "
                f"(< {VOLUME_MIN_RATIO:.0%})"
            )
    return problems


def volume_problems(
    rna_read: int, rna_existing: int, osm_read: int | None, osm_existing: int
) -> list[str]:
    """Human-readable reasons to abort; osm_read None means OSM is skipped this run."""
    problems = []
    for label, read, existing in (("RNA", rna_read, rna_existing), ("OSM", osm_read, osm_existing)):
        if read is None or existing < VOLUME_MIN_EXISTING:
            continue
        if read < VOLUME_MIN_RATIO * existing:
            problems.append(
                f"{label}: read {read} records but {existing} listings with an "
                f"{label.lower()}_id exist in scope (< {VOLUME_MIN_RATIO:.0%})"
            )
    return problems


def check_volume(
    conn: psycopg.Connection,
    scope: list[str] | None,
    rna_read_by_departement: dict[str, int],
    osm_read: int | None,
) -> None:
    """rna_read_by_departement: RNA records read per département; osm_read: OSM features read in
    the scope (None when OSM is skipped)."""
    rna_existing, osm_existing = existing_counts(conn, scope)
    problems = volume_problems(sum(rna_read_by_departement.values()), rna_existing, osm_read, osm_existing)
    problems += departement_volume_problems(rna_read_by_departement, existing_rna_by_departement(conn, scope))
    if problems:
        raise VolumeDropError(
            "source volume dropped sharply; refusing to import (use --allow-large-drop to override): "
            + "; ".join(problems)
        )


class GeocodeCache(MutableMapping[str, GeoPoint | None]):
    """importer.geocode_cache as a mapping. A row without coordinates caches "not found" (None).

    Reads: `prefetch(keys)` loads keys in batches (one query per batch); a lookup of a key not
    prefetched costs one query. Writes are buffered and upserted in batches; `flush()` writes the
    rest and commits (call it before staging, so cached answers survive a failed run).
    """

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self._known: dict[str, GeoPoint | None] = {}
        self._absent: set[str] = set()
        self._pending: dict[str, GeoPoint | None] = {}

    @staticmethod
    def _point(lon, lat, precision) -> GeoPoint | None:
        if lon is None or lat is None:
            return None
        return GeoPoint(float(lon), float(lat), precision or "address")

    def prefetch(self, keys: Iterable[str]) -> None:
        todo = [k for k in dict.fromkeys(keys) if k not in self._known and k not in self._absent]
        for i in range(0, len(todo), _CACHE_READ_BATCH):
            batch = todo[i : i + _CACHE_READ_BATCH]
            found = set()
            with self.conn.cursor() as cur:
                cur.execute(
                    "select address_key, lon, lat, precision from importer.geocode_cache "
                    "where address_key = any(%s)",
                    (batch,),
                )
                for key, lon, lat, precision in cur:
                    self._known[key] = self._point(lon, lat, precision)
                    found.add(key)
            self._absent.update(k for k in batch if k not in found)
        self.conn.commit()

    def forget(self) -> None:
        """Write pending answers, then drop what is held in memory (between geocoding chunks)."""
        self.flush()
        self._known.clear()
        self._absent.clear()

    def __getitem__(self, key: str) -> GeoPoint | None:
        if key not in self._known and key not in self._absent:
            self.prefetch([key])
        if key in self._known:
            return self._known[key]
        raise KeyError(key)

    def __contains__(self, key: object) -> bool:
        try:
            self[key]  # type: ignore[index]
        except KeyError:
            return False
        return True

    def __setitem__(self, key: str, value: GeoPoint | None) -> None:
        self._known[key] = value
        self._absent.discard(key)
        self._pending[key] = value
        if len(self._pending) >= _CACHE_WRITE_BATCH:
            self.flush()

    def __delitem__(self, key: str) -> None:
        self.conn.execute("delete from importer.geocode_cache where address_key = %s", (key,))
        self._known.pop(key, None)
        self._pending.pop(key, None)
        self._absent.add(key)

    def __iter__(self) -> Iterator[str]:
        self.flush()
        with self.conn.cursor() as cur:
            cur.execute("select address_key from importer.geocode_cache")
            keys = [r[0] for r in cur]
        return iter(keys)

    def __len__(self) -> int:
        self.flush()
        return int(self.conn.execute("select count(*) from importer.geocode_cache").fetchone()[0])

    def flush(self) -> None:
        if not self._pending:
            return
        rows = [
            (k, p.lon if p else None, p.lat if p else None, p.precision if p else None)
            for k, p in self._pending.items()
        ]
        with self.conn.cursor() as cur:
            cur.executemany(
                "insert into importer.geocode_cache (address_key, lon, lat, precision) "
                "values (%s, %s, %s, %s) on conflict (address_key) do update set "
                "lon = excluded.lon, lat = excluded.lat, precision = excluded.precision, "
                "created_at = now()",
                rows,
            )
        self.conn.commit()
        self._pending.clear()


def _ewkt(lon: float, lat: float) -> str:
    return f"SRID=4326;POINT({lon!r} {lat!r})"


def _vector(v) -> str | None:
    """pgvector text for any float sequence (numpy float32 row or list); 9 significant digits
    round-trip float32 exactly."""
    return None if v is None else "[" + ",".join(format(float(x), ".9g") for x in v) + "]"


def stage(
    conn: psycopg.Connection, run_id: UUID, rna: Iterable[StagedRna], osm: Iterable[StagedOsm]
) -> None:
    """COPY the rows into importer.staged_*; does not commit (apply() does)."""
    with conn.cursor() as cur:
        with cur.copy(
            "copy importer.staged_rna (run_id, rna_id, name, purpose, address, postcode, city, insee_code, "
            "location, geocode_precision, website, published_on, likely_not_public, tag_slugs, embedding, "
            "embedding_hash) from stdin"
        ) as copy:
            for r in rna:
                loc = r.location
                copy.write_row((
                    run_id, r.rna_id, r.name, r.purpose, r.address, r.postcode, r.city, r.insee_code,
                    _ewkt(loc.lon, loc.lat) if loc else None, loc.precision if loc else None,
                    r.website, r.published_on, r.likely_not_public, r.tag_slugs,
                    _vector(r.embedding), r.embedding_hash,
                ))
        with cur.copy(
            "copy importer.staged_osm (run_id, osm_id, name, location, insee_code, website, phone, "
            "email, opening_hours, likely_not_public, tag_slugs, embedding, embedding_hash) from stdin"
        ) as copy:
            for o in osm:
                copy.write_row((
                    run_id, o.osm_id, o.name, _ewkt(o.lon, o.lat), o.insee_code, o.website, o.phone,
                    o.email, o.opening_hours, o.likely_not_public, o.tag_slugs, _vector(o.embedding),
                    o.embedding_hash,
                ))


def apply(conn: psycopg.Connection, run_id: UUID, scope: list[str] | None) -> dict:
    counts = conn.execute(
        "select importer.apply_run(%s, %s::text[])", (run_id, scope)
    ).fetchone()[0]
    conn.commit()
    return counts


def fail_run(conn: psycopg.Connection, run_id: UUID, error: str) -> None:
    """Roll back the failed transaction, then record the failure in a new one.

    apply_run's own failure rolls back its import_runs update, so this always runs after it.
    """
    conn.rollback()
    conn.execute("delete from importer.staged_rna where run_id = %s", (run_id,))
    conn.execute("delete from importer.staged_osm where run_id = %s", (run_id,))
    conn.execute(
        "update public.import_runs set status = 'failed', finished_at = now(), error = %s "
        "where id = %s",
        (error[:_ERROR_MAX], run_id),
    )
    conn.commit()
