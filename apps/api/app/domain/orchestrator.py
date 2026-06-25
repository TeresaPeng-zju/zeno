"""Questionnaire orchestrator (deterministic).

Selects the next skill to assess and determines when the session has
enough signal to produce a reliable result. Parameters are env-injectable.
"""

from dataclasses import dataclass

from app.core.config import settings
from app.domain.competency import (
    ORIENTATION_BASE,
    RoleRequirement,
    requirements_for_role,
)

from app.core.config import settings

BRANCH_FLOOR = getattr(settings, "orchestrator_branch_floor", 0.4)


@dataclass(frozen=True)
class SkillState:
    """Current known state for a skill within a session."""

    level: int
    confidence: float


def _branch_factor(branch_impact: int) -> float:
    return BRANCH_FLOOR + (1.0 - BRANCH_FLOOR) * float(branch_impact)


def ask_priority(req: RoleRequirement, confidence: float) -> float:
    return req.weight * (1.0 - confidence) * _branch_factor(req.branch_impact)


def select_next_skill(
    role_id: str, states: dict[str, SkillState], orientation_id: str = ORIENTATION_BASE
) -> str | None:
    """Pick the unanswered requirement skill with the highest ask_priority."""
    best_skill: str | None = None
    best_score = -1.0
    for req in requirements_for_role(role_id, orientation_id):
        if req.skill_id in states:  # already answered
            continue
        score = ask_priority(req, confidence=0.0)
        if score > best_score:
            best_score = score
            best_skill = req.skill_id
    return best_skill


def weighted_uncertainty(
    role_id: str, states: dict[str, SkillState], orientation_id: str = ORIENTATION_BASE
) -> float:
    """Weighted remaining uncertainty across *required* skills (0-1)."""
    reqs = [r for r in requirements_for_role(role_id, orientation_id) if r.type == "required"]
    total_weight = sum(r.weight for r in reqs)
    if total_weight == 0:
        return 0.0
    acc = 0.0
    for r in reqs:
        conf = states[r.skill_id].confidence if r.skill_id in states else 0.0
        acc += r.weight * (1.0 - conf)
    return acc / total_weight


def is_complete(
    role_id: str, states: dict[str, SkillState], orientation_id: str = ORIENTATION_BASE
) -> bool:
    answered = len(states)
    if answered >= settings.max_questions:
        return True
    if select_next_skill(role_id, states, orientation_id) is None:
        return True
    # Only allow early-stop on uncertainty once we have a minimum signal,
    # so we don't terminate immediately on an empty session.
    if (
        answered >= 1
        and weighted_uncertainty(role_id, states, orientation_id) < settings.uncertainty_threshold
    ):
        return True
    return False
