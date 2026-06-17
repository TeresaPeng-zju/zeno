"""Tests for the RAG rerank engine (pure multi-signal scoring)."""

from datetime import datetime, timezone

from app.domain.resource_engine import (
    ScoredResource,
    fit_signal,
    freshness_signal,
    rerank,
)

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)


def _r(url: str, relevance: float, status: str = "fresh", target_level: int = 2) -> ScoredResource:
    return ScoredResource(
        id=url,
        title=url,
        url=url,
        platform="",
        resource_type="article",
        target_level=target_level,
        freshness_status=status,
        last_verified_at=NOW,
        quality_score=0.0,
        relevance=relevance,
    )


def test_dead_links_are_dropped():
    out = rerank([_r("dead", 0.99, status="dead"), _r("ok", 0.3)], gap_target_level=2)
    urls = [r.url for r in out]
    assert "dead" not in urls
    assert "ok" in urls


def test_freshness_signal_dead_is_zero():
    assert freshness_signal("dead", NOW, now=NOW) == 0.0


def test_freshness_fresh_recent_is_high():
    assert freshness_signal("fresh", NOW, now=NOW) == 1.0


def test_fit_signal_best_when_levels_match():
    assert fit_signal(2, 2) == 1.0
    assert fit_signal(2, 3) < 1.0
    assert fit_signal(0, 4) < fit_signal(3, 4)


def test_relevance_dominates_ordering():
    out = rerank([_r("low", 0.2), _r("high", 0.9)], gap_target_level=2)
    assert out[0].url == "high"


def test_fresh_beats_stale_at_equal_relevance():
    out = rerank(
        [_r("stale", 0.5, status="stale"), _r("fresh", 0.5, status="fresh")],
        gap_target_level=2,
    )
    assert out[0].url == "fresh"
