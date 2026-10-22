"""OpenStreetMap clubs read from an osmium GeoJSON-sequence export.

Workflow (see the import pipeline):
    osmium tags-filter france-latest.osm.pbf <OSMIUM_FILTER...> -o filtered.osm.pbf
    osmium export filtered.osm.pbf -f geojsonseq -a type,id -o clubs.geojsonseq

`-a type,id` matters: without it osmium writes no OSM ids, and every feature is a bad line.
"""
import json
import sys
from pathlib import Path
from typing import Iterator

from importer.models import OsmRecord
from importer.text import clean_website

OSMIUM_FILTER = [
    "nwr/club",
    "nwr/leisure=sports_centre,sports_hall,dance,fitness_centre",
    "nwr/amenity=community_centre,social_centre,arts_centre",
]

_RS = "\x1e"
_KIND_KEYS = ("club", "leisure", "amenity")
_OSM_TYPES = {"n": "node", "w": "way", "r": "relation"}
_MAX_BAD_LINES = 100
_MAX_BAD_FRACTION = 0.001


class OsmSourceError(Exception):
    """Too many malformed lines: the export is probably truncated or corrupt."""


def _osm_id(feature: dict, props: dict) -> str | None:
    osm_type = props.get("@type")
    osm_num = props.get("@id")
    if osm_type and osm_num is not None:
        return f"{osm_type}/{osm_num}"
    fid = feature.get("id")
    if isinstance(fid, str) and len(fid) > 1 and fid[0] in _OSM_TYPES and fid[1:].isdigit():
        return f"{_OSM_TYPES[fid[0]]}/{fid[1:]}"
    return None


def _lon_lat(geometry: dict) -> tuple[float, float] | None:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if gtype == "Point":
        return float(coords[0]), float(coords[1])
    if gtype == "Polygon":
        ring = coords[0]
    elif gtype == "MultiPolygon":
        ring = coords[0][0]
    else:
        return None
    # The outer ring is closed (first vertex repeated); average the distinct vertices.
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if not ring:
        raise ValueError("empty outer ring")
    lon = sum(float(p[0]) for p in ring) / len(ring)
    lat = sum(float(p[1]) for p in ring) / len(ring)
    return lon, lat


def _kind(props: dict) -> str | None:
    for key in _KIND_KEYS:
        value = props.get(key)
        if value:
            return f"{key}={value}"
    return None


def _first(props: dict, *keys: str) -> str | None:
    for key in keys:
        value = props.get(key)
        if value:
            return str(value).strip() or None
    return None


def _to_record(feature: dict) -> OsmRecord | None:
    props = feature.get("properties") or {}
    name = _first(props, "name")
    if not name:
        return None
    coords = _lon_lat(feature.get("geometry") or {})
    if coords is None:
        return None
    osm_id = _osm_id(feature, props)
    if osm_id is None:
        raise ValueError("feature has no OSM id (export with `osmium export -a type,id`)")
    kind = _kind(props)
    if kind is None:
        return None
    lon, lat = coords
    return OsmRecord(
        osm_id=osm_id,
        name=name,
        lon=lon,
        lat=lat,
        website=clean_website(_first(props, "website", "contact:website")),
        phone=_first(props, "phone", "contact:phone"),
        email=_first(props, "email", "contact:email"),
        opening_hours=_first(props, "opening_hours"),
        kind=kind,
    )


def read_osm_geojsonseq(path: Path) -> Iterator[OsmRecord]:
    """Yield named club-like features from a GeoJSON-sequence file, one per line.

    Malformed features are skipped with a warning on stderr. If more than 100 lines
    *and* more than 0.1% of non-blank lines are bad, OsmSourceError is raised after
    the readable records have been yielded, so a truncated export cannot be mistaken
    for a complete one.
    """
    total = 0
    bad = 0
    with open(path, encoding="utf-8") as f:
        for lineno, raw in enumerate(f, start=1):
            line = raw.strip().lstrip(_RS).strip()
            if not line:
                continue
            total += 1
            try:
                record = _to_record(json.loads(line))
            except (ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
                bad += 1
                print(f"warning: skipping malformed OSM feature at line {lineno}: {exc}", file=sys.stderr)
                continue
            if record is not None:
                yield record
    if bad > _MAX_BAD_LINES and bad > _MAX_BAD_FRACTION * total:
        raise OsmSourceError(f"{bad} of {total} OSM lines were malformed in {path}")
