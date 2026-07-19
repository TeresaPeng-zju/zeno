/**
 * Offline mock backend for Zeno's web flow.
 *
 * Enabled by `NEXT_PUBLIC_USE_MOCK=1` (see lib/api.ts). It implements the same
 * surface as `api` so the whole flow — home → /skills → /result — runs with no
 * API/DB. Data mirrors the real catalog (apps/api/app/domain/competency.py) and
 * a plausible "Frontend Engineer → AI Engineer" profile, and reacts to the chosen
 * orientation (base | rag) and the result-page time budget.
 *
 * i18n: the mock is bilingual. It reads the same `ZENO_LOCALE` cookie that
 * lib/api.ts uses for `Accept-Language`, and serves English (default) or Chinese
 * content — mirroring the backend's expression layer so offline previews match
 * the live, localized API.
 */

import type {
  AssessmentPlanResponse,
  ExperienceCapsulesResponse,
  NextQuestionResponse,
  OrientationOut,
  JdMatchResponse,
  PathsResponse,
  ProficiencyOptionOut,
  ResourceOut,
  ResultResponse,
  SessionCreateResponse,
  SkillCatalogResponse,
  SkillGroupOut,
  SkillProfileOut,
  StrengthOut,
  GapOut,
  NextStepOut,
  PacingOut,
  QuestionOut,
  TimeBudget,
} from "./api";

// --------------------------------------------------------------------------- //
// Locale (read the same cookie lib/api.ts uses for Accept-Language)
// --------------------------------------------------------------------------- //
type Locale = "en" | "zh";

function currentLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(/(?:^|;\s*)ZENO_LOCALE=([^;]+)/);
  return m?.[1] === "zh" ? "zh" : "en";
}

/** Bilingual literal; `pick(loc)` selects the right language. */
type Bi = { en: string; zh: string };
const pick = (b: Bi, loc: Locale): string => b[loc];

// --------------------------------------------------------------------------- //
// Tiny helpers
// --------------------------------------------------------------------------- //
const delay = <T,>(value: T, ms = 260): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const daysAgoISO = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

// --------------------------------------------------------------------------- //
// Catalog (mirrors competency.SKILLS / CATEGORY_ORDER / ANSWER_OPTIONS)
// --------------------------------------------------------------------------- //
const SKILL_NAMES: Record<string, Bi> = {
  "eng.api_design": { en: "API design & contracts", zh: "API 设计与契约" },
  "eng.auth": { en: "Auth & security baseline", zh: "鉴权与安全基线" },
  "eng.error_handling": { en: "Error handling & retries", zh: "错误处理与重试" },
  "eng.observability": {
    en: "Observability (logs/metrics/traces)",
    zh: "可观测性（日志/指标/trace）",
  },
  "eng.deploy": { en: "Deployment & CI/CD", zh: "部署与 CI/CD" },
  "eng.typescript": { en: "TypeScript engineering", zh: "TypeScript 工程化" },
  "data.text_processing": {
    en: "Text cleaning & preprocessing",
    zh: "文本清洗与预处理",
  },
  "data.chunking": { en: "Document chunking", zh: "文档切分（chunking）" },
  "data.embedding": { en: "Embedding & model selection", zh: "向量化与 embedding 选型" },
  "data.vector_search": {
    en: "Vector search (pgvector/HNSW)",
    zh: "向量检索（pgvector/HNSW）",
  },
  "data.retrieval_rerank": { en: "Retrieval & reranking", zh: "召回与重排（rerank）" },
  "data.quality": { en: "Data quality & dedup", zh: "数据质量与去重" },
  "llm.prompt": { en: "Prompt structure design", zh: "Prompt 结构设计" },
  "llm.structured_output": {
    en: "Structured output / JSON Schema",
    zh: "结构化输出 / JSON Schema 约束",
  },
  "llm.function_calling": { en: "Function / tool calling", zh: "函数 / 工具调用" },
  "llm.tool_use": { en: "Multi-tool orchestration", zh: "多工具编排" },
  "llm.agent_state": { en: "Agent state & memory", zh: "Agent 状态与记忆" },
  "llm.cost_latency": { en: "Cost & latency optimization", zh: "成本与延迟优化" },
  "llm.streaming": {
    en: "Streaming & frontend integration",
    zh: "流式输出与前端集成",
  },
  "eval.offline": { en: "Offline eval set construction", zh: "离线评估集构建" },
  "eval.online": { en: "Online feedback collection", zh: "在线反馈采集" },
  "eval.ab": { en: "A/B testing", zh: "A/B 实验" },
  "eval.metrics": {
    en: "Quality metrics (accuracy/coverage/hallucination)",
    zh: "质量指标（准确/覆盖/幻觉率）",
  },
};

const CATEGORY_META: Array<{ category: string; label: Bi; hint: Bi; skills: Array<[string, number]> }> = [
  {
    category: "foundation",
    label: { en: "Engineering foundation", zh: "工程地基" },
    hint: { en: "Skills transferable from frontend", zh: "可从前端迁移的能力" },
    skills: [
      ["eng.api_design", 0.8],
      ["eng.auth", 0.6],
      ["eng.error_handling", 0.75],
      ["eng.observability", 0.5],
      ["eng.deploy", 0.6],
      ["eng.typescript", 0.95],
    ],
  },
  {
    category: "data",
    label: { en: "Data & retrieval", zh: "数据与检索" },
    hint: { en: "The bedrock of RAG", zh: "RAG 的地基" },
    skills: [
      ["data.text_processing", 0.5],
      ["data.chunking", 0.55],
      ["data.embedding", 0.5],
      ["data.vector_search", 0.45],
      ["data.retrieval_rerank", 0.4],
      ["data.quality", 0.5],
    ],
  },
  {
    category: "llm",
    label: { en: "LLM applications", zh: "LLM 应用" },
    hint: { en: "Turn the model into product capability", zh: "把模型变成产品能力" },
    skills: [
      ["llm.prompt", 0.7],
      ["llm.structured_output", 0.65],
      ["llm.function_calling", 0.55],
      ["llm.tool_use", 0.5],
      ["llm.agent_state", 0.4],
      ["llm.cost_latency", 0.5],
      ["llm.streaming", 0.9],
    ],
  },
  {
    category: "eval",
    label: { en: "Evaluation & iteration", zh: "评估与迭代" },
    hint: { en: "The most overlooked differentiator", zh: "最容易被忽略的差异点" },
    skills: [
      ["eval.offline", 0.4],
      ["eval.online", 0.45],
      ["eval.ab", 0.45],
      ["eval.metrics", 0.4],
    ],
  },
];

const PROFICIENCY_META: Array<{ value: string; label: Bi; level: number }> = [
  { value: "none", label: { en: "Never touched it", zh: "完全没接触过" }, level: 0 },
  {
    value: "tutorial",
    label: { en: "Read docs / followed a tutorial", zh: "看过资料 / 跟教程跑通过" },
    level: 1,
  },
  {
    value: "demo",
    label: { en: "Built a small personal feature / demo", zh: "做过个人小功能 / demo" },
    level: 2,
  },
  {
    value: "shipped",
    label: {
      en: "Shipped & debugged it in a real project",
      zh: "在真实项目里交付并排障过",
    },
    level: 3,
  },
  {
    value: "expert",
    label: {
      en: "Designed / optimized such systems, can govern them",
      zh: "设计 / 优化过相关系统，能治理",
    },
    level: 4,
  },
];

const ORIENTATION_META: Array<{ id: string; label: Bi; description: Bi }> = [
  {
    id: "base",
    label: { en: "General AI apps", zh: "通用 AI 应用" },
    description: {
      en: "Not sure where to focus? Start here. Covers the all-round fundamentals of AI app development — data, models, and evaluation in balance.",
      zh: "不确定方向？选这个。覆盖 AI 应用开发的全部基础能力，数据、模型、评估都均衡涉及。",
    },
  },
  {
    id: "rag",
    label: { en: "Q&A & knowledge bases", zh: "智能问答 / 知识库" },
    description: {
      en: "Build AI that searches and answers from your own documents (knowledge-base Q&A, doc assistants). Focuses on retrieval — helping the AI find and use the right information accurately.",
      zh: "想做能查资料、答问题的 AI（如企业知识库问答、文档助手）。重点练「让 AI 准确找到并用对资料」的检索能力。",
    },
  },
];

const SKILL_CATEGORY: Record<string, string> = {};
for (const g of CATEGORY_META) {
  for (const [sid] of g.skills) SKILL_CATEGORY[sid] = g.category;
}

const name = (id: string, loc: Locale) =>
  SKILL_NAMES[id] ? pick(SKILL_NAMES[id], loc) : id;
const cat = (id: string) => SKILL_CATEGORY[id] ?? "foundation";

function buildCatalog(loc: Locale): SkillCatalogResponse {
  const groups: SkillGroupOut[] = CATEGORY_META.map((g) => ({
    category: g.category,
    label: pick(g.label, loc),
    hint: pick(g.hint, loc),
    skills: g.skills.map(([sid, learnability]) => ({
      skill_id: sid,
      name: name(sid, loc),
      learnability,
    })),
  }));
  const proficiency: ProficiencyOptionOut[] = PROFICIENCY_META.map((p) => ({
    value: p.value,
    label: pick(p.label, loc),
    level: p.level,
  }));
  const orientations: OrientationOut[] = ORIENTATION_META.map((o) => ({
    id: o.id,
    label: pick(o.label, loc),
    description: pick(o.description, loc),
  }));
  return { groups, proficiency, orientations };
}

// --------------------------------------------------------------------------- //
// A plausible frontend-engineer profile (level 0-4, confidence 0-1)
// --------------------------------------------------------------------------- //
const PROFILE_LEVELS: Record<string, { level: number; confidence: number }> = {
  "eng.api_design": { level: 3, confidence: 0.85 },
  "eng.auth": { level: 2, confidence: 0.7 },
  "eng.error_handling": { level: 3, confidence: 0.85 },
  "eng.observability": { level: 1, confidence: 0.5 },
  "eng.deploy": { level: 2, confidence: 0.7 },
  "eng.typescript": { level: 4, confidence: 0.9 },
  "data.text_processing": { level: 1, confidence: 0.5 },
  "data.chunking": { level: 0, confidence: 0.6 },
  "data.embedding": { level: 1, confidence: 0.5 },
  "data.vector_search": { level: 0, confidence: 0.6 },
  "data.retrieval_rerank": { level: 0, confidence: 0.6 },
  "data.quality": { level: 1, confidence: 0.5 },
  "llm.prompt": { level: 2, confidence: 0.7 },
  "llm.structured_output": { level: 2, confidence: 0.7 },
  "llm.function_calling": { level: 1, confidence: 0.5 },
  "llm.tool_use": { level: 1, confidence: 0.5 },
  "llm.agent_state": { level: 0, confidence: 0.6 },
  "llm.cost_latency": { level: 1, confidence: 0.5 },
  "llm.streaming": { level: 3, confidence: 0.85 },
  "eval.offline": { level: 0, confidence: 0.6 },
  "eval.online": { level: 1, confidence: 0.5 },
  "eval.ab": { level: 1, confidence: 0.5 },
  "eval.metrics": { level: 0, confidence: 0.6 },
};

function buildProfile(loc: Locale): SkillProfileOut[] {
  return Object.entries(PROFILE_LEVELS).map(([skill_id, { level, confidence }]) => ({
    skill_id,
    skill_name: name(skill_id, loc),
    category: cat(skill_id),
    level,
    confidence,
  }));
}

const STRENGTH_SEEDS: Array<{ skill_id: string; level: number; reason: Bi }> = [
  {
    skill_id: "eng.typescript",
    level: 4,
    reason: {
      en: "Deep TypeScript engineering experience transfers directly to type contracts and tooling for AI apps.",
      zh: "TypeScript 工程化经验深厚，能直接迁移到 AI 应用的类型契约与工具链建设。",
    },
  },
  {
    skill_id: "eng.api_design",
    level: 3,
    reason: {
      en: "Solid API design & contract skills are the key foundation for building maintainable LLM backends.",
      zh: "扎实的 API 设计与契约能力，是搭建可维护 LLM 服务端的关键底座。",
    },
  },
  {
    skill_id: "eng.error_handling",
    level: 3,
    reason: {
      en: "Error handling & retry experience maps directly to fallback and fault tolerance for LLM calls.",
      zh: "错误处理与重试经验，直接对应 LLM 调用的降级与容错。",
    },
  },
  {
    skill_id: "llm.streaming",
    level: 3,
    reason: {
      en: "Streaming output & frontend integration is a natural edge — you can quickly build great AI interactions.",
      zh: "流式输出与前端集成是你的天然优势，能快速做出体验出色的 AI 交互。",
    },
  },
];

function buildStrengths(loc: Locale): StrengthOut[] {
  return STRENGTH_SEEDS.map((s) => ({
    skill_id: s.skill_id,
    skill_name: name(s.skill_id, loc),
    category: cat(s.skill_id),
    level: s.level,
    reason: pick(s.reason, loc),
  }));
}

// --------------------------------------------------------------------------- //
// Gaps & next-steps (vary by orientation + time budget)
// --------------------------------------------------------------------------- //
function buildGaps(orientation: string, loc: Locale): GapOut[] {
  // [skill, target, weight, type] — rag bumps data targets/weights & promotes quality
  const rag = orientation === "rag";
  const rows: Array<[string, number, number, "required" | "bonus"]> = [
    ["data.vector_search", rag ? 4 : 3, rag ? 1.0 : 0.9, "required"],
    ["data.retrieval_rerank", rag ? 3 : 2, rag ? 1.0 : 0.8, "required"],
    ["data.chunking", rag ? 3 : 2, rag ? 0.9 : 0.7, "required"],
    ["data.embedding", 2, rag ? 0.9 : 0.7, "required"],
    ["eval.offline", 2, 0.7, "required"],
    ["eval.metrics", 2, rag ? 0.8 : 0.7, "required"],
    ["llm.prompt", 3, 0.9, "required"],
    ["llm.structured_output", 3, 0.8, "required"],
    ["llm.function_calling", 2, 0.8, "required"],
    ["data.text_processing", 2, 0.5, "required"],
    ["data.quality", 2, rag ? 0.75 : 0.5, rag ? "required" : "bonus"],
  ];

  const gaps: GapOut[] = [];
  for (const [skill_id, target_level, weight, type] of rows) {
    const current_level = PROFILE_LEVELS[skill_id]?.level ?? 0;
    const gap = target_level - current_level;
    if (gap <= 0) continue;
    gaps.push({
      skill_id,
      skill_name: name(skill_id, loc),
      category: cat(skill_id),
      current_level,
      target_level,
      gap,
      type,
      weight,
      gap_score: Math.round(gap * weight * 100) / 100,
    });
  }
  gaps.sort((a, b) => b.gap_score - a.gap_score);
  return gaps;
}

const RESOURCES: Record<string, Array<{
  title: Bi;
  url: string;
  platform: string;
  daysAgo: number;
  freshness_reason: Bi;
}>> = {
  "data.embedding": [
    {
      title: {
        en: "OpenAI Embeddings guide: model selection & best practices",
        zh: "OpenAI Embeddings 指南：模型选型与最佳实践",
      },
      url: "https://platform.openai.com/docs/guides/embeddings",
      platform: "OpenAI Docs",
      daysAgo: 6,
      freshness_reason: { en: "Official docs, continuously updated", zh: "官方文档，持续更新" },
    },
    {
      title: {
        en: "Pinecone: from vectorization to retrieval in practice",
        zh: "Pinecone：向量化入门到检索实战",
      },
      url: "https://www.pinecone.io/learn/vector-embeddings/",
      platform: "Pinecone Learn",
      daysAgo: 18,
      freshness_reason: { en: "Verified valid within the last 30 days", zh: "近 30 天内核验有效" },
    },
  ],
  "data.vector_search": [
    {
      title: {
        en: "pgvector + HNSW: high-performance vector search in Postgres",
        zh: "pgvector + HNSW：在 Postgres 里做高性能向量检索",
      },
      url: "https://github.com/pgvector/pgvector",
      platform: "GitHub",
      daysAgo: 3,
      freshness_reason: { en: "Actively maintained, growing stars", zh: "活跃维护，star 持续增长" },
    },
    {
      title: {
        en: "Supabase: build semantic search with pgvector",
        zh: "Supabase：用 pgvector 构建语义搜索",
      },
      url: "https://supabase.com/docs/guides/ai/vector-columns",
      platform: "Supabase Docs",
      daysAgo: 11,
      freshness_reason: { en: "Verified valid within the last 30 days", zh: "近 30 天内核验有效" },
    },
  ],
  "data.retrieval_rerank": [
    {
      title: {
        en: "Cohere Rerank: boost relevance by reranking after recall",
        zh: "Cohere Rerank：召回后重排提升相关性",
      },
      url: "https://docs.cohere.com/docs/reranking",
      platform: "Cohere Docs",
      daysAgo: 9,
      freshness_reason: { en: "Verified valid within the last 30 days", zh: "近 30 天内核验有效" },
    },
  ],
  "llm.structured_output": [
    {
      title: {
        en: "Structured Outputs: constrain model output with JSON Schema",
        zh: "Structured Outputs：用 JSON Schema 约束模型输出",
      },
      url: "https://platform.openai.com/docs/guides/structured-outputs",
      platform: "OpenAI Docs",
      daysAgo: 5,
      freshness_reason: { en: "Official docs, continuously updated", zh: "官方文档，持续更新" },
    },
  ],
  "eval.offline": [
    {
      title: {
        en: "Ragas: an offline evaluation framework for RAG systems",
        zh: "Ragas：RAG 系统的离线评测框架",
      },
      url: "https://docs.ragas.io/",
      platform: "Ragas Docs",
      daysAgo: 14,
      freshness_reason: { en: "Verified valid within the last 30 days", zh: "近 30 天内核验有效" },
    },
  ],
};

function resourcesFor(skillId: string, loc: Locale): ResourceOut[] {
  return (RESOURCES[skillId] ?? []).map((r) => ({
    title: pick(r.title, loc),
    url: r.url,
    platform: r.platform,
    last_verified_at: daysAgoISO(r.daysAgo),
    freshness_reason: pick(r.freshness_reason, loc),
  }));
}

type StepSeed = {
  skill_id: string;
  target_level: number;
  action_title: Bi;
  why: Bi;
  action_steps: Bi[];
  acceptance_criteria: Bi[];
  est_weeks: number;
  unblocks: string[];
  blocked_by: string[];
};

function stepSeeds(orientation: string): StepSeed[] {
  const seeds: StepSeed[] = [
    {
      skill_id: "data.embedding",
      target_level: 2,
      action_title: {
        en: "Master vectorization: pick an embedding model and load documents",
        zh: "搞懂向量化：选型 embedding 并把文档入库",
      },
      why: {
        en: "The bedrock of vector search. Getting embedding right unlocks downstream vector search and reranking — the highest-leverage step right now.",
        zh: "向量检索的地基。打通 embedding 才能解锁后续的向量检索与重排，是当前杠杆最高的一步。",
      },
      action_steps: [
        {
          en: "Vectorize a real document set with text-embedding-3-small",
          zh: "用 text-embedding-3-small 对一份真实文档集做向量化",
        },
        {
          en: "Write the vectors into a pgvector table, recording dimensions and normalization strategy",
          zh: "把向量写入 pgvector 表，记录维度与归一化策略",
        },
        {
          en: "Compare recall of 1-2 models on your own corpus",
          zh: "对比 1-2 个模型在你的语料上的召回差异",
        },
      ],
      acceptance_criteria: [
        {
          en: "Can explain the chosen embedding model's dimensions, cost and fit",
          zh: "能说明所选 embedding 模型的维度、成本与适用场景",
        },
        {
          en: "Submit a reproducible ingestion script and sample queries",
          zh: "提交一段可复现的入库脚本与样例查询",
        },
      ],
      est_weeks: 1,
      unblocks: ["data.vector_search"],
      blocked_by: [],
    },
    {
      skill_id: "data.vector_search",
      target_level: orientation === "rag" ? 4 : 3,
      action_title: {
        en: "Build a usable semantic search with pgvector + HNSW",
        zh: "用 pgvector + HNSW 搭一套可用的语义检索",
      },
      why: {
        en: "The highest-weighted must-have for the target role; even more central for RAG. Maps directly to the pgvector/HNSW retrieval pipeline on your résumé.",
        zh: "目标岗位权重最高的必备能力；RAG 向更是核心。直接对应你简历里的 pgvector/HNSW 检索链路。",
      },
      action_steps: [
        {
          en: "Create an HNSW index on the vector column (vector_cosine_ops)",
          zh: "为向量列建立 HNSW 索引（vector_cosine_ops）",
        },
        {
          en: "Implement top-k cosine recall and measure P95 latency",
          zh: "实现 top-k 余弦召回，并测量 P95 延迟",
        },
        {
          en: "Tune ef_search / m and observe the recall-latency trade-off",
          zh: "调 ef_search / m 参数观察召回-延迟权衡",
        },
      ],
      acceptance_criteria: [
        {
          en: "A query reliably returns relevant top-k results",
          zh: "一个查询能稳定返回相关 top-k 结果",
        },
        {
          en: "Can explain how key HNSW params affect recall and latency",
          zh: "能解释 HNSW 关键参数对召回率与延迟的影响",
        },
      ],
      est_weeks: 2,
      unblocks: ["data.retrieval_rerank"],
      blocked_by: ["data.embedding"],
    },
    {
      skill_id: "llm.structured_output",
      target_level: 3,
      action_title: {
        en: "Constrain LLM output with a JSON Schema and validate it",
        zh: "用 JSON Schema 约束 LLM 输出并做校验",
      },
      why: {
        en: "The key to turning the model into a reliable service; quick to pick up given your existing TypeScript / API contract skills.",
        zh: "把模型变成可靠服务的关键，配合你已有的 TypeScript / API 契约能力能快速上手。",
      },
      action_steps: [
        {
          en: "Define an output schema for a real task (Pydantic / zod)",
          zh: "为一个真实任务定义输出 schema（Pydantic / zod）",
        },
        {
          en: "Wire in structured outputs and handle the validation-failure fallback",
          zh: "接入 structured outputs 并处理校验失败的 fallback",
        },
        {
          en: "Add a set of unit tests targeting the schema",
          zh: "补一组针对 schema 的单元测试",
        },
      ],
      acceptance_criteria: [
        {
          en: "Model output passes the schema 100% of the time, or degrades safely",
          zh: "模型输出 100% 通过 schema 校验或安全降级",
        },
        {
          en: "Regression tests cover the error branches",
          zh: "有可回归的测试覆盖异常分支",
        },
      ],
      est_weeks: 1,
      unblocks: ["llm.function_calling"],
      blocked_by: [],
    },
    {
      skill_id: "data.retrieval_rerank",
      target_level: orientation === "rag" ? 3 : 2,
      action_title: {
        en: "Add a reranking layer on top of recall to boost relevance",
        zh: "在召回之上加一层重排，提升相关性",
      },
      why: {
        en: "The watershed of RAG quality: multi-signal reranking can significantly lift top-3 hit rate. The most worthwhile step for the retrieval track.",
        zh: "RAG 质量的分水岭：多信号重排能显著拉高 top-3 命中。是检索向最值得投入的一步。",
      },
      action_steps: [
        {
          en: "Wire a rerank model or rules on top of recall results",
          zh: "在召回结果上接入一个 rerank 模型或规则",
        },
        {
          en: "Do multi-signal scoring with relevance/freshness/fit",
          zh: "用相关性/时效性/适配度做多信号打分",
        },
        {
          en: "Compare NDCG@10 before and after reranking on an offline eval set",
          zh: "用离线评测集对比重排前后的 NDCG@10",
        },
      ],
      acceptance_criteria: [
        {
          en: "NDCG@10 / Top-3 hit shows a quantifiable lift over baseline after reranking",
          zh: "重排后 NDCG@10 / Top-3 命中相比基线有可量化提升",
        },
        {
          en: "Can articulate the weight and trade-off of each signal",
          zh: "能讲清每个信号的权重与取舍",
        },
      ],
      est_weeks: 2,
      unblocks: [],
      blocked_by: ["data.vector_search"],
    },
    {
      skill_id: "eval.offline",
      target_level: 2,
      action_title: {
        en: "Build an offline eval set to make iteration quantifiable",
        zh: "建一套离线评测集，让迭代可量化",
      },
      why: {
        en: "The most overlooked yet most telling sign of engineering maturity. Without evaluation, optimization is just a gut feeling.",
        zh: "最容易被忽略、却最能体现工程成熟度的差异点。没有评测，优化就是凭感觉。",
      },
      action_steps: [
        {
          en: "Label 30-50 query-expectation pairs for the core scenarios",
          zh: "为核心场景标注 30-50 条查询-期望对",
        },
        {
          en: "Implement NDCG@10 / Top-3 hit / Recall@5 metrics",
          zh: "实现 NDCG@10 / Top-3 命中 / Recall@5 指标",
        },
        {
          en: "Wire the evaluation into a one-click runnable script",
          zh: "把评测接入一条可一键运行的脚本",
        },
      ],
      acceptance_criteria: [
        {
          en: "Any change can produce comparable metric numbers",
          zh: "任意一次改动都能跑出可对比的指标数字",
        },
        {
          en: "The eval set and runner are reproducible and regression-ready",
          zh: "评测集与 runner 可复现、可纳入回归",
        },
      ],
      est_weeks: 1,
      unblocks: [],
      blocked_by: [],
    },
  ];
  // RAG track surfaces retrieval/rerank earlier.
  if (orientation === "rag") {
    seeds.sort((a, b) => {
      const w = (s: StepSeed) => (s.skill_id.startsWith("data.") ? 0 : 1);
      return w(a) - w(b);
    });
  }
  return seeds;
}

function buildNextSteps(orientation: string, budget: TimeBudget, loc: Locale): NextStepOut[] {
  // parallelism / count scales with the budget
  const count = budget === "light" ? 2 : budget === "intense" ? 4 : 3;
  const seeds = stepSeeds(orientation).slice(0, count);
  return seeds.map((s, i) => {
    const current_level = PROFILE_LEVELS[s.skill_id]?.level ?? 0;
    return {
      rank: i + 1,
      skill_id: s.skill_id,
      skill_name: name(s.skill_id, loc),
      category: cat(s.skill_id),
      current_level,
      target_level: s.target_level,
      action_title: pick(s.action_title, loc),
      why: pick(s.why, loc),
      action_steps: s.action_steps.map((b) => pick(b, loc)),
      acceptance_criteria: s.acceptance_criteria.map((b) => pick(b, loc)),
      next_score: Math.round((s.target_level - current_level) * 0.85 * 100) / 100,
      est_weeks: s.est_weeks,
      unblocks: s.unblocks,
      blocked_by: s.blocked_by,
      recommended_resources: resourcesFor(s.skill_id, loc),
    };
  });
}

function buildPacing(budget: TimeBudget, steps: NextStepOut[], loc: Locale): PacingOut {
  const weekly = budget === "light" ? 3 : budget === "intense" ? 10 : 6;
  const parallelism = budget === "light" ? 1 : budget === "intense" ? 3 : 2;
  const serialWeeks = steps.reduce((acc, s) => acc + s.est_weeks, 0);
  const total = Math.max(1, Math.ceil(serialWeeks / parallelism));
  const n = steps.length;
  const summaryByBudget: Record<TimeBudget, Bi> = {
    light: {
      en: `At ~${weekly}h/week working a single track, you'll finish the ${n} highest-leverage steps in ~${total} weeks.`,
      zh: `每周约 ${weekly} 小时、单线推进，预计 ${total} 周完成当前最高杠杆的 ${n} 步。`,
    },
    standard: {
      en: `At ~${weekly}h/week with up to ${parallelism} tracks in parallel, you'll clear the core path's ${n} steps in ~${total} weeks.`,
      zh: `每周约 ${weekly} 小时、最多 ${parallelism} 线并行，预计 ${total} 周打通核心路径的 ${n} 步。`,
    },
    intense: {
      en: `At ${weekly}h+/week sprinting ${parallelism} tracks in parallel, you'll land the ${n} key capabilities in ~${total} weeks.`,
      zh: `每周 ${weekly} 小时以上、${parallelism} 线并行冲刺，预计 ${total} 周拿下 ${n} 步关键能力。`,
    },
  };
  return {
    time_budget: budget,
    weekly_hours: weekly,
    parallelism,
    total_weeks: total,
    summary: pick(summaryByBudget[budget], loc),
  };
}

const NOTE: Bi = {
  en: "(Mock data) The results above are generated by a local mock to preview the full flow without a backend; once connected to the API they will be computed live by the deterministic decision engine.",
  zh: "（Mock 数据）以上结果由本地 mock 生成，用于无后端时预览全流程交互；连上 API 后将由确定性决策引擎实时计算。",
};

// --------------------------------------------------------------------------- //
// Session id encodes the chosen orientation so /result can echo it back
// --------------------------------------------------------------------------- //
function encodeSession(orientation: string): string {
  return `mock.${orientation || "base"}.${Date.now().toString(36)}`;
}
function orientationOf(sessionId: string): string {
  const parts = sessionId.split(".");
  return parts[0] === "mock" && parts[1] ? parts[1] : "base";
}

// --------------------------------------------------------------------------- //
// Survey flow (alternate path) — a short, in-memory question sequence
// --------------------------------------------------------------------------- //
const SURVEY_SKILLS = [
  "data.vector_search",
  "llm.structured_output",
  "eval.offline",
  "llm.function_calling",
];
const answeredBySession: Record<string, number> = {};

function questionFor(skillId: string, answered: number, loc: Locale): QuestionOut {
  const sk = name(skillId, loc);
  const text =
    loc === "zh"
      ? `你在「${sk}」方面的实际经验是？`
      : `What's your hands-on experience with ${sk}?`;
  const help_text =
    loc === "zh"
      ? `这道题评估你在「${sk}」上的水平，用于判断你与目标岗位（AI Engineer 应用向）的能力差距。按真实经历选择即可。`
      : `This question assesses your level on ${sk}, used to gauge your gap against the target role (AI Engineer, applied). Just pick what matches your real experience.`;
  return {
    question_id: `q.${skillId}`,
    skill_id: skillId,
    category: cat(skillId),
    text,
    help_text,
    ui_type: "single_select",
    options: PROFICIENCY_META.map((p) => {
      const isZh = loc === "zh";
      const examples: Record<string, string | null> = {
        none: null,
        tutorial: isZh ? `例如：能说明${sk}的基本用途` : `For example: can explain the basic purpose of ${sk}`,
        demo: isZh ? `例如：在个人小功能中实际用过${sk}` : `For example: used ${sk} in a small personal feature`,
        shipped: isZh ? "例如：在真实项目中交付过，并处理过失败或异常情况" : "For example: delivered it in a real project and debugged failures",
        expert: isZh ? "例如：能设计整体方案、评测结果并持续优化" : "For example: can design the approach, evaluate results, and improve it continuously",
      };
      if (skillId === "llm.prompt" && p.value === "expert") {
        examples.expert = isZh
          ? "例如：设计过可复用Prompt模板，并处理过版本、评测和失败回退"
          : "For example: designed reusable prompt templates with versioning, evaluation, and fallbacks";
      }
      return { value: p.value, label: pick(p.label, loc), example: examples[p.value] };
    }),
    progress: { answered, max: SURVEY_SKILLS.length },
  };
}

function nextQuestionFor(sessionId: string, loc: Locale): NextQuestionResponse {
  const answered = answeredBySession[sessionId] ?? 0;
  if (answered >= SURVEY_SKILLS.length) return { result_ready: true, question: null };
  return { result_ready: false, question: questionFor(SURVEY_SKILLS[answered], answered, loc) };
}

// --------------------------------------------------------------------------- //
// Public mock API (same shape as `api` in lib/api.ts)
// --------------------------------------------------------------------------- //
export const mockApi = {
  createSession: (orientation?: string): Promise<SessionCreateResponse> => {
    const o = orientation ?? "base";
    const session_id = encodeSession(o);
    answeredBySession[session_id] = 0;
    return delay({ session_id, role_id: "ai_engineer_applied", orientation: o }, 200);
  },

  paths: (): Promise<PathsResponse> => delay({
    current_roles: [
      { id: "frontend_engineer", label: "Frontend Engineer", label_zh: "前端工程师" },
      { id: "fullstack_engineer", label: "Full Stack Engineer", label_zh: "全栈工程师" },
      { id: "backend_engineer", label: "Backend Engineer", label_zh: "后端工程师" },
    ],
    target_roles: [
      { id: "ai_engineer_applied", label: "AI Engineer (Applied)", label_zh: "AI 应用工程师" },
    ],
  }, 100),

  skills: (): Promise<SkillCatalogResponse> => delay(buildCatalog(currentLocale()), 180),

  experienceCapsules: (_currentRole?: string): Promise<ExperienceCapsulesResponse> => delay({
    current_role: _currentRole || "frontend_engineer",
    depth_tiers: [
      { id: "none", label: "没做过", level_offset: -1 },
      { id: "aware", label: "了解过", level_offset: 0 },
      { id: "done", label: "做过", level_offset: 1 },
      { id: "deep", label: "深入做过", level_offset: 2 },
    ],
    categories: [
      {
        id: "cat.delivery", label: "我开发和交付过什么", icon: "🛠️", hint: "影响：你能否把 AI 功能上线并稳定运行",
        capsules: [
          { id: "exp.feature_ownership", text: "独立负责过一个功能的开发到上线", capability: "工程交付能力", maps_to: [{ skill_id: "eng.api_design", base_level: 1, confidence: 0.7 }] },
          { id: "exp.error_retry", text: "处理过请求失败、重试和降级逻辑", capability: "容错与韧性", maps_to: [{ skill_id: "eng.error_handling", base_level: 1, confidence: 0.7 }] },
        ],
      },
    ],
    ai_exploration: {
      label: "AI 接触程度", icon: "🤖", hint: "如果你已经开始探索 AI，这些帮我们判断得更准",
      capsules: [
        { id: "exp.ai_tools", text: "经常用 AI 工具帮我写代码或改写内容", capability: "AI 工具使用", maps_to: [{ skill_id: "llm.prompt", base_level: 0, confidence: 0.4 }] },
      ],
    },
    confirm_probes: [
      { skill_id: "data.vector_search", name: "向量检索", explain: "把文档变成向量做相似搜索", options: ["没做过", "跑通过 demo", "在项目用过"], option_levels: [0, 1, 2] },
      { skill_id: "llm.prompt", name: "Prompt 工程", explain: "设计指令让模型按要求输出", options: ["没做过", "试过", "在项目迭代过"], option_levels: [0, 1, 2] },
    ],
  }, 150),

  assessmentPlan: (_currentRole?: string, _targetRole?: string): Promise<AssessmentPlanResponse> => delay({
    current_role: _currentRole || "frontend_engineer",
    target_role: _targetRole || "ai_engineer_applied",
    transfer_skills: [
      { skill_id: "eng.typescript", name: "TypeScript 工程化", category: "foundation", tier: "direct_transfer" as const, default_level: 3, learnability: 0.95, reason: "前端核心语言，可直接迁移" },
      { skill_id: "eng.api_design", name: "API 设计与契约", category: "foundation", tier: "direct_transfer" as const, default_level: 2, learnability: 0.8, reason: "前端联调经验可迁移到 AI 服务设计" },
      { skill_id: "llm.streaming", name: "流式输出与前端集成", category: "llm", tier: "direct_transfer" as const, default_level: 2, learnability: 0.9, reason: "SSE/WebSocket 经验直接适用" },
    ],
    assess_skills: [
      { skill_id: "llm.prompt", name: "Prompt 结构设计", category: "llm", learnability: 0.7, weight: 0.9, type: "required" },
      { skill_id: "data.vector_search", name: "向量检索", category: "data", learnability: 0.45, weight: 0.9, type: "required" },
      { skill_id: "llm.function_calling", name: "函数/工具调用", category: "llm", learnability: 0.55, weight: 0.8, type: "required" },
    ],
    skip_skills: [
      { skill_id: "eng.auth", name: "鉴权与安全基线", category: "foundation" },
    ],
  }, 150),

  matchOrientation: (_jd: string): Promise<JdMatchResponse> => {
    const loc = currentLocale();
    // Mock mode deliberately does not pretend to understand arbitrary prose.
    // Semantic JD extraction only exists in the real API.
    const orientation = "base";
    const meta = ORIENTATION_META.find((o) => o.id === orientation)!;
    return delay({
      orientation,
      orientation_label: pick(meta.label, loc),
      description: pick(meta.description, loc),
      matched: false,
      signals: [],
      confidence: 0,
      needs_confirmation: false,
    }, 320);
  },

  nextQuestion: (sessionId: string, _forceContinue = false, _requiredOnly = false): Promise<NextQuestionResponse> =>
    delay(nextQuestionFor(sessionId, currentLocale())),

  submitAnswer: (sessionId: string, _skillId?: string, _answerValue?: string, _forceContinue = false, _answerSource: "standard" | "user_correction" = "standard", _requiredOnly = false): Promise<NextQuestionResponse> => {
    answeredBySession[sessionId] = (answeredBySession[sessionId] ?? 0) + 1;
    return delay(nextQuestionFor(sessionId, currentLocale()), 180);
  },

  analyzeCorrection: (sessionId: string, skillId: string, text: string) => delay({
    evidence_id: `mock-${sessionId}-${skillId}`,
    skill_id: skillId,
    project: "Mock evidence fixture",
    actions: ["完成一个个人项目中的功能"],
    ownership: "个人项目实践",
    outcome: "完成可运行功能",
    evidence_quote: text.slice(0, 180),
    llm_suggested_level: null,
    rule_level: 2,
    rule_version: "mock-fixed-evidence-v1",
    current_level: 1,
    provider: "mock",
  }, 500),

  confirmCorrection: (_sessionId: string, _evidenceId: string, action: "confirm" | "keep") =>
    delay({ status: action === "confirm" ? "confirmed" as const : "kept" as const, level: action === "confirm" ? 2 : 1 }, 180),

  recommendResource: (_skillId: string, _url: string, _title: string, _reason: string) =>
    delay({ status: "pending", candidate_id: "mock-resource-candidate" }, 300),

  result: (sessionId: string, timeBudget?: TimeBudget, orientationOverride?: string): Promise<ResultResponse> => {
    const loc = currentLocale();
    // An explicit override (result-page "target a role" picker) wins over the
    // orientation baked into the session id at creation time.
    const orientation = orientationOverride || orientationOf(sessionId);
    const budget: TimeBudget = timeBudget ?? "standard";
    const gaps = buildGaps(orientation, loc);
    const next_steps = buildNextSteps(orientation, budget, loc);
    const pacing = buildPacing(budget, next_steps, loc);
    const readiness = orientation === "rag" ? 46 : 53;
    const orientation_label =
      orientation === "base"
        ? null
        : ORIENTATION_META.find((o) => o.id === orientation)
          ? pick(ORIENTATION_META.find((o) => o.id === orientation)!.label, loc)
          : null;

    return delay({
      session_id: sessionId,
      role_id: "ai_engineer_applied",
      orientation,
      orientation_label,
      status: "completed",
      readiness,
      projected_readiness: Math.min(100, readiness + 18),
      profile_uncertainty: 0.38,
      assessed_required_count: 9,
      required_skill_count: 16,
      time_budget: budget,
      pacing,
      profile: buildProfile(loc),
      strengths: buildStrengths(loc),
      gaps,
      next_steps,
      note: pick(NOTE, loc),
    });
  },
};
