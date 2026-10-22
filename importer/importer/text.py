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
_WHITESPACE = re.compile(r"\s")
_HOST_END = re.compile(r"[/?#]")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_FILLER = re.compile(r"(^| )(association|asso|club|amicale|l|d|de|des|du|la|le|les)(?= |$)")
_SPACES = re.compile(r"\s+")
_KEYWORDS_FILE = Path(__file__).parent / "data" / "not_public_keywords.txt"


# Letters Postgres unaccent maps that NFKD does not decompose.
_EXTRA = str.maketrans({
    "œ": "oe", "Œ": "OE", "æ": "ae", "Æ": "AE", "ß": "ss",
    "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ł": "l", "Ł": "L",
    "’": "'", "‘": "'", "ʼ": "'",
    "½": " 1/2", "¼": " 1/4", "¾": " 3/4", "⅓": " 1/3", "⅔": " 2/3",
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
    "ﬅ": "st", "ﬆ": "st", "ſ": "s", "ĳ": "ij", "Ĳ": "IJ",
    "ŉ": "'n", "ǆ": "dz", "№": "No", "℃": "°C",
    "©": "(C)", "®": "(R)",
})


def _fold(text: str | None) -> str:
    """Latin accent fold mirroring Postgres unaccent; other symbols are left as-is."""
    # Fullwidth ASCII variants map to plain ASCII in unaccent.
    t = "".join(chr(ord(c) - 0xFEE0) if "！" <= c <= "～" else c for c in text or "")
    s = unicodedata.normalize("NFD", t.translate(_EXTRA))
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
    if not value or "@" in value or _WHITESPACE.search(value):
        return None
    if not _SCHEME.match(value):
        value = "https://" + value
    host = _HOST_END.split(_SCHEME.sub("", value, count=1), maxsplit=1)[0]
    if not _HOST.match(host):
        return None
    return value
