from app.domain import jd_orientation


def claim(capability: str, importance: str, quote: str = "原文证据") -> dict:
    return {"capability": capability, "importance": importance, "quote": quote, "summary": ""}


def test_orientation_scoring_uses_structured_claims_not_wording():
    result = jd_orientation.score_requirements([
        claim("vector_search", "required"),
        claim("retrieval_quality", "preferred", "另一段证据"),
    ])
    assert result["orientation"] == "rag"
    assert result["matched"] is True
    assert result["needs_confirmation"] is False


def test_ambiguous_cross_orientation_role_requires_confirmation():
    result = jd_orientation.score_requirements([
        claim("vector_search", "required"),
        claim("tool_calling", "required", "另一段证据"),
    ])
    assert result["matched"] is True
    assert result["needs_confirmation"] is True


def test_context_only_claim_does_not_silently_recalibrate():
    result = jd_orientation.score_requirements([
        claim("evaluation_system", "context"),
    ])
    assert result["orientation"] == "eval"
    assert result["needs_confirmation"] is True


def test_no_specialized_claim_keeps_general_orientation():
    result = jd_orientation.score_requirements([claim("other", "required")])
    assert result["orientation"] == "base"
    assert result["matched"] is False
