"""Vocabulary builder: phrases, stop-words, document frequency and selection (no DB)."""
import json
import random
import re
from collections import Counter
from datetime import date
from pathlib import Path

from importer import cli, vocab

MIGRATION = (Path(__file__).resolve().parents[2]
             / "supabase" / "migrations" / "20261022000008_query_vocab.sql")


def test_phrases_drop_stopword_edges():
    assert vocab.phrases("Club de Go de Lyon") == {"go", "lyon", "go de lyon"}


def test_phrases_keep_inner_stopwords():
    p = vocab.phrases("Jeu de go")
    assert "jeu de go" in p
    assert "de go" not in p
    assert {"jeu", "go"} <= p


def test_phrases_join_tokens_with_one_space():
    p = vocab.phrases("Cours d'escalade, en salle !")
    assert "escalade en salle" in p
    assert "cours d escalade" in p
    assert not any("'" in x or "," in x or "  " in x for x in p)


def test_phrases_need_a_letter_and_two_characters():
    p = vocab.phrases("x 2024 b2 7e art")
    assert "x" not in p and "2024" not in p
    assert {"b2", "7e", "art"} <= p


def test_phrases_are_at_most_three_tokens():
    assert all(len(x.split(" ")) <= 3 for x in vocab.phrases("yoga pilates stretching méditation zen"))
    assert "yoga pilates stretching" in vocab.phrases("yoga pilates stretching méditation")


def test_phrases_are_normalised():
    assert vocab.phrases("  ÉCHECS Rapides ") == {"échecs", "rapides", "échecs rapides"}


def test_phrases_see_the_whole_long_text():
    assert "escalade" in vocab.phrases("mot " * 100 + "escalade")


def test_tokens_match_sql():
    # Expectations of supabase/tests/09_query_vocab.test.sql (search.tokens).
    assert vocab.tokens("cours d'escalade pour débutants") == ["cours", "d", "escalade", "pour", "débutants"]
    assert vocab.tokens("arts-martiaux, «judo»… (enfants) l’aïkido/karaté?!") == [
        "arts", "martiaux", "judo", "enfants", "l", "aïkido", "karaté"]
    assert vocab.tokens("") == []


def test_tokens_separator_class_is_the_migration_one():
    sql = MIGRATION.read_text(encoding="utf-8")
    m = re.search(r"regexp_split_to_table\(x, '(.*?)'\)", sql)
    assert m, "separator class not found in the migration"
    assert vocab.SEPARATORS == m.group(1).replace("''", "'")


def test_stopwords_match_migration():
    sql = MIGRATION.read_text(encoding="utf-8")
    m = re.search(r"insert into search\.stopwords .*?string_to_array\('([^']*)'", sql)
    assert m, "stop-word insert not found in the migration"
    assert vocab.STOPWORDS == frozenset(m.group(1).split(" "))
    assert len(vocab.STOPWORDS) == 44


def test_count_document_phrases_counts_once_per_association():
    counts = vocab.count_document_phrases([
        ("Grimpe Lyon", "escalade, escalade et encore escalade"),
        ("Escalade 69", None),
        ("Tennis", "tennis de table"),
    ])
    assert counts["escalade"] == 2
    assert counts["tennis"] == 1
    assert counts["tennis de table"] == 1


def _synthetic(n, seed=7):
    rnd = random.Random(seed)
    words = ["escalade", "salle", "yoga", "jeu", "go", "danse", "bretonne", "échecs", "vélo", "lyon",
             "de", "la", "et", "pour", "club", "l'art", "d'été", "course", "à", "pied"]
    words += [f"rare{i}" for i in range(200)]

    def text(k):
        return " ".join(rnd.choice(words[:20] if rnd.random() < 0.8 else words) for _ in range(k))

    return [(text(rnd.randint(1, 4)), None if rnd.random() < 0.1 else text(rnd.randint(3, 30)))
            for _ in range(n)]


def test_sharded_counting_equals_naive_counting():
    rows = _synthetic(400)
    naive = Counter()
    for name, purpose in rows:
        naive.update(vocab.phrases(name) | vocab.phrases(purpose or ""))
    assert vocab.count_document_phrases(rows) == naive
    assert vocab.count_document_phrases(rows, shards=3) == naive
    assert vocab.count_document_phrases(rows, shards=1) == naive


def test_counting_thresholds_keep_and_top_preserve_the_selection():
    rows = _synthetic(400)
    full = vocab.count_document_phrases(rows)
    keep = ["rare1 rare2", "yoga", "rare5"]
    counts = vocab.count_document_phrases(rows, min_df_unigram=3, min_df_multi=5, top=60, keep=keep, shards=8)
    assert all(counts[p] == full[p] for p in counts)
    assert all(p in counts for p in keep if full[p])
    assert all(c >= (5 if " " in p else 3) for p, c in counts.items() if p not in keep)
    for cap in (10, 60):
        assert vocab.select_phrases(counts, cap=cap, always=keep) == vocab.select_phrases(full, cap=cap, always=keep)


def test_select_phrases_thresholds_and_always():
    counts = Counter({"yoga": 3, "rare": 2, "jeu de go": 5, "cours de danse": 9, "danse bretonne": 4})
    sel = vocab.select_phrases(counts, always=["coder"])
    assert sel == {"coder": 0, "yoga": 3, "jeu de go": 5, "cours de danse": 9}


def test_select_phrases_cap_and_ties():
    counts = Counter({"b": 5, "a": 5, "c": 5, "d": 9})
    sel = vocab.select_phrases(counts, cap=3, always=["zzz"])
    assert list(sel) == ["zzz", "d", "a"]
    assert vocab.select_phrases(Counter(dict(reversed(counts.items()))), cap=3, always=["zzz"]) == sel


def test_select_phrases_keeps_always_beyond_cap():
    sel = vocab.select_phrases(Counter({"yoga": 10}), cap=1, always=["a1", "a2"])
    assert set(sel) == {"a1", "a2"}


def test_select_phrases_then_fills_room_after_always_and_before_ngrams():
    counts = Counter({"yoga": 10, "danse": 8, "kazoo": 0})
    sel = vocab.select_phrases(counts, min_df_unigram=1, cap=4, always=["coder"], then=["kazoo", "banjo"])
    assert list(sel) == ["coder", "kazoo", "banjo", "yoga"]
    # `then` counts against the cap, `always` does not stop for it.
    sel = vocab.select_phrases(counts, min_df_unigram=1, cap=2, always=["coder"], then=["kazoo", "banjo"])
    assert list(sel) == ["coder", "kazoo"]
    sel = vocab.select_phrases(counts, min_df_unigram=1, cap=1, always=["a1", "a2"], then=["kazoo"])
    assert list(sel) == ["a1", "a2"]


def test_pick_requests_order_limit_and_validity():
    d1, d2 = date(2026, 10, 20), date(2026, 10, 21)
    rows = [("banjo", 3, d1), ("kazoo", 3, d2), ("ukulélé", 5, d1), ("appeau", 3, d1),
            ("Ukulélé !", 2, d2), ("x", 9, d2), ("42", 9, d2), ("!!", 9, d2)]
    picked, invalid = vocab.pick_requests(rows, limit=3)
    # Most hits, then most recent, then alphabetical; "Ukulélé !" is stored as "ukulélé".
    assert list(picked) == ["ukulélé", "kazoo", "appeau"]
    assert picked["ukulélé"] == ["ukulélé", "Ukulélé !"]
    assert sorted(invalid) == ["!!", "42", "x"]
    assert vocab.MAX_REQUESTS == 2000
    picked, _ = vocab.pick_requests([(f"demande {i:04d}", 2, d1) for i in range(2001)])
    assert len(picked) == 2000 and "demande 2000" not in picked


def test_unit_phrase():
    assert vocab.unit_phrase("Jeux de société") == "jeux de société"
    assert vocab.unit_phrase("Course à pied") == "course à pied"
    assert vocab.unit_phrase("Arts - martiaux") == "arts martiaux"
    assert vocab.unit_phrase(" ... ") == ""


def test_watchlist():
    wl = vocab.watchlist()
    assert len(wl) == 20
    assert "jeu de go" in wl and "course à pied" in wl


class _NullConn:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, *a):
        pass


def test_cli_vocab_warns_on_uncovered_watchlist_phrase(monkeypatch, capsys):
    report = vocab.BuildReport(phrases_total=3, coverage={"yoga": "exact", "arduino": "none"})
    seen = {}
    monkeypatch.setattr(cli.psycopg, "connect", lambda url, autocommit: _NullConn())
    monkeypatch.setattr(cli.vocab, "build",
                        lambda conn, embedder, requests_only, cap: seen.update(ro=requests_only, cap=cap) or report)
    assert cli.main(["vocab", "--db-url", "postgresql://x", "--embedder", "fake",
                     "--requests-only", "--cap", "7"]) == 0
    out, err = capsys.readouterr()
    assert json.loads(out)["coverage"] == {"yoga": "exact", "arduino": "none"}
    assert "warning: watch-list phrase not covered by the vocabulary: arduino" in err
    assert "yoga" not in err
    assert seen == {"ro": True, "cap": 7}


def test_cli_vocab_exit_1_when_build_fails(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(cli.psycopg, "connect", lambda url, autocommit: _NullConn())
    monkeypatch.setattr(cli.vocab, "build", boom)
    assert cli.main(["vocab", "--db-url", "postgresql://x", "--embedder", "fake"]) == 1
