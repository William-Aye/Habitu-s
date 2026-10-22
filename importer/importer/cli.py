"""`python -m importer run ...`: read RNA + OSM, geocode, tag, embed, stage and merge one run."""
import argparse
import dataclasses
import json
import logging
import os
import sys
import tempfile
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import TypeVar

import httpx
import psycopg

from importer import db
from importer.embed import E5Embedder, Embedder, FakeEmbedder, embedding_text, text_hash
from importer.geocode import Geocoder, address_key
from importer.models import GeoPoint, OsmRecord, RnaRecord, StagedOsm, StagedRna
from importer.osm import read_osm_geojsonseq
from importer.rna import find_latest_rna_url, read_rna_zip
from importer.tagging import Tagger
from importer.text import is_likely_not_public

log = logging.getLogger("importer")

PROGRESS_EVERY = 50_000
EMBED_BATCH = 1024
GEOCODE_CHUNK = 50_000
T = TypeVar("T")


def make_embedder(name: str) -> Embedder:
    return E5Embedder() if name == "e5" else FakeEmbedder()


def progress(items: Iterable[T], label: str) -> Iterator[T]:
    n = 0
    for n, item in enumerate(items, start=1):
        if n % PROGRESS_EVERY == 0:
            log.info("%s: %d", label, n)
        yield item
    log.info("%s: %d (done)", label, n)


def download_rna(dest_dir: Path) -> Path:
    path = Path(dest_dir) / "rna.zip"
    timeout = httpx.Timeout(60, read=300)
    with httpx.Client(follow_redirects=True, timeout=timeout) as client:
        url = find_latest_rna_url(client)
        log.info("downloading %s", url)
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            with open(path, "wb") as f:
                for chunk in resp.iter_bytes(1 << 20):
                    f.write(chunk)
    return path


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m importer")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="import RNA + OSM into the association directory")
    run.add_argument("--db-url", default=os.environ.get("IMPORTER_DB_URL"))
    run.add_argument("--departements", help="comma-separated, e.g. 69,75 (default: all of France)")
    run.add_argument("--rna-zip", help="RNA waldec zip (or CSV); default: download the latest")
    run.add_argument("--osm-geojsonseq", help="osmium GeoJSON-sequence export of clubs")
    run.add_argument("--skip-osm", action="store_true", help="stage no OSM data this run")
    run.add_argument("--embedder", choices=("e5", "fake"), default="e5")
    run.add_argument("--allow-large-drop", action="store_true",
                     help="skip the source volume sanity check")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if not args.db_url:
        parser.error("--db-url or IMPORTER_DB_URL is required")
    if not args.skip_osm and not args.osm_geojsonseq:
        parser.error("--osm-geojsonseq is required unless --skip-osm")
    scope = None
    if args.departements:
        scope = sorted({d.strip().upper() for d in args.departements.split(",") if d.strip()}) or None
    logging.basicConfig(stream=sys.stderr, level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    return run(args, scope)


def run(args: argparse.Namespace, scope: list[str] | None) -> int:
    with psycopg.connect(args.db_url) as conn:
        try:
            run_id = db.start_run(conn, scope)
        except db.ImportAlreadyRunning as exc:
            log.error("%s; not starting a new run", exc)
            return 1
        log.info("import run %s, scope %s", run_id, scope or "all of France")
        try:
            counts = _run(conn, run_id, scope, args)
        except Exception as exc:
            log.exception("import run %s failed", run_id)
            try:
                db.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                log.exception("could not record the failure of run %s", run_id)
            return 1
    print(json.dumps(counts, ensure_ascii=False))
    return 0


# Memory: a France-wide run has ~1.5M RNA rows. Nothing below holds all records, staged rows
# or vectors at once. The RNA file is read three times (count + validate, geocode, stage) and
# the OSM file twice (count + validate, stage); only the address-key -> point map and the
# existing-hash maps span the whole run. Rows are built, embedded and written in batches of
# EMBED_BATCH while COPY pulls them.


def _run(conn, run_id, scope: list[str] | None, args: argparse.Namespace) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        rna_path = Path(args.rna_zip) if args.rna_zip else download_rna(Path(tmp))
        departements = set(scope) if scope else None

        def rna_records() -> Iterator[RnaRecord]:
            return read_rna_zip(rna_path, departements)

        def osm_records() -> Iterator[OsmRecord]:
            return iter(()) if args.skip_osm else read_osm_geojsonseq(Path(args.osm_geojsonseq))

        # Pass 1: validate both sources and count (a bad file fails here, before any staging).
        rna_read = sum(1 for _ in progress(rna_records(), "RNA records read"))
        osm_read = None if args.skip_osm else sum(1 for _ in progress(osm_records(), "OSM records read"))
        if not args.allow_large_drop:
            db.check_volume(conn, scope, rna_read, osm_read)

        # Pass 2: geocode unique addresses, in chunks.
        points = _geocode(conn, rna_records())

        # Pass 3: build, embed and COPY in batches.
        tagger = Tagger()
        rna_hashes, osm_hashes = db.existing_hashes(conn)
        embedder = make_embedder(args.embedder)
        db.stage(
            conn,
            run_id,
            progress(_staged_rna(rna_records(), points, rna_hashes, tagger, embedder), "RNA rows staged"),
            progress(_staged_osm(osm_records(), osm_hashes, tagger, embedder), "OSM rows staged"),
        )
        del points, rna_hashes, osm_hashes
        counts = db.apply(conn, run_id, scope)
    log.info("import run %s succeeded: %s", run_id, counts)
    return counts


def _geocode(conn, records: Iterable[RnaRecord]) -> dict[str, GeoPoint | None]:
    """address_key -> point. The geocoder sees one slim record per unique address."""
    cache = db.GeocodeCache(conn)
    points: dict[str, GeoPoint | None] = {}
    chunk: dict[str, RnaRecord] = {}
    with httpx.Client(timeout=httpx.Timeout(60, read=300)) as client:
        geocoder = Geocoder(client, cache)

        def resolve() -> None:
            cache.prefetch(chunk)
            points.update(geocoder.geocode(list(chunk.values())))
            cache.forget()
            chunk.clear()
            log.info("addresses geocoded: %d", len(points))

        for r in records:
            k = address_key(r)
            if k in points or k in chunk:
                continue
            chunk[k] = RnaRecord(rna_id=k, name="", purpose=None, address=r.address,
                                 postcode=r.postcode, insee_code=r.insee_code, city=None,
                                 website=None, published_on=None)
            if len(chunk) >= GEOCODE_CHUNK:
                resolve()
        if chunk:
            resolve()
    return points


def _batches(items: Iterable[T], size: int) -> Iterator[list[T]]:
    batch: list[T] = []
    for item in items:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def _with_embeddings(rows: list, todo: list[tuple[int, str]], embedder: Embedder) -> list:
    if todo:
        vectors = embedder.embed([text for _, text in todo])
        for (idx, _), vec in zip(todo, vectors, strict=True):
            rows[idx] = dataclasses.replace(rows[idx], embedding=vec)
    return rows


def _staged_rna(records, points, existing, tagger: Tagger, embedder: Embedder) -> Iterator[StagedRna]:
    for batch in _batches(records, EMBED_BATCH):
        rows: list[StagedRna] = []
        todo: list[tuple[int, str]] = []
        for r in batch:
            text = embedding_text(r.name, r.purpose)
            h = text_hash(text)
            if existing.get(r.rna_id) != h:
                todo.append((len(rows), text))
            rows.append(StagedRna(
                rna_id=r.rna_id, name=r.name, purpose=r.purpose, address=r.address,
                postcode=r.postcode, insee_code=r.insee_code, city=r.city, website=r.website,
                published_on=r.published_on, location=points.get(address_key(r)),
                likely_not_public=is_likely_not_public(r.name, r.purpose), embedding_hash=h,
                tag_slugs=tagger.tags_for(r.name, r.purpose),
            ))
        yield from _with_embeddings(rows, todo, embedder)


def _staged_osm(records, existing, tagger: Tagger, embedder: Embedder) -> Iterator[StagedOsm]:
    for batch in _batches(records, EMBED_BATCH):
        rows: list[StagedOsm] = []
        todo: list[tuple[int, str]] = []
        for o in batch:
            text = embedding_text(o.name, None)
            h = text_hash(text)
            current = existing.get(o.osm_id)
            # A feature linked to an RNA listing uses that listing's (RNA) embedding.
            if current != h and current != db.LINKED:
                todo.append((len(rows), text))
            rows.append(StagedOsm(
                osm_id=o.osm_id, name=o.name, lon=o.lon, lat=o.lat, website=o.website,
                phone=o.phone, email=o.email, opening_hours=o.opening_hours, kind=o.kind,
                likely_not_public=is_likely_not_public(o.name, None), embedding_hash=h,
                tag_slugs=tagger.tags_for(o.name, None),
            ))
        yield from _with_embeddings(rows, todo, embedder)
