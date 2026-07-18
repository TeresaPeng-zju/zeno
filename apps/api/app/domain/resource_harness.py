"""Semi-automatic resource curation harness.

The harness deliberately separates discovery from publication:
URL -> fetch -> DeepSeek annotation -> pending candidate -> human approval -> embed/store.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from typing import Any, Protocol

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain import competency
from app.models import ResourceCandidate, url_hash
from app.services import resource_service


class Annotator(Protocol):
    model_name: str

    def annotate(self, *, title: str, url: str, text: str) -> dict[str, Any]: ...


class _ReadableHTML(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self._skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
        if tag in {"script", "style", "svg", "nav", "footer"}:
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag in {"script", "style", "svg", "nav", "footer"} and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        clean = " ".join(unescape(data).split())
        if not clean:
            return
        if self._in_title:
            self.title += clean
        if not self._skip:
            self.parts.append(clean)


class WebFetcher:
    def fetch(self, url: str) -> dict[str, Any]:
        headers = {"User-Agent": settings.curation_user_agent}
        with httpx.Client(
            timeout=settings.curation_fetch_timeout,
            follow_redirects=True,
            headers=headers,
        ) as client:
            response = client.get(url)
            response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "html" in content_type:
            parser = _ReadableHTML()
            parser.feed(response.text)
            text = "\n".join(parser.parts)
            title = parser.title.strip()
        else:
            text = response.text
            title = ""
        text = re.sub(r"\n{3,}", "\n\n", text).strip()[: settings.curation_max_chars]
        return {
            "url": str(response.url),
            "status": response.status_code,
            "title": title,
            "text": text,
        }


class DeepSeekAnnotator:
    model_name = settings.deepseek_model

    def __init__(self) -> None:
        if not settings.deepseek_api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is required for automatic annotation")

    def annotate(self, *, title: str, url: str, text: str) -> dict[str, Any]:
        skills = [
            {"id": sid, "name": competency.skill_name(sid, "zh"), "category": s.category}
            for sid, s in competency.SKILLS_BY_ID.items()
        ]
        prompt = {
            "task": "Label this learning resource for Zeno. Return JSON only.",
            "rules": [
                "Choose 1-3 skill_ids only from skill_catalog.",
                "target_levels are integers 1-4 for each chosen skill.",
                "quality_score and confidence are numbers 0-1.",
                "This is a launch-stage library: map any accessible learning content to the closest skills.",
                "Do not reject merely for being brief, introductory, commercial, or imperfect.",
                "Set rejection_reason only when the content is unrelated to learning any catalog skill.",
                "summary must describe observable learning outcomes, <= 120 Chinese characters.",
            ],
            "schema": {
                "skill_ids": ["string"],
                "target_levels": {"skill_id": 2},
                "resource_type": "article|video|course|doc|repo|tool",
                "language": "zh|en|other",
                "summary": "string",
                "prerequisites": ["string"],
                "learning_outcomes": ["string"],
                "quality_score": 0.0,
                "confidence": 0.0,
                "rejection_reason": None,
            },
            "skill_catalog": skills,
            "resource": {"title": title, "url": url, "content": text},
        }
        endpoint = settings.deepseek_base_url.rstrip("/") + "/chat/completions"
        response = httpx.post(
            endpoint,
            headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
            json={
                "model": settings.deepseek_model,
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": "You are a strict learning-resource curator."},
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
            },
            timeout=45,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return validate_annotation(json.loads(content))


def validate_annotation(value: dict[str, Any]) -> dict[str, Any]:
    rejection = value.get("rejection_reason")
    skill_ids = list(dict.fromkeys(value.get("skill_ids") or []))[:3]
    unknown = [sid for sid in skill_ids if sid not in competency.SKILLS_BY_ID]
    if unknown:
        raise ValueError(f"annotation contains unknown skill ids: {unknown}")
    if not rejection and not skill_ids:
        raise ValueError("accepted annotation must contain at least one skill_id")
    levels = value.get("target_levels") or {}
    normalized_levels = {sid: max(1, min(4, int(levels.get(sid, 2)))) for sid in skill_ids}
    resource_type = value.get("resource_type", "article")
    if resource_type not in {"article", "video", "course", "doc", "repo", "tool"}:
        resource_type = "article"
    return {
        "skill_ids": skill_ids,
        "target_levels": normalized_levels,
        "resource_type": resource_type,
        "language": str(value.get("language", "other"))[:10],
        "summary": str(value.get("summary", "")).strip()[:500],
        "prerequisites": [str(x)[:160] for x in (value.get("prerequisites") or [])[:8]],
        "learning_outcomes": [str(x)[:200] for x in (value.get("learning_outcomes") or [])[:8]],
        "quality_score": max(0.0, min(1.0, float(value.get("quality_score", 0)))),
        "confidence": max(0.0, min(1.0, float(value.get("confidence", 0)))),
        "rejection_reason": str(rejection)[:500] if rejection else None,
    }


def stage_url(
    db: Session,
    *,
    url: str,
    source: str = "manual",
    title: str = "",
    fetcher: WebFetcher | None = None,
    annotator: Annotator | None = None,
) -> ResourceCandidate:
    candidate = db.scalar(select(ResourceCandidate).where(ResourceCandidate.url_hash == url_hash(url)))
    if candidate is None:
        candidate = ResourceCandidate(url=url, url_hash=url_hash(url), source=source, title=title)
        db.add(candidate)
    try:
        page = (fetcher or WebFetcher()).fetch(url)
        candidate.url = page["url"]
        candidate.title = title or page["title"] or url
        candidate.fetched_text = page["text"]
        labeler = annotator or DeepSeekAnnotator()
        candidate.annotation = labeler.annotate(
            title=candidate.title, url=candidate.url, text=candidate.fetched_text
        )
        candidate.model_name = labeler.model_name
        candidate.status = "rejected" if candidate.annotation.get("rejection_reason") else "pending"
        candidate.error = None
    except Exception as exc:
        candidate.status = "failed"
        candidate.error = str(exc)[:2000]
    db.commit()
    db.refresh(candidate)
    return candidate


def approve_candidate(db: Session, candidate: ResourceCandidate) -> None:
    annotation = validate_annotation(candidate.annotation or {})
    if annotation["rejection_reason"]:
        raise ValueError("cannot approve a rejected annotation")
    resource = resource_service.upsert_resource(
        db,
        title=candidate.title,
        url=candidate.url,
        skill_ids=annotation["skill_ids"],
        platform=candidate.source,
        resource_type=annotation["resource_type"],
        target_level=2,
        target_levels=annotation["target_levels"],
        summary=annotation["summary"],
        quality_score=annotation["quality_score"],
    )
    # Annotation only runs after WebFetcher receives a successful HTTP response.
    resource.freshness_status = "fresh"
    resource.http_status = 200
    resource.last_verified_at = datetime.now(timezone.utc)
    resource.verify_note = f"LLM-assisted intake via {candidate.model_name or 'unknown model'}"
    candidate.status = "approved"
    candidate.reviewed_at = datetime.now(timezone.utc)
    db.commit()


def reject_candidate(db: Session, candidate: ResourceCandidate, reason: str = "human review") -> None:
    candidate.status = "rejected"
    candidate.error = reason
    candidate.reviewed_at = datetime.now(timezone.utc)
    db.commit()
