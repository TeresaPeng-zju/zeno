"""Tests for the curation agent.

The tool *backends* (search/fetch/summarize/check) are tested offline. The full
search -> store -> verify pipeline needs the resources table, so it runs only
when DATABASE_URL points at Postgres (pgvector/JSONB), and is skipped otherwise.
"""

import pytest

from app.core.config import settings
from app.domain import curation_agent
from app.domain.curation_agent import (
    SeedSearcher,
    StaticFetcher,
    TruncateSummarizer,
    _UrlPatternChecker,
)


def test_seed_searcher_ranks_by_overlap():
    hits = SeedSearcher().search("pgvector hnsw 向量检索", k=3)
    assert hits
    assert any("pgvector" in h["url"] for h in hits)


def test_static_fetcher_flags_broken_url():
    assert StaticFetcher().fetch("https://example.com/deprecated/vector-search-404")["status"] == 404
    assert StaticFetcher().fetch("https://github.com/pgvector/pgvector")["status"] == 200


def test_truncate_summarizer_bounds_length():
    s = TruncateSummarizer().summarize("title", "x" * 500)
    assert len(s) <= 160


def test_url_pattern_checker():
    assert _UrlPatternChecker().check("https://x/ok")[0] == 200
    assert _UrlPatternChecker().check("https://x/deprecated")[0] == 404


def _postgres_available() -> bool:
    """True only if Postgres is reachable AND the `vector` extension can be
    installed. The pipeline test calls `init_db()` -> `CREATE EXTENSION vector`,
    so a server without pgvector would error rather than skip — check for it up
    front via `pg_available_extensions`."""
    if not settings.database_url.startswith("postgresql"):
        return False
    try:
        from sqlalchemy import text

        from app.core.db import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            has_vector = conn.execute(
                text(
                    "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'"
                )
            ).first()
        return has_vector is not None
    except Exception:
        return False


pg_only = pytest.mark.skipif(
    not _postgres_available(),
    reason="Postgres+pgvector not available — pipeline test runs once the DB is up",
)


@pg_only
def test_agent_pipeline_is_idempotent():
    from app.core.db import SessionLocal, init_db

    init_db()
    db = SessionLocal()
    try:
        first = curation_agent.run(
            db, skill_id="data.vector_search", skill_name="向量检索", target_level=3
        )
        second = curation_agent.run(
            db, skill_id="data.vector_search", skill_name="向量检索", target_level=3
        )
        assert first.stored >= 1
        # Re-running stores nothing new — deduped on url_hash.
        assert second.stored == 0
        assert second.deduped >= 1
        assert first.verified >= 1
    finally:
        db.close()
