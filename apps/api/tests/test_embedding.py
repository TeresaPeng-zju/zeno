"""Tests for the embedding provider (determinism + unit norm)."""

import math

from app.llm.embedding import BGEEmbedder, MockEmbedder, cosine_similarity


def test_mock_embedding_is_deterministic():
    e = MockEmbedder(dim=64)
    assert e.embed_one("pgvector hnsw") == e.embed_one("pgvector hnsw")


def test_mock_embedding_is_unit_norm():
    e = MockEmbedder(dim=64)
    v = e.embed_one("retrieval augmented generation")
    assert math.isclose(math.sqrt(sum(x * x for x in v)), 1.0, rel_tol=1e-6)


def test_cosine_self_similarity_is_one():
    e = MockEmbedder(dim=64)
    v = e.embed_one("function calling tool use")
    assert math.isclose(cosine_similarity(v, v), 1.0, rel_tol=1e-6)


def test_shared_tokens_increase_similarity():
    e = MockEmbedder(dim=128)
    base = e.embed_one("vector search pgvector hnsw index")
    near = e.embed_one("vector search pgvector tutorial")
    far = e.embed_one("cooking pasta recipe italian")
    assert cosine_similarity(base, near) > cosine_similarity(base, far)


def test_dim_matches_config():
    assert len(MockEmbedder(dim=32).embed_one("x")) == 32


class _FakeBGEModel:
    def encode(self, texts, **kwargs):
        import numpy as np

        return np.array([[0.6, 0.8] for _ in texts])


def test_bge_embedding_pads_without_changing_cosine(monkeypatch):
    monkeypatch.setattr("app.llm.embedding.settings.embedding_dim", 4)
    embedder = BGEEmbedder(model=_FakeBGEModel())
    vectors = embedder.embed(["中文 query", "English resource"])

    assert vectors == [[0.6, 0.8, 0.0, 0.0], [0.6, 0.8, 0.0, 0.0]]
    assert cosine_similarity(vectors[0], vectors[1]) == 1.0
