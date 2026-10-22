"""SQL, Python and app share one query normalisation and tokenisation. Needs only the DB (no e5 model)."""
import json
from pathlib import Path

import psycopg
import pytest

from importer import vocab
from importer.embed import normalise_query

URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
ROOT = next(p for p in Path(__file__).resolve().parents if (p / "shared" / "normalise_cases.json").exists())
CASES = json.loads((ROOT / "shared" / "normalise_cases.json").read_text("utf-8"))

pytestmark = [pytest.mark.integration, pytest.mark.ranking]

PHRASES = [
    "Jeu de Go", "Échecs à l'école", "L’escalade en salle", "Salle d'escalade", "Lyon-Villeurbanne",
    "arts-martiaux", "«danse bretonne»", "yoga…", "Où ?!", "cours/ateliers", "  Théâtre  d’improvisation ",
    "Café-philo: débats, rencontres.", "Qu'est-ce que c'est ?", "(poterie) et céramique",
    "Aïkido; Judo", "Œnologie – dégustation", "l'été à Lyon", "ÉCOLE de musique", "école d’art",
    " danse bretonne ", "foot/rugby/basket", "« Tai-chi » !", 'chant "a cappella"',
]


@pytest.fixture(scope="module")
def db():
    with psycopg.connect(URL, autocommit=True) as c:
        yield c


@pytest.mark.parametrize("case", CASES, ids=[repr(c["input"]) for c in CASES])
def test_normalise_cases(db, case):
    got = db.execute("select search.normalise_query(%s)", (case["input"],)).fetchone()[0]
    assert got == case["expected"]
    assert normalise_query(case["input"]) == case["expected"]


@pytest.mark.parametrize("phrase", PHRASES)
def test_tokens_match_python(db, phrase):
    n = normalise_query(phrase)
    assert db.execute("select search.normalise_query(%s)", (phrase,)).fetchone()[0] == n
    sql = db.execute("select search.tokens(%s)", (n,)).fetchone()[0]
    assert list(sql) == vocab.tokens(n)
