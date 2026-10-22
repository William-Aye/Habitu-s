"""Large-city timing check (local only): 150,000 associations near Paris, radius 50 km.

Uses random unit query/document vectors (no model). `npm run db:reset` first; it cleans up after itself.
"""
import math
import random
import time

import psycopg
import pytest

pytestmark = [pytest.mark.integration, pytest.mark.perf]

URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
PARIS = (2.3522, 48.8566)
ROWS = 150_000
P95_LIMIT_MS = 1500
CLEAR = "delete from public.associations where attribution @> '{\"fixture\": \"perf\"}'"


def unit(rng):
    v = [rng.gauss(0, 1) for _ in range(384)]
    n = math.sqrt(sum(x * x for x in v))
    return "[" + ",".join(f"{x / n:.6f}" for x in v) + "]"


def test_search_p95_large_city():
    rng = random.Random(42)
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(CLEAR)
        # search_explore never uses the HNSW index (post-filtering by distance would lose results),
        # and building it row by row over 150k random vectors takes tens of minutes. Drop it for
        # the load and recreate it (on the emptied table: instant) afterwards.
        c.execute("drop index if exists public.associations_embedding_hnsw")
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
                    cp.write_row((f"Association perf {i}", f"Activités diverses numéro {i}", "rna", 60,
                                  f"SRID=4326;POINT({lon:.5f} {lat:.5f})", "https://example.org/p",
                                  "2024-01-01", unit(rng), '{"fixture": "perf"}'))
            c.execute("analyze public.associations")
            q = unit(rng)
            sql = "select public.search_explore(%s, %s, 50, 'club', %s::vector, p_limit => 20)"
            args = (PARIS[0], PARIS[1], q)
            c.execute(sql, args).fetchone()  # warm-up
            times = []
            for _ in range(5):
                t0 = time.perf_counter()
                c.execute(sql, args).fetchone()
                times.append((time.perf_counter() - t0) * 1000)
            times.sort()
            p95 = times[-1]  # with 5 samples the 95th percentile is the maximum
            print(f"search_explore radius 50, {ROWS} rows: sorted ms = {[round(t) for t in times]}, p95 = {p95:.0f}")
            assert p95 < P95_LIMIT_MS, times
        finally:
            c.execute(CLEAR)
            c.execute("create index if not exists associations_embedding_hnsw on public.associations"
                      " using hnsw (embedding vector_cosine_ops)")
