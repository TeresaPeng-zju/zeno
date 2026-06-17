from app.llm.base import LLMProvider


class MockProvider(LLMProvider):
    """Deterministic provider — returns the template text unchanged.

    Lets the whole Week 1 slice run without any API key.
    """

    def rephrase_question(
        self,
        *,
        skill_name: str,
        skill_category: str,
        default_text: str,
        default_help: str,
    ) -> tuple[str, str]:
        return default_text, default_help
