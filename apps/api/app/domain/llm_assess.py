"""LLM 驱动的结构化测评 + 输入哈希缓存（黑客松路线）。

为什么这样做
------------
确定性引擎在边的连接、地基技能归属上有不合理处（如 schema 连不到目标、让 TS 老手去学 TS）。
这里改用大模型来"推理"，但守住两条：
  1. 接地：把技能清单 + 每项的 JD 需求% + 用户当前水平 + 四分类喂给它，禁止编造清单外的技能；
  2. 一致：输出按 (用户画像 + 角色 + 语言 + prompt 版本) 哈希缓存，同样输入永远同样输出
     —— 这正是用缓存抵消大模型随机性的思路，演示时稳定可复现。

无 DeepSeek key 或调用/解析失败时返回 None，调用方回退确定性结果。

缓存：文件型（app/data/llm_cache/<hash>.json），零迁移、零并发问题，适合本地/比赛。
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from app.core.config import settings
from app.domain import competency as C

PROMPT_VERSION = "v1"  # 改 prompt 时 +1，自动让旧缓存失效
_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_JSON_RE = re.compile(r"\{[\s\S]*\}")
_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "llm_cache"
_JD_FILE = Path(__file__).resolve().parent.parent / "data" / "jd_evidence.json"

_SYSTEM = (
    "你是 Zeno 的 AI 职业测评引擎。我会给你一份『技能清单』，每项含：名称、市场 JD 需求百分比、"
    "用户当前水平 L0-L4、归类（foundation_have=工程地基通常已具备 / ai_accelerated=AI能帮你实现但要能讲清 / "
    "core_learn=必学护城河 / pm_side=PM侧非核心）。请据此产出结构化诊断。\n\n"
    "铁律：(1) 只能用清单里的技能，绝不编造；(2) 用户水平 >=3 的算『优势』，绝不让他去学已经会的；"
    "(3) 这是『诊断』不是『承诺』，绝不暗示照做就能拿 offer；(4) 不奉承。\n\n"
    "只返回 JSON，结构：{"
    '"readiness": 0-100 的整数（required 技能的加权覆盖估计）, '
    '"strengths": [{"skill":"技能名","reason":"为什么这是优势，一句话"}], '
    '"gaps": [{"skill":"技能名","class":"core_learn|ai_accelerated|pm_side","why":"为什么/怎么补，一句话"}], '
    '"priority": {"skill":"最该先补的技能名","why":"为什么是这一步（前置已具备/解锁什么/市场要）"}, '
    '"voice": "一段像温暖学长开口的人话诊断，120-220字，结尾必须落到：不承诺 offer，但这些判断是对照真实招聘要求诚实算出来的"'
    "}"
)


def _zh(lang: str) -> bool:
    return not (lang or "").startswith("en")


def _jd_pct(sid: str) -> int:
    try:
        rec = json.loads(_JD_FILE.read_text(encoding="utf-8"))["skills"].get(sid)
    except Exception:
        return 0
    return round(100 * rec.get("frequency", 0.0)) if rec else 0


def _grounded_context(obs: dict[str, int], role_id: str, orientation: str, lang: str) -> list[dict]:
    rows = []
    for r in C.requirements_for_role(role_id, orientation):
        rows.append({
            "skill": C.skill_name(r.skill_id, lang),
            "jd_demand_pct": _jd_pct(r.skill_id),
            "user_level": obs.get(r.skill_id, 0),
            "class": r.fulfillment_class or "core_learn",
            "type": r.type,
        })
    return rows


def _cache_key(obs, role_id, orientation, lang) -> str:
    canonical = json.dumps({
        "v": PROMPT_VERSION, "role": role_id, "orient": orientation,
        "lang": "zh" if _zh(lang) else "en",
        "obs": sorted((k, int(v)) for k, v in obs.items()),
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


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


def assess(obs: dict[str, int], *, role_id: str, orientation: str, lang: str = "zh") -> dict | None:
    """结构化测评：命中缓存直接返回；否则喂接地数据调 DeepSeek，存缓存。失败返回 None。"""
    key = _cache_key(obs, role_id, orientation, lang)
    cached = _cache_get(key)
    if cached is not None:
        cached["_cached"] = True
        return cached

    if not settings.deepseek_api_key:
        return None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.deepseek_api_key, base_url=settings.deepseek_base_url)
        ctx = _grounded_context(obs, role_id, orientation, lang)
        user = ("目标岗位：" + C.role_label(lang) + "\n技能清单：\n"
                + json.dumps(ctx, ensure_ascii=False, indent=1))
        resp = client.chat.completions.create(
            model=settings.deepseek_model, temperature=0.5, max_tokens=1400,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": _SYSTEM},
                      {"role": "user", "content": user}],
        )
        raw = _THINK_RE.sub("", resp.choices[0].message.content or "").strip()
        m = _JSON_RE.search(raw)
        data = json.loads(m.group(0) if m else raw)
        # 最小校验：必须有这几个键且类型对
        if not isinstance(data.get("strengths"), list) or not isinstance(data.get("gaps"), list):
            return None
        data["_cached"] = False
        _cache_set(key, data)
        return data
    except Exception:
        return None
