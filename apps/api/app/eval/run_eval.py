"""Run the retrieval eval harness end-to-end (offline, deterministic).

Builds an in-memory corpus from the candidate pool, embeds it with the mock
embedder, then for each eval query runs: embed -> cosine recall -> multi-signal
rerank, and scores the ranking with NDCG@10 / Hit@3 / Recall@5.

Usage:
    python -m app.eval.run_eval
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.data.seed_resources import CANDIDATE_POOL
from app.domain import competency
from app.domain.resource_engine import ScoredResource, rerank
from app.eval.eval_set import eval_set_for
from app.eval.metrics import hit_at_k, ndcg_at_k, recall_at_k
from app.llm.embedding import cosine_similarity, get_embedder
from app.services.resource_service import build_embed_text

_NOW = datetime.now(timezone.utc)


def _build_corpus() -> list[dict]:
    embedder = get_embedder()
    corpus = []
    for item in CANDIDATE_POOL:
        text = build_embed_text(item["title"], item.get("summary"), item["skill_ids"])
        dead = "404" in item["url"] or "deprecated" in item["url"]
        corpus.append(
            {
                **item,
                "embedding": embedder.embed_one(text),
                "freshness_status": "dead" if dead else "fresh",
            }
        )
    return corpus


def _recall(corpus: list[dict], skill_id: str, query_vec: list[float]) -> list[ScoredResource]:
    out: list[ScoredResource] = []
    for c in corpus:
        if skill_id not in c["skill_ids"]:
            continue
        out.append(
            ScoredResource(
                id=c["url"],
                title=c["title"],
                url=c["url"],
                platform=c["platform"],
                resource_type=c["resource_type"],
                target_level=c["target_level"],
                freshness_status=c["freshness_status"],
                last_verified_at=_NOW,
                quality_score=0.0,
                relevance=cosine_similarity(query_vec, c["embedding"]),
            )
        )
    out.sort(key=lambda s: s.relevance, reverse=True)
    return out


def evaluate(orientation: str = competency.ORIENTATION_BASE) -> dict:
    embedder = get_embedder()
    corpus = _build_corpus()
    eval_set = eval_set_for(orientation)

    ndcg_list, hit_list, recall_list = [], [], []
    for q in eval_set:
        qvec = embedder.embed_one(q.query)
        candidates = _recall(corpus, q.skill_id, qvec)
        ranked = rerank(candidates, gap_target_level=q.target_level, now=_NOW, limit=10)
        urls = [r.url for r in ranked]
        rel = set(q.relevant_urls)
        ndcg_list.append(ndcg_at_k(urls, rel, 10))
        hit_list.append(hit_at_k(urls, rel, 3))
        recall_list.append(recall_at_k(urls, rel, 5))

    n = len(eval_set)
    return {
        "orientation": orientation,
        "N": n,
        "ndcg@10": round(sum(ndcg_list) / n, 4),
        "hit@3": round(sum(hit_list) / n, 4),
        "recall@5": round(sum(recall_list) / n, 4),
    }


def main() -> None:
    print("Zeno retrieval eval (offline, mock embedder)")
    for orientation in (competency.ORIENTATION_BASE, competency.ORIENTATION_RAG):
        report = evaluate(orientation)
        print(f"[orientation = {report['orientation']}]")
        print(f"  N         = {report['N']}")
        print(f"  NDCG@10   = {report['ndcg@10']}")
        print(f"  Hit@3     = {report['hit@3']}")
        print(f"  Recall@5  = {report['recall@5']}")


if __name__ == "__main__":
    main()
