"""出彩点 demo：前置感知「下一步最值得学」+ 按 fulfillment_class 路由动作 + 为什么是你。

这一层叠在你已有的 decision/explain/resource_engine 之上，新增的差异化是：
  - 不只排序缺口，而是按 fulfillment_class 决定**用哪种动作**去补每个缺口；
  - 把最该走的那一步选出来（前置已满足 × JD 市场权重 × 解锁下游）；
  - 用 JD 证据 + 你已满足的前置，生成确定性的「为什么是你」。

纯数据层，无需 DB / pydantic。运行：python3 recommend_demo.py
"""
from __future__ import annotations
import json, collections
from pathlib import Path
from app.domain import competency as C

ROLE = C.ROLE_AI_ENGINEER_APPLIED
DATA = Path(__file__).resolve().parent

# 动作路由：每一类缺口该用什么方式去补（这是“出彩”的核心）
ACTION = {
    "foundation_have": ("已具备 · 跳过",      "你的工程地基，直接迁移，不该出现在学习路线里。"),
    "ai_accelerated":  ("项目杠杆",           "在你现有项目里加这个特性即可，AI 辅助，无需系统学一门课。"),
    "core_learn":      ("深度掌握 · 护城河",  "AI 替不了你——精选资源 + 实战项目 + 验收标准。"),
    "product_loop":    ("数据闭环 · 共担",    "和 PM 共担的环节，了解并接上反馈即可。"),
    "pm_side":         ("非你核心",           "通常 PM 主导，了解概念即可，不进你的优先级。"),
}

def jd_pct(skill_id: str, ev: dict) -> int:
    rec = ev.get("skills", {}).get(skill_id)
    if not rec:
        return 0
    return round(100 * rec.get("frequency", 0.0))

def run(profile: dict[str, int]):
    ev = json.loads((DATA / "jd_evidence.json").read_text(encoding="utf-8"))
    reqs = {r.skill_id: r for r in C.requirements_for_role(ROLE, C.ORIENTATION_BASE)}
    # 谁依赖我（解锁价值）
    dependents = collections.defaultdict(list)
    for d in C.SKILL_DEPENDENCIES:
        dependents[d.depends_on].append(d.skill_id)

    def level(sid): return profile.get(sid, 0)

    def prereqs_satisfied(sid):
        unmet = []
        for dep in C.dependencies_of(sid):
            need = reqs[dep].min_level if dep in reqs else 2
            if level(dep) < need:
                unmet.append(dep)
        return unmet

    rows = []
    for sid, r in reqs.items():
        gap = max(0, r.min_level - level(sid))
        if gap == 0:
            continue
        cls = r.fulfillment_class or "core_learn"
        unmet = prereqs_satisfied(sid)
        ready = not unmet
        sk = C.SKILLS_BY_ID[sid]
        unlocks = dependents.get(sid, [])
        # 选步分数：市场权重 × 缺口 × 解锁加成 × 可学性（前置未满足则不参与本轮选步）
        score = r.weight * gap * (1 + 0.3 * len(unlocks)) * (0.6 + 0.4 * sk.learnability)
        rows.append({
            "sid": sid, "name": sk.name, "cls": cls, "gap": gap, "ready": ready,
            "unmet": unmet, "unlocks": unlocks, "weight": r.weight,
            "score": round(score, 3), "jd": jd_pct(sid, ev), "type": r.type,
        })

    # 本轮可走的（前置已满足、且不是 pm_side）
    frontier = [x for x in rows if x["ready"] and x["cls"] != "pm_side"]
    frontier.sort(key=lambda x: x["score"], reverse=True)

    print("="*70)
    print("画像：前端工程师 · 自建 Zeno（有 RAG/FC 中级，弱于评估/Agent 状态）")
    print("="*70)

    if frontier:
        best = frontier[0]
        act, _ = ACTION[best["cls"]]
        print(f"\n★ 下一步最值得学：{best['name']}   [{act}]")
        # 为什么是你（确定性，接地）—— 先讲护城河/前置，JD 需求放后面并按可信度表述
        why = []
        if best["cls"] == "core_learn":
            why.append("这是 AI 替不了你的护城河能力（demo 级和生产级的分水岭）")
        deps = C.dependencies_of(best["sid"])
        have_deps = [C.SKILLS_BY_ID[d].name for d in deps if level(d) >= (reqs[d].min_level if d in reqs else 2)]
        if have_deps:
            why.append("你已具备它的全部前置（" + "、".join(have_deps) + "），所以对你是补全、不是从零")
        if best["unlocks"]:
            why.append("学完它会解锁下游：" + "、".join(C.SKILLS_BY_ID[u].name for u in best["unlocks"]))
        if best["cls"] == "ai_accelerated":
            why.append("它是『项目杠杆』——在 Zeno 里加个特性即可，几乎零额外学习成本")
        # JD 需求：只有信号够强才作为正面理由，否则诚实标注待校准
        if best["jd"] >= 20:
            why.append(f"{best['jd']}% 的真实 AI 岗位 JD 明确要求这项")
        else:
            why.append(f"市场权重 {best['weight']}（JD 关键词命中稀疏，需校准后再用作卖点）")
        print("  为什么是你：")
        for w in why:
            print(f"    · {w}")

    print("\n— 接下来真正要深啃的（护城河，AI 替不了）—")
    for x in [f for f in frontier if f["cls"] == "core_learn"]:
        print(f"    🎯 {x['name']}  (JD {x['jd']}% · 解锁 {len(x['unlocks'])} 项 · score {x['score']})")

    print("\n— 用 AI 杠杆顺手拿下（项目里加特性，别系统学）—")
    for x in [f for f in frontier if f["cls"] == "ai_accelerated"]:
        print(f"    ⚡ {x['name']}  (JD {x['jd']}%)")

    blocked = [x for x in rows if not x["ready"] and x["cls"] != "pm_side"]
    if blocked:
        print("\n— 还不到时候（前置没满足，先别推）—")
        for x in blocked:
            print(f"    ⏳ {x['name']}  ← 先补：" + "、".join(C.SKILLS_BY_ID[u].name for u in x["unmet"]))

    pm = [x for x in rows if x["cls"] == "pm_side"]
    if pm:
        print("\n— 非你的核心（PM 侧，了解即可，不进路线）—")
        for x in pm:
            print(f"    ◌ {x['name']}")


if __name__ == "__main__":
    profile = {
        "eng.api_design": 3, "eng.typescript": 4, "eng.error_handling": 3, "eng.deploy": 3,
        "eng.observability": 2, "eng.auth": 2, "llm.streaming": 3,
        "data.text_processing": 2, "data.chunking": 2, "data.embedding": 2,
        "data.vector_search": 2, "data.retrieval_rerank": 1, "data.quality": 1,
        "llm.prompt": 3, "llm.structured_output": 3, "llm.function_calling": 2,
        "llm.tool_use": 1, "llm.cost_latency": 1, "llm.agent_state": 0,
        "eval.offline": 0, "eval.metrics": 0, "eval.online": 0, "eval.ab": 0,
    }
    run(profile)
