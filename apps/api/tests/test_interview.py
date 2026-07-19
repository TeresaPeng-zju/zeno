from app.domain import interview


def dimensions(application="real_project", ownership="independent", quote="我在腾讯负责API设计"):
    return {
        "application": {"value": application, "quote": quote},
        "ownership": {"value": ownership, "quote": quote},
        "delivery": {"value": "none", "quote": ""},
        "problem_solving": {"value": "none", "quote": ""},
        "system_scope": {"value": "component", "quote": quote},
    }


def test_interview_level_is_computed_from_grounded_dimensions():
    text = "我在腾讯负责API设计"
    grounded = interview._ground_skill({
        "skill_id": "eng.api_design",
        "evidence": text,
        "dimensions": dimensions(),
        "level": 1,  # ignored even if a model tries to return it
    }, text, "zh")
    assert grounded is not None
    assert grounded["level"] == 3
    assert grounded["evidence"] == text


def test_interview_rejects_non_verbatim_evidence():
    text = "我参与了接口联调"
    grounded = interview._ground_skill({
        "skill_id": "eng.api_design",
        "evidence": "我独立负责API设计",
        "dimensions": dimensions(quote="我独立负责API设计"),
    }, text, "zh")
    assert grounded is None


def test_unsupported_dimension_is_removed_before_calibration():
    text = "我做过一个个人接口Demo"
    raw = dimensions(application="production", ownership="led", quote="不存在的原文")
    grounded = interview._ground_skill({
        "skill_id": "eng.api_design",
        "evidence": text,
        "dimensions": raw,
    }, text, "zh")
    assert grounded is not None
    assert grounded["level"] == 1
