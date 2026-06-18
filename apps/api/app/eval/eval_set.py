"""Offline evaluation sets for the resource retrieval engine.

Each query carries the URLs we consider *relevant* (graded as 1). Kept small and
hand-labeled — the point is a reproducible regression harness for rerank quality,
not a benchmark. Grow N over time as the library grows.

`EVAL_SETS` is keyed by target orientation: `base` is the generalist surface;
each orientation adds its own focused surface (the "评测面 ×N"). We deliberately
ship `base` + ONE orientation (`rag`) first to get the pipeline + a baseline
green, rather than forking all three at once.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain import competency


@dataclass(frozen=True)
class EvalQuery:
    query: str
    skill_id: str
    target_level: int
    relevant_urls: frozenset[str] = field(default_factory=frozenset)


# Generalist surface (orientation = base). Unchanged from the original set.
EVAL_SET_BASE: list[EvalQuery] = [
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

# RAG-oriented surface (orientation = rag): the data/retrieval pipeline at the
# orientation's *raised* target levels (vector_search L4, retrieval_rerank/chunking
# L3), plus the eval rigour a retrieval system needs. Mirrors the rag modifier in
# competency.py so a reweight/min_level regression in that orientation surfaces here.
EVAL_SET_RAG: list[EvalQuery] = [
    EvalQuery(
        query="pgvector HNSW 索引 ef 参数调优 高召回",
        skill_id="data.vector_search",
        target_level=4,
        relevant_urls=frozenset(
            {
                "https://github.com/pgvector/pgvector",
                "https://www.pinecone.io/learn/series/faiss/hnsw/",
            }
        ),
    ),
    EvalQuery(
        query="RAG 召回与重排 rerank 工程实践",
        skill_id="data.retrieval_rerank",
        target_level=3,
        relevant_urls=frozenset(
            {"https://www.pinecone.io/learn/retrieval-augmented-generation/"}
        ),
    ),
    EvalQuery(
        query="文档切分 chunking 策略对召回质量的影响",
        skill_id="data.chunking",
        target_level=3,
        relevant_urls=frozenset(
            {
                "https://www.llamaindex.ai/blog/chunking-strategies",
                "https://www.pinecone.io/learn/retrieval-augmented-generation/",
            }
        ),
    ),
    EvalQuery(
        query="embedding 模型选型 维度 成本 检索效果",
        skill_id="data.embedding",
        target_level=2,
        relevant_urls=frozenset({"https://platform.openai.com/docs/guides/embeddings"}),
    ),
    EvalQuery(
        query="RAG 检索质量评测 指标 准确 覆盖 幻觉",
        skill_id="eval.metrics",
        target_level=2,
        relevant_urls=frozenset({"https://hamel.dev/blog/posts/evals/"}),
    ),
]


EVAL_SETS: dict[str, list[EvalQuery]] = {
    competency.ORIENTATION_BASE: EVAL_SET_BASE,
    competency.ORIENTATION_RAG: EVAL_SET_RAG,
}

# Back-compat alias: existing callers/imports of EVAL_SET get the base surface.
EVAL_SET: list[EvalQuery] = EVAL_SET_BASE


def eval_set_for(orientation_id: str | None) -> list[EvalQuery]:
    return EVAL_SETS.get(orientation_id or competency.ORIENTATION_BASE, EVAL_SET_BASE)
