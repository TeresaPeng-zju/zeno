"""Natural-language correction evidence with a deterministic level ceiling."""
from __future__ import annotations

import json
import re

from app.core.config import settings

RULE_VERSION = "correction-v1"
_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)

_SYSTEM = """You extract observable career-skill evidence. Never reward confidence or impressive wording.
Return JSON only with: project(string), actions(string[]), ownership(string), outcome(string),
problem_handled(boolean), architecture_or_governance(boolean), suggested_level(integer 1-4),
evidence_quote(an exact contiguous quote from the user's text).
Levels: 1=familiar only; 2=personal feature/demo; 3=independently shipped in a real project and solved problems;
4=led architecture, trade-offs, evaluation, or ongoing governance. If evidence is absent, leave fields empty.
The suggested level is advisory only and will not be used directly."""


def _fallback(text: str) -> dict:
    clauses = [part.strip() for part in re.split(r"[。；;\n]", text) if part.strip()]
    return {
        "project": "",
        "actions": clauses[:3],
        "ownership": "",
        "outcome": "",
        "problem_handled": False,
        "architecture_or_governance": False,
        "suggested_level": None,
        "evidence_quote": text[:240],
    }


def _backend() -> tuple[str, str, str, str] | None:
    if settings.zg_api_key:
        return settings.zg_api_key, settings.zg_base_url, settings.zg_model, "0G Compute"
    if settings.deepseek_api_key:
        return settings.deepseek_api_key, settings.deepseek_base_url, settings.deepseek_model, "DeepSeek"
    return None


def extract(text: str, *, skill_name: str, lang: str) -> tuple[dict, str]:
    backend = _backend()
    if backend is None:
        return _fallback(text), "deterministic-fallback"
    api_key, base_url, model, provider = backend
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, base_url=base_url)
        messages = [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": json.dumps({"skill": skill_name, "language": lang, "experience": text}, ensure_ascii=False)},
        ]
        options = {"extra_body": {"verify_tee": True}} if provider == "0G Compute" else {}
        try:
            response = client.chat.completions.create(model=model, temperature=0, max_tokens=500, response_format={"type": "json_object"}, messages=messages, **options)
        except Exception:
            response = client.chat.completions.create(model=model, temperature=0, max_tokens=500, messages=messages, **options)
        raw = _THINK_RE.sub("", response.choices[0].message.content or "").strip()
        match = re.search(r"\{[\s\S]*\}", raw)
        data = json.loads(match.group(0) if match else raw)
        quote = str(data.get("evidence_quote") or "").strip()
        if not quote or quote not in text:
            data["evidence_quote"] = text[:240]
        data["actions"] = [str(item).strip() for item in data.get("actions") or [] if str(item).strip()][:6]
        return data, provider
    except Exception:
        return _fallback(text), "deterministic-fallback"


def calibrate(text: str, extracted: dict) -> int:
    """Compute the final suggestion without reading LLM ``suggested_level``."""
    normalized = text.lower()
    actions = extracted.get("actions") or []
    level = 1
    action_words = ("实现", "接入", "开发", "完成", "处理", "搭建", "built", "implemented", "integrated", "shipped")
    if actions and any(word in normalized for word in action_words):
        level = 2

    independent = any(word in normalized for word in ("独立", "负责", "owner", "owned", "independently"))
    problem = bool(extracted.get("problem_handled")) and any(
        word in normalized for word in ("解决", "修复", "重试", "故障", "超时", "问题", "debug", "retry", "timeout", "failure")
    )
    delivered = bool(str(extracted.get("outcome") or "").strip()) or any(
        word in normalized for word in ("上线", "交付", "可运行", "demo", "production", "launched", "delivered")
    )
    if level >= 2 and independent and problem and delivered:
        level = 3

    leadership = any(word in normalized for word in ("主导", "架构", "技术取舍", "评测", "治理", "持续优化", "led", "architecture", "trade-off", "evaluation", "governance"))
    if level >= 3 and leadership and bool(extracted.get("architecture_or_governance")):
        level = 4
    return level
