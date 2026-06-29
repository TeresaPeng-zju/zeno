# Zeno · JD 校准与关键词消歧报告

目标：让"测评"的 JD 数字可信——既不被关键词假阳性骗，也不被稀疏词低估。本轮改动全部在真实数据上跑通。

## 一、关键词消歧（`scripts/build_jd_evidence.py`）

整篇文档级的上下文判断**没用**——2026 的 JD 几乎都在某处提到 AI，"性能优化"和"大模型"常同篇出现。改为**邻近门控**：歧义词只有当 AI 标记词出现在它附近（±40 字）时才计数。

歧义词（邻近门控）：

- `llm.cost_latency` ← 性能优化 / 成本 / 延迟 / latency / 吞吐（要旁边有"推理/模型/大模型"等才算）
- `llm.tool_use` ← agent（要旁边有 AI 语境，挡掉 user-agent）
- `llm.structured_output` ← 结构化（挡掉"结构化数据"）

同时给评估类补高信号词（评测 / 评估体系 / ragas / langsmith / deepeval），缓解低估。

效果（aggregate 频率，前→后）：

| 技能 | before | after | 说明 |
|---|---|---|---|
| llm.cost_latency | 30.1% | 28.9% | 剔除 Web 性能假阳性 |
| llm.tool_use | 75.9% | 73.5% | 剔除 user-agent 等 |
| llm.structured_output | 6.0% | 3.6% | 剔除"结构化数据" |
| **eval.offline** | **3.6%** | **32.5%** | **修正严重低估**（这是"为什么是你:4%"那个拆台数字的根因） |

## 二、权重校准（`skill_graph.json` role_requirements）

校准发现一个决定性事实：**JD 关键词频率只对"有明确词汇"的技能可信，对"说法含蓄"的技能系统性低估。**

| 可信引用（JD 强信号） | 系统性低估（别用 JD%） |
|---|---|
| tool_use 73% · api_design 64% · typescript 54% · retrieval_rerank 52% · eval.offline 33% | 向量检索 4% · 结构化输出 4% · chunking 0% · embedding 5% |

向量检索、chunking 明明是 RAG 核心，JD 却几乎不直说——**所以全量按 JD 覆写权重会把真核心打到地板，是错的。**

**采用的策略：单向、保守。** 只对"JD 强信号且融合后高于先验"的技能上调权重，**绝不因 JD 稀疏而下调**（保护你的先验/护城河判断）。

实际改动（仅 3 项，全部上调）：

- `eng.api_design` 0.80 → 0.83
- `eng.typescript` 0.50 → 0.60
- `llm.tool_use` 0.70 → 0.82

向量检索 0.90、结构化输出 0.80、chunking 0.70、离线评估 0.70 等**保持不变**。

## 三、产品里怎么用这些数字（已落到 `recommend_demo`）

"为什么是你"**只在 JD ≥ 20% 时引用百分比**；稀疏但重要的技能走"护城河 + 前置已具备"叙事，不秀一个会拆台的低数字。这条规则是"讲人话的测评"可信度的最后一道闸。

## 四、提醒

- 权重变了，你的 eval 基线/快照测试可能需要更新——这是重新校准的正常结果，跑一遍测试确认。
- `jd_evidence.json` 已重建（消歧后）。`skill_graph.json` 三处权重已上调。都可 git diff 审阅、随时回退。
