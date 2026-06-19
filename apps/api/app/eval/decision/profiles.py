"""Synthetic user profiles for the decision-surface comparison.

These stand in for "a frontend engineer eyeing an applied-AI role" — strong on
TS / web / API, near-zero on the data/retrieval/LLM/eval stack. They are fixed
and reproducible so the comparison is apples-to-apples across providers. Grow
this list as real anonymized profiles arrive.
"""

from __future__ import annotations

from app.domain.decision import SkillObservation
from app.eval.decision.providers import Profile

# Confidence kept high (0.8) so gap_score reflects the level gap, not uncertainty.
_C = 0.8


def _obs(levels: dict[str, int]) -> dict[str, SkillObservation]:
    return {sid: SkillObservation(level=lvl, confidence=_C) for sid, lvl in levels.items()}


PROFILES: list[Profile] = [
    Profile(
        name="前端转应用AI（典型）",
        obs=_obs(
            {
                "eng.typescript": 4,
                "eng.api_design": 3,
                "eng.error_handling": 2,
                "eng.deploy": 2,
                "llm.streaming": 3,
                "llm.prompt": 2,
                # everything else (data.*, eval.*, llm.function_calling/tool_use/...) = 0
            }
        ),
    ),
    Profile(
        name="前端偏全栈（有部署/可观测）",
        obs=_obs(
            {
                "eng.typescript": 4,
                "eng.api_design": 3,
                "eng.auth": 2,
                "eng.error_handling": 3,
                "eng.observability": 2,
                "eng.deploy": 3,
                "llm.prompt": 2,
                "llm.streaming": 2,
                "data.text_processing": 1,
            }
        ),
    ),
    Profile(
        # Stress case: holds only frontend basics, so prompt + text_processing are
        # ALSO unmet. That pulls the full LLM chain (prompt→function_calling→
        # tool_use→agent_state) and the full data chain (text_processing→embedding
        # →vector_search→rerank) into the universe — the deepest, widest ordering
        # load the current graph can produce. Maximizes applicable dependency edges
        # so a planner can't buy a cheap 0% by ordering only the easy linear bits.
        name="前端转应用AI（近零基础·最大依赖暴露）",
        obs=_obs(
            {
                "eng.typescript": 4,
                "eng.api_design": 2,
                "eng.error_handling": 1,
                "llm.streaming": 2,
                # everything else (incl. llm.prompt, data.text_processing) = 0
            }
        ),
    ),
]
