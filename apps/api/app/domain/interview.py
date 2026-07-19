"""AI Interview：项目经历 → grounded skill evidence → rubric levels.

这是 Zeno 的黑客松方向：不再点 20 个胶囊，而是『讲一个你最有代表性的项目』，AI 自动点亮多个技能。
  - evidence(原话片段) 同时支撑"点节点 → 为什么判这个等级"的可解释体验；
  - guesses(相邻技能猜测) 支撑"我猜你还做过 X，对吗 👍/👎"；
  - 输入文本哈希缓存 → 同样输入永远同样输出（演示可复现，且省 token）。

无 DeepSeek key 或失败时返回 None，前端回退到手动胶囊。
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from app.core.config import settings
from app.domain import competency as C

PROMPT_VERSION = "iv2-grounded-rubric"
_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "interview_cache"

_SYSTEM = """You extract grounded skill evidence from a user's project experience. Never assign a level.
For every skill explicitly demonstrated, return:
- skill_id from the supplied catalog
- evidence: one exact contiguous quote from the user's text
- dimensions with exactly these keys:
  application: {value: none|learning|exercise|personal_project|real_project|production, quote: string}
  ownership: {value: none|participated|independent|led, quote: string}
  delivery: {value: none|completed|shipped|operated, quote: string}
  problem_solving: {value: none|handled, quote: string}
  system_scope: {value: none|component|system, quote: string}

Every non-none dimension requires an exact contiguous quote. Responsibility for a component in an
organizational/client project is independent ownership even without the literal word independently.
Use led only for leading direction or people; use system only for cross-component architecture,
trade-offs, evaluation systems, or ongoing governance.

You may also suggest up to 3 adjacent skills in guesses, but guesses are explicitly unverified and must
not contain a level. Return JSON only:
{"skills":[{"skill_id":"...","evidence":"exact quote","dimensions":{...}}],
 "guesses":[{"skill_id":"...","reason":"short hypothesis"}]}"""


def _key(text: str, role_id: str, lang: str) -> str:
    blob = json.dumps({"v": PROMPT_VERSION, "role": role_id, "lang": lang,
                       "text": " ".join(text.split())}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:24]


def _cache_get(key: str) -> dict | None:
    f = _CACHE_DIR / f"{key}.json"
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _cache_set(key: str, value: dict) -> None:
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (_CACHE_DIR / f"{key}.json").write_text(
            json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:
        pass


def _enrich(items: list, key: str, lang: str) -> list:
    """补 skill_name，丢弃清单外的 skill_id。"""
    out = []
    for it in items or []:
        sid = it.get(key) if key in it else it.get("skill_id")
        if sid in C.SKILLS_BY_ID:
            it = dict(it)
            it["skill_id"] = sid
            it["skill_name"] = C.skill_name(sid, lang)
            it["category"] = C.SKILLS_BY_ID[sid].category
            out.append(it)
    return out


def _ground_skill(item: dict, text: str, lang: str) -> dict | None:
    """Validate verbatim evidence and compute a level with the shared rubric."""
    from app.domain import correction_evidence

    sid = str(item.get("skill_id") or "")
    evidence = str(item.get("evidence") or "").strip()
    if sid not in C.SKILLS_BY_ID or not evidence or evidence not in text:
        return None
    raw_dimensions = item.get("dimensions")
    raw_dimensions = raw_dimensions if isinstance(raw_dimensions, dict) else {}
    dimensions: dict[str, dict[str, str]] = {}
    grounded_count = 0
    for name, allowed in correction_evidence.DIMENSION_VALUES.items():
        raw = raw_dimensions.get(name)
        raw = raw if isinstance(raw, dict) else {}
        value = str(raw.get("value") or "none")
        quote = str(raw.get("quote") or "").strip()
        if value not in allowed or value != "none" and (not quote or quote not in text):
            value, quote = "none", ""
        if value != "none":
            grounded_count += 1
        dimensions[name] = {"value": value, "quote": quote}
    extracted = {"dimensions": dimensions}
    level = correction_evidence.calibrate(extracted)
    return {
        "skill_id": sid,
        "skill_name": C.skill_name(sid, lang),
        "category": C.SKILLS_BY_ID[sid].category,
        "level": level,
        "confidence": round(min(0.95, 0.55 + grounded_count * 0.08), 2),
        "evidence": evidence,
        "dimensions": dimensions,
        "rule_version": correction_evidence.RULE_VERSION,
    }


def extract(text: str, *, role_id: str, lang: str = "zh") -> dict | None:
    """经历文本 → grounded skills + unverified guesses.
    命中缓存直接返回；无 key/失败返回 None。"""
    text = (text or "").strip()
    if len(text) < 4:
        return {"skills": [], "guesses": []}
    key = _key(text, role_id, lang)
    cached = _cache_get(key)
    if cached is not None:
        cached["_cached"] = True
        return cached

    if not settings.deepseek_api_key:
        return None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url)
        catalog = [{"skill_id": s.id, "name": C.skill_name(s.id, lang)} for s in C.SKILLS]
        user = (f"目标岗位：{C.role_label(lang)}\n\n用户的项目经历：\n{text}\n\n"
                f"技能清单：\n{json.dumps(catalog, ensure_ascii=False)}")
        resp = client.chat.completions.create(
            model=settings.deepseek_model, temperature=0.3, max_tokens=900,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": _SYSTEM},
                      {"role": "user", "content": user}],
        )
        raw = _THINK_RE.sub("", resp.choices[0].message.content or "").strip()
        data = json.loads(raw)
        raw_skills = data.get("skills") if isinstance(data, dict) else []
        skills = [grounded for item in raw_skills if isinstance(item, dict)
                  and (grounded := _ground_skill(item, text, lang)) is not None]
        result = {
            "skills": skills,
            "guesses": _enrich(data.get("guesses"), "skill_id", lang),
            "_cached": False,
        }
        _cache_set(key, result)
        return result
    except Exception:
        return None
