"""Question bank: per-skill observable question template.

The orchestrator decides WHICH skill to ask; the LLM decides HOW to phrase
it. Options are a FIXED enum (the LLM may never invent options). Each option
maps to a (level, evidence_type, confidence) tuple so a single button click
captures both proficiency and an evidence signal.
"""

from dataclasses import dataclass

from app.domain.competency import SKILLS_BY_ID


@dataclass(frozen=True)
class AnswerOption:
    value: str
    label: str
    level: int
    evidence_type: str  # self_claim | project | work | repo
    confidence: float  # 0-1, how trustworthy this self-report is


# Fixed, ordered option set — single source of truth for scoring.
ANSWER_OPTIONS: list[AnswerOption] = [
    AnswerOption("none", "完全没接触过", 0, "self_claim", 0.6),
    AnswerOption("tutorial", "看过资料 / 跟教程跑通过", 1, "self_claim", 0.5),
    AnswerOption("demo", "做过个人小功能 / demo", 2, "project", 0.7),
    AnswerOption("shipped", "在真实项目里交付并排障过", 3, "work", 0.85),
    AnswerOption("expert", "设计 / 优化过相关系统，能治理", 4, "work", 0.9),
]

OPTIONS_BY_VALUE: dict[str, AnswerOption] = {o.value: o for o in ANSWER_OPTIONS}


def default_question_text(skill_id: str) -> str:
    skill = SKILLS_BY_ID[skill_id]
    return f"你在「{skill.name}」方面的实际经验是？"


def default_help_text(skill_id: str) -> str:
    skill = SKILLS_BY_ID[skill_id]
    return (
        f"这道题评估你在「{skill.name}」上的水平，"
        f"用于判断你与目标岗位（AI Engineer 应用向）的能力差距。按真实经历选择即可。"
    )
