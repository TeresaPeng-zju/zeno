"""Session service: glue between persistence, orchestrator and LLM."""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain import competency, decision, pacing
from app.domain.decision import SkillObservation
from app.domain.orchestrator import SkillState, is_complete, select_next_skill, weighted_uncertainty
from app.domain.question_bank import (
    ANSWER_OPTIONS,
    OPTIONS_BY_VALUE,
    default_help_text,
    default_question_text,
    option_example,
    option_label,
)
from app.i18n import t
from app.llm.factory import get_llm_provider
from app.models import SkillCorrectionEvidence, SurveySession, UserSkill
from app.core.config import settings

import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def _path_config() -> dict:
    p = Path(settings.path_config_path)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent.parent / settings.path_config_path.removeprefix("app/")
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _transfer_defaults(current_role: str | None, role_id: str) -> dict[str, int]:
    """当前角色的可迁移地基技能 → 默认水平（来自 path_config 的 transfer 列表）。
    用于把『前端显然会的 TS/API/流式』等地基技能自动算作已具备，避免问卷没覆盖就被当成 0 级缺口。"""
    if not current_role:
        return {}
    paths = _path_config().get("paths", {})
    short = role_id.replace("_applied", "").replace("_general", "")
    for key in (f"{current_role} → {role_id}", f"{current_role} → {short}"):
        p = paths.get(key)
        if p:
            return {it["skill_id"]: int(it.get("default_level", 2))
                    for it in p.get("transfer", []) if it.get("skill_id")}
    return {}
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


def create_session(
    db: Session,
    role_id: str = competency.ROLE_AI_ENGINEER_APPLIED,
    orientation: str | None = None,
    current_role: str | None = None,
) -> SurveySession:
    orient = competency.get_orientation(orientation).id
    sess = SurveySession(
        role_id=role_id,
        orientation=orient,
        current_role=current_role,
        status="in_progress",
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


def get_session(db: Session, session_id: str) -> SurveySession | None:
    return db.get(SurveySession, session_id)


def _orientation(sess: SurveySession) -> str:
    """NULL-safe orientation (old rows / create_all-only schemas → base)."""
    return getattr(sess, "orientation", None) or competency.ORIENTATION_BASE


def _states(sess: SurveySession) -> dict[str, SkillState]:
    return {
        us.skill_id: SkillState(level=us.level, confidence=us.confidence)
        for us in sess.user_skills
    }


def _build_question(skill_id: str, answered: int, lang: str = "en") -> QuestionOut:
    skill = competency.SKILLS_BY_ID[skill_id]
    text, help_text = get_llm_provider().rephrase_question(
        skill_name=competency.skill_name(skill_id, lang),
        skill_category=skill.category,
        default_text=default_question_text(skill_id, lang),
        default_help=default_help_text(skill_id, lang),
    )
    return QuestionOut(
        question_id=skill_id,
        skill_id=skill_id,
        category=skill.category,
        text=text,
        help_text=help_text,
        options=[
            OptionOut(
                value=o.value,
                label=option_label(o.value, lang),
                example=option_example(skill_id, o.value, lang),
            )
            for o in ANSWER_OPTIONS
        ],
        progress=Progress(answered=answered, max=_max_questions()),
    )


def _max_questions() -> int:
    from app.core.config import settings

    return settings.max_questions


def next_question(
    db: Session,
    sess: SurveySession,
    lang: str = "en",
    force_continue: bool = False,
    required_only: bool = False,
) -> NextQuestionResponse:
    states = _states(sess)
    if required_only:
        # Keep the continuation count aligned with the result card: transferable
        # role foundations already counted as evidence must not be asked again.
        for sid, level in _transfer_defaults(sess.current_role, sess.role_id).items():
            states.setdefault(sid, SkillState(level=level, confidence=0.6))
    orient = _orientation(sess)
    if not force_continue and is_complete(sess.role_id, states, orient):
        if sess.status != "completed":
            sess.status = "completed"
            db.commit()
        return NextQuestionResponse(result_ready=True)

    skill_id = select_next_skill(
        sess.role_id, states, orient, required_only=required_only
    )
    if skill_id is None:
        sess.status = "completed"
        db.commit()
        return NextQuestionResponse(result_ready=True)

    return NextQuestionResponse(
        result_ready=False,
        question=_build_question(skill_id, answered=len(states), lang=lang),
    )


def record_answer(
    db: Session,
    sess: SurveySession,
    skill_id: str,
    answer_value: str,
    answer_source: str = "standard",
) -> None:
    if skill_id not in competency.SKILLS_BY_ID:
        raise ValueError(f"unknown skill_id: {skill_id}")
    option = OPTIONS_BY_VALUE.get(answer_value)
    if option is None:
        raise ValueError(f"invalid answer_value: {answer_value}")
    if answer_source not in {"standard", "user_correction"}:
        raise ValueError(f"invalid answer_source: {answer_source}")
    evidence_type = (
        f"user_correction_{option.evidence_type}"
        if answer_source == "user_correction"
        else option.evidence_type
    )

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
                evidence_type=evidence_type,
                confidence=option.confidence,
            )
        )
    else:
        existing.level = option.level
        existing.evidence_type = evidence_type
        existing.confidence = option.confidence
    db.commit()
    db.refresh(sess)


def analyze_correction(
    db: Session, sess: SurveySession, skill_id: str, text: str, lang: str
) -> SkillCorrectionEvidence:
    """Extract natural-language evidence, then apply the deterministic ceiling."""
    from app.domain import correction_evidence

    if skill_id not in competency.SKILLS_BY_ID:
        raise ValueError(f"unknown skill_id: {skill_id}")
    extracted, provider = correction_evidence.extract(
        text, skill_name=competency.skill_name(skill_id, lang), lang=lang
    )
    record = SkillCorrectionEvidence(
        session_id=sess.id,
        skill_id=skill_id,
        raw_text=text.strip(),
        extraction=extracted,
        llm_suggested_level=None,
        rule_level=correction_evidence.calibrate(extracted),
        rule_version=correction_evidence.RULE_VERSION,
        provider=provider,
        status="pending",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def confirm_correction(
    db: Session, sess: SurveySession, evidence_id: str, action: str
) -> tuple[str, int]:
    record = db.scalar(
        select(SkillCorrectionEvidence).where(
            SkillCorrectionEvidence.id == evidence_id,
            SkillCorrectionEvidence.session_id == sess.id,
        )
    )
    if record is None:
        raise ValueError("correction evidence not found")
    current = db.scalar(
        select(UserSkill).where(
            UserSkill.session_id == sess.id, UserSkill.skill_id == record.skill_id
        )
    )
    current_level = current.level if current else 0
    if action == "confirm":
        # The rule result—not the LLM suggestion—is the only value committed.
        answer_value = {1: "tutorial", 2: "demo", 3: "shipped", 4: "expert"}[record.rule_level]
        record_answer(db, sess, record.skill_id, answer_value, answer_source="user_correction")
        final_level = record.rule_level
        record.status = "confirmed"
        record.confirmed_level = final_level
    elif action == "keep":
        final_level = current_level
        record.status = "kept"
        record.confirmed_level = current_level
    else:
        raise ValueError("invalid correction action")
    record.confirmed_at = datetime.now(timezone.utc)
    db.commit()
    return record.status, final_level


def _resources_for_step(
    db: Session, skill_id: str, target_level: int, lang: str = "en"
) -> list:
    """Best-effort RAG resource prescription. Never break the result page if the
    resource library is empty or the DB lacks the table yet."""
    try:
        from app.services import resource_service

        query = t(
            lang,
            "query.template",
            name=competency.skill_name(skill_id, lang),
            level=target_level,
        )
        return resource_service.recommend_out(
            db, skill_id=skill_id, gap_target_level=target_level, query_text=query, lang=lang
        )
    except Exception:
        return []


def build_result(
    db: Session,
    sess: SurveySession,
    time_budget: str | None = None,
    lang: str = "en",
    orientation: str | None = None,
    include_resources: bool = True,
) -> ResultResponse:
    profile = [
        SkillProfileOut(
            skill_id=us.skill_id,
            skill_name=competency.skill_name(us.skill_id, lang),
            category=competency.SKILLS_BY_ID[us.skill_id].category,
            level=us.level,
            confidence=us.confidence,
        )
        for us in sess.user_skills
        if us.skill_id in competency.SKILLS_BY_ID
    ]
    profile.sort(key=lambda p: (p.category, p.skill_id))

    # Orientation: an optional override lets the result page re-score the *same*
    # profile against a specific target role's focus (e.g. a knowledge-base / RAG
    # job) without re-taking the survey. None → the session's stored orientation.
    orient = (
        competency.get_orientation(orientation).id
        if orientation is not None
        else _orientation(sess)
    )
    obs = {
        us.skill_id: SkillObservation(level=us.level, confidence=us.confidence)
        for us in sess.user_skills
        if us.skill_id in competency.SKILLS_BY_ID
    }
    # 地基修正：把当前角色的可迁移地基技能按默认水平种进画像（前端 → TS/API/流式 自动算已具备）。
    # 角色先验只补齐未知项。任何显式回答（包括 level 0）都是更强的证据，
    # 不能被“这个角色通常会什么”的默认值覆盖。
    for sid, lvl in _transfer_defaults(sess.current_role, sess.role_id).items():
        if sid in competency.SKILLS_BY_ID and sid not in obs:
            obs[sid] = SkillObservation(level=lvl, confidence=0.6)

    # Result confidence and result coverage must use the same evidence set.
    # Previously profile_uncertainty only saw persisted survey answers while
    # readiness also saw role-transfer foundations. That made the UI describe a
    # sound coverage calculation as having mysteriously weak evidence.
    required = [
        r for r in competency.requirements_for_role(sess.role_id, orient)
        if r.type == "required"
    ]
    evidence_states = {
        sid: SkillState(level=item.level, confidence=item.confidence)
        for sid, item in obs.items()
    }

    strengths = [
        StrengthOut(
            skill_id=s.skill_id,
            skill_name=s.skill_name,
            category=s.category,
            level=s.level,
            reason=s.reason,
            ai_usage=list(
                competency.SKILLS_BY_ID[s.skill_id].ai_usage_en
                if lang == "en"
                else competency.SKILLS_BY_ID[s.skill_id].ai_usage
            ) if s.skill_id in competency.SKILLS_BY_ID else [],
            non_ai_boundaries=list(
                competency.SKILLS_BY_ID[s.skill_id].non_ai_boundaries_en
                if lang == "en"
                else competency.SKILLS_BY_ID[s.skill_id].non_ai_boundaries
            ) if s.skill_id in competency.SKILLS_BY_ID else [],
        )
        for s in decision.compute_strengths(obs, lang)
    ]

    gaps = [
        GapOut(
            skill_id=g.req.skill_id,
            skill_name=competency.skill_name(g.req.skill_id, lang),
            category=competency.SKILLS_BY_ID[g.req.skill_id].category,
            current_level=g.level,
            target_level=g.req.min_level,
            gap=g.gap,
            type=g.req.type,
            weight=g.req.weight,
            gap_score=round(g.gap_score, 4),
        )
        for g in decision.compute_gaps(sess.role_id, obs, orient)
        if g.gap > 0
    ]
    gaps.sort(key=lambda x: x.gap_score, reverse=True)

    # Time budget is an *expression-layer* lever: it only sets how many of the
    # already-ranked steps to show + the pacing. The ranking itself is unchanged.
    # Skills already surfaced as strengths are excluded from next_steps to avoid
    # the confusing pattern of a skill appearing in both "assets" and "gaps".
    strength_ids = {s.skill_id for s in decision.compute_strengths(obs, lang)}
    budget_key, _weekly_hours, max_steps = pacing.resolve(time_budget)
    steps = decision.select_next_steps(
        sess.role_id, obs, max_steps=max_steps, orientation_id=orient, lang=lang,
        exclude_skill_ids=strength_ids,
    )
    plan = pacing.build_plan(steps, budget_key, lang)
    weeks_by_skill = {p.skill_id: p.est_weeks for p in plan.steps}

    from app.core.config import settings as _cfg
    from app.domain.explain import ranking_reasons_for_step

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
            recommended_resources=(
                _resources_for_step(db, ns.skill_id, ns.target_level, lang)
                if include_resources
                else []
            ),
            ranking_reasons=ranking_reasons_for_step(ns, lang),
            score_components=ns.score_components if _cfg.feature_score_components_api else None,
        )
        for ns in steps
    ]

    # Deterministic conditional projection: only grant the target level of the
    # roadmap steps currently shown. This is not an LLM forecast and not a job
    # promise; it answers "what would coverage be after these acceptance checks?"
    projected_obs = dict(obs)
    for step in steps:
        previous = projected_obs.get(step.skill_id)
        projected_obs[step.skill_id] = SkillObservation(
            level=max(previous.level if previous else 0, step.target_level),
            confidence=previous.confidence if previous else 0.7,
        )

    return ResultResponse(
        session_id=sess.id,
        role_id=sess.role_id,
        orientation=orient,
        orientation_label=competency.orientation_label(competency.get_orientation(orient), lang),
        status=sess.status,
        readiness=decision.compute_readiness(sess.role_id, obs, orient),
        projected_readiness=decision.compute_readiness(sess.role_id, projected_obs, orient),
        profile_uncertainty=round(weighted_uncertainty(sess.role_id, evidence_states, orient), 4),
        assessed_required_count=sum(1 for r in required if r.skill_id in obs),
        required_skill_count=len(required),
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
        note=t(lang, "note.resource"),
    )
