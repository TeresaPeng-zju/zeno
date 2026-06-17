"""Link freshness verifier — Zeno's product moat (Week 3).

Periodically checks each resource's URL so we never recommend dead or stale
links. The HTTP probe is injectable (`UrlChecker`) so tests run without network
and a real deployment uses httpx. Status mapping:

    2xx / 3xx           -> fresh
    404 / 410           -> dead   (gone)
    other 4xx / 5xx     -> stale  (transient/blocked, keep but down-rank)
    network error       -> dead
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Resource


class UrlChecker(Protocol):
    def check(self, url: str) -> tuple[int | None, str | None]:
        """Return (http_status, error_note). status=None means a network error."""
        ...


class HttpxChecker:
    """Default checker. Lazy-imports httpx so it stays an optional dependency."""

    def __init__(self, timeout: float = 8.0) -> None:
        self._timeout = timeout

    def check(self, url: str) -> tuple[int | None, str | None]:
        import httpx

        try:
            with httpx.Client(timeout=self._timeout, follow_redirects=True) as client:
                resp = client.head(url)
                # Some servers reject HEAD — retry with a ranged GET.
                if resp.status_code in (403, 405):
                    resp = client.get(url, headers={"Range": "bytes=0-0"})
                return resp.status_code, None
        except Exception as exc:  # noqa: BLE001
            return None, str(exc)[:200]


def classify(status: int | None) -> str:
    if status is None:
        return "dead"
    if 200 <= status < 400:
        return "fresh"
    if status in (404, 410):
        return "dead"
    return "stale"


def verify_resource(db: Session, resource: Resource, checker: UrlChecker) -> Resource:
    status, note = checker.check(resource.url)
    resource.http_status = status
    resource.freshness_status = classify(status)
    resource.verify_note = note
    resource.last_verified_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(resource)
    return resource


def verify_pending(
    db: Session, checker: UrlChecker | None = None, limit: int = 100
) -> dict[str, int]:
    """Verify resources that were never verified or are not yet 'fresh'.

    Returns a status histogram, handy for the eval/monitoring dashboard.
    """
    checker = checker or HttpxChecker()
    rows = db.scalars(
        select(Resource)
        .where(or_(Resource.last_verified_at.is_(None), Resource.freshness_status != "fresh"))
        .limit(limit)
    ).all()
    hist: dict[str, int] = {"fresh": 0, "stale": 0, "dead": 0}
    for r in rows:
        verify_resource(db, r, checker)
        hist[r.freshness_status] = hist.get(r.freshness_status, 0) + 1
    return hist
