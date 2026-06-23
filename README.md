# Zeno

[English](README.md) | [简体中文](README.zh-CN.md)

> AI-powered career navigation for developers and product builders.

**Understand your skills. Discover your gaps. Build what's next.**

---

## Why Zeno?

Named after **Zeno of Citium**, founder of Stoicism.

Stoicism teaches that while we cannot control everything around us, we can understand ourselves and choose how we grow.

In an era shaped by AI and constant change, Zeno helps builders make deliberate decisions about what to learn next.

---

## The Problem

Career transitions are rarely blocked by lack of resources. The real challenge is knowing:

- What skills do I already have that transfer?
- What am I actually missing for my target role?
- Of everything I could learn, **what should I learn first**?

Zeno turns these questions into an actionable report: **Strengths → Gaps → Next Steps**, with curated learning resources.

---

## How It Works

1. **Choose your path** — select your current role and target role
2. **Confirm your skills** — answer a path-tailored capability check
3. **See your constellation** — a skill graph showing strengths, gaps, and dependencies
4. **Get your roadmap** — prioritized next steps with learning resources

---

## How Zeno Thinks

Zeno models career growth as a **skill graph**:

```
Current Skills → Missing Capabilities → Learning Path
```

Each skill is connected through prerequisite relationships, helping identify what to learn first — not just what to learn.

```
Engineering Foundation          Data & Retrieval          LLM Applications
 ├── API Design                  ├── Embedding             ├── Prompt Design
 ├── TypeScript                  ├── Vector Search         ├── Function Calling
 ├── Deployment                  ├── Retrieval & Rerank    ├── Agent Orchestration
 └── Error Handling              └── Data Quality          └── Cost Optimization

Evaluation
 ├── Offline Eval
 └── Quality Metrics
```

The full graph (23 skills, 4 dimensions, skill dependencies) is defined in [`apps/api/app/data/skill_graph.json`](apps/api/app/data/skill_graph.json).

---

## Tech Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 15, React Flow, Framer Motion |
| Backend | FastAPI (Python) |
| Database | Postgres 16 + pgvector |
| LLM | OpenAI-compatible providers |

```
zeno/
├── docker-compose.yml
└── apps/
    ├── api/                # Backend API
    └── web/                # Frontend Web
```

---

## Local Development

### Requirements

- Node.js 20+
- Python 3.11+
- Docker (for Postgres + pgvector)

### Setup

```bash
# Database
docker compose up -d

# Backend
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# Frontend
cd apps/web
pnpm install
pnpm dev
```

Open http://localhost:3000.

For advanced setup (native Postgres without Docker, contributor guidelines), see [`docs/`](docs/).

---

## Roadmap

- [ ] Company-specific JD calibration (skill weight optimization)
- [ ] More target roles (Tech Lead, AI PM)
- [ ] Career Constellation visualization (interactive star-map)
- [ ] Agent-assisted questionnaire optimization
- [ ] Resource freshness verifier (automated link health checks)
