"""JD-grounded scorers — market alignment (anygen's A + B).

These turn the deterministic JD weak labels (app/data/jd_evidence.json, built by
scripts/build_jd_evidence.py from the real bytedance JD spreadsheet) into two
soft-but-quantified metrics:

  * A. gap precision / recall — does the planner recommend skills the market
    actually asks for? Precision = of what it told you to learn, how much the JDs
    corroborate; Recall = of the top JD-demanded skills, how many it covered.

  * B. nDCG@k — is the *ordering* aligned with real demand? gain(skill) = the
    fraction of JDs mentioning it, so a planner is rewarded for putting
    high-demand skills first, not for a hunch.

Unlike the decision-surface scorers, the ground signal here is EXTERNAL to Zeno
(real JD text), so these numbers are not self-referential — they can genuinely
separate planners.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

_EVIDENCE_FILE = Path(__file__).resolve().parents[2] / "data" / "jd_evidence.json"


@lru_cache(maxsize=1)
def _evidence() -> dict:
    if not _EVIDENCE_FILE.exists():
        raise FileNotFoundError(
            f"{_EVIDENCE_FILE} missing — run `python -m scripts.build_jd_evidence` first."
        )
    return json.loads(_EVIDENCE_FILE.read_text(encoding="utf-8"))


def jd_frequency() -> dict[str, float]:
    """skill_id -> fraction of JDs mentioning it (graph skills only)."""
    data = _evidence()
    return {
        sid: d["frequency"]
        for sid, d in data["skills"].items()
        if d.get("in_graph", True)
    }


def demanded_skills(min_freq: float = 0.05) -> set[str]:
    """Skills the market clearly asks for (freq >= threshold)."""
    return {sid for sid, f in jd_frequency().items() if f >= min_freq}


def top_demanded(n: int) -> list[str]:
    """The n highest-demand graph skills, by JD frequency."""
    ranked = sorted(jd_frequency().items(), key=lambda x: x[1], reverse=True)
    return [sid for sid, f in ranked[:n] if f > 0]


def gap_precision_recall(
    recommended: list[str], *, recall_top_n: int = 8, min_freq: float = 0.05
) -> tuple[float, float]:
    """(precision, recall) of a planner's recommended skill set vs JD evidence."""
    rec = set(recommended)
    evidence = demanded_skills(min_freq)
    core = set(top_demanded(recall_top_n))

    precision = len(rec & evidence) / len(rec) if rec else 0.0
    recall = len(rec & core) / len(core) if core else 0.0
    return round(precision, 4), round(recall, 4)


def _dcg(gains: list[float]) -> float:
    return sum(g / math.log2(i + 2) for i, g in enumerate(gains))


def ndcg_at_k(ranked: list[str], k: int = 10) -> float:
    """Graded nDCG@k where gain(skill) = its JD frequency (market demand)."""
    freq = jd_frequency()
    gains = [freq.get(sid, 0.0) for sid in ranked[:k]]
    ideal = sorted(freq.values(), reverse=True)[:k]
    idcg = _dcg(ideal)
    return round(_dcg(gains) / idcg, 4) if idcg > 0 else 0.0
