"""AI Interview：一段项目经历 → DeepSeek 抽取技能(+水平+原话依据+相邻猜测)，输入哈希缓存。

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

PROMPT_VERSION = "iv1"
_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "interview_cache"

_SYSTEM = (
    "你是 Zeno 的技能抽取器。我会给你：① 用户讲述的一段真实项目经历；② 一份目标岗位的技能清单"
    "（每项 skill_id + 名称）。\n\n"
    "任务：\n"
    "1. 从经历中抽取用户**确实展示出**的技能，每个给：skill_id、level(0-4：0没接触/1入门/2能独立做小功能/"
    "3可交付/4可设计治理)、confidence(0-1，你对这个判断的把握)、evidence(从用户原话里摘一句作为判断依据)。\n"
    "2. 再『猜』2-3 个用户很可能也具备、但没明说的相邻技能(guesses)，每个给 skill_id、confidence(0-1)、"
    "reason(为什么猜他也会，一句话)。\n\n"
    "铁律：skill_id 只能用清单里的；不能凭空抬高 level；evidence 必须是用户原话里的片段；"
    "把握不足就调低 confidence；宁可少抽也不要编造。\n\n"
    '只返回 JSON：{"skills":[{"skill_id":"...","level":3,"confidence":0.9,"evidence":"用户原话片段"}], '
    '"guesses":[{"skill_id":"...","confidence":0.7,"reason":"为什么猜他也会，一句话"}]}'
)


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


def extract(text: str, *, role_id: str, lang: str = "zh") -> dict | None:
    """经历文本 → {skills:[{skill_id,skill_name,level,evidence}], guesses:[{skill_id,skill_name,reason}]}。
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
        result = {
            "skills": _enrich(data.get("skills"), "skill_id", lang),
            "guesses": _enrich(data.get("guesses"), "skill_id", lang),
            "_cached": False,
        }
        _cache_set(key, result)
        return result
    except Exception:
        return None
