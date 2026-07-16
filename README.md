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
5. **Own your journey on-chain (AI×Web3)** — one click mints your migration journey as a Soulbound Transfer Passport (ERC-5192, non-transferable) on Base Sepolia, rendered fully on-chain as SVG. Every passport gets a public verification page (`/passport/[id]`) that reads straight from the chain — anyone can verify it without trusting Zeno's servers. Re-minting updates the same token as you grow.

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

Because Zeno already isolates the LLM to *expression only*, the phrasing layer runs on **[0G Compute](https://pc.0g.ai)** — a decentralized, TEE-backed inference network — via its OpenAI-compatible Router. The decision (gaps, ranking, readiness) stays fully deterministic; only the "voice" narrative is delegated.

For every 0G generation, Zeno sends `verify_tee: true` and reads the Router-native `x_0g_trace` receipt instead of treating the ordinary OpenAI-compatible completion id as proof. The receipt contains the 0G **Request ID**, the on-chain **provider address**, and the `tee_verified` result. The result page displays the `0G Verifiable Inference` badge only when synchronous TEE verification succeeds.

Enable it in `apps/api/.env`:

```bash
ZG_API_KEY=sk-...
ZG_BASE_URL=https://router-api.0g.ai/v1
ZG_MODEL=<model-id-from-the-live-0G-catalog>
```

Choose a current model id from [0G Private Computer](https://pc.0g.ai/models). Keep the key server-side and never expose it through a `NEXT_PUBLIC_` variable. If `ZG_API_KEY` is unset or the request fails, Zeno falls back to DeepSeek and then to a deterministic template; no 0G verification badge is shown for fallback output.

```
zeno/
├── docker-compose.yml
├── dev.sh              # starts the API and web app together
└── apps/
    ├── api/            # FastAPI backend (engine, RAG, JD matching)
    └── web/            # Next.js frontend (star-map, migration map)
```

---

## Local Development

### Requirements

- Node.js 20+
- Python 3.11+
- npm
- Postgres 16 + pgvector — via Docker, or a local/Homebrew install

### Quick start (one command)

```bash
cd /path/to/zeno
./dev.sh
```

If the script is not executable, use `bash dev.sh`. It stops existing processes on ports **3000** and **8000**, then launches the FastAPI backend with reload on [http://localhost:8000](http://localhost:8000) and the Next.js frontend on [http://localhost:3000](http://localhost:3000). Press Ctrl-C to stop both.

This command expects the backend virtual environment at `apps/api/.venv` and the frontend dependencies to be installed. Follow the manual setup below once if they are missing. **No API key is needed** for the deterministic engine; add a DeepSeek key only to enable the natural-language voice and live resource curation.

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
npm install
npm run dev
```

Open http://localhost:3000.

### Local BGE embeddings

Resource retrieval uses local multilingual BGE-M3 embeddings by default in the
development `.env`. Install the optional runtime once, then rebuild all stored
resource vectors whenever the embedding provider or model changes:

```bash
cd apps/api
source .venv/bin/activate
pip install -e ".[bge]"
python scripts/reembed_resources.py
```

### Semi-automatic resource curation

The curation harness stages fetched pages in a review queue; model output never
enters retrieval before approval. Set `DEEPSEEK_API_KEY`, then run from `apps/api`:

```bash
.venv/bin/python scripts/curate_resources.py seed
.venv/bin/python scripts/curate_resources.py ingest urls.txt --source official-docs
.venv/bin/python scripts/curate_resources.py export pending-resources.json
.venv/bin/python scripts/curate_resources.py approve <candidate-id>
.venv/bin/python scripts/curate_resources.py reject <candidate-id> --reason "too thin"
```

Start with allow-listed official documentation, official GitHub repositories,
and university courses. DeepSeek proposes structured labels; humans only review
publication candidates and maintain a small gold evaluation set.

The first run downloads the model. BGE-M3's normalized 1024-dimensional output
is zero-padded to the existing 1536-dimensional pgvector column; cosine ranking
is unchanged. The model cache and `.env` remain local and are not committed.

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
