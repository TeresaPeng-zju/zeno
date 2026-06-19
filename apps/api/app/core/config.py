from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://zeno:zeno@localhost:5432/zeno"
    cors_origins: str = "http://localhost:3000"

    # LLM
    llm_provider: str = "mock"  # mock | openai
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    # DeepSeek (OpenAI-compatible REST). Used ONLY as an external baseline/opponent
    # in the decision-surface comparison eval — never in the deterministic engine.
    deepseek_api_key: str | None = None
    deepseek_model: str = "deepseek-chat"
    deepseek_base_url: str = "https://api.deepseek.com"
    # Embedding (Week 3 resource engine). 1536 = OpenAI text-embedding-3-small.
    embedding_provider: str = "mock"  # mock | openai
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536

    # Questionnaire orchestrator
    max_questions: int = 18
    uncertainty_threshold: float = 0.2

    # Resource engine (RAG retrieval + multi-signal rerank)
    retrieval_top_k: int = 20  # vector recall fan-out before rerank
    resources_per_step: int = 3  # how many to attach per next-step
    # Multi-signal rerank weights (relevance / freshness / role-fit). Sum ~= 1.
    rerank_w_relevance: float = 0.6
    rerank_w_freshness: float = 0.25
    rerank_w_fit: float = 0.15
    # A resource is "stale" once unverified for longer than this.
    freshness_ttl_days: int = 90

    # Curation agent (function-calling tool chain)
    agent_max_steps: int = 8  # safety cap on the tool loop
    agent_search_results: int = 5  # results pulled per search call

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
