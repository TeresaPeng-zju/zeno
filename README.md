# Zeno

Stop guessing your market fit. Zeno maps your current skills, finds transition gaps, and curates actionable roadmaps with real resources — for devs & PMs.

> **MVP 场景**：前端工程师 → AI Engineer（应用向：RAG / Agent / LLM App）

不是回答“学什么”，而是回答“**为什么是你学这个**”和“**下一步最值得学什么**”。

---

### 资源库运营 / 评测

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
├── apps/
│   ├── api/                # FastAPI（能力模型 + 编排器 + 接口）
│   └── web/                # Next.js 15 问卷页
└── packages/               # (Week 3 起：core / db / rag 抽取)
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

打开 http://localhost:3000 → “开始能力评估” → 按钮作答 → 查看能力画像。

---

## 切换到 OpenAI（可选）

在 `apps/api/.env` 中：

```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

未配置或调用失败时，自动回退到模板文案（不影响打分，因为 LLM 不参与决策）。
