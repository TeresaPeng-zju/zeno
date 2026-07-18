"""表达层：把确定性引擎算出的测评，说成『一位温暖学长开口』——有阅读节奏 + 一句可截图金句。

设计延续 Zeno 的 decision/expression 分工：
  - 事实（就绪度 / 优势 / 缺口分类 / 最该先补的一步 / JD 需求）全部来自 decision 引擎；
  - 这里只负责『讲人话』，由 SYSTEM 锁死信任底线（诊断不承诺、不奉承、会用≠自圆其说）；
  - 没有 DeepSeek key 或调用失败时，回退确定性模板，永远有输出。
  - 输出结构化诊断；body 仅作为旧客户端的兼容字段。
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
    "你是Zeno的职业诊断表达层。确定性引擎已经完成判断，你只负责把事实讲清楚。"
    "语气温暖、克制、具体，不奉承，不制造焦虑。\n\n"
    "只返回JSON，字段必须完整：headline、summary、primary_gap、next_action、honest_note。\n"
    "- headline：14-24个汉字，不加引号，不写百分比，不用破折号；\n"
    "- summary：用1-2句话说明已有基础和已确认技能覆盖下限；必须说明未采集能力不计分，它不是准确率或拿到offer的概率；\n"
    "- primary_gap：必须讲事实中的『最先补一步』，并用日常工作语言解释它解决什么问题；\n"
    "- next_action：只给一个可在近期完成、能被验收的动作，必须与事实中的最先补一步有关；\n"
    "- honest_note：一句诚实边界，说明判断来自真实岗位要求，但不保证求职结果。\n\n"
    "全文180-260字。不要写Markdown，不要使用『不是Prompt、不是Agent』这种对比句，"
    "不要声称用户『已经很接近目标』。每句话最多出现一个AI术语，术语首次出现时用通俗语言解释。"
    "只使用提供的事实，不补充未经给出的经历、数字或技能。"
)

_SYSTEM_EN = (
    "You are Zeno's expression layer. A deterministic engine has already made the decisions; "
    "your job is only to explain its facts clearly, warmly, and without hype.\n\n"
    "Return JSON only, with all fields: headline, summary, primary_gap, next_action, honest_note.\n"
    "headline: 6-12 words, no percentage or em dash. summary: 1-2 sentences about existing foundations "
    "and the confirmed skill-coverage lower bound; state that unassessed skills receive no credit and that this is neither accuracy nor the probability of receiving an offer. primary_gap: explain "
    "the exact Best first step in plain work language. next_action: one near-term, verifiable action tied to that same step. "
    "honest_note: one sentence stating the evidence boundary and no employment guarantee.\n\n"
    "Use 100-150 words total. No Markdown. Do not claim the user is already close to the target. "
    "Use at most one AI term per sentence and explain it plainly on first use. Use only supplied facts."
)

SYSTEMS = {"zh": _SYSTEM_ZH, "en": _SYSTEM_EN}

_LABELS = {
    "zh": {"role": "目标岗位", "ready": "已确认技能覆盖下限", "evidence": "已采集必备能力依据", "strengths": "优势(AI相关在前)",
           "core": "真护城河缺口(AI替不了)", "defend": "AI能实现但面试要讲清",
           "first": "最先补一步", "why": "为什么是这一步", "redline": "红线"},
    "en": {"role": "Target role", "ready": "Confirmed skill-coverage lower bound", "evidence": "Required-skill evidence collected", "strengths": "Strengths (AI-relevant first)",
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
        lab["evidence"]: f"{result.assessed_required_count}/{result.required_skill_count}",
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
        user = ("请基于以下事实生成结构化诊断：\n" if zh
                else "Produce the structured diagnosis from these facts:\n") + json.dumps(facts, ensure_ascii=False, indent=1)
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
        keys = ("summary", "primary_gap", "next_action", "honest_note")
        head = str(data.get("headline") or "").strip()
        sections = {key: str(data.get(key) or "").strip() for key in keys}
        if not head or any(not value for value in sections.values()):
            return _template(facts, lang)
        out = {"headline": head, "body": "\n\n".join(sections.values()), "sections": sections}
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
    """确定性兜底：没有LLM也返回与生成结果相同的结构。"""
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
        head = "把已有工程能力变成可验证的AI作品" if strengths else "先找到最值得补上的一项能力"
        summary = ((f"你已经具备{'、'.join(strengths[:3])}等可迁移基础。" if strengths else "这是一份初步能力画像。")
                   + f"目前对「{role}」已确认的技能覆盖下限为{ready}；尚未采集的能力不计分，它不是诊断准确率或拿到offer的概率。")
        gap = first or (core[0] if core else "目标岗位要求")
        primary_gap = f"当前优先差距是「{gap}」。先理解它在真实工作中解决的问题，再补实现方法。"
        detail = "；".join(why[:2])
        next_action = (f"下一步先完成一个能展示「{first}」的小项目，并用可运行结果或说明文档验收。" if first
                       else "下一步选一个核心差距完成小项目，并用可运行结果验收。")
        if detail:
            next_action += f"排序依据是：{detail}。"
        honest_note = "这份判断依据真实岗位要求和当前回答计算，不保证求职结果，也不会替代面试验证。"
    else:
        head = "Turn engineering foundations into verifiable AI work" if strengths else "Start with the highest-value skill gap"
        summary = ((f"You already have transferable foundations in {', '.join(strengths[:3])}. " if strengths else "This is an initial skill profile. ")
                   + f"Your confirmed skill-coverage lower bound for {role} is {ready}. Unassessed skills receive no credit; this is neither diagnostic accuracy nor the probability of receiving an offer.")
        gap = first or (core[0] if core else "the target role requirements")
        primary_gap = f"Your priority gap is {gap}. First understand the work problem it solves, then learn the implementation."
        next_action = (f"Build one small, runnable project that demonstrates {first}, and use its output or documentation as the acceptance check."
                       if first else "Build a small project for one core gap and use a runnable result as the acceptance check.")
        honest_note = "This diagnosis is computed from real job requirements and your answers; it cannot guarantee an employment outcome."
    sections = {"summary": summary, "primary_gap": primary_gap, "next_action": next_action, "honest_note": honest_note}
    return {"headline": head, "body": "\n\n".join(sections.values()), "sections": sections}


def voice_for_result(result, *, role_id: str, orientation: str, lang: str = "zh") -> dict:
    """对外入口：ResultResponse → {headline, body}。"""
    return narrate(build_facts(result, role_id=role_id, orientation=orientation, lang=lang), lang)
