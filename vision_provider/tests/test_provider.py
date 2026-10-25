import os
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("VISION_EVIDENCE_DIR", "/tmp/raam-vision-test-evidence")

from app import EVIDENCE_DIR, app  # noqa: E402

client = TestClient(app)


def _qr_png(payload: str = "BRK-014") -> bytes:
    import io
    segno = pytest.importorskip("segno")
    qr = segno.make(payload, error="h")
    buffer = io.BytesIO()
    qr.save(buffer, kind="png", scale=8, border=4)
    return buffer.getvalue()


def test_health_reports_real_capabilities_and_explicit_missing_models():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["count_model"] == "NOT_CONFIGURED"
    assert body["occupancy_model"] == "NOT_CONFIGURED"
    assert body["capabilities"]["qr"] is True


def test_analyze_rejects_mismatched_signature():
    response = client.post(
        "/analyze",
        files={"image": ("frame.png", b"not-a-real-png", "image/png")},
    )
    assert response.status_code == 415


def test_analyze_rejects_unsupported_media_type():
    response = client.post(
        "/analyze",
        files={"image": ("frame.gif", b"GIF89a", "image/gif")},
    )
    assert response.status_code == 415


def test_analyze_decodes_real_qr_frame_and_retains_private_evidence():
    payload = f"TEST-SKU-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/analyze",
        files={"image": ("frame.png", _qr_png(payload), "image/png")},
        data={"known_sku": payload, "capture_mode": "LIVE_CAMERA", "device_id": "test-camera"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["observed_quantity"] is None
    assert body["occupancy_ratio"] is None
    assert body["count_distribution"] == []
    assert body["evidence_uri"].startswith("evidence://raam-vision/")
    assert body["frame_context"]["device_id"] == "test-camera"
    assert any(candidate["identifier"] == payload for candidate in body["identifier_candidates"])
    assert all(0 <= value <= 100 for detection in body["detections"] for value in detection["box"])
    evidence_name = body["evidence_uri"].rsplit("/", 1)[-1]
    assert (EVIDENCE_DIR / evidence_name).is_file()


def test_evidence_identifier_cannot_escape_the_store():
    response = client.get("/evidence/..%2Fapp.py")
    assert response.status_code in {400, 404}
