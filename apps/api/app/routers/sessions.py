import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query
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
from app.domain.assessment_voice import voice_for_result
from app.domain import interview
from pydantic import BaseModel

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class ExtractRequest(BaseModel):
    text: str


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
    lang_param: str | None = Query(default=None, alias="lang"),
    db: Session = Depends(get_db),
    lang: Lang = Depends(get_lang),
) -> ResultResponse:
    sess = session_service.get_session(db, session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found")
    # ?lang= query param overrides Accept-Language header (needed for EventSource)
    effective_lang: Lang = "zh" if lang_param and lang_param.startswith("zh") else lang
    return session_service.build_result(
        db, sess, time_budget=time_budget, lang=effective_lang, orientation=orientation
    )


@router.get("/{session_id}/voice")
def get_voice(
    session_id: str,
    time_budget: str | None = None,
    orientation: str | None = None,
    lang_param: str | None = Query(default=None, alias="lang"),
    db: Session = Depends(get_db),
    lang: Lang = Depends(get_lang),
) -> dict:
    """懒加载的『像真人』测评叙述。result 页先秒出，这段话随后单独拉，
    省掉每次构建结果时的 LLM 延迟与花费。无 DeepSeek key 时回退确定性模板。"""
    sess = session_service.get_session(db, session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found")
    effective_lang: Lang = "zh" if lang_param and lang_param.startswith("zh") else lang
    result = session_service.build_result(
        db, sess, time_budget=time_budget, lang=effective_lang, orientation=orientation
    )
    out = voice_for_result(
        result, role_id=sess.role_id, orientation=result.orientation, lang=effective_lang
    )
    return {"headline": out.get("headline", ""), "voice": out.get("body", "")}


@router.post("/{session_id}/extract")
def extract_skills(
    session_id: str,
    payload: ExtractRequest,
    db: Session = Depends(get_db),
    lang: Lang = Depends(get_lang),
) -> dict:
    """AI Interview：一段项目经历 → DeepSeek 抽取技能(+水平+confidence+原话依据+相邻猜测)。
    输入文本哈希缓存，同样输入同样输出。无 key/失败时返回空，前端回退手动。"""
    sess = session_service.get_session(db, session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found")
    data = interview.extract(payload.text, role_id=sess.role_id, lang=lang)
    return data or {"skills": [], "guesses": [], "_cached": False}


@router.get("/{session_id}/result-stream")
async def get_result_stream(
    session_id: str,
    time_budget: str | None = None,
    orientation: str | None = None,
    lang_param: str | None = Query(default=None, alias="lang"),
    db: Session = Depends(get_db),
    lang: Lang = Depends(get_lang),
) -> StreamingResponse:
    """SSE endpoint: streams progress events then the full result as NDJSON."""
    sess = session_service.get_session(db, session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="session not found")

    # ?lang= query param overrides Accept-Language header (needed for EventSource)
    effective_lang: Lang = "zh" if lang_param and lang_param.startswith("zh") else lang

    async def event_stream():
        def emit(data: dict) -> str:
            return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

        def heartbeat() -> str:
            """SSE comment line — keeps the connection alive through proxies/CDNs
            without triggering a client-side event (browsers ignore SSE comments)."""
            return ": heartbeat\n\n"

        # Localized progress messages
        _pm = {
            "zh": {
                "profile": "正在分析你的技能画像…",
                "strengths": "识别你的优势…",
                "gaps": "计算技能差距…",
                "roadmap": "生成学习路线…",
                "resources": "检查推荐资源…",
                "done": "完成 ✓",
            },
            "en": {
                "profile": "Analyzing your skill profile…",
                "strengths": "Identifying your strengths…",
                "gaps": "Computing skill gaps…",
                "roadmap": "Building your learning roadmap…",
                "resources": "Checking recommended resources…",
                "done": "Done ✓",
            },
        }
        pm = _pm.get(effective_lang, _pm["en"])

        yield emit({"type": "progress", "step": "profile", "message": pm["profile"]})
        await asyncio.sleep(0.4)

        yield emit({"type": "progress", "step": "strengths", "message": pm["strengths"]})
        await asyncio.sleep(0.3)

        yield emit({"type": "progress", "step": "gaps", "message": pm["gaps"]})
        await asyncio.sleep(0.3)
        yield heartbeat()

        yield emit({"type": "progress", "step": "roadmap", "message": pm["roadmap"]})
        await asyncio.sleep(0.3)

        # Actually compute the result (may take longer when LLM is involved)
        result = session_service.build_result(
            db, sess, time_budget=time_budget, lang=effective_lang, orientation=orientation
        )

        yield heartbeat()
        yield emit({"type": "progress", "step": "resources", "message": pm["resources"]})
        await asyncio.sleep(0.2)

        yield emit({"type": "progress", "step": "done", "message": pm["done"]})
        await asyncio.sleep(0.15)

        # Final event: the full result payload
        yield emit({"type": "result", "data": result.model_dump(mode="json")})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
