"""Large-city timing check (local only): 150,000 associations near Paris.

No model: document vectors are a shared mean direction plus noise, so their cosine to that direction
clusters around 0.8 (the range real e5 embeddings occupy). Two cases:
- radius 50 with an unrelated random query (nearly every row scores 0);
- radius 10 with the mean direction as query: fewer than 5 strong rows within 10 km, so the widen
  count over 50 km runs too.
`npm run db:reset` first; it cleans up after itself.
"""
import math
import time

import numpy as np
import psycopg
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.perf]

URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
PARIS = (2.3522, 48.8566)
ROWS = 150_000
P95_LIMIT_MS = 1500
SIM_MEAN, SIM_SD = 0.80, 0.01  # strong (score >= 70) needs similarity >= 0.8365 without a keyword
CLEAR = "delete from public.associations where attribution @> '{\"fixture\": \"perf\"}'"


def _vec(v) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def _unit(v):
    return v / np.linalg.norm(v)


@pytest.fixture(scope="module")
def perf_db():
    rng = np.random.default_rng(42)
    mean = _unit(rng.standard_normal(384))
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(CLEAR)
        # No HNSW index here: migration 007 drops it (search_explore never uses it), so the table
        # matches production.
        try:
            with c.cursor() as cur, cur.copy(
                """copy public.associations (name, purpose, source, confidence, location, website,
                     rna_published_on, embedding, attribution) from stdin"""
            ) as cp:
                for i in range(ROWS):
                    r = 50 * math.sqrt(rng.random())  # uniform over a 50 km disc
                    th = rng.random() * 2 * math.pi
                    lon = PARIS[0] + r * math.cos(th) / (111.32 * math.cos(math.radians(PARIS[1])))
                    lat = PARIS[1] + r * math.sin(th) / 110.57
                    noise = rng.standard_normal(384)
                    noise = _unit(noise - noise.dot(mean) * mean)  # orthogonal to the mean direction
                    s = min(rng.normal(SIM_MEAN, SIM_SD), 0.999)
                    doc = s * mean + math.sqrt(1 - s * s) * noise  # cosine to `mean` is exactly s
                    cp.write_row((f"Association perf {i}", f"Activités diverses numéro {i}", "rna", 60,
                                  f"SRID=4326;POINT({lon:.5f} {lat:.5f})", "https://example.org/p",
                                  "2024-01-01", _vec(doc), '{"fixture": "perf"}'))
            c.execute("analyze public.associations")
            yield c, mean, rng
        finally:
            c.execute(CLEAR)
            c.execute("vacuum public.associations")


def _p95(c, sql, args, label):
    first = c.execute(sql, args).fetchone()[0]  # warm-up
    times = []
    for _ in range(5):
        t0 = time.perf_counter()
        c.execute(sql, args).fetchone()
        times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    p95 = times[-1]  # with 5 samples the 95th percentile is the maximum
    print(f"{label}, {ROWS} rows: sorted ms = {[round(t) for t in times]}, p95 = {p95:.0f}")
    return first, p95, times


def test_search_p95_radius_50(perf_db):
    c, _, rng = perf_db
    q = _vec(_unit(rng.standard_normal(384)))
    _, p95, times = _p95(c, "select public.search_explore(%s, %s, 50, 'club', %s::vector, p_limit => 20)",
                         (PARIS[0], PARIS[1], q), "search_explore radius 50, random query")
    assert p95 < P95_LIMIT_MS, times


def test_search_p95_radius_10_with_widen_count(perf_db):
    c, mean, _ = perf_db
    first, p95, times = _p95(
        c, "select public.search_explore(%s, %s, 10, 'club', %s::vector, p_limit => 20)",
        (PARIS[0], PARIS[1], _vec(mean)), "search_explore radius 10 + widen count, clustered query")
    # The case under test: few strong rows in 10 km, so the 50 km count ran and found more.
    assert first["strong_count"] < 5 and first["strong_count_50km"] is not None, first
    assert first["strong_count_50km"] > first["strong_count"], first
    assert p95 < P95_LIMIT_MS, times
