#!/usr/bin/env python3
"""Resource curation CLI.

Examples:
  .venv/bin/python scripts/curate_resources.py seed
  .venv/bin/python scripts/curate_resources.py ingest urls.txt --source official-docs --auto-publish
  .venv/bin/python scripts/curate_resources.py label-seeds --auto-publish
  .venv/bin/python scripts/curate_resources.py export pending.json
  .venv/bin/python scripts/curate_resources.py approve <candidate-id>
  .venv/bin/python scripts/curate_resources.py reject <candidate-id> --reason "too thin"
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import select

from app.core.db import SessionLocal
from app.data.seed_resources import SEED_RESOURCES
from app.domain.resource_harness import approve_candidate, reject_candidate, stage_url
from app.models import ResourceCandidate
from app.services import resource_service


def _urls(path: Path) -> list[dict]:
    raw = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("JSON input must be a list")
        return [{"url": x} if isinstance(x, str) else x for x in data]
    return [{"url": line.strip()} for line in raw.splitlines() if line.strip() and not line.lstrip().startswith("#")]


def main() -> None:
    parser = argparse.ArgumentParser(description="Zeno resource curation harness")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed", help="upsert all bundled hand-curated resources")
    ingest = sub.add_parser("ingest", help="fetch and DeepSeek-label URL candidates")
    ingest.add_argument("input", type=Path, help="newline URL file or JSON list")
    ingest.add_argument("--source", default="manual")
    ingest.add_argument(
        "--auto-publish",
        action="store_true",
        help="publish successfully fetched and LLM-labelled candidates; dead links stay failed",
    )
    label_seeds = sub.add_parser("label-seeds", help="fetch and DeepSeek-label the bundled seed URLs")
    label_seeds.add_argument(
        "--auto-publish",
        action="store_true",
        help="publish successfully fetched and LLM-labelled seeds",
    )
    export = sub.add_parser("export", help="export candidates for human review")
    export.add_argument("output", type=Path)
    export.add_argument("--status", default="pending", choices=["pending", "approved", "rejected", "failed", "all"])
    approve = sub.add_parser("approve", help="publish one candidate and create its BGE embedding")
    approve.add_argument("candidate_id")
    reject = sub.add_parser("reject", help="reject one candidate")
    reject.add_argument("candidate_id")
    reject.add_argument("--reason", default="human review")
    args = parser.parse_args()

    with SessionLocal() as db:
        if args.command == "seed":
            for item in SEED_RESOURCES:
                resource_service.upsert_resource(db, **item)
            print(json.dumps({"seeded": len(SEED_RESOURCES)}, ensure_ascii=False))
        elif args.command in {"ingest", "label-seeds"}:
            results = []
            items = _urls(args.input) if args.command == "ingest" else SEED_RESOURCES
            default_source = args.source if args.command == "ingest" else "seed-llm"
            for item in items:
                candidate = stage_url(
                    db,
                    url=item["url"],
                    title=item.get("title", ""),
                    source=item.get("source", item.get("platform", default_source)),
                )
                if args.auto_publish and candidate.status == "pending":
                    approve_candidate(db, candidate)
                results.append({"id": candidate.id, "url": candidate.url, "status": candidate.status, "error": candidate.error})
                print(json.dumps(results[-1], ensure_ascii=False))
        elif args.command == "export":
            stmt = select(ResourceCandidate).order_by(ResourceCandidate.created_at.desc())
            if args.status != "all":
                stmt = stmt.where(ResourceCandidate.status == args.status)
            rows = db.scalars(stmt).all()
            payload = [
                {
                    "id": c.id,
                    "title": c.title,
                    "url": c.url,
                    "source": c.source,
                    "status": c.status,
                    "annotation": c.annotation,
                    "model_name": c.model_name,
                    "error": c.error,
                }
                for c in rows
            ]
            args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({"exported": len(payload), "output": str(args.output)}, ensure_ascii=False))
        else:
            candidate = db.get(ResourceCandidate, args.candidate_id)
            if candidate is None:
                raise SystemExit(f"candidate not found: {args.candidate_id}")
            if args.command == "approve":
                approve_candidate(db, candidate)
            else:
                reject_candidate(db, candidate, args.reason)
            print(json.dumps({"id": candidate.id, "status": candidate.status}, ensure_ascii=False))


if __name__ == "__main__":
    main()
