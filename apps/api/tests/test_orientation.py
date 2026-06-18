"""Regression tests for target orientations (modifiers over base requirements).

These lock in two guarantees:
  1. `base` is the identity modifier — selecting nothing reproduces today's
     behaviour exactly, so the pipeline & eval baseline never fork silently.
  2. The `rag` modifier deterministically reweights / raises the bar on the
     data-retrieval skills and promotes data.quality to required, and that
     change flows through the decision + orchestrator pipeline.
"""

from app.domain import competency, decision
from app.domain.competency import requirements_for_role
from app.domain.decision import SkillObservation
from app.domain.orchestrator import select_next_skill

ROLE = competency.ROLE_AI_ENGINEER_APPLIED


def _by_skill(orientation: str) -> dict[str, competency.RoleRequirement]:
    return {r.skill_id: r for r in requirements_for_role(ROLE, orientation)}


# --------------------------------------------------------------------------- #
# base == identity (backward compatibility)
# --------------------------------------------------------------------------- #
def test_default_arg_equals_base():
    assert requirements_for_role(ROLE) == requirements_for_role(ROLE, "base")


def test_base_orientation_is_identity():
    raw = [r for r in competency.ROLE_REQUIREMENTS if r.role_id == ROLE]
    assert requirements_for_role(ROLE, "base") == raw


def test_unknown_orientation_falls_back_to_base():
    assert requirements_for_role(ROLE, "does-not-exist") == requirements_for_role(ROLE, "base")


# --------------------------------------------------------------------------- #
# rag modifier
# --------------------------------------------------------------------------- #
def test_rag_raises_weight_and_clamps_to_one():
    base, rag = _by_skill("base"), _by_skill("rag")
    assert rag["data.vector_search"].weight == 1.0  # 0.9 + 0.1, clamped at ceiling
    assert rag["data.retrieval_rerank"].weight > base["data.retrieval_rerank"].weight
    assert rag["data.chunking"].weight > base["data.chunking"].weight
    assert all(0.0 <= r.weight <= 1.0 for r in rag.values())


def test_rag_raises_min_level_and_clamps_to_four():
    base, rag = _by_skill("base"), _by_skill("rag")
    assert rag["data.vector_search"].min_level == 4  # 3 -> 4 (ceiling)
    assert rag["data.retrieval_rerank"].min_level == base["data.retrieval_rerank"].min_level + 1
    assert rag["data.chunking"].min_level == base["data.chunking"].min_level + 1
    assert all(0 <= r.min_level <= 4 for r in rag.values())


def test_rag_promotes_data_quality_to_required():
    assert _by_skill("base")["data.quality"].type == "bonus"
    assert _by_skill("rag")["data.quality"].type == "required"


def test_rag_leaves_unrelated_skills_untouched():
    base, rag = _by_skill("base"), _by_skill("rag")
    # A foundation skill not named in the rag modifier is byte-for-byte unchanged.
    assert rag["eng.typescript"] == base["eng.typescript"]
    assert rag["llm.prompt"] == base["llm.prompt"]


# --------------------------------------------------------------------------- #
# pipeline effect (decision + orchestrator)
# --------------------------------------------------------------------------- #
def test_rag_raises_bar_above_a_base_complete_profile():
    """A profile that exactly satisfies every *base*-required skill is no longer
    100% ready under rag, because rag raises target levels and adds data.quality."""
    obs = {
        r.skill_id: SkillObservation(level=r.min_level, confidence=1.0)
        for r in requirements_for_role(ROLE, "base")
        if r.type == "required"
    }
    assert decision.compute_readiness(ROLE, obs, "base") == 100.0
    assert decision.compute_readiness(ROLE, obs, "rag") < 100.0


def test_rag_top_question_is_core_retrieval():
    """With nothing answered, rag's reweighting surfaces the core retrieval skill
    as the highest-priority first question."""
    assert select_next_skill(ROLE, {}, "rag") == "data.vector_search"
