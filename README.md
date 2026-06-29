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
- pnpm
- Docker (for Postgres + pgvector)

### Quick start (one command)

```bash
npm run dev      # or: bash scripts/dev.sh
```

The first run installs everything (backend venv + deps, frontend deps), starts
Postgres via Docker, runs migrations, seeds the resource library, then launches
the API on **:8000** and the web app on **:3000**. Press Ctrl-C to stop both.
No API key needed — the engine runs fully on the deterministic mock providers.

### Manual setup (if you prefer step by step)

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

- [ ] Company-specific JD calibration
- [ ] More target roles
- [ ] Career Constellation visualization
- [ ] Agent-assisted questionnaire optimization
- [ ] Resource freshness verifier

---

## Open Core

Zeno is open-source under the **Apache License 2.0**. The repository ships with a **demo skill graph** (`skill_graph.demo.json`) containing sample skills and weights so you can run the entire platform out of the box.

Production data — including the calibrated skill graph, JD corpus, and curated resource library — is maintained separately and not included in this repository. You are welcome to replace the demo data with your own domain-specific skill definitions.

"Zeno" and the Zippi mascot are trademarks of Teresa Peng — see [NOTICE](NOTICE) for details.

---

## License

[Apache License 2.0](LICENSE) © 2026 Teresa Peng
