"""Rebuild all stored resource embeddings with the configured provider.

Run from ``apps/api`` after changing EMBEDDING_PROVIDER or its model:

    .venv/bin/python scripts/reembed_resources.py

All vectors are computed before the transaction is committed. If model loading
or encoding fails, existing database vectors remain untouched.
"""

from __future__ import annotations

import argparse

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.db import SessionLocal
from app.llm.embedding import get_embedder
from app.models import Resource
from app.services.resource_service import build_embed_text


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild all resource embeddings")
    parser.add_argument("--dry-run", action="store_true", help="encode without writing")
    args = parser.parse_args()

    if settings.embedding_provider == "mock":
        raise SystemExit("Refusing to reindex with EMBEDDING_PROVIDER=mock")

    embedder = get_embedder()
    with SessionLocal() as db:
        resources = list(
            db.scalars(
                select(Resource)
                .options(selectinload(Resource.skills))
                .order_by(Resource.id)
            ).all()
        )
        texts = [
            build_embed_text(
                resource.title,
                resource.summary,
                [mapping.skill_id for mapping in resource.skills],
            )
            for resource in resources
        ]
        model_name = (
            settings.bge_model
            if settings.embedding_provider == "bge"
            else settings.embedding_model
        )
        print(
            f"Encoding {len(resources)} resources with "
            f"provider={settings.embedding_provider} model={model_name}..."
        )
        vectors = embedder.embed(texts)
        if len(vectors) != len(resources):
            raise RuntimeError("Embedding provider returned an unexpected vector count")
        if any(len(vector) != settings.embedding_dim for vector in vectors):
            raise RuntimeError("Embedding provider returned an unexpected vector dimension")

        if args.dry_run:
            print(f"Dry run complete: {len(vectors)} vectors, dim={embedder.dim}")
            return

        for resource, vector in zip(resources, vectors, strict=True):
            resource.embedding = vector
        db.commit()
        print(f"Updated {len(resources)} resources, dim={embedder.dim}")


if __name__ == "__main__":
    main()
