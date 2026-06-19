"""Audit / explainability endpoints (demo of the deterministic moat).

These expose, over HTTP, what a black-box model cannot give a high-trust
career product: a per-step evidence chain ("why is this ranked here") and a
causally-attributed plan diff ("why is this different from last time"). Both
are DB-free — feed a profile, get the chain — so they double as a live demo.
"""

from fastapi import APIRouter

from app.domain import competency, explain
from app.domain.decision import SkillObservation
from app.schemas import ExplainRequest, PlanDiffRequest, SkillObservationIn

router = APIRouter(prefix="/api/explain", tags=["explain"])


def _to_obs(items: list[SkillObservationIn]) -> dict[str, SkillObservation]:
    return {
        i.skill_id: SkillObservation(level=i.level, confidence=i.confidence) for i in items
    }


@router.post("")
def explain_plan(payload: ExplainRequest) -> dict:
    """Full auditable evidence chain for a plan."""
    return explain.explain_plan(
        competency.ROLE_AI_ENGINEER_APPLIED,
        _to_obs(payload.observations),
        orientation_id=payload.orientation or competency.ORIENTATION_BASE,
        max_steps=payload.max_steps,
    )


@router.post("/diff")
def diff_plans(payload: PlanDiffRequest) -> dict:
    """Causally-attributed diff between two plans (why this != last time)."""
    return explain.diff_plans(
        competency.ROLE_AI_ENGINEER_APPLIED,
        _to_obs(payload.observations_before),
        _to_obs(payload.observations_after),
        orientation_id=payload.orientation or competency.ORIENTATION_BASE,
        max_steps=payload.max_steps,
    )
