"""Open-vocabulary coverage probe over the JD corpus.

Why this exists
---------------
`build_jd_evidence.py` runs a CLOSED keyword LF: it can only confirm/deny terms we
already listed in SKILL_KEYWORDS. By construction it CANNOT discover skills the graph
is missing — anything not pre-listed is silently dropped (the only escape hatch is the
`llm.core` umbrella).

This probe answers the actual question "what is the graph missing?" by going the other
way round: mine high-frequency terms from the raw JD text, SUBTRACT everything already
covered by the 23 graph skills + the umbrella, and surface the residual. Residual terms
that appear in many JDs but map to no skill_id are the evidence-backed "out-of-graph
candidates".

It is read-only and spends 0 token (regex + n-gram counting, no LLM, no network).

Run:
    cd apps/api && python -m scripts.mine_out_of_graph
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from scripts.build_jd_evidence import (
    _RAW_DIR,
    _XLSX,
    _classify_jd,
    _HARD_EXCLUDE_TITLES,
    _norm,
    discover_jd_sources,
    SKILL_KEYWORDS,
)

# A non-graph umbrella we already know about; its keywords also count as "covered".
UMBRELLA = "llm.core"
MIN_DF = 3  # a candidate must appear in >= this many JDs to be worth a human's attention

# JD boilerplate that would otherwise dominate the Chinese n-gram ranking. This is a
# noise filter for *display only* — it never touches the scoring ledger.
_CJK_STOP = {
    "经验", "能力", "负责", "相关", "优先", "熟悉", "熟练", "了解", "具备", "工作",
    "团队", "业务", "技术", "开发", "设计", "系统", "项目", "岗位", "任职", "要求",
    "职责", "公司", "我们", "以及", "能够", "良好", "解决", "问题", "以上", "学历",
    "本科", "硕士", "专业", "计算机", "包括", "进行", "实现", "支持", "提供", "使用",
    "通过", "各种", "一种", "一个", "方向", "领域", "方面", "方案", "目标", "用户",
    "产品", "功能", "需求", "实际", "持续", "快速", "高效", "深入", "丰富", "扎实",
    "沟通", "协作", "推动", "完成", "参与", "主导", "构建", "搭建", "落地", "线上",
}
_EN_STOP = {
    "and", "the", "for", "with", "you", "our", "are", "will", "have", "this", "that",
    "from", "your", "who", "etc", "into", "able", "such", "all", "can", "use", "more",
    "work", "team", "data", "ai", "ml", "we", "to", "of", "in", "on", "or", "as", "is",
    "be", "at", "an", "by", "it", "experience", "engineer", "engineering", "develop",
    "development", "skills", "ability", "knowledge", "understanding", "familiar",
}


def _covered_terms() -> list[str]:
    """Every keyword across the 23 graph skills + the umbrella — i.e. already 'in vocab'."""
    terms: list[str] = []
    for kws in SKILL_KEYWORDS.values():
        terms.extend(k.strip().lower() for k in kws)
    return [t for t in terms if t]


def _is_covered(token: str, covered: list[str]) -> bool:
    """A token is 'covered' if it overlaps any known keyword either way (substring match,
    mirroring the LF's own substring semantics)."""
    return any(token in c or c in token for c in covered)


def _load_all_engineering_docs() -> list[str]:
    """Load engineering JDs from all sources (xlsx legacy + auto-discovered JSONL)."""
    docs: list[str] = []

    # Legacy xlsx source
    if _XLSX.exists():
        import pandas as pd
        df = pd.read_excel(_XLSX)
        for _, row in df.iterrows():
            blob = " ".join(_norm(row.get(col, "")) for col in ("职位名称", "职位描述", "职位要求"))
            docs.append(blob)
        print(f"  [xlsx legacy] {len(docs)} docs")

    # Auto-discovered JSONL sources (engineering only)
    for dir_path, src in discover_jd_sources():
        jsonl_path = dir_path / "jds.jsonl"
        if not jsonl_path.exists():
            continue
        count = 0
        for line in jsonl_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            obj = json.loads(line)
            title = obj.get("title", "")
            if title.lower() in _HARD_EXCLUDE_TITLES:
                continue
            if _classify_jd(title) != "engineering":
                continue
            blob = " ".join(
                _norm(obj.get(f, "")) for f in ("title", "description", "requirements")
            )
            docs.append(blob)
            count += 1
        print(f"  [{src.source_id}] {count} engineering docs")

    return docs


def main() -> None:
    docs = _load_all_engineering_docs()
    n = len(docs)
    covered = _covered_terms()

    # --- Part 1: crack open the llm.core 0.86 umbrella -----------------------
    print(f"=== JD corpus: N={n} docs ===\n")
    print(f"--- Part 1: what drives the `{UMBRELLA}` umbrella (doc-frequency per keyword) ---")
    for kw in SKILL_KEYWORDS[UMBRELLA]:
        hits = sum(1 for d in docs if kw in d)
        print(f"  {hits/n:5.0%}  ({hits:>2}/{n})  {kw!r}")
    union = sum(1 for d in docs if any(kw in d for kw in SKILL_KEYWORDS[UMBRELLA]))
    print(f"  ----  union (any umbrella kw) = {union/n:.0%} ({union}/{n})\n")

    # --- Part 2: open-vocab residual (terms covered by NO skill) -------------
    en_df: Counter[str] = Counter()
    cjk_df: Counter[str] = Counter()
    for d in docs:
        seen_en: set[str] = set()
        for tok in re.findall(r"[a-z][a-z0-9.+#/_-]{1,}", d):
            tok = tok.strip(".-/_")
            if len(tok) < 2 or tok in _EN_STOP or _is_covered(tok, covered):
                continue
            seen_en.add(tok)
        en_df.update(seen_en)

        seen_cjk: set[str] = set()
        for run in re.findall(r"[\u4e00-\u9fff]{2,}", d):
            for size in (2, 3, 4):
                for i in range(len(run) - size + 1):
                    gram = run[i : i + size]
                    if gram in _CJK_STOP or _is_covered(gram, covered):
                        continue
                    seen_cjk.add(gram)
        cjk_df.update(seen_cjk)

    print(f"--- Part 2: top out-of-graph candidates (df >= {MIN_DF}, NOT covered by any of 23+umbrella) ---")
    print("  [EN tokens]")
    for term, c in en_df.most_common(40):
        if c < MIN_DF:
            break
        print(f"  {c/n:5.0%}  ({c:>2}/{n})  {term}")
    print("  [CJK n-grams]  (n-gram noise expected; read as 'concept clusters', not exact skills)")
    shown = 0
    for term, c in cjk_df.most_common(120):
        if c < MIN_DF:
            break
        print(f"  {c/n:5.0%}  ({c:>2}/{n})  {term}")
        shown += 1
        if shown >= 40:
            break


if __name__ == "__main__":
    main()
