"""Plan providers — the contestants in the decision-surface comparison.

A PlanProvider takes a user profile and returns an *ordered learning sequence*
(a list of skill ids, earliest-to-learn first) over the gap universe. Every
provider is scored by the same neutral rulers in scorer.py / jd_grounding.py.

Three contestants:
  * ZenoPlanProvider   — the real deterministic engine (decision.select_next_steps).
  * NaivePlanProvider  — synthetic baseline: rank purely by market-need strength
    (gap_score) and DELIBERATELY ignore dependencies. This is the mistake a
    "rank by importance" planner (human or model) makes by default.
  * DeepSeekPlanProvider — an external LLM opponent. Fed the SAME skill graph as
    a tool and asked to order the same gap universe. Uses httpx directly (DeepSeek
    is OpenAI-compatible), so no extra dependency. Degrades gracefully if the key
    is absent or the call fails — it just reports itself unavailable.

The point of the naive + DeepSeek providers is to make Zeno's hard-constraint
scores (which are 0-violations by construction) mean something: a number is only
evidence next to an opponent's number.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.core.config import settings
from app.domain import competency, decision
from app.domain.decision import SkillObservation


@dataclass(frozen=True)
class Profile:
    name: str
    obs: dict[str, SkillObservation]


@dataclass
class PlanResult:
    provider: str
    sequence: list[str]
    available: bool = True
    note: str = ""
    raw: dict = field(default_factory=dict)


def gap_universe(
    profile: Profile, role_id: str, orientation_id: str
) -> list[str]:
    """Skills with a positive gap — the shared candidate set every provider ranks."""
    gaps = decision.compute_gaps(role_id, profile.obs, orientation_id)
    return [g.req.skill_id for g in gaps if g.gap > 0]


class PlanProvider(ABC):
    name: str = "provider"

    @abstractmethod
    def plan(
        self, profile: Profile, role_id: str, orientation_id: str
    ) -> PlanResult:
        raise NotImplementedError


class ZenoPlanProvider(PlanProvider):
    name = "Zeno"

    def plan(self, profile: Profile, role_id: str, orientation_id: str) -> PlanResult:
        gaps = decision.compute_gaps(role_id, profile.obs, orientation_id)
        steps = decision.select_next_steps(
            role_id, profile.obs, max_steps=len(gaps) or 1, orientation_id=orientation_id
        )
        return PlanResult(provider=self.name, sequence=[s.skill_id for s in steps])


class NaivePlanProvider(PlanProvider):
    """Rank by market-need strength (gap_score) only — no dependency awareness."""

    name = "naive-baseline"

    def plan(self, profile: Profile, role_id: str, orientation_id: str) -> PlanResult:
        gaps = [
            g for g in decision.compute_gaps(role_id, profile.obs, orientation_id) if g.gap > 0
        ]
        gaps.sort(key=lambda g: g.gap_score, reverse=True)
        return PlanResult(provider=self.name, sequence=[g.req.skill_id for g in gaps])


# --------------------------------------------------------------------------- #
# DeepSeek (external opponent) — OpenAI-compatible REST via httpx, no SDK needed.
# --------------------------------------------------------------------------- #
_DS_SYSTEM = (
    "你是一名资深职业发展规划师。给定目标岗位的技能图（含技能、前置依赖、岗位要求）"
    "和用户当前各技能水平，请把【待学技能列表】排成一个最合理的学习顺序。"
    "必须遵守前置依赖：若 A 是 B 的前置，A 必须排在 B 之前。"
    '只返回 JSON：{"sequence": ["skill_id", ...]}，其中 skill_id 只能来自给定的待学列表。'
)


def _graph_payload(role_id: str, orientation_id: str, universe: list[str]) -> dict:
    reqs = competency.requirement_by_skill(role_id, orientation_id)
    return {
        "skills": [
            {"id": s.id, "name": s.name, "category": s.category}
            for s in competency.SKILLS
            if s.id in universe
        ],
        "dependencies": [
            {"skill": d.skill_id, "depends_on": d.depends_on}
            for d in competency.SKILL_DEPENDENCIES
        ],
        "requirements": {
            sid: {"min_level": reqs[sid].min_level, "weight": reqs[sid].weight, "type": reqs[sid].type}
            for sid in universe
            if sid in reqs
        },
        "to_order": universe,
    }


class DeepSeekPlanProvider(PlanProvider):
    name = "deepseek"

    def __init__(self, temperature: float = 0.0) -> None:
        self._key = settings.deepseek_api_key
        self._model = settings.deepseek_model
        self._base = settings.deepseek_base_url.rstrip("/")
        self._temperature = temperature

    def plan(self, profile: Profile, role_id: str, orientation_id: str) -> PlanResult:
        universe = gap_universe(profile, role_id, orientation_id)
        if not self._key:
            return PlanResult(self.name, [], available=False, note="DEEPSEEK_API_KEY 未配置")
        if not universe:
            return PlanResult(self.name, [], note="无待学技能（gap 为空）")

        levels = {sid: o.level for sid, o in profile.obs.items()}
        user_payload = {
            "current_levels": levels,
            "graph": _graph_payload(role_id, orientation_id, universe),
        }
        try:
            import httpx

            resp = httpx.post(
                f"{self._base}/chat/completions",
                headers={"Authorization": f"Bearer {self._key}"},
                json={
                    "model": self._model,
                    "temperature": self._temperature,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": _DS_SYSTEM},
                        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
                    ],
                },
                timeout=60.0,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            # Strip <think>…</think> blocks from reasoning models (e.g. DeepSeek R1)
            import re
            content = re.sub(r"<think>[\s\S]*?</think>", "", content, flags=re.IGNORECASE).strip()
            data = json.loads(content)
            raw_seq = data.get("sequence", [])
            allowed = set(universe)
            # Keep only valid, in-universe ids; drop dups, preserve model's order.
            seen: set[str] = set()
            seq = [s for s in raw_seq if s in allowed and not (s in seen or seen.add(s))]
            return PlanResult(self.name, seq, raw={"returned": len(raw_seq)})
        except Exception as e:  # network / schema / auth — degrade, never crash the panel
            return PlanResult(self.name, [], available=False, note=f"调用失败：{type(e).__name__}: {e}")
