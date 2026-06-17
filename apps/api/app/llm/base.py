"""LLM provider abstraction.

The decision/expression split (plan 3.2) means the LLM only rephrases UI text;
it never decides scoring and never invents answer options. Keeping this behind
an interface lets us swap OpenAI / DeepSeek / Anthropic, or run a deterministic
mock with no API key.
"""

from abc import ABC, abstractmethod


class LLMProvider(ABC):
    @abstractmethod
    def rephrase_question(
        self,
        *,
        skill_name: str,
        skill_category: str,
        default_text: str,
        default_help: str,
    ) -> tuple[str, str]:
        """Return (question_text, help_text). Must not change semantics."""
        raise NotImplementedError
