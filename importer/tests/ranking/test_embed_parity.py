"""Edge-vs-Python query embedding parity. Needs `npx supabase functions serve embed-query`."""
import math
import os

import httpx
import pytest

from importer.embed import E5Embedder

pytestmark = pytest.mark.edge

URL = os.environ.get("EMBED_QUERY_URL", "http://127.0.0.1:55321/functions/v1/embed-query")
KEY = os.environ.get("SUPABASE_ANON_KEY", "")
QUERIES = ["coder", "jeu de go", "danse bretonne", "escalade"]


def _cos(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


@pytest.fixture(scope="module")
def edge():
    headers = {"Authorization": f"Bearer {KEY}"} if KEY else {}

    def call(q):
        r = httpx.post(URL, json={"text": q}, headers=headers, timeout=120)
        r.raise_for_status()
        return r.json()["embedding"]

    try:
        call("test")
    except (httpx.ConnectError, httpx.ConnectTimeout) as e:
        pytest.skip(f"embed-query not reachable at {URL} (run `npx supabase functions serve embed-query`): {e}")
    return call


@pytest.mark.parametrize("q", QUERIES)
def test_edge_matches_python(edge, q):
    py = E5Embedder().embed_queries([q])[0]
    assert _cos(edge(q), py) >= 0.99
