import json

from app.core.config import settings
from app.llm.base import LLMProvider

_SYSTEM = (
    "你是 Zeno 的问卷文案助手。只能改写问题措辞，使其更自然、口语化、鼓励真实作答。"
    "禁止改变问题语义，禁止新增或暗示任何选项。"
    '严格返回 JSON：{"question_text": "...", "help_text": "..."}。'
)


class OpenAIProvider(LLMProvider):
    """OpenAI-backed rephraser. Falls back to template text on any failure."""

    def __init__(self) -> None:
        # Imported lazily so the package is optional in mock mode.
        from openai import OpenAI

        self._client = OpenAI(api_key=settings.openai_api_key)
        self._model = settings.openai_model

    def rephrase_question(
        self,
        *,
        skill_name: str,
        skill_category: str,
        default_text: str,
        default_help: str,
    ) -> tuple[str, str]:
        try:
            resp = self._client.chat.completions.create(
                model=self._model,
                response_format={"type": "json_object"},
                temperature=0.4,
                messages=[
                    {"role": "system", "content": _SYSTEM},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "skill_name": skill_name,
                                "skill_category": skill_category,
                                "default_text": default_text,
                                "default_help": default_help,
                            },
                            ensure_ascii=False,
                        ),
                    },
                ],
            )
            data = json.loads(resp.choices[0].message.content or "{}")
            text = data.get("question_text") or default_text
            help_text = data.get("help_text") or default_help
            return text, help_text
        except Exception:
            # Schema/connection failure -> fall back to deterministic template.
            return default_text, default_help
