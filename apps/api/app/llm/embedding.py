"""Embedding provider abstraction (Week 3 resource engine).

Same decision/expression-split philosophy as the LLM provider: this is behind an
interface so we can swap OpenAI / local models, and run a deterministic mock with
no API key. The mock is a *stable hash embedding* — identical text always yields
the identical unit vector — which keeps retrieval tests reproducible offline.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import struct
from abc import ABC, abstractmethod
from functools import lru_cache
from typing import Any

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


class BGEEmbedder(EmbeddingProvider):
    """Local multilingual BGE embeddings via sentence-transformers.

    BGE-M3 emits 1024-dimensional vectors. Zeno's existing pgvector column is
    1536-dimensional, so shorter vectors are zero-padded. Padding a normalized
    vector with zeros preserves its norm and cosine similarity exactly, while
    avoiding a destructive database type migration.

    The model is loaded lazily on the first embedding request so API startup
    remains quick. Configuration and dependency errors fail loudly: silently
    falling back to mock would mix incompatible vector spaces.
    """

    def __init__(self, model: Any | None = None) -> None:
        self._model = model
        self._model_name = settings.bge_model
        self._device = settings.bge_device
        self._batch_size = settings.bge_batch_size
        self._cache_dir = settings.bge_cache_dir
        self._dim = settings.embedding_dim

    @property
    def dim(self) -> int:
        return self._dim

    def _get_model(self) -> Any:
        if self._model is None:
            # Plain HTTPS is more reliable than the optional Xet transport on
            # restricted or high-latency networks, and works with anonymous Hub access.
            os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as exc:
                raise RuntimeError(
                    'BGE embedding requires: pip install -e ".[bge]"'
                ) from exc
            self._model = SentenceTransformer(
                self._model_name,
                device=self._device,
                cache_folder=self._cache_dir,
            )
        return self._model

    def _fit_dimension(self, vector: list[float]) -> list[float]:
        if len(vector) > self._dim:
            raise ValueError(
                f"BGE returned {len(vector)} dimensions, but EMBEDDING_DIM={self._dim}. "
                "Increase the database vector dimension; truncation would damage quality."
            )
        if len(vector) < self._dim:
            vector = vector + [0.0] * (self._dim - len(vector))
        return vector

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        encoded = self._get_model().encode(
            texts,
            batch_size=self._batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return [self._fit_dimension(list(row)) for row in encoded]


@lru_cache(maxsize=1)
def get_embedder() -> EmbeddingProvider:
    if settings.embedding_provider == "openai" and settings.openai_api_key:
        return OpenAIEmbedder()
    if settings.embedding_provider == "bge":
        return BGEEmbedder()
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
