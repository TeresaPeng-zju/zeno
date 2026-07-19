"""Competency model for the MVP role: 前端工程师 -> AI Engineer (应用向).

This is the deterministic backbone of Zeno. The decision/expression split
(see project plan) keeps gap & ranking reproducible; the LLM only rephrases.

Skills are grouped into 4 competency areas:
    - foundation : 工程地基 (transferable from frontend)
    - data       : 数据与检索 (RAG 地基)
    - llm        : LLM 应用能力
    - eval       : 评估与迭代 (差异化点)

Each Skill carries `learnability` (0-1): how transferable a frontend
background is. RoleRequirement carries `weight`, `min_level`, `type`
(required/bonus) and `branch_impact` (0/1) used by the orchestrator.

DATA EXTERNALIZATION
--------------------
The skill graph itself (skills / role requirements / dependencies /
orientations) is **data, not code**, and lives in ``app/data/skill_graph.json``.
This module only owns the *logic* (dataclasses + scoring/lookup helpers) and
loads that data at import time. Calibration scripts (e.g. JD-driven reweighting)
can regenerate the JSON and `git diff` it; adding a new target role becomes a
new data file rather than new Python. The public names exported here
(``SKILLS``, ``ROLE_REQUIREMENTS``, ``SKILL_DEPENDENCIES``, ``ORIENTATIONS`` …)
are unchanged, so the rest of the codebase is unaffected.
"""

import json
from dataclasses import dataclass, field, replace
from pathlib import Path

ROLE_AI_ENGINEER_APPLIED = "ai_engineer_applied"

# Target orientations: sub-specializations of the applied role (README:
# "应用向：RAG / Agent / LLM App"). A modifier reweights the BASE requirements;
# `base` == no modifier == today's behaviour, so the pipeline & eval baseline
# only fork when an orientation is explicitly chosen.
ORIENTATION_BASE = "base"
ORIENTATION_RAG = "rag"
DEFAULT_ORIENTATION = ORIENTATION_BASE

# Single source of truth for the skill graph data.
_SKILL_GRAPH_FILE = Path(__file__).resolve().parent.parent / "data" / "skill_graph.json"


@dataclass(frozen=True)
class Skill:
    id: str
    name: str
    category: str  # foundation | data | llm | eval
    learnability: float  # 0-1, frontend -> this skill transferability
    name_en: str = ""  # English display name (i18n; falls back to `name`)
    layer: str = ""   # L0 | L1 | L2 | L3 — abstraction level
    roles: tuple[str, ...] = field(default_factory=tuple)  # roles this skill applies to
    ai_usage: tuple[str, ...] = field(default_factory=tuple)        # zh
    ai_usage_en: tuple[str, ...] = field(default_factory=tuple)     # en
    non_ai_boundaries: tuple[str, ...] = field(default_factory=tuple)     # zh
    non_ai_boundaries_en: tuple[str, ...] = field(default_factory=tuple)  # en


@dataclass(frozen=True)
class RoleRequirement:
    role_id: str
    skill_id: str
    min_level: int
    weight: float  # 0-1
    type: str  # required | bonus
    branch_impact: int  # 0/1 — does knowing this change the recommended path?
    # How a GAP in this skill should be CLOSED (curated judgement, the moat):
    #   foundation_have | ai_accelerated | core_learn | product_loop | pm_side
    # Routes the *action type* of a recommendation, not its ranking. Default ""
    # keeps older data files valid (treated as core_learn downstream).
    fulfillment_class: str = ""


@dataclass(frozen=True)
class SkillDependency:
    skill_id: str
    depends_on: str


@dataclass(frozen=True)
class OrientationModifier:
    """Reweights the BASE role requirements for a target orientation.

    Deltas are applied on top of the base list (weight clamped to [0, 1],
    min_level to [0, 4]); skills not mentioned keep their base values, and
    `promote_required` flips a bonus skill to required. The `base` orientation
    is the empty modifier, so selecting nothing reproduces today's behaviour
    exactly — the offline eval baseline only forks when an orientation is chosen.
    """

    id: str
    label: str
    description: str
    label_en: str = ""  # English label (i18n; falls back to `label`)
    description_en: str = ""  # English description (i18n; falls back to `description`)
    weight_delta: dict[str, float] = field(default_factory=dict)
    min_level_delta: dict[str, int] = field(default_factory=dict)
    promote_required: frozenset[str] = field(default_factory=frozenset)


# --------------------------------------------------------------------------- #
# Data loading (skill_graph.json -> in-memory structures)
# --------------------------------------------------------------------------- #
def _load_raw(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _build_orientation(o: dict) -> OrientationModifier:
    return OrientationModifier(
        id=o["id"],
        label=o["label"],
        description=o["description"],
        label_en=o.get("label_en", ""),
        description_en=o.get("description_en", ""),
        weight_delta=dict(o.get("weight_delta", {})),
        min_level_delta=dict(o.get("min_level_delta", {})),
        promote_required=frozenset(o.get("promote_required", ())),
    )


_RAW = _load_raw(_SKILL_GRAPH_FILE)
_ROLE_ID = _RAW["role"]["id"]
ROLE_LABEL: str = _RAW["role"]["label"]
ROLE_LABEL_EN: str = _RAW["role"].get("label_en", "") or ROLE_LABEL

# Level 0-4 reference descriptions (shared rubric, plan 4.2)
LEVEL_RUBRIC: dict[int, str] = {int(k): v for k, v in _RAW["level_rubric"].items()}
LEVEL_RUBRIC_EN: dict[int, str] = {
    int(k): v for k, v in _RAW.get("level_rubric_en", {}).items()
}

# Skills
def _load_skill(s: dict) -> Skill:
    return Skill(
        id=s["id"],
        name=s["name"],
        category=s["category"],
        learnability=s["learnability"],
        name_en=s.get("name_en", ""),
        layer=s.get("layer", ""),
        roles=tuple(s.get("roles", [])),
        ai_usage=tuple(s.get("ai_usage", [])),
        ai_usage_en=tuple(s.get("ai_usage_en", [])),
        non_ai_boundaries=tuple(s.get("non_ai_boundaries", [])),
        non_ai_boundaries_en=tuple(s.get("non_ai_boundaries_en", [])),
    )

SKILLS: list[Skill] = [_load_skill(s) for s in _RAW["skills"]]
SKILLS_BY_ID: dict[str, Skill] = {s.id: s for s in SKILLS}

# Role requirements (role_id injected from the role section)
ROLE_REQUIREMENTS: list[RoleRequirement] = [
    RoleRequirement(role_id=_ROLE_ID, **r) for r in _RAW["role_requirements"]
]

# Dependencies (skill -> depends_on)
SKILL_DEPENDENCIES: list[SkillDependency] = [
    SkillDependency(**d) for d in _RAW["dependencies"]
]

# Target orientations (modifiers over the base requirements)
ORIENTATIONS: dict[str, OrientationModifier] = {
    o["id"]: _build_orientation(o) for o in _RAW["orientations"]
}


# --------------------------------------------------------------------------- #
# Lookup / scoring helpers (logic — unchanged)
# --------------------------------------------------------------------------- #
def get_orientation(orientation_id: str | None) -> OrientationModifier:
    return ORIENTATIONS.get(orientation_id or ORIENTATION_BASE, ORIENTATIONS[ORIENTATION_BASE])


def _apply_modifier(req: RoleRequirement, mod: OrientationModifier) -> RoleRequirement:
    weight = min(1.0, max(0.0, req.weight + mod.weight_delta.get(req.skill_id, 0.0)))
    min_level = min(4, max(0, req.min_level + mod.min_level_delta.get(req.skill_id, 0)))
    req_type = "required" if req.skill_id in mod.promote_required else req.type
    return replace(req, weight=round(weight, 4), min_level=min_level, type=req_type)


def requirements_for_role(
    role_id: str, orientation_id: str = ORIENTATION_BASE
) -> list[RoleRequirement]:
    base = [r for r in ROLE_REQUIREMENTS if r.role_id == role_id]
    mod = get_orientation(orientation_id)
    if mod.id == ORIENTATION_BASE:
        return base
    return [_apply_modifier(r, mod) for r in base]


def requirement_by_skill(
    role_id: str, orientation_id: str = ORIENTATION_BASE
) -> dict[str, RoleRequirement]:
    return {r.skill_id: r for r in requirements_for_role(role_id, orientation_id)}


def dependencies_of(skill_id: str) -> list[str]:
    return [d.depends_on for d in SKILL_DEPENDENCIES if d.skill_id == skill_id]


# --------------------------------------------------------------------------- #
# i18n display helpers (expression layer — decision layer stays language-neutral)
# --------------------------------------------------------------------------- #
def skill_name(skill_id: str, lang: str = "en") -> str:
    """Localized display name for a skill (falls back to the Chinese `name`)."""
    skill = SKILLS_BY_ID.get(skill_id)
    if skill is None:
        return skill_id
    if lang == "en":
        return skill.name_en or skill.name
    return skill.name


def level_rubric(level: int, lang: str = "en") -> str:
    """Localized rubric text for a proficiency level."""
    if lang == "en":
        return LEVEL_RUBRIC_EN.get(level) or LEVEL_RUBRIC.get(level, "")
    return LEVEL_RUBRIC.get(level, "")


def role_label(lang: str = "en") -> str:
    """Localized label for the target role."""
    return ROLE_LABEL_EN if lang == "en" else ROLE_LABEL


def orientation_label(o: OrientationModifier, lang: str = "en") -> str:
    """Localized label for an orientation (falls back to the Chinese `label`)."""
    if lang == "en":
        return o.label_en or o.label
    return o.label


def orientation_description(o: OrientationModifier, lang: str = "en") -> str:
    """Localized description for an orientation (falls back to Chinese)."""
    if lang == "en":
        return o.description_en or o.description
    return o.description
