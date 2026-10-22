"""Document embeddings (multilingual-e5-small, 384 dims, "passage: " prefix)."""
import hashlib
import re
import struct
from typing import Protocol

DIM = 384
_SPACES = re.compile(r"\s+")
_MAX_CHARS = 1000


class Embedder(Protocol):
    dim: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class E5Embedder:
    def __init__(self, model_name: str = "intfloat/multilingual-e5-small", batch_size: int = 128):
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model_name)
        self.batch_size = batch_size
        self.dim = DIM

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors = self.model.encode(
            ["passage: " + t for t in texts],
            batch_size=self.batch_size,
            normalize_embeddings=True,
        )
        return [[float(x) for x in v] for v in vectors]


class FakeEmbedder:
    """Deterministic unit vectors derived from sha256(text); for tests."""

    dim = DIM

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

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
