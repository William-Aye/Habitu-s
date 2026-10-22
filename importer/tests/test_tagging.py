import csv
import re
from pathlib import Path

from importer.tagging import Tagger

SEED = Path(__file__).resolve().parents[2] / "supabase" / "seed.sql"
RULES = Path(__file__).resolve().parents[1] / "importer" / "data" / "keywords.csv"


def _seed_child_slugs() -> set[str]:
    sql = SEED.read_text(encoding="utf-8")
    block = sql.split("-- Child categories", 1)[1].split("as v(parent_slug", 1)[0]
    return set(re.findall(r"\(\s*'\w+',\s*'(\w+-[\w-]+)'", block))


def test_go_club_gets_child_and_parent():
    tags = Tagger().tags_for("Club de Go de Lyon", None)
    assert "games-go" in tags and "games" in tags
    assert tags == sorted(set(tags))


def test_whole_word_only():
    assert "games-go" not in Tagger().tags_for("Gogo dancers", None)


def test_arduino_workshop():
    tags = Tagger().tags_for("Atelier Arduino", None)
    assert "tech-arduino" in tags and "tech" in tags


def test_elision_and_accents():
    t = Tagger()
    assert "sport-escalade" in t.tags_for("Section d'escalade", None)
    assert "games-echecs" in t.tags_for("Club de l'échiquier", None)
    assert "music-chorale" in t.tags_for("Asso", "Une CHORALE amateur")


def test_multi_word_phrase():
    assert "games-go" in Tagger().tags_for("Association", "Pratique du jeu de go")


def test_no_match():
    assert Tagger().tags_for("Amicale des pompiers", None) == []


def test_rules_slugs_exist_in_seed_and_cover_all_children():
    children = _seed_child_slugs()
    assert len(children) == 56
    with RULES.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["category_slug"]] = counts.get(r["category_slug"], 0) + 1
    assert set(counts) <= children
    for slug in children:
        assert counts.get(slug, 0) >= 3, slug
