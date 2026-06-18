"""Session service: glue between persistence, orchestrator and LLM."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain import competency, decision, pacing
from app.domain.decision import SkillObservation
from app.domain.orchestrator import SkillState, is_complete, select_next_skill
from app.domain.question_bank import (
    ANSWER_OPTIONS,
    OPTIONS_BY_VALUE,
    default_help_text,
    default_question_text,
)
from app.llm.factory import get_llm_provider
from app.models import SurveySession, UserSkill
from app.schemas import (
    GapOut,
    NextQuestionResponse,
    NextStepOut,
    OptionOut,
    PacingOut,
    Progress,
    QuestionOut,
    ResultResponse,
    SkillProfileOut,
    StrengthOut,
)


def create_session(db: Session, role_id: str = competency.ROLE_AI_ENGINEER_APPLIED) -> SurveySession:
    sess = SurveySession(role_id=role_id, status="in_progress")
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


def get_session(db: Session, session_id: str) -> SurveySession | None:
    return db.get(SurveySession, session_id)


def _states(sess: SurveySession) -> dict[str, SkillState]:
    return {
        us.skill_id: SkillState(level=us.level, confidence=us.confidence)
        for us in sess.user_skills
    }


def _build_question(skill_id: str, answered: int) -> QuestionOut:
    skill = competency.SKILLS_BY_ID[skill_id]
    text, help_text = get_llm_provider().rephrase_question(
        skill_name=skill.name,
        skill_category=skill.category,
        default_text=default_question_text(skill_id),
        default_help=default_help_text(skill_id),
    )
    return QuestionOut(
        question_id=skill_id,
        skill_id=skill_id,
        category=skill.category,
        text=text,
        help_text=help_text,
        options=[OptionOut(value=o.value, label=o.label) for o in ANSWER_OPTIONS],
        progress=Progress(answered=answered, max=_max_questions()),
    )


def _max_questions() -> int:
    from app.core.config import settings

    return settings.max_questions


def next_question(db: Session, sess: SurveySession) -> NextQuestionResponse:
    states = _states(sess)
    if is_complete(sess.role_id, states):
        if sess.status != "completed":
            sess.status = "completed"
            db.commit()
        return NextQuestionResponse(result_ready=True)

    skill_id = select_next_skill(sess.role_id, states)
    if skill_id is None:
        sess.status = "completed"
        db.commit()
        return NextQuestionResponse(result_ready=True)

    return NextQuestionResponse(
        result_ready=False,
        question=_build_question(skill_id, answered=len(states)),
    )


def record_answer(db: Session, sess: SurveySession, skill_id: str, answer_value: str) -> None:
    if skill_id not in competency.SKILLS_BY_ID:
        raise ValueError(f"unknown skill_id: {skill_id}")
    option = OPTIONS_BY_VALUE.get(answer_value)
    if option is None:
        raise ValueError(f"invalid answer_value: {answer_value}")

    existing = db.scalar(
        select(UserSkill).where(
            UserSkill.session_id == sess.id, UserSkill.skill_id == skill_id
        )
    )
    if existing is None:
        db.add(
            UserSkill(
                session_id=sess.id,
                skill_id=skill_id,
                level=option.level,
                evidence_type=option.evidence_type,
                confidence=option.confidence,
            )
        )
    else:
        existing.level = option.level
        existing.evidence_type = option.evidence_type
        existing.confidence = option.confidence
    db.commit()
    db.refresh(sess)


def _resources_for_step(db: Session, skill_id: str, target_level: int) -> list:
    """Best-effort RAG resource prescription. Never break the result page if the
    resource library is empty or the DB lacks the table yet."""
    try:
        from app.services import resource_service

        skill = competency.SKILLS_BY_ID.get(skill_id)
        query = f"{skill.name if skill else skill_id} 学习 实践 L{target_level}"
        return resource_service.recommend_out(
            db, skill_id=skill_id, gap_target_level=target_level, query_text=query
        )
    except Exception:
        return []


def build_result(
    db: Session, sess: SurveySession, time_budget: str | None = None
) -> ResultResponse:
    profile = [
        SkillProfileOut(
            skill_id=us.skill_id,
            skill_name=competency.SKILLS_BY_ID[us.skill_id].name,
            category=competency.SKILLS_BY_ID[us.skill_id].category,
            level=us.level,
            confidence=us.confidence,
        )
        for us in sess.user_skills
        if us.skill_id in competency.SKILLS_BY_ID
    ]
    profile.sort(key=lambda p: (p.category, p.skill_id))

    # Decision engine (deterministic) — plan section 6.
    obs = {
        us.skill_id: SkillObservation(level=us.level, confidence=us.confidence)
        for us in sess.user_skills
        if us.skill_id in competency.SKILLS_BY_ID
    }

    strengths = [
        StrengthOut(
            skill_id=s.skill_id,
            skill_name=s.skill_name,
            category=s.category,
            level=s.level,
            reason=s.reason,
        )
        for s in decision.compute_strengths(obs)
    ]

    gaps = [
        GapOut(
            skill_id=g.req.skill_id,
            skill_name=competency.SKILLS_BY_ID[g.req.skill_id].name,
            category=competency.SKILLS_BY_ID[g.req.skill_id].category,
            current_level=g.level,
            target_level=g.req.min_level,
            gap=g.gap,
            type=g.req.type,
            weight=g.req.weight,
            gap_score=round(g.gap_score, 4),
        )
        for g in decision.compute_gaps(sess.role_id, obs)
        if g.gap > 0
    ]
    gaps.sort(key=lambda x: x.gap_score, reverse=True)

    # Time budget is an *expression-layer* lever: it only sets how many of the
    # already-ranked steps to show + the pacing. The ranking itself is unchanged.
    budget_key, _weekly_hours, max_steps = pacing.resolve(time_budget)
    steps = decision.select_next_steps(sess.role_id, obs, max_steps=max_steps)
    plan = pacing.build_plan(steps, budget_key)
    weeks_by_skill = {p.skill_id: p.est_weeks for p in plan.steps}

    next_steps = [
        NextStepOut(
            rank=ns.rank,
            skill_id=ns.skill_id,
            skill_name=ns.skill_name,
            category=ns.category,
            current_level=ns.current_level,
            target_level=ns.target_level,
            action_title=ns.action_title,
            why=ns.why,
            action_steps=ns.action_steps,
            acceptance_criteria=ns.acceptance_criteria,
            next_score=ns.next_score,
            est_weeks=weeks_by_skill.get(ns.skill_id, 0),
            unblocks=ns.unblocks,
            blocked_by=ns.blocked_by,
            recommended_resources=_resources_for_step(db, ns.skill_id, ns.target_level),
        )
        for ns in steps
    ]

    return ResultResponse(
        session_id=sess.id,
        role_id=sess.role_id,
        status=sess.status,
        readiness=decision.compute_readiness(sess.role_id, obs),
        time_budget=plan.time_budget,
        pacing=PacingOut(
            time_budget=plan.time_budget,
            weekly_hours=plan.weekly_hours,
            parallelism=plan.parallelism,
            total_weeks=plan.total_weeks,
            summary=plan.summary,
        ),
        profile=profile,
        strengths=strengths,
        gaps=gaps,
        next_steps=next_steps,
        note="资源处方由 RAG 资源引擎（pgvector 召回 + 多信号重排 + 保鲜校验）生成。",
    )
