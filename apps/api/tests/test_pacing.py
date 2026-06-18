"""Regression tests for the time-budget pacing (expression-layer) lever.

These lock two guarantees that the result-page calibration relies on:
    1. pacing is a pure function of (steps, budget) — deterministic, no LLM;
    2. the "standard" budget reproduces today's depth (3 steps), so the
       offline eval baseline computed at the default never forks.
"""

from app.domain import decision, pacing
from app.domain.decision import SkillObservation

ROLE = "ai_engineer_applied"


def _obs(**levels: int) -> dict[str, SkillObservation]:
    return {sid: SkillObservation(level=lvl, confidence=0.8) for sid, lvl in levels.items()}


def test_resolve_unknown_and_none_fall_back_to_standard():
    assert pacing.resolve(None) == ("standard", 6, 3)
    assert pacing.resolve("nonsense") == ("standard", 6, 3)


def test_standard_budget_keeps_default_depth():
    # standard must equal the engine default so the eval baseline is unchanged.
    assert pacing.resolve("standard")[2] == decision.MAX_NEXT_STEPS


def test_budget_only_changes_depth_not_ordering():
    obs = _obs(**{"data.vector_search": 1, "llm.prompt": 1, "eval.offline": 0})
    light = decision.select_next_steps(ROLE, obs, max_steps=pacing.resolve("light")[2])
    intense = decision.select_next_steps(ROLE, obs, max_steps=pacing.resolve("intense")[2])
    # The shorter list is a strict prefix of the longer one: same ranking,
    # only the surfaced depth differs.
    assert [s.skill_id for s in light] == [s.skill_id for s in intense][: len(light)]


def test_pacing_is_reproducible():
    obs = _obs(**{"data.vector_search": 1, "llm.prompt": 1})
    steps = decision.select_next_steps(ROLE, obs, max_steps=3)
    a = pacing.build_plan(steps, "light")
    b = pacing.build_plan(steps, "light")
    assert a == b


def test_fewer_weekly_hours_means_longer_or_equal_weeks():
    obs = _obs(**{"data.vector_search": 1})
    steps = decision.select_next_steps(ROLE, obs, max_steps=3)
    light = pacing.build_plan(steps, "light")
    intense = pacing.build_plan(steps, "intense")
    # Per-step effort is fixed; fewer hours/week can only stretch each step.
    light_by = {p.skill_id: p.est_weeks for p in light.steps}
    intense_by = {p.skill_id: p.est_weeks for p in intense.steps}
    for sid, w in intense_by.items():
        assert light_by[sid] >= w
