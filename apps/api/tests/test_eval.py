"""Tests for freshness classification + the eval harness thresholds."""

from app.eval.run_eval import evaluate
from app.services.freshness import classify


def test_classify_status_mapping():
    assert classify(200) == "fresh"
    assert classify(301) == "fresh"
    assert classify(404) == "dead"
    assert classify(410) == "dead"
    assert classify(500) == "stale"
    assert classify(None) == "dead"


def test_eval_reports_all_metrics():
    report = evaluate()
    assert report["N"] >= 8
    for key in ("ndcg@10", "hit@3", "recall@5"):
        assert 0.0 <= report[key] <= 1.0


def test_eval_quality_above_baseline():
    """Lock in retrieval quality so a rerank regression fails CI. Numbers are
    the offline mock-embedder baseline; refresh when the corpus/weights change."""
    report = evaluate()
    assert report["hit@3"] >= 0.75
    assert report["ndcg@10"] >= 0.6


def test_eval_rag_orientation_baseline():
    """Baseline for the RAG orientation surface (评测面). Mirrors the rag
    modifier's raised target levels; locks retrieval quality on the data/检索
    pipeline so a reweight or rerank regression on that orientation fails CI.
    Refresh when the corpus/weights change. Offline real = 1.0 across the board."""
    report = evaluate("rag")
    assert report["orientation"] == "rag"
    assert report["N"] == 5
    assert report["hit@3"] >= 0.8
    assert report["ndcg@10"] >= 0.8
    assert report["recall@5"] >= 0.6
