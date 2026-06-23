# Zeno

[English](README.md) | [简体中文](README.zh-CN.md)

> AI 驱动的开发者职业导航工具。

**看清你的能力。发现你的差距。规划下一步。**

---

## 为什么叫 Zeno？

Zeno 源自古希腊哲学家 **Zeno of Citium**（芝诺），斯多葛主义的创始人。

斯多葛主义认为：我们无法控制外部世界，但可以理解自己，并选择如何成长。

在 AI 快速改变技术世界的今天，Zeno 希望帮助开发者和产品经理更清晰地认识自己，并找到下一步方向。

---

## 它解决什么问题

技术转型最难的不是找到学习资料，而是判断：

- 我现在的能力距离目标岗位还有多远？
- 众多需要补充的技能中，**哪个应该优先学习**？
- 找到的课程和资料是否真正适合当前阶段？

Zeno 将这些问题拆解为：**能力优势 → 技能差距 → 下一步行动**，并结合经过筛选的学习资源。

---

## 使用流程

1. **选择你的路径** — 确定当前角色和目标角色
2. **确认你的能力** — 回答与你路径相关的能力评估
3. **查看你的星图** — 展示能力优势、缺口和依赖关系
4. **获取你的路线** — 按优先级排列的行动步骤与学习资源

---

## Zeno 的思考方式

Zeno 将职业成长建模为**技能图谱**：

```
当前技能 → 缺失能力 → 学习路径
```

每个技能通过先修依赖关系连接，帮助你识别**先学什么**，而不只是学什么。

```
工程基础                   数据与检索                  LLM 应用
 ├── API 设计              ├── Embedding              ├── Prompt 结构
 ├── TypeScript            ├── 向量检索               ├── 函数调用
 ├── 部署                  ├── 召回与重排             ├── Agent 编排
 └── 错误处理              └── 数据质量               └── 成本优化

评估
 ├── 离线评估
 └── 质量指标
```

完整图谱（23 个技能、4 个维度以及技能依赖关系）定义在 [`apps/api/app/data/skill_graph.json`](apps/api/app/data/skill_graph.json)。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Next.js 15、React Flow、Framer Motion |
| 后端 | FastAPI (Python) |
| 数据库 | Postgres 16 + pgvector |
| LLM | 兼容 OpenAI API 的模型服务 |

```
zeno/
├── docker-compose.yml
└── apps/
    ├── api/                # 后端 API
    └── web/                # 前端 Web
```

---

## 本地开发

### 环境要求

- Node.js 20+
- Python 3.11+
- Docker（用于 Postgres + pgvector）

### 启动

```bash
# 数据库
docker compose up -d

# 后端
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 前端
cd apps/web
pnpm install
pnpm dev
```

访问 http://localhost:3000 开始体验。

---

## 路线图

- [ ] 更多公司岗位数据校准
- [ ] 更多目标角色支持
- [ ] 职业星图可视化
- [ ] Agent 辅助问卷优化
- [ ] 资源保鲜校验
