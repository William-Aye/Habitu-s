"""Nightly fingerprints of user-created activities and collectifs (`python -m importer embed-activities`).

New activities are found by keywords at once (generated tsvector); their meaning vector is computed
here the next morning. A row is (re-)embedded when its embedding_hash is missing or no longer matches
text_hash(embedding_text(title/name, description)).
"""
import logging

import psycopg

from importer.db import _vector
from importer.embed import Embedder, embedding_text, text_hash

log = logging.getLogger("importer")

# (table, text column that holds the title)
_TABLES = (("activities", "title"), ("collectifs", "name"))


def embed_pending_activities(conn: psycopg.Connection, embedder: Embedder, batch_size: int = 256) -> int:
    """Embed the activities and collectifs whose fingerprint is missing or stale; returns how many.

    Commits after each batch (a failure keeps what was done). A row edited while its batch is being
    embedded is stored with the old text's hash, so the next run embeds it again.
    """
    total = 0
    for table, title_col in _TABLES:
        total += _embed_table(conn, embedder, table, title_col, batch_size)
    return total


def _embed_table(conn, embedder: Embedder, table: str, title_col: str, batch_size: int) -> int:
    rows = conn.execute(
        f"select id, {title_col}, description, embedding_hash from public.{table} order by id"  # noqa: S608
    ).fetchall()
    pending = []
    for row_id, title, description, old_hash in rows:
        text = embedding_text(title, description)
        h = text_hash(text)
        if h != old_hash:
            pending.append((row_id, text, h))
    done = 0
    for i in range(0, len(pending), batch_size):
        batch = pending[i : i + batch_size]
        vectors = embedder.embed([text for _, text, _ in batch])
        with conn.cursor() as cur:
            for (row_id, _, h), vec in zip(batch, vectors, strict=True):
                cur.execute(
                    f"update public.{table} set embedding = %s::extensions.vector, embedding_hash = %s "  # noqa: S608
                    f"where id = %s",
                    (_vector(vec), h, row_id),
                )
                done += cur.rowcount
        conn.commit()
        log.info("%s embedded: %d", table, done)
    return done
