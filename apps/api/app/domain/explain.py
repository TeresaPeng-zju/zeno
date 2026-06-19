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


def _name(skill_id: str) -> str:
    s = competency.SKILLS_BY_ID.get(skill_id)
    return s.name if s else skill_id


def _explain_one(step: NextStep) -> dict:
    """The full provenance record for a single ranked step."""
    comp = step.score_components
    jd = _jd_evidence_for(step.skill_id)

    # The dependency constraint that pinned its position (the topological reason).
    if step.blocked_by:
        dep_reason = (
            f"它的前置「{'、'.join(_name(d) for d in step.blocked_by)}」尚未补齐，"
            f"因此被排在这些前置之后（拓扑约束，非打分）。"
        )
    else:
        dep_reason = "无未补齐前置，位置完全由打分决定。"

    # Plain-language attribution of the score, term by term.
    score_breakdown = [
        f"缺口项 0.5×{comp.get('gap_score_norm', 0)} = {comp.get('gap_term', 0)}",
        f"依赖紧迫 0.3×{comp.get('dependency_urgency', 0)} = {comp.get('dependency_term', 0)}",
        f"可学性 0.2×{comp.get('learnability', 0)} = {comp.get('learnability_term', 0)}",
    ]
    if comp.get("blocked_penalty", 1.0) != 1.0:
        score_breakdown.append(
            f"被前置阻塞，整体×{comp.get('blocked_penalty')}（降权让前置先出）"
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
            "blocked_by": [{"skill_id": d, "name": _name(d)} for d in step.blocked_by],
            "unblocks": [{"skill_id": d, "name": _name(d)} for d in step.unblocks],
            "reason": dep_reason,
        },
        "why": step.why,
    }


def explain_plan(
    role_id: str,
    obs: dict[str, SkillObservation],
    orientation_id: str = competency.ORIENTATION_BASE,
    max_steps: int = decision.MAX_NEXT_STEPS,
) -> dict:
    """Full auditable evidence chain for a plan: fingerprint + per-step provenance."""
    steps = decision.select_next_steps(role_id, obs, max_steps, orientation_id)
    return {
        "fingerprint": plan_fingerprint(role_id, obs, orientation_id),
        "graph_version": _graph_digest(),
        "role_id": role_id,
        "orientation": orientation_id,
        "n_jds": _evidence().get("n_jds", 0),
        "steps": [_explain_one(s) for s in steps],
    }


def diff_plans(
    role_id: str,
    obs_before: dict[str, SkillObservation],
    obs_after: dict[str, SkillObservation],
    orientation_id: str = competency.ORIENTATION_BASE,
    max_steps: int = decision.MAX_NEXT_STEPS,
) -> dict:
    """Causally-attributed diff between two plans.

    The whole point: the ordering changes *only* because an input changed. This
    surfaces (a) which observations moved, and (b) how the ranking shifted — so
    "why is this different from last time" has a concrete, data-level answer,
    not "the model felt differently".
    """
    fp_before = plan_fingerprint(role_id, obs_before, orientation_id)
    fp_after = plan_fingerprint(role_id, obs_after, orientation_id)

    # (a) Which inputs changed.
    input_changes: list[dict] = []
    for sid in sorted(set(obs_before) | set(obs_after)):
        b = obs_before.get(sid)
        a = obs_after.get(sid)
        b_lvl = b.level if b else None
        a_lvl = a.level if a else None
        if b_lvl != a_lvl:
            input_changes.append(
                {"skill_id": sid, "skill_name": _name(sid), "from": b_lvl, "to": a_lvl}
            )

    # (b) How the ordering shifted.
    before = decision.select_next_steps(role_id, obs_before, max_steps, orientation_id)
    after = decision.select_next_steps(role_id, obs_after, max_steps, orientation_id)
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
                {"skill_id": sid, "skill_name": _name(sid), "rank_before": rb, "rank_after": ra, "change": kind}
            )

    if fp_before == fp_after:
        attribution = "输入指纹一致 → 计划逐位相同（确定性保证：同输入必然同输出）。"
    elif not order_changes:
        attribution = "输入变了，但展示层 top-N 顺序未变（变化发生在更深处）。"
    else:
        drivers = "、".join(f"{c['skill_name']} L{c['from']}→L{c['to']}" for c in input_changes) or "（无可见输入变化）"
        attribution = f"顺序变化完全由输入变化驱动：{drivers}。无输入变化则计划不会变。"

    return {
        "fingerprint_before": fp_before,
        "fingerprint_after": fp_after,
        "identical": fp_before == fp_after,
        "input_changes": input_changes,
        "order_changes": order_changes,
        "attribution": attribution,
    }
