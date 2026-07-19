"""Grounded JD requirement extraction and deterministic orientation scoring."""
from __future__ import annotations

import json
import logging
import re

from app.core.config import settings
from app.domain import competency

logger = logging.getLogger(__name__)
_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)

# These are semantic capability categories, not words searched in the JD.
# The LLM extracts grounded claims; this table only maps those claims onto the
# product's three existing orientation modifiers.
CAPABILITY_ORIENTATION = {
    "retrieval_pipeline": "rag",
    "vector_search": "rag",
    "document_processing": "rag",
    "retrieval_quality": "rag",
    "tool_calling": "agent",
    "multi_step_orchestration": "agent",
    "agent_state_planning": "agent",
    "evaluation_system": "eval",
    "quality_metrics": "eval",
    "observability_guardrails": "eval",
}
CAPABILITIES = frozenset((*CAPABILITY_ORIENTATION, "other"))
IMPORTANCE_WEIGHT = {"required": 2.0, "preferred": 1.0, "context": 0.25}

_SYSTEM = f"""You extract grounded capability requirements from a job description.
Do not choose a Zeno orientation. Return JSON with one key, requirements, whose value is an array.
Each requirement must contain:
- capability: exactly one of {sorted(CAPABILITIES)}
- importance: required | preferred | context
- quote: an exact contiguous quote copied from the job description
- summary: a short factual paraphrase in the requested language

Use required only for explicit responsibilities or must-have qualifications, preferred for nice-to-have
qualifications, and context when a technology is merely mentioned. Merge duplicate claims. If no supported
specialized capability exists, return an empty requirements array. Return JSON only."""


def _backends() -> list[tuple[str, str, str, str]]:
    backends: list[tuple[str, str, str, str]] = []
    if settings.deepseek_api_key:
        backends.append((settings.deepseek_api_key, settings.deepseek_base_url, settings.deepseek_model, "DeepSeek"))
    if settings.zg_api_key:
        backends.append((settings.zg_api_key, settings.zg_base_url, settings.zg_model, "0G Compute"))
    return backends


def _extract_with_backend(text: str, lang: str, backend: tuple[str, str, str, str]) -> list[dict]:
    from openai import OpenAI

    api_key, base_url, model, provider = backend
    client = OpenAI(api_key=api_key, base_url=base_url)
    options = {"extra_body": {"verify_tee": True}} if provider == "0G Compute" else {}
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": json.dumps({"language": lang, "job_description": text}, ensure_ascii=False)},
    ]
    try:
        response = client.chat.completions.create(
            model=model, temperature=0, max_tokens=1200,
            response_format={"type": "json_object"}, messages=messages, **options,
        )
    except Exception as strict_error:
        logger.info("%s JD JSON mode failed; retrying plain completion: %s", provider, strict_error)
        response = client.chat.completions.create(
            model=model, temperature=0, max_tokens=1200, messages=messages, **options,
        )
    raw = _THINK_RE.sub("", response.choices[0].message.content or "").strip()
    match = re.search(r"\{[\s\S]*\}", raw)
    data = json.loads(match.group(0) if match else raw)
    requirements = data.get("requirements") if isinstance(data, dict) else []
    validated: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in requirements if isinstance(requirements, list) else []:
        if not isinstance(item, dict):
            continue
        capability = str(item.get("capability") or "")
        importance = str(item.get("importance") or "")
        quote = str(item.get("quote") or "").strip()
        if capability not in CAPABILITIES or importance not in IMPORTANCE_WEIGHT or not quote or quote not in text:
            continue
        key = (capability, quote)
        if key in seen:
            continue
        seen.add(key)
        validated.append({
            "capability": capability,
            "importance": importance,
            "quote": quote,
            "summary": str(item.get("summary") or "").strip(),
        })
    return validated


def extract_requirements(text: str, lang: str) -> tuple[list[dict], str]:
    for backend in _backends():
        try:
            return _extract_with_backend(text, lang, backend), backend[3]
        except Exception as error:
            logger.warning("JD extraction backend %s failed: %s", backend[3], error)
    raise ValueError("岗位分析暂时不可用，请稍后重试")


def score_requirements(requirements: list[dict]) -> dict:
    """Map grounded semantic claims to an orientation; never inspect JD wording."""
    scores = {orientation_id: 0.0 for orientation_id in competency.ORIENTATIONS if orientation_id != competency.ORIENTATION_BASE}
    evidence = {orientation_id: [] for orientation_id in scores}
    for claim in requirements:
        orientation = CAPABILITY_ORIENTATION.get(str(claim.get("capability") or ""))
        importance = str(claim.get("importance") or "")
        if orientation not in scores or importance not in IMPORTANCE_WEIGHT:
            continue
        scores[orientation] += IMPORTANCE_WEIGHT[importance]
        evidence[orientation].append(claim)

    ranked = sorted(scores, key=lambda item: scores[item], reverse=True)
    if not ranked or scores[ranked[0]] <= 0:
        return {"orientation": competency.ORIENTATION_BASE, "matched": False, "confidence": 0.0,
                "needs_confirmation": False, "signals": [], "scores": scores}
    best = ranked[0]
    runner_up = scores[ranked[1]] if len(ranked) > 1 else 0.0
    best_score = scores[best]
    margin = best_score - runner_up
    # Confidence describes separation and evidence strength; it is not a model probability.
    confidence = round(min(1.0, best_score / 4.0) * min(1.0, 0.5 + margin / 2.0), 3)
    needs_confirmation = best_score < 2.0 or margin < 0.75
    signals = [claim["quote"] for claim in evidence[best]][:8]
    return {"orientation": best, "matched": True, "confidence": confidence,
            "needs_confirmation": needs_confirmation, "signals": signals, "scores": scores}


def classify(text: str, lang: str = "zh") -> dict:
    text = (text or "").strip()
    if not text:
        return score_requirements([])
    requirements, provider = extract_requirements(text, lang)
    result = score_requirements(requirements)
    result["requirements"] = requirements
    result["provider"] = provider
    return result
