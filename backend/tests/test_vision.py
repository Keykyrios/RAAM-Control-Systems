import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.vision import VisionProviderError, _normalise_response, _validate_image_signature


def test_vision_upload_refuses_to_fabricate_output_when_provider_missing(monkeypatch):
    monkeypatch.setattr(settings, "vision_provider_url", None)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/vision/analyze",
            files={"image": ("shelf.png", b"not-an-image", "image/png")},
        )
    assert response.status_code == 503
    assert "no synthetic output was generated" in response.json()["detail"]


def test_vision_provider_response_is_normalized_and_bounded():
    response = _normalise_response({
        "confidence": 0.91,
        "observed_quantity": 4,
        "occupancy_ratio": 0.65,
        "identifier_candidates": [{"sku": "DEMO-SKU", "confidence": 0.88}],
        "count_distribution": [{"count": 3, "probability": 0.25}, {"count": 4, "probability": 0.75}],
        "detections": [{"label": "part", "confidence": 0.92, "box": [10, 15, 20, 25]}],
        "model_version": "test-model-v1",
        "evidence_uri": "s3://restricted-test-bucket/observation-1",
    })
    assert response["provider_status"] == "INFERENCE_COMPLETE"
    assert response["observed_quantity"] == 4
    assert response["count_distribution"][1]["probability"] == 0.75
    assert response["detections"][0]["box"] == [10.0, 15.0, 20.0, 25.0]


def test_vision_provider_response_rejects_invalid_confidence_and_bad_boxes():
    with pytest.raises(VisionProviderError, match="invalid confidence"):
        _normalise_response({"confidence": 1.5})
    result = _normalise_response({
        "confidence": 0.8,
        "detections": [{"label": "invalid box", "confidence": 0.9, "box": [95, 20, 20, 20]}],
    })
    assert result["detections"] == []
    with pytest.raises(VisionProviderError, match="sum to approximately 1.0"):
        _normalise_response({"confidence": 0.8, "count_distribution": [{"count": 3, "probability": 0.2}]})


def test_vision_upload_checks_real_image_signature():
    with pytest.raises(VisionProviderError, match="signature"):
        _validate_image_signature(b"not png data", "image/png")
    _validate_image_signature(b"\x89PNG\r\n\x1a\nrest", "image/png")


def test_vision_provider_rejects_public_evidence_url_by_default(monkeypatch):
    monkeypatch.setattr(settings, "vision_allow_https_evidence", False)
    with pytest.raises(VisionProviderError, match="evidence_uri"):
        _normalise_response({"confidence": 0.8, "evidence_uri": "https://public.example/frame.jpg"})
    monkeypatch.setattr(settings, "vision_allow_https_evidence", True)
    result = _normalise_response({"confidence": 0.8, "evidence_uri": "https://private.example/frame.jpg"})
    assert result["evidence_uri"].startswith("https://")


def test_vision_status_exposes_limits_without_provider_url(monkeypatch):
    from app.services.vision import status
    monkeypatch.setattr(settings, "vision_provider_url", None)
    result = status()
    assert result["provider_configured"] is False
    assert result["live_camera"]["supported"] is True
    assert "url" not in result
    assert result["count_model"] == "NOT_CONFIGURED"
