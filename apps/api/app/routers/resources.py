"""Resource library ops endpoints (Week 3).

Exposes the curation agent + freshness verifier so the RAG library can be
bootstrapped and maintained over HTTP:

    POST /api/resources/seed          load the curated seed set
    POST /api/resources/curate/{sid}  run the curation agent for one skill
    POST /api/resources/verify        run the freshness verifier
    GET  /api/resources               list + freshness histogram
"""

from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AnyHttpUrl, BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.data.seed_resources import SEED_RESOURCES
from app.domain import competency, curation_agent
from app.models import Resource, ResourceCandidate, url_hash
from app.services import freshness, resource_service

router = APIRouter(prefix="/api/resources", tags=["resources"])


class ResourceRecommendationIn(BaseModel):
    skill_id: str
    url: AnyHttpUrl
    title: str = Field(default="", max_length=240)
    reason: str = Field(min_length=8, max_length=1200)


@router.post("/recommend")
def recommend_resource(
    payload: ResourceRecommendationIn, db: Session = Depends(get_db)
) -> dict:
    """Accept a community recommendation into the review queue.

    A submission never enters retrieval directly. Freshness checks, annotation,
    and approval still happen through the existing candidate curation flow.
    """
    if payload.skill_id not in competency.SKILLS_BY_ID:
        raise HTTPException(status_code=404, detail=f"unknown skill_id: {payload.skill_id}")
    normalized_url = str(payload.url).strip().rstrip("/")
    digest = url_hash(normalized_url)
    if db.scalar(select(Resource.id).where(Resource.url_hash == digest)):
        return {"status": "already_published"}
    existing = db.scalar(
        select(ResourceCandidate).where(ResourceCandidate.url_hash == digest)
    )
    if existing:
        return {"status": existing.status, "candidate_id": existing.id}
    candidate = ResourceCandidate(
        title=payload.title.strip(),
        url=normalized_url,
        url_hash=digest,
        source="community",
        status="pending",
        annotation={
            "skill_ids": [payload.skill_id],
            "community_reason": payload.reason.strip(),
            "submitted_via": "result_page",
        },
    )
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    return {"status": "pending", "candidate_id": candidate.id}


@router.post("/seed")
def seed_resources(db: Session = Depends(get_db)) -> dict:
    n = 0
    for item in SEED_RESOURCES:
        resource_service.upsert_resource(db, **item)
        n += 1
    return {"seeded": n}


@router.post("/curate/{skill_id}")
def curate_skill(skill_id: str, db: Session = Depends(get_db)) -> dict:
    skill = competency.SKILLS_BY_ID.get(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"unknown skill_id: {skill_id}")
    req = competency.requirement_by_skill(competency.ROLE_AI_ENGINEER_APPLIED).get(skill_id)
    target_level = req.min_level if req else 2
    run = curation_agent.curate(
        db, skill_id=skill_id, skill_name=skill.name, target_level=target_level
    )
    return {
        "skill_id": skill_id,
        "stored": run.stored,
        "deduped": run.deduped,
        "verified": run.verified,
        "steps": len(run.steps),
    }


@router.post("/verify")
def verify(limit: int = 100, db: Session = Depends(get_db)) -> dict:
    return freshness.verify_pending(db, limit=limit)


@router.get("")
def list_resources(db: Session = Depends(get_db)) -> dict:
    total = db.scalar(select(func.count()).select_from(Resource)) or 0
    statuses = db.scalars(select(Resource.freshness_status)).all()
    return {"total": total, "freshness": dict(Counter(statuses))}
