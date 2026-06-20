# Gold 标注集 — 抽取 LF 的尺子

这里放**人工标注的金标准**，用来量 `scripts/build_jd_evidence.py` 里那张关键词表
（`SKILL_KEYWORDS`，也就是整条证据账本的标注函数 LF）到底准不准。

> 没有这把尺子，加源 / 调关键词都是凭感觉（见 `app/data/raw/README.md §4`）。
> 有了它，每次改 LF 都能量出 precision/recall 的 delta，注水的词一眼现形。

## 工作流

```bash
cd apps/api

# 1. 生成待标注模板（确定性抽样，skills 故意留空，不泄漏 LF 的预测）
python -m scripts.export_gold_template          # 默认 25 篇，可 --n 30

# 2. 复制成正式 gold，然后逐行填 skills
cp app/data/gold/extraction_gold.template.jsonl app/data/gold/extraction_gold.jsonl

# 3. 跑评测，看 LF 的 P/R/F1 + 注水/漏召回清单
python -m app.eval.extraction.extraction_eval
```

## 标注规则（关键，别破坏）

1. **冷读 JD 原文**再勾技能——不要先看关键词表的预测，那会把系统的答案泄漏进标签
   （这正是我们要测掉的确认偏差）。
2. **只认下面 23 个图技能 id**。`llm.core`（大模型/多模态/AIGC 这类伞形词）**不是**图技能，
   不要标。图外提法可写进 `note`，但不进 `skills`。
3. 每行只改 `skills`（和可选的 `note`），其余字段别动。
4. **标"这篇 JD 真正要求的技能"**，不是"我猜系统会不会命中"。宁缺毋滥。

## gold 行格式

```json
{"doc_id": "a1b2c3d4", "source_id": "bytedance/ai_jobs.xlsx", "lang": "zh",
 "skills": ["data.retrieval_rerank", "llm.tool_use"], "note": "讲 RAG + Agent 编排",
 "text": "职位名称…\n职位描述…\n职位要求…"}
```

## 可用技能 id（只认这 23 个）

| category | skill_id | 名称 |
|---|---|---|
| foundation | `eng.api_design` | API 设计与契约 |
| foundation | `eng.auth` | 鉴权与安全基线 |
| foundation | `eng.error_handling` | 错误处理与重试 |
| foundation | `eng.observability` | 可观测性（日志/指标/trace） |
| foundation | `eng.deploy` | 部署与 CI/CD |
| foundation | `eng.typescript` | TypeScript 工程化 |
| data | `data.text_processing` | 文本清洗与预处理 |
| data | `data.chunking` | 文档切分（chunking） |
| data | `data.embedding` | 向量化与 embedding 选型 |
| data | `data.vector_search` | 向量检索（pgvector/HNSW） |
| data | `data.retrieval_rerank` | 召回与重排（rerank） |
| data | `data.quality` | 数据质量与去重 |
| llm | `llm.prompt` | Prompt 结构设计 |
| llm | `llm.structured_output` | 结构化输出 / JSON schema 约束 |
| llm | `llm.function_calling` | 函数 / 工具调用 |
| llm | `llm.tool_use` | 多工具编排 |
| llm | `llm.agent_state` | Agent 状态与记忆 |
| llm | `llm.cost_latency` | 成本与延迟优化 |
| llm | `llm.streaming` | 流式输出与前端集成 |
| eval | `eval.offline` | 离线评估集构建 |
| eval | `eval.online` | 在线反馈采集 |
| eval | `eval.ab` | A/B 实验 |
| eval | `eval.metrics` | 质量指标（准确/覆盖/幻觉率） |

> 注：标注集是**可复现的回归尺子，不是 benchmark**。规模 15–30 篇即可，求标得准，不求多。
