"""表达层：把确定性引擎算出的测评，说成『一位温暖学长开口』——有阅读节奏 + 一句可截图金句。

设计延续 Zeno 的 decision/expression 分工：
  - 事实（就绪度 / 优势 / 缺口分类 / 最该先补的一步 / JD 需求）全部来自 decision 引擎；
  - 这里只负责『讲人话』，由 SYSTEM 锁死信任底线（诊断不承诺、不奉承、会用≠自圆其说）；
  - 没有 DeepSeek key 或调用失败时，回退确定性模板，永远有输出。
  - 输出结构：{"headline": 一句可截图分享的扎心判断, "body": 有节奏的短段落（段间空行）}。
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from app.core.config import settings
from app.domain import competency as C

__all__ = ["voice_for_result", "build_facts", "narrate", "SYSTEMS"]

_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_JD_FILE = Path(__file__).resolve().parent.parent / "data" / "jd_evidence.json"
_AI_CAT_FIRST = {"llm": 0, "data": 0, "eval": 0, "foundation": 1}


def _model_data(value: object) -> dict:
    """Return provider extensions from either a plain dict or an SDK model."""
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        data = dump()
        return data if isinstance(data, dict) else {}
    return {}


def _zg_receipt(resp: object, model: str) -> dict | None:
    """Extract the 0G Router receipt; never substitute the completion id."""
    response_data = _model_data(resp)
    model_extra = getattr(resp, "model_extra", None)
    if isinstance(model_extra, dict):
        response_data = {**response_data, **model_extra}

    trace = response_data.get("x_0g_trace") or getattr(resp, "x_0g_trace", None)
    trace_data = _model_data(trace)
    request_id = trace_data.get("request_id")
    if not request_id:
        return None

    return {
        "provider": "0G Compute",
        "model": model,
        "request_id": str(request_id),
        "provider_address": str(trace_data.get("provider") or ""),
        "tee_verified": trace_data.get("tee_verified") is True,
    }


def _zh(lang: str) -> bool:
    return not (lang or "").startswith("en")


_SYSTEM_ZH = (
    "你是一位温暖、有经验的职业引路人——像一个真心希望对方成功的学长，不是面试官或教官。"
    "温和、体贴、鼓励，绝不用『最要命』『硬骨头』这类逼人的词。\n\n"
    "【输出格式——最重要】像 Claude 那样有阅读节奏，绝不要写成一大坨：\n"
    "- body 里每段只有 1-2 句话，段与段之间空一行；\n"
    "- 用户第一眼就能扫读，而不是面对一堵墙。\n\n"
    "【body 的叙述节奏，照这个走】\n"
    "1. 先一句肯定他简历里的具体强项（点名，如 Prompt、SSE）；\n"
    "2. 一句『你离目标已经很近了，就绪度大概 X%』；\n"
    "3. 点破：真正要补的就一两件——不是 Prompt、不是 Agent，而是 ⟪那 1-2 个真缺口⟫；\n"
    "4. 一句『为什么是这个』（已具备的前置 / 它解锁什么 / 市场要它）；\n"
    "5. 一句**具体到能动手**的建议（例：先做一个带 Evaluation 的 RAG）；\n"
    "6. 结尾一句诚实声明（措辞可改，意思别丢）：不保证你拿到 offer，没人能保证；但这些判断是对照真实招聘要求老实算的，不是挑你爱听的说。\n\n"
    "【headline】另给一句『可截图发朋友圈』的扎心判断，20-35 字，点破他最大的特点。"
    "例：『你最大的优势不是 Prompt，而是工程化——AI 不会替代它，会放大它。』\n\n"
    "【铁律】只用我给你的事实，绝不编造数字或技能；诊断不承诺；不奉承；对 AI 能帮写的技能要点明『会用≠面试能自圆其说』。\n\n"
    '只返回 JSON：{"headline": "一句可截图的判断", "body": "按上面节奏的短段落，段间用空行分隔"}'
)

_SYSTEM_EN = (
    "You are a warm, experienced mentor — a caring senior who wants this person to succeed, "
    "never an interviewer or drill sergeant. Gentle, encouraging; never harsh or lecturing.\n\n"
    "[FORMAT — most important] Have reading rhythm like Claude; never a wall of text:\n"
    "- each paragraph in body is 1-2 sentences, with a blank line between paragraphs.\n\n"
    "[body rhythm] 1) name 1-2 concrete strengths from their resume; 2) 'you're closer than you think, "
    "readiness ~X%'; 3) the real gap is just one or two things — not Prompt, not Agent, but ⟪the real gaps⟫; "
    "4) why this one (prereqs they have / what it unlocks / market demand); 5) one concrete, actionable suggestion "
    "(e.g. build a RAG with evaluation); 6) honest closer: can't promise an offer, no one can, but these are "
    "computed honestly against real job requirements, not flattery.\n\n"
    "[headline] also give one screenshot-worthy, striking judgment (~10-15 words) naming their biggest trait.\n\n"
    "[RULES] only use the facts I give; diagnose, don't promise; no flattery; for AI-codable skills note "
    "'using it ≠ defending it in an interview'.\n\n"
    'Return ONLY JSON: {"headline": "one screenshot-worthy line", "body": "short paragraphs separated by blank lines"}'
)

SYSTEMS = {"zh": _SYSTEM_ZH, "en": _SYSTEM_EN}

_LABELS = {
    "zh": {"role": "目标岗位", "ready": "就绪度", "strengths": "优势(AI相关在前)",
           "core": "真护城河缺口(AI替不了)", "defend": "AI能实现但面试要讲清",
           "first": "最先补一步", "why": "为什么是这一步", "redline": "红线"},
    "en": {"role": "Target role", "ready": "Readiness", "strengths": "Strengths (AI-relevant first)",
           "core": "Real moat gaps (AI can't do for you)", "defend": "AI can implement, but you must defend it",
           "first": "Best first step", "why": "Why this step", "redline": "Red line"},
}
_REDLINE = {
    "zh": "不承诺 offer；强调是对照真实 JD 诚实算出的差距，不是顺着用户说好话",
    "en": "Never promise an offer; stress these gaps are honestly computed against real JDs, not flattery",
}


@lru_cache(maxsize=1)
def _jd() -> dict:
    if not _JD_FILE.exists():
        return {"skills": {}}
    return json.loads(_JD_FILE.read_text(encoding="utf-8"))


def _jd_pct(skill_id: str) -> int:
    rec = _jd().get("skills", {}).get(skill_id)
    return round(100 * rec.get("frequency", 0.0)) if rec else 0


def _level_of(result, skill_id: str) -> int:
    for p in result.profile:
        if p.skill_id == skill_id:
            return p.level
    return 0


def build_facts(result, *, role_id: str, orientation: str, lang: str = "zh") -> dict:
    """从 decision 引擎的 ResultResponse 拼出 narrate 需要的结构化事实（语言感知）。"""
    zh = _zh(lang)
    lab = _LABELS["zh" if zh else "en"]
    reqs = {r.skill_id: r for r in C.requirements_for_role(role_id, orientation)}

    def fclass(sid: str) -> str:
        r = reqs.get(sid)
        return (r.fulfillment_class or "core_learn") if r else "core_learn"

    strengths = sorted(result.strengths, key=lambda s: _AI_CAT_FIRST.get(s.category, 1))
    strength_names = [s.skill_name for s in strengths][:5]

    core, ai_accel = [], []
    for g in result.gaps:
        if g.type != "required":
            continue
        cls = fclass(g.skill_id)
        if cls == "core_learn":
            core.append(g.skill_name)
        elif cls == "ai_accelerated":
            ai_accel.append(g.skill_id)

    top = result.next_steps[0] if result.next_steps else None
    why, ai_defend = [], []
    if top:
        deps_have = [C.skill_name(d, lang) for d in C.dependencies_of(top.skill_id)
                     if d in reqs and _level_of(result, d) >= reqs[d].min_level]
        if deps_have:
            why.append(f"已具备前置：{'、'.join(deps_have)}，是补全不是从零" if zh
                       else f"You already have its prerequisites ({', '.join(deps_have)})")
        unblock_core = [C.skill_name(u, lang) for u in (getattr(top, "unblocks", None) or [])
                        if fclass(u) == "core_learn"]
        if unblock_core:
            why.append(f"解锁下游护城河：{'、'.join(unblock_core)}" if zh
                       else f"It unlocks your real moat: {', '.join(unblock_core)}")
        jd = _jd_pct(top.skill_id)
        if jd >= 20:
            why.append(f"{jd}% 的真实 AI 岗位 JD 点名要它" if zh
                       else f"{jd}% of real AI job posts ask for it")

    pick = top.skill_id if (top and fclass(top.skill_id) == "ai_accelerated") else (ai_accel[0] if ai_accel else None)
    if pick:
        sk = C.SKILLS_BY_ID[pick]
        usage = sk.ai_usage if zh else (sk.ai_usage_en or sk.ai_usage)
        name = C.skill_name(pick, lang)
        if usage:
            ai_defend = [f"{name}：面试要你讲清 {'；'.join(usage[:2])}" if zh
                         else f"{name}: in interviews you must explain {'; '.join(usage[:2])}"]

    return {
        lab["role"]: C.role_label(lang),
        lab["ready"]: f"{round(result.readiness)}%",
        lab["strengths"]: strength_names,
        lab["core"]: core,
        lab["defend"]: ai_defend,
        lab["first"]: top.skill_name if top else None,
        lab["why"]: why,
        lab["redline"]: _REDLINE["zh" if zh else "en"],
    }


def _voice_backend() -> tuple[str, str, str, str] | None:
    """Pick the LLM backend for the expression layer.

    Prefers 0G Compute (decentralized, verifiable inference) when configured;
    falls back to DeepSeek; returns None when neither is set (→ template).
    Returns (api_key, base_url, model, provider_label).
    """
    if settings.zg_api_key:
        return (settings.zg_api_key, settings.zg_base_url, settings.zg_model, "0G Compute")
    if settings.deepseek_api_key:
        return (settings.deepseek_api_key, settings.deepseek_base_url, settings.deepseek_model, "DeepSeek")
    return None


def narrate(facts: dict, lang: str = "zh") -> dict:
    """把 facts 说成有节奏的人话 + 一句金句。

    表达层优先跑在 **0G Compute**（去中心化、可验证推理）——决策仍由确定性引擎
    产出，这里只负责措辞。0G 返回的 request id 让每次生成可链上验证（TEE 背书）。
    失败或未配置时回退确定性模板。返回 {headline, body, verify?}。
    """
    zh = _zh(lang)
    backend = _voice_backend()
    if backend is None:
        return _template(facts, lang)
    api_key, base_url, model, provider = backend
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, base_url=base_url)
        user = ("请基于以下事实，产出 {headline, body}：\n" if zh
                else "Based on these facts, produce {headline, body}:\n") + json.dumps(facts, ensure_ascii=False, indent=1)
        messages = [{"role": "system", "content": SYSTEMS["zh" if zh else "en"]},
                    {"role": "user", "content": user}]
        provider_options = (
            {"extra_body": {"verify_tee": True}} if provider == "0G Compute" else {}
        )
        # Not every provider (e.g. 0G's own models) supports response_format.
        # Try the strict JSON mode first; on ANY error, retry without it and
        # extract the JSON object from the text — so 0G still returns a verifiable
        # response instead of silently falling back to the template.
        try:
            resp = client.chat.completions.create(
                model=model, temperature=0.6, max_tokens=700,
                response_format={"type": "json_object"}, messages=messages,
                **provider_options,
            )
        except Exception:
            resp = client.chat.completions.create(
                model=model, temperature=0.6, max_tokens=700, messages=messages,
                **provider_options,
            )
        raw = _THINK_RE.sub("", resp.choices[0].message.content or "").strip()
        m = re.search(r"\{[\s\S]*\}", raw)  # tolerate prose/markdown around the JSON
        data = json.loads(m.group(0) if m else raw)
        head = (data.get("headline") or "").strip()
        body = (data.get("body") or "").strip()
        if not body:
            return _template(facts, lang)
        out = {"headline": head, "body": body}
        # Only surface the Router's x_0g_trace receipt. `resp.id` is merely the
        # OpenAI-compatible completion id and is not a verification receipt.
        if provider == "0G Compute":
            receipt = _zg_receipt(resp, model)
            if receipt:
                out["verify"] = receipt
        return out
    except Exception:
        return _template(facts, lang)


def _template(facts: dict, lang: str = "zh") -> dict:
    """确定性兜底：没有 LLM 也给『有节奏 + 一句金句』的输出。"""
    zh = _zh(lang)
    lab = _LABELS["zh" if zh else "en"]
    strengths = facts.get(lab["strengths"]) or []
    first = facts.get(lab["first"])
    why = facts.get(lab["why"]) or []
    defend = facts.get(lab["defend"]) or []
    role = facts.get(lab["role"], "")
    ready = facts.get(lab["ready"], "")
    core = facts.get(lab["core"]) or []
    if zh:
        head = (f"你最大的底气是工程化，不是会用 AI——这一点 AI 不会替代，只会放大。"
                if strengths else "你不是从零开始，你比想象中更近。")
        paras = []
        if strengths:
            paras.append(f"先说句实在的，你底子不差——{'、'.join(strengths[:3])}这些都拿得出手。")
        paras.append(f"其实你离「{role}」没那么远，就绪度大概 {ready}。")
        if core:
            paras.append(f"真正要补的就那么几件，不是 Prompt、不是 Agent，而是：{'、'.join(core[:2])}。")
        if first:
            paras.append((f"先从「{first}」下手" + ("——" + "；".join(why) if why else "") + "。"))
        if defend:
            paras.append("一个提醒：" + defend[0] + "——AI 能帮你写，但面试会追问背后的取舍。")
        paras.append("最后一句心里话：我不敢保证你照这么走就能拿 offer，没人能保证；但这些判断都是对照真实招聘要求老实算的，不是挑你爱听的说。")
        return {"headline": head, "body": "\n\n".join(paras)}
    head = "Your real edge is engineering, not prompting — AI won't replace it, it'll amplify it." if strengths else "You're closer than you think."
    paras = []
    if strengths:
        paras.append(f"Honestly, you've got a solid base — {', '.join(strengths[:3])} are already there.")
    paras.append(f"You're closer to {role} than you think — readiness ~{ready}.")
    if core:
        paras.append(f"The real gap is just a couple of things — not Prompt, not Agent, but: {', '.join(core[:2])}.")
    if first:
        paras.append(f"Start with {first}" + (" — " + "; ".join(why) if why else "") + ".")
    if defend:
        paras.append("One heads-up: " + defend[0] + " — AI can write it, but interviewers probe the trade-offs.")
    paras.append("Straight up: I can't promise this lands you an offer — no one can; but these are computed honestly against real job requirements, not flattery.")
    return {"headline": head, "body": "\n\n".join(paras)}


def voice_for_result(result, *, role_id: str, orientation: str, lang: str = "zh") -> dict:
    """对外入口：ResultResponse → {headline, body}。"""
    return narrate(build_facts(result, role_id=role_id, orientation=orientation, lang=lang), lang)
