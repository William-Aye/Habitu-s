"""Document embeddings (multilingual-e5-small, 384 dims, "passage: " prefix)."""
import hashlib
import re
import struct
import unicodedata
from collections.abc import Sequence
from typing import Protocol

DIM = 384
_SPACES = re.compile(r"\s+")
_MAX_CHARS = 1000
_MAX_QUERY_CHARS = 200
# Explicit whitespace class, identical to supabase/functions/embed-query/normalise.ts.
_QUERY_WS = re.compile("[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+")


def normalise_query(text: str) -> str:
    """NFC, trim, collapse whitespace, lower-case, cut to 200 code points (same rule as the edge function)."""
    collapsed = _QUERY_WS.sub(" ", unicodedata.normalize("NFC", text)).strip(" ")
    return collapsed.lower()[:_MAX_QUERY_CHARS]


class Embedder(Protocol):
    dim: int

    def embed(self, texts: list[str]) -> Sequence[Sequence[float]]: ...


class E5Embedder:
    def __init__(self, model_name: str = "intfloat/multilingual-e5-small", batch_size: int = 128):
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model_name)
        self.batch_size = batch_size
        self.dim = DIM

    def embed(self, texts: list[str]):
        """float32 array of shape (len(texts), 384); rows are formatted straight into COPY."""
        return self.model.encode(
            ["passage: " + t for t in texts],
            batch_size=self.batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype("float32", copy=False)


    def embed_queries(self, texts: list[str]):
        return self.model.encode(
            ["query: " + normalise_query(t) for t in texts],
            batch_size=self.batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype("float32", copy=False)


class FakeEmbedder:
    """Deterministic unit vectors derived from sha256(text); for tests."""

    dim = DIM

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def embed_queries(self, texts: list[str]) -> list[list[float]]:
        return self.embed(["query: " + t for t in texts])

    def _one(self, text: str) -> list[float]:
        raw = b""
        counter = 0
        while len(raw) < DIM * 4:
            raw += hashlib.sha256(f"{counter}\n{text}".encode("utf-8")).digest()
            counter += 1
        ints = struct.unpack(f"<{DIM}I", raw[: DIM * 4])
        vec = [i / 2**32 - 0.5 for i in ints]
        norm = sum(x * x for x in vec) ** 0.5
        return [x / norm for x in vec]


def embedding_text(name: str, purpose: str | None) -> str:
    parts = (_SPACES.sub(" ", name or "").strip(), _SPACES.sub(" ", purpose or "").strip())
    return (parts[0] + "\n" + parts[1]).strip()[:_MAX_CHARS]


def text_hash(text: str) -> str:
    return hashlib.sha256(("e5-small-v1\n" + text).encode("utf-8")).hexdigest()
