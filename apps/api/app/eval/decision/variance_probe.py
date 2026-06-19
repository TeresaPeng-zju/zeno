"""Reproducibility + true-violation probe — does DeepSeek's 0% survive scrutiny?

The comparison panel (run_compare) showed DeepSeek can match or beat Zeno on a
SINGLE deterministic-temperature run. But a real "model + agent" product does not
run at temperature 0, and even at 0 an LLM API is not contractually reproducible
(model updates, fp nondeterminism). So the decisive question for Zeno's moat is
NOT "can the LLM be correct once" but "is it the SAME answer every time".

This probe runs DeepSeek K times over every profile at TWO temperatures — a
realistic agent setting (1.0) AND the model's most-deterministic setting (0.0) —
and reports the spread of (dependency violation rate, prerequisite coverage, raw
sequence). The temp=0 pass is the falsifier: if it collapses the distinct-sequence
count to 1/N, "irreproducible" is weak; if it stays >1, the claim is hard. Zeno is
shown once per profile because it is, by construction, identical across runs.

The dependency graph is also deliberately HARD (cross-category edges, diamond
convergence, a longer critical path) so a planner can't buy a cheap 0% by ordering
only disjoint linear chains.

WHY WE ALSO PRINT THE DENOMINATOR (已排 / universe / applicable / returned):
  dependency_violation_rate = violations / applicable, and an edge is only
  ``applicable`` when BOTH of its endpoints appear in the sequence. So a planner
  that silently DROPS skills shrinks the denominator and buys a cheap 0%. A 0%
  violation rate is only trustworthy next to "how many of the universe's skills
  did you actually order, and over how many applicable edges". We surface all of
  it so a 0% can't hide behind a small denominator.

This probe is for calibrating the NARRATIVE and eval honesty — it is NOT the
switch for "should the decision layer become an agent". That choice is settled by
reproducibility (different-sequence count) + construction guarantee, regardless of
whatever violation rate DeepSeek lands on here.

Run:
    cd apps/api && python -m app.eval.decision.variance_probe
"""

from __future__ import annotations

import statistics

from app.domain import competency
from app.eval.decision import scorer
from app.eval.decision.profiles import PROFILES
from app.eval.decision.providers import (
    DeepSeekPlanProvider,
    Profile,
    ZenoPlanProvider,
    gap_universe,
)

RUNS = 6
# Two temperatures on purpose. temp=1.0 is a realistic agent setting; temp=0.0 is
# the LLM's best shot at determinism. The decisive comparison is the
# different-sequence count at each: if temp=0 collapses it to 1/N, the
# "irreproducible" claim weakens; if it stays >1 even at 0, the claim is hard
# (and matches the theory — an LLM API is not contractually deterministic even at
# temp=0: model updates + MoE routing + fp/batching jitter).
TEMPERATURES = (1.0, 0.0)
ALREADY_HAVE_LEVEL = 2
# Top-K prefix consistency. The user acts on the FIRST few steps; whether the
# tail shuffles barely registers. So the distinct-prefix count over the first K
# steps is the trust signal that actually maps to product harm — sharper than
# the distinct-full-sequence count. It can also cut against us: if the prefix is
# stable at temp=1.0 (only the tail moves), we must stop selling "refresh changes
# your plan" and lean on auditability/compliance instead.
PREFIX_KS = (3, 5)


def _distinct_prefixes(seqs: set[tuple[str, ...]], k: int) -> int:
    """How many distinct first-K-step prefixes appear across the (deduped) runs."""
    return len({s[:k] for s in seqs})


def _already_have(profile: Profile) -> set[str]:
    return {sid for sid, o in profile.obs.items() if o.level >= ALREADY_HAVE_LEVEL}


def _detail(seq: list[str], have: set[str]) -> tuple[float, int, int, float]:
    """(violation_rate, violations, applicable_edges, prerequisite_coverage)."""
    viol_rate, viol, applicable = scorer.dependency_violation_rate(seq)
    cov, _, _ = scorer.prerequisite_coverage(seq, have)
    return viol_rate, viol, applicable, cov


def _run_deepseek(
    profile: Profile, role_id: str, orientation: str, temperature: float, have: set[str], u: int
) -> dict | None:
    """Run DeepSeek RUNS times at one temperature.

    Returns {"full": distinct-full-sequence count, "prefix": {K: distinct-prefix count}}.
    """
    ds = DeepSeekPlanProvider(temperature=temperature)
    print(f"\n  deepseek（temp={temperature}，{RUNS} 次）")
    viols: list[float] = []
    covs: list[float] = []
    lens: list[int] = []
    apps: list[int] = []
    uniq: set[tuple[str, ...]] = set()
    for i in range(RUNS):
        r = ds.plan(profile, role_id, orientation)
        if not r.available:
            print(f"    不可用：{r.note}")
            return None
        vr, _vi, app, cov = _detail(r.sequence, have)
        returned = r.raw.get("returned", len(r.sequence))
        viols.append(vr)
        covs.append(cov)
        lens.append(len(r.sequence))
        apps.append(app)
        uniq.add(tuple(r.sequence))
        print(
            f"    run {i + 1}: 已排 {len(r.sequence):>2}/{u}  返回 {returned:>2}  "
            f"applicable边 {app:>2}  违反率 {vr:>4.0%}  覆盖率 {cov:>4.0%}"
        )

    print(
        f"\n    违反率     : min {min(viols):.0%} / max {max(viols):.0%} / "
        f"均值 {statistics.mean(viols):.0%} / 方差 {statistics.pvariance(viols):.4f}"
    )
    print(
        f"    已排技能数 : min {min(lens)} / max {max(lens)} / 均值 {statistics.mean(lens):.1f}"
        f"   （越接近 {u} 越说明 0% 不是靠漏排买来的）"
    )
    print(
        f"    applicable边: min {min(apps)} / max {max(apps)}"
        "   （分母越小，0% 越廉价）"
    )
    print(
        f"    覆盖率     : min {min(covs):.0%} / max {max(covs):.0%} / "
        f"均值 {statistics.mean(covs):.0%}"
    )
    print(f"    不同序列数 = {len(uniq)} / {RUNS}   （Zeno 恒为 1 / N）")
    prefix = {k: _distinct_prefixes(uniq, k) for k in PREFIX_KS}
    for k in PREFIX_KS:
        print(
            f"    前{k}步不同前缀 = {prefix[k]} / {RUNS}"
            "   （用户最先照做的就是这几步；Zeno 恒为 1 / N）"
        )
    return {"full": len(uniq), "prefix": prefix}


def _run_profile(profile: Profile, role_id: str, orientation: str) -> None:
    have = _already_have(profile)
    universe = gap_universe(profile, role_id, orientation)
    u = len(universe)
    print(f"\n══ profile: {profile.name} ══")
    print(f"  universe（待排正 gap 技能数）= {u}")

    # Zeno — deterministic, shown once. With TOP_N_CANDIDATES removed it now
    # orders the FULL positive-gap universe (已排 == universe), at the same
    # applicable denominator as DeepSeek — but at 1/N by construction.
    z = ZenoPlanProvider().plan(profile, role_id, orientation)
    zr, zviol, zapp, zc = _detail(z.sequence, have)
    print("\n  Zeno（确定性，N 次完全一致）")
    print(
        f"    已排 {len(z.sequence):>2}/{u}   applicable边 {zapp:>2}   "
        f"违反率 {zr:>4.0%}（{zviol} 处）   覆盖率 {zc:>4.0%}"
    )

    # DeepSeek at each temperature. Print the denominator EVERY run so a
    # small-denominator 0% can't pass as a clean 0%.
    stats_by_temp: dict[float, dict] = {}
    for temp in TEMPERATURES:
        s = _run_deepseek(profile, role_id, orientation, temp, have, u)
        if s is not None:
            stats_by_temp[temp] = s

    # The decisive line: does lowering temperature to 0 actually buy reproducibility?
    if len(stats_by_temp) == len(TEMPERATURES):
        parts = " vs ".join(
            f"temp={t} → {stats_by_temp[t]['full']}/{RUNS}" for t in TEMPERATURES
        )
        collapsed = stats_by_temp.get(0.0, {}).get("full") == 1
        verdict = (
            "temp=0 收敛到 1/N → 经验可复现（但仍非构造保证：跨版本/MoE 抖动不在此 N 次内）"
            if collapsed
            else "temp=0 仍 >1/N → 连『最确定』设置都给不出同一答案，不可复现是硬的"
        )
        print(f"\n  ⮕ 可复现性对照（整序列）：{parts}   {verdict}")

        # Prefix is what the user acts on first — the sharpest trust signal, and
        # it can cut either way. Judge on the realistic setting (temp=1.0).
        real = stats_by_temp.get(1.0)
        if real:
            k0 = PREFIX_KS[0]
            pk = real["prefix"][k0]
            pparts = " / ".join(
                f"前{k}步 {real['prefix'][k]}/{RUNS}" for k in PREFIX_KS
            )
            pverdict = (
                f"前{k0}步恒定 → 抖动只在尾部，别再拿『刷新换计划』当卖点，改打可审计/合规"
                if pk == 1
                else f"前{k0}步就有 {pk} 种 → 用户最先照做的步骤都会变，信任伤害是真的"
            )
            print(f"  ⮕ 前缀稳定性（temp=1.0）：{pparts}   {pverdict}")


def run(role_id: str | None = None, orientation: str = competency.ORIENTATION_BASE) -> None:
    role_id = role_id or competency.ROLE_AI_ENGINEER_APPLIED
    temps = " / ".join(str(t) for t in TEMPERATURES)
    print(f"\n可复现性 + 真实违反率探针   runs={RUNS}   deepseek temp={temps}")
    print(
        "关键读法：违反率 = 违反数 / applicable边，applicable 只数『两端都排了』的依赖边。"
        "\n漏排技能会让分母变小、0% 变便宜——所以必须连『已排/universe/applicable』一起看。"
        "\n本轮依赖图已加难（跨类边+钻石汇聚+更长关键路径），逼对手不能只排简单线性段。"
    )
    for profile in PROFILES:
        _run_profile(profile, role_id, orientation)

    print(
        "\n结论读法：DeepSeek 单次合法 ≠ 它稳，也 ≠ 它排全了。看五件事："
        "\n  ① 不同序列数（>1 即不可复现）；"
        "\n  ② 已排/universe（远小于 universe = 0% 靠漏排注水）；"
        "\n  ③ 跨 profile、在加难图上是否仍 0%；"
        "\n  ④ temp=0 对照：降到最确定设置后不同序列数是否塌回 1/N；"
        "\n  ⑤ 前 K 步前缀（用户最先照做的）是否稳——这是最贴产品的信任信号，"
        "若 temp=1.0 前缀就已恒定，说明抖动只在尾部，叙事应改打可审计/合规而非『刷新换计划』。"
        "\n注意：本探针只校准叙事与 eval 诚实度，不作为『决策层是否换 agent』的开关"
        "——那个已由可复现性 + 构造保证锁定。即便 temp=0 收敛，那也只是这 N 次的经验确定，"
        "不等于跨模型版本的 bit 级构造保证。"
    )


if __name__ == "__main__":
    run()
