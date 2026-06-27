"""Lookup migration_value for a skill_id from experience_capsules.json.

The capsule data defines migration_value per capability, and maps_to defines
which skills a capability maps to. This module inverts that mapping so the
decision engine can ask "what is the migration_value for skill X?".

If a skill is mapped by multiple capabilities, we take the max migration_value.
If a skill has no mapping, we return a default of 0.5.
"""

from __future__ import annotations

import json
from pathlib import Path

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "experience_capsules.json"
_DEFAULT_MV = 0.5

# Lazily loaded: skill_id -> migration_value
_SKILL_MV: dict[str, float] | None = None


def _load() -> dict[str, float]:
    global _SKILL_MV
    if _SKILL_MV is not None:
        return _SKILL_MV

    _SKILL_MV = {}
    if not _DATA_PATH.exists():
        return _SKILL_MV

    data = json.loads(_DATA_PATH.read_text(encoding="utf-8"))

    # Walk capabilities + ai_exploration capsules
    all_caps = data.get("capabilities", [])
    ai_exp = data.get("ai_exploration", {})
    if ai_exp:
        all_caps = all_caps + ai_exp.get("capsules", [])

    for cap in all_caps:
        mv = cap.get("migration_value", _DEFAULT_MV)
        for mapping in cap.get("maps_to", []):
            sid = mapping.get("skill_id", "")
            if sid:
                # Take max if multiple capabilities map to same skill
                _SKILL_MV[sid] = max(_SKILL_MV.get(sid, 0), mv)

    return _SKILL_MV


def get_migration_value(skill_id: str) -> float:
    """Return the migration_value for a skill. Defaults to 0.5 if unmapped."""
    mv_map = _load()
    return mv_map.get(skill_id, _DEFAULT_MV)
