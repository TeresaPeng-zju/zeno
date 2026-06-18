"""Time-budget pacing (expression layer, NOT decision).

This module deliberately lives *outside* the decision engine. It never touches
gap computation or next-step ranking — those stay reproducible and the offline
eval baseline (run at the default budget) does not fork. A time budget only
controls two expression-layer things:

    1. how many of the already-ranked next-steps to surface (depth), and
    2. the suggested pacing (weeks per step, parallelism, a human sentence).

Everything here is a pure function of (steps, weekly_hours), so the result-page
"second calibration" is instant, LLM-free and deterministic.
"""

from dataclasses import dataclass, field
from math import ceil

# Rough effort estimate: hours needed to raise one level on one skill.
HOURS_PER_LEVEL = 12

# time_budget -> (weekly_hours, max_steps_to_surface)
# NOTE: "standard" maps to 3 steps == the current hard-coded default, so an
# omitted/standard budget reproduces today's output exactly.
TIME_BUDGETS: dict[str, tuple[int, int]] = {
    "light": (3, 2),     # 每周 3h：聚焦，少而专
    "standard": (6, 3),  # 每周 6h：默认
    "intense": (10, 4),  # 每周 10h+：可并行推进更多
}
DEFAULT_TIME_BUDGET = "standard"

# With more weekly hours you can advance two tracks at once.
PARALLELISM_BY_BUDGET: dict[str, int] = {"light": 1, "standard": 1, "intense": 2}


@dataclass(frozen=True)
class StepPace:
    skill_id: str
    est_weeks: int


@dataclass(frozen=True)
class PacingPlan:
    time_budget: str
    weekly_hours: int
    max_steps: int
    parallelism: int
    total_weeks: int
    summary: str
    steps: list[StepPace] = field(default_factory=list)


def resolve(time_budget: str | None) -> tuple[str, int, int]:
    """Normalise a (possibly None/unknown) budget to (key, weekly_hours, max_steps)."""
    key = time_budget if time_budget in TIME_BUDGETS else DEFAULT_TIME_BUDGET
    weekly_hours, max_steps = TIME_BUDGETS[key]
    return key, weekly_hours, max_steps


def _est_weeks(gap: int, weekly_hours: int) -> int:
    hours = max(1, gap) * HOURS_PER_LEVEL
    return max(1, ceil(hours / weekly_hours))


def build_plan(steps, time_budget: str | None) -> PacingPlan:
    """Compute a pacing plan for a list of NextStep-like objects.

    Each step must expose `.skill_id`, `.current_level`, `.target_level`.
    """
    key, weekly_hours, max_steps = resolve(time_budget)
    parallelism = PARALLELISM_BY_BUDGET[key]

    paces: list[StepPace] = []
    week_costs: list[int] = []
    for ns in steps:
        gap = max(0, ns.target_level - ns.current_level)
        weeks = _est_weeks(gap, weekly_hours)
        paces.append(StepPace(skill_id=ns.skill_id, est_weeks=weeks))
        week_costs.append(weeks)

    # Serial sum, then compressed by how many tracks run in parallel.
    serial = sum(week_costs)
    total_weeks = max(week_costs, default=0) if parallelism > 1 else serial
    if parallelism > 1 and week_costs:
        # Greedy: distribute step durations across `parallelism` lanes.
        total_weeks = _balanced_makespan(week_costs, parallelism)

    if not week_costs:
        summary = "暂无需要排期的动作。"
    elif parallelism > 1:
        summary = (
            f"每周投入约 {weekly_hours} 小时，可并行推进 {parallelism} 条线，"
            f"预计约 {total_weeks} 周完成这 {len(week_costs)} 个动作。"
        )
    else:
        summary = (
            f"每周投入约 {weekly_hours} 小时，建议串行推进，"
            f"预计约 {total_weeks} 周依次完成这 {len(week_costs)} 个动作。"
        )

    return PacingPlan(
        time_budget=key,
        weekly_hours=weekly_hours,
        max_steps=max_steps,
        parallelism=parallelism,
        total_weeks=total_weeks,
        summary=summary,
        steps=paces,
    )


def _balanced_makespan(costs: list[int], lanes: int) -> int:
    """Longest-processing-time greedy assignment; returns the makespan (weeks)."""
    loads = [0] * lanes
    for c in sorted(costs, reverse=True):
        i = min(range(lanes), key=lambda k: loads[k])
        loads[i] += c
    return max(loads) if loads else 0
