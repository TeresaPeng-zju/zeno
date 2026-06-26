import json
import re

from app.core.config import settings
from app.llm.base import LLMProvider
from app.utils.retry import with_retry

_SYSTEM = (
    "你是 Zeno 的问卷文案助手。只能改写问题措辞，使其更自然、口语化、鼓励真实作答。"
    "禁止改变问题语义，禁止新增或暗示任何选项。"
    '严格返回 JSON：{"question_text": "...", "help_text": "..."}。'
)

# Some reasoning models (DeepSeek R1, MiniMax M2.5) wrap internal chain-of-thought
# in <think>...</think> tags. Strip them before parsing the actual content.
_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)


def _strip_think_tags(content: str) -> str:
    """Remove <think>…</think> blocks from LLM output."""
    return _THINK_RE.sub("", content).strip()


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
            def _call():
                return self._client.chat.completions.create(
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

            resp = with_retry(_call, max_retries=2, base_delay=1.0)
            raw = resp.choices[0].message.content or "{}"
            cleaned = _strip_think_tags(raw)
            data = json.loads(cleaned)
            text = data.get("question_text") or default_text
            help_text = data.get("help_text") or default_help
            return text, help_text
        except Exception:
            # Schema/connection failure -> fall back to deterministic template.
            return default_text, default_help
