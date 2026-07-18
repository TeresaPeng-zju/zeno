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


def option_example(skill_id: str, value: str, lang: str = "en") -> str | None:
    """Give each generic proficiency tier a skill-specific observable example."""
    if value == "none":
        return None
    skill = competency.SKILLS_BY_ID[skill_id]
    name = competency.skill_name(skill_id, lang)
    usages = skill.ai_usage_en if lang == "en" else skill.ai_usage
    action = usages[0] if usages else name

    if skill_id == "llm.prompt":
        special = {
            "tutorial": "例如：能说明角色、约束和示例分别解决什么问题",
            "demo": "例如：为一个小功能写过结构化Prompt，并迭代过输入输出",
            "shipped": "例如：在真实项目中维护过Prompt，并处理过失败案例",
            "expert": "例如：设计过可复用Prompt模板，并处理过版本、评测和失败回退",
        }
        special_en = {
            "tutorial": "For example: can explain what roles, constraints, and examples each solve",
            "demo": "For example: wrote and iterated a structured prompt for a small feature",
            "shipped": "For example: maintained prompts in production and handled failures",
            "expert": "For example: designed reusable prompt templates with versioning, evaluation, and fallbacks",
        }
        return (special_en if lang == "en" else special).get(value)

    if lang == "en":
        templates = {
            "tutorial": f"For example: can explain the basic purpose of {name}",
            "demo": f"For example: used it in a small feature to {action.rstrip('.')}",
            "shipped": "For example: delivered it in a real project and debugged failures",
            "expert": "For example: can design the approach, evaluate results, and improve it continuously",
        }
    else:
        templates = {
            "tutorial": f"例如：能说明{name}的基本用途",
            "demo": f"例如：在小功能中尝试过{action.rstrip('。')}",
            "shipped": "例如：在真实项目中交付过，并处理过失败或异常情况",
            "expert": "例如：能设计整体方案、评测结果并持续优化",
        }
    return templates.get(value)


def default_question_text(skill_id: str, lang: str = "en") -> str:
    return t(lang, "question.text", skill=competency.skill_name(skill_id, lang))


def default_help_text(skill_id: str, lang: str = "en") -> str:
    return t(lang, "question.help", skill=competency.skill_name(skill_id, lang))
