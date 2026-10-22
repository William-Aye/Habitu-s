"""RNA (Répertoire National des Associations) discovery and CSV parsing.

Only association fields are read; director/contact columns (`dir_*`) are never touched.
"""
import csv
import io
import zipfile
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Iterator

import httpx

from importer.models import RnaRecord
from importer.text import clean_website

RNA_DATASET_API = "https://www.data.gouv.fr/api/1/datasets/repertoire-national-des-associations/"

REQUIRED_COLUMNS = (
    "id", "titre", "objet", "position", "date_publi", "date_disso",
    "adrs_numvoie", "adrs_typevoie", "adrs_libvoie", "adrs_codepostal",
    "adrs_codeinsee", "adrs_libcommune", "siteweb",
)


class RnaSourceError(Exception):
    pass


def find_latest_rna_url(client: httpx.Client) -> str:
    resp = client.get(RNA_DATASET_API)
    resp.raise_for_status()
    candidates = []
    for res in resp.json().get("resources", []):
        title = (res.get("title") or "").lower()
        if title.startswith("rna_waldec") and title.endswith(".zip") and res.get("url"):
            candidates.append(res)
    if not candidates:
        raise RnaSourceError("no rna_waldec resource found")
    return max(candidates, key=lambda r: r.get("last_modified") or "")["url"]


def _sources(path: Path) -> list[tuple[str, object]]:
    """(label, opener) for each CSV; opener() returns a binary stream."""
    path = Path(path)
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as zf:
            names = [i.filename for i in zf.infolist() if _is_data_member(i)]
        return [(n, (path, n)) for n in names]
    return [(path.name, (path, None))]


def _is_data_member(info: zipfile.ZipInfo) -> bool:
    """A CSV member, not a directory or macOS metadata (__MACOSX/..., AppleDouble ._ files)."""
    name = info.filename
    base = name.rsplit("/", 1)[-1]
    return (not info.is_dir() and name.lower().endswith(".csv")
            and not name.startswith("__MACOSX/") and "/__MACOSX/" not in name
            and not base.startswith("._"))


@contextmanager
def _open_binary(ref):
    path, member = ref
    if member is None:
        with open(path, "rb") as f:
            yield f
    else:
        with zipfile.ZipFile(path) as zf, zf.open(member) as f:
            yield f


def _detect_encoding(ref) -> str:
    """UTF-8 (with optional BOM) if the whole file decodes, else cp1252."""
    with _open_binary(ref) as raw:
        decoder = io.TextIOWrapper(raw, encoding="utf-8-sig", errors="strict", newline="")
        try:
            while decoder.read(1 << 20):
                pass
        except UnicodeDecodeError:
            return "cp1252"
        finally:
            decoder.detach()
    return "utf-8-sig"


def _check_header(label: str, header: list[str] | None) -> None:
    missing = [c for c in REQUIRED_COLUMNS if c not in (header or [])]
    if missing:
        raise RnaSourceError(f"{label}: missing columns: {', '.join(missing)}")


def departement(insee: str | None) -> str | None:
    """Département of an INSEE commune code ('69123' -> '69', '2A004' -> '2A', '97105' -> '971')."""
    if not insee:
        return None
    return insee[:3] if insee.startswith("97") else insee[:2]


def _in_scope(insee: str, departements: set[str] | None) -> bool:
    if departements is None:
        return True
    return departement(insee) in departements


def _parse_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _record(row: dict[str, str]) -> RnaRecord:
    def get(k: str) -> str:
        return (row.get(k) or "").strip()

    address = " ".join(p for p in (get("adrs_numvoie"), get("adrs_typevoie"), get("adrs_libvoie")) if p)
    return RnaRecord(
        rna_id=get("id"),
        name=get("titre"),
        purpose=get("objet") or None,
        address=address or None,
        postcode=get("adrs_codepostal") or None,
        insee_code=get("adrs_codeinsee") or None,
        city=get("adrs_libcommune") or None,
        website=clean_website(get("siteweb")),
        published_on=_parse_date(get("date_publi")),
    )


def _errors(encoding: str) -> str:
    # cp1252 leaves five bytes undefined: one stray byte must not abort the run.
    return "replace" if encoding == "cp1252" else "strict"


def read_rna_zip(path: Path, departements: set[str] | None) -> Iterator[RnaRecord]:
    sources = []
    for label, ref in _sources(path):
        encoding = _detect_encoding(ref)
        with _open_binary(ref) as raw:
            text = io.TextIOWrapper(raw, encoding=encoding, errors=_errors(encoding), newline="")
            header = next(csv.reader(text, delimiter=";"), None)
            text.detach()
        _check_header(label, header)
        sources.append((ref, encoding))

    yielded = 0
    for ref, encoding in sources:
        with _open_binary(ref) as raw:
            text = io.TextIOWrapper(raw, encoding=encoding, errors=_errors(encoding), newline="")
            try:
                for row in csv.DictReader(text, delimiter=";"):
                    if (row.get("position") or "").strip() != "A":
                        continue
                    if (row.get("date_disso") or "").strip():
                        continue
                    insee = (row.get("adrs_codeinsee") or "").strip()
                    if not _in_scope(insee, departements):
                        continue
                    yield _record(row)
                    yielded += 1
            finally:
                text.detach()
    if yielded == 0:
        raise RnaSourceError("RNA file contained no active association")
