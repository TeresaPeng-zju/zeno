from fastapi import APIRouter

from app.domain import competency
from app.domain.question_bank import ANSWER_OPTIONS
from app.schemas import (
    ProficiencyOptionOut,
    SkillCatalogResponse,
    SkillGroupOut,
    SkillItemOut,
)

router = APIRouter(prefix="/api", tags=["catalog"])

# Display order + Chinese labels for the four competency areas.
CATEGORY_ORDER: list[tuple[str, str, str]] = [
    ("foundation", "工程地基", "可从前端迁移的能力"),
    ("data", "数据与检索", "RAG 的地基"),
    ("llm", "LLM 应用", "把模型变成产品能力"),
    ("eval", "评估与迭代", "最容易被忽略的差异点"),
]


@router.get("/skills", response_model=SkillCatalogResponse)
def list_skills() -> SkillCatalogResponse:
    groups: list[SkillGroupOut] = []
    for category, label, hint in CATEGORY_ORDER:
        items = [
            SkillItemOut(skill_id=s.id, name=s.name, learnability=s.learnability)
            for s in competency.SKILLS
            if s.category == category
        ]
        groups.append(SkillGroupOut(category=category, label=label, hint=hint, skills=items))

    proficiency = [
        ProficiencyOptionOut(value=o.value, label=o.label, level=o.level)
        for o in ANSWER_OPTIONS
    ]
    return SkillCatalogResponse(groups=groups, proficiency=proficiency)
