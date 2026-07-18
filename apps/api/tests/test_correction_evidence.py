from app.domain.correction_evidence import calibrate


def test_demo_evidence_caps_at_l2():
    text = "我在个人Demo里实现了流式输出展示。"
    extracted = {"actions": ["实现流式输出展示"], "outcome": "完成Demo"}
    assert calibrate(text, extracted) == 2


def test_independent_delivery_with_problem_reaches_l3():
    text = "我在Zeno里独立接入0G Router，处理超时重试，最终完成可运行Demo。"
    extracted = {
        "actions": ["接入0G Router", "处理超时重试"],
        "outcome": "完成可运行Demo",
        "problem_handled": True,
    }
    assert calibrate(text, extracted) == 3


def test_llm_suggestion_cannot_raise_rule_level():
    text = "我看过Prompt设计教程。"
    extracted = {
        "actions": [],
        "outcome": "",
        "problem_handled": False,
        "architecture_or_governance": True,
        "suggested_level": 4,
    }
    assert calibrate(text, extracted) == 1


def test_architecture_requires_delivery_chain_before_l4():
    text = "我主导架构和技术取舍。"
    extracted = {"actions": ["主导架构"], "architecture_or_governance": True}
    assert calibrate(text, extracted) < 4
