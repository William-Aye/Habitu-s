"""Spec section 13 ranking set. Needs local Supabase with the fixture and the e5 model (CI `ranking` job).

Never fix a failure here by special-casing a query: tune `search.params()` only.
"""
import os

import pytest

from conftest import ORGANISER_EMAIL

pytestmark = [pytest.mark.integration, pytest.mark.slow, pytest.mark.ranking]


def titles(results):
    return [r["title"] for r in results]


def top10(results):
    return [(r["title"], r["score"], r["label"], r["is_weak"]) for r in results[:10]]


def check(cond, results, msg):
    assert cond, f"{msg}; top 10 (title, score, label, is_weak) = {top10(results)}"


def rank(results, title):
    check(title in titles(results), results, f"{title!r} missing")
    return titles(results).index(title) + 1


def top(results, n):
    return titles(results)[:n]


def assert_very_relevant(results, expected):
    by_title = {r["title"]: r for r in results}
    for t in expected:
        check(t in by_title, results, f"{t!r} missing")
        check(by_title[t]["label"] == "very_relevant", results,
              f"{t!r} is {by_title[t]['label']} (score {by_title[t]['score']}), expected very_relevant")


def exact(search, q):
    """Run the query once; assert it resolved by exact phrase; return the results."""
    full = search.full(q)
    qm = full.get("query_match")
    assert qm == "exact", f"{q!r}: query_match is {qm!r}, expected 'exact'"
    return full["results"]


def test_coder(search):
    res = exact(search, "coder")
    expected = ["Club informatique de la Croix-Rousse", "Atelier Arduino Villeurbanne", "Python Lyon"]
    for t in expected:
        check(t in top(res, 5), res, f"{t!r} not in top 5")
    check("Chorale Saint-Jean" not in top(res, 10), res, "Chorale Saint-Jean in top 10")
    assert_very_relevant(res, expected)


GO_RELATED = ["Club de Go de Lyon", "Soirée jeu de go", "Go Club Lyon Sud", "Copropriété Les Tilleuls"]


def test_jeu_de_go(search):
    res = exact(search, "jeu de go")
    first = titles(res)[0]
    check(first in ("Club de Go de Lyon", "Soirée jeu de go"), res, f"rank 1 is {first!r}")
    top3 = top(res, 3)
    for t in ("Club de Go de Lyon", "Soirée jeu de go", "Go Club Lyon Sud"):
        check(t in top3, res, f"{t!r} not in top 3")
    # Gogo Danse Fitness shares only the "go" letters: it must rank below every go-related row
    # (the fixture has only four) and never be "very relevant". It may be absent altogether.
    if "Gogo Danse Fitness" in titles(res):
        gogo = rank(res, "Gogo Danse Fitness")
        for t in GO_RELATED:
            if t in titles(res):
                check(gogo > rank(res, t), res, f"Gogo Danse Fitness (rank {gogo}) not below {t!r}")
        label = next(r["label"] for r in res if r["title"] == "Gogo Danse Fitness")
        check(label != "very_relevant", res, "Gogo Danse Fitness is very_relevant")
    check(not any("hors rayon" in t for t in titles(res)), res, "40 km go club present")
    assert_very_relevant(res, ["Club de Go de Lyon", "Soirée jeu de go", "Go Club Lyon Sud"])


def test_danse_bretonne(search):
    res = exact(search, "danse bretonne")
    check(rank(res, "Cercle celtique de Lyon") == 1, res, "Cercle celtique not rank 1")
    check(rank(res, "Association des Bretons de Lyon") <= 3, res, "Bretons not in top 3")
    salsa = rank(res, "Salsa Lyon")
    check(salsa > rank(res, "Cercle celtique de Lyon"), res, "Salsa above Cercle celtique")
    check(salsa > rank(res, "Association des Bretons de Lyon"), res, "Salsa above Bretons")
    assert_very_relevant(res, ["Cercle celtique de Lyon", "Association des Bretons de Lyon"])


def test_escalade(search):
    res = exact(search, "escalade")
    expected = ["Club alpin Lyon-Villeurbanne", "Salle d'escalade Vertical Lyon"]
    for t in expected:
        check(t in top(res, 3), res, f"{t!r} not in top 3")
    check("L'Escale solidaire" not in top(res, 3), res, "L'Escale solidaire in top 3")
    assert_very_relevant(res, expected)


def test_words_fallback(search):
    q = "cours de danse bretonne pour débutants"
    full = search.full(q)
    res = full["results"]
    check(full.get("query_match") == "words", res, f"query_match is {full.get('query_match')!r}")
    check("Cercle celtique de Lyon" in top(res, 3), res, "Cercle celtique not in top 3")


def test_fuzzy_fallback(search):
    full = search.full("escalde")
    res = full["results"]
    check(full.get("query_match") == "fuzzy", res, f"query_match is {full.get('query_match')!r}")
    check("Club alpin Lyon-Villeurbanne" in top(res, 3), res, "Club alpin not in top 3")


def test_unknown_query_is_keyword_only(search):
    full = search.full("zzz qqq")
    assert full["mode"] == "keyword_only", full.get("mode")


QUERIES = ["coder", "jeu de go", "danse bretonne", "escalade"]


@pytest.mark.parametrize("q", QUERIES)
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
            assert t.index(name) < i, (q, name, sim, tilleuls_sim, top10(search(q)))


@pytest.mark.skipif(os.environ.get("RANKING_REPORT") != "1", reason="set RANKING_REPORT=1 for the tuning report")
def test_ranking_report(search, conn, embedder, vec):
    """Always passes. Prints, per query, the ranked results and every fixture row's raw cosine
    similarity and keyword hit, so params can be tuned from one CI log (run with -s)."""
    for q in QUERIES:
        full = search.full(q)
        res = full["results"]
        print(f"\n=== RANKING REPORT: {q!r} === query_match={full.get('query_match')} mode={full.get('mode')}")
        print("rank | title | kind | score | label | is_weak | distance_km")
        for i, r in enumerate(res, 1):
            print(f"{i:>3} | {r['title']} | {r['kind']} | {r['score']} | {r['label']} | {r['is_weak']} | {r['distance_km']}")
        qv = vec(embedder.embed_queries([q])[0])
        rows = conn.execute(
            """select kind, title, sim, kw, name_sim from (
                 select 'association' as kind, name as title, 1 - (embedding <=> %(v)s::vector) as sim,
                        (search_tsv @@ websearch_to_tsquery('french', search.unaccent(%(q)s))) as kw,
                        word_similarity(search.normalise_name(%(q)s), name_norm) as name_sim
                 from public.associations where attribution @> '{"fixture": "ranking"}'
                 union all
                 select 'activity', title, 1 - (embedding <=> %(v)s::vector),
                        (search_tsv @@ websearch_to_tsquery('french', search.unaccent(%(q)s))),
                        word_similarity(search.normalise_name(%(q)s), search.normalise_name(title))
                 from public.activities where organiser_id in (select id from auth.users where email = %(e)s)
               ) x order by sim desc""",
            {"v": qv, "q": q, "e": ORGANISER_EMAIL},
        ).fetchall()
        print("--- raw cosine similarity (desc) | kind | title | fts_hit | name_sim | name_hit(>=0.6)")
        for kind, title, sim, kw, ns in rows:
            print(f"{sim:.4f} | {kind} | {title} | {bool(kw)} | {ns:.2f} | {ns >= 0.6}")

