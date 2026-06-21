from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.i18n import Lang, get_lang
from app.schemas import (
    AnswerIn,
    NextQuestionResponse,
    ResultResponse,
    SessionCreateRequest,
    SessionCreateResponse,
)
from app.services import session_service

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionCreateResponse)
def create_session(
    payload: SessionCreateRequest | None = None, db: Session = Depends(get_db)
) -> SessionCreateResponse:
    orientation = payload.orientation if payload else None
    sess = session_service.create_session(db, orientation=orientation)
    return SessionCreateResponse(
        session_id=sess.id, role_id=sess.role_id, orientation=sess.orientation
    )


@router.get("/{session_id}/next-question", response_model=NextQuestionResponse)
def get_next_question(
    session_id: str,
    db: Session = Depends(get_db),
    lang: Lang = Depends(get_lang),
) -> NextQuestionResponse:
    sess = session_service.get_session(db, session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session_service.next_question(db, sess, lang)


@router.post("/{session_id}/answers", response_model=NextQuestionResponse)
def submit_answer(
    session_id: str,
    payload: AnswerIn,
    db: Session = Depends(get_db),
    lang: Lang = Depends(get_lang),
) -> NextQuestionResponse:
    sess = session_service.get_session(db, session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        session_service.record_answer(db, sess, payload.skill_id, payload.answer_value)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return session_service.next_question(db, sess, lang)


@router.get("/{session_id}/result", response_model=ResultResponse)
def get_result(
    session_id: str,
    time_budget: str | None = None,
    orientation: str | None = None,
    db: Session = Depends(get_db),
    lang: Lang = Depends(get_lang),
) -> ResultResponse:
    sess = session_service.get_session(db, session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session_service.build_result(
        db, sess, time_budget=time_budget, lang=lang, orientation=orientation
    )
