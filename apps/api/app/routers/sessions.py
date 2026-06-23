import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
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
    current_role = payload.current_role if payload else None
    sess = session_service.create_session(
        db, orientation=orientation, current_role=current_role
    )
    return SessionCreateResponse(
        session_id=sess.id,
        role_id=sess.role_id,
        orientation=sess.orientation,
        current_role=sess.current_role,
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


@router.get("/{session_id}/result-stream")
async def get_result_stream(
    session_id: str,
    time_budget: str | None = None,
    orientation: str | None = None,
    db: Session = Depends(get_db),
    lang: Lang = Depends(get_lang),
) -> StreamingResponse:
    """SSE endpoint: streams progress events then the full result as NDJSON."""
    sess = session_service.get_session(db, session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found")

    async def event_stream():
        def emit(data: dict) -> str:
            return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

        yield emit({"type": "progress", "step": "profile", "message": "Analyzing your skill profile…"})
        await asyncio.sleep(0.4)

        yield emit({"type": "progress", "step": "strengths", "message": "Identifying your strengths…"})
        await asyncio.sleep(0.3)

        yield emit({"type": "progress", "step": "gaps", "message": "Computing skill gaps…"})
        await asyncio.sleep(0.3)

        yield emit({"type": "progress", "step": "roadmap", "message": "Building your learning roadmap…"})
        await asyncio.sleep(0.3)

        # Actually compute the result
        result = session_service.build_result(
            db, sess, time_budget=time_budget, lang=lang, orientation=orientation
        )

        yield emit({"type": "progress", "step": "resources", "message": "Checking recommended resources…"})
        await asyncio.sleep(0.2)

        yield emit({"type": "progress", "step": "done", "message": "Done ✓"})
        await asyncio.sleep(0.15)

        # Final event: the full result payload
        yield emit({"type": "result", "data": result.model_dump(mode="json")})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
