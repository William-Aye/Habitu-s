"""Spec section 13 ranking set. Needs local Supabase with the fixture and the e5 model (CI `ranking` job).

Never fix a failure here by special-casing a query: tune `search.params()` only.
"""
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.slow, pytest.mark.ranking]


def titles(results):
    return [r["title"] for r in results]


def rank(results, title):
    t = titles(results)
    assert title in t, f"{title!r} missing from {t}"
    return t.index(title) + 1


def top(results, n):
    return titles(results)[:n]


def assert_very_relevant(results, expected):
    by_title = {r["title"]: r for r in results}
    for t in expected:
        assert by_title[t]["label"] == "very_relevant", (t, by_title[t]["label"], by_title[t]["score"])


def test_coder(search):
    res = search("coder")
    expected = ["Club informatique de la Croix-Rousse", "Atelier Arduino Villeurbanne", "Python Lyon"]
    for t in expected:
        assert t in top(res, 5), titles(res)[:10]
    assert "Chorale Saint-Jean" not in top(res, 10), titles(res)[:10]
    assert_very_relevant(res, expected)


def test_jeu_de_go(search):
    res = search("jeu de go")
    first = titles(res)[0]
    assert first in ("Club de Go de Lyon", "Soirée jeu de go"), titles(res)[:5]
    top3 = top(res, 3)
    for t in ("Club de Go de Lyon", "Soirée jeu de go", "Go Club Lyon Sud"):
        assert t in top3, titles(res)[:6]
    assert "Gogo Danse Fitness" not in top(res, 5), titles(res)[:6]
    assert not any("hors rayon" in t for t in titles(res))
    assert_very_relevant(res, ["Club de Go de Lyon", "Soirée jeu de go", "Go Club Lyon Sud"])


def test_danse_bretonne(search):
    res = search("danse bretonne")
    assert rank(res, "Cercle celtique de Lyon") == 1, titles(res)[:5]
    assert rank(res, "Association des Bretons de Lyon") <= 3, titles(res)[:5]
    salsa = rank(res, "Salsa Lyon")
    assert salsa > rank(res, "Cercle celtique de Lyon")
    assert salsa > rank(res, "Association des Bretons de Lyon")
    assert_very_relevant(res, ["Cercle celtique de Lyon", "Association des Bretons de Lyon"])


def test_escalade(search):
    res = search("escalade")
    expected = ["Club alpin Lyon-Villeurbanne", "Salle d'escalade Vertical Lyon"]
    for t in expected:
        assert t in top(res, 3), titles(res)[:6]
    assert "L'Escale solidaire" not in top(res, 3), titles(res)[:6]
    assert_very_relevant(res, expected)


@pytest.mark.parametrize("q", ["coder", "jeu de go", "danse bretonne", "escalade"])
def test_not_public_never_above_more_similar_unflagged(search, conn, embedder, vec, q):
    """"Copropriété Les Tilleuls" (likely_not_public) never outranks an unflagged result that is
    more similar to the query."""
    t = titles(search(q))
    if "Copropriété Les Tilleuls" not in t:
        return  # filtered out entirely: nothing can be ranked below it
    qv = vec(embedder.embed_queries([q])[0])
    sims = dict(conn.execute(
        """select name, 1 - (embedding <=> %s::vector) from public.associations
           where attribution @> '{"fixture": "ranking"}' and not likely_not_public""", (qv,)).fetchall())
    tilleuls_sim = conn.execute(
        "select 1 - (embedding <=> %s::vector) from public.associations where name = 'Copropriété Les Tilleuls'",
        (qv,)).fetchone()[0]
    i = t.index("Copropriété Les Tilleuls")
    for name, sim in sims.items():
        if sim > tilleuls_sim and name in t:
            assert t.index(name) < i, (q, name, sim, tilleuls_sim, t[: i + 1])
