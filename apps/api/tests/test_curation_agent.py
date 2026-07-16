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
from app.domain.resource_harness import _ReadableHTML, stage_url, validate_annotation


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


def test_readable_html_drops_script_and_keeps_title():
    parser = _ReadableHTML()
    parser.feed("<html><title>Useful guide</title><script>noise()</script><main>Learn RAG safely</main></html>")
    assert parser.title == "Useful guide"
    assert "Learn RAG safely" in parser.parts
    assert "noise" not in " ".join(parser.parts)


def test_annotation_is_bounded_and_uses_catalog_ids():
    value = validate_annotation({
        "skill_ids": ["data.embedding", "data.embedding"],
        "target_levels": {"data.embedding": 9},
        "resource_type": "unknown",
        "summary": "BGE model selection",
        "quality_score": 1.5,
        "confidence": -1,
    })
    assert value["skill_ids"] == ["data.embedding"]
    assert value["target_levels"] == {"data.embedding": 4}
    assert value["resource_type"] == "article"
    assert value["quality_score"] == 1.0
    assert value["confidence"] == 0.0


def test_annotation_rejects_unknown_skill():
    with pytest.raises(ValueError, match="unknown skill"):
        validate_annotation({"skill_ids": ["invented.skill"]})


def test_stage_url_keeps_model_output_in_review_queue(tmp_path):
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session

    from app.core.db import Base
    from app.models import Resource, ResourceCandidate

    class Fetcher:
        def fetch(self, url):
            return {"url": url, "status": 200, "title": "BGE guide", "text": "Choose and evaluate embeddings."}

    class Annotator:
        model_name = "fake-deepseek"

        def annotate(self, **kwargs):
            return validate_annotation({
                "skill_ids": ["data.embedding"],
                "target_levels": {"data.embedding": 2},
                "summary": "Embedding model selection",
                "quality_score": 0.8,
                "confidence": 0.85,
            })

    engine = create_engine(f"sqlite:///{tmp_path / 'curation.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        candidate = stage_url(
            db,
            url="https://example.com/bge",
            source="test",
            fetcher=Fetcher(),
            annotator=Annotator(),
        )
        assert candidate.status == "pending"
        assert candidate.annotation["skill_ids"] == ["data.embedding"]
        assert db.scalar(select(ResourceCandidate)) is not None
        assert db.scalar(select(Resource)) is None


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
    from sqlalchemy import select

    from app.core.db import SessionLocal, init_db
    from app.models import Resource, ResourceSkill

    init_db()
    db = SessionLocal()
    try:
        # Self-contained slate: the `resources` table persists across test
        # sessions on Postgres, so a prior run would leave this skill's resources
        # behind and make even the *first* run dedup (stored == 0). Drop them up
        # front so the "first stores, second dedups" invariant holds regardless
        # of prior DB state. Deleting the Resource cascades to resource_skills.
        stale_ids = db.scalars(
            select(ResourceSkill.resource_id).where(
                ResourceSkill.skill_id == "data.vector_search"
            )
        ).all()
        if stale_ids:
            for res in db.scalars(select(Resource).where(Resource.id.in_(stale_ids))):
                db.delete(res)
            db.commit()

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
