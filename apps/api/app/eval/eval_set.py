"""Offline evaluation set for the resource retrieval engine.

Each query carries the URLs we consider *relevant* (graded as 1). Kept small and
hand-labeled — the point is a reproducible regression harness for rerank quality,
not a benchmark. Grow N over time as the library grows.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class EvalQuery:
    query: str
    skill_id: str
    target_level: int
    relevant_urls: frozenset[str] = field(default_factory=frozenset)


EVAL_SET: list[EvalQuery] = [
    EvalQuery(
        query="pgvector 向量检索 HNSW 索引怎么用",
        skill_id="data.vector_search",
        target_level=3,
        relevant_urls=frozenset(
            {
                "https://github.com/pgvector/pgvector",
                "https://www.pinecone.io/learn/series/faiss/hnsw/",
            }
        ),
    ),
    EvalQuery(
        query="embedding 模型选型与维度成本",
        skill_id="data.embedding",
        target_level=2,
        relevant_urls=frozenset({"https://platform.openai.com/docs/guides/embeddings"}),
    ),
    EvalQuery(
        query="RAG 召回与重排实践",
        skill_id="data.retrieval_rerank",
        target_level=2,
        relevant_urls=frozenset(
            {"https://www.pinecone.io/learn/retrieval-augmented-generation/"}
        ),
    ),
    EvalQuery(
        query="文档切分 chunking 策略对比",
        skill_id="data.chunking",
        target_level=2,
        relevant_urls=frozenset(
            {
                "https://www.llamaindex.ai/blog/chunking-strategies",
                "https://www.pinecone.io/learn/retrieval-augmented-generation/",
            }
        ),
    ),
    EvalQuery(
        query="function calling 工具调用闭环",
        skill_id="llm.function_calling",
        target_level=2,
        relevant_urls=frozenset(
            {"https://platform.openai.com/docs/guides/function-calling"}
        ),
    ),
    EvalQuery(
        query="结构化输出 json schema 约束",
        skill_id="llm.structured_output",
        target_level=3,
        relevant_urls=frozenset(
            {"https://platform.openai.com/docs/guides/structured-outputs"}
        ),
    ),
    EvalQuery(
        query="多工具编排 agent 设计模式",
        skill_id="llm.tool_use",
        target_level=3,
        relevant_urls=frozenset(
            {"https://www.anthropic.com/research/building-effective-agents"}
        ),
    ),
    EvalQuery(
        query="离线评测集与指标构建",
        skill_id="eval.offline",
        target_level=2,
        relevant_urls=frozenset({"https://hamel.dev/blog/posts/evals/"}),
    ),
]
