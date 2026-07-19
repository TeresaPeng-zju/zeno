"""Audit layer — turn a deterministic plan into a defensible evidence chain.

This is the product-facing answer to two questions a high-trust career tool
must be able to answer, and that a black-box model cannot:

  1. "为什么这一步排在这里?"  -> per-step provenance: the exact score terms
     (gap / dependency-urgency / learnability), the dependency constraint that
     pinned its position, and the *external* JD demand behind it.

  2. "为什么这次和上次不一样?" -> a plan diff that is *causally attributable*:
     the ordering only ever changes because an INPUT changed, and `diff_plans`
     shows which observation moved and how the order shifted as a result.

Nothing here is stochastic. `plan_fingerprint` is a content hash over
(role, orientation, observations, skill-graph data): identical fingerprint ⇒
bit-identical plan, by construction — the auditable counterpart of "1/N".
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

from app.domain import competency, decision
from app.domain.decision import NextStep, SkillObservation
from app.i18n import t

_EVIDENCE_FILE = Path(__file__).resolve().parent.parent / "data" / "jd_evidence.json"
_GRAPH_FILE = competency._SKILL_GRAPH_FILE


@lru_cache(maxsize=1)
def _evidence() -> dict:
    """JD weak-label evidence (built from real JD text). Empty if not generated."""
    if not _EVIDENCE_FILE.exists():
        return {"skills": {}, "n_jds": 0}
    return json.loads(_EVIDENCE_FILE.read_text(encoding="utf-8"))


def _jd_evidence_for(skill_id: str) -> dict:
    data = _evidence()
    rec = data.get("skills", {}).get(skill_id)
    if not rec:
        return {"jd_count": 0, "frequency": 0.0, "n_jds": data.get("n_jds", 0), "grounded": False}
    return {
        "jd_count": rec.get("jd_count", 0),
        "frequency": rec.get("frequency", 0.0),
        "n_jds": data.get("n_jds", 0),
        # v2 ledger exposes an explicit `grounded` flag; `evidence` is now the
        # provenance list, so we no longer derive groundedness from its truthiness.
        "grounded": bool(rec.get("grounded", bool(rec.get("evidence", False)))),
    }


def ranking_reasons_for_step(step: NextStep, lang: str = "en") -> list[str]:
    """User-facing ranking reasons built only from decision inputs and evidence."""
    reasons: list[str] = []
    jd = _jd_evidence_for(step.skill_id)
    frequency = float(jd.get("frequency") or 0)
    if jd.get("grounded") and frequency > 0:
        reasons.append(
            t(
                lang,
                "ranking.jd",
                total=int(jd.get("n_jds") or 0),
                pct=round(frequency * 100),
            )
        )

    if step.unblocks:
        names = t(lang, "join.sep").join(_name(skill_id, lang) for skill_id in step.unblocks[:3])
        reasons.append(
            t(
                lang,
                "ranking.unblocks",
                count=len(step.unblocks),
                names=names,
            )
        )

    migration = float(step.score_components.get("migration_value") or 0)
    if migration > 0:
        reasons.append(
            t(
                lang,
                "ranking.migration",
                pct=round(migration * 100),
                current=step.current_level,
                target=step.target_level,
            )
        )
    return reasons


@lru_cache(maxsize=1)
def _graph_digest() -> str:
    """Short content hash of the skill graph — the 'which graph version' stamp."""
    raw = _GRAPH_FILE.read_bytes()
    return hashlib.sha256(raw).hexdigest()[:12]


def plan_fingerprint(
    role_id: str,
    obs: dict[str, SkillObservation],
    orientation_id: str = competency.ORIENTATION_BASE,
) -> str:
    """Deterministic content hash of the full decision input.

    Same fingerprint ⇒ same plan, provably (the plan is a pure function of these
    inputs). This is what you hand an auditor: not "it ran the same 6 times" but
    "this input maps to exactly this output, here is the stamp".
    """
    canonical = {
        "role": role_id,
        "orientation": orientation_id,
        "graph": _graph_digest(),
        # observations sorted by skill_id so dict order can never perturb the hash
        "obs": sorted(
            ([sid, o.level, round(o.confidence, 6)] for sid, o in obs.items()),
            key=lambda x: x[0],
        ),
    }
    blob = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def _name(skill_id: str, lang: str = "en") -> str:
    return competency.skill_name(skill_id, lang)


def _explain_one(step: NextStep, lang: str = "en") -> dict:
    """The full provenance record for a single ranked step."""
    comp = step.score_components
    jd = _jd_evidence_for(step.skill_id)
    sep = t(lang, "join.sep")

    # The dependency constraint that pinned its position (the topological reason).
    if step.blocked_by:
        dep_reason = t(
            lang,
            "explain.dep.blocked",
            names=sep.join(_name(d, lang) for d in step.blocked_by),
        )
    else:
        dep_reason = t(lang, "explain.dep.clear")

    # Plain-language attribution of the score, term by term.
    score_breakdown = [
        t(
            lang,
            "explain.score.gap",
            a=comp.get("gap_score_norm", 0),
            b=comp.get("gap_term", 0),
        ),
        t(
            lang,
            "explain.score.dep",
            a=comp.get("dependency_urgency", 0),
            b=comp.get("dependency_term", 0),
        ),
        t(
            lang,
            "explain.score.learn",
            a=comp.get("learnability", 0),
            b=comp.get("learnability_term", 0),
        ),
    ]
    if comp.get("blocked_penalty", 1.0) != 1.0:
        score_breakdown.append(
            t(lang, "explain.score.blocked", p=comp.get("blocked_penalty"))
        )

    return {
        "rank": step.rank,
        "skill_id": step.skill_id,
        "skill_name": step.skill_name,
        "category": step.category,
        "current_level": step.current_level,
        "target_level": step.target_level,
        "next_score": step.next_score,
        "score_components": comp,
        "score_breakdown": score_breakdown,
        "jd_evidence": jd,
        "dependency": {
            "blocked_by": [{"skill_id": d, "name": _name(d, lang)} for d in step.blocked_by],
            "unblocks": [{"skill_id": d, "name": _name(d, lang)} for d in step.unblocks],
            "reason": dep_reason,
        },
        "why": step.why,
    }


def explain_plan(
    role_id: str,
    obs: dict[str, SkillObservation],
    orientation_id: str = competency.ORIENTATION_BASE,
    max_steps: int = decision.MAX_NEXT_STEPS,
    lang: str = "en",
) -> dict:
    """Full auditable evidence chain for a plan: fingerprint + per-step provenance."""
    steps = decision.select_next_steps(role_id, obs, max_steps, orientation_id, lang)
    return {
        "fingerprint": plan_fingerprint(role_id, obs, orientation_id),
        "graph_version": _graph_digest(),
        "role_id": role_id,
        "orientation": orientation_id,
        "n_jds": _evidence().get("n_jds", 0),
        "steps": [_explain_one(s, lang) for s in steps],
    }


def diff_plans(
    role_id: str,
    obs_before: dict[str, SkillObservation],
    obs_after: dict[str, SkillObservation],
    orientation_id: str = competency.ORIENTATION_BASE,
    max_steps: int = decision.MAX_NEXT_STEPS,
    lang: str = "en",
) -> dict:
    """Causally-attributed diff between two plans.

    The whole point: the ordering changes *only* because an input changed. This
    surfaces (a) which observations moved, and (b) how the ranking shifted — so
    "why is this different from last time" has a concrete, data-level answer,
    not "the model felt differently".
    """
    fp_before = plan_fingerprint(role_id, obs_before, orientation_id)
    fp_after = plan_fingerprint(role_id, obs_after, orientation_id)
    sep = t(lang, "join.sep")

    # (a) Which inputs changed.
    input_changes: list[dict] = []
    for sid in sorted(set(obs_before) | set(obs_after)):
        b = obs_before.get(sid)
        a = obs_after.get(sid)
        b_lvl = b.level if b else None
        a_lvl = a.level if a else None
        if b_lvl != a_lvl:
            input_changes.append(
                {"skill_id": sid, "skill_name": _name(sid, lang), "from": b_lvl, "to": a_lvl}
            )

    # (b) How the ordering shifted.
    before = decision.select_next_steps(role_id, obs_before, max_steps, orientation_id, lang)
    after = decision.select_next_steps(role_id, obs_after, max_steps, orientation_id, lang)
    rank_before = {s.skill_id: s.rank for s in before}
    rank_after = {s.skill_id: s.rank for s in after}

    order_changes: list[dict] = []
    for sid in sorted(set(rank_before) | set(rank_after)):
        rb = rank_before.get(sid)
        ra = rank_after.get(sid)
        if rb != ra:
            if rb is None:
                kind = "entered"
            elif ra is None:
                kind = "left"
            else:
                kind = "moved"
            order_changes.append(
                {"skill_id": sid, "skill_name": _name(sid, lang), "rank_before": rb, "rank_after": ra, "change": kind}
            )

    if fp_before == fp_after:
        attribution = t(lang, "explain.diff.identical")
    elif not order_changes:
        attribution = t(lang, "explain.diff.no_order")
    else:
        drivers = sep.join(
            f"{c['skill_name']} L{c['from']}→L{c['to']}" for c in input_changes
        ) or t(lang, "explain.diff.no_visible")
        attribution = t(lang, "explain.diff.drivers", drivers=drivers)

    return {
        "fingerprint_before": fp_before,
        "fingerprint_after": fp_after,
        "identical": fp_before == fp_after,
        "input_changes": input_changes,
        "order_changes": order_changes,
        "attribution": attribution,
    }
