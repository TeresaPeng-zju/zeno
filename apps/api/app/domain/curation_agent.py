"""Resource curation Agent — Function Calling tool chain (Week 3).

Goal: given a skill gap, autonomously grow the resource library by running the
chain: search -> fetch -> summarize -> embed+store -> verify. The library is
deduped on `url_hash`, so re-running the agent is idempotent.

Two execution modes share ONE tool registry & executor:
  * LLM mode (`run_with_llm`)   — OpenAI plans tool calls (true function calling).
  * scripted mode (`run`)       — drives the same tools in canonical order, so the
                                  pipeline runs deterministically offline (tests,
                                  no key, no network).

Tool implementations (search/fetch/summarize) are injected via Protocols, which
is what makes the whole agent testable without hitting the network.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.data.seed_resources import CANDIDATE_POOL
from app.models import Resource, url_hash as compute_url_hash
from app.services import freshness, resource_service


# --------------------------------------------------------------------------- #
# Injectable tool backends
# --------------------------------------------------------------------------- #
class Searcher(Protocol):
    def search(self, query: str, k: int) -> list[dict]:
        ...


class Fetcher(Protocol):
    def fetch(self, url: str) -> dict:
        ...


class Summarizer(Protocol):
    def summarize(self, title: str, text: str) -> str:
        ...


class SeedSearcher:
    """Offline searcher: ranks the candidate pool by keyword/skill overlap."""

    def __init__(self, pool: list[dict] | None = None) -> None:
        self._pool = pool if pool is not None else CANDIDATE_POOL

    def search(self, query: str, k: int) -> list[dict]:
        q = query.lower()
        terms = set(q.split())

        def score(item: dict) -> int:
            hay = f"{item['title']} {item.get('summary', '')} {' '.join(item['skill_ids'])}".lower()
            return sum(1 for t in terms if t in hay)

        ranked = sorted(self._pool, key=score, reverse=True)
        return [r for r in ranked if score(r) > 0][:k] or ranked[:k]


class StaticFetcher:
    """Offline fetcher: returns the candidate's summary as page text."""

    def fetch(self, url: str) -> dict:
        for item in CANDIDATE_POOL:
            if item["url"] == url:
                status = 404 if "404" in url or "deprecated" in url else 200
                return {"url": url, "status": status, "text": item.get("summary", "")}
        return {"url": url, "status": 404, "text": ""}


class TruncateSummarizer:
    """Offline summarizer: deterministic truncation (no LLM needed)."""

    def summarize(self, title: str, text: str) -> str:
        body = (text or title).strip().replace("\n", " ")
        return body[:160]


class LLMSummarizer:
    """OpenAI-backed summarizer; falls back to truncation on failure."""

    def __init__(self) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=settings.openai_api_key)
        self._model = settings.openai_model
        self._fallback = TruncateSummarizer()

    def summarize(self, title: str, text: str) -> str:
        try:
            resp = self._client.chat.completions.create(
                model=self._model,
                temperature=0.2,
                messages=[
                    {"role": "system", "content": "用一句中文概括这份学习资源的核心内容，不超过60字。"},
                    {"role": "user", "content": f"标题：{title}\n内容：{text[:2000]}"},
                ],
            )
            return (resp.choices[0].message.content or "").strip() or self._fallback.summarize(title, text)
        except Exception:
            return self._fallback.summarize(title, text)


class _UrlPatternChecker:
    """Offline freshness checker: 404 for broken-looking urls, else 200."""

    def check(self, url: str) -> tuple[int | None, str | None]:
        if "404" in url or "deprecated" in url:
            return 404, "not found"
        return 200, None


# --------------------------------------------------------------------------- #
# Tool registry (OpenAI function-calling schema)
# --------------------------------------------------------------------------- #
AGENT_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_resources",
            "description": "按关键词搜索候选学习资源，返回标题与 URL 列表。",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_page",
            "description": "抓取一个 URL 的正文内容与 HTTP 状态。",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "store_resource",
            "description": "对资源做摘要、向量化并幂等入库（按 url 去重）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "url": {"type": "string"},
                    "text": {"type": "string"},
                    "target_level": {"type": "integer"},
                    "platform": {"type": "string"},
                    "resource_type": {"type": "string"},
                },
                "required": ["title", "url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "verify_link",
            "description": "校验已入库资源的链接是否有效/时效，更新保鲜状态。",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
]


@dataclass
class AgentRun:
    skill_id: str
    steps: list[dict] = field(default_factory=list)
    stored: int = 0
    deduped: int = 0
    verified: int = 0

    def log(self, tool: str, args: dict, result: dict) -> None:
        self.steps.append({"tool": tool, "args": args, "result": result})


@dataclass
class ToolContext:
    db: Session
    skill_id: str
    target_level: int
    searcher: Searcher
    fetcher: Fetcher
    summarizer: Summarizer
    run: AgentRun


def _exec_tool(ctx: ToolContext, name: str, args: dict) -> dict:
    """Execute one tool call and return a JSON-serializable result."""
    if name == "search_resources":
        hits = ctx.searcher.search(args["query"], settings.agent_search_results)
        result = {"results": [{"title": h["title"], "url": h["url"]} for h in hits]}
    elif name == "fetch_page":
        result = ctx.fetcher.fetch(args["url"])
    elif name == "store_resource":
        url = args["url"]
        uh = compute_url_hash(url)
        existed = ctx.db.scalar(select(Resource).where(Resource.url_hash == uh)) is not None
        summary = ctx.summarizer.summarize(args["title"], args.get("text", ""))
        res = resource_service.upsert_resource(
            ctx.db,
            title=args["title"],
            url=url,
            skill_ids=[ctx.skill_id],
            platform=args.get("platform", ""),
            resource_type=args.get("resource_type", "article"),
            target_level=int(args.get("target_level", ctx.target_level)),
            summary=summary,
        )
        if existed:
            ctx.run.deduped += 1
        else:
            ctx.run.stored += 1
        result = {"id": res.id, "deduped": existed, "summary": summary}
    elif name == "verify_link":
        uh = compute_url_hash(args["url"])
        res = ctx.db.scalar(select(Resource).where(Resource.url_hash == uh))
        if res is None:
            result = {"error": "not stored"}
        else:
            freshness.verify_resource(ctx.db, res, _UrlPatternChecker())
            ctx.run.verified += 1
            result = {"freshness_status": res.freshness_status, "http_status": res.http_status}
    else:
        result = {"error": f"unknown tool {name}"}

    ctx.run.log(name, args, result)
    return result


# --------------------------------------------------------------------------- #
# Scripted mode (deterministic, offline) — canonical tool order
# --------------------------------------------------------------------------- #
def run(
    db: Session,
    *,
    skill_id: str,
    skill_name: str,
    target_level: int,
    searcher: Searcher | None = None,
    fetcher: Fetcher | None = None,
    summarizer: Summarizer | None = None,
) -> AgentRun:
    """Drive the tool chain deterministically: search -> (fetch -> store)* -> verify."""
    run_state = AgentRun(skill_id=skill_id)
    ctx = ToolContext(
        db=db,
        skill_id=skill_id,
        target_level=target_level,
        searcher=searcher or SeedSearcher(),
        fetcher=fetcher or StaticFetcher(),
        summarizer=summarizer or TruncateSummarizer(),
        run=run_state,
    )

    query = f"{skill_name} 教程 实践 L{target_level}"
    hits = _exec_tool(ctx, "search_resources", {"query": query})["results"]

    for hit in hits[: settings.agent_max_steps]:
        page = _exec_tool(ctx, "fetch_page", {"url": hit["url"]})
        _exec_tool(
            ctx,
            "store_resource",
            {"title": hit["title"], "url": hit["url"], "text": page.get("text", "")},
        )
        _exec_tool(ctx, "verify_link", {"url": hit["url"]})

    return run_state


# --------------------------------------------------------------------------- #
# LLM mode (true function calling) — OpenAI plans the tool calls
# --------------------------------------------------------------------------- #
def run_with_llm(
    db: Session, *, skill_id: str, skill_name: str, target_level: int
) -> AgentRun:
    """OpenAI-driven agent loop. Requires a key; otherwise raises so callers can
    fall back to `run`. Shares the exact same tool executor as scripted mode."""
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    run_state = AgentRun(skill_id=skill_id)
    ctx = ToolContext(
        db=db,
        skill_id=skill_id,
        target_level=target_level,
        searcher=SeedSearcher(),
        fetcher=StaticFetcher(),
        summarizer=LLMSummarizer(),
        run=run_state,
    )

    messages: list[dict] = [
        {
            "role": "system",
            "content": (
                "你是 Zeno 的资源策展 Agent。目标：为给定技能找到并入库 2-4 个优质学习资源。"
                "流程：先 search_resources，对每个结果 fetch_page，再 store_resource 入库，"
                "最后 verify_link 校验。完成后用一句话总结。"
            ),
        },
        {
            "role": "user",
            "content": f"技能：{skill_name}（id={skill_id}），目标档位 L{target_level}。",
        },
    ]

    for _ in range(settings.agent_max_steps):
        resp = client.chat.completions.create(
            model=settings.openai_model, messages=messages, tools=AGENT_TOOLS, temperature=0.2
        )
        msg = resp.choices[0].message
        if not msg.tool_calls:
            break
        messages.append(msg.model_dump())
        for tc in msg.tool_calls:
            args = json.loads(tc.function.arguments or "{}")
            result = _exec_tool(ctx, tc.function.name, args)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )

    return run_state


def curate(db: Session, *, skill_id: str, skill_name: str, target_level: int) -> AgentRun:
    """Dispatch to the LLM agent when configured, else the scripted pipeline."""
    if settings.llm_provider == "openai" and settings.openai_api_key:
        try:
            return run_with_llm(db, skill_id=skill_id, skill_name=skill_name, target_level=target_level)
        except Exception:
            pass
    return run(db, skill_id=skill_id, skill_name=skill_name, target_level=target_level)
