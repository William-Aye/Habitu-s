"""`vocab.build` against the local Supabase DB (`npm run db:reset` first)."""
import json

import psycopg
import pytest

from importer import cli, vocab
from importer.embed import FakeEmbedder

pytestmark = pytest.mark.integration

URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres"
PREFIX = "VOCABTEST"


class CountingEmbedder(FakeEmbedder):
    def __init__(self):
        self.texts = 0

    def embed_queries(self, texts):
        self.texts += len(texts)
        return super().embed_queries(texts)


def _clear(c):
    c.execute("delete from public.associations where rna_id like %s", (PREFIX + "%",))
    c.execute("delete from search.query_vocab")
    c.execute("delete from search.vocab_requests")


@pytest.fixture
def conn():
    """Wipes search.query_vocab and search.vocab_requests before and after (run `db.sh reset` /
    `npm run db:reset` first; pgTAP expects them empty)."""
    with psycopg.connect(URL, autocommit=True) as c:
        _clear(c)
        rows = [
            ("Grimpe en Lyonnais", "Escalade en salle pour tous ; escalade en salle le mardi"),
            ("Vertical 69", "Pratique de l'escalade en salle et en falaise"),
            ("Les Gecko", "escalade en salle, bloc"),
            ("Bloc Party", "Cours d'escalade en salle"),
            ("Prise Libre", "escalade en salle et randonnée"),
            ("Club de Go de Lyon", "Jeu de go, escalade en salle"),
        ]
        for i, (name, purpose) in enumerate(rows):
            c.execute("insert into public.associations (name, purpose, rna_id, source) values (%s, %s, %s, 'rna')",
                      (name, purpose, f"{PREFIX}{i}"))
        try:
            yield c
        finally:
            _clear(c)


def _vocab(c):
    return {p: (s, d) for p, s, d in c.execute("select phrase, source, doc_freq from search.query_vocab")}


def test_build_creates_ngrams_categories_and_watchlist(conn):
    e = CountingEmbedder()
    report = vocab.build(conn, e, min_df_unigram=1, min_df_multi=1)
    v = _vocab(conn)
    assert v["escalade"][1] == 6  # also a category name: source category
    assert v["escalade en salle"] == ("ngram", 6)
    assert v["falaise"] == ("ngram", 1)
    assert v["jeu de go"][1] == 1
    for (name,) in conn.execute("select name_fr from public.categories"):
        assert v[vocab.unit_phrase(name)][0] in ("category", "ngram", "watchlist", "tag", "keyword"), name
    assert v["coder"] == ("watchlist", 0)
    assert v["échecs"][0] in ("watchlist", "category", "keyword")
    assert report.phrases_total == len(v)
    assert report.embedded_new == e.texts == len(v)
    assert report.table_mb > 0
    assert report.coverage["escalade"] == "exact"
    assert report.coverage["jeu de go"] == "exact"
    assert all(m == "exact" for m in report.coverage.values())
    assert conn.execute("select count(*) from search.query_vocab where model <> 'e5-small-v1'").fetchone()[0] == 0
    # The vector is the query embedding of the phrase.
    emb = conn.execute("select embedding::text from search.query_vocab where phrase = 'escalade'").fetchone()[0]
    assert json.loads(emb) == pytest.approx(FakeEmbedder().embed_queries(["escalade"])[0], abs=1e-6)


def test_second_build_embeds_nothing_and_removes_dropped_ngrams(conn):
    vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    e = CountingEmbedder()
    report = vocab.build(conn, e, min_df_unigram=1, min_df_multi=1)
    assert report.embedded_new == 0 and e.texts == 0
    assert report.removed == 0
    # Stricter thresholds: "falaise" (df 1) falls out, "escalade en salle" (df 6) and the
    # watch-list's "jeu de go" (df 1) stay.
    report = vocab.build(conn, CountingEmbedder(), min_df_unigram=3, min_df_multi=5)
    v = _vocab(conn)
    assert "falaise" not in v
    assert "escalade en salle" in v and "coder" in v and "jeu de go" in v
    assert report.removed > 0
    assert report.embedded_new == 0


def test_model_change_is_reembedded(conn):
    vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    conn.execute("update search.query_vocab set model = 'old' where phrase = 'escalade'")
    report = vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    assert report.embedded_new == 1
    assert conn.execute("select model from search.query_vocab where phrase = 'escalade'").fetchone()[0] == "e5-small-v1"


def test_requests_promoted_at_min_hits(conn):
    conn.execute("insert into search.vocab_requests (phrase, hits) values ('ukulélé', 2), ('kazoo', 1)")
    report = vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    v = _vocab(conn)
    assert v["ukulélé"][0] == "request"
    assert "kazoo" not in v
    assert report.requests_added == 1
    left = [r[0] for r in conn.execute("select phrase from search.vocab_requests")]
    assert left == ["kazoo"]
    # A request row stays when the next build no longer sees it anywhere.
    vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    assert _vocab(conn)["ukulélé"][0] == "request"


def test_requests_only_does_not_touch_ngrams(conn):
    vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    before = {p: v for p, v in _vocab(conn).items()}
    stamps = dict(conn.execute("select phrase, updated_at from search.query_vocab where source = 'ngram'"))
    conn.execute("insert into public.associations (name, purpose, rna_id, source) "
                 "values ('Nouveau', 'kitesurf kitesurf', %s, 'rna')", (PREFIX + "x",))
    conn.execute("insert into search.vocab_requests (phrase, hits) values ('ukulélé', 3)")
    conn.execute("delete from search.query_vocab where phrase = 'yoga'")
    e = CountingEmbedder()
    report = vocab.build(conn, e, requests_only=True)
    after = _vocab(conn)
    assert after["ukulélé"][0] == "request"
    assert after["yoga"][0] == "watchlist"
    assert "kitesurf" not in after
    assert e.texts == 2 and report.embedded_new == 2 and report.removed == 0
    assert {p: v for p, v in after.items() if p not in ("ukulélé", "yoga")} == \
        {p: v for p, v in before.items() if p != "yoga"}
    assert dict(conn.execute("select phrase, updated_at from search.query_vocab where source = 'ngram'")) == stamps
    assert report.coverage["yoga"] == "exact"


def test_failed_build_leaves_previous_vocabulary(conn):
    vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    before = _vocab(conn)

    class Broken(FakeEmbedder):
        def embed_queries(self, texts):
            raise RuntimeError("model crashed")

    conn.execute("update search.query_vocab set model = 'old'")
    with pytest.raises(RuntimeError):
        vocab.build(conn, Broken(), min_df_unigram=3, min_df_multi=5)
    assert _vocab(conn) == before
    assert conn.execute("select count(*) from search.query_vocab where model = 'old'").fetchone()[0] == len(before)


def test_cli_vocab_prints_report(conn, monkeypatch, capsys):
    monkeypatch.setattr(cli, "make_embedder", lambda name: FakeEmbedder())
    assert cli.main(["vocab", "--db-url", URL, "--embedder", "fake", "--cap", "1000"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["phrases_total"] > 0 and out["coverage"]["coder"] == "exact"


def test_cli_vocab_fails_with_exit_1(monkeypatch, capsys):
    assert cli.main(["vocab", "--db-url", "postgresql://postgres@127.0.0.1:1/none", "--embedder", "fake"]) == 1


def test_requests_only_keeps_requests_already_in_vocabulary(conn):
    vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    assert _vocab(conn)["escalade en salle"][0] == "ngram"
    conn.execute("insert into search.vocab_requests (phrase, hits) values "
                 "('escalade en salle', 4), ('yoga', 2), ('ukulélé', 2)")
    report = vocab.build(conn, FakeEmbedder(), requests_only=True)
    v = _vocab(conn)
    assert v["escalade en salle"][0] == "ngram" and v["yoga"][0] == "category"
    assert v["ukulélé"][0] == "request"
    assert report.requests_added == 1
    left = sorted(r[0] for r in conn.execute("select phrase from search.vocab_requests"))
    assert left == ["escalade en salle", "yoga"]
    # The next full build marks them 'request' (counted) and removes them from the requests.
    report = vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    v = _vocab(conn)
    assert v["escalade en salle"] == ("request", 6) and v["yoga"][0] == "request"
    assert report.requests_added == 2 and report.embedded_new == 0
    assert conn.execute("select count(*) from search.vocab_requests").fetchone()[0] == 0


def test_full_build_counts_converted_requests(conn):
    vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    conn.execute("insert into search.vocab_requests (phrase, hits) values ('falaise', 2), ('kazoo', 2)")
    report = vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1)
    v = _vocab(conn)
    assert v["falaise"] == ("request", 1) and v["kazoo"] == ("request", 0)
    assert report.requests_added == 2 and report.embedded_new == 1
    # Already 'request': not counted again.
    conn.execute("insert into search.vocab_requests (phrase, hits) values ('kazoo', 5)")
    assert vocab.build(conn, FakeEmbedder(), min_df_unigram=1, min_df_multi=1).requests_added == 0
