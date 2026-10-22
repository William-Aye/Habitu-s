"""Query vocabulary: the words and short phrases people search, embedded once ("query: " prefix) and
stored in search.query_vocab so the database resolves a query's meaning without a live model
(search.resolve_query; docs/plans/2026-10-22-query-vocabulary.md).

Sources: 1-3 token phrases of association names and purposes (kept by document frequency),
category names, tag labels, tagging keywords, the watch-list (data/vocab_watchlist.txt) and the
anonymised requests of search.vocab_requests seen on at least vocab_request_min_hits days (at most
MAX_REQUESTS a run; promoted requests count against the cap, right after the curated phrases).

Every stored phrase is `" ".join(tokens(...))`: search.resolve_query builds its candidate units by
joining search.tokens(...) with single spaces, so any other spelling could never match.

Memory: associations are streamed with a server-side cursor and their phrases spilled to hash
shards on disk (see count_document_phrases); only one shard's counter, the surviving phrases, the
existing phrase -> model map and one embedding batch are held. Safety: new vectors are COPYed batch by batch into a session temp table; the vocabulary itself
changes in one final transaction (upsert, deletes, requests), so an interrupted build leaves the
previous vocabulary intact.
"""
import csv
import heapq
import logging
import re
import tempfile
import unicodedata
import zlib
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
# Temporary shard files of count_document_phrases (phrases partitioned by crc32).
SHARDS = 64
FETCH_ROWS = 10_000
PROGRESS_EVERY = 250_000
# Requests promoted per run (most hits, then most recently seen, then alphabetical); the rest wait.
MAX_REQUESTS = 2_000
# A promoted request that no association text contains is dropped by a full build after this long.
REQUEST_KEEP_DAYS = 365


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
    rows: Iterable[tuple[str, str | None]],
    *,
    min_df_unigram: int = 1,
    min_df_multi: int = 1,
    top: int | None = None,
    keep: Iterable[str] = (),
    shards: int = SHARDS,
) -> Counter[str]:
    """Exact phrase -> number of associations (name, purpose) containing it.

    Only phrases meeting their threshold (min_df_unigram for one token, min_df_multi for more) or
    listed in `keep` are returned. With `top`, each shard also keeps only its `top` most frequent
    other phrases (ties alphabetical): the global top `top` is among them, so select_phrases with
    cap <= top selects exactly what it would from the full counts.

    Memory: each association's distinct phrases are written to one of `shards` temporary files
    chosen by crc32(phrase), so every occurrence of a phrase lands in the same file; each file is
    then counted with its own Counter. Peak memory is about one shard's bytes and distinct phrases
    plus the survivors; temporary disk is about 16 bytes per phrase occurrence.
    """
    keep_b = {p.encode("utf-8") for p in keep}
    out: Counter[str] = Counter()
    with tempfile.TemporaryDirectory(prefix="vocab-") as tmp:
        paths = [Path(tmp) / f"{i:03d}" for i in range(shards)]
        files = [path.open("wb", buffering=1 << 20) for path in paths]
        n = 0
        try:
            for n, (name, purpose) in enumerate(rows, start=1):
                # A phrase never holds "\n" (normalisation turns it into a space).
                for p in phrases(name or "") | phrases(purpose or ""):
                    b = p.encode("utf-8")
                    files[zlib.crc32(b) % shards].write(b + b"\n")
                if n % PROGRESS_EVERY == 0:
                    log.info("vocab: %d associations read", n)
        finally:
            for f in files:
                f.close()
        disk = sum(path.stat().st_size for path in paths)
        log.info("vocab: %d associations read, %.1f MB of phrases in %d shards", n, disk / 1048576, shards)
        for path in paths:
            counts = Counter(path.read_bytes().split(b"\n"))
            path.unlink()
            counts.pop(b"", None)
            kept = []
            for b, c in counts.items():
                if b in keep_b:
                    out[b.decode("utf-8")] = c
                elif c >= (min_df_multi if b" " in b else min_df_unigram):
                    kept.append((c, b))
            del counts
            if top is not None and len(kept) > top:
                # UTF-8 byte order is code point order, i.e. str order.
                kept = heapq.nsmallest(top, kept, key=lambda cb: (-cb[0], cb[1]))
            for c, b in kept:
                out[b.decode("utf-8")] = c
    return out


def select_phrases(
    counts: Counter[str],
    *,
    min_df_unigram: int = 3,
    min_df_multi: int = 5,
    cap: int = 150_000,
    always: Iterable[str] = (),
    then: Iterable[str] = (),
) -> dict[str, int]:
    """phrase -> document frequency. `always` phrases are kept regardless and count against the
    cap first (all of them are kept even beyond it); then the `then` phrases in order while there
    is room; the rest by descending frequency, ties alphabetical."""
    out: dict[str, int] = {}
    for p in always:
        if p and p not in out:
            out[p] = counts.get(p, 0)
    for p in then:
        if len(out) >= cap:
            break
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


def pick_requests(
    rows: Iterable[tuple[str, int, object]], limit: int = MAX_REQUESTS,
) -> tuple[dict[str, list[str]], list[str]]:
    """Requests (phrase, hits, last_seen) -> ({stored phrase: request phrases}, invalid phrases).

    At most `limit` stored phrases, by most hits, then most recent last_seen, then alphabetical.
    A request whose stored phrase fails the phrase checks (a letter, 2 characters) is invalid."""
    ranked = sorted(rows, key=lambda r: r[0])
    ranked.sort(key=lambda r: r[2], reverse=True)
    ranked.sort(key=lambda r: r[1], reverse=True)
    picked: dict[str, list[str]] = {}
    invalid: list[str] = []
    for raw, _, _ in ranked:
        p = unit_phrase(raw)
        if not _ok(p):
            invalid.append(raw)
        elif p in picked:
            picked[p].append(raw)
        elif len(picked) < limit:
            picked[p] = [raw]
    return picked, invalid


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
    max_requests: int = MAX_REQUESTS,
) -> BuildReport:
    """Rebuild search.query_vocab (or, with requests_only, add the requests and the watch-list).

    `conn` must be in autocommit mode: each step commits on its own and the vocabulary changes in
    the last one only."""
    if not conn.autocommit:
        raise ValueError("vocab.build needs an autocommit connection")
    report = BuildReport()
    min_hits = conn.execute("select (search.params()).vocab_request_min_hits").fetchone()[0]
    picked, invalid = pick_requests(conn.execute(
        "select phrase, hits, last_seen from search.vocab_requests where hits >= %s", (min_hits,)),
        max_requests)
    # phrase -> (model, source, older than REQUEST_KEEP_DAYS)
    existing: dict[str, tuple[str, str, bool]] = {
        p: (m, s, old) for p, m, s, old in conn.execute(
            "select phrase, model, source, updated_at < now() - make_interval(days => %s) "
            "from search.query_vocab", (REQUEST_KEEP_DAYS,))
    }

    # Curated phrases, in priority order: a phrase found in several keeps the first source.
    curated: dict[str, str] = {}

    def add(texts: Iterable[str], source: str) -> None:
        for t in texts:
            p = unit_phrase(t)
            if p and p not in curated:
                curated[p] = source

    if requests_only:
        add(watchlist(), "watchlist")
        new_curated = [p for p in curated if p not in existing]
        # Requests count against the cap, after the curated phrases.
        room = max(cap - len(existing) - len(new_curated), 0)
        new_requests = [p for p in picked if p not in existing][:room]
        selected = {p: 0 for p in [*new_curated, *new_requests]}
        # A request already in the vocabulary stays in search.vocab_requests: this mode leaves
        # existing rows alone, and the next full build marks it 'request' and removes it.
        request_phrases = new_requests
    else:
        add((r[0] for r in conn.execute("select name_fr from public.categories order by sort_order, slug")),
            "category")
        add((r[0] for r in conn.execute("select label_fr from public.tags order by slug")), "tag")
        add(_keywords(), "keyword")
        add(watchlist(), "watchlist")
        earlier = [p for p, (_, s, _) in existing.items() if s == "request"]
        counts = count_document_phrases(_documents(conn), min_df_unigram=min_df_unigram,
                                        min_df_multi=min_df_multi, top=cap,
                                        keep=[*curated, *earlier, *picked])
        log.info("vocab: %d phrases counted above the thresholds", len(counts))
        # Requests promoted earlier are kept and re-embedded on a model change, unless no
        # association text contains them and they are older than REQUEST_KEEP_DAYS.
        kept = [p for p in sorted(earlier)
                if p in curated or counts.get(p, 0) > 0 or not existing[p][2]]
        request_phrases = [*kept, *(p for p in picked if p not in kept)]
        selected = select_phrases(counts, min_df_unigram=min_df_unigram, min_df_multi=min_df_multi,
                                  cap=cap, always=curated, then=request_phrases)
        del counts
    # A selected request is marked 'request' (and kept by later builds) even when it is also a
    # category, a keyword or an ngram.
    sources = {p: "request" for p in request_phrases if p in selected}
    for p, src in curated.items():
        sources.setdefault(p, src)
    promoted = [p for p in picked if p in sources and sources[p] == "request"]
    # Promoted requests leave search.vocab_requests, and so do invalid ones (never promotable);
    # requests over max_requests or the cap wait for a later run.
    requests_done = [*invalid, *(raw for p in promoted for raw in picked[p])]
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
            newly = [p for p in promoted if existing.get(p, (None, None))[1] != "request"]
            report.requests_added = conn.execute(
                "select count(*)::int from search.query_vocab where phrase = any(%s) and source = 'request'",
                (newly,)).fetchone()[0]
            if not requests_only:
                report.removed = conn.execute("""
                    delete from search.query_vocab v
                    where not exists (select 1 from vocab_build t where t.phrase = v.phrase)""").rowcount
            conn.execute("delete from search.vocab_requests where phrase = any(%s)", (requests_done,))
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
