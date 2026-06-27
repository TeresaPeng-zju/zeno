"""Decision engine (deterministic).

Turns the collected skill profile into a three-section result:
    1. Strengths (why you)
    2. Gaps (required / bonus)
    3. Next steps (prioritized learning actions)

Everything here is reproducible (no LLM in the loop). The LLM may later
rephrase the produced text, but the *decisions* (gap, ranking, selection)
are pure functions of the competency model + the user's observed profile.
Scoring parameters are loaded from config (env-injectable).
"""

from dataclasses import dataclass, field

from app.core.config import settings
from app.domain import competency
from app.domain.competency import RoleRequirement
from app.i18n import t

MAX_NEXT_STEPS = 3
BLOCKED_PENALTY = settings.decision_blocked_penalty
STRENGTH_LEVEL = settings.decision_strength_level
TRANSFER_LEVEL = settings.decision_transfer_level
TRANSFER_LEARNABILITY = settings.decision_transfer_learnability

# Scoring weights (from config, not hardcoded)
_W_GAP = settings.decision_w_gap
_W_DEP = settings.decision_w_dependency
_W_LEARN = settings.decision_w_learnability


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
    # Auditable score breakdown — the exact terms that produced `next_score`.
    # Populated where the score is computed so there is a single source of truth
    # (the explain layer reads this, it never re-derives the formula).
    score_components: dict[str, float] = field(default_factory=dict)


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
def compute_gaps(
    role_id: str,
    obs: dict[str, SkillObservation],
    orientation_id: str = competency.ORIENTATION_BASE,
) -> list[GapInfo]:
    out: list[GapInfo] = []
    for req in competency.requirements_for_role(role_id, orientation_id):
        o = obs.get(req.skill_id)
        level = o.level if o else 0
        conf = o.confidence if o else 0.0
        gap = max(0, req.min_level - level)
        score = req.weight * gap * (0.5 + 0.5 * (1.0 - conf))
        out.append(GapInfo(req=req, level=level, confidence=conf, gap=gap, gap_score=score))
    return out


def compute_readiness(
    role_id: str,
    obs: dict[str, SkillObservation],
    orientation_id: str = competency.ORIENTATION_BASE,
) -> float:
    """Weighted coverage of *required* skills, 0-100 ("Career Readiness")."""
    reqs = [
        r for r in competency.requirements_for_role(role_id, orientation_id) if r.type == "required"
    ]
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
def compute_strengths(
    obs: dict[str, SkillObservation], lang: str = "en"
) -> list[Strength]:
    out: list[Strength] = []
    for skill_id, o in obs.items():
        skill = competency.SKILLS_BY_ID.get(skill_id)
        if skill is None:
            continue
        if o.level >= STRENGTH_LEVEL:
            reason = t(lang, "strength.high", level=o.level)
        elif o.level >= TRANSFER_LEVEL and skill.learnability >= TRANSFER_LEARNABILITY:
            reason = t(
                lang,
                "strength.transfer",
                pct=int(skill.learnability * 100),
                level=o.level,
            )
        else:
            continue
        out.append(
            Strength(
                skill_id=skill_id,
                skill_name=competency.skill_name(skill_id, lang),
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
def _priority_topological_order(scored: list[NextStep]) -> list[NextStep]:
    """Order next-steps so no skill precedes its (in-set) prerequisite.

    The score-only sort this replaces could rank a high-gap dependent ahead of
    its own prerequisite (``BLOCKED_PENALTY`` merely *discounts* a blocked skill,
    it does not reorder). That let dependency inversions slip through — exactly
    what the decision-surface eval caught (``vector_search`` before ``embedding``).

    This is Kahn's algorithm with a deterministic priority rule: among all steps
    whose prerequisites *within the candidate set* are already emitted, emit the
    highest ``next_score`` (``skill_id`` as a stable tie-break). Result: zero
    dependency violations by construction, the score ranking preserved as closely
    as the dependency partial order permits, and fully reproducible output.
    """
    in_set = {s.skill_id for s in scored}
    prereqs = {
        s.skill_id: {d for d in competency.dependencies_of(s.skill_id) if d in in_set}
        for s in scored
    }
    remaining = {s.skill_id: s for s in scored}
    emitted: set[str] = set()
    order: list[NextStep] = []
    while remaining:
        ready = [s for sid, s in remaining.items() if prereqs[sid] <= emitted]
        if not ready:
            # Defensive: a dependency cycle within candidates (the graph should
            # be a DAG). Fall back to the highest-score remaining so we stay
            # total and terminating instead of looping forever.
            ready = list(remaining.values())
        ready.sort(key=lambda s: (-s.next_score, s.skill_id))
        nxt = ready[0]
        order.append(nxt)
        emitted.add(nxt.skill_id)
        del remaining[nxt.skill_id]
    return order


def select_next_steps(
    role_id: str,
    obs: dict[str, SkillObservation],
    max_steps: int = MAX_NEXT_STEPS,
    orientation_id: str = competency.ORIENTATION_BASE,
    lang: str = "en",
    exclude_skill_ids: set[str] | None = None,
) -> list[NextStep]:
    """Two-layer deterministic ranking.

    Layer 1 — Main ranking: gap_score × migration_value × learnability_boost.
        ALL skills with gap > 0 participate (no hard filtering).
        Priority = "what matters most for career migration".
        When user's average level is low (beginner), learnability is added as
        a boost factor so high-learnability skills surface before hard skills.

    Layer 2 — Topological ordering (Kahn's algorithm):
        Guarantees no skill appears before its prerequisite.
        Within the topological order, higher priority wins.

    This ensures RAG, function calling etc. (deep in the dependency chain)
    still appear in recommendations — the topo sort just makes sure their
    prerequisites come first.
    """
    gaps = compute_gaps(role_id, obs, orientation_id)
    gap_by_skill = {g.req.skill_id: g for g in gaps}

    candidates = [
        g for g in gaps
        if g.gap > 0 and (not exclude_skill_ids or g.req.skill_id not in exclude_skill_ids)
    ]
    dependents = _dependents_map()

    from app.domain._capsule_migration import get_migration_value

    # Beginner boost: when the user's average observed level is very low (≤1),
    # learnability is added as a tie-breaker so high-learnability skills (Prompt,
    # streaming) surface before high-gap but hard skills (vector search, rerank).
    observed_levels = [o.level for o in obs.values() if o.level > 0]
    avg_level = sum(observed_levels) / len(observed_levels) if observed_levels else 0
    beginner_boost = max(0.0, 1.0 - avg_level / 2)  # 1.0 at avg=0, 0 at avg=2+

    scored: list[NextStep] = []
    for g in candidates:
        sid = g.req.skill_id
        skill = competency.SKILLS_BY_ID[sid]

        blocked_by = [
            dep for dep in competency.dependencies_of(sid)
            if (dg := gap_by_skill.get(dep)) and dg.gap > 0
        ]
        unblocks = [
            d for d in dependents.get(sid, [])
            if (dg := gap_by_skill.get(d)) and dg.gap > 0
        ]

        mv = get_migration_value(sid)
        priority = g.gap_score * mv * (1 + beginner_boost * skill.learnability)

        components = {
            "gap_score": round(g.gap_score, 4),
            "requirement_weight": round(g.req.weight, 4),
            "migration_value": round(mv, 4),
            "priority": round(priority, 4),
            "learnability": round(skill.learnability, 4),
            "unblocks_count": len(unblocks),
            "blocked_by_count": len(blocked_by),
        }

        title, why, steps, criteria = _action_blueprint(g, unblocks, blocked_by, lang)
        scored.append(
            NextStep(
                rank=0,
                skill_id=sid,
                skill_name=competency.skill_name(sid, lang),
                category=skill.category,
                current_level=g.level,
                target_level=g.req.min_level,
                action_title=title,
                why=why,
                action_steps=steps,
                acceptance_criteria=criteria,
                next_score=round(priority, 4),
                unblocks=unblocks,
                blocked_by=blocked_by,
                score_components=components,
            )
        )

    # Topological ordering: prerequisites first, then by priority within each layer
    ordered = _priority_topological_order(scored)
    top = ordered[: max(1, max_steps)]
    for i, ns in enumerate(top, start=1):
        ns.rank = i
    return top


# --------------------------------------------------------------------------- #
# Action prescription (plan 6.3) — deterministic templates
# --------------------------------------------------------------------------- #
def _action_blueprint(
    g: GapInfo, unblocks: list[str], blocked_by: list[str], lang: str = "en"
) -> tuple[str, str, list[str], list[str]]:
    skill = competency.SKILLS_BY_ID[g.req.skill_id]
    sep = t(lang, "join.sep")
    title = t(
        lang,
        "blueprint.title",
        skill=competency.skill_name(skill.id, lang),
        cur=g.level,
        target=g.req.min_level,
    )

    req_type = t(lang, "type.required" if g.req.type == "required" else "type.bonus")
    why_parts = [
        t(lang, "why.weight", weight=g.req.weight, type=req_type, gap=g.gap)
    ]
    if unblocks:
        names = sep.join(competency.skill_name(s, lang) for s in unblocks[:3])
        why_parts.append(t(lang, "why.unblocks", names=names))
    if blocked_by:
        names = sep.join(competency.skill_name(s, lang) for s in blocked_by[:3])
        why_parts.append(t(lang, "why.blocked", names=names))
    if skill.learnability >= 0.7:
        why_parts.append(t(lang, "why.transfer", pct=int(skill.learnability * 100)))
    why = "".join(why_parts)

    blueprints = _SKILL_BLUEPRINTS_EN if lang == "en" else _SKILL_BLUEPRINTS
    categories = _CATEGORY_BLUEPRINTS_EN if lang == "en" else _CATEGORY_BLUEPRINTS
    blueprint = blueprints.get(skill.id) or categories[skill.category]
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

# English category-level fallback templates (mirror of _CATEGORY_BLUEPRINTS).
_CATEGORY_BLUEPRINTS_EN: dict[str, dict[str, list[str]]] = {
    "foundation": {
        "steps": [
            "Take a frontend project you've built and list its backend contracts and boundaries",
            "Rewrite one of its endpoints in FastAPI, adding auth and unified error handling",
            "Add request logging and a health-check endpoint",
            "Containerize the service and deploy it to a free platform",
        ],
        "acceptance": [
            "Submit a reachable endpoint URL or repo link",
            "Attach an API contract (inputs/outputs/error codes)",
        ],
    },
    "data": {
        "steps": [
            "Pick a document set you know well (e.g. a team wiki) as the corpus",
            "Build a minimal clean → chunking → embedding pipeline",
            "Write the vectors into pgvector and run a similarity search end to end",
            "Compare recall across 2 chunking strategies and record the difference",
        ],
        "acceptance": [
            "Submit a runnable retrieval demo repo",
            "Attach a one-page chunking-strategy comparison note",
        ],
    },
    "llm": {
        "steps": [
            "Write a prompt with role/constraints/examples for a real task",
            "Add a JSON schema constraint and validate the output",
            "Wire in one function/tool call to close the loop",
            "Record cost and latency, then do a round of prompt trimming",
        ],
        "acceptance": [
            "Submit a runnable LLM-feature demo",
            "Attach the prompt design notes and one failure-then-fix record",
        ],
    },
    "eval": {
        "steps": [
            "Curate 20-50 eval examples (input + expected) for your AI feature",
            "Define 2-3 quality metrics (accuracy/coverage/hallucination rate)",
            "Run one round of offline eval and produce a baseline score",
            "Change one variable, evaluate again, and compare results",
        ],
        "acceptance": [
            "Submit the eval set and scripts",
            "Attach a baseline-vs-improvement comparison report",
        ],
    },
}

# English skill-specific blueprints (mirror of _SKILL_BLUEPRINTS).
_SKILL_BLUEPRINTS_EN: dict[str, dict[str, list[str]]] = {
    "data.chunking": {
        "steps": [
            "Learn the three strategies: fixed-window / semantic / recursive splitting",
            "Chunk the same document with all 3 strategies and inspect boundary quality",
            "Implement a structure-preserving splitter for documents with heading levels",
            "Test recall with a set of questions and record which strategy wins",
        ],
        "acceptance": [
            "Submit the splitter code",
            "Attach a recall comparison table for the 3 strategies",
        ],
    },
    "data.embedding": {
        "steps": [
            "Compare at least 2 embedding models (dimensions/cost/quality)",
            "Generate vectors for the same corpus with each and store them",
            "Evaluate Top-k hit rate of both with the same batch of queries",
            "Write down your selection conclusion and the fitting scenarios",
        ],
        "acceptance": [
            "Submit a reproducible evaluation script",
            "Attach a one-page embedding-selection conclusion",
        ],
    },
    "data.vector_search": {
        "steps": [
            "Install pgvector on Postgres and create a vector table",
            "Build an HNSW index and run a nearest-neighbor search end to end",
            "Add structured filtering (pre-filter by skill/level) before searching",
            "Stress-test how different ef/index params affect recall and latency",
        ],
        "acceptance": [
            "Submit the table-creation + search SQL/code",
            "Attach measured recall and latency data",
        ],
    },
    "data.retrieval_rerank": {
        "steps": [
            "Build a two-stage 'vector recall → rerank' retrieval pipeline",
            "Implement rule-based reranking: weighted relevance/freshness/fit scoring",
            "Score the Top10 once with an LLM (fixed rubric) and compare effects",
            "Record the quality change of the Top3 before vs after reranking",
        ],
        "acceptance": [
            "Submit a runnable retrieval + rerank demo",
            "Attach a before/after reranking comparison record",
        ],
    },
    "llm.prompt": {
        "steps": [
            "Pick a real task and write a structured prompt with role/task/constraints/examples",
            "Iterate 2-3 rounds, changing only one variable per round",
            "Catalog common failure modes and the matching prompt fixes",
            "Distill it into a reusable prompt template",
        ],
        "acceptance": [
            "Submit the prompt template and iteration log",
            "Attach a set of input/output samples",
        ],
    },
    "llm.structured_output": {
        "steps": [
            "Define the target output schema with Pydantic/Zod",
            "Have the model output JSON and validate it strictly",
            "Implement a fallback/retry strategy when validation fails",
            "Test stability against edge-case inputs",
        ],
        "acceptance": [
            "Submit code with schema validation",
            "Attach test cases for the failure fallback",
        ],
    },
    "llm.function_calling": {
        "steps": [
            "Define the function signatures and descriptions for 1-2 tools",
            "Let the model call them on demand and parse the arguments",
            "Feed tool results back to the model to close the loop",
            "Handle a case where the model picks the wrong tool",
        ],
        "acceptance": [
            "Submit a runnable function-calling demo",
            "Attach the tool definitions and one error-correction record",
        ],
    },
    "llm.tool_use": {
        "steps": [
            "Design a task that requires 2+ tools working together",
            "Implement tool orchestration and intermediate-state passing",
            "Add failure retries and timeout handling",
            "Record one end-to-end trace of the multi-tool chain",
        ],
        "acceptance": [
            "Submit a multi-tool orchestration demo",
            "Attach one end-to-end call-chain trace",
        ],
    },
    "eval.offline": {
        "steps": [
            "Curate 30+ eval examples around your AI feature",
            "Separate them into 'normal / edge / adversarial' categories",
            "Write a re-runnable offline evaluation script",
            "Produce the first baseline score",
        ],
        "acceptance": [
            "Submit the eval set (with labels)",
            "Attach a baseline evaluation report",
        ],
    },
    "eval.metrics": {
        "steps": [
            "Define computable definitions for accuracy/coverage/hallucination rate",
            "Implement automatic computation of these metrics on the offline eval set",
            "Do a metric comparison for one change",
            "Wire the metrics into the checklist for every iteration",
        ],
        "acceptance": [
            "Submit the metric-computation code",
            "Attach a metric comparison for one change",
        ],
    },
    "eng.api_design": {
        "steps": [
            "Design a clear API contract for an AI feature (inputs/outputs/error codes)",
            "Implement it with FastAPI, adding auth and unified error handling",
            "Add request logging and observability instrumentation",
            "Write an API doc and self-test it",
        ],
        "acceptance": [
            "Submit the API repo or a reachable URL",
            "Attach the API contract doc",
        ],
    },
}
