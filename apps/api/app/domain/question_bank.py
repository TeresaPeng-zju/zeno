"""Question bank: per-skill observable question template.

The orchestrator decides WHICH skill to ask; the LLM decides HOW to phrase
it. Options are a FIXED enum (the LLM may never invent options). Each option
maps to a (level, evidence_type, confidence) tuple so a single button click
captures both proficiency and an evidence signal.
"""

from dataclasses import dataclass

from app.domain import competency
from app.i18n import t


@dataclass(frozen=True)
class AnswerOption:
    value: str
    label: str
    level: int
    evidence_type: str  # self_claim | project | work | repo
    confidence: float  # 0-1, how trustworthy this self-report is


# Fixed, ordered option set — single source of truth for scoring. The `label`
# here is a Chinese fallback; localized display labels come from `option_label`.
ANSWER_OPTIONS: list[AnswerOption] = [
    AnswerOption("none", "完全没接触过", 0, "self_claim", 0.6),
    AnswerOption("tutorial", "看过资料 / 跟教程跑通过", 1, "self_claim", 0.5),
    AnswerOption("demo", "做过个人小功能 / demo", 2, "project", 0.7),
    AnswerOption("shipped", "在真实项目里交付并排障过", 3, "work", 0.85),
    AnswerOption("expert", "设计 / 优化过相关系统，能治理", 4, "work", 0.9),
]

OPTIONS_BY_VALUE: dict[str, AnswerOption] = {o.value: o for o in ANSWER_OPTIONS}


def option_label(value: str, lang: str = "en") -> str:
    """Localized display label for an answer option (falls back to its Chinese label)."""
    opt = OPTIONS_BY_VALUE.get(value)
    fallback = opt.label if opt else value
    label = t(lang, f"option.{value}")
    return label if label != f"option.{value}" else fallback


def default_question_text(skill_id: str, lang: str = "en") -> str:
    return t(lang, "question.text", skill=competency.skill_name(skill_id, lang))


def default_help_text(skill_id: str, lang: str = "en") -> str:
    return t(lang, "question.help", skill=competency.skill_name(skill_id, lang))
