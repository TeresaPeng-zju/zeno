# Zeno

Stop guessing your market fit. Zeno maps your current skills, finds transition gaps, and curates actionable roadmaps with real resources — for devs & PMs.

> **示例场景**：前端工程师 → AI Engineer（应用向：RAG / Agent / LLM App）

不是回答“学什么”，而是回答“**为什么是你学这个**”和“**下一步最值得学什么**”。

---

## 功能特性

- **能力诊断**：内置 24 个技能维度（foundation / data / llm / eval），对照目标岗位要求生成能力画像，输出「优势 / 差距 / 下一步」三段式结果。
- **RAG 资源推荐**：基于 `text-embedding-3-small` 向量化与 pgvector/HNSW 语义召回，按相关性、时效性、岗位适配度多信号重排；附离线评测（NDCG@10 / Hit@3 / Recall@5）。
- **资源策展 Agent**：以 Function Calling 编排「搜索 → 抓取 → 摘要 → 入库 → 保鲜校验」工具链，按 `url_hash` 幂等去重并定期检测来源时效。
- **决策与表达分离**：能力匹配与排序由确定性规则引擎完成，LLM 仅负责结果解释；未配置或调用失败时自动回退模板文案，不影响打分。
- **零输入前端**：技能胶囊选择 + React Flow 职业能力图谱，三态（已具备 / 部分 / 缺口）可视化能力差距。

---

## 评测与资源库脚本

```bash
# 离线评测（无需库/网络，mock embedder）
python -m app.eval.run_eval
# 回归测试
python -m pytest -q

# 库起来后（HTTP）：种子入库 -> 策展 Agent 扩库 -> 保鲜校验
curl -X POST localhost:8000/api/resources/seed
curl -X POST localhost:8000/api/resources/curate/data.vector_search
curl -X POST localhost:8000/api/resources/verify
curl localhost:8000/api/resources
```

---

## 目录结构

```
zeno/
├── docker-compose.yml      # Postgres 16 + pgvector
└── apps/
    ├── api/                # FastAPI（能力诊断 + RAG 资源引擎 + 策展 Agent + 离线评测）
    └── web/                # Next.js 15 能力评估（技能胶囊选择）+ 职业能力图谱
```

---

## 本地启动

### 0. 起数据库（Postgres + pgvector）

```bash
docker compose up -d
```

### 1. 后端 API（FastAPI）

```bash
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -e .                 # 或: pip install -e ".[openai]"
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

- 健康检查：http://localhost:8000/health
- 接口文档：http://localhost:8000/docs

### 2. 前端 Web（Next.js）

```bash
cd apps/web
cp .env.local.example .env.local
pnpm install        # 或 npm install
pnpm dev            # http://localhost:3000
```

打开 http://localhost:3000 → 点击 “Map my career” → 选择技能与熟练度（胶囊式，无需打字）→ 查看能力画像与职业图谱。

---

## 切换到 OpenAI（可选）

在 `apps/api/.env` 中：

```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

未配置或调用失败时，自动回退到模板文案（不影响打分，因为 LLM 不参与决策）。
