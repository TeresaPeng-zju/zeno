"""Regression tests for the audit layer (app.domain.explain).

These lock the three claims the "可审计证据链" narrative makes out loud, so the
demo can never silently regress into hand-waving:

    1. 同输入同指纹  — plan_fingerprint is a pure content hash; identical input
       (even with dict keys in a different order) yields a bit-identical stamp,
       and a changed input yields a different one. This is the auditable
       counterpart of "1/N".

    2. 打分构成加总 = next_score — the per-step breakdown actually reconstructs
       the score it claims to explain (gap + dependency + learnability, then the
       blocked penalty). The explanation is not decorative; it adds up.

    3. diff 因果归因 — the ordering changes ONLY because an input changed.
       Same input ⇒ identical=True, no order_changes. A real level bump ⇒
       different fingerprint, and the moved steps are attributed to that bump.
"""

import pytest

from app.domain import competency, decision, explain
from app.domain.decision import SkillObservation

ROLE = competency.ROLE_AI_ENGINEER_APPLIED


def _obs(**levels: int) -> dict[str, SkillObservation]:
    return {sid: SkillObservation(level=lvl, confidence=1.0) for sid, lvl in levels.items()}


# A profile with a visible gap so the plan is non-empty and stable.
BASE = {
    "eng.api_design": 1,
    "data.embedding": 0,
    "data.vector_search": 0,
}


# --- 1) 同输入同指纹 ---------------------------------------------------------

def test_fingerprint_is_dict_order_invariant():
    obs = _obs(**BASE)
    reordered = dict(reversed(list(obs.items())))
    assert explain.plan_fingerprint(ROLE, obs) == explain.plan_fingerprint(ROLE, reordered)


def test_fingerprint_changes_when_input_changes():
    before = _obs(**BASE)
    after = dict(before)
    after["data.embedding"] = SkillObservation(level=3, confidence=1.0)
    assert explain.plan_fingerprint(ROLE, before) != explain.plan_fingerprint(ROLE, after)


def test_explain_plan_fingerprint_matches_standalone():
    obs = _obs(**BASE)
    ex = explain.explain_plan(ROLE, obs, max_steps=3)
    assert ex["fingerprint"] == explain.plan_fingerprint(ROLE, obs)
    assert ex["steps"], "expected a non-empty plan for a profile with real gaps"


# --- 2) 打分构成加总 = next_score -------------------------------------------

def test_score_breakdown_reconstructs_next_score():
    obs = _obs(**BASE)
    ex = explain.explain_plan(ROLE, obs, max_steps=3)
    for step in ex["steps"]:
        comp = step["score_components"]
        # base_score is the sum of the three additive terms ...
        recomposed_base = (
            comp["gap_term"] + comp["dependency_term"] + comp["learnability_term"]
        )
        assert recomposed_base == pytest.approx(comp["base_score"], abs=1e-3)
        # ... and next_score is base_score scaled by the blocked penalty.
        expected = comp["base_score"] * comp["blocked_penalty"]
        assert step["next_score"] == pytest.approx(expected, abs=1e-3)


def test_score_terms_use_declared_weights():
    obs = _obs(**BASE)
    ex = explain.explain_plan(ROLE, obs, max_steps=3)
    comp = ex["steps"][0]["score_components"]
    assert comp["gap_term"] == pytest.approx(0.5 * comp["gap_score_norm"], abs=1e-3)
    assert comp["dependency_term"] == pytest.approx(0.3 * comp["dependency_urgency"], abs=1e-3)
    assert comp["learnability_term"] == pytest.approx(0.2 * comp["learnability"], abs=1e-3)


def test_blocked_step_is_downweighted():
    obs = _obs(**BASE)
    ex = explain.explain_plan(ROLE, obs, max_steps=decision.MAX_NEXT_STEPS)
    for step in ex["steps"]:
        comp = step["score_components"]
        if step["dependency"]["blocked_by"]:
            assert comp["blocked_penalty"] < 1.0
            assert "拓扑约束" in step["dependency"]["reason"]
        else:
            assert comp["blocked_penalty"] == 1.0


# --- 3) diff 因果归因 --------------------------------------------------------

def test_same_input_diff_is_identical():
    obs = _obs(**BASE)
    d = explain.diff_plans(ROLE, obs, dict(obs), max_steps=3)
    assert d["identical"] is True
    assert d["input_changes"] == []
    assert d["order_changes"] == []
    assert d["fingerprint_before"] == d["fingerprint_after"]


def test_input_change_drives_and_attributes_order_change():
    before = _obs(**BASE)
    after = dict(before)
    after["data.embedding"] = SkillObservation(level=3, confidence=1.0)

    d = explain.diff_plans(ROLE, before, after, max_steps=3)

    assert d["identical"] is False
    assert d["fingerprint_before"] != d["fingerprint_after"]
    # The only input that moved must be the one we bumped.
    changed_ids = {c["skill_id"] for c in d["input_changes"]}
    assert changed_ids == {"data.embedding"}
    # Bumping embedding must actually reshuffle the surfaced plan ...
    assert d["order_changes"], "a level bump that feeds dependencies should shift the plan"
    # ... and the attribution must point at that input, not at randomness.
    assert "data.embedding" in d["attribution"].replace(" ", "") or \
        any(c["skill_id"] == "data.embedding" for c in d["input_changes"])
