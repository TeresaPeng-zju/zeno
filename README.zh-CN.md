# Zeno

[English](README.md) | [简体中文](README.zh-CN.md)

> 面向开发者与产品经理的 AI 职业导航 —— 看清能力、发现路径、生成个性化成长路线。

**你不是从零开始。你的工程能力，已经在向 AI 迁移。**

---

## 为什么叫 Zeno？

Zeno 源自古希腊哲学家 **Zeno of Citium**（芝诺），斯多葛主义的创始人。

斯多葛主义认为：我们无法控制外部世界，但可以理解自己，并选择如何成长。

在 AI 快速重塑技术世界的今天，Zeno 帮助开发者更清醒地决定下一步学什么——而这个判断，建立在真实招聘到底要什么之上。

---

## 它解决什么问题

技术转型最难的从来不是找不到学习资料，而是判断：

- 我现在的哪些能力**可以迁移**到目标岗位？
- 我真正缺的是什么？
- 众多要补的技能里，**到底该先学哪个**？

大多数工具不是在恭维你，就是把你淹没。Zeno 只诚实地做一件事：用真实招聘数据告诉你——你站在哪、哪些能力能带走、最有效的下一步是什么。

> **Zeno 只诊断，不承诺。** 它不会告诉你"你能拿到 offer"，而是用真实岗位数据告诉你：差距在哪、哪些是真差距。

---

## 使用流程

1. **选择方向** —— 确定当前角色（前端 / 后端 / 全栈 / 学生）和你的 AI 目标。
2. **发现可迁移的能力** —— 一张交互式星图，把你已经能迁移到 AI 的工程基础点亮出来；逐个确认，看着能力链从 `TypeScript → API → 流式 → Prompt → 工具调用 → Agent` 一路长出来。连线代表**能力迁移**（"你有这个，所以离那个很近"），不是课程先修关系。
3. **拿到迁移地图** —— 一条随滚动推进的叙事，从"你在这里"走到"第一步从哪开始"，外加你的可迁移优势、真正的差距（核心 / 加分）、以及按优先级排序、配好学习资源的路线图。
4. **对准一个真实岗位** —— 贴一段招聘 JD，Zeno 会识别它偏向哪个细分方向（RAG / Agent / 评估），并据此重新校准你的差距与路线。

支持 **English / 简体中文 / 繁體中文**。

---

## Zeno 的思考方式

Zeno 把**决策**和**表达**分开：

- 一个**确定性引擎**计算你的优势、差距、技能依赖和优先级。它跑在一张用真实招聘数据校准过的技能图谱上，所以结果可复现、有据可依——不是凭感觉。
- 一个 **LLM**（DeepSeek，或任意兼容 OpenAI 的服务）**只**负责把诊断结果翻译成自然、有温度的人话，它**绝不参与判断你的差距**。

这就是为什么 Zeno 能既温暖又诚实：数字来自数据和代码，LLM 只是帮它们说话。

Zeno 把成长建模为**技能图谱**——`当前技能 → 缺失能力 → 学习路径`——每个技能通过先修依赖连接，所以 Zeno 能告诉你**先学什么**，而不只是学什么。

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

完整图谱（23 个技能、4 个维度、技能依赖与目标方向）定义在 [`apps/api/app/data/skill_graph.json`](apps/api/app/data/skill_graph.json)。学习资源由一个小型 **RAG 引擎**推荐：基于 pgvector 的向量召回 + 多信号重排（相关度、时效、等级匹配），并可选接入 LLM 策展 agent。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Next.js 15（App Router）、React Flow、Framer Motion、next-intl（en / zh / zh-TW） |
| 后端 | FastAPI (Python)、SQLAlchemy、Alembic |
| 数据库 | Postgres 16 + pgvector |
| LLM | DeepSeek / 任意兼容 OpenAI 的服务 —— *仅用于表达* |
| 引擎 | 确定性决策引擎 + RAG 资源召回 |

```
zeno/
├── docker-compose.yml
├── scripts/            # 一键安装与启动
└── apps/
    ├── api/            # FastAPI 后端（引擎、RAG、JD 匹配）
    └── web/            # Next.js 前端（星图、迁移地图）
```

---

## 本地开发

### 环境要求

- Node.js 20+
- Python 3.11+
- pnpm
- Postgres 16 + pgvector —— 用 Docker，或本地 / Homebrew 安装均可

### 一键启动（一条命令）

```bash
npm run dev      # 或：bash scripts/dev.sh
```

首次运行会自动完成全部安装（后端 venv + 依赖、前端依赖）、启动 Postgres（有 Docker 用 Docker，否则用本地 Homebrew 的 Postgres）、建表、灌入种子资源，然后同时拉起后端 **:8000** 和前端 **:3000**。Ctrl-C 一起关闭。**无需任何 API key**——引擎默认跑确定性 provider；只有想开启自然语言诊断和实时资源策展时，才需要配 DeepSeek key。

### 手动启动（想一步步来）

```bash
# 数据库（本地已有 Postgres 可跳过）
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

进阶配置（不用 Docker 的原生 Postgres、贡献指南）见 [`docs/`](docs/)。

---

## 路线图

- [ ] 更多公司岗位 JD 校准
- [ ] 更多当前 / 目标角色（含 PM → AI PM）
- [ ] 更深入的 Agent 资源策展
- [ ] 可分享的「AI 基因」卡片
- [ ] 更丰富的评估 / Eval 专精路径

---

## 开放内核（Open Core）

Zeno 在 **Apache License 2.0** 下开源。仓库自带一份**示例技能图谱**（`skill_graph.demo.json`），包含样本技能与权重，开箱即可运行完整平台。

生产数据（包括校准后的技能图谱、JD 语料库和策展资源库）独立维护，不包含在本仓库中。你可以用自己领域的技能定义替换示例数据。

"Zeno"品牌名及 Zippi 吉祥物为 Teresa Peng 的商标——详见 [NOTICE](NOTICE)。

---

## 许可证

[Apache License 2.0](LICENSE) © 2026 Teresa Peng
