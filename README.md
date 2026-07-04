# Zeno

[English](README.md) | [简体中文](README.zh-CN.md)

> AI career navigator for developers & PMs — analyze skills, discover paths, and build personalized growth roadmaps.

**You're not starting from zero. Your engineering skills already transfer to AI.**

---

## Why Zeno?

Named after **Zeno of Citium**, founder of Stoicism.

Stoicism teaches that while we cannot control everything around us, we can understand ourselves and choose how we grow.

In an era reshaped by AI, Zeno helps builders make deliberate decisions about what to learn next — grounded in what real hiring actually asks for.

---

## The Problem

Career transitions are rarely blocked by a lack of resources. The real challenge is knowing:

- What skills do I already have that **transfer**?
- What am I actually missing for my target role?
- Of everything I could learn, **what should I learn first**?

Most tools either flatter you or overwhelm you. Zeno does one thing honestly: it uses real hiring data to show you where you stand, what carries over, and the most effective next step.

> **Zeno diagnoses — it doesn't promise.** It won't tell you you'll land the job. It tells you, from real job-posting data, where the gaps are and which ones are real.

---

## How It Works

1. **Pick your direction** — choose your current role (frontend, backend, full-stack, student) and your AI target.
2. **Discover what transfers** — an interactive star-map surfaces the engineering foundations that already carry over to AI work. Confirm them, and watch your map grow from `TypeScript → API → Streaming → Prompt → Tool Use → Agent`. Edges mean *capability transfer* ("you have this, so you're close to that") — not course prerequisites.
3. **Get your migration map** — a scroll-driven narrative from *"where you are"* to *"your first step"*, plus your transferable strengths, the real gaps (core vs. bonus), and a prioritized roadmap with curated learning resources.
4. **Tailor it to a real job** — paste a job description and Zeno detects which specialization it emphasizes (RAG / Agents / Evaluation) and re-scores your gaps and roadmap accordingly.

Available in **English, 简体中文, and 繁體中文**.

---

## How Zeno Thinks

Zeno splits **decision** from **expression**:

- A **deterministic engine** computes your strengths, gaps, skill dependencies and ranking. It runs on a skill graph calibrated against real job postings, so results are reproducible and grounded — not vibes.
- An **LLM** (DeepSeek, or any OpenAI-compatible provider) *only* rephrases the diagnosis into natural, human language. It never decides your gaps.

This is why Zeno can be both warm and honest: the numbers come from data and code; the LLM just helps them speak.

Zeno models growth as a **skill graph** — `Current Skills → Missing Capabilities → Learning Path` — where each skill connects through prerequisite relationships, so Zeno can tell you what to learn *first*, not just what to learn.

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

The full graph (23 skills, 4 dimensions, dependencies, and target-role orientations) lives in [`apps/api/app/data/skill_graph.json`](apps/api/app/data/skill_graph.json). Learning resources are recommended by a small **RAG engine**: embedding retrieval over pgvector + multi-signal rerank (relevance, freshness, level-fit), with an optional LLM curation agent.

---

## Tech Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 15 (App Router), React Flow, Framer Motion, next-intl (en / zh / zh-TW) |
| Backend | FastAPI (Python), SQLAlchemy, Alembic |
| Database | Postgres 16 + pgvector |
| LLM | **0G Compute** (decentralized, verifiable) / DeepSeek / any OpenAI-compatible provider — *expression only* |
| Engine | Deterministic decision engine + RAG resource retrieval |

### Verifiable expression on 0G Compute

Because Zeno already isolates the LLM to *expression only*, the phrasing layer runs on **[0G Compute](https://pc.0g.ai)** — a decentralized, TEE-backed inference network — via its OpenAI-compatible Router. The decision (gaps, ranking, readiness) stays fully deterministic; only the "voice" narrative is delegated. Each generation returns an on-chain-verifiable **request id**, surfaced on the result page as a `0G Verifiable Inference` badge — so the diagnosis narrative is provably produced on decentralized compute, not a black box.

Enable it by setting `ZG_API_KEY` (+ optional `ZG_MODEL`) in `apps/api/.env`; leave it unset and Zeno falls back to DeepSeek, then a deterministic template.

```
zeno/
├── docker-compose.yml
├── scripts/            # one-command setup & dev
└── apps/
    ├── api/            # FastAPI backend (engine, RAG, JD matching)
    └── web/            # Next.js frontend (star-map, migration map)
```

---

## Local Development

### Requirements

- Node.js 20+
- Python 3.11+
- pnpm
- Postgres 16 + pgvector — via Docker, or a local/Homebrew install

### Quick start (one command)

```bash
npm run dev      # or: bash scripts/dev.sh
```

The first run installs everything (backend venv + deps, frontend deps), starts Postgres (Docker if present, otherwise your local Homebrew install), runs migrations, seeds the resource library, then launches the API on **:8000** and the web app on **:3000**. Press Ctrl-C to stop both. **No API key needed** — the engine runs fully on deterministic providers; add a DeepSeek key only to enable the natural-language voice and live resource curation.

### Manual setup (step by step)

```bash
# Database (skip if you run Postgres locally)
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
- [ ] More current & target roles (incl. PM → AI PM)
- [ ] Deeper agent-assisted resource curation
- [ ] Shareable "AI DNA" cards
- [ ] Richer evaluation/eval specialization paths

---

## Open Core

Zeno is open-source under the **Apache License 2.0**. The repository ships with a **demo skill graph** (`skill_graph.demo.json`) containing sample skills and weights so you can run the entire platform out of the box.

Production data — including the calibrated skill graph, JD corpus, and curated resource library — is maintained separately and not included in this repository. You are welcome to replace the demo data with your own domain-specific skill definitions.

"Zeno" and the Zippi mascot are trademarks of Teresa Peng — see [NOTICE](NOTICE) for details.

---

## License

[Apache License 2.0](LICENSE) © 2026 Teresa Peng
