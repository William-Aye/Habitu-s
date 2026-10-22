"""Ranking fixture: a small invented Lyon directory loaded as postgres with real e5 passage embeddings.

Needs local Supabase (`npm run db:reset`). The model is downloaded on first use (slow).
"""
import json
from datetime import date, timedelta
from pathlib import Path

import psycopg
import pytest

from importer.embed import E5Embedder, embedding_text

URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
FIXTURE = Path(__file__).parent / "fixture_lyon.json"
ORGANISER_EMAIL = "ranking-fixture@example.test"
CENTER = (4.835, 45.764)


def _vec(v) -> str:
    return "[" + ",".join(f"{float(x):.7f}" for x in v) + "]"


def clear_fixture(c):
    c.execute("delete from public.associations where attribution @> '{\"fixture\": \"ranking\"}'")
    # Deleting the user cascades to the profile and to its activities.
    c.execute("delete from auth.users where email = %s", (ORGANISER_EMAIL,))


def load_fixture(c, embedder):
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assocs, acts = data["associations"], data["activities"]
    a_vecs = embedder.embed([embedding_text(a["name"], a["purpose"]) for a in assocs])
    for a, v in zip(assocs, a_vecs):
        c.execute(
            """insert into public.associations
                 (name, purpose, source, confidence, likely_not_public, location, website, osm_id,
                  rna_published_on, embedding, attribution)
               values (%s, %s, %s, %s, %s, st_setsrid(st_makepoint(%s, %s), 4326)::geography, %s, %s,
                       current_date - 400, %s::vector, '{"fixture": "ranking"}')""",
            (a["name"], a["purpose"], a["source"], a["confidence"], a.get("likely_not_public", False),
             a["lon"], a["lat"], a.get("website"), a.get("osm_id"), _vec(v)),
        )
    uid = c.execute(
        """insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                                   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
           values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
                   'authenticated', %s, '', '{}', '{"first_name": "Ranking"}', now(), now())
           returning id""",
        (ORGANISER_EMAIL,),
    ).fetchone()[0]
    t_vecs = embedder.embed([embedding_text(a["title"], a["description"]) for a in acts])
    for a, v in zip(acts, t_vecs):
        c.execute(
            """insert into public.activities
                 (organiser_id, category_id, title, description, place_label, place, recurrence_kind,
                  start_date, start_time, published_at, embedding)
               values (%s, (select id from public.categories where slug = %s), %s, %s, %s,
                       st_setsrid(st_makepoint(%s, %s), 4326)::geography, 'weekly',
                       %s, '19:00', now() - make_interval(days => %s), %s::vector)""",
            (uid, a["category"], a["title"], a["description"], a["place_label"], a["lon"], a["lat"],
             date.today() + timedelta(days=3), a["published_days_ago"], _vec(v)),
        )


@pytest.fixture(scope="session")
def embedder():
    return E5Embedder()


@pytest.fixture(scope="session")
def conn(embedder):
    with psycopg.connect(URL, autocommit=True) as c:
        clear_fixture(c)  # idempotent: a crashed earlier run may have left rows
        load_fixture(c, embedder)
        try:
            yield c
        finally:
            clear_fixture(c)


@pytest.fixture(scope="session")
def query_embed(embedder):
    """Python (fp32) query embeddings."""
    return lambda q: embedder.embed_queries([q])[0]


@pytest.fixture(scope="session")
def search(conn, query_embed):
    def run(q, radius_km=10, **kw):
        qv = query_embed(q)
        row = conn.execute(
            "select public.search_explore(%s, %s, %s, %s, %s::vector, p_limit => 50)",
            (CENTER[0], CENTER[1], radius_km, q, _vec(qv)),
        ).fetchone()[0]
        return row["results"]

    return run


@pytest.fixture(scope="session")
def vec():
    return _vec
