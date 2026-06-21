from fastapi import APIRouter, Depends

from app.domain import competency
from app.domain.question_bank import ANSWER_OPTIONS, option_label
from app.i18n import Lang, get_lang, t
from app.schemas import (
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
