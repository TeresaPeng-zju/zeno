# 语料收集规范（Zeno 技能证据账本 · 原始层）

这份文档定义**往 `app/data/raw/` 里放什么、怎么放**，使得任何一批语料都能被
`scripts/build_jd_evidence.py` 无痛接成"证据账本"的一个**源（source）**，而不动决策内核、
不破坏可审计/可 diff/数据不出域这三条护城河。

> 一句话目标：**你只管按规范把语料落盘，我就能把它接成账本里的一个加权信源。**
> 加源 = 多写一个 `run_*()` 函数，内核和那 13 个回归测试一行不动。

---

## 0. 三条铁律（先读这个，违反了后面都白做）

1. **数据不出域。** 原始语料只许落在本地 `raw/`，进 git（或 git-lfs）。
   **严禁**把简历/JD/抓取正文喂给任何厂商的在线 API（含 fine-tune / embedding 在线接口）。
   需要 embedding/LLM 信号时，用**本地模型**。这是卖点，不是建议。
2. **每条证据必须带出处。** 没有 `url`/`source_id`/`collected_at` 的文本一律不收——
   账本的价值就是"为什么这个技能被抬上来"能指着某条数据说话。无出处 = 无证据。
3. **技能维度只认 `skill_graph.json` 的 23 个图技能**（见附录 A）。
   标注、匹配、统计都只落在这 23 个 id 上；图外的提法（如 umbrella "大模型"）可记原始命中，
   但不得伪装成图技能。

---

## 1. 我需要哪几类语料（按 ROI 排序）

当前只有**源 #1：JD 关键词**（`market_source/ai_jobs.xlsx`，trust=0.6）。它的病是
**召回低 + 个别泛词注水**。下面几类是用来补召回、降偏差的，按"先收哪个"排序：

| 优先级 | 源类型 `source_type` | 它补什么 | 典型来源 | 建议 trust |
|---|---|---|---|---|
| ★★★ | `article` | JD 写不出的"真实技能点"（深度实践） | 资深工程师博客、官方工程博客、会议分享稿 | 0.7–0.85 |
| ★★★ | `jd` | 市场需求基线（广但泛） | 更多公司/岗位的 JD | 0.5–0.6 |
| ★★ | `curriculum` | 体系化的技能拆解（结构清晰、低噪声） | 优质课程大纲、官方学习路径、认证 outline | 0.7 |
| ★★ | `repo_doc` | 工程现实中"真在用什么" | 高星开源项目 README / docs / ADR | 0.6 |
| ★ | `interview` | 岗位实际考察点 | 公开面经、面试题集（去重去水后） | 0.4–0.5 |

> 选源原则：**宁缺毋滥。** 一个高信任的资深 RAG 实战长文，胜过 50 篇 SEO 水文。
> 语料是"加权证据"，不是"越多越好"——低质源会把信号注水，反而要在 gold 上扣分。

### 明确"不要什么"（这些会污染信号）
- SEO / 营销 / 培训机构软文、"30 天速成"列表页。
- AI 批量生成的同质化内容（特征：术语堆砌、无具体项目/数字/取舍）。
- 过时内容（如 2 年前的"最佳实践"已被推翻的）——若收，必须带 `published_at` 以便降权。
- 纯转载/聚合页（拿不到一手出处的）。
- 任何含个人隐私（真实姓名+联系方式+简历）的页面，除非已脱敏。

---

## 2. 落盘格式（统一成两个文件，这样 `run_*()` 好写）

每个源放一个**独立子目录**：`raw/<source_id 的安全化路径>/`，里面放两个文件。

```
raw/
├── market_source_ai_jobs.xlsx                  # 源 #1（历史遗留，xlsx 也可，见 §2.3）
├── articles_rag_2026q2/                    # 新源示例：一批 RAG 主题文章
│   ├── manifest.json                       # 源级元数据（人工填，进 git，可 review）
│   └── corpus.jsonl                        # 文档正文，每行一篇
└── ...
```

### 2.1 `manifest.json`（源级元数据 —— 人工只填这一次）
这是规范里**唯一的人工成本**，且是 **O(源数) 不是 O(文档数)**：每收一批语料填一张表，
进 git review 一次。`trust` 就是上次说的"人工判断钉在这里"。

```json
{
  "source_id": "articles/rag_2026q2",
  "source_type": "article",
  "signal": "keyword",
  "trust": 0.8,
  "collector": "你的名字",
  "collected_at": "2026-06-20",
  "license": "公开网页，仅取技能信号，不再分发原文",
  "selection_criteria": "RAG/检索主题，作者为一线工程师或官方工程博客；排除营销/速成文",
  "notes": "trust=0.8 因来源均为可验证的一手实践；若后续 gold 指标下降需复核此值"
}
```

字段说明：
- `source_id`：全局唯一、稳定。格式 `<域>/<批次>`，如 `articles/rag_2026q2`、`jd/meituan_2026h1`。
- `source_type`：见 §1 表格的枚举。
- `signal`：这批语料**打算用什么 LF 抽**——`keyword` | `embedding` | `llm_extract`。
  先期一律 `keyword`（沿用现有可审计 LF）；要上语义相似再标 `embedding`。
- `trust`：[0,1]，按 §1 建议表定，**只在这里定一次**。

### 2.2 `corpus.jsonl`（文档正文 —— 一行一篇，机器抓取/转换产出）
每行一个 JSON 对象。**最少**这几个字段：

```json
{"doc_id": "a1b2c3d4", "url": "https://example.com/rag-in-prod", "title": "我们在生产环境怎么做 RAG 重排", "text": "全文纯文本……", "collected_at": "2026-06-20", "lang": "zh"}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `doc_id` | ✅ | 稳定可复现的 id。建议 = `url` 的 sha1 前 8 位；无 url 时用行号。**用于 diff 时定位是哪篇** |
| `url` | ✅ | 一手出处。本地 PDF/课程也要给个可追溯标识（如 `file://...` 或课程 ID） |
| `title` | ✅ | 标题，便于人工抽检 |
| `text` | ✅ | **纯文本正文**（去 HTML/导航/广告）。LF 在这上面匹配，质量直接决定召回 |
| `collected_at` | ✅ | 抓取日期 `YYYY-MM-DD` |
| `lang` | ✅ | `zh` / `en` |
| `published_at` | 建议 | 原文发布日期，用于给"过时内容"降权 |
| `author` / `site` | 建议 | 便于做作者/站点级信任与去重 |

> 注：正文清洗是召回的命门。宁可只收"清得干净的正文"，不要把整页 HTML/导航塞进 `text`。

### 2.3 关于 xlsx（源 #1 的历史格式）
源 #1 用的是 `market_source_ai_jobs.xlsx`（列：职位名称/职位描述/职位要求）。
**老格式可继续用**——它的 `run_jd_keyword_source()` 已经在跑。
**新批次一律用 `corpus.jsonl`**，别再引入新的 xlsx，统一格式后 LF 复用成本最低。

---

## 3. 收完之后怎么接进账本（你不用写，但要知道边界）

我接一个新源时只做这件事，证明"加源不动内核"：

```python
# scripts/build_jd_evidence.py
ARTICLE_RAG_SOURCE = Source("articles/rag_2026q2", "article", "keyword", trust=0.8)

def run_article_rag_source() -> tuple[Source, dict[str, Contribution]]:
    docs = [json.loads(l) for l in (RAW/"articles_rag_2026q2"/"corpus.jsonl").open()]
    # 同一张可审计 SKILL_KEYWORDS LF 跑 doc["text"]，产出每技能 {doc_count, doc_total, frequency}
    ...

def build():
    return assemble([run_jd_keyword_source(), run_article_rag_source()])  # ← 只多这一项
```

`aggregate()` 自动把多源按出处合并：每个技能的 `evidence` 列表多出一条带 `source_id` 的证据，
`evidence_score = Σ trust·frequency` 自动加权。**决策内核、`explain`、`diff`、13 个回归测试不受影响。**

---

## 4. gold 评测集（这把尺子决定"加源到底有没有用"）

没有 gold，加源是凭感觉；有了 gold，每个新源能量出 precision/recall 的 delta。
**这是 fine-tune ROI 判断的前置，也是低质源的"安检门"。**

- **规模**：15–30 篇封顶（一两小时的事），覆盖各 category。**不求多，求标得准。**
- **抽样**：从已收语料里随机抽，别专挑好标的。
- **标什么**：每篇人工确认"真实涉及哪些图技能"（从附录 A 的 23 个里勾）。
- **落盘**：`app/data/gold/extraction_gold.jsonl`，每行：

```json
{"doc_id": "a1b2c3d4", "source_id": "articles/rag_2026q2", "skills": ["data.retrieval_rerank", "data.vector_search", "eval.metrics"], "note": "讲生产 RAG 重排，明确提到向量库与离线评测"}
```

- **怎么用**：在 `app/eval/` 加 `extraction` 评测，拿现有关键词 LF 当 baseline，
  量出当前 precision/recall（顺便坐实"泛词注水"）。之后每加一个源 / 调一次 LF，
  指标涨没涨一目了然；**指标掉了的源，diff 一眼看出是谁，回退即可。**

---

## 5. 一次收集的标准流程（checklist）

1. 定一个 `source_id` 和 `source_type`，建目录 `raw/<safe_id>/`。
2. 按 §1 的"要/不要"筛选语料，抓取并**清洗成纯文本**。
3. 写 `corpus.jsonl`（每行带 `doc_id/url/title/text/collected_at/lang`）。
4. 填 `manifest.json`（尤其 `trust` 和 `selection_criteria`，进 git review）。
5. 从这批里抽几篇补进 `gold/extraction_gold.jsonl`（如果还没建 gold，先建）。
6. 告诉我源 id + 路径，我写 `run_*()` 接进 `build()`，重跑账本 + eval，给你看 delta。

---

## 附录 A：可用技能 id（标注/匹配只认这 23 个）

来自 `app/data/skill_graph.json`。标注 gold、设计关键词时**只能用左列 id**。

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

> `llm.core`（大模型/多模态/AIGC 这类 umbrella 词）**不是图技能**，仅作上下文计数，不得标进 gold。

## 附录 B：trust 速查

| 场景 | 建议 trust |
|---|---|
| 官方工程博客 / 一线资深工程师实战长文 | 0.8–0.85 |
| 优质课程大纲 / 认证 outline | 0.7 |
| 普通 JD（真实但泛） | 0.5–0.6 |
| 高星开源项目文档 | 0.6 |
| 公开面经（去重去水后） | 0.4–0.5 |
| 来源存疑 / 可能过时 | ≤0.3（或先不收） |

trust 不是拍脑袋——**它会进 `evidence_score`，错了会在 gold 指标上现形**，所以填完之后由 gold 兜底校准。
