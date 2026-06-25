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

    # Data files: default to bundled demos; override with env vars for
    # production versions with calibrated data (never committed to git).
    skill_graph_path: str = "app/data/skill_graph.demo.json"
    path_config_path: str = "app/data/path_config.demo.json"

    # Decision engine scoring weights (env-injectable, not in source)
    decision_w_gap: float = 0.34
    decision_w_dependency: float = 0.33
    decision_w_learnability: float = 0.33
    decision_blocked_penalty: float = 0.6
    decision_strength_level: int = 3
    decision_transfer_level: int = 2
    decision_transfer_learnability: float = 0.65

    # Questionnaire orchestrator
    max_questions: int = 18
    uncertainty_threshold: float = 0.2

    # Resource engine (RAG retrieval + multi-signal rerank)
    retrieval_top_k: int = 20
    resources_per_step: int = 3
    # Rerank weights (env-injectable; defaults are balanced demo values)
    rerank_w_relevance: float = 0.5
    rerank_w_freshness: float = 0.3
    rerank_w_fit: float = 0.2
    # A resource is "stale" once unverified for longer than this.
    freshness_ttl_days: int = 90

    # Curation agent (function-calling tool chain)
    agent_max_steps: int = 8  # safety cap on the tool loop
    agent_search_results: int = 5  # results pulled per search call

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
