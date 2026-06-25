import json
from pathlib import Path

from fastapi import APIRouter, Depends, Query

from app.domain import competency
from app.domain.question_bank import ANSWER_OPTIONS, option_label
from app.i18n import Lang, get_lang, t
from app.schemas import (
    JdMatchRequest,
    JdMatchResponse,
    OrientationOut,
    ProficiencyOptionOut,
    SkillCatalogResponse,
    SkillGroupOut,
    SkillItemOut,
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
