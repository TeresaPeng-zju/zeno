from functools import lru_cache

from app.core.config import settings
from app.llm.base import LLMProvider
from app.llm.mock import MockProvider


@lru_cache(maxsize=1)
def get_llm_provider() -> LLMProvider:
    if settings.llm_provider == "openai" and settings.openai_api_key:
        from app.llm.openai_provider import OpenAIProvider

        return OpenAIProvider()
    return MockProvider()
