"""测评模拟器：在数据层忠实复刻产品的「讲人话的测评」输出，用于自测打磨。

复用 competency（含本轮校准后的权重 + fulfillment_class）和 jd_evidence。
不依赖 DB/pydantic。运行：python3 -m app.data.assess_sim
"""
from __future__ import annotations
import json, collections
from pathlib import Path
from app.domain import competency as C

ROLE = C.ROLE_AI_ENGINEER_APPLIED
DATA = Path(__file__).resolve().parent

STRENGTH_LEVEL = 3          # 达到即「已具备」
TRANSFER_LEVEL = 2          # 达到 + 高可学性即「可迁移」
TRANSFER_LEARNABILITY = 0.6

CLASS_LABEL = {
    "core_learn": "🎯 真护城河（AI 替不了，值得深啃）",
    "ai_accelerated": "⚡ AI 帮你实现，但面试要你讲得清",
    "product_loop": "◌ 数据闭环（与 PM 共担，了解即可）",
    "pm_side": "◌ 非你核心（PM 侧，了解即可）",
    "foundation_have": "✓ 工程地基",
}

# “AI 帮你实现”那一类的统一提醒——会用 ≠ 能自圆其说。
AI_ACCEL_NOTE = "这些 AI 能帮你写出来，省掉实现的苦工；但面试会追问你为什么这么设计——会用 ≠ 讲得清。"


def defend_bar(sid: str) -> str:
    """这项技能面试要你讲清的深度（取自 skill_graph 的 ai_usage，真实数据）。"""
    usage = C.SKILLS_BY_ID[sid].ai_usage
    return "；".join(usage[:2]) if usage else ""


def _reqs():
    return {r.skill_id: r for r in C.requirements_for_role(ROLE, C.ORIENTATION_BASE)}


def jd_pct(sid, ev):
    rec = ev.get("skills", {}).get(sid)
    return round(100 * rec.get("frequency", 0.0)) if rec else 0


AI_FLOOR = 0.6  # 「接个AI就有」的缺口，视作大半可廉价补上


def _coverage(profile, reqs, credit_ai):
    req_only = [r for r in reqs.values() if r.type == "required"]
    total = sum(r.weight for r in req_only) or 1
    acc = 0.0
    for r in req_only:
        lvl = profile.get(r.skill_id, 0)
        cov = min(1.0, lvl / r.min_level) if r.min_level else 1.0
        if credit_ai and cov < AI_FLOOR and r.fulfillment_class == "ai_accelerated":
            cov = AI_FLOOR
        acc += r.weight * cov
    return round(100 * acc / total)


def readiness(profile, reqs):
    """(表层就绪度, 有效就绪度)。有效 = 把『接个AI就有』的缺口算作大半已覆盖。"""
    return _coverage(profile, reqs, False), _coverage(profile, reqs, True)


def readiness_words(eff, n_core, has_foundation):
    if eff >= 75: return "已经很接近了，临门一脚的事。"
    if eff >= 55:
        return "底子扎实，过了入门，正处在「形成壁垒」的阶段。"
    if has_foundation:
        return "你的工程地基已经是稀缺资产，剩下的多数能用 AI 廉价补上。"
    return "目前距离还较远，但路径很清楚——先从能快速见效的地方建立势头。"


def assess(name, profile):
    ev = json.loads((DATA / "jd_evidence.json").read_text(encoding="utf-8"))
    reqs = _reqs()
    dependents = collections.defaultdict(list)
    for d in C.SKILL_DEPENDENCIES:
        dependents[d.depends_on].append(d.skill_id)

    def lvl(s): return profile.get(s, 0)

    # 优势
    strong, transfer = [], []
    for sid, sk in C.SKILLS_BY_ID.items():
        if lvl(sid) >= STRENGTH_LEVEL:
            strong.append(sk.name)
        elif lvl(sid) >= TRANSFER_LEVEL and sk.learnability >= TRANSFER_LEARNABILITY:
            transfer.append(sk.name)

    # 缺口（required）按四分类
    gaps_by_cls = collections.defaultdict(list)
    frontier = []
    for sid, r in reqs.items():
        gap = max(0, r.min_level - lvl(sid))
        if gap == 0 or r.type != "required":
            continue
        cls = r.fulfillment_class or "core_learn"
        gaps_by_cls[cls].append(C.SKILLS_BY_ID[sid].name)
        unmet = [d for d in C.dependencies_of(sid)
                 if lvl(d) < (reqs[d].min_level if d in reqs else 2)]
        if not unmet and cls != "pm_side":
            sk = C.SKILLS_BY_ID[sid]
            score = r.weight * gap * (1 + 0.3 * len(dependents[sid])) * (0.6 + 0.4 * sk.learnability)
            frontier.append((round(score, 3), sid, r, cls, dependents[sid]))
    frontier.sort(reverse=True)

    surface, eff = readiness(profile, reqs)
    n_core = len(gaps_by_cls["core_learn"])
    has_foundation = sum(1 for s in C.SKILLS_BY_ID if lvl(s) >= STRENGTH_LEVEL
                         and reqs.get(s) and reqs[s].fulfillment_class == "foundation_have") >= 3
    print("\n" + "═" * 64)
    print(f"  你的能力诊断 · {name}")
    print("  Zeno 不承诺帮你拿 offer，只诚实告诉你：你站在哪、差距在哪。")
    print("═" * 64)
    if eff > surface + 5:
        print(f"\n就绪度 {surface}%（现在）  →  最高 {eff}%（前提：AI 能帮你实现的那些，你得能讲清、自圆其说）")
    else:
        print(f"\n就绪度 {eff}%")
    print(f"真正要硬啃的护城河，只有 {n_core} 件。 {readiness_words(eff, n_core, has_foundation)}")

    print("\n【这些能力，你已经拥有了】")
    if strong: print("  已具备：" + "、".join(strong))
    if transfer: print("  可迁移：" + "、".join(transfer))
    if not strong and not transfer: print("  （多补充些经历，我们能更准确地发现你的优势）")

    print("\n【这些是真差距】")
    for cls in ("core_learn", "ai_accelerated", "product_loop", "pm_side"):
        if gaps_by_cls[cls]:
            print(f"  {CLASS_LABEL[cls]}")
            print(f"      {'、'.join(gaps_by_cls[cls])}")
            if cls == "ai_accelerated":
                print(f"      ↳ {AI_ACCEL_NOTE}")

    if frontier:
        _, sid, r, cls, unlocks = frontier[0]
        print(f"\n【最该补的差距（诊断，不是保证上岸的路线）】")
        print(f"  ▶ {C.SKILLS_BY_ID[sid].name}   [{CLASS_LABEL[cls].split('（')[0].strip()}]")
        why = []
        if cls == "core_learn":
            why.append("AI 替不了你的护城河能力（demo 级和生产级的分水岭）")
        elif cls == "ai_accelerated":
            why.append("AI 能帮你把代码写出来，省掉实现的苦工——先用一个小项目把它跑通")
            bar = defend_bar(sid)
            if bar:
                why.append(f"但面试官会追问：{bar}——你得能讲清，会用 ≠ 自圆其说")
        have_deps = [C.SKILLS_BY_ID[d].name for d in C.dependencies_of(sid)
                     if lvl(d) >= (reqs[d].min_level if d in reqs else 2)]
        if have_deps:
            why.append("你已具备它的前置（" + "、".join(have_deps) + "），对你是补全、不是从零")
        # 区分：解锁的下游里若有护城河技能，单独点出
        core_unlocks = [u for u in unlocks
                        if reqs.get(u) and reqs[u].fulfillment_class == "core_learn"]
        other_unlocks = [u for u in unlocks if u not in core_unlocks]
        if core_unlocks:
            why.append("更关键的是，它解锁你真正的护城河：" + "、".join(C.SKILLS_BY_ID[u].name for u in core_unlocks))
        elif other_unlocks:
            why.append("补上它会解锁：" + "、".join(C.SKILLS_BY_ID[u].name for u in other_unlocks))
        jd = jd_pct(sid, ev)
        if jd >= 20:
            why.append(f"{jd}% 的真实 AI 岗位 JD 明确要求这项")
        for w in why:
            print(f"      · {w}")


def narrate(name, profile):
    """把结构化测评渲染成『一个真顾问开口跟你说』的连贯口吻。
    产品里这一层由 DeepSeek 从下面这些确定性事实生成；这里用模板模拟目标语气，
    用来验证『像真人』的最终体验是否站得住。"""
    ev = json.loads((DATA / "jd_evidence.json").read_text(encoding="utf-8"))
    reqs = _reqs()
    dependents = collections.defaultdict(list)
    for d in C.SKILL_DEPENDENCIES:
        dependents[d.depends_on].append(d.skill_id)

    def lvl(s): return profile.get(s, 0)

    # 优势先点 AI 相关的亮点（llm/data/eval），通用工程基础放后面
    _cat_rank = {"llm": 0, "data": 0, "eval": 0, "foundation": 1}
    strong_ids = sorted([s for s in C.SKILLS_BY_ID if lvl(s) >= STRENGTH_LEVEL],
                        key=lambda s: _cat_rank.get(C.SKILLS_BY_ID[s].category, 1))
    strong = [C.SKILLS_BY_ID[s].name for s in strong_ids]
    surface, eff = readiness(profile, reqs)
    core_gaps, frontier, ai_gaps = [], [], []
    for sid, r in reqs.items():
        gap = max(0, r.min_level - lvl(sid))
        if gap == 0 or r.type != "required":
            continue
        cls = r.fulfillment_class or "core_learn"
        if cls == "core_learn":
            core_gaps.append(C.SKILLS_BY_ID[sid].name)
        if cls == "ai_accelerated":
            ai_gaps.append(sid)
        unmet = [d for d in C.dependencies_of(sid)
                 if lvl(d) < (reqs[d].min_level if d in reqs else 2)]
        if not unmet and cls != "pm_side":
            sk = C.SKILLS_BY_ID[sid]
            sc = r.weight * gap * (1 + 0.3 * len(dependents[sid])) * (0.6 + 0.4 * sk.learnability)
            frontier.append((round(sc, 3), sid, cls))
    frontier.sort(reverse=True)

    P = []  # paragraphs
    # 开场：结论先行，照着这个人说
    if eff >= 70:
        P.append(f"先说结论：你比你以为的接近多了。{('你已经做过 ' + '、'.join(strong[:4]) + ' 这些') if strong else '你的底子'}"
                 f"，加上工程基础，已经过了入门那关——就绪度差不多 {surface}%。")
    elif strong and surface < 45:
        P.append(f"先说句公道话：{('、'.join(strong[:3]) + ' 这些工程能力')}已经是稀缺资产，别被 {surface}% 这个数字唬住。"
                 f"它低，只是因为 AI 实战还是空白——而那部分，多数是能借 AI 快速补上的，理想情况能到 {eff}% 左右。")
    else:
        P.append(f"我先不灌鸡汤。你现在离这个岗位还有距离，就绪度 {surface}%。但路径其实很清楚，"
                 f"不用从零啃整本机器学习——咱们挑能最快见效的地方先动起来。")

    # 真差距：就那几件硬的
    if core_gaps:
        P.append(f"真正要你亲手硬啃的，其实就 {len(core_gaps)} 件，而且都是 AI 替不了你的那种："
                 f"{'、'.join(core_gaps)}。其余听着吓人的一长串，多半是 AI 能帮你写、你过一遍就能上手的。")

    # 最该先动的一步 + 为什么是你
    if frontier:
        _, sid, cls = frontier[0]
        nm = C.SKILLS_BY_ID[sid].name
        have_deps = [C.SKILLS_BY_ID[d].name for d in C.dependencies_of(sid)
                     if lvl(d) >= (reqs[d].min_level if d in reqs else 2)]
        unlocks_core = [C.SKILLS_BY_ID[u].name for u in dependents[sid]
                        if reqs.get(u) and reqs[u].fulfillment_class == "core_learn"]
        jd = jd_pct(sid, ev)
        s = f"要我说，先从「{nm}」下手。"
        if have_deps:
            s += f"你已经有它的前置（{have_deps[0]}），所以这对你是补全、不是从头学。"
        if cls == "ai_accelerated":
            s += "AI 能帮你把代码写出来，但别就此觉得过关了——"
            bar = defend_bar(sid)
            if bar:
                s += f"面试官会追着问你「{bar.split('；')[0]}」，会用和能自圆其说是两码事。"
        elif cls == "foundation_have":
            s += "这是 AI 工程的地基——先把它立住，不然上面学什么都是浮沙，面试一问就穿。"
        if unlocks_core:
            s += f"更要紧的是，它能解锁你真正的护城河：{unlocks_core[0]}。"
        if jd >= 20:
            s += f"而且 {jd}% 的真实岗位都点名要它。"
        P.append(s)

    # 诚实收尾
    P.append("最后一句实话：我不敢跟你保证这么走就一定拿到 offer——没人能保证。"
             "我能保证的是，上面这些差距，是对照真实招聘要求、诚实算出来的，不是模型顺着你说的好话。")

    print("\n" + "─" * 64)
    print(f"  ◇ 像真人顾问开口 · {name}")
    print("─" * 64)
    for para in P:
        print("  " + para + "\n")


PERSONAS = {
    "前端 + 自建 Zeno（你本人画像）": {
        "eng.api_design": 3, "eng.typescript": 4, "eng.error_handling": 3, "eng.deploy": 3,
        "eng.observability": 2, "eng.auth": 2, "llm.streaming": 3,
        "data.text_processing": 2, "data.chunking": 2, "data.embedding": 2,
        "data.vector_search": 2, "data.retrieval_rerank": 1, "data.quality": 1,
        "llm.prompt": 3, "llm.structured_output": 3, "llm.function_calling": 2,
        "llm.tool_use": 1, "llm.cost_latency": 1, "llm.agent_state": 0,
        "eval.offline": 0, "eval.metrics": 0, "eval.online": 0, "eval.ab": 0,
    },
    "资深后端（强工程，零 AI 实战）": {
        "eng.api_design": 4, "eng.error_handling": 4, "eng.deploy": 4, "eng.observability": 3,
        "eng.auth": 3, "eng.typescript": 1, "data.text_processing": 2, "data.quality": 2,
        "llm.prompt": 1, "llm.structured_output": 1, "llm.function_calling": 0,
        "data.embedding": 0, "data.vector_search": 0, "llm.tool_use": 0, "eval.offline": 0,
    },
    "应届/转行（基础薄）": {
        "eng.typescript": 1, "eng.api_design": 1, "llm.prompt": 1,
    },
}

if __name__ == "__main__":
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "voice"
    for name, p in PERSONAS.items():
        if mode == "engine":
            assess(name, p)
        else:
            narrate(name, p)
