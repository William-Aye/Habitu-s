"""Edge-vs-Python query embedding parity. Needs `npx supabase functions serve embed-query`.

The ranking rule was tuned on Python (fp32) query embeddings; production embeds queries in the
Edge Function (Transformers.js, q8). CI serves the function and runs this file.
"""
import math

import edge_client
import pytest

from importer.embed import E5Embedder

pytestmark = pytest.mark.edge

QUERIES = ["coder", "jeu de go", "danse bretonne", "escalade"]


def _cos(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


@pytest.fixture(scope="module")
def edge():
    return edge_client.connect()


@pytest.mark.parametrize("q", QUERIES)
def test_edge_matches_python(edge, q):
    py = E5Embedder().embed_queries([q])[0]
    assert _cos(edge(q), py) >= 0.99
