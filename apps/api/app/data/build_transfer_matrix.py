"""Build the source-role skill profiles and the capability-transfer matrix.

Fills the missing HALF of Zeno's transfer equation: the existing jd_evidence.json
aggregates ALL JDs into a single *target* skill-need signal, but never measures what
a typical frontend / backend / fullstack engineer ALREADY HAS. We derive that source
profile from the 1757 role-split 51job JDs using the SAME keyword table as
scripts/build_jd_evidence.py (kept in sync — single source of truth for labeling).

Output:
  - source_profiles.json   : per source-role, prevalence of each graph skill
  - transfer_matrix.json   : per (source-role -> AI target), 4-way classification
Run: python3 build_transfer_matrix.py
"""
from __future__ import annotations
import json, collections
from pathlib import Path

DATA = Path(__file__).resolve().parent
JD_51 = DATA / "raw" / "jd_51job_2026h1" / "jds.jsonl"
GRAPH = DATA / "skill_graph.json"

# --- ported verbatim from scripts/build_jd_evidence.py (keep in sync) ---------
SKILL_KEYWORDS: dict[str, list[str]] = {
    "eng.api_design": ["api", "接口", "restful", "契约", "framework", "框架", "sdk"],
    "eng.auth": ["鉴权", "认证", "权限", "oauth", "安全基线", "登录态"],
    "eng.error_handling": ["错误处理", "异常", "重试", "容错", "稳定性", "降级"],
    "eng.observability": ["可观测", "日志", "监控", "trace", "埋点", "指标采集", "telemetry"],
    "eng.deploy": ["部署", "ci/cd", "持续集成", "容器", "docker", "k8s", "kubernetes", "上线", "发布", "serverless", "vercel", "cloudflare"],
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
    "eval.offline": ["离线评估", "评测集", "evaluation", "评估集", "benchmark"],
    "eval.online": ["在线反馈", "线上评估", "在线评估", "反馈采集"],
    "eval.ab": ["a/b", "ab 实验", "abtest", "a/b 实验", "对照实验"],
    "eval.metrics": ["指标", "准确率", "幻觉", "召回率", "badcase", "质量指标", "评估指标"],
}

# Prevalence thresholds -> source-role "ownership" of a skill.
T_HAVE, T_FAST, T_PARTIAL = 0.50, 0.15, 0.03


def jd_text(d: dict) -> str:
    return f"{d.get('title','')}\n{d.get('description','')}\n{d.get('requirements','')}".lower()


def build_source_profiles():
    by_role_docs = collections.Counter()
    by_role_hits = collections.defaultdict(lambda: collections.Counter())
    for line in open(JD_51, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        d = json.loads(line)
        role = d.get("role", "?")
        by_role_docs[role] += 1
        text = jd_text(d)
        for skill, kws in SKILL_KEYWORDS.items():
            if any(kw in text for kw in kws):
                by_role_hits[role][skill] += 1
    profiles = {}
    for role, total in by_role_docs.items():
        profiles[role] = {
            "n_jds": total,
            "prevalence": {s: round(by_role_hits[role][s] / total, 4) for s in SKILL_KEYWORDS},
        }
    return profiles


def classify(prev: float) -> str:
    if prev >= T_HAVE:
        return "已具备"
    if prev >= T_FAST:
        return "快速迁移"
    if prev >= T_PARTIAL:
        return "部分迁移"
    return "真缺口"


def fulfillment_mode(cls: str, layer: str) -> str:
    """How a gap should be CLOSED — the core 'leverage path' decision.

    Key product idea: most 'gaps' don't need deep study. L2 (AI 应用能力) can be met
    by wielding AI / bolting a feature onto an existing project; only L3 (AI 系统控制)
    is real judgment that AI can't fake — that's where to actually invest learning.
    """
    if cls in ("已具备", "快速迁移"):
        return "已覆盖-剔除"           # never put in the learning path (fixes the TS bug)
    if cls == "部分迁移":
        return "轻量补全"
    # 真缺口 —— branch by layer
    if layer in ("L0", "L1"):
        return "补地基"
    if layer == "L2":
        return "AI杠杆-现有项目加特性"   # cheap, do it now, generates evidence
    return "深学-护城河"                # L3: eval/agent-state/AB — AI can't do this for you


def build_transfer_matrix(profiles, graph):
    skills = {s["id"]: s for s in graph["skills"]}
    reqs = {r["skill_id"]: r for r in graph["role_requirements"]}
    matrix = {}
    for role, prof in profiles.items():
        rows = []
        for skill_id, req in reqs.items():
            sk = skills.get(skill_id, {})
            prev = prof["prevalence"].get(skill_id, 0.0)
            cls = classify(prev)
            layer = sk.get("layer")
            weight = req.get("weight", 0.0)
            # gap priority = how much the target wants it x how far the source is from it
            gap_priority = round(weight * (1 - min(prev / T_HAVE, 1.0)), 4)
            rows.append({
                "skill_id": skill_id,
                "name": sk.get("name", skill_id),
                "layer": layer,
                "target_weight": weight,
                "req_type": req.get("type"),
                "source_prevalence": prev,
                "classification": cls,
                "learnability": sk.get("learnability"),
                "gap_priority": gap_priority,
                "fulfillment_mode": fulfillment_mode(cls, layer),
            })
        rows.sort(key=lambda r: r["gap_priority"], reverse=True)
        summary = collections.Counter(r["classification"] for r in rows)
        strengths = [r for r in rows if r["classification"] in ("已具备", "快速迁移")]
        # The leverage path: what the user actually does, split into two honest buckets.
        ai_leverage = [r for r in rows if r["fulfillment_mode"] == "AI杠杆-现有项目加特性"]
        deep_learn = [r for r in rows if r["fulfillment_mode"] == "深学-护城河"]
        foundation = [r for r in rows if r["fulfillment_mode"] == "补地基"]
        # effective transfer = already-have + AI-leverageable (low-cost) over all reqs
        eff = round((len(strengths) + len([r for r in rows if r["classification"] == "部分迁移"]) + len(ai_leverage)) / len(rows), 2)
        matrix[role] = {
            "n_source_jds": prof["n_jds"],
            "summary": dict(summary),
            "transfer_coverage_surface": round(len(strengths) / len(rows), 2),
            "transfer_coverage_effective": eff,
            "leverage_path": {
                "已具备_剔除": [r["name"] for r in strengths],
                "AI杠杆_现有项目加特性": [r["name"] for r in sorted(ai_leverage, key=lambda r: r["gap_priority"], reverse=True)],
                "深学_护城河": [r["name"] for r in sorted(deep_learn, key=lambda r: r["gap_priority"], reverse=True)],
                "补地基_按需": [r["name"] for r in foundation],
            },
            "rows": rows,
        }
    return matrix


def main():
    graph = json.load(open(GRAPH, encoding="utf-8"))
    profiles = build_source_profiles()
    matrix = build_transfer_matrix(profiles, graph)
    json.dump(profiles, open(DATA / "source_profiles.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump(matrix, open(DATA / "transfer_matrix.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    # console summary
    for role, m in matrix.items():
        lp = m["leverage_path"]
        print(f"\n=== {role}  (n={m['n_source_jds']}) ===")
        print(f"  表层迁移率 {m['transfer_coverage_surface']:.0%}  →  有效迁移率 {m['transfer_coverage_effective']:.0%}")
        print(f"  ✓ 已具备(自动剔除,不进路径): {', '.join(lp['已具备_剔除']) or '—'}")
        print(f"  ⚡ AI 杠杆(现有项目加特性,廉价): {', '.join(lp['AI杠杆_现有项目加特性'])}")
        print(f"  🎯 深学(护城河,AI 替代不了): {', '.join(lp['深学_护城河'])}")


if __name__ == "__main__":
    main()
