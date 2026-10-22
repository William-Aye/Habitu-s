"""Keyword-rule category tagging on name + purpose."""
import csv
import re
from pathlib import Path

from importer.text import _fold

DATA = Path(__file__).parent / "data"
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _norm(text: str | None) -> str:
    """Accent-free lower-case, punctuation/apostrophes as word boundaries, space-padded."""
    return " " + _NON_ALNUM.sub(" ", _fold(text).lower()).strip() + " "


class Tagger:
    def __init__(self, rules_path: Path = DATA / "keywords.csv"):
        with Path(rules_path).open(encoding="utf-8", newline="") as f:
            self._rules = [
                (_norm(r["keyword"]), r["category_slug"].strip()) for r in csv.DictReader(f)
            ]

    def tags_for(self, name: str, purpose: str | None) -> list[str]:
        text = _norm(f"{name} {purpose or ''}")
        tags: set[str] = set()
        for keyword, slug in self._rules:
            if keyword in text:
                tags.add(slug)
                tags.add(slug.split("-", 1)[0])
        return sorted(tags)
