"""Ingest JD JSONL files into the jd_documents table.

Reads all auto-discovered raw/*/jds.jsonl dumps, classifies each JD
(engineering / product / algorithm / support), and upserts into the DB.
Existing rows with the same (source_id, external_id) are skipped.

Run:
    cd apps/api && python -m scripts.ingest_jds
"""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import JdDocument
from scripts.build_jd_evidence import (
    _classify_jd,
    _HARD_EXCLUDE_TITLES,
    discover_jd_sources,
)


def ingest_jsonl(dir_path: Path, source_id: str) -> dict[str, int]:
    """Ingest a single JSONL file into jd_documents. Returns stats."""
    jsonl_path = dir_path / "jds.jsonl"
    if not jsonl_path.exists():
        return {"skipped": 0, "inserted": 0, "duplicate": 0}

    db = SessionLocal()
    stats = {"inserted": 0, "duplicate": 0, "total": 0}
    try:
        for line in jsonl_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            obj = json.loads(line)
            stats["total"] += 1
            external_id = obj.get("id", "")

            # check duplicate
            exists = db.execute(
                select(JdDocument.id).where(
                    JdDocument.source_id == source_id,
                    JdDocument.external_id == external_id,
                )
            ).scalar_one_or_none()
            if exists:
                stats["duplicate"] += 1
                continue

            title = obj.get("title", "")
            if title.lower() in _HARD_EXCLUDE_TITLES:
                role_cat = "hard_exclude"
            else:
                role_cat = _classify_jd(title)

            doc = JdDocument(
                external_id=external_id,
                source_id=source_id,
                company=obj.get("company", ""),
                title=title,
                description=obj.get("description", ""),
                requirements=obj.get("requirements"),
                platform=obj.get("platform", "official"),
                search_keyword=obj.get("search_keyword", ""),
                city=obj.get("city", ""),
                url=obj.get("url"),
                recruit_type=obj.get("recruit_type", "社招"),
                role_category=role_cat,
                collected_at=obj.get("collected_at", "2026-01-01"),
            )
            db.add(doc)
            stats["inserted"] += 1

        db.commit()
    finally:
        db.close()
    return stats


def main() -> None:
    print("=== Ingesting JD documents into database ===\n")
    total_inserted = 0
    for dir_path, src in discover_jd_sources():
        print(f"  [{src.source_id}] {dir_path.name}/jds.jsonl")
        stats = ingest_jsonl(dir_path, src.source_id)
        print(f"    total={stats['total']}  inserted={stats['inserted']}  duplicate={stats['duplicate']}")
        total_inserted += stats["inserted"]
    print(f"\nDone. {total_inserted} new JD documents inserted.")


if __name__ == "__main__":
    main()
