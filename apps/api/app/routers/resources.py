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
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.data.seed_resources import SEED_RESOURCES
from app.domain import competency, curation_agent
from app.models import Resource
from app.services import freshness, resource_service

router = APIRouter(prefix="/api/resources", tags=["resources"])


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
