"""Vocabulary builder: phrases, stop-words, document frequency and selection (no DB)."""
import re
from collections import Counter
from pathlib import Path

from importer import vocab

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


def test_count_document_phrases_prunes_singletons_when_large():
    rows = [(f"mot{i}", "commun") for i in range(50)]
    counts = vocab.count_document_phrases(rows, max_keys=20)
    assert counts["commun"] == 50
    assert len(counts) <= 21


def test_select_phrases_thresholds_and_always():
    counts = Counter({"yoga": 3, "rare": 2, "jeu de go": 5, "cours de": 9, "danse bretonne": 4})
    sel = vocab.select_phrases(counts, always=["coder"])
    assert sel == {"coder": 0, "yoga": 3, "jeu de go": 5, "cours de": 9}


def test_select_phrases_cap_and_ties():
    counts = Counter({"b": 5, "a": 5, "c": 5, "d": 9})
    sel = vocab.select_phrases(counts, cap=3, always=["zzz"])
    assert list(sel) == ["zzz", "d", "a"]
    assert vocab.select_phrases(Counter(dict(reversed(counts.items()))), cap=3, always=["zzz"]) == sel


def test_select_phrases_keeps_always_beyond_cap():
    sel = vocab.select_phrases(Counter({"yoga": 10}), cap=1, always=["a1", "a2"])
    assert set(sel) == {"a1", "a2"}


def test_unit_phrase():
    assert vocab.unit_phrase("Jeux de société") == "jeux de société"
    assert vocab.unit_phrase("Course à pied") == "course à pied"
    assert vocab.unit_phrase("Arts - martiaux") == "arts martiaux"
    assert vocab.unit_phrase(" ... ") == ""


def test_watchlist():
    wl = vocab.watchlist()
    assert len(wl) == 20
    assert "jeu de go" in wl and "course à pied" in wl
