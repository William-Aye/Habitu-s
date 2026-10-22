from dataclasses import dataclass, field
from datetime import date
from typing import Literal


@dataclass(frozen=True)
class RnaRecord:
    rna_id: str
    name: str
    purpose: str | None
    address: str | None
    postcode: str | None
    insee_code: str | None
    city: str | None
    website: str | None
    published_on: date | None


@dataclass(frozen=True)
class OsmRecord:
    osm_id: str
    name: str
    lon: float
    lat: float
    website: str | None
    phone: str | None
    email: str | None
    opening_hours: str | None
    kind: str  # e.g. "club=sport", "leisure=sports_centre"


@dataclass(frozen=True)
class GeoPoint:
    lon: float
    lat: float
    precision: Literal["address", "municipality"]


@dataclass(frozen=True)
class StagedRna:
    """Row for importer.staged_rna."""
    rna_id: str
    name: str
    purpose: str | None
    address: str | None
    postcode: str | None
    insee_code: str | None
    city: str | None
    website: str | None
    published_on: date | None
    location: GeoPoint | None
    likely_not_public: bool
    embedding_hash: str
    tag_slugs: list[str] = field(default_factory=list)
    embedding: list[float] | None = None


@dataclass(frozen=True)
class StagedOsm:
    """Row for importer.staged_osm (insee_code is derived by apply_run)."""
    osm_id: str
    name: str
    lon: float
    lat: float
    website: str | None
    phone: str | None
    email: str | None
    opening_hours: str | None
    kind: str
    likely_not_public: bool
    embedding_hash: str
    insee_code: None = None
    tag_slugs: list[str] = field(default_factory=list)
    embedding: list[float] | None = None
