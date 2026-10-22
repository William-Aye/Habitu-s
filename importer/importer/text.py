"""Text helpers shared by the import steps.

`normalise_name` must stay identical to the SQL function `importer.normalise_name`
(supabase/migrations/20261022000006_import.sql).
"""
import re
from functools import lru_cache
from pathlib import Path

from unidecode import unidecode

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_FILLER = re.compile(r"(^| )(association|asso|club|amicale|l|d|de|des|du|la|le|les)(?= |$)")
_SPACES = re.compile(r"\s+")
_KEYWORDS_FILE = Path(__file__).parent / "data" / "not_public_keywords.txt"


def normalise_name(name: str) -> str:
    s = unidecode(name or "").lower()
    s = _NON_ALNUM.sub(" ", s)
    s = _FILLER.sub(" ", s)
    return _SPACES.sub(" ", s).strip()


@lru_cache(maxsize=1)
def _keywords() -> tuple[str, ...]:
    lines = _KEYWORDS_FILE.read_text(encoding="utf-8").splitlines()
    return tuple(line.strip() for line in lines if line.strip())


def _fold(text: str | None) -> str:
    return unidecode(text or "").lower().replace("\u2019", "'")


def is_likely_not_public(name: str, purpose: str | None) -> bool:
    haystacks = (_fold(name), _fold(purpose))
    return any(k in h for k in _keywords() for h in haystacks)


def clean_website(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = raw.strip()
    if not value or "@" in value or "." not in value or re.search(r"\s", value):
        return None
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", value):
        value = "https://" + value
    return value
