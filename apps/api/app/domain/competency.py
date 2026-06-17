"""Competency model for the MVP role: 前端工程师 -> AI Engineer (应用向).

This is the deterministic backbone of Zeno. The decision/expression split
(see project plan) keeps gap & ranking reproducible; the LLM only rephrases.

Skills are grouped into 4 competency areas:
    - foundation : 工程地基 (transferable from frontend)
    - data       : 数据与检索 (RAG 地基)
    - llm        : LLM 应用能力
    - eval       : 评估与迭代 (差异化点)

Each Skill carries `learnability` (0-1): how transferable a frontend
background is. RoleRequirement carries `weight`, `min_level`, `type`
(required/bonus) and `branch_impact` (0/1) used by the orchestrator.
"""

from dataclasses import dataclass, field

ROLE_AI_ENGINEER_APPLIED = "ai_engineer_applied"

# Level 0-4 reference descriptions (shared rubric, plan 4.2)
LEVEL_RUBRIC: dict[int, str] = {
    0: "不了解",
    1: "跟教程可跑通",
    2: "能独立做小功能",
    3: "能在真实项目交付并排障",
    4: "能设计系统、优化与治理",
}


@dataclass(frozen=True)
class Skill:
    id: str
    name: str
    category: str  # foundation | data | llm | eval
    learnability: float  # 0-1, frontend -> this skill transferability


@dataclass(frozen=True)
class RoleRequirement:
    role_id: str
    skill_id: str
    min_level: int
    weight: float  # 0-1
    type: str  # required | bonus
    branch_impact: int  # 0/1 — does knowing this change the recommended path?


@dataclass(frozen=True)
class SkillDependency:
    skill_id: str
    depends_on: str


# --------------------------------------------------------------------------- #
# Skills
# --------------------------------------------------------------------------- #
SKILLS: list[Skill] = [
    # A. 工程地基 (foundation) — highly transferable
    Skill("eng.api_design", "API 设计与契约", "foundation", 0.8),
    Skill("eng.auth", "鉴权与安全基线", "foundation", 0.6),
    Skill("eng.error_handling", "错误处理与重试", "foundation", 0.75),
    Skill("eng.observability", "可观测性（日志/指标/trace）", "foundation", 0.5),
    Skill("eng.deploy", "部署与 CI/CD", "foundation", 0.6),
    Skill("eng.typescript", "TypeScript 工程化", "foundation", 0.95),
    # B. 数据与检索 (data) — RAG 地基
    Skill("data.text_processing", "文本清洗与预处理", "data", 0.5),
    Skill("data.chunking", "文档切分（chunking）", "data", 0.55),
    Skill("data.embedding", "向量化与 embedding 选型", "data", 0.5),
    Skill("data.vector_search", "向量检索（pgvector/HNSW）", "data", 0.45),
    Skill("data.retrieval_rerank", "召回与重排（rerank）", "data", 0.4),
    Skill("data.quality", "数据质量与去重", "data", 0.5),
    # C. LLM 应用能力 (llm)
    Skill("llm.prompt", "Prompt 结构设计", "llm", 0.7),
    Skill("llm.structured_output", "结构化输出 / JSON schema 约束", "llm", 0.65),
    Skill("llm.function_calling", "函数 / 工具调用", "llm", 0.55),
    Skill("llm.tool_use", "多工具编排", "llm", 0.5),
    Skill("llm.agent_state", "Agent 状态与记忆", "llm", 0.4),
    Skill("llm.cost_latency", "成本与延迟优化", "llm", 0.5),
    Skill("llm.streaming", "流式输出与前端集成", "llm", 0.9),
    # D. 评估与迭代 (eval) — 最容易被忽略，差异点
    Skill("eval.offline", "离线评估集构建", "eval", 0.4),
    Skill("eval.online", "在线反馈采集", "eval", 0.45),
    Skill("eval.ab", "A/B 实验", "eval", 0.45),
    Skill("eval.metrics", "质量指标（准确/覆盖/幻觉率）", "eval", 0.4),
]

SKILLS_BY_ID: dict[str, Skill] = {s.id: s for s in SKILLS}


# --------------------------------------------------------------------------- #
# Role requirements (ai_engineer_applied)
# --------------------------------------------------------------------------- #
ROLE_REQUIREMENTS: list[RoleRequirement] = [
    # foundation
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "eng.api_design", 3, 0.8, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "eng.auth", 2, 0.4, "bonus", 0),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "eng.error_handling", 2, 0.5, "required", 0),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "eng.observability", 2, 0.5, "bonus", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "eng.deploy", 2, 0.6, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "eng.typescript", 3, 0.5, "required", 0),
    # data
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "data.text_processing", 2, 0.5, "required", 0),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "data.chunking", 2, 0.7, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "data.embedding", 2, 0.7, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "data.vector_search", 3, 0.9, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "data.retrieval_rerank", 2, 0.8, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "data.quality", 2, 0.5, "bonus", 0),
    # llm
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "llm.prompt", 3, 0.9, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "llm.structured_output", 3, 0.8, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "llm.function_calling", 2, 0.8, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "llm.tool_use", 2, 0.7, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "llm.agent_state", 2, 0.6, "bonus", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "llm.cost_latency", 2, 0.6, "required", 0),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "llm.streaming", 2, 0.5, "bonus", 0),
    # eval
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "eval.offline", 2, 0.7, "required", 1),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "eval.online", 1, 0.5, "bonus", 0),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "eval.ab", 1, 0.4, "bonus", 0),
    RoleRequirement(ROLE_AI_ENGINEER_APPLIED, "eval.metrics", 2, 0.7, "required", 1),
]


# --------------------------------------------------------------------------- #
# Dependencies (skill -> depends_on)
# --------------------------------------------------------------------------- #
SKILL_DEPENDENCIES: list[SkillDependency] = [
    SkillDependency("data.chunking", "data.text_processing"),
    SkillDependency("data.embedding", "data.text_processing"),
    SkillDependency("data.vector_search", "data.embedding"),
    SkillDependency("data.retrieval_rerank", "data.vector_search"),
    SkillDependency("llm.function_calling", "llm.prompt"),
    SkillDependency("llm.structured_output", "llm.prompt"),
    SkillDependency("llm.tool_use", "llm.function_calling"),
    SkillDependency("llm.agent_state", "llm.tool_use"),
    SkillDependency("eval.metrics", "eval.offline"),
    SkillDependency("eval.ab", "eval.online"),
]


def requirements_for_role(role_id: str) -> list[RoleRequirement]:
    return [r for r in ROLE_REQUIREMENTS if r.role_id == role_id]


def requirement_by_skill(role_id: str) -> dict[str, RoleRequirement]:
    return {r.skill_id: r for r in requirements_for_role(role_id)}


def dependencies_of(skill_id: str) -> list[str]:
    return [d.depends_on for d in SKILL_DEPENDENCIES if d.skill_id == skill_id]
