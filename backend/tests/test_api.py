from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import database
from app.main import app
from app.models.entities import Part


@pytest.fixture

def client(monkeypatch):
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestSessionLocal = sessionmaker(bind=test_engine, autoflush=False, autocommit=False, expire_on_commit=False)
    monkeypatch.setattr(database, "engine", test_engine)
    monkeypatch.setattr(database, "SessionLocal", TestSessionLocal)
    monkeypatch.setattr("app.main.engine", test_engine)
    database.Base.metadata.create_all(bind=test_engine)
    with TestClient(app) as test_client:
        yield test_client, TestSessionLocal
    database.Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


def test_health_and_empty_baseline_are_explicit(client):
    test_client, _ = client
    assert test_client.get("/api/v1/health").status_code == 200
    overview = test_client.get("/api/v1/overview")
    assert overview.status_code == 200
    assert overview.json()["parts"] == 0
    assert overview.json()["unit_iri"] is None


def test_event_api_checks_part_and_verifies_hash_chain(client):
    test_client, SessionLocal = client
    with SessionLocal() as db:
        part = Part(
            sku="TEST-API-01",
            name="API test part",
            unit_cost=Decimal("12.00"),
            unit_volume=Decimal("0.02"),
            criticality=0.5,
            lifecycle_stage="active",
            source_class="SYNTHETIC_DEMO",
        )
        db.add(part)
        db.commit()
        part_id = part.id

    response = test_client.post(
        "/api/v1/events",
        json={
            "part_id": part_id,
            "event_type": "RECEIPT",
            "quantity": 7,
            "actor_id": "test-user",
            "destination_location": "TEST-BIN-01",
            "idempotency_key": "api-test-key-01",
            "source_class": "SYNTHETIC_DEMO",
            "metadata": {"test": True},
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["quantity"] == 7
    assert response.json()["source_class"] == "SYNTHETIC_DEMO"
    integrity = test_client.get("/api/v1/events/integrity").json()
    assert integrity["valid"] is True
    assert integrity["checked_events"] == 1

    missing_part = test_client.post(
        "/api/v1/events",
        json={"part_id": 9999, "event_type": "RECEIPT", "quantity": 1, "actor_id": "test-user"},
    )
    assert missing_part.status_code == 404


def test_live_camera_observation_requires_evidence_and_device(client):
    test_client, SessionLocal = client
    with SessionLocal() as db:
        part = Part(sku="TEST-CAM-01", name="Camera test part", unit_cost=Decimal("1.00"),
                    unit_volume=Decimal("0.01"), criticality=0.5, lifecycle_stage="active",
                    source_class="RAAM_OBSERVED")
        db.add(part)
        db.commit()
        part_id = part.id

    no_evidence = test_client.post("/api/v1/observations", json={
        "part_id": part_id, "sensor_type": "CAMERA", "confidence": 0.9,
        "capture_mode": "LIVE_CAMERA", "device_id": "cam-1",
    })
    assert no_evidence.status_code == 422

    no_device = test_client.post("/api/v1/observations", json={
        "part_id": part_id, "sensor_type": "CAMERA", "confidence": 0.9,
        "capture_mode": "LIVE_CAMERA", "evidence_uri": "evidence://raam-vision/test.png",
    })
    assert no_device.status_code == 422

    public_uri = test_client.post("/api/v1/observations", json={
        "part_id": part_id, "sensor_type": "CAMERA", "confidence": 0.9,
        "capture_mode": "LIVE_CAMERA", "device_id": "cam-1",
        "evidence_uri": "https://public.example/frame.jpg",
    })
    assert public_uri.status_code == 422

    saved = test_client.post("/api/v1/observations", json={
        "part_id": part_id, "sensor_type": "CAMERA", "confidence": 0.9,
        "capture_mode": "LIVE_CAMERA", "device_id": "cam-1", "camera_label": "Bay camera",
        "frame_sequence": 7, "inference_latency_ms": 421.5,
        "model_version": "test-vision-1", "evidence_uri": "evidence://raam-vision/test.png",
        "identifier_candidates": [{"identifier": "TEST-CAM-01", "confidence": 0.9}],
        "detections": [{"label": "QR code", "box": [10, 10, 20, 20], "confidence": 0.9}],
    })
    assert saved.status_code == 201, saved.text
    body = saved.json()
    assert body["stock_changed"] is False
    assert body["purchase_order_created"] is False
    assert body["source_class"] == "RAAM_OBSERVED"
    assert body["status"] == "REVIEWED"
    listed = test_client.get("/api/v1/observations").json()["items"][0]
    assert listed["status"] == "REVIEWED"
    assert listed["capture"]["capture_mode"] == "LIVE_CAMERA"
    assert listed["capture"]["device_id"] == "cam-1"


def test_vision_status_route_is_safe_and_connected(client):
    test_client, _ = client
    response = test_client.get("/api/v1/vision/status")
    assert response.status_code == 200
    body = response.json()
    assert body["live_camera"]["supported"] is True
    assert "provider_url" not in body


def test_reconciliation_assignment_and_resolution_require_evidence(client):
    test_client, _ = client
    created = test_client.post("/api/v1/reconciliation/cases", json={
        "case_type": "MISSING_JOB_EDGE", "posterior_unresolved_probability": 0.6,
        "economic_exposure": 500.0, "evidence_path": [{"type": "EVENT", "id": "EV-1"}],
        "source_class": "RAAM_OBSERVED",
    })
    assert created.status_code == 201, created.text
    case_id = created.json()["case_id"]
    assigned = test_client.patch(f"/api/v1/reconciliation/cases/{case_id}", json={
        "assigned_to": "storekeeper-07", "actor_id": "planner-01",
    })
    assert assigned.status_code == 200
    assert assigned.json()["assigned_to"] == "storekeeper-07"
    missing_evidence = test_client.post(f"/api/v1/reconciliation/cases/{case_id}/resolve", json={
        "resolution": "short", "actor_id": "planner-01",
    })
    assert missing_evidence.status_code == 422
    resolved = test_client.post(f"/api/v1/reconciliation/cases/{case_id}/resolve", json={
        "resolution": "Checked the adjacent bin and confirmation document; discrepancy explained.",
        "actor_id": "planner-01", "evidence": [{"type": "DOCUMENT", "id": "GRN-22"}],
    })
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "RESOLVED"
    assert "No inventory quantity" in resolved.json()["message"]
    closed = test_client.get("/api/v1/reconciliation/cases?status=RESOLVED").json()["items"]
    assert closed[0]["resolution"].startswith("Checked")
