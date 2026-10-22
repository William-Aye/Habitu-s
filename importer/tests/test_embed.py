import math

import pytest

from importer.embed import FakeEmbedder, embedding_text, text_hash


def test_fake_embedder_unit_vectors_deterministic():
    e = FakeEmbedder()
    a, b, c = e.embed(["club de go", "club de go", "chorale"])
    assert e.dim == 384 and len(a) == 384
    assert math.isclose(math.sqrt(sum(x * x for x in a)), 1.0, abs_tol=1e-6)
    assert a == b and a != c


def test_text_hash_stable_and_purpose_sensitive():
    t1 = embedding_text("Club", "go")
    assert text_hash(t1) == text_hash(embedding_text("Club", "go"))
    assert text_hash(t1) != text_hash(embedding_text("Club", "échecs"))
    assert len(text_hash(t1)) == 64


def test_embedding_text_collapses_and_truncates():
    assert embedding_text("Club", None) == "Club"
    assert embedding_text("  A   B ", " x \n y") == "A B\nx y"
    assert len(embedding_text("N", "x" * 5000)) == 1000


@pytest.mark.slow
def test_e5_semantic_similarity():
    from importer.embed import E5Embedder

    e = E5Embedder()
    assert e.dim == 384
    q, near, far = e.embed(
        ["club de jeu de go", "association des joueurs de go", "chorale paroissiale"]
    )
    cos = lambda u, v: sum(x * y for x, y in zip(u, v))
    assert cos(q, near) > cos(q, far)


def test_normalise_query():
    from importer.embed import normalise_query

    assert normalise_query("  Jeu  de GO ") == "jeu de go"
    assert normalise_query("école") == "école"
    assert len(normalise_query("a" * 300)) == 200


def test_normalise_query_shared_cases():
    import json
    from pathlib import Path

    from importer.embed import normalise_query

    path = Path(__file__).parents[2] / "shared/normalise_cases.json"
    for c in json.loads(path.read_text()):
        assert normalise_query(c["input"]) == c["expected"], c["input"][:20]
