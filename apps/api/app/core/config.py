from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://zeno:zeno@localhost:5432/zeno"
    cors_origins: str = "http://localhost:3000"

    # LLM
    llm_provider: str = "mock"  # mock | openai
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    # Embedding (Week 3 resource engine). 1536 = OpenAI text-embedding-3-small.
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536

    # Questionnaire orchestrator
    max_questions: int = 18
    uncertainty_threshold: float = 0.2

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
