"""Curated seed resources + a discoverable candidate pool.

`SEED_RESOURCES` are hand-picked, high-quality references loaded at bootstrap.
`CANDIDATE_POOL` simulates the open web for the curation agent's offline
`search` tool, so the full search -> fetch -> summarize -> store -> verify loop
runs end-to-end without network access (deterministic tests & local dev).
"""

from __future__ import annotations

# Each item: title, url, skill_ids, platform, resource_type, target_level, summary
SEED_RESOURCES: list[dict] = [
    {
        "title": "pgvector 官方文档：索引与相似度检索",
        "url": "https://github.com/pgvector/pgvector",
        "skill_ids": ["data.vector_search"],
        "platform": "GitHub",
        "resource_type": "doc",
        "target_level": 3,
        "summary": "pgvector 的安装、HNSW/IVFFlat 索引、cosine/L2 距离算子与查询写法。",
    },
    {
        "title": "OpenAI Embeddings 指南",
        "url": "https://platform.openai.com/docs/guides/embeddings",
        "skill_ids": ["data.embedding"],
        "platform": "官方文档",
        "resource_type": "doc",
        "target_level": 2,
        "summary": "text-embedding-3 系列模型的维度、成本与使用方式，含相似度检索示例。",
    },
    {
        "title": "RAG 检索增强生成综述与工程实践",
        "url": "https://www.pinecone.io/learn/retrieval-augmented-generation/",
        "skill_ids": ["data.retrieval_rerank", "data.chunking"],
        "platform": "Pinecone",
        "resource_type": "article",
        "target_level": 2,
        "summary": "RAG 端到端流程：chunking、召回、重排与评估的工程取舍。",
    },
    {
        "title": "OpenAI Function Calling 文档",
        "url": "https://platform.openai.com/docs/guides/function-calling",
        "skill_ids": ["llm.function_calling", "llm.tool_use"],
        "platform": "官方文档",
        "resource_type": "doc",
        "target_level": 2,
        "summary": "工具/函数调用的定义、参数 schema、并行调用与结果回灌的闭环。",
    },
    {
        "title": "结构化输出与 JSON Schema 约束",
        "url": "https://platform.openai.com/docs/guides/structured-outputs",
        "skill_ids": ["llm.structured_output"],
        "platform": "官方文档",
        "resource_type": "doc",
        "target_level": 3,
        "summary": "强制模型输出符合 schema 的 JSON，并做校验与失败回退。",
    },
]

# Extra resources the agent can "discover" via its search tool (offline corpus).
CANDIDATE_POOL: list[dict] = SEED_RESOURCES + [
    {
        "title": "HNSW 近邻检索算法详解",
        "url": "https://www.pinecone.io/learn/series/faiss/hnsw/",
        "skill_ids": ["data.vector_search"],
        "platform": "Pinecone",
        "resource_type": "article",
        "target_level": 3,
        "summary": "HNSW 图索引原理、ef/M 参数对召回与延迟的影响。",
    },
    {
        "title": "Chunking 策略对比与实战",
        "url": "https://www.llamaindex.ai/blog/chunking-strategies",
        "skill_ids": ["data.chunking"],
        "platform": "LlamaIndex",
        "resource_type": "article",
        "target_level": 2,
        "summary": "固定窗口/语义/递归切分的对比，及对召回质量的影响。",
    },
    {
        "title": "Building Effective Agents（Anthropic）",
        "url": "https://www.anthropic.com/research/building-effective-agents",
        "skill_ids": ["llm.tool_use", "llm.agent_state"],
        "platform": "Anthropic",
        "resource_type": "article",
        "target_level": 3,
        "summary": "工具编排、工作流 vs agent、可靠性与失败处理的设计模式。",
    },
    {
        "title": "评估 LLM 应用：离线评测集与指标",
        "url": "https://hamel.dev/blog/posts/evals/",
        "skill_ids": ["eval.offline", "eval.metrics"],
        "platform": "Blog",
        "resource_type": "article",
        "target_level": 2,
        "summary": "如何构建评测集、定义指标（准确/覆盖/幻觉率）并驱动迭代。",
    },
    {
        "title": "FastAPI 官方教程",
        "url": "https://fastapi.tiangolo.com/tutorial/",
        "skill_ids": ["eng.api_design"],
        "platform": "官方文档",
        "resource_type": "doc",
        "target_level": 3,
        "summary": "依赖注入、Pydantic 校验、错误处理与接口契约设计。",
    },
    # A deliberately broken link, to exercise the freshness verifier.
    {
        "title": "（已下线）旧版向量检索教程",
        "url": "https://example.com/deprecated/vector-search-404",
        "skill_ids": ["data.vector_search"],
        "platform": "Blog",
        "resource_type": "article",
        "target_level": 1,
        "summary": "过时内容，用于验证保鲜校验能识别失效链接。",
    },
]
