"""Message catalog for the expression layer (English default, Chinese switchable).

Only *display* strings live here — labels, prose templates, audit sentences.
The decision engine itself stays language-neutral (IDs / scores / ordering are
identical regardless of language), so the offline eval baseline never forks on
a language change. Keys are flat dotted strings; `{placeholders}` are filled by
`app.i18n.t(lang, key, **kwargs)`.
"""

from typing import Dict

# Per-language flat key -> template. English is the source of truth / fallback.
MESSAGES: Dict[str, Dict[str, str]] = {
    "en": {
        # Competency categories (skill catalog groups)
        "category.foundation.label": "Engineering foundation",
        "category.foundation.hint": "Transferable engineering skills",
        "category.data.label": "Data & retrieval",
        "category.data.hint": "The bedrock of RAG",
        "category.llm.label": "LLM applications",
        "category.llm.hint": "Turn the model into product capability",
        "category.eval.label": "Evaluation & iteration",
        "category.eval.hint": "The most overlooked differentiator",
        # Proficiency options
        "option.none": "Never touched it",
        "option.tutorial": "Read docs / followed a tutorial",
        "option.demo": "Built a small personal feature / demo",
        "option.shipped": "Shipped & debugged it in a real project",
        "option.expert": "Designed / optimized such systems, can govern them",
        # Question templates ({skill} = localized skill name)
        "question.text": "What's your hands-on experience with {skill}?",
        "question.help": (
            "This question assesses your level on {skill}, used to gauge your gap "
            "against the target role (AI Engineer, applied). Just pick what matches "
            "your real experience."
        ),
        # Gap / requirement types
        "type.required": "required",
        "type.bonus": "bonus",
        # Name list separator
        "join.sep": ", ",
        # Strengths (why you)
        "strength.high": (
            "You can already deliver this in real scenarios (L{level}) — a strong "
            "springboard into AI engineering."
        ),
        "strength.transfer": (
            "Your background transfers well here ({pct}%); currently "
            "L{level}, a little practice will amplify the edge."
        ),
        # Next-step action prescription
        "blueprint.title": "Raise {skill} from L{cur} to L{target}",
        "why.weight": "Role weight {weight} ({type}); current gap {gap} level(s). ",
        "why.unblocks": (
            "It's a prerequisite for {names}; learning it first unlocks the path ahead. "
        ),
        "why.blocked": "Note: clear its dependencies {names} first. ",
        "why.transfer": (
            "Highly transferable from your background ({pct}%), quick to pick up. "
        ),
        "ranking.jd": (
            "Across {total} multi-source job records, the weighted demand signal "
            "for this skill is about {pct}%."
        ),
        "ranking.unblocks": (
            "It is a prerequisite for {count} skills still on your path, including {names}."
        ),
        "ranking.migration": (
            "Its migration coefficient is {pct}%; with your current L{current} → L{target} gap, "
            "it offers strong learning leverage."
        ),
        # Pacing summaries
        "pacing.empty": "No actions to schedule yet.",
        "pacing.parallel": (
            "At ~{hours}h/week you can run {parallelism} tracks in parallel, "
            "finishing these {count} actions in ~{weeks} weeks."
        ),
        "pacing.serial": (
            "At ~{hours}h/week, working sequentially, you'll finish these {count} "
            "actions in ~{weeks} weeks."
        ),
        # Explain — dependency reason
        "explain.dep.blocked": (
            "Its prerequisites {names} aren't met yet, so it's placed after them "
            "(a topological constraint, not scoring)."
        ),
        "explain.dep.clear": (
            "No unmet prerequisites; its position is determined purely by scoring."
        ),
        # Explain — score breakdown
        "explain.score.gap": "Gap term 0.5×{a} = {b}",
        "explain.score.dep": "Dependency urgency 0.3×{a} = {b}",
        "explain.score.learn": "Learnability 0.2×{a} = {b}",
        "explain.score.blocked": (
            "Blocked by prerequisites, overall ×{p} (down-weighted so prerequisites "
            "surface first)"
        ),
        # Explain — diff attribution
        "explain.diff.identical": (
            "Identical input fingerprint → bit-identical plan (determinism guarantee: "
            "same input always yields the same output)."
        ),
        "explain.diff.no_order": (
            "Input changed, but the displayed top-N order didn't (the change happened "
            "deeper down)."
        ),
        "explain.diff.drivers": (
            "The order change is driven entirely by input changes: {drivers}. No input "
            "change means no plan change."
        ),
        "explain.diff.no_visible": "(no visible input change)",
        # Freshness reason ({label} ({when}))
        "freshness.fresh": "Link valid",
        "freshness.stale": "May be outdated",
        "freshness.unverified": "Pending check",
        "freshness.dead": "Dead link",
        "freshness.not_verified": "not verified",
        "freshness.format": "{label} ({when})",
        # Result note + resource retrieval query
        "note.resource": "This roadmap is personalized based on your skill profile.",
        "query.template": "{name} learning practice L{level}",
    },
    "zh": {
        # Competency categories
        "category.foundation.label": "工程地基",
        "category.foundation.hint": "可从现有背景迁移的工程能力",
        "category.data.label": "数据与检索",
        "category.data.hint": "RAG 的地基",
        "category.llm.label": "LLM 应用",
        "category.llm.hint": "把模型变成产品能力",
        "category.eval.label": "评估与迭代",
        "category.eval.hint": "最容易被忽略的差异点",
        # Proficiency options
        "option.none": "完全没接触过",
        "option.tutorial": "看过资料 / 跟教程跑通过",
        "option.demo": "做过个人小功能 / demo",
        "option.shipped": "在真实项目里交付并排障过",
        "option.expert": "设计 / 优化过相关系统，能治理",
        # Question templates
        "question.text": "你在「{skill}」方面的实际经验是？",
        "question.help": (
            "这道题评估你在「{skill}」上的水平，"
            "用于判断你与目标岗位（AI Engineer 应用向）的能力差距。按真实经历选择即可。"
        ),
        # Gap / requirement types
        "type.required": "必要",
        "type.bonus": "加分",
        # Name list separator
        "join.sep": "、",
        # Strengths
        "strength.high": "你已能在真实场景交付（L{level}），可作为切入 AI 工程的跳板。",
        "strength.transfer": (
            "你的背景对该能力迁移度高（{pct}%），当前 L{level}，稍加练习即可放大优势。"
        ),
        # Next-step action prescription
        "blueprint.title": "把「{skill}」从 L{cur} 提升到 L{target}",
        "why.weight": "岗位权重 {weight}（{type}），当前差距 {gap} 级。",
        "why.unblocks": "它是「{names}」的前置依赖，先学能解锁后续路径。",
        "why.blocked": "注意：建议先补齐其依赖「{names}」。",
        "why.transfer": "你的背景迁移度高（{pct}%），上手快。",
        "ranking.jd": "基于{total}条多来源岗位记录的加权统计，这项能力的需求信号约为{pct}%。",
        "ranking.unblocks": "它是当前路线中{count}项后续能力的前置节点，包括「{names}」。",
        "ranking.migration": "该能力的迁移系数为{pct}%；结合你当前L{current}到目标L{target}的差距，学习杠杆较高。",
        # Pacing summaries
        "pacing.empty": "暂无需要排期的动作。",
        "pacing.parallel": (
            "每周投入约 {hours} 小时，可并行推进 {parallelism} 条线，"
            "预计约 {weeks} 周完成这 {count} 个动作。"
        ),
        "pacing.serial": (
            "每周投入约 {hours} 小时，建议串行推进，"
            "预计约 {weeks} 周依次完成这 {count} 个动作。"
        ),
        # Explain — dependency reason
        "explain.dep.blocked": (
            "它的前置「{names}」尚未补齐，因此被排在这些前置之后（拓扑约束，非打分）。"
        ),
        "explain.dep.clear": "无未补齐前置，位置完全由打分决定。",
        # Explain — score breakdown
        "explain.score.gap": "缺口项 0.5×{a} = {b}",
        "explain.score.dep": "依赖紧迫 0.3×{a} = {b}",
        "explain.score.learn": "可学性 0.2×{a} = {b}",
        "explain.score.blocked": "被前置阻塞，整体×{p}（降权让前置先出）",
        # Explain — diff attribution
        "explain.diff.identical": (
            "输入指纹一致 → 计划逐位相同（确定性保证：同输入必然同输出）。"
        ),
        "explain.diff.no_order": "输入变了，但展示层 top-N 顺序未变（变化发生在更深处）。",
        "explain.diff.drivers": (
            "顺序变化完全由输入变化驱动：{drivers}。无输入变化则计划不会变。"
        ),
        "explain.diff.no_visible": "（无可见输入变化）",
        # Freshness reason
        "freshness.fresh": "链接有效",
        "freshness.stale": "可能过时",
        "freshness.unverified": "待校验",
        "freshness.dead": "已失效",
        "freshness.not_verified": "未校验",
        "freshness.format": "{label}（{when}）",
        # Result note + resource retrieval query
        "note.resource": "本路线根据你的技能画像个性化生成。",
        "query.template": "{name} 学习 实践 L{level}",
    },
}
