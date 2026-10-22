"""Query vocabulary: the words and short phrases people search, embedded once ("query: " prefix) and
stored in search.query_vocab so the database resolves a query's meaning without a live model
(search.resolve_query; docs/plans/2026-10-22-query-vocabulary.md).

Sources: 1-3 token phrases of association names and purposes (kept by document frequency),
category names, tag labels, tagging keywords, the watch-list (data/vocab_watchlist.txt) and the
anonymised requests of search.vocab_requests seen at least vocab_request_min_hits times.

Every stored phrase is `" ".join(tokens(...))`: search.resolve_query builds its candidate units by
joining search.tokens(...) with single spaces, so any other spelling could never match.

Memory: associations are streamed with a server-side cursor; only the document-frequency Counter
(bounded, see count_document_phrases), the existing phrase -> model map and one embedding batch are
held. Safety: new vectors are COPYed batch by batch into a session temp table; the vocabulary itself
changes in one final transaction (upsert, deletes, requests), so an interrupted build leaves the
previous vocabulary intact.
"""
import csv
import heapq
import logging
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import psycopg

from importer.db import _vector
from importer.embed import _QUERY_WS, normalise_query

log = logging.getLogger("importer")

DATA = Path(__file__).parent / "data"
MODEL = "e5-small-v1"
MAX_TOKENS = 3
# Copied from search.tokens (supabase/migrations/20261022000008_query_vocab.sql); a test compares them.
SEPARATORS = "[ '’\\-.,;:!?()\"/«»…]+"
_SPLIT = re.compile(SEPARATORS)
STOPWORDS: frozenset[str] = frozenset(
    w for w in (DATA / "stopwords_fr.txt").read_text(encoding="utf-8").split() if w
)
# Above this many distinct phrases the counter drops the ones seen once (see count_document_phrases).
MAX_COUNTER_KEYS = 5_000_000  # ~0.8 GB peak; measured 349 MB at 2.2M keys
FETCH_ROWS = 10_000
PROGRESS_EVERY = 250_000


class QueryEmbedder(Protocol):
    def embed_queries(self, texts: list[str]) -> Sequence[Sequence[float]]: ...


@dataclass
class BuildReport:
    phrases_total: int = 0
    embedded_new: int = 0
    removed: int = 0
    requests_added: int = 0
    table_mb: float = 0.0
    coverage: dict[str, str] = field(default_factory=dict)


def tokens(normalised: str) -> list[str]:
    """Same split as search.tokens: on the separator class, empty tokens dropped."""
    return [t for t in _SPLIT.split(normalised) if t]


def _normalise_document(text: str) -> str:
    # normalise_query without the 200 code point cut: a purpose is longer than a query, and each
    # phrase taken from it (<= 3 tokens) is unchanged by normalise_query.
    return _QUERY_WS.sub(" ", unicodedata.normalize("NFC", text)).strip(" ").lower()


def unit_phrase(text: str) -> str:
    """How a category, tag, keyword, watch-list or request phrase is stored ('' = skip it)."""
    return " ".join(tokens(normalise_query(text)))


def _ok(phrase: str) -> bool:
    return len(phrase) >= 2 and any(ch.isalpha() for ch in phrase)


def _token_phrases(toks: list[str]) -> set[str]:
    out: set[str] = set()
    n = len(toks)
    for i, first in enumerate(toks):
        if first in STOPWORDS:
            continue
        for j in range(i, min(i + MAX_TOKENS, n)):
            if toks[j] in STOPWORDS:
                continue
            phrase = first if j == i else " ".join(toks[i:j + 1])
            if _ok(phrase):
                out.add(phrase)
    return out


def phrases(text: str) -> set[str]:
    """Distinct 1-3 token phrases that neither start nor end with a stop-word, have a letter and
    at least 2 characters; inner stop-words are kept ("jeu de go")."""
    return _token_phrases(tokens(_normalise_document(text or "")))


def count_document_phrases(
    rows: Iterable[tuple[str, str | None]], *, max_keys: int = MAX_COUNTER_KEYS
) -> Counter[str]:
    """Phrase -> number of associations (name, purpose) containing it.

    Bounded memory: when the counter exceeds max_keys distinct phrases, the phrases seen once are
    dropped. A phrase can then be under-counted by at most one per prune, which only matters near
    the selection threshold: frequent phrases survive their first prune and are counted exactly
    from then on. Measured on 150k synthetic associations (2.2M distinct phrases, ~350 MB peak),
    no prune happens at the default bound; forcing it down to 500k keys still kept 79 % of the
    same 150k selection, the difference being low-frequency tail phrases.
    """
    counts: Counter[str] = Counter()
    n = 0
    for n, (name, purpose) in enumerate(rows, start=1):
        counts.update(phrases(name or "") | phrases(purpose or ""))
        if len(counts) > max_keys:
            before = len(counts)
            for k in [k for k, c in counts.items() if c == 1]:
                del counts[k]
            log.info("vocab: pruned %d single-use phrases after %d associations", before - len(counts), n)
        if n % PROGRESS_EVERY == 0:
            log.info("vocab: %d associations read, %d distinct phrases", n, len(counts))
    return counts


def select_phrases(
    counts: Counter[str],
    *,
    min_df_unigram: int = 3,
    min_df_multi: int = 5,
    cap: int = 150_000,
    always: Iterable[str] = (),
) -> dict[str, int]:
    """phrase -> document frequency. `always` phrases are kept regardless and count against the
    cap first (all of them are kept even beyond it); the rest by descending frequency, ties
    alphabetical."""
    out: dict[str, int] = {}
    for p in always:
        if p and p not in out:
            out[p] = counts.get(p, 0)
    room = cap - len(out)
    if room > 0:
        eligible = (
            (c, p) for p, c in counts.items()
            if p not in out and c >= (min_df_multi if " " in p else min_df_unigram)
        )
        for c, p in heapq.nsmallest(room, eligible, key=lambda cp: (-cp[0], cp[1])):
            out[p] = c
    return out


def watchlist(path: Path = DATA / "vocab_watchlist.txt") -> list[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _keywords(path: Path = DATA / "keywords.csv") -> list[str]:
    with path.open(encoding="utf-8", newline="") as f:
        return [r["keyword"] for r in csv.DictReader(f)]


def _documents(conn: psycopg.Connection) -> Iterable[tuple[str, str | None]]:
    with conn.transaction():
        with conn.cursor(name="vocab_associations") as cur:
            cur.itersize = FETCH_ROWS
            cur.execute("select name, purpose from public.associations")
            yield from cur


def build(
    conn: psycopg.Connection,
    embedder: QueryEmbedder,
    *,
    requests_only: bool = False,
    min_df_unigram: int = 3,
    min_df_multi: int = 5,
    cap: int = 150_000,
    batch_size: int = 512,
) -> BuildReport:
    """Rebuild search.query_vocab (or, with requests_only, add the requests and the watch-list).

    `conn` must be in autocommit mode: each step commits on its own and the vocabulary changes in
    the last one only."""
    if not conn.autocommit:
        raise ValueError("vocab.build needs an autocommit connection")
    report = BuildReport()
    min_hits = conn.execute("select (search.params()).vocab_request_min_hits").fetchone()[0]
    requests_raw = [r[0] for r in conn.execute(
        "select phrase from search.vocab_requests where hits >= %s order by phrase", (min_hits,))]
    existing: dict[str, tuple[str, str]] = {
        p: (m, s) for p, m, s in conn.execute("select phrase, model, source from search.query_vocab")
    }

    # Sources in priority order: a phrase found in several keeps the first one.
    sources: dict[str, str] = {}

    def add(texts: Iterable[str], source: str) -> None:
        for t in texts:
            p = unit_phrase(t)
            if p and p not in sources:
                sources[p] = source

    if requests_only:
        add(watchlist(), "watchlist")
        add(requests_raw, "request")
        selected = {p: 0 for p in sources if p not in existing}
    else:
        add((r[0] for r in conn.execute("select name_fr from public.categories order by sort_order, slug")),
            "category")
        add((r[0] for r in conn.execute("select label_fr from public.tags order by slug")), "tag")
        add(_keywords(), "keyword")
        add(watchlist(), "watchlist")
        add(requests_raw, "request")
        # Requests promoted earlier are kept (the delete below spares them) and re-embedded on a
        # model change.
        add((p for p, (_, s) in existing.items() if s == "request"), "request")
        counts = count_document_phrases(_documents(conn))
        log.info("vocab: %d distinct phrases counted", len(counts))
        selected = select_phrases(counts, min_df_unigram=min_df_unigram, min_df_multi=min_df_multi,
                                  cap=cap, always=sources)
        del counts
    todo = [p for p in selected if existing.get(p, (None,))[0] != MODEL]
    log.info("vocab: %d phrases selected, %d to embed", len(selected), len(todo))

    conn.execute("create temp table if not exists vocab_build (phrase text primary key, "
                 "embedding extensions.vector(384), source text not null, doc_freq int not null)")
    conn.execute("truncate vocab_build")
    copy_sql = "copy vocab_build (phrase, embedding, source, doc_freq) from stdin"
    try:
        # Unchanged phrases (no new vector): their source and frequency are refreshed.
        with conn.transaction(), conn.cursor() as cur, cur.copy(copy_sql) as copy:
            for p, df in selected.items():
                if existing.get(p, (None,))[0] == MODEL:
                    copy.write_row((p, None, sources.get(p, "ngram"), df))
        for i in range(0, len(todo), batch_size):
            batch = todo[i:i + batch_size]
            vectors = embedder.embed_queries(batch)
            with conn.transaction(), conn.cursor() as cur, cur.copy(copy_sql) as copy:
                for p, v in zip(batch, vectors, strict=True):
                    copy.write_row((p, _vector(v), sources.get(p, "ngram"), selected[p]))
            if (i // batch_size) % 50 == 0:
                log.info("vocab: %d of %d phrases embedded", min(i + batch_size, len(todo)), len(todo))

        with conn.transaction():
            if not requests_only:
                conn.execute("""
                    update search.query_vocab v
                    set doc_freq = t.doc_freq,
                        source = case when v.source = 'request' then v.source else t.source end,
                        updated_at = now()
                    from vocab_build t
                    where t.phrase = v.phrase and t.embedding is null
                      and (v.doc_freq, v.source) is distinct from
                          (t.doc_freq, case when v.source = 'request' then v.source else t.source end)""")
            conflict = ("do nothing" if requests_only else """do update set
                embedding = excluded.embedding, model = excluded.model, doc_freq = excluded.doc_freq,
                source = case when v.source = 'request' then v.source else excluded.source end,
                updated_at = now()""")
            inserted = conn.execute(f"""
                insert into search.query_vocab as v (phrase, embedding, source, doc_freq, model)
                select phrase, embedding, source, doc_freq, %s from vocab_build
                where embedding is not null
                on conflict (phrase) {conflict}
                returning v.source, (xmax = 0) as is_new""", (MODEL,)).fetchall()
            report.embedded_new = len(inserted)
            report.requests_added = sum(1 for s, new in inserted if new and s == "request")
            if not requests_only:
                report.removed = conn.execute("""
                    delete from search.query_vocab v
                    where v.source <> 'request'
                      and not exists (select 1 from vocab_build t where t.phrase = v.phrase)""").rowcount
            conn.execute("delete from search.vocab_requests where phrase = any(%s)", (requests_raw,))
    finally:
        try:
            conn.execute("drop table if exists vocab_build")
        except psycopg.Error:
            pass  # the session is unusable; the temp table goes with it

    report.phrases_total, report.table_mb = conn.execute(
        "select count(*)::int, round(pg_total_relation_size('search.query_vocab') / 1048576.0, 2)::float8 "
        "from search.query_vocab").fetchone()
    report.coverage = {
        p: conn.execute("select method from search.resolve_query(%s)", (p,)).fetchone()[0]
        for p in watchlist()
    }
    log.info("vocab: %s", report)
    return report
