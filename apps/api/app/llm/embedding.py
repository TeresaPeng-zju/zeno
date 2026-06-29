"""Embedding provider abstraction (Week 3 resource engine).

Same decision/expression-split philosophy as the LLM provider: this is behind an
interface so we can swap OpenAI / local models, and run a deterministic mock with
no API key. The mock is a *stable hash embedding* — identical text always yields
the identical unit vector — which keeps retrieval tests reproducible offline.
"""

from __future__ import annotations

import hashlib
import math
import re
import struct
from abc import ABC, abstractmethod
from functools import lru_cache

from app.core.config import settings


class EmbeddingProvider(ABC):
    @property
    @abstractmethod
    def dim(self) -> int:
        ...

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts into unit-norm vectors."""
        raise NotImplementedError

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]


def _normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0.0:
        return vec
    return [v / norm for v in vec]


class MockEmbedder(EmbeddingProvider):
    """Deterministic hash embedding — no network, no key, reproducible.

    We expand a SHA-256 keyed digest into `dim` floats. Semantically meaningless
    but stable, which is exactly what unit tests and local dev need. Tokens that
    overlap between texts nudge vectors closer, giving a crude but usable signal.
    """

    def __init__(self, dim: int | None = None) -> None:
        self._dim = dim or settings.embedding_dim

    @property
    def dim(self) -> int:
        return self._dim

    def _tokens(self, text: str) -> list[str]:
        # 英文/数字按词；中文按单字 + 相邻 bigram。
        # 中文整句无空格，原来的 split() 会让整段变成一个 token，导致不同文本几乎不重叠、
        # 召回失效。单字 + bigram 让「向量检索」这类共享子词的文本向量真正靠近。
        text = text.lower()
        words = re.findall(r"[a-z0-9]+", text)
        han = re.findall(r"[一-鿿]", text)
        bigrams = [han[i] + han[i + 1] for i in range(len(han) - 1)]
        toks = words + han + bigrams
        return toks or [text]

    def _vec(self, text: str) -> list[float]:
        # Feature hashing（签名哈希技巧）：每个 token 落到一个维度并带 ±1 符号。
        # O(tokens) 而非原来的 O(tokens×dim)，且共享 token 越多向量越接近。
        acc = [0.0] * self._dim
        for tok in self._tokens(text):
            digest = hashlib.sha256(tok.encode("utf-8")).digest()
            idx = struct.unpack(">I", digest[:4])[0] % self._dim
            sign = 1.0 if digest[4] & 1 else -1.0
            acc[idx] += sign
        return _normalize(acc)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]


class OpenAIEmbedder(EmbeddingProvider):
    """OpenAI embeddings. Falls back to the mock on any failure so the pipeline
    degrades gracefully instead of crashing."""

    def __init__(self) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=settings.openai_api_key)
        self._model = settings.embedding_model
        self._dim = settings.embedding_dim
        self._fallback = MockEmbedder(self._dim)

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            from app.utils.retry import with_retry

            resp = with_retry(
                lambda: self._client.embeddings.create(model=self._model, input=texts),
                max_retries=2,
                base_delay=1.0,
            )
            return [_normalize(list(d.embedding)) for d in resp.data]
        except Exception:
            return self._fallback.embed(texts)


@lru_cache(maxsize=1)
def get_embedder() -> EmbeddingProvider:
    if settings.embedding_provider == "openai" and settings.openai_api_key:
        return OpenAIEmbedder()
    return MockEmbedder()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity for the in-memory (SQLite/test) retrieval path. On
    Postgres we let pgvector compute distance with the HNSW index instead."""
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)
