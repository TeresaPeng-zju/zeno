"""Decision-surface scorers — the hard, deterministic constraints (anygen's C).

These are pure functions over a *learning sequence* (an ordered list of skill
ids that some planner recommends). They do NOT know or care who produced the
sequence — Zeno, a naive baseline, or DeepSeek all get scored by the exact same
ruler. That neutrality is the whole point: a metric that only Zeno can pass is
not a metric, it's a mirror.

Two constraints, both auditable and reproducible:

  * dependency_violation_rate — of the prerequisite edges whose BOTH ends the
    planner chose to teach, how often did it put the dependent before its
    prerequisite (B before A for edge A->B)? Lower is better; 0 = no inversions.

  * prerequisite_coverage — for every skill the planner tells you to learn, are
    its prerequisites either already mastered or scheduled earlier? Higher is
    better; 1.0 = never asked to run before you can walk.

NOTE on interpreting Zeno's score: Zeno builds the sequence *from* these same
dependency edges, so on its own it will score 0 violations / full coverage by
construction. That number is meaningless in isolation — it only becomes evidence
next to an opponent that did NOT get the edges for free.
"""

from __future__ import annotations

from app.domain import competency


def _dependency_pairs() -> list[tuple[str, str]]:
    """List of (prereq, dependent) = (A, B) for every edge A->B (B depends_on A)."""
    return [(d.depends_on, d.skill_id) for d in competency.SKILL_DEPENDENCIES]


def dependency_violation_rate(sequence: list[str]) -> tuple[float, int, int]:
    """Fraction of in-plan dependency edges whose order is inverted.

    Returns (rate, violations, applicable_edges). An edge is *applicable* only
    when both endpoints appear in the sequence (you can't invert an order for a
    skill you didn't schedule). rate = violations / applicable; 0.0 if none apply.
    """
    pos = {sid: i for i, sid in enumerate(sequence)}
    violations = 0
    applicable = 0
    for prereq, dependent in _dependency_pairs():
        if prereq in pos and dependent in pos:
            applicable += 1
            if pos[dependent] < pos[prereq]:  # learn B before its prerequisite A
                violations += 1
    rate = violations / applicable if applicable else 0.0
    return round(rate, 4), violations, applicable


def prerequisite_coverage(
    sequence: list[str], already_have: set[str]
) -> tuple[float, int, int]:
    """Fraction of prerequisite relations that are satisfied for the plan.

    For each scheduled skill B and each prereq A of B, A is *satisfied* when it
    is already mastered (in `already_have`) or scheduled strictly before B.
    Returns (coverage, satisfied, total_relations); 1.0 if the plan needs no
    prerequisites.
    """
    pos = {sid: i for i, sid in enumerate(sequence)}
    satisfied = 0
    total = 0
    for dependent in sequence:
        for prereq in competency.dependencies_of(dependent):
            total += 1
            earlier = prereq in pos and pos[prereq] < pos[dependent]
            if prereq in already_have or earlier:
                satisfied += 1
    coverage = satisfied / total if total else 1.0
    return round(coverage, 4), satisfied, total
