"""Build the multi-source skill-evidence ledger.

Why this exists
---------------
anygen's A (gap precision/recall) and B (ranking nDCG) both need a *ground signal*
for "which skills the market actually asks for". We do NOT hand-label that at the
item level — we derive it from real source text with **auditable, weighted labeling
functions** and aggregate them with provenance.

The ledger is deliberately multi-source from day one, because a single JD corpus is
a biased signal (JDs are often vague). Each source is a labeling function with a
human-curated, version-controlled `trust` weight; a skill accrues evidence from
every source that mentions it, stamped with where it came from:

    evidence(skill)      := list of per-source contributions (source_id, signal, freq)
    grounded(skill)      := at least one source mentions it
    evidence_score(skill):= Σ trust(source) · frequency(source)   # weighted, multi-source

This stays on-brand for Zeno: the "market need" signal is a transparent function of
real text + a reviewable trust table, not a vibe. Adding a source later (a curated
article corpus, an embedding-similarity LF, an LLM extractor) means registering one
more `run_*` function below — the decision kernel and its readers do not change.

Source #1 (this version): deterministic keyword substring match over the market_source
JD spreadsheet — a lossless port of the original builder, now as a weighted source.

Run:
    cd apps/api && python -m scripts.build_jd_evidence
Emits: app/data/jd_evidence.json
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

_API_ROOT = Path(__file__).resolve().parent.parent
_XLSX = _API_ROOT / "app" / "data" / "raw" / "market_source_ai_jobs.xlsx"
_OUT = _API_ROOT / "app" / "data" / "jd_evidence.json"

SCHEMA_VERSION = 2


@dataclass(frozen=True)
class Source:
    """A labeling function over some corpus, with a human-curated trust weight.

    `trust` is the one piece of human judgement this design needs at scale: it is
    set ONCE per source (not per item) and lives in version control, so every change
    is a reviewable diff — same discipline as the keyword table itself.
    """

    source_id: str
    source_type: str  # "jd" | "article" | ...
    signal: str  # "keyword" | "embedding" | "llm_extract"
    trust: float  # source-level weight in [0, 1]


# --- Source registry -------------------------------------------------------
# The curated trust table. Adding a row here (plus its run_* function) is how the
# ledger grows to more information sources without touching the decision kernel.
JD_KEYWORD_SOURCE = Source(
    source_id="market_source/ai_jobs.xlsx",
    source_type="jd",
    signal="keyword",
    trust=0.6,  # JDs are real but noisy/vague — moderate trust by design.
)

# Deterministic skill -> keyword table. Matching is case-insensitive substring on
# the concatenated 职位描述 + 职位要求. Keep this table in version control: it IS
# the labeling function, and every change is reviewable in a diff.
SKILL_KEYWORDS: dict[str, list[str]] = {
    "eng.api_design": ["api", "接口", "restful", "契约", "framework", "框架", "sdk"],
    "eng.auth": ["鉴权", "认证", "权限", "oauth", "安全基线", "登录态"],
    "eng.error_handling": ["错误处理", "异常", "重试", "容错", "稳定性", "降级"],
    "eng.observability": ["可观测", "日志", "监控", "trace", "埋点", "指标采集", "telemetry"],
    "eng.deploy": ["部署", "ci/cd", "持续集成", "容器", "docker", "k8s", "kubernetes", "上线", "发布"],
    "eng.typescript": ["typescript", "ts ", "前端", "react", "node", "web", "javascript", "工程化", "lynx", "跨端"],
    "data.text_processing": ["文本清洗", "数据清洗", "预处理", "nlp", "文本处理", "语料"],
    "data.chunking": ["切分", "chunk", "分块", "chunking"],
    "data.embedding": ["embedding", "向量化", "向量", "嵌入", "表征"],
    "data.vector_search": ["向量检索", "pgvector", "hnsw", "向量数据库", "faiss", "milvus", "相似检索", "近邻检索"],
    "data.retrieval_rerank": ["召回", "重排", "rerank", "retrieval", "rag", "检索增强", "知识工程", "知识库"],
    "data.quality": ["数据质量", "去重", "数据治理", "脏数据"],
    "llm.prompt": ["prompt", "提示词", "提示工程", "prompt enginering", "prompt engineering"],
    "llm.structured_output": ["结构化输出", "json schema", "结构化", "schema 约束"],
    "llm.function_calling": ["function calling", "函数调用", "工具调用", "tool calling", "tool call"],
    "llm.tool_use": ["agent", "智能体", "工具编排", "多工具", "mcp", "工作流编排"],
    "llm.agent_state": ["memory", "记忆", "agent 状态", "长期记忆", "上下文管理"],
    "llm.cost_latency": ["成本", "延迟", "性能优化", "latency", "推理优化", "吞吐"],
    "llm.streaming": ["流式", "streaming", "sse", "流式输出"],
    "llm.core": ["llm", "大模型", "多模态", "aigc", "大语言模型", "生成式"],  # umbrella term, not a graph skill
    "eval.offline": ["离线评估", "评测集", "evaluation", "评估集", "benchmark"],
    "eval.online": ["在线反馈", "线上评估", "在线评估", "反馈采集"],
    "eval.ab": ["a/b", "ab 实验", "abtest", "a/b 实验", "对照实验"],
    "eval.metrics": ["指标", "准确率", "幻觉", "召回率", "badcase", "质量指标", "评估指标"],
}

# `llm.core` is an umbrella keyword bucket (LLM/大模型/多模态) that is NOT a node in
# skill_graph.json. We keep its count for context but exclude it from the graph-
# aligned evidence emitted for the eval (which can only reference real skills).
_NON_GRAPH = {"llm.core"}

# A single skill's contribution from one source.
Contribution = dict[str, float]  # {doc_count, doc_total, frequency}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).lower()


def run_jd_keyword_source() -> tuple[Source, dict[str, Contribution]]:
    """Source #1 — deterministic keyword substring match over the JD spreadsheet.

    Lossless port of the original builder: same numbers, now emitted as a single
    registered, weighted source rather than the whole ledger.
    """
    import pandas as pd  # local import: only the live corpus pass needs pandas

    df = pd.read_excel(_XLSX)
    docs: list[str] = []
    for _, row in df.iterrows():
        blob = " ".join(
            _norm(row.get(col, "")) for col in ("职位名称", "职位描述", "职位要求")
        )
        docs.append(blob)

    n = len(docs)
    contribs: dict[str, Contribution] = {}
    for skill_id, kws in SKILL_KEYWORDS.items():
        hits = sum(1 for doc in docs if any(kw in doc for kw in kws))
        contribs[skill_id] = {
            "doc_count": hits,
            "doc_total": n,
            "frequency": round(hits / n, 4) if n else 0.0,
        }
    return JD_KEYWORD_SOURCE, contribs


def aggregate(runs: list[tuple[Source, dict[str, Contribution]]]) -> dict:
    """Merge per-source contributions into the per-skill evidence ledger.

    For each skill we keep:
      * a provenance list (`evidence`): one entry per source that *matched* it,
        stamped with source_id / signal / trust / frequency — this is what makes
        "why is this skill weighted up" auditable and diff-able;
      * backward-compatible aggregates the readers rely on (`jd_count`,
        `frequency`, `in_graph`) plus `grounded` (any source matched);
      * `evidence_score`: the weighted multi-source signal Σ trust·frequency,
        provided for a future scorer — it is NOT wired into the decision kernel
        here, so the deterministic ordering is unchanged.
    """
    skill_ids = sorted({sid for _, contribs in runs for sid in contribs})
    skills: dict[str, dict] = {}
    for sid in skill_ids:
        provenance: list[dict] = []
        for src, contribs in runs:
            c = contribs.get(sid)
            if not c or c["doc_count"] <= 0:
                continue  # record only sources that actually mention the skill
            provenance.append(
                {
                    "source_id": src.source_id,
                    "source_type": src.source_type,
                    "signal": src.signal,
                    "trust": src.trust,
                    "doc_count": c["doc_count"],
                    "doc_total": c["doc_total"],
                    "frequency": c["frequency"],
                }
            )

        jd_prov = [p for p in provenance if p["source_type"] == "jd"]
        skills[sid] = {
            # backward-compatible aggregates (explain.py / jd_grounding.py read these)
            "jd_count": sum(p["doc_count"] for p in jd_prov),
            "frequency": round(max((p["frequency"] for p in jd_prov), default=0.0), 4),
            "grounded": len(provenance) > 0,
            "in_graph": sid not in _NON_GRAPH,
            # weighted multi-source signal — future scorer use, not wired to kernel
            "evidence_score": round(
                sum(p["trust"] * p["frequency"] for p in provenance), 4
            ),
            # provenance: every source that contributed positive evidence
            "evidence": provenance,
        }
    return skills


def assemble(runs: list[tuple[Source, dict[str, Contribution]]]) -> dict:
    """Assemble the full top-level ledger from a set of source runs.

    Split out from `build` so the same code path produces the file regardless of
    how the contributions were obtained (live corpus pass, or a migration that
    reconstructs contributions from a prior ledger) — guaranteeing one schema.
    """
    skills = aggregate(runs)

    sources_meta = [
        {
            "source_id": s.source_id,
            "source_type": s.source_type,
            "signal": s.signal,
            "trust": s.trust,
        }
        for s, _ in runs
    ]

    # JD corpus size — kept at top level for back-compat (explain.py reads n_jds).
    n_jds = 0
    for s, contribs in runs:
        if s.source_type == "jd" and contribs:
            n_jds = int(next(iter(contribs.values()))["doc_total"])
            break

    return {
        "schema_version": SCHEMA_VERSION,
        "n_jds": n_jds,
        "method": (
            "multi-source weak-label ledger; each skill accrues weighted, "
            "source-stamped evidence (see scripts/build_jd_evidence.py)"
        ),
        "sources": sources_meta,
        "skills": skills,
    }


def build() -> dict:
    return assemble([run_jd_keyword_source()])


def main() -> None:
    data = build()
    _OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {_OUT.relative_to(_API_ROOT)}  (schema v{data['schema_version']}, N={data['n_jds']} JDs)")
    print(f"Sources: {', '.join(s['source_id'] + ' [' + s['signal'] + ']' for s in data['sources'])}")
    ranked = sorted(
        ((s, d["frequency"]) for s, d in data["skills"].items() if d["in_graph"]),
        key=lambda x: x[1],
        reverse=True,
    )
    print("Top JD-demanded graph skills (freq = % of JDs mentioning it):")
    for sid, freq in ranked[:12]:
        print(f"  {freq:5.0%}  {sid}")


if __name__ == "__main__":
    main()
