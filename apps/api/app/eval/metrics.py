"""Ranking metrics for the retrieval eval harness (pure, dependency-free)."""

from __future__ import annotations

import math


def hit_at_k(ranked_urls: list[str], relevant: set[str], k: int) -> float:
    """1.0 if any relevant item appears in the top-k, else 0.0."""
    return 1.0 if any(u in relevant for u in ranked_urls[:k]) else 0.0


def recall_at_k(ranked_urls: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 0.0
    found = sum(1 for u in ranked_urls[:k] if u in relevant)
    return found / len(relevant)


def dcg(gains: list[float]) -> float:
    return sum(g / math.log2(i + 2) for i, g in enumerate(gains))


def ndcg_at_k(ranked_urls: list[str], relevant: set[str], k: int) -> float:
    """Binary-gain NDCG@k. 1.0 means every relevant item ranked at the top."""
    if not relevant:
        return 0.0
    gains = [1.0 if u in relevant else 0.0 for u in ranked_urls[:k]]
    ideal = [1.0] * min(len(relevant), k)
    idcg = dcg(ideal)
    return dcg(gains) / idcg if idcg > 0 else 0.0
