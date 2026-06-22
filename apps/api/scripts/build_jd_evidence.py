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

Source #1 (this version): deterministic keyword substring match over the bytedance
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
_RAW_DIR = _API_ROOT / "app" / "data" / "raw"
_XLSX = _RAW_DIR / "bytedance_ai_jobs.xlsx"
_OUT = _API_ROOT / "app" / "data" / "jd_evidence.json"

# Default trust/date for JSONL sources when manifest.json is absent or incomplete.
_DEFAULT_JD_TRUST = 0.65
_DEFAULT_COLLECTED_AT = "2026-01-01"

SCHEMA_VERSION = 2


@dataclass(frozen=True)
class Source:
    """A labeling function over some corpus, with a human-curated trust weight.

    `trust` is the one piece of human judgement this design needs at scale: it is
    set ONCE per source (not per item) and lives in version control, so every change
    is a reviewable diff — same discipline as the keyword table itself.
    """

    source_id: str
    source_type: str  # "jd" | "article" | ...  (COARSE — H/refresh bucket on this)
    signal: str  # "keyword" | "embedding" | "llm_extract"
    trust: float  # source-level weight in [0, 1]
    # Time-awareness (Step 1). `collected_at` is the Δt anchor for the future
    # time-decay layer: ISO date (YYYY-MM-DD) the corpus was harvested. It is
    # required so every new source is forced to declare its age. `published_at`
    # is the original publish date when a source actually has one (articles,
    # course updates, repo releases); for JDs it stays None — collected_at is the
    # only reliable, uniform anchor for this batch (see docs decision §9 ⑤).
    # For `article` sources the decay layer should PREFER `published_at` as the Δt
    # anchor and fall back to `collected_at` only when it is missing.
    collected_at: str
    published_at: str | None = None
    # Health-score metadata (see docs/article-sources.md §1). `provider` is the
    # fine-grained site/provider label (e.g. "openai.com/blog", "juejin.cn"). It is
    # deliberately NOT a bucketing key: H and refresh_period bucket by `source_type`
    # only — sub-bucketing is deferred while per-site frequency is still sparse.
    provider: str = ""
    # May this source seed weak-gold alignment anchors? Structured/official sources
    # (official blogs, GitHub docs) → True; fragmentary sources (社区短文/小红书) → False.
    weak_gold_anchor: bool = False


# --- Source registry -------------------------------------------------------
# The curated trust table. Adding a row here (plus its run_* function) is how the
# ledger grows to more information sources without touching the decision kernel.
JD_KEYWORD_SOURCE = Source(
    source_id="bytedance/ai_jobs.xlsx",
    source_type="jd",
    signal="keyword",
    trust=0.6,  # JDs are real but noisy/vague — moderate trust by design.
    collected_at="2026-01-22",  # harvest date of this bytedance JD snapshot
    # published_at left None: JDs carry no reliable, uniform publish date.
)

# Source #2 (skeleton) — curated `article` corpus. Per docs/article-sources.md the
# FIRST batch concentrates 5k token on high-trust, value-retaining sources (official
# engineering blogs + GitHub docs); community/fragmentary sources are skipped or
# lightly sampled this round. `source_type` stays the COARSE "article" — the site is
# carried in `provider` (health-score metadata, not a bucketing key). Official/GitHub
# sources are flagged `weak_gold_anchor=True` (structured enough to seed gold anchors);
# trust starts at 0.7 (above JD's 0.6 but not dominating it), to be recalibrated on
# backtest — same "no hand-cranked high values" discipline as H.
ARTICLE_SOURCES: list[Source] = [
    Source(
        source_id="article/openai_engineering_blog",
        source_type="article",
        signal="llm_extract",
        trust=0.7,
        collected_at="2026-06-22",
        provider="openai.com/blog",
        weak_gold_anchor=True,
    ),
    Source(
        source_id="article/anthropic_blog",
        source_type="article",
        signal="llm_extract",
        trust=0.7,
        collected_at="2026-06-22",
        provider="anthropic.com/news",
        weak_gold_anchor=True,
    ),
    Source(
        source_id="article/github_docs",
        source_type="article",
        signal="llm_extract",
        trust=0.7,
        collected_at="2026-06-22",
        provider="github.com",
        weak_gold_anchor=True,
    ),
]

# Deterministic skill -> keyword table. Matching is case-insensitive substring on
# the concatenated 职位描述 + 职位要求. Keep this table in version control: it IS
# the labeling function, and every change is reviewable in a diff.
SKILL_KEYWORDS: dict[str, list[str]] = {
    "eng.api_design": ["api", "接口", "restful", "契约", "framework", "框架", "sdk"],
    "eng.auth": ["鉴权", "认证", "权限", "oauth", "安全基线", "登录态"],
    "eng.error_handling": ["错误处理", "异常", "重试", "容错", "稳定性", "降级"],
    "eng.observability": ["可观测", "日志", "监控", "trace", "埋点", "指标采集", "telemetry"],
    # recall-hole fix (2026-06-22, open-vocab probe): serverless/vercel/cloudflare are
    # deployment targets that landed in the residual only because they were unlisted —
    # they belong to eng.deploy, NOT a missing graph node. See docs decision §coverage-probe.
    "eng.deploy": ["部署", "ci/cd", "持续集成", "容器", "docker", "k8s", "kubernetes", "上线", "发布", "serverless", "vercel", "cloudflare"],
    # recall-hole fix (2026-06-22, open-vocab probe): css/html/es6/vue/angular are core
    # frontend-web tech that map to eng.typescript; they surfaced as residual only because
    # the table previously listed only typescript/react/node/web. ("dom" intentionally
    # NOT added — bare substring collides with 域名/domain/random and would over-count.)
    "eng.typescript": ["typescript", "ts ", "前端", "react", "node", "web", "javascript", "工程化", "lynx", "跨端", "css", "html", "es6", "vue", "angular"],
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

    Legacy source: the xlsx file has been migrated to jd_documents DB table.
    If the file no longer exists on disk, this source is skipped gracefully.
    """
    if not _XLSX.exists():
        print(f"  [skip] {_XLSX.name} not found (migrated to DB)")
        return JD_KEYWORD_SOURCE, {}

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


# --- JD classification: filter engineering roles from product/algorithm/support ---
# Title-based rules; description is NOT filtered (per README §4.1).
_EXCLUDE_IDS: set[str] = set()  # populated at runtime if needed

_PRODUCT_KEYWORDS = [
    "产品经理", "产品运营", "运营专家", "策略运营", "产品负责人",
    "产品专家", "战略合作", "设计师", "产品工程师",
]
_ALGO_KEYWORDS = [
    "算法研究", "researcher", "预训练", "模型训练", "nlp算法",
    "训练工程师", "推理算子优化", "推理工程师",
    "vlm/aigc训练", "llm/vlm/aigc训练", "llm/vlm/aigc推理",
]


def _classify_jd(title: str) -> str:
    """Classify a JD by title into: engineering | product | algorithm | support."""
    t = title.lower()
    for kw in _ALGO_KEYWORDS:
        if kw in t:
            return "algorithm"
    for kw in _PRODUCT_KEYWORDS:
        if kw in t:
            return "product"
    if "运营" in t and not re.search(r"工程师|开发|架构", t):
        return "product"
    if "评测运营" in t or "数据运营" in t:
        return "product"
    if "技术支持" in t:
        return "support"
    return "engineering"


# IDs to hard-exclude (manual review 2026-06-22):
# - official_7615128609917143349: 法务AI应用专家 (non-technical)
# - official_*: 网管平台运维产品经理 (noise, not AI)
# - official_*: AI芯片测试 (hardware, not application)
_HARD_EXCLUDE_TITLES = ["法务ai应用专家", "网管平台运维产品经理", "高级测试开发工程师-ai芯片"]


def discover_jd_sources() -> list[tuple[Path, Source]]:
    """Auto-discover JSONL JD sources under raw/.

    Convention: any subdirectory of raw/ containing a `jds.jsonl` file is a JD
    source. Source metadata (trust, collected_at) is read from `manifest.json`
    in the same directory; missing fields fall back to safe defaults.

    This means adding a new JD dump is: mkdir, drop jds.jsonl + manifest.json,
    re-run build — zero code changes.
    """
    found: list[tuple[Path, Source]] = []
    for jsonl_path in sorted(_RAW_DIR.glob("*/jds.jsonl")):
        dir_path = jsonl_path.parent
        source_id = f"jd/{dir_path.name}"
        manifest_path = dir_path / "manifest.json"

        trust = _DEFAULT_JD_TRUST
        collected_at = _DEFAULT_COLLECTED_AT
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            trust = manifest.get("trust", trust)
            # collected_at: prefer explicit field, else first date in range
            collected_at = manifest.get(
                "collected_at",
                (manifest.get("collected_at_range") or [collected_at])[0],
            )

        src = Source(
            source_id=source_id,
            source_type="jd",
            signal="keyword",
            trust=trust,
            collected_at=collected_at,
        )
        found.append((dir_path, src))
    return found


def run_jd_jsonl_source(
    dir_path: Path, source: Source
) -> tuple[Source, dict[str, Contribution]]:
    """Generic JSONL JD source — deterministic keyword match with role filtering.

    Only engineering-classified JDs are fed into the keyword LF.
    Product/algorithm/support roles are excluded from frequency calculation
    but preserved in the raw JSONL for future use.
    """
    jsonl_path = dir_path / "jds.jsonl"
    docs: list[str] = []
    skipped = {"product": 0, "algorithm": 0, "support": 0, "hard_exclude": 0}
    for line in jsonl_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        title = obj.get("title", "")
        if title.lower() in _HARD_EXCLUDE_TITLES:
            skipped["hard_exclude"] += 1
            continue
        cat = _classify_jd(title)
        if cat != "engineering":
            skipped[cat] += 1
            continue
        blob = " ".join(
            _norm(obj.get(f, "")) for f in ("title", "description", "requirements")
        )
        docs.append(blob)

    print(f"  [{source.source_id}] {len(docs)} engineering JDs loaded, skipped: {dict(skipped)}")

    n = len(docs)
    contribs: dict[str, Contribution] = {}
    for skill_id, kws in SKILL_KEYWORDS.items():
        hits = sum(1 for doc in docs if any(kw in doc for kw in kws))
        contribs[skill_id] = {
            "doc_count": hits,
            "doc_total": n,
            "frequency": round(hits / n, 4) if n else 0.0,
        }
    return source, contribs


def run_article_source(source: Source) -> tuple[Source, dict[str, Contribution]]:
    """Source #2 (skeleton) — curated article corpus as a weighted labeling function.

    SCHEMA-ONLY for now: it registers the source and emits the same
    `dict[skill_id -> Contribution]` shape as the JD source, but with NO
    contributions yet. That makes the article source flow end-to-end through
    `aggregate`/`assemble` (provenance, sources_meta, evidence_score) without
    spending any token, so we can validate the schema before extraction is wired.

    Wiring plan (the actual token spend, next step):
      1. fetch the article texts for `source.provider` (curation agent / fetch tool);
      2. extract per-skill signals (LLM `llm_extract`, or a keyword LF as a cheap
         first pass), producing `doc_count / doc_total / frequency` per skill —
         identical Contribution shape, so `aggregate` needs no change;
      3. Δt anchor for the decay layer PREFERS `source.published_at`, falling back to
         `collected_at` only when the article carries no reliable publish date.

    Because contributions are empty, `aggregate` records this source in
    `sources` meta but adds it to no skill's provenance — a clean no-op on scores.
    """
    contribs: dict[str, Contribution] = {}  # TODO(step-next): fill via fetch + extract
    return source, contribs


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
            "collected_at": s.collected_at,
            "published_at": s.published_at,
            "provider": s.provider,
            "weak_gold_anchor": s.weak_gold_anchor,
        }
        for s, _ in runs
    ]

    # JD corpus size — sum across all JD sources for back-compat (explain.py reads n_jds).
    n_jds = 0
    for s, contribs in runs:
        if s.source_type == "jd" and contribs:
            n_jds += int(next(iter(contribs.values()))["doc_total"])

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


def build(include_article_skeleton: bool = False) -> dict:
    """Assemble the ledger. Default = JD source only, so the committed
    jd_evidence.json is byte-for-byte unchanged. Pass include_article_skeleton=True
    (or `python -m scripts.build_jd_evidence --with-article-skeleton`) to also flow
    the registered article sources through the schema (no token spend yet).
    """
    runs = [run_jd_keyword_source()]
    # Auto-discover all JSONL JD sources under raw/*/jds.jsonl
    for dir_path, src in discover_jd_sources():
        runs.append(run_jd_jsonl_source(dir_path, src))
    if include_article_skeleton:
        runs += [run_article_source(s) for s in ARTICLE_SOURCES]
    return assemble(runs)


def main() -> None:
    import sys

    include_article = "--with-article-skeleton" in sys.argv[1:]
    data = build(include_article_skeleton=include_article)
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
