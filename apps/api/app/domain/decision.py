"""Decision engine (deterministic) — plan section 6.

Turns the collected skill profile into a three-section result:
    1. 你的优势 (strengths / why you)
    2. 能力差距 (gaps: required / bonus)
    3. 下一步最值得学什么 (1-3 next-steps + action prescription)

Everything here is reproducible (no LLM in the loop). The LLM may later
rephrase the produced text, but the *decisions* (gap, ranking, selection)
are pure functions of the competency model + the user's observed profile.

Formulas (plan 6.1 / 6.2):
    gap        = max(0, min_level - user_level)
    gap_score  = weight * gap * (0.5 + 0.5 * (1 - confidence))
    next_score = 0.5 * gap_score_norm
               + 0.3 * dependency_urgency
               + 0.2 * learnability
A skill whose own prerequisites are still unmet is penalised so that the
prerequisite surfaces first ("先学依赖").
"""

from dataclasses import dataclass, field

from app.domain import competency
from app.domain.competency import RoleRequirement

TOP_N_CANDIDATES = 8
MAX_NEXT_STEPS = 3
BLOCKED_PENALTY = 0.5
# A skill counts as a "strength" (leverage point) if level is high, or a
# moderately-known skill that is highly transferable from a frontend background.
STRENGTH_LEVEL = 3
TRANSFER_LEVEL = 2
TRANSFER_LEARNABILITY = 0.7


@dataclass(frozen=True)
class SkillObservation:
    level: int
    confidence: float


@dataclass(frozen=True)
class GapInfo:
    req: RoleRequirement
    level: int
    confidence: float
    gap: int
    gap_score: float


@dataclass
class NextStep:
    rank: int
    skill_id: str
    skill_name: str
    category: str
    current_level: int
    target_level: int
    action_title: str
    why: str
    action_steps: list[str]
    acceptance_criteria: list[str]
    next_score: float
    unblocks: list[str] = field(default_factory=list)
    blocked_by: list[str] = field(default_factory=list)


@dataclass
class Strength:
    skill_id: str
    skill_name: str
    category: str
    level: int
    reason: str


# --------------------------------------------------------------------------- #
# Gap computation (plan 6.1)
# --------------------------------------------------------------------------- #
def compute_gaps(role_id: str, obs: dict[str, SkillObservation]) -> list[GapInfo]:
    out: list[GapInfo] = []
    for req in competency.requirements_for_role(role_id):
        o = obs.get(req.skill_id)
        level = o.level if o else 0
        conf = o.confidence if o else 0.0
        gap = max(0, req.min_level - level)
        score = req.weight * gap * (0.5 + 0.5 * (1.0 - conf))
        out.append(GapInfo(req=req, level=level, confidence=conf, gap=gap, gap_score=score))
    return out


def compute_readiness(role_id: str, obs: dict[str, SkillObservation]) -> float:
    """Weighted coverage of *required* skills, 0-100 ("Career Readiness")."""
    reqs = [r for r in competency.requirements_for_role(role_id) if r.type == "required"]
    total = sum(r.weight for r in reqs)
    if total == 0:
        return 0.0
    acc = 0.0
    for r in reqs:
        o = obs.get(r.skill_id)
        level = o.level if o else 0
        coverage = min(1.0, level / r.min_level) if r.min_level > 0 else 1.0
        acc += r.weight * coverage
    return round(100.0 * acc / total, 1)


def _dependents_map() -> dict[str, list[str]]:
    """skill_id -> list of skills that directly depend on it."""
    m: dict[str, list[str]] = {}
    for d in competency.SKILL_DEPENDENCIES:
        m.setdefault(d.depends_on, []).append(d.skill_id)
    return m


# --------------------------------------------------------------------------- #
# Strengths (你的优势 / why you)
# --------------------------------------------------------------------------- #
def compute_strengths(obs: dict[str, SkillObservation]) -> list[Strength]:
    out: list[Strength] = []
    for skill_id, o in obs.items():
        skill = competency.SKILLS_BY_ID.get(skill_id)
        if skill is None:
            continue
        if o.level >= STRENGTH_LEVEL:
            reason = f"你已能在真实场景交付（L{o.level}），可作为切入 AI 工程的跳板。"
        elif o.level >= TRANSFER_LEVEL and skill.learnability >= TRANSFER_LEARNABILITY:
            reason = (
                f"前端背景对该能力迁移度高（{int(skill.learnability * 100)}%），"
                f"当前 L{o.level}，稍加练习即可放大优势。"
            )
        else:
            continue
        out.append(
            Strength(
                skill_id=skill_id,
                skill_name=skill.name,
                category=skill.category,
                level=o.level,
                reason=reason,
            )
        )
    out.sort(key=lambda s: (s.level, competency.SKILLS_BY_ID[s.skill_id].learnability), reverse=True)
    return out[:5]


# --------------------------------------------------------------------------- #
# Next-step ranking (plan 6.2)
# --------------------------------------------------------------------------- #
def select_next_steps(
    role_id: str,
    obs: dict[str, SkillObservation],
    max_steps: int = MAX_NEXT_STEPS,
) -> list[NextStep]:
    """Rank next-steps deterministically.

    `max_steps` only controls how many of the *already-ranked* steps are
    surfaced — the gap/score/ordering above it is untouched, so the offline
    eval baseline (computed at the default depth) never forks.
    """
    gaps = compute_gaps(role_id, obs)
    gap_by_skill = {g.req.skill_id: g for g in gaps}

    positive = sorted([g for g in gaps if g.gap > 0], key=lambda g: g.gap_score, reverse=True)
    candidates: list[GapInfo] = positive[:TOP_N_CANDIDATES]
    cand_ids = {g.req.skill_id for g in candidates}

    # Dependency correction: pull unmet prerequisites into the candidate set.
    for g in list(candidates):
        for dep in competency.dependencies_of(g.req.skill_id):
            dep_gap = gap_by_skill.get(dep)
            if dep_gap and dep_gap.gap > 0 and dep not in cand_ids:
                candidates.append(dep_gap)
                cand_ids.add(dep)

    dependents = _dependents_map()
    max_gs = max((g.gap_score for g in candidates), default=0.0) or 1.0

    scored: list[NextStep] = []
    for g in candidates:
        sid = g.req.skill_id
        skill = competency.SKILLS_BY_ID[sid]

        unblocks = [
            d for d in dependents.get(sid, [])
            if (dg := gap_by_skill.get(d)) and dg.gap > 0
        ]
        blocked_by = [
            dep for dep in competency.dependencies_of(sid)
            if (dg := gap_by_skill.get(dep)) and dg.gap > 0
        ]

        dep_urgency_raw = sum(gap_by_skill[d].gap_score for d in unblocks)
        dep_urgency = min(1.0, dep_urgency_raw / max_gs)
        gs_norm = g.gap_score / max_gs

        score = 0.5 * gs_norm + 0.3 * dep_urgency + 0.2 * skill.learnability
        if blocked_by:
            score *= BLOCKED_PENALTY

        title, why, steps, criteria = _action_blueprint(g, unblocks, blocked_by)
        scored.append(
            NextStep(
                rank=0,
                skill_id=sid,
                skill_name=skill.name,
                category=skill.category,
                current_level=g.level,
                target_level=g.req.min_level,
                action_title=title,
                why=why,
                action_steps=steps,
                acceptance_criteria=criteria,
                next_score=round(score, 4),
                unblocks=unblocks,
                blocked_by=blocked_by,
            )
        )

    scored.sort(key=lambda s: s.next_score, reverse=True)
    top = scored[: max(1, max_steps)]
    for i, ns in enumerate(top, start=1):
        ns.rank = i
    return top


# --------------------------------------------------------------------------- #
# Action prescription (plan 6.3) — deterministic templates
# --------------------------------------------------------------------------- #
def _action_blueprint(
    g: GapInfo, unblocks: list[str], blocked_by: list[str]
) -> tuple[str, str, list[str], list[str]]:
    skill = competency.SKILLS_BY_ID[g.req.skill_id]
    title = f"把「{skill.name}」从 L{g.level} 提升到 L{g.req.min_level}"

    why_parts = [
        f"岗位权重 {g.req.weight}（{'必要' if g.req.type == 'required' else '加分'}），"
        f"当前差距 {g.gap} 级。"
    ]
    if unblocks:
        names = "、".join(competency.SKILLS_BY_ID[s].name for s in unblocks[:3])
        why_parts.append(f"它是「{names}」的前置依赖，先学能解锁后续路径。")
    if blocked_by:
        names = "、".join(competency.SKILLS_BY_ID[s].name for s in blocked_by[:3])
        why_parts.append(f"注意：建议先补齐其依赖「{names}」。")
    if skill.learnability >= 0.7:
        why_parts.append(f"前端背景迁移度高（{int(skill.learnability * 100)}%），上手快。")
    why = "".join(why_parts)

    blueprint = _SKILL_BLUEPRINTS.get(skill.id) or _CATEGORY_BLUEPRINTS[skill.category]
    return title, why, list(blueprint["steps"]), list(blueprint["acceptance"])


# Category-level fallback templates.
_CATEGORY_BLUEPRINTS: dict[str, dict[str, list[str]]] = {
    "foundation": {
        "steps": [
            "梳理一个你做过的前端项目，列出它的后端契约与边界",
            "用 FastAPI 重写其中一个接口，加上鉴权与统一错误处理",
            "补上请求日志与一个健康检查端点",
            "把服务容器化并部署到一个免费平台",
        ],
        "acceptance": ["提交可访问的接口 URL 或仓库链接", "附一份接口契约说明（输入/输出/错误码）"],
    },
    "data": {
        "steps": [
            "选一份你熟悉的文档集（如团队 wiki）作为语料",
            "实现清洗 → chunking → embedding 的最小管线",
            "把向量写入 pgvector，跑通一次相似检索",
            "对比 2 种 chunk 策略的召回差异并记录",
        ],
        "acceptance": ["提交可运行的检索 demo 仓库", "附一页 chunk 策略对比笔记"],
    },
    "llm": {
        "steps": [
            "为一个真实任务写出带角色/约束/示例的 prompt",
            "加上 JSON schema 约束并校验输出",
            "接入一次函数/工具调用完成闭环",
            "记录成本与延迟，做一轮 prompt 精简",
        ],
        "acceptance": ["提交可运行的 LLM 功能 demo", "附 prompt 设计说明与一次失败-修复记录"],
    },
    "eval": {
        "steps": [
            "为你的 AI 功能整理 20-50 条评估样例（输入+期望）",
            "定义 2-3 个质量指标（准确/覆盖/幻觉率）",
            "跑一轮离线评估并出基线分数",
            "改一个变量再评估一次，对比结果",
        ],
        "acceptance": ["提交评估集与脚本", "附一份基线 vs 改进的对比报告"],
    },
}

# Skill-specific blueprints for the high-weight skills most likely to surface.
_SKILL_BLUEPRINTS: dict[str, dict[str, list[str]]] = {
    "data.chunking": {
        "steps": [
            "了解固定窗口 / 语义切分 / 递归切分三种策略",
            "对同一文档分别用 3 种策略切分并观察边界质量",
            "为带标题层级的文档实现一个保留结构的切分器",
            "用一组问题测召回，记录哪种策略更优",
        ],
        "acceptance": ["提交切分器代码", "附 3 种策略的召回对比表"],
    },
    "data.embedding": {
        "steps": [
            "对比至少 2 个 embedding 模型（维度/成本/效果）",
            "为同一语料分别生成向量并存库",
            "用同一批 query 评估两者的 Top-k 命中率",
            "写下你的选型结论与适用场景",
        ],
        "acceptance": ["提交可复现的评测脚本", "附一页 embedding 选型结论"],
    },
    "data.vector_search": {
        "steps": [
            "在 Postgres 装好 pgvector 并建一张向量表",
            "建 HNSW 索引，跑通一次近邻检索",
            "加上结构化过滤（按 skill/level 预筛）再检索",
            "压测不同 ef/索引参数对召回与延迟的影响",
        ],
        "acceptance": ["提交建表+检索的 SQL/代码", "附召回率与延迟的实测数据"],
    },
    "data.retrieval_rerank": {
        "steps": [
            "搭一个『向量召回 → 重排』两段式检索",
            "实现规则重排：relevance/freshness/fit 加权打分",
            "对 Top10 用一次 LLM 打分（固定 rubric）对比效果",
            "记录重排前后 Top3 的质量变化",
        ],
        "acceptance": ["提交可运行的检索+重排 demo", "附重排前后对比记录"],
    },
    "llm.prompt": {
        "steps": [
            "选一个真实任务，写出含角色/任务/约束/示例的结构化 prompt",
            "做 2-3 轮迭代，每轮只改一个变量",
            "整理常见失败模式与对应的 prompt 修复手法",
            "沉淀成一个可复用的 prompt 模板",
        ],
        "acceptance": ["提交 prompt 模板与迭代记录", "附一组输入输出样例"],
    },
    "llm.structured_output": {
        "steps": [
            "用 Pydantic/Zod 定义目标输出 schema",
            "让模型输出 JSON 并做严格校验",
            "实现校验失败时的回退/重试策略",
            "对边界输入测试稳定性",
        ],
        "acceptance": ["提交带 schema 校验的代码", "附失败回退的测试用例"],
    },
    "llm.function_calling": {
        "steps": [
            "定义 1-2 个工具的函数签名与描述",
            "让模型按需调用并解析参数",
            "把工具结果回灌给模型完成闭环",
            "处理一次模型选错工具的情况",
        ],
        "acceptance": ["提交可运行的函数调用 demo", "附工具定义与一次纠错记录"],
    },
    "llm.tool_use": {
        "steps": [
            "设计一个需要 2+ 工具协作的任务",
            "实现工具编排与中间状态传递",
            "加上失败重试与超时处理",
            "记录一次多工具链路的端到端 trace",
        ],
        "acceptance": ["提交多工具编排 demo", "附一条端到端调用链路记录"],
    },
    "eval.offline": {
        "steps": [
            "围绕你的 AI 功能整理 30+ 条评估样例",
            "区分『正常/边界/对抗』三类样例",
            "写一个可复跑的离线评估脚本",
            "产出第一版基线分数",
        ],
        "acceptance": ["提交评估集（含标注）", "附基线评估报告"],
    },
    "eval.metrics": {
        "steps": [
            "定义准确率/覆盖率/幻觉率的可计算口径",
            "在离线评估集上实现这些指标的自动计算",
            "为一次改动做指标对比",
            "把指标接进每次迭代的检查清单",
        ],
        "acceptance": ["提交指标计算代码", "附一次改动的指标对比"],
    },
    "eng.api_design": {
        "steps": [
            "为一个 AI 功能设计清晰的接口契约（输入/输出/错误码）",
            "用 FastAPI 实现并加上鉴权与统一错误处理",
            "补上请求日志与可观测埋点",
            "写一份接口文档并自测",
        ],
        "acceptance": ["提交接口仓库或可访问 URL", "附接口契约文档"],
    },
}
