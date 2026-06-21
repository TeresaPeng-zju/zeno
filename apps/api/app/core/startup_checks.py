"""Startup / CI integrity checks.

The skill catalog is "config as code" (app/data/skill_graph.json), not a DB
table, so there is no foreign key guarding `skill_id`. To get the same safety
without a second source of truth, we fail fast at startup (and in CI) if any
static reference points at a skill that does not exist in the graph.

Runtime writes are guarded separately by `resource_service._validate_skill_ids`.
"""

from __future__ import annotations

from app.data.seed_resources import CANDIDATE_POOL
from app.domain import competency


def validate_skill_references() -> None:
    """Raise if role requirements or seed resources reference an unknown skill_id.

    `CANDIDATE_POOL` is a superset of `SEED_RESOURCES`, so iterating it covers
    everything that can be loaded into the resource library.
    """
    catalog = set(competency.SKILLS_BY_ID)
    problems: list[str] = []

    for req in competency.ROLE_REQUIREMENTS:
        if req.skill_id not in catalog:
            problems.append(f"role_requirement references unknown skill_id: {req.skill_id!r}")

    seen: set[str] = set()
    for item in CANDIDATE_POOL:
        url = item["url"]
        if url in seen:
            continue
        seen.add(url)
        for sid in item.get("skill_ids", []):
            if sid not in catalog:
                problems.append(
                    f"seed resource {url!r} references unknown skill_id: {sid!r}"
                )

    if problems:
        raise RuntimeError(
            "skill graph integrity check failed:\n  - " + "\n  - ".join(problems)
        )
