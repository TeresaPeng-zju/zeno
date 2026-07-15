from app.domain.assessment_voice import _zg_receipt


class FakeResponse:
    id = "chatcmpl-not-a-verification-receipt"

    def __init__(self, trace=None):
        self.model_extra = {"x_0g_trace": trace} if trace is not None else {}

    def model_dump(self):
        return {"id": self.id, **self.model_extra}


def test_extracts_verified_0g_trace():
    receipt = _zg_receipt(
        FakeResponse(
            {
                "request_id": "0852f405-6c56-40c2-a800-e6fd70785065",
                "provider": "0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C",
                "tee_verified": True,
            }
        ),
        "zai-org/GLM-5-FP8",
    )

    assert receipt == {
        "provider": "0G Compute",
        "model": "zai-org/GLM-5-FP8",
        "request_id": "0852f405-6c56-40c2-a800-e6fd70785065",
        "provider_address": "0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C",
        "tee_verified": True,
    }


def test_never_uses_openai_completion_id_as_receipt():
    assert _zg_receipt(FakeResponse(), "any-model") is None

