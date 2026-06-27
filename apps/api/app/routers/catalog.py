import json
from pathlib import Path

from fastapi import APIRouter, Depends, Query

from app.domain import competency
from app.domain.question_bank import ANSWER_OPTIONS, option_label
from app.i18n import Lang, get_lang, t
from app.schemas import (
    AiExplorationOut,
    AssessmentPlanResponse,
    AssessSkillOut,
    CapsuleOut,
    CategoryOut,
    ConfirmProbeOut,
    DepthTierOut,
    ExperienceCapsulesResponse,
    JdMatchRequest,
    JdMatchResponse,
    OrientationOut,
    ProficiencyOptionOut,
    SkillCatalogResponse,
    SkillGroupOut,
    SkillItemOut,
    SkillMapping,
    SkipSkillOut,
    TransferSkillOut,
)

router = APIRouter(prefix="/api", tags=["catalog"])

# Display order for the four competency areas; labels/hints come from the i18n
# catalog (category.<cat>.label / .hint).
CATEGORY_ORDER: list[str] = ["foundation", "data", "llm", "eval"]

# Path config for role-based skill filtering (env-injectable path)
def _resolve_path_config() -> Path:
    from app.core.config import settings
    p = Path(settings.path_config_path)
    if p.is_absolute():
        return p
    return Path(__file__).resolve().parent.parent / settings.path_config_path.removeprefix("app/")

_PATH_CONFIG_FILE = _resolve_path_config()
_PATH_CONFIG: dict = json.loads(_PATH_CONFIG_FILE.read_text(encoding="utf-8"))

# Experience capsules data
_CAPSULES_FILE = Path(__file__).resolve().parent.parent / "data" / "experience_capsules.json"
_CAPSULES_DATA: dict = (
    json.loads(_CAPSULES_FILE.read_text(encoding="utf-8"))
    if _CAPSULES_FILE.exists()
    else {"capsules": {}, "confirm_skills": {}}
)


def _get_path_filter(current_role: str | None, target_role: str | None) -> set[str] | None:
    """Return the set of skill_ids to assess for a given path, or None (show all)."""
    if not current_role:
        return None
    target = target_role or "ai_engineer"
    # Try exact key first, then fallback without _applied suffix
    paths = _PATH_CONFIG.get("paths", {})
    key = f"{current_role} → {target}"
    path = paths.get(key)
    if not path:
        # Strip common suffixes for flexible matching
        target_short = target.replace("_applied", "").replace("_general", "")
        key = f"{current_role} → {target_short}"
        path = paths.get(key)
    if not path:
        return None
    return set(path.get("assess", []))


@router.get("/skills", response_model=SkillCatalogResponse)
def list_skills(
    lang: Lang = Depends(get_lang),
    current_role: str | None = Query(default=None, description="Filter skills by career path"),
    target_role: str | None = Query(default=None),
) -> SkillCatalogResponse:
    assess_filter = _get_path_filter(current_role, target_role)

    groups: list[SkillGroupOut] = []
    for category in CATEGORY_ORDER:
        items = [
            SkillItemOut(
                skill_id=s.id,
                name=competency.skill_name(s.id, lang),
                learnability=s.learnability,
                layer=s.layer,
                ai_usage=list(s.ai_usage_en if lang == "en" else s.ai_usage),
                non_ai_boundaries=list(s.non_ai_boundaries_en if lang == "en" else s.non_ai_boundaries),
            )
            for s in competency.SKILLS
            if s.category == category
            and (assess_filter is None or s.id in assess_filter)
        ]
        if items:  # skip empty categories after filtering
            groups.append(
                SkillGroupOut(
                    category=category,
                    label=t(lang, f"category.{category}.label"),
                    hint=t(lang, f"category.{category}.hint"),
                    skills=items,
                )
            )

    proficiency = [
        ProficiencyOptionOut(value=o.value, label=option_label(o.value, lang), level=o.level)
        for o in ANSWER_OPTIONS
    ]
    orientations = [
        OrientationOut(
            id=o.id,
            label=competency.orientation_label(o, lang),
            description=competency.orientation_description(o, lang),
        )
        for o in competency.ORIENTATIONS.values()
    ]
    return SkillCatalogResponse(
        groups=groups, proficiency=proficiency, orientations=orientations
    )


@router.get("/paths")
def list_paths(lang: Lang = Depends(get_lang)):
    """Return available current/target roles for the career path selector."""
    return {
        "current_roles": _PATH_CONFIG.get("current_roles", []),
        "target_roles": _PATH_CONFIG.get("target_roles", []),
    }


@router.get("/experience-capsules", response_model=ExperienceCapsulesResponse)
def get_experience_capsules(
    current_role: str = Query(..., description="User's current role id"),
    lang: Lang = Depends(get_lang),
) -> ExperienceCapsulesResponse:
    """Return experience capsules for career transition discovery.

    v4: unified capability model + role-based experience priors.
    The backend filters capabilities by prior >= threshold for the given role,
    sorts by prior descending within each category, and selects role-specific
    capsule phrasing. The frontend sees the same response shape as v3.1.
    """
    # Depth tiers
    raw_tiers = _CAPSULES_DATA.get("depth_tiers", [])
    tiers = [
        DepthTierOut(
            id=td["id"],
            label=td.get(f"label_{lang}", "") or td.get("label_zh", ""),
            level_offset=td.get("level_offset", 0),
        )
        for td in raw_tiers
    ]

    prior_threshold = _CAPSULES_DATA.get("prior_threshold", 0.3)

    # Build category lookup from the shared category definitions
    raw_cats = _CAPSULES_DATA.get("categories", [])
    cat_meta: dict[str, dict] = {c["id"]: c for c in raw_cats}
    cat_capsules: dict[str, list[tuple[float, CapsuleOut]]] = {
        c["id"]: [] for c in raw_cats
    }

    # Walk unified capabilities, filter by role prior, preserve JSON order
    for idx, cap in enumerate(_CAPSULES_DATA.get("capabilities", [])):
        variant = cap.get("role_variants", {}).get(current_role)
        if not variant:
            continue
        prior = variant.get("prior", 0)
        if prior < prior_threshold:
            continue
        cat_id = cap.get("category", "")
        if cat_id not in cat_capsules:
            continue
        capsule = _build_capsule_from_capability(cap, variant, lang)
        cat_capsules[cat_id].append((idx, capsule))

    # Assemble categories (preserve defined order, skip empty ones)
    categories: list[CategoryOut] = []
    for cat_def in raw_cats:
        cid = cat_def["id"]
        items = cat_capsules.get(cid, [])
        if not items:
            continue
        # Preserve original JSON definition order (idx ascending)
        items.sort(key=lambda x: x[0])
        categories.append(
            CategoryOut(
                id=cid,
                label=cat_def.get(f"label_{lang}", "") or cat_def.get("label_zh", ""),
                icon=cat_def.get("icon", ""),
                hint=cat_def.get(f"hint_{lang}", "") or cat_def.get("hint_zh", ""),
                capsules=[c for _, c in items],
            )
        )

    # AI exploration (shared across roles, with role-specific phrasing)
    ai_exp = _CAPSULES_DATA.get("ai_exploration")
    ai_exploration = None
    if ai_exp:
        ai_caps = []
        for idx, cap in enumerate(ai_exp.get("capsules", [])):
            variant = cap.get("role_variants", {}).get(current_role)
            if not variant:
                continue
            prior = variant.get("prior", 0)
            if prior < prior_threshold:
                continue
            ai_caps.append((idx, _build_capsule_from_capability(cap, variant, lang)))
        if ai_caps:
            ai_caps.sort(key=lambda x: x[0])
            ai_exploration = AiExplorationOut(
                label=ai_exp.get(f"label_{lang}", "") or ai_exp.get("label_zh", ""),
                icon=ai_exp.get("icon", ""),
                hint=ai_exp.get(f"hint_{lang}", "") or ai_exp.get("hint_zh", ""),
                capsules=[c for _, c in ai_caps],
            )

    # Confirm probes (shared across all roles)
    raw_probes = _CAPSULES_DATA.get("confirm_skills", [])
    probes: list[ConfirmProbeOut] = []
    for p in raw_probes:
        sid = p["skill_id"]
        skill = competency.SKILLS_BY_ID.get(sid)
        if not skill:
            continue
        probes.append(
            ConfirmProbeOut(
                skill_id=sid,
                name=competency.skill_name(sid, lang),
                explain=p.get(f"explain_{lang}", "") or p.get("explain_zh", ""),
                options=p.get(f"options_{lang}", []) or p.get("options_zh", []),
                option_levels=p.get("option_levels", [0, 1, 2]),
            )
        )

    return ExperienceCapsulesResponse(
        current_role=current_role,
        depth_tiers=tiers,
        categories=categories,
        ai_exploration=ai_exploration,
        confirm_probes=probes,
    )


def _build_capsule_from_capability(
    cap: dict, variant: dict, lang: str
) -> CapsuleOut:
    """Build a CapsuleOut from a unified capability + role variant."""
    text = variant.get(f"text_{lang}", "") or variant.get("text_zh", "")
    cap_name = cap.get(f"capability_{lang}", "") or cap.get("capability_zh", "")
    return CapsuleOut(
        id=cap["id"],
        text=text,
        capability=cap_name,
        maps_to=[SkillMapping(**m) for m in cap.get("maps_to", [])],
    )


@router.get("/assessment-plan", response_model=AssessmentPlanResponse)
def get_assessment_plan(
    current_role: str = Query(..., description="User's current role id"),
    target_role: str | None = Query(default=None),
    lang: Lang = Depends(get_lang),
) -> AssessmentPlanResponse:
    """Return a structured migration assessment plan.

    Splits skills into three buckets:
      - transfer_skills: skills the user likely already has (pre-filled)
      - assess_skills: core gaps the user needs to self-evaluate
      - skip_skills: not relevant for the first-pass assessment

    This is the engine of Loop 1: "does the system understand my starting point?"
    """
    target = target_role or "ai_engineer"
    paths = _PATH_CONFIG.get("paths", {})
    # Resolve path config (same key logic as _get_path_filter)
    key = f"{current_role} → {target}"
    path = paths.get(key)
    if not path:
        target_short = target.replace("_applied", "").replace("_general", "")
        key = f"{current_role} → {target_short}"
        path = paths.get(key)

    # Fallback: empty transfer, all skills assessed
    if not path:
        all_skills = [
            AssessSkillOut(
                skill_id=s.id,
                name=competency.skill_name(s.id, lang),
                category=s.category,
                learnability=s.learnability,
                weight=_skill_weight(s.id),
                type=_skill_type(s.id),
            )
            for s in competency.SKILLS
        ]
        return AssessmentPlanResponse(
            current_role=current_role,
            target_role=target,
            transfer_skills=[],
            assess_skills=all_skills,
            skip_skills=[],
        )

    # Build transfer_skills from the new "transfer" array
    transfer_items = path.get("transfer", [])
    transfer_skills: list[TransferSkillOut] = []
    transfer_ids: set[str] = set()
    for item in transfer_items:
        sid = item["skill_id"]
        skill = competency.SKILLS_BY_ID.get(sid)
        if not skill:
            continue
        transfer_ids.add(sid)
        reason = item.get(f"reason_{lang}", "") or item.get("reason_zh", "")
        transfer_skills.append(
            TransferSkillOut(
                skill_id=sid,
                name=competency.skill_name(sid, lang),
                category=skill.category,
                tier=item.get("tier", "direct_transfer"),
                default_level=item.get("default_level", 2),
                learnability=skill.learnability,
                reason=reason,
            )
        )

    # Build assess_skills
    assess_ids = path.get("assess", [])
    assess_skills: list[AssessSkillOut] = []
    for sid in assess_ids:
        if sid in transfer_ids:
            continue
        skill = competency.SKILLS_BY_ID.get(sid)
        if not skill:
            continue
        assess_skills.append(
            AssessSkillOut(
                skill_id=sid,
                name=competency.skill_name(sid, lang),
                category=skill.category,
                learnability=skill.learnability,
                weight=_skill_weight(sid),
                type=_skill_type(sid),
            )
        )

    # Build skip_skills
    skip_ids = path.get("skip", [])
    skip_skills: list[SkipSkillOut] = []
    for sid in skip_ids:
        skill = competency.SKILLS_BY_ID.get(sid)
        if not skill:
            continue
        skip_skills.append(
            SkipSkillOut(
                skill_id=sid,
                name=competency.skill_name(sid, lang),
                category=skill.category,
            )
        )

    return AssessmentPlanResponse(
        current_role=current_role,
        target_role=path.get("target_role", target),
        transfer_skills=transfer_skills,
        assess_skills=assess_skills,
        skip_skills=skip_skills,
    )


def _skill_weight(skill_id: str) -> float:
    """Look up the weight of a skill in the base role requirements."""
    for r in competency.ROLE_REQUIREMENTS:
        if r.skill_id == skill_id:
            return r.weight
    return 0.5


def _skill_type(skill_id: str) -> str:
    """Look up whether a skill is required or bonus."""
    for r in competency.ROLE_REQUIREMENTS:
        if r.skill_id == skill_id:
            return r.type
    return "required"


@router.post("/match-orientation", response_model=JdMatchResponse)
def match_orientation(
    payload: JdMatchRequest, lang: Lang = Depends(get_lang)
) -> JdMatchResponse:
    """Infer a target orientation from a pasted job description.

    Stateless: the user pastes a JD on the result page, we detect whether the
    role is (e.g.) retrieval-heavy, and the frontend then re-scores the existing
    profile via `GET /sessions/{id}/result?orientation=...`. No JD text is stored.
    """
    orientation_id, signals = competency.classify_jd(payload.jd)
    orient = competency.get_orientation(orientation_id)
    return JdMatchResponse(
        orientation=orientation_id,
        orientation_label=competency.orientation_label(orient, lang),
        description=competency.orientation_description(orient, lang),
        matched=orientation_id != competency.ORIENTATION_BASE,
        signals=signals,
    )
