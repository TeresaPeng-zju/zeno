"""Questionnaire orchestrator (deterministic).

Goal: with the fewest questions, raise the confidence of *required* skills to a
decision-ready level.

Next-question scoring (plan 5.2):
    ask_priority = role_weight * (1 - confidence) * branch_factor

`branch_factor` is derived from branch_impact (0/1). We use a floor so that a
non-branching skill is not permanently starved:
    branch_factor = BRANCH_FLOOR + (1 - BRANCH_FLOOR) * branch_impact

Termination (plan 5.2):
    - answered count >= MAX_QUESTIONS, OR
    - weighted uncertainty of required skills < UNCERTAINTY_THRESHOLD, OR
    - no unanswered required/bonus skills remain.
"""

from dataclasses import dataclass

from app.core.config import settings
from app.domain.competency import RoleRequirement, requirements_for_role

BRANCH_FLOOR = 0.5


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
    role_id: str, states: dict[str, SkillState]
) -> str | None:
    """Pick the unanswered requirement skill with the highest ask_priority."""
    best_skill: str | None = None
    best_score = -1.0
    for req in requirements_for_role(role_id):
        if req.skill_id in states:  # already answered
            continue
        score = ask_priority(req, confidence=0.0)
        if score > best_score:
            best_score = score
            best_skill = req.skill_id
    return best_skill


def weighted_uncertainty(role_id: str, states: dict[str, SkillState]) -> float:
    """Weighted remaining uncertainty across *required* skills (0-1)."""
    reqs = [r for r in requirements_for_role(role_id) if r.type == "required"]
    total_weight = sum(r.weight for r in reqs)
    if total_weight == 0:
        return 0.0
    acc = 0.0
    for r in reqs:
        conf = states[r.skill_id].confidence if r.skill_id in states else 0.0
        acc += r.weight * (1.0 - conf)
    return acc / total_weight


def is_complete(role_id: str, states: dict[str, SkillState]) -> bool:
    answered = len(states)
    if answered >= settings.max_questions:
        return True
    if select_next_skill(role_id, states) is None:
        return True
    # Only allow early-stop on uncertainty once we have a minimum signal,
    # so we don't terminate immediately on an empty session.
    if answered >= 1 and weighted_uncertainty(role_id, states) < settings.uncertainty_threshold:
        return True
    return False
