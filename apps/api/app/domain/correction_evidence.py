"""Grounded natural-language evidence extraction and rubric-based calibration."""
from __future__ import annotations

import json
import logging
import re

from app.core.config import settings

RULE_VERSION = "evidence-rubric-v2"
_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
logger = logging.getLogger(__name__)
_MAX_COMPLETION_TOKENS = 4000  # 0G reasoning models spend tokens before final JSON.

_SYSTEM = """You extract grounded, observable career-skill evidence. Do not assign a level.
Return one JSON object with:
- project: string
- actions: string[] (short factual summaries, not copied confidence claims)
- ownership: string
- outcome: string
- evidence_quote: one exact contiguous quote from the user's text
- dimensions: an object with exactly these keys:
  application: {value: one of none|learning|exercise|personal_project|real_project|production, quote: string}
  ownership: {value: one of none|participated|independent|led, quote: string}
  delivery: {value: one of none|completed|shipped|operated, quote: string}
  problem_solving: {value: one of none|handled, quote: string}
  system_scope: {value: one of none|component|system, quote: string}

Every non-none dimension MUST include an exact contiguous quote from the user's text that supports it.
Use real_project when the user describes work in a real organizational/client project. Use independent when
the user says a component or responsibility was theirs, even if they do not literally say "independently".
Do not require the user to mention a problem or launch before recognizing independent ownership in a real project.
Use led only for leading people/direction, and system only for architecture, cross-component trade-offs,
evaluation systems, or ongoing governance. If unsupported, use none and an empty quote. Return JSON only."""

DIMENSION_VALUES = {
    "application": {"none", "learning", "exercise", "personal_project", "real_project", "production"},
    "ownership": {"none", "participated", "independent", "led"},
    "delivery": {"none", "completed", "shipped", "operated"},
    "problem_solving": {"none", "handled"},
    "system_scope": {"none", "component", "system"},
}


def _backends() -> list[tuple[str, str, str, str]]:
    """Return evidence-extraction backends in latency-first failover order.

    Correction is a small structured extraction task, so use the fast model.
    The final diagnosis expression remains on 0G and keeps its TEE receipt.
    """
    backends: list[tuple[str, str, str, str]] = []
    if settings.deepseek_api_key:
        backends.append(
            (
                settings.deepseek_api_key,
                settings.deepseek_base_url,
                settings.deepseek_model,
                "DeepSeek",
            )
        )
    if settings.zg_api_key:
        backends.append(
            (settings.zg_api_key, settings.zg_base_url, settings.zg_model, "0G Compute")
        )
    return backends


def _extract_with_backend(
    text: str,
    *,
    skill_name: str,
    lang: str,
    backend: tuple[str, str, str, str],
) -> tuple[dict, str]:
    """Call one OpenAI-compatible backend and validate its structured evidence."""
    from openai import OpenAI

    api_key, base_url, model, provider = backend
    client = OpenAI(api_key=api_key, base_url=base_url)
    messages = [
        {"role": "system", "content": _SYSTEM},
        {
            "role": "user",
            "content": json.dumps(
                {"skill": skill_name, "language": lang, "experience": text},
                ensure_ascii=False,
            ),
        },
    ]
    options = {"extra_body": {"verify_tee": True}} if provider == "0G Compute" else {}
    try:
        response = client.chat.completions.create(
            model=model,
            temperature=0,
            max_tokens=_MAX_COMPLETION_TOKENS,
            response_format={"type": "json_object"},
            messages=messages,
            **options,
        )
    except Exception as strict_error:
        logger.info("%s JSON mode failed; retrying plain completion: %s", provider, strict_error)
        response = client.chat.completions.create(
            model=model,
            temperature=0,
            max_tokens=_MAX_COMPLETION_TOKENS,
            messages=messages,
            **options,
        )
    raw = _THINK_RE.sub("", response.choices[0].message.content or "").strip()
    if not raw:
        finish_reason = getattr(response.choices[0], "finish_reason", "unknown")
        raise ValueError(f"empty evidence response (finish_reason={finish_reason})")
    match = re.search(r"\{[\s\S]*\}", raw)
    data = json.loads(match.group(0) if match else raw)
    if not isinstance(data, dict):
        raise ValueError("evidence response is not a JSON object")
    quote = str(data.get("evidence_quote") or "").strip()
    if not quote or quote not in text:
        data["evidence_quote"] = text[:240]
    raw_actions = data.get("actions") or []
    if isinstance(raw_actions, str):
        raw_actions = [raw_actions]
    data["actions"] = [str(item).strip() for item in raw_actions if str(item).strip()][:6]
    raw_dimensions = data.get("dimensions")
    raw_dimensions = raw_dimensions if isinstance(raw_dimensions, dict) else {}
    dimensions: dict[str, dict[str, str]] = {}
    for name, allowed in DIMENSION_VALUES.items():
        item = raw_dimensions.get(name)
        item = item if isinstance(item, dict) else {}
        value = str(item.get("value") or "none").strip()
        quote = str(item.get("quote") or "").strip()
        # A category without a verbatim source span is not evidence.
        if value not in allowed or value != "none" and (not quote or quote not in text):
            value, quote = "none", ""
        dimensions[name] = {"value": value, "quote": quote}
    data["dimensions"] = dimensions
    data.pop("suggested_level", None)
    return data, provider


def extract(text: str, *, skill_name: str, lang: str) -> tuple[dict, str]:
    backends = _backends()
    if not backends:
        raise ValueError("经历分析服务尚未配置，请稍后重试")
    for backend in backends:
        provider = backend[3]
        try:
            return _extract_with_backend(
                text, skill_name=skill_name, lang=lang, backend=backend
            )
        except Exception as error:
            logger.warning("Correction evidence backend %s failed: %s", provider, error)
    logger.error("Correction evidence exhausted every configured LLM backend")
    raise ValueError("经历分析暂时不可用，请稍后重试")


def calibrate(extracted: dict) -> int:
    """Map grounded semantic dimensions to a level; never inspect wording."""
    dimensions = extracted.get("dimensions")
    dimensions = dimensions if isinstance(dimensions, dict) else {}

    def value(name: str) -> str:
        item = dimensions.get(name)
        return str(item.get("value") or "none") if isinstance(item, dict) else "none"

    application = value("application")
    ownership = value("ownership")
    system_scope = value("system_scope")

    # L4: system-level direction, not merely owning one component.
    if application in {"real_project", "production"} and ownership == "led" and system_scope == "system":
        return 4
    # L3: independently owned meaningful work in a real project. Delivery and
    # problem-solving strengthen the evidence, but are not mandatory magic words.
    if application in {"real_project", "production"} and ownership in {"independent", "led"}:
        return 3
    # L2: applied the skill in an exercise, project, or production context.
    if application in {"exercise", "personal_project", "real_project", "production"}:
        return 2
    return 1
