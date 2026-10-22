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
from importer.models import OsmRecord, RnaRecord, StagedOsm, StagedRna
from importer.osm import read_osm_geojsonseq
from importer.rna import find_latest_rna_url, read_rna_zip
from importer.tagging import Tagger
from importer.text import is_likely_not_public

log = logging.getLogger("importer")

PROGRESS_EVERY = 50_000
EMBED_BATCH = 1024
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
        run_id = db.start_run(conn, scope)
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


def _read_rna(path: str | None, scope: list[str] | None) -> list[RnaRecord]:
    departements = set(scope) if scope else None
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(path) if path else download_rna(Path(tmp))
        return list(progress(read_rna_zip(source, departements), "RNA records read"))


def _run(conn, run_id, scope: list[str] | None, args: argparse.Namespace) -> dict:
    rna = _read_rna(args.rna_zip, scope)
    osm: list[OsmRecord] | None = None
    if not args.skip_osm:
        osm = list(progress(read_osm_geojsonseq(Path(args.osm_geojsonseq)), "OSM records read"))

    if not args.allow_large_drop:
        db.check_volume(conn, scope, len(rna), None if osm is None else len(osm))

    cache = db.GeocodeCache(conn)
    cache.prefetch(address_key(r) for r in rna)
    with httpx.Client(timeout=httpx.Timeout(60, read=300)) as client:
        points = Geocoder(client, cache).geocode(rna)
    cache.flush()
    log.info("geocoded %d RNA records", len(points))

    tagger = Tagger()
    rna_hashes, osm_hashes = db.existing_hashes(conn)
    staged_rna: list[StagedRna] = []
    rna_todo: list[tuple[int, str]] = []
    for r in progress(rna, "RNA records tagged"):
        text = embedding_text(r.name, r.purpose)
        h = text_hash(text)
        if rna_hashes.get(r.rna_id) != h:
            rna_todo.append((len(staged_rna), text))
        staged_rna.append(StagedRna(
            rna_id=r.rna_id, name=r.name, purpose=r.purpose, address=r.address, postcode=r.postcode,
            insee_code=r.insee_code, city=r.city, website=r.website, published_on=r.published_on,
            location=points.get(r.rna_id), likely_not_public=is_likely_not_public(r.name, r.purpose),
            embedding_hash=h, tag_slugs=tagger.tags_for(r.name, r.purpose),
        ))

    staged_osm: list[StagedOsm] = []
    osm_todo: list[tuple[int, str]] = []
    for o in progress(osm or [], "OSM records tagged"):
        text = embedding_text(o.name, None)
        h = text_hash(text)
        existing = osm_hashes.get(o.osm_id)
        # A feature linked to an RNA listing uses that listing's (RNA) embedding.
        if existing != h and existing != db.LINKED:
            osm_todo.append((len(staged_osm), text))
        staged_osm.append(StagedOsm(
            osm_id=o.osm_id, name=o.name, lon=o.lon, lat=o.lat, website=o.website, phone=o.phone,
            email=o.email, opening_hours=o.opening_hours, kind=o.kind,
            likely_not_public=is_likely_not_public(o.name, None), embedding_hash=h,
            tag_slugs=tagger.tags_for(o.name, None),
        ))

    embedder = make_embedder(args.embedder)
    log.info("embedding %d RNA and %d OSM texts", len(rna_todo), len(osm_todo))
    _embed(embedder, staged_rna, rna_todo, "RNA")
    _embed(embedder, staged_osm, osm_todo, "OSM")

    db.stage(conn, run_id, progress(staged_rna, "RNA rows staged"),
             progress(staged_osm, "OSM rows staged"))
    counts = db.apply(conn, run_id, scope)
    log.info("import run %s succeeded: %s", run_id, counts)
    return counts


def _embed(embedder: Embedder, rows: list, todo: list[tuple[int, str]], label: str) -> None:
    done = 0
    for i in range(0, len(todo), EMBED_BATCH):
        batch = todo[i : i + EMBED_BATCH]
        vectors = embedder.embed([text for _, text in batch])
        for (idx, _), vec in zip(batch, vectors, strict=True):
            rows[idx] = dataclasses.replace(rows[idx], embedding=vec)
        before, done = done, done + len(batch)
        if done // PROGRESS_EVERY > before // PROGRESS_EVERY:
            log.info("%s texts embedded: %d", label, done)
