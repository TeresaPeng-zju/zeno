"""Resource retrieval engine — vector recall + multi-signal rerank (Week 3).

Pipeline (per skill gap):
    1. Recall: top-K by embedding similarity (pgvector `<=>` on Postgres, or an
       in-memory cosine scan on SQLite/tests — see resource_service).
    2. Rerank: combine three signals into a final score
           final = w_rel * relevance      (semantic closeness to the gap)
                 + w_fresh * freshness     (verified & recent, not dead/stale)
                 + w_fit  * fit            (resource level matches target level)
    3. Truncate to `resources_per_step`.

Everything here is deterministic and pure, so rerank quality is unit-testable
without a database or network.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.config import settings

# Freshness status -> base score. The verifier maintains `freshness_status`.
_STATUS_BASE: dict[str, float] = {
    "fresh": 1.0,
    "unverified": 0.5,
    "stale": 0.3,
    "dead": 0.0,
}


@dataclass
class ScoredResource:
    id: str
    title: str
    url: str
    platform: str
    resource_type: str
    target_level: int
    freshness_status: str
    last_verified_at: datetime | None
    quality_score: float
    relevance: float  # 0-1 cosine similarity from recall
    ai_curated: bool = False
    freshness: float = 0.0
    fit: float = 0.0
    final: float = 0.0


def freshness_signal(
    status: str, last_verified_at: datetime | None, now: datetime | None = None
) -> float:
    """0-1. Dead links are zeroed; verified-recent links score highest. The
    score decays linearly to half once a verified link ages past the TTL."""
    base = _STATUS_BASE.get(status, 0.5)
    if base == 0.0:
        return 0.0
    if last_verified_at is None:
        return base
    now = now or datetime.now(timezone.utc)
    if last_verified_at.tzinfo is None:
        last_verified_at = last_verified_at.replace(tzinfo=timezone.utc)
    age_days = max(0.0, (now - last_verified_at).total_seconds() / 86400.0)
    ttl = float(settings.freshness_ttl_days)
    decay = 1.0 if age_days <= ttl else max(0.5, 1.0 - (age_days - ttl) / (2 * ttl))
    return base * decay


def fit_signal(resource_target_level: int, gap_target_level: int) -> float:
    """0-1. Closer the resource's intended level to the user's target, better.
    A 1-level mismatch keeps most of the score; 3+ levels off is heavily damped."""
    diff = abs(resource_target_level - gap_target_level)
    return max(0.0, 1.0 - 0.33 * diff)


def rerank(
    candidates: list[ScoredResource],
    *,
    gap_target_level: int,
    now: datetime | None = None,
    limit: int | None = None,
) -> list[ScoredResource]:
    """Apply the three-signal weighted score and return the top resources."""
    w_rel = settings.rerank_w_relevance
    w_fresh = settings.rerank_w_freshness
    w_fit = settings.rerank_w_fit

    for c in candidates:
        c.freshness = freshness_signal(c.freshness_status, c.last_verified_at, now)
        c.fit = fit_signal(c.target_level, gap_target_level)
        # Dead links are dropped regardless of relevance — never recommend them.
        if c.freshness_status == "dead":
            c.final = 0.0
            continue
        c.final = round(
            w_rel * c.relevance + w_fresh * c.freshness + w_fit * c.fit, 6
        )

    alive = [c for c in candidates if c.freshness_status != "dead"]
    alive.sort(key=lambda c: (c.final, c.quality_score), reverse=True)
    # Redirects can leave both an old seed URL and its canonical replacement.
    # Keep the strongest copy so users never see duplicate resource cards.
    unique: list[ScoredResource] = []
    seen_titles: set[str] = set()
    for candidate in alive:
        title_key = "".join(candidate.title.lower().split())
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)
        unique.append(candidate)
    limit = limit if limit is not None else settings.resources_per_step
    return unique[:limit]
