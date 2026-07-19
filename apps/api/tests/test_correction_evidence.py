from app.domain import correction_evidence
from app.domain.correction_evidence import calibrate


def evidence(application="none", ownership="none", system_scope="none"):
    return {
        "dimensions": {
            "application": {"value": application, "quote": "grounded"},
            "ownership": {"value": ownership, "quote": "grounded"},
            "delivery": {"value": "none", "quote": ""},
            "problem_solving": {"value": "none", "quote": ""},
            "system_scope": {"value": system_scope, "quote": "grounded"},
        }
    }


def test_learning_only_is_l1():
    assert calibrate(evidence(application="learning")) == 1


def test_personal_project_is_l2():
    assert calibrate(evidence(application="personal_project", ownership="independent")) == 2


def test_independent_responsibility_in_real_project_is_l3():
    extracted = evidence(application="real_project", ownership="independent")
    assert calibrate(extracted) == 3


def test_real_project_participation_without_ownership_is_l2():
    assert calibrate(evidence(application="real_project", ownership="participated")) == 2


def test_system_leadership_in_real_project_is_l4():
    extracted = evidence(
        application="production", ownership="led", system_scope="system"
    )
    assert calibrate(extracted) == 4


def test_system_claim_without_leadership_does_not_reach_l4():
    extracted = evidence(
        application="real_project", ownership="independent", system_scope="system"
    )
    assert calibrate(extracted) == 3


def test_extract_fails_over_to_second_llm_backend(monkeypatch):
    backends = [
        ("zg-key", "https://0g.invalid", "zg-model", "0G Compute"),
        ("ds-key", "https://deepseek.invalid", "ds-model", "DeepSeek"),
    ]
    monkeypatch.setattr(correction_evidence, "_backends", lambda: backends)

    def fake_extract(text, *, skill_name, lang, backend):
        if backend[3] == "0G Compute":
            raise ValueError("empty evidence response (finish_reason=length)")
        return evidence(application="real_project", ownership="independent"), backend[3]

    monkeypatch.setattr(correction_evidence, "_extract_with_backend", fake_extract)
    data, provider = correction_evidence.extract(
        "我在真实项目中负责API设计",
        skill_name="API设计",
        lang="zh",
    )
    assert provider == "DeepSeek"
    assert calibrate(data) == 3


def test_all_llm_backends_failing_does_not_silently_downgrade(monkeypatch):
    monkeypatch.setattr(
        correction_evidence,
        "_backends",
        lambda: [("key", "https://invalid", "model", "0G Compute")],
    )
    monkeypatch.setattr(
        correction_evidence,
        "_extract_with_backend",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("offline")),
    )
    try:
        correction_evidence.extract("真实经历足够长", skill_name="API设计", lang="zh")
    except ValueError as error:
        assert "暂时不可用" in str(error)
    else:
        raise AssertionError("LLM failure must not become an L1 assessment")
