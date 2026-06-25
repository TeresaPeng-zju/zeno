"""Decision-surface comparison panel — the deliverable.

Runs every PlanProvider (Zeno, naive baseline, DeepSeek) over the same profiles
and the same gap universe, then scores each on the SAME neutral rulers:

  Hard constraints (decision surface, anygen's C):
    - dependency violation rate   (lower better; Zeno = 0 by construction)
    - prerequisite coverage       (higher better)
  Market alignment (JD-grounded, anygen's A + B):
    - gap precision / recall      (vs JD-derived weak labels)
    - nDCG@10                     (gain = JD demand frequency)

The headline is NOT "Zeno scores 0 violations" — that's tautological. It's the
GAP between Zeno and the opponents on the same case. If DeepSeek (fed the same
graph) matches Zeno on the hard constraints, that's the yellow signal worth
talking about; if it doesn't, that's Zeno's moat in one row.

Run:
    cd apps/api && python -m app.eval.decision.run_compare
"""

from __future__ import annotations

from app.domain import competency
from app.eval.decision import jd_grounding, scorer
from app.eval.decision.profiles import PROFILES
from app.eval.decision.providers import (
    DeepSeekPlanProvider,
    NaivePlanProvider,
    PlanProvider,
    Profile,
    ZenoPlanProvider,
)

# A skill counts as an already-held prerequisite once the user can build a small
# feature with it (L>=2). Tunable knob, kept explicit for auditability.
ALREADY_HAVE_LEVEL = 2
NDCG_K = 10


def _already_have(profile: Profile) -> set[str]:
    return {sid for sid, o in profile.obs.items() if o.level >= ALREADY_HAVE_LEVEL}


def _score_one(profile: Profile, provider: PlanProvider, role_id: str, orientation: str) -> dict:
    result = provider.plan(profile, role_id, orientation)
    if not result.available:
        return {"available": False, "note": result.note}

    seq = result.sequence
    viol_rate, viol, applicable = scorer.dependency_violation_rate(seq)
    cov, sat, total = scorer.prerequisite_coverage(seq, _already_have(profile))
    precision, recall = jd_grounding.gap_precision_recall(seq)
    ndcg = jd_grounding.ndcg_at_k(seq, NDCG_K)
    return {
        "available": True,
        "n": len(seq),
        "viol_rate": viol_rate,
        "viol": viol,
        "applicable": applicable,
        "coverage": cov,
        "precision": precision,
        "recall": recall,
        "ndcg": ndcg,
        "sequence": seq,
    }


def _avg(values: list[float]) -> float:
    return round(sum(values) / len(values), 4) if values else 0.0


def run(role_id: str | None = None, orientation: str = competency.ORIENTATION_BASE) -> dict:
    role_id = role_id or competency.ROLE_AI_ENGINEER_APPLIED
    providers: list[PlanProvider] = [
        ZenoPlanProvider(),
        NaivePlanProvider(),
        DeepSeekPlanProvider(),
    ]

    report: dict[str, dict] = {}
    for provider in providers:
        per_profile = [
            _score_one(p, provider, role_id, orientation) for p in PROFILES
        ]
        ok = [r for r in per_profile if r["available"]]
        if not ok:
            report[provider.name] = {
                "available": False,
                "note": per_profile[0].get("note", "unavailable"),
            }
            continue
        report[provider.name] = {
            "available": True,
            "viol_rate": _avg([r["viol_rate"] for r in ok]),
            "coverage": _avg([r["coverage"] for r in ok]),
            "precision": _avg([r["precision"] for r in ok]),
            "recall": _avg([r["recall"] for r in ok]),
            "ndcg": _avg([r["ndcg"] for r in ok]),
            "per_profile": per_profile,
        }
    return {"role": role_id, "orientation": orientation, "providers": report}


def _print(report: dict) -> None:
    print(f"\nZeno 决策面对照面板  [role={report['role']}  orientation={report['orientation']}]")
    print(f"用例数 = {len(PROFILES)} 个合成画像  |  nDCG@{NDCG_K}  |  gain = JD 需求频次\n")

    header = f"{'provider':<16} {'依赖违反率':>10} {'前置覆盖率':>10} {'gap精确率':>10} {'gap召回率':>10} {'nDCG':>8}"
    print(header)
    print("-" * len(header))
    for name, r in report["providers"].items():
        if not r["available"]:
            print(f"{name:<16}  (不可用：{r['note']})")
            continue
        print(
            f"{name:<16} {r['viol_rate']:>10.0%} {r['coverage']:>10.0%} "
            f"{r['precision']:>10.0%} {r['recall']:>10.0%} {r['ndcg']:>8.3f}"
        )

    print(
        "\n读法：依赖违反率越低越好、其余越高越好。Zeno 的 0 违反是构造决定的，"
        "\n它的意义只在与 naive / deepseek 的差距里——单看满分不算数。"
    )


def main() -> None:
    _print(run())


if __name__ == "__main__":
    main()
