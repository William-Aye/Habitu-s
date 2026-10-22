"""Text helpers shared by the import steps.

`normalise_name` must stay identical to the SQL function `importer.normalise_name`
(supabase/migrations/20261022000006_import.sql).
"""
import re
from functools import lru_cache
from pathlib import Path

import unicodedata

_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://")
_HOST = re.compile(r"^[^\s.:/@?#]+(\.[^\s.:/@?#]+)+(:\d+)?$")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_FILLER = re.compile(r"(^| )(association|asso|club|amicale|l|d|de|des|du|la|le|les)(?= |$)")
_SPACES = re.compile(r"\s+")
_KEYWORDS_FILE = Path(__file__).parent / "data" / "not_public_keywords.txt"


# Letters Postgres unaccent maps that NFKD does not decompose.
_EXTRA = str.maketrans({
    "œ": "oe", "Œ": "OE", "æ": "ae", "Æ": "AE", "ß": "ss",
    "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ł": "l", "Ł": "L",
    "’": "'", "‘": "'",
})


def _fold(text: str | None) -> str:
    """Latin accent fold mirroring Postgres unaccent; other symbols are left as-is."""
    s = unicodedata.normalize("NFKD", (text or "").translate(_EXTRA))
    return "".join(c for c in s if not unicodedata.combining(c))


def normalise_name(name: str) -> str:
    s = _fold(name).lower()
    s = _NON_ALNUM.sub(" ", s)
    s = _FILLER.sub(" ", s)
    return _SPACES.sub(" ", s).strip()


@lru_cache(maxsize=1)
def _keywords() -> tuple[str, ...]:
    lines = _KEYWORDS_FILE.read_text(encoding="utf-8").splitlines()
    return tuple(line.strip() for line in lines if line.strip())


def is_likely_not_public(name: str, purpose: str | None) -> bool:
    haystacks = (_fold(name).lower(), _fold(purpose).lower())
    return any(k in h for k in _keywords() for h in haystacks)


def clean_website(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = raw.strip()
    if not value:
        return None
    if not _SCHEME.match(value):
        value = "https://" + value
    host = _SCHEME.sub("", value, count=1).split("/", 1)[0]
    if "@" in host or not _HOST.match(host):
        return None
    return value
