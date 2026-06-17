"""Regression tests for the deterministic decision engine.

These lock in the 'fully reproducible, LLM-not-in-the-loop' guarantee: identical
observations always yield identical gaps / ranking / next-steps.
"""

from app.domain import decision
from app.domain.decision import SkillObservation

ROLE = "ai_engineer_applied"


def _obs(**levels: int) -> dict[str, SkillObservation]:
    return {sid: SkillObservation(level=lvl, confidence=0.8) for sid, lvl in levels.items()}


def test_gap_is_zero_when_level_meets_requirement():
    gaps = {g.req.skill_id: g for g in decision.compute_gaps(ROLE, _obs(**{"llm.prompt": 4}))}
    assert gaps["llm.prompt"].gap == 0


def test_gap_positive_when_below_requirement():
    gaps = {g.req.skill_id: g for g in decision.compute_gaps(ROLE, _obs(**{"llm.prompt": 1}))}
    # llm.prompt requires L3
    assert gaps["llm.prompt"].gap == 2


def test_decision_is_reproducible():
    obs = _obs(**{"data.vector_search": 1, "llm.prompt": 1})
    a = decision.select_next_steps(ROLE, obs)
    b = decision.select_next_steps(ROLE, obs)
    assert [(s.skill_id, s.next_score) for s in a] == [(s.skill_id, s.next_score) for s in b]


def test_prerequisite_surfaces_before_dependent():
    # Saturate every requirement, then knock down only the data.embedding ->
    # data.vector_search chain. vector_search depends on embedding, so while the
    # prerequisite is unmet the dependent is penalised and ranks lower.
    obs = {
        r.skill_id: SkillObservation(level=4, confidence=1.0)
        for r in decision.competency.requirements_for_role(ROLE)
    }
    obs["data.embedding"] = SkillObservation(level=0, confidence=0.8)
    obs["data.vector_search"] = SkillObservation(level=0, confidence=0.8)

    steps = decision.select_next_steps(ROLE, obs)
    ids = [s.skill_id for s in steps]
    assert "data.embedding" in ids
    emb = next(s for s in steps if s.skill_id == "data.embedding")
    vec = next((s for s in steps if s.skill_id == "data.vector_search"), None)
    if vec is not None:
        assert emb.next_score >= vec.next_score
        assert "data.embedding" in vec.blocked_by


def test_readiness_between_0_and_100():
    r = decision.compute_readiness(ROLE, _obs(**{"llm.prompt": 2}))
    assert 0.0 <= r <= 100.0


def test_full_coverage_is_high_readiness():
    full = {r.skill_id: SkillObservation(level=4, confidence=1.0) for r in
            decision.competency.requirements_for_role(ROLE)}
    assert decision.compute_readiness(ROLE, full) == 100.0
