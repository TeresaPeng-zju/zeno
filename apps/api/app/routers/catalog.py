from fastapi import APIRouter, Depends

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


@router.get("/skills", response_model=SkillCatalogResponse)
def list_skills(lang: Lang = Depends(get_lang)) -> SkillCatalogResponse:
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
        ]
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
