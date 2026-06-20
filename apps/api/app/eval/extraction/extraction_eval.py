"""Extraction eval — put a ruler under the keyword labeling function (LF).

The skill-evidence ledger is only as trustworthy as the LF that builds it
(`SKILL_KEYWORDS` in scripts/build_jd_evidence.py). This module measures that LF
against a hand-labeled gold set, so "the market demands skill X" stops being a
faith claim and becomes a number with a known precision/recall.

Design (consistent with Zeno's discipline):
  * The metric core is PURE & deterministic: it takes (predicted_set, gold_set)
    per doc and computes set-based precision/recall/F1. No LLM, no network.
  * Per-skill breakdown names the failure mode directly:
      - low precision / high FP  -> the keywords for that skill OVER-fire (注水)
      - low recall   / high FN  -> the keywords MISS real mentions (漏召回)
    That is the actionable output: which row of the keyword table to fix.

Ground truth here is human-labeled JD docs (gold/extraction_gold.jsonl). It is a
small, reproducible regression ruler for the LF — NOT a benchmark. Keep it honest.

Run:
    cd apps/api && python -m app.eval.extraction.extraction_eval
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_GOLD_FILE = Path(__file__).resolve().parents[2] / "data" / "gold" / "extraction_gold.jsonl"


# --------------------------------------------------------------------------- #
# The LF under test (loaded from the single source of truth, graph skills only)
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=1)
def _graph_keyword_table() -> dict[str, tuple[str, ...]]:
    """The keyword LF restricted to real graph skills (umbrella buckets dropped)."""
    from scripts.build_jd_evidence import SKILL_KEYWORDS, _NON_GRAPH

    return {
        sid: tuple(kws)
        for sid, kws in SKILL_KEYWORDS.items()
        if sid not in _NON_GRAPH
    }


def _norm(text: str) -> str:
    """Mirror scripts.build_jd_evidence._norm so prediction is faithful to the LF."""
    return re.sub(r"\s+", " ", str(text)).lower()


def predict_skills(
    text: str, keyword_table: dict[str, tuple[str, ...]] | None = None
) -> set[str]:
    """Run the keyword LF over one doc's text -> set of predicted graph skills."""
    table = keyword_table if keyword_table is not None else _graph_keyword_table()
    doc = _norm(text)
    return {sid for sid, kws in table.items() if any(kw in doc for kw in kws)}


# --------------------------------------------------------------------------- #
# Pure metric core
# --------------------------------------------------------------------------- #
def _prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return round(precision, 4), round(recall, 4), round(f1, 4)


@dataclass(frozen=True)
class SkillScore:
    skill_id: str
    tp: int
    fp: int
    fn: int

    @property
    def support(self) -> int:  # how many gold docs truly have this skill
        return self.tp + self.fn

    @property
    def prf(self) -> tuple[float, float, float]:
        return _prf(self.tp, self.fp, self.fn)


def evaluate(
    gold_records: list[dict], keyword_table: dict[str, tuple[str, ...]] | None = None
) -> dict:
    """Score the LF over labeled docs. Pure: same input -> same report."""
    table = keyword_table if keyword_table is not None else _graph_keyword_table()
    valid_skills = set(table)

    micro_tp = micro_fp = micro_fn = 0
    per_skill_tp: dict[str, int] = {s: 0 for s in valid_skills}
    per_skill_fp: dict[str, int] = {s: 0 for s in valid_skills}
    per_skill_fn: dict[str, int] = {s: 0 for s in valid_skills}
    unknown_labels: set[str] = set()

    for rec in gold_records:
        gold = set(rec.get("skills", []))
        unknown_labels |= gold - valid_skills
        gold &= valid_skills  # only score against real graph skills
        pred = predict_skills(rec["text"], table)

        for s in pred & gold:
            micro_tp += 1
            per_skill_tp[s] += 1
        for s in pred - gold:
            micro_fp += 1
            per_skill_fp[s] += 1
        for s in gold - pred:
            micro_fn += 1
            per_skill_fn[s] += 1

    per_skill = [
        SkillScore(s, per_skill_tp[s], per_skill_fp[s], per_skill_fn[s])
        for s in sorted(valid_skills)
    ]
    macro = [s.prf for s in per_skill if (s.tp + s.fp + s.fn) > 0]
    macro_p = round(sum(p for p, _, _ in macro) / len(macro), 4) if macro else 0.0
    macro_r = round(sum(r for _, r, _ in macro) / len(macro), 4) if macro else 0.0
    macro_f = round(sum(f for _, _, f in macro) / len(macro), 4) if macro else 0.0

    return {
        "n_docs": len(gold_records),
        "micro": dict(zip(("precision", "recall", "f1"), _prf(micro_tp, micro_fp, micro_fn))),
        "micro_counts": {"tp": micro_tp, "fp": micro_fp, "fn": micro_fn},
        "macro": {"precision": macro_p, "recall": macro_r, "f1": macro_f},
        "per_skill": per_skill,
        "unknown_labels": sorted(unknown_labels),
    }


# --------------------------------------------------------------------------- #
# Gold loading + report
# --------------------------------------------------------------------------- #
def load_gold(path: Path = _GOLD_FILE) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} missing.\n"
            "Build it first:\n"
            "  python -m scripts.export_gold_template\n"
            "  cp app/data/gold/extraction_gold.template.jsonl "
            "app/data/gold/extraction_gold.jsonl\n"
            "  # then fill each line's \"skills\" (see app/data/gold/README.md)"
        )
    records = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        if "text" not in rec:
            raise ValueError(f"{path}:{i} missing 'text'")
        records.append(rec)
    return records


def _print(report: dict) -> None:
    m = report["micro"]
    c = report["micro_counts"]
    print(f"\n抽取 LF 评测  [gold = {report['n_docs']} 篇人工标注 JD]")
    print(
        f"micro  P={m['precision']:.0%}  R={m['recall']:.0%}  F1={m['f1']:.3f}"
        f"   (tp={c['tp']} fp={c['fp']} fn={c['fn']})"
    )
    mac = report["macro"]
    print(f"macro  P={mac['precision']:.0%}  R={mac['recall']:.0%}  F1={mac['f1']:.3f}\n")

    scored = [s for s in report["per_skill"] if (s.tp + s.fp + s.fn) > 0]

    over = sorted(scored, key=lambda s: (s.fp, -s.prf[0]), reverse=True)[:6]
    print("注水最重（fp 高 = 关键词命中了 JD 没真要的技能）：")
    for s in over:
        if s.fp == 0:
            continue
        p, r, f = s.prf
        print(f"  {s.skill_id:<24} fp={s.fp:<3} P={p:.0%}  support={s.support}")

    under = sorted(scored, key=lambda s: (s.fn, -s.prf[1]), reverse=True)[:6]
    print("\n漏召回最重（fn 高 = 真要这技能但关键词没抓到）：")
    for s in under:
        if s.fn == 0:
            continue
        p, r, f = s.prf
        print(f"  {s.skill_id:<24} fn={s.fn:<3} R={r:.0%}  support={s.support}")

    if report["unknown_labels"]:
        print(
            "\n⚠ gold 里出现了非图技能 id（已忽略，请改用 23 个图技能）："
            + ", ".join(report["unknown_labels"])
        )
    print(
        "\n读法：fp 高的行去收紧 SKILL_KEYWORDS 里那个技能的词；fn 高的行去补词。"
        "\n每次改完关键词重跑本评测，P/R 的 delta 就是这次改动的收益。"
    )


def main() -> None:
    _print(evaluate(load_gold()))


if __name__ == "__main__":
    main()
