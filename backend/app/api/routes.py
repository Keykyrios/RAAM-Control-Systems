from __future__ import annotations
from datetime import datetime, timezone
from hashlib import sha256
import json
from uuid import uuid4
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.models.entities import (Part, InventoryEvent, PhysicalObservation, ReconciliationCase,
                                 ControlRun, AuditTask, StorageLocation, StorageBin, InventorySnapshot)
from app.api.schemas import (EventCreate, EventRead, ObservationCreate, ReconciliationCreate,
                             ReconciliationAssign, ReconciliationResolve,
                             ControlRunRequest, AuditPlanRequest, ScenarioRunRequest, PhysicalFilterRequest,
                             DemandForecastRequest, LeadTimeDemandRequest, StateChainRequest,
                             SpatialAssignmentRequest, TransferPlanRequest, ForecastEvaluationRequest)
from app.services.ledger import append_event, verify_hash_chain, fold_ledger
from app.services.control import ReplenishmentInput, recommend_replenishment, choose_inspections
from app.services.conformance import rank_reconciliation_cases, check_state_chain
from app.services.physical_state import Particle, update_physical_posterior
from app.services.demand import classify_demand, rolling_origin_select, bootstrap_lead_time_demand, quantile
from app.services.spatial import assign_storage_locations, plan_lateral_transfers
from app.services.evaluation import forecast_metrics
from app.services.vision import (analyze_image, status as vision_status, VisionProviderBusy,
                                  VisionProviderNotConfigured, VisionProviderError)

router = APIRouter(prefix="/api/v1")


def _not_found_part(db: Session, part_id: int) -> Part:
    part = db.get(Part, part_id)
    if not part:
        raise HTTPException(status_code=404, detail=f"part id {part_id} not found")
    return part


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def _source_class(requested: str | None) -> str:
    """Default to synthetic provenance in demo mode; production must opt into live observed data."""
    if requested:
        return requested
    return "SYNTHETIC_DEMO" if settings.demo_mode else "RAAM_OBSERVED"


def _observation_source_class(requested: str | None) -> str:
    """A captured frame is observed evidence; demo mode does not make it synthetic."""
    return requested or "RAAM_OBSERVED"


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    return {"status": "ok", "application": settings.app_name, "environment": settings.environment,
            "demo_mode": settings.demo_mode, "database": "connected", "timestamp": datetime.now(timezone.utc).isoformat()}


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    part_count = db.scalar(select(func.count()).select_from(Part)) or 0
    event_count = db.scalar(select(func.count()).select_from(InventoryEvent)) or 0
    observation_count = db.scalar(select(func.count()).select_from(PhysicalObservation)) or 0
    open_cases = db.scalar(select(func.count()).select_from(ReconciliationCase).where(ReconciliationCase.status == "OPEN")) or 0
    active_sites = db.scalar(select(func.count(func.distinct(StorageLocation.site_code))).where(StorageLocation.active.is_(True))) or 0
    snapshots = db.scalars(select(InventorySnapshot).order_by(InventorySnapshot.as_of.desc(), InventorySnapshot.id.desc())).all()
    latest: dict[int, InventorySnapshot] = {}
    for snapshot in snapshots:
        latest.setdefault(snapshot.part_id, snapshot)
    discrepancies = []
    for snapshot in latest.values():
        if snapshot.physical_mean is not None:
            ledger = float(snapshot.ledger_quantity)
            physical = float(snapshot.physical_mean)
            discrepancies.append(abs(physical - ledger) / max(1.0, physical, ledger))
    unit_iri = sum(discrepancies) / len(discrepancies) if discrepancies else None
    return {"parts": part_count, "events": event_count, "observations": observation_count,
            "open_reconciliation_cases": open_cases, "active_sites": active_sites, "unit_iri": unit_iri,
            "snapshots_with_physical_estimate": len(discrepancies),
            "data_source": "database", "source_class": "RECORD_LEVEL",
            "note": "The API does not seed records. Record-level source classifications must be retained by consumers."}


@router.get("/inventory/state")
def inventory_state(db: Session = Depends(get_db)) -> dict:
    parts = db.scalars(select(Part).order_by(Part.sku)).all()
    snapshot_rows = db.execute(select(InventorySnapshot, StorageBin).outerjoin(StorageBin, InventorySnapshot.bin_id == StorageBin.id)
                               .order_by(InventorySnapshot.as_of.desc(), InventorySnapshot.id.desc())).all()
    latest: dict[tuple[int, str], tuple[InventorySnapshot, StorageBin | None]] = {}
    for snapshot, bin_record in snapshot_rows:
        key = (snapshot.part_id, bin_record.code if bin_record else "__UNLOCATED__")
        latest.setdefault(key, (snapshot, bin_record))
    opening: dict[tuple[int, str], int] = {}
    snapshot_times: dict[tuple[int, str], datetime] = {}
    physical: dict[tuple[int, str], tuple[float, float | None]] = {}
    for key, (snapshot, _bin) in latest.items():
        opening[key] = snapshot.ledger_quantity
        as_of = snapshot.as_of
        if as_of.tzinfo is None:
            as_of = as_of.replace(tzinfo=timezone.utc)
        snapshot_times[key] = as_of
        if snapshot.physical_mean is not None:
            physical[key] = (float(snapshot.physical_mean), float(snapshot.confidence) if snapshot.confidence is not None else None)
    events = db.scalars(select(InventoryEvent).order_by(InventoryEvent.occurred_at.asc(), InventoryEvent.id.asc())).all()
    balances = fold_ledger(events, opening, snapshot_times)
    bins_by_part: dict[int, list[tuple[str, int]]] = {}
    for (part_id, bin_code), qty in balances.items():
        bins_by_part.setdefault(part_id, []).append((bin_code, qty))
    physical_by_part: dict[int, list[tuple[str, float, float | None]]] = {}
    for (part_id, bin_code), (mean_qty, confidence) in physical.items():
        physical_by_part.setdefault(part_id, []).append((bin_code, mean_qty, confidence))
    items = []
    for part in parts:
        part_bins = bins_by_part.get(part.id, [])
        physical_bins = physical_by_part.get(part.id, [])
        ledger_total = sum(qty for _, qty in part_bins) if part_bins else None
        # Do not expose an aggregate physical total if a non-zero ledger location lacks a physical estimate.
        active_bin_codes = {code for code, qty in part_bins if qty != 0}
        physical_code_set = {code for code, _, _ in physical_bins}
        physical_total = sum(mean_qty for _, mean_qty, _ in physical_bins) if physical_bins and active_bin_codes.issubset(physical_code_set) else None
        confidence = min((c for _, _, c in physical_bins if c is not None), default=None)
        unique_bins = sorted({code for code, qty in part_bins if qty != 0})
        source_classes = {snapshot.source_class for snapshot, _ in latest.values() if snapshot.part_id == part.id}
        source_classes.update(e.source_class for e in events if e.part_id == part.id)
        source_class = next(iter(source_classes)) if len(source_classes) == 1 else ("MIXED" if source_classes else part.source_class)
        items.append({"part_id": part.id, "sku": part.sku, "name": part.name,
                      "ledger_quantity": ledger_total, "physical_mean": physical_total,
                      "physical_variance": None, "confidence": confidence,
                      "bin_code": unique_bins[0] if len(unique_bins) == 1 else (f"{len(unique_bins)} bins" if unique_bins else None),
                      "as_of": max((snapshot.as_of.isoformat() for snapshot, _ in latest.values() if snapshot.part_id == part.id), default=None),
                      "posterior": None, "source_class": source_class,
                      "baseline_status": "available" if ledger_total is not None else "baseline_required"})
    return {"items": items, "count": len(items), "data_source": "snapshot_plus_event_fold",
            "note": "Opening snapshots anchor the ledger; later immutable events are folded by bin. Missing baselines remain null."}


@router.get("/parts")
def list_parts(q: str | None = None, limit: int = Query(default=100, ge=1, le=500),
              offset: int = Query(default=0, ge=0), db: Session = Depends(get_db)) -> dict:
    statement = select(Part).order_by(Part.sku).offset(offset).limit(limit)
    if q:
        statement = select(Part).where((Part.sku.ilike(f"%{q}%")) | (Part.name.ilike(f"%{q}%"))).order_by(Part.sku).offset(offset).limit(limit)
    parts = db.scalars(statement).all()
    return {"items": [{"id": p.id, "sku": p.sku, "name": p.name, "vehicle_family": p.vehicle_family,
                       "unit_cost": float(p.unit_cost), "unit_volume": float(p.unit_volume),
                       "criticality": float(p.criticality), "lifecycle_stage": p.lifecycle_stage,
                       "source_class": p.source_class} for p in parts], "limit": limit, "offset": offset}


@router.get("/locations")
def list_locations(db: Session = Depends(get_db)) -> dict:
    locations = db.scalars(select(StorageLocation).where(StorageLocation.active.is_(True)).order_by(StorageLocation.site_code, StorageLocation.code)).all()
    return {"items": [{"id": loc.id, "code": loc.code, "name": loc.name, "site_code": loc.site_code,
                       "capacity_volume": float(loc.capacity_volume),
                       "bins": [{"id": b.id, "code": b.code, "capacity_volume": float(b.capacity_volume),
                                 "coordinates": [b.x_coord, b.y_coord, b.z_coord]} for b in loc.bins]}
                      for loc in locations]}


@router.get("/events")
def list_events(limit: int = Query(default=100, ge=1, le=500), db: Session = Depends(get_db)) -> dict:
    events = db.scalars(select(InventoryEvent).order_by(InventoryEvent.id.desc()).limit(limit)).all()
    return {"items": [{"event_id": e.event_id, "part_id": e.part_id, "event_type": e.event_type,
                       "quantity": e.quantity, "actor_id": e.actor_id, "source_location": e.source_location,
                       "destination_location": e.destination_location, "job_id": e.job_id,
                       "vehicle_id": e.vehicle_id, "document_id": e.document_id, "dock": e.dock,
                       "occurred_at": e.occurred_at.isoformat(), "recorded_at": e.recorded_at.isoformat(),
                       "idempotency_key": e.idempotency_key, "corrects_event_id": e.corrects_event_id,
                       "metadata": e.metadata_json, "event_hash": e.event_hash,
                       "previous_hash": e.previous_hash, "source_class": e.source_class} for e in events]}


@router.post("/events", response_model=EventRead, status_code=201)
def create_event(payload: EventCreate, db: Session = Depends(get_db)) -> InventoryEvent:
    _not_found_part(db, payload.part_id)
    try:
        return append_event(db, part_id=payload.part_id, event_type=payload.event_type,
                            quantity=payload.quantity, actor_id=payload.actor_id,
                            source_location=payload.source_location, destination_location=payload.destination_location,
                            job_id=payload.job_id, vehicle_id=payload.vehicle_id, document_id=payload.document_id,
                            dock=payload.dock, occurred_at=payload.occurred_at, idempotency_key=payload.idempotency_key,
                            corrects_event_id=payload.corrects_event_id, metadata=payload.metadata,
                            source_class=_source_class(payload.source_class))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/events/integrity")
def event_chain_integrity(db: Session = Depends(get_db)) -> dict:
    events = db.scalars(select(InventoryEvent).order_by(InventoryEvent.id.asc())).all()
    valid, error = verify_hash_chain(events)
    return {"valid": valid, "checked_events": len(events), "error": error,
            "interpretation": "Hash chaining exposes tampering; deploy immutable/WORM storage for stronger tamper resistance."}


@router.get("/vision/status")
def vision_status_route() -> dict:
    """Expose safe provider/live-camera capabilities. The provider URL is never returned."""
    return vision_status()


@router.post("/vision/analyze")
async def analyze_vision_upload(
    image: UploadFile = File(...),
    part_id: int | None = Form(default=None),
    bin_id: int | None = Form(default=None),
    capture_mode: str = Form(default="SNAPSHOT"),
    device_id: str | None = Form(default=None),
    camera_label: str | None = Form(default=None),
    frame_sequence: int | None = Form(default=None),
    captured_at: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> dict:
    """Forward the exact camera frame to the configured CV provider.

    This endpoint never fabricates predictions. The provider must return normalized
    evidence and a durable evidence_uri before a reviewed observation can be saved.
    """
    if not settings.vision_provider_url:
        raise HTTPException(status_code=503, detail=(
            "Computer-vision inference is not configured. Set VISION_PROVIDER_URL to an approved model-service endpoint; "
            "no synthetic output was generated."
        ))
    if capture_mode not in {"LIVE_CAMERA", "SNAPSHOT", "UPLOAD", "AUDIT"}:
        raise HTTPException(status_code=422, detail="capture_mode must be LIVE_CAMERA, SNAPSHOT, UPLOAD or AUDIT.")
    if capture_mode == "LIVE_CAMERA" and not device_id:
        raise HTTPException(status_code=422, detail="Live-camera analysis requires a browser camera device_id.")
    if frame_sequence is not None and frame_sequence < 0:
        raise HTTPException(status_code=422, detail="frame_sequence must be non-negative.")
    part = _not_found_part(db, part_id) if part_id is not None else None
    bin_record = db.get(StorageBin, bin_id) if bin_id is not None else None
    if bin_id is not None and not bin_record:
        raise HTTPException(status_code=404, detail="bin not found")
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Upload must be JPEG, PNG or WebP.")
    try:
        content = await image.read(settings.vision_max_image_bytes + 1)
        if len(content) > settings.vision_max_image_bytes:
            raise HTTPException(status_code=413, detail=f"Image exceeds the {settings.vision_max_image_bytes}-byte upload limit.")
        result = await analyze_image(
            filename=image.filename or "inventory-evidence",
            content_type=image.content_type,
            content=content,
            part_id=part_id,
            bin_id=bin_id,
            known_sku=part.sku if part else None,
            known_bin_code=bin_record.code if bin_record else None,
            capture_mode=capture_mode,
            device_id=device_id,
            camera_label=camera_label,
            frame_sequence=frame_sequence,
            captured_at=captured_at,
        )
    except VisionProviderNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except VisionProviderBusy as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except VisionProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await image.close()
    return result


@router.get("/observations")
def list_observations(limit: int = Query(default=100, ge=1, le=500), db: Session = Depends(get_db)) -> dict:
    records = db.scalars(select(PhysicalObservation).order_by(PhysicalObservation.observed_at.desc()).limit(limit)).all()
    return {"items": [{"observation_id": o.observation_id, "part_id": o.part_id, "bin_id": o.bin_id,
                       "observed_at": o.observed_at.isoformat(), "sensor_type": o.sensor_type,
                       "observed_quantity": o.observed_quantity, "occupancy_ratio": o.occupancy_ratio,
                       "identifier_candidates": o.identifier_candidates, "confidence": float(o.confidence),
                       "evidence_uri": o.evidence_uri, "status": o.status, "source_class": o.source_class,
                       "capture": (o.metadata_json or {}).get("capture", {}),
                       "model_version": (o.metadata_json or {}).get("model_version")} for o in records]}


@router.post("/observations", status_code=201)
def create_observation(payload: ObservationCreate, db: Session = Depends(get_db)) -> dict:
    if payload.part_id is not None:
        _not_found_part(db, payload.part_id)
    if payload.bin_id is not None and not db.get(StorageBin, payload.bin_id):
        raise HTTPException(status_code=404, detail="bin not found")
    capture = {
        "capture_mode": payload.capture_mode,
        "device_id": payload.device_id,
        "camera_label": payload.camera_label,
        "captured_at": payload.captured_at.isoformat() if payload.captured_at else None,
        "frame_sequence": payload.frame_sequence,
        "inference_latency_ms": payload.inference_latency_ms,
        "provider_request_id": payload.provider_request_id,
    }
    metadata = {**payload.metadata, "capture": capture, "model_version": payload.model_version,
                "count_distribution": payload.count_distribution, "detections": payload.detections}
    record = PhysicalObservation(observation_id=_new_id("obs"), part_id=payload.part_id, bin_id=payload.bin_id,
        sensor_type=payload.sensor_type, observed_quantity=payload.observed_quantity,
        occupancy_ratio=payload.occupancy_ratio, identifier_candidates=payload.identifier_candidates,
        confidence=payload.confidence, evidence_uri=payload.evidence_uri, metadata_json=metadata,
        status="REVIEWED", source_class=_observation_source_class(payload.source_class))
    db.add(record); db.commit(); db.refresh(record)
    return {"observation_id": record.observation_id, "status": record.status,
            "capture_mode": payload.capture_mode, "source_class": record.source_class,
            "stock_changed": False, "purchase_order_created": False,
            "message": "Observation recorded as reviewed evidence. Stock and purchasing were not changed."}


@router.get("/reconciliation/cases")
def list_reconciliation_cases(status: str | None = "OPEN", db: Session = Depends(get_db)) -> dict:
    statement = select(ReconciliationCase)
    if status:
        statement = statement.where(ReconciliationCase.status == status.upper())
    records = db.scalars(statement.order_by(ReconciliationCase.priority_score.desc())).all()
    return {"items": [{"case_id": c.case_id, "part_id": c.part_id, "event_id": c.event_id,
                       "case_type": c.case_type, "expected_quantity": c.expected_quantity,
                       "observed_quantity": c.observed_quantity,
                       "posterior_unresolved_probability": float(c.posterior_unresolved_probability),
                       "economic_exposure": float(c.economic_exposure), "priority_score": float(c.priority_score),
                       "status": c.status, "assigned_to": c.assigned_to, "evidence_path": c.evidence_path,
                       "resolution": c.resolution, "created_at": c.created_at.isoformat(),
                       "resolved_at": c.resolved_at.isoformat() if c.resolved_at else None,
                       "source_class": c.source_class} for c in records]}


@router.post("/reconciliation/cases", status_code=201)
def create_reconciliation_case(payload: ReconciliationCreate, db: Session = Depends(get_db)) -> dict:
    if payload.part_id is not None:
        _not_found_part(db, payload.part_id)
    priority = payload.posterior_unresolved_probability * payload.economic_exposure
    record = ReconciliationCase(case_id=_new_id("case"), part_id=payload.part_id, event_id=payload.event_id,
        case_type=payload.case_type, expected_quantity=payload.expected_quantity, observed_quantity=payload.observed_quantity,
        posterior_unresolved_probability=payload.posterior_unresolved_probability,
        economic_exposure=payload.economic_exposure, priority_score=priority, evidence_path=payload.evidence_path,
        source_class=_source_class(payload.source_class))
    db.add(record); db.commit(); db.refresh(record)
    return {"case_id": record.case_id, "priority_score": priority, "status": record.status,
            "interpretation": "An anomaly is a reconciliation problem, not a conclusion about intent."}


@router.patch("/reconciliation/cases/{case_id}")
def assign_reconciliation_case(case_id: str, payload: ReconciliationAssign, db: Session = Depends(get_db)) -> dict:
    record = db.scalar(select(ReconciliationCase).where(ReconciliationCase.case_id == case_id))
    if not record:
        raise HTTPException(status_code=404, detail="reconciliation case not found")
    if record.status == "RESOLVED":
        raise HTTPException(status_code=409, detail="resolved cases cannot be reassigned")
    record.assigned_to = payload.assigned_to
    record.evidence_path = list(record.evidence_path or []) + [{
        "type": "ASSIGNMENT", "actor_id": payload.actor_id,
        "assigned_to": payload.assigned_to, "at": datetime.now(timezone.utc).isoformat(),
    }]
    db.commit()
    return {"case_id": record.case_id, "assigned_to": record.assigned_to, "status": record.status,
            "message": "Assignment recorded. This does not decide the outcome of the case."}


@router.post("/reconciliation/cases/{case_id}/resolve")
def resolve_reconciliation_case(case_id: str, payload: ReconciliationResolve, db: Session = Depends(get_db)) -> dict:
    record = db.scalar(select(ReconciliationCase).where(ReconciliationCase.case_id == case_id))
    if not record:
        raise HTTPException(status_code=404, detail="reconciliation case not found")
    if record.status == "RESOLVED":
        raise HTTPException(status_code=409, detail="case is already resolved")
    record.status = "RESOLVED"
    record.resolution = payload.resolution
    record.resolved_at = datetime.now(timezone.utc)
    record.evidence_path = list(record.evidence_path or []) + [{
        "type": "RESOLUTION", "actor_id": payload.actor_id,
        "resolution": payload.resolution, "evidence": payload.evidence,
        "at": record.resolved_at.isoformat(),
    }]
    db.commit()
    return {"case_id": record.case_id, "status": record.status, "resolved_at": record.resolved_at.isoformat(),
            "message": "Resolution evidence recorded. No inventory quantity was changed by this action."}


@router.post("/control/run", status_code=201)
def run_control(payload: ControlRunRequest, db: Session = Depends(get_db)) -> dict:
    inputs = [part.model_dump() for part in payload.parts]
    canonical = json.dumps({"inputs": inputs, "budget": payload.budget_remaining,
                            "capacity": payload.capacity_volume_remaining}, sort_keys=True)
    inputs_hash = sha256(canonical.encode()).hexdigest()
    outputs = []
    budget_left = payload.budget_remaining
    capacity_left = payload.capacity_volume_remaining
    for raw in payload.parts:
        inp = ReplenishmentInput(**raw.model_dump())
        result = recommend_replenishment(inp, budget_remaining=budget_left,
            capacity_volume_remaining=capacity_left, risk_weight=payload.risk_weight, cvar_gamma=payload.cvar_gamma)
        output = {"sku": result.sku, "recommended_order_qty": result.recommended_order_qty,
                  "service_level": result.service_level, "projected_service_level": result.projected_service_level,
                  "expected_shortage_units": result.expected_shortage_units,
                  "expected_holding_units": result.expected_holding_units, "expected_cost": result.expected_cost,
                  "cvar_tail_cost": result.cvar_tail_cost, "constraint_limited": result.constraint_limited,
                  "explanation": result.explanation, "requires_human_approval": payload.require_human_approval}
        outputs.append(output)
        budget_left -= result.recommended_order_qty * inp.unit_cost
        capacity_left -= result.recommended_order_qty * inp.unit_volume
    status = "PENDING_APPROVAL" if payload.require_human_approval else "DRAFT"
    run = ControlRun(run_id=_new_id("run"), requested_by=payload.requested_by, status=status,
        inputs_hash=inputs_hash, model_versions={"physical_state": "particle-filter-v1", "demand": "rolling-origin-baselines-v1",
        "lead_time": "empirical-bootstrap-v1", "optimizer": "finite-candidate-cvar-v1"},
        constraints={"budget_initial": payload.budget_remaining, "capacity_initial": payload.capacity_volume_remaining,
                     "risk_weight": payload.risk_weight, "cvar_gamma": payload.cvar_gamma},
        outputs=outputs, diagnostics={"source_data": "request payload", "approved": False,
        "warning": "This reference optimizer requires calibration and human approval before live purchasing."},
        source_class="SYNTHETIC_SCENARIO")
    db.add(run); db.commit(); db.refresh(run)
    return {"run_id": run.run_id, "status": run.status, "inputs_hash": run.inputs_hash, "outputs": outputs,
            "constraints_remaining": {"budget": max(0.0, budget_left), "capacity_volume": max(0.0, capacity_left)},
            "diagnostics": run.diagnostics}


@router.post("/audits/plan")
def plan_audits(payload: AuditPlanRequest) -> dict:
    result = choose_inspections([candidate.model_dump() for candidate in payload.candidates],
                                 available_minutes=payload.available_minutes)
    return {**result, "selection_policy": "0/1 knapsack maximizing expected cost reduction minus inspection cost",
            "approval_required": True}


@router.post("/physical-state/filter")
def update_physical_state(payload: PhysicalFilterRequest) -> dict:
    result = update_physical_posterior(
        prior_particles=[Particle(p.quantity, p.unobserved_loss, p.weight) for p in payload.prior_particles],
        ledger_delta=payload.ledger_delta, observed_count=payload.observed_count,
        observation_sigma=payload.observation_sigma, loss_probability=payload.loss_probability,
        loss_max_units=payload.loss_max_units, audit_count=payload.audit_count, seed=payload.seed)
    return {"mean": result.mean, "variance": result.variance, "lower_credible_90": result.lower_credible,
            "upper_credible_90": result.upper_credible, "particle_count": len(result.particles),
            "source_class": _source_class(payload.source_class),
            "assumptions": "Transition-loss and observation noise must be calibrated using labeled audits and vision observations."}


@router.post("/forecast/demand")
def forecast_demand(payload: DemandForecastRequest) -> dict:
    profile = classify_demand(payload.demand_history)
    selected = rolling_origin_select(payload.demand_history, under_penalty=payload.under_forecast_penalty,
                                     over_penalty=payload.over_forecast_penalty, min_train=payload.minimum_train_periods)
    return {"sku": payload.sku, "demand_class": profile.demand_class, "zero_fraction": profile.zero_fraction,
            "positive_cv_squared": profile.positive_cv_squared, "mean_per_period": profile.mean_per_period,
            **selected, "source_class": _source_class(payload.source_class),
            "models_evaluated": ["croston_sba", "tsb", "pooled_mean"],
            "note": "Reference baseline only. Negative binomial, GBM and stacking require trained, validated model adapters."}


@router.post("/forecast/lead-time-demand")
def forecast_lead_time_demand(payload: LeadTimeDemandRequest) -> dict:
    scenarios = bootstrap_lead_time_demand(payload.demand_history, payload.observed_lead_time_days,
        scenarios=payload.scenarios, periods_per_day=payload.periods_per_day, seed=payload.seed)
    return {"sku": payload.sku, "scenario_count": len(scenarios),
            "mean_lead_time_demand": sum(scenarios) / len(scenarios),
            "reorder_quantile": quantile(scenarios, payload.service_quantile),
            "service_quantile": payload.service_quantile,
            "empirical_lead_time_quantiles_days": {"p50": quantile(payload.observed_lead_time_days, .5),
                                                    "p90": quantile(payload.observed_lead_time_days, .9)},
            "scenario_sample": scenarios[:100], "source_class": _source_class(payload.source_class),
            "note": "Supplied demand and lead-time arrays must be source-backed operational histories for production decisions."}


@router.post("/process-conformance/check")
def process_conformance(payload: StateChainRequest) -> dict:
    return check_state_chain(payload.states)


@router.post("/spatial/assign")
def spatial_assign(payload: SpatialAssignmentRequest) -> dict:
    try:
        return assign_storage_locations([p.model_dump() for p in payload.parts], [b.model_dump() for b in payload.bins])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/transfers/plan")
def transfer_plan(payload: TransferPlanRequest) -> dict:
    return plan_lateral_transfers([x.model_dump() for x in payload.locations], transfer_capacity=payload.transfer_capacity)


@router.post("/evaluations/forecast")
def evaluate_forecast(payload: ForecastEvaluationRequest) -> dict:
    try:
        metrics = forecast_metrics(payload.actual, payload.predicted, training_series=payload.training_series,
            quantile_tau=payload.quantile_tau, lower=payload.lower, upper=payload.upper, coverage_target=payload.coverage_target)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"metrics": metrics, "primary_metric": "decision_cost_loss should be supplied alongside statistical scores for critical demand",
            "random_shuffle_used": False}


@router.post("/scenarios/run")
def run_scenario(payload: ScenarioRunRequest) -> dict:
    # This is a clearly labeled sensitivity stub until observed trajectories are connected.
    return {"scenario_id": _new_id("scenario"), "name": payload.name,
            "status": "REQUIRES_OBSERVED_TRAJECTORIES", "inputs": payload.model_dump(),
            "results": None,
            "message": "Scenario multipliers are accepted, but cost/service outputs are withheld until empirical demand, lead-time and cost trajectories are connected.",
            "data_provenance": "No result was fabricated from synthetic multipliers."}


@router.get("/control/runs")
def list_control_runs(limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db)) -> dict:
    runs = db.scalars(select(ControlRun).order_by(ControlRun.started_at.desc()).limit(limit)).all()
    return {"items": [{"run_id": run.run_id, "requested_by": run.requested_by, "started_at": run.started_at.isoformat(),
                       "status": run.status, "inputs_hash": run.inputs_hash, "outputs": run.outputs,
                       "constraints": run.constraints, "source_class": run.source_class} for run in runs]}
