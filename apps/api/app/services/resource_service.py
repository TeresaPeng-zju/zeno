"""Resource service: persistence glue for the RAG resource engine.

- `upsert_resource`  : idempotent insert/update keyed on `url_hash`, embeds on write.
- `recommend_for_skill` : vector recall + rerank for one skill gap.
- `recommend_out`    : adapt the top resources to the API `ResourceOut` schema.

Recall has two interchangeable paths so the engine runs with or without Postgres:
    * Postgres  -> pgvector cosine distance (uses the HNSW index).
    * otherwise -> load + in-memory cosine (SQLite / unit tests).
"""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import competency
from app.domain.resource_engine import ScoredResource, rerank
from app.i18n import t
from app.llm.embedding import cosine_similarity, get_embedder
from app.models import Resource, ResourceSkill, url_hash as compute_url_hash
from app.schemas import ResourceOut

_IS_PG = settings.database_url.startswith("postgresql")


def build_embed_text(title: str, summary: str | None, skill_ids: list[str]) -> str:
    """Canonical text we embed for a resource (title + summary + skills)."""
    parts = [title.strip()]
    if summary:
        parts.append(summary.strip())
    if skill_ids:
        parts.append(" ".join(skill_ids))
    return "\n".join(parts)


def _validate_skill_ids(skill_ids: list[str]) -> None:
    """Application-layer substitute for a skills FK: reject any skill_id absent
    from the skill graph (the catalog lives in skill_graph.json, not the DB)."""
    unknown = [s for s in skill_ids if s not in competency.SKILLS_BY_ID]
    if unknown:
        raise ValueError(f"unknown skill_id(s) not in skill graph: {unknown}")


def _sync_resource_skills(
    db: Session,
    resource: Resource,
    skill_ids: list[str],
    target_level: int,
    target_levels: dict[str, int] | None,
) -> None:
    """Replace a resource's skill mappings. `target_levels` may override the
    per-skill level (one resource can be L1 for one skill, L3 for another);
    skills not listed there fall back to the shared `target_level`."""
    db.flush()  # ensure resource.id is assigned for new rows
    db.execute(delete(ResourceSkill).where(ResourceSkill.resource_id == resource.id))
    overrides = target_levels or {}
    for sid in skill_ids:
        db.add(
            ResourceSkill(
                resource_id=resource.id,
                skill_id=sid,
                target_level=overrides.get(sid, target_level),
            )
        )


def upsert_resource(
    db: Session,
    *,
    title: str,
    url: str,
    skill_ids: list[str],
    platform: str = "",
    resource_type: str = "article",
    target_level: int = 1,
    summary: str | None = None,
    quality_score: float = 0.0,
    embed: bool = True,
    target_levels: dict[str, int] | None = None,
) -> Resource:
    """Insert or update a resource, deduped on the normalized url hash.

    Skills are stored in the `resource_skills` association table. Pass
    `target_levels` to set a different level per skill; otherwise every skill
    gets the shared `target_level`. Signature is otherwise unchanged, so seed
    loading and the curation agent need no edits.
    """
    _validate_skill_ids(skill_ids)
    uh = compute_url_hash(url)
    existing = db.scalar(select(Resource).where(Resource.url_hash == uh))

    embedding = None
    if embed:
        text = build_embed_text(title, summary, skill_ids)
        embedding = get_embedder().embed_one(text)

    if existing is None:
        res = Resource(
            title=title,
            url=url,
            url_hash=uh,
            platform=platform,
            resource_type=resource_type,
            summary=summary,
            quality_score=quality_score,
            embedding=embedding,
        )
        db.add(res)
    else:
        existing.title = title
        existing.platform = platform
        existing.resource_type = resource_type
        existing.summary = summary
        existing.quality_score = quality_score
        if embedding is not None:
            existing.embedding = embedding
        res = existing

    _sync_resource_skills(db, res, skill_ids, target_level, target_levels)
    db.commit()
    db.refresh(res)
    return res


def _to_scored(r: Resource, target_level: int, relevance: float) -> ScoredResource:
    return ScoredResource(
        id=r.id,
        title=r.title,
        url=r.url,
        platform=r.platform,
        resource_type=r.resource_type,
        target_level=target_level,
        freshness_status=r.freshness_status,
        last_verified_at=r.last_verified_at,
        quality_score=r.quality_score,
        relevance=relevance,
    )


def _recall(db: Session, skill_id: str, query_vec: list[float]) -> list[ScoredResource]:
    top_k = settings.retrieval_top_k
    if _IS_PG:
        # pgvector cosine distance (0..2); relevance = 1 - distance, clamped 0..1.
        # JOIN the association table so we filter by skill via an index, not a
        # full scan, and read this resource's per-skill target_level.
        dist = Resource.embedding.cosine_distance(query_vec)
        rows = db.execute(
            select(Resource, ResourceSkill.target_level, dist.label("distance"))
            .join(ResourceSkill, ResourceSkill.resource_id == Resource.id)
            .where(ResourceSkill.skill_id == skill_id)
            .where(Resource.is_active.is_(True))
            .where(Resource.embedding.isnot(None))
            .order_by(dist)
            .limit(top_k)
        ).all()
        return [_to_scored(r, tl, max(0.0, 1.0 - float(d))) for r, tl, d in rows]

    # In-memory cosine fallback (SQLite / tests).
    rows = db.execute(
        select(Resource, ResourceSkill.target_level)
        .join(ResourceSkill, ResourceSkill.resource_id == Resource.id)
        .where(ResourceSkill.skill_id == skill_id)
    ).all()
    scored: list[ScoredResource] = []
    for r, tl in rows:
        if not r.is_active or not r.embedding:
            continue
        scored.append(_to_scored(r, tl, cosine_similarity(query_vec, list(r.embedding))))
    scored.sort(key=lambda s: s.relevance, reverse=True)
    return scored[:top_k]


def recommend_for_skill(
    db: Session, *, skill_id: str, gap_target_level: int, query_text: str
) -> list[ScoredResource]:
    """Full per-skill pipeline: embed query -> recall -> multi-signal rerank."""
    query_vec = get_embedder().embed_one(query_text)
    candidates = _recall(db, skill_id, query_vec)
    return rerank(candidates, gap_target_level=gap_target_level)


def _freshness_reason(s: ScoredResource, lang: str = "en") -> str:
    when = (
        s.last_verified_at.date().isoformat()
        if s.last_verified_at
        else t(lang, "freshness.not_verified")
    )
    key = {
        "fresh": "freshness.fresh",
        "stale": "freshness.stale",
        "unverified": "freshness.unverified",
        "dead": "freshness.dead",
    }.get(s.freshness_status)
    label = t(lang, key) if key else s.freshness_status
    return t(lang, "freshness.format", label=label, when=when)


def recommend_out(
    db: Session, *, skill_id: str, gap_target_level: int, query_text: str, lang: str = "en"
) -> list[ResourceOut]:
    """Adapt the reranked resources to the API schema for `next_steps`."""
    top = recommend_for_skill(
        db, skill_id=skill_id, gap_target_level=gap_target_level, query_text=query_text
    )
    return [
        ResourceOut(
            title=s.title,
            url=s.url,
            platform=s.platform,
            last_verified_at=s.last_verified_at.isoformat() if s.last_verified_at else None,
            freshness_reason=_freshness_reason(s, lang),
        )
        for s in top
    ]
