import hashlib
import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.core.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def url_hash(url: str) -> str:
    """Idempotency key for a resource. The curation agent dedups on this so the
    same source is never embedded/stored twice across runs."""
    return hashlib.sha256(url.strip().rstrip("/").encode("utf-8")).hexdigest()


class SurveySession(Base):
    """A questionnaire session. MVP uses session in place of a user account."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    role_id: Mapped[str] = mapped_column(String, default="ai_engineer_applied")
    # target_orientation: sub-specialization modifier over the base role
    # requirements ("base" | "rag" | ...). server_default keeps create_all-only
    # schemas (no migration) backward-compatible; the service treats NULL as base.
    orientation: Mapped[str] = mapped_column(String, default="base", server_default="base")
    status: Mapped[str] = mapped_column(String, default="in_progress")  # in_progress | completed
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Audit/analytics: updated on every write; completed_at set when status flips
    # to "completed". Useful for funnel analysis once live.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user_skills: Mapped[list["UserSkill"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class UserSkill(Base):
    """Observed/claimed skill level for a session, with a confidence signal."""

    __tablename__ = "user_skills"
    __table_args__ = (
        UniqueConstraint("session_id", "skill_id", name="uq_session_skill"),
        CheckConstraint("level >= 0 AND level <= 4", name="ck_user_skill_level"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    skill_id: Mapped[str] = mapped_column(String, index=True)
    level: Mapped[int] = mapped_column(Integer, default=0)
    evidence_type: Mapped[str] = mapped_column(String, default="self_claim")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    session: Mapped["SurveySession"] = relationship(back_populates="user_skills")


class Resource(Base):
    """Learning resource for the prescription/roadmap (Week 3 resource engine).

    A single resource can serve several skills, each at its own target level —
    that mapping lives in `ResourceSkill` (replaces the former `skill_ids` JSONB
    array). `embedding` powers pgvector similarity search; the freshness block
    (`last_verified_at`, `freshness_status`, `http_status`) is maintained by the
    periodic verifier so we never recommend dead or stale links — Zeno's moat.
    """

    __tablename__ = "resources"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    # Idempotency key (sha256 of normalized url) — dedup target for the agent.
    url_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    platform: Mapped[str] = mapped_column(String, default="")  # e.g. YouTube, 官方文档
    resource_type: Mapped[str] = mapped_column(
        String, default="article"
    )  # article | video | course | doc | repo

    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # pgvector Vector on Postgres (HNSW search); stored as JSON list on SQLite,
    # where retrieval falls back to in-memory cosine (see resource_service).
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(settings.embedding_dim).with_variant(JSON(), "sqlite"), nullable=True
    )
    quality_score: Mapped[float] = mapped_column(Float, default=0.0)  # rerank signal
    # Soft-delete / unpublish: keep the row (and its freshness history) but exclude
    # it from recommendations. We never hard-delete a resource.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )

    # --- Freshness block (maintained by the periodic verifier) ---
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    freshness_status: Mapped[str] = mapped_column(
        String, default="unverified"
    )  # unverified | fresh | stale | dead
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    verify_note: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Per-skill mapping (replaces the old skill_ids JSONB array). Loaded eagerly
    # so callers can read levels without an extra round-trip.
    skills: Mapped[list["ResourceSkill"]] = relationship(
        back_populates="resource",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        CheckConstraint(
            "freshness_status IN ('unverified', 'fresh', 'stale', 'dead')",
            name="ck_resource_freshness_status",
        ),
        # HNSW index for fast approximate nearest-neighbour cosine search (pgvector).
        # Built only on Postgres; ignored by other dialects.
        Index(
            "ix_resources_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


class ResourceSkill(Base):
    """Association: which skills a resource serves, and the target level for each.

    Replaces the former `Resource.skill_ids` JSONB array + single `target_level`.
    The composite PK (resource_id, skill_id) keeps each pairing unique, and the
    per-row `target_level` lets one resource be L1 for one skill and L3 for
    another. `skill_id` is validated against the skill graph at the service layer
    (the catalog lives in skill_graph.json, not the DB — by design), so there is
    deliberately no FK to a skills table.
    """

    __tablename__ = "resource_skills"
    __table_args__ = (
        CheckConstraint(
            "target_level >= 0 AND target_level <= 4", name="ck_resource_skill_level"
        ),
        Index("ix_resource_skills_skill_id", "skill_id"),
    )

    resource_id: Mapped[str] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True
    )
    skill_id: Mapped[str] = mapped_column(String, primary_key=True)
    target_level: Mapped[int] = mapped_column(Integer, default=1)  # suited L0-4 tier

    resource: Mapped["Resource"] = relationship(back_populates="skills")
