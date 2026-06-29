"""可运行的不变量自检：锁住本轮打磨出的评估行为，防回归。
不依赖 pytest/DB。运行：python3 -m app.data.check_assess_invariants
"""
from __future__ import annotations
import json
from pathlib import Path
from app.domain import competency as C

ROLE = C.ROLE_AI_ENGINEER_APPLIED
DATA = Path(__file__).resolve().parent
reqs = {r.skill_id: r for r in C.requirements_for_role(ROLE, C.ORIENTATION_BASE)}
ev = json.loads((DATA / "jd_evidence.json").read_text(encoding="utf-8"))["skills"]


def freq(sid):
    return ev.get(sid, {}).get("frequency", 0.0)


checks = []
def ok(name, cond):
    checks.append((name, bool(cond)))


# 1) 四分类已全量落到 required + bonus 上
ok("所有 role_requirements 都有 fulfillment_class",
   all(r.fulfillment_class for r in C.ROLE_REQUIREMENTS))

# 2) 关键分类正确（之前的错配点）
ok("function_calling = core_learn", reqs["llm.function_calling"].fulfillment_class == "core_learn")
ok("eval.ab = pm_side", reqs["eval.ab"].fulfillment_class == "pm_side")
ok("vector_search = ai_accelerated", reqs["data.vector_search"].fulfillment_class == "ai_accelerated")

# 3) 消歧生效：eval.offline 已从严重低估修正（>20%），不再是拆台的个位数
ok("eval.offline JD 频率已修正到 >20%", freq("eval.offline") > 0.20)

# 4) 消歧没把强信号误杀：tool_use / api_design 仍是高需求
ok("tool_use 仍高需求 (>50%)", freq("llm.tool_use") > 0.50)
ok("api_design 仍高需求 (>50%)", freq("eng.api_design") > 0.50)

# 5) 权重单向上调，未把含蓄技能（向量检索）误降到地板
ok("向量检索权重未被 JD 稀疏误降 (>=0.85)", reqs["data.vector_search"].weight >= 0.85)
ok("tool_use 权重已按强信号上调 (>=0.80)", reqs["llm.tool_use"].weight >= 0.80)

# 6) 前置约束自洽：rerank 依赖 vector_search（不会在 vector_search 之前被推）
deps_rerank = C.dependencies_of("data.retrieval_rerank")
ok("rerank 依赖 vector_search", "data.vector_search" in deps_rerank)

# 7) 表达层信任底线：SYSTEM 人设 + 模板兜底，中英都必须保留『不承诺 offer』那句。
import sys, types  # noqa: E402
try:
    from app.domain import assessment_voice as V
except Exception:  # 无 pydantic 环境（如 CI 数据层自检）：桩掉 config 再导
    _cfg = types.ModuleType("app.core.config")
    class _S: deepseek_api_key = None; deepseek_base_url = ""; deepseek_model = ""
    _cfg.settings = _S(); sys.modules["app.core.config"] = _cfg
    from app.domain import assessment_voice as V  # noqa: E402

ok("SYSTEMS 同时含中/英人设", "zh" in V.SYSTEMS and "en" in V.SYSTEMS)
ok("中文人设保留『不承诺 offer』底线",
   "offer" in V.SYSTEMS["zh"] and "没人能保证" in V.SYSTEMS["zh"])
ok("英文人设保留『不承诺 offer』底线",
   "offer" in V.SYSTEMS["en"] and "no one can" in V.SYSTEMS["en"])
ok("中文模板兜底必含诚实收尾",
   "不敢保证" in V._template({}, "zh")["body"] and "offer" in V._template({}, "zh")["body"])
ok("英文模板兜底必含诚实收尾",
   "can't promise" in V._template({}, "en")["body"] and "offer" in V._template({}, "en")["body"])
ok("模板兜底带可截图 headline",
   bool(V._template({}, "zh").get("headline")) and bool(V._template({}, "en").get("headline")))

print("能力评估不变量自检")
print("-" * 40)
passed = 0
for name, c in checks:
    print(f"  {'✓' if c else '✗ FAIL'}  {name}")
    passed += c
print("-" * 40)
print(f"{passed}/{len(checks)} 通过")
if passed != len(checks):
    raise SystemExit(1)
