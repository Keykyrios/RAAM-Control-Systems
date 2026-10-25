from __future__ import annotations
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Part(Base):
    __tablename__ = "parts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sku: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(240))
    vehicle_family: Mapped[str | None] = mapped_column(String(120), nullable=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    unit_volume: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=Decimal("1"))
    criticality: Mapped[float] = mapped_column(Numeric(8, 4), default=0.5)
    substitute_sku: Mapped[str | None] = mapped_column(String(80), nullable=True)
    lifecycle_stage: Mapped[str] = mapped_column(String(32), default="active")
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    supplier: Mapped[Supplier | None] = relationship(back_populates="parts")
    events: Mapped[list[InventoryEvent]] = relationship(back_populates="part")


class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(240))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    parts: Mapped[list[Part]] = relationship(back_populates="supplier")


class StorageLocation(Base):
    __tablename__ = "storage_locations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(240))
    site_code: Mapped[str] = mapped_column(String(80), index=True)
    capacity_volume: Mapped[Decimal] = mapped_column(Numeric(16, 4), default=Decimal("0"))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    bins: Mapped[list[StorageBin]] = relationship(back_populates="location")


class StorageBin(Base):
    __tablename__ = "storage_bins"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("storage_locations.id"), index=True)
    capacity_volume: Mapped[Decimal] = mapped_column(Numeric(16, 4), default=Decimal("0"))
    x_coord: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    y_coord: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    z_coord: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    location: Mapped[StorageLocation] = relationship(back_populates="bins")


class InventorySnapshot(Base):
    __tablename__ = "inventory_snapshots"
    __table_args__ = (UniqueConstraint("part_id", "bin_id", "as_of", name="uq_snapshot_state"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("storage_bins.id"), nullable=True, index=True)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    ledger_quantity: Mapped[int] = mapped_column(Integer, default=0)
    physical_mean: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    physical_variance: Mapped[float | None] = mapped_column(Numeric(14, 4), nullable=True)
    posterior: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")


class InventoryEvent(Base):
    """Append-only transaction ledger. Corrections are compensating events, never in-place edits."""
    __tablename__ = "inventory_events"
    __table_args__ = (Index("ix_event_part_time", "part_id", "occurred_at"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(40))
    quantity: Mapped[int] = mapped_column(Integer)
    source_location: Mapped[str | None] = mapped_column(String(80), nullable=True)
    destination_location: Mapped[str | None] = mapped_column(String(80), nullable=True)
    actor_id: Mapped[str] = mapped_column(String(120))
    job_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    vehicle_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    document_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    dock: Mapped[str | None] = mapped_column(String(80), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    idempotency_key: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)
    previous_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_hash: Mapped[str] = mapped_column(String(64), index=True)
    corrects_event_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    part: Mapped[Part] = relationship(back_populates="events")


class PhysicalObservation(Base):
    __tablename__ = "physical_observations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    observation_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"), nullable=True, index=True)
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("storage_bins.id"), nullable=True, index=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    sensor_type: Mapped[str] = mapped_column(String(32))
    observed_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    occupancy_ratio: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    identifier_candidates: Mapped[list] = mapped_column(JSON, default=list)
    confidence: Mapped[float] = mapped_column(Numeric(8, 6), default=0.0)
    evidence_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="UNREVIEWED")
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class DemandObservation(Base):
    __tablename__ = "demand_observations"
    __table_args__ = (Index("ix_demand_part_period", "part_id", "period_start"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    stockout_censored: Mapped[bool] = mapped_column(Boolean, default=False)
    vehicle_mix: Mapped[dict] = mapped_column(JSON, default=dict)
    service_load: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")


class SupplierLeadTime(Base):
    __tablename__ = "supplier_lead_times"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), index=True)
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"), nullable=True, index=True)
    purchase_order_id: Mapped[str] = mapped_column(String(120), index=True)
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    lead_time_days: Mapped[float] = mapped_column(Numeric(10, 4))
    regime: Mapped[str] = mapped_column(String(80), default="normal")
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")


class ReconciliationCase(Base):
    __tablename__ = "reconciliation_cases"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    part_id: Mapped[int | None] = mapped_column(ForeignKey("parts.id"), nullable=True, index=True)
    event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    case_type: Mapped[str] = mapped_column(String(64))
    expected_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    observed_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    posterior_unresolved_probability: Mapped[float] = mapped_column(Numeric(8, 6), default=0.0)
    economic_exposure: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"))
    priority_score: Mapped[float] = mapped_column(Numeric(16, 6), default=0.0)
    status: Mapped[str] = mapped_column(String(32), default="OPEN")
    assigned_to: Mapped[str | None] = mapped_column(String(120), nullable=True)
    evidence_path: Mapped[list] = mapped_column(JSON, default=list)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")


class AuditTask(Base):
    __tablename__ = "audit_tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("storage_bins.id"), nullable=True)
    expected_value_of_information: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"))
    inspection_cost: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"))
    duration_minutes: Mapped[int] = mapped_column(Integer, default=5)
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(32), default="PLANNED")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    result_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")


class ControlRun(Base):
    __tablename__ = "control_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    requested_by: Mapped[str] = mapped_column(String(120))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="PENDING_APPROVAL")
    inputs_hash: Mapped[str] = mapped_column(String(64))
    model_versions: Mapped[dict] = mapped_column(JSON, default=dict)
    constraints: Mapped[dict] = mapped_column(JSON, default=dict)
    outputs: Mapped[list] = mapped_column(JSON, default=list)
    objective_value: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    diagnostics: Mapped[dict] = mapped_column(JSON, default=dict)
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")


class DecisionOverride(Base):
    __tablename__ = "decision_overrides"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    override_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    control_run_id: Mapped[int] = mapped_column(ForeignKey("control_runs.id"), index=True)
    original_action: Mapped[dict] = mapped_column(JSON)
    revised_action: Mapped[dict] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[str] = mapped_column(String(120))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")


class EvaluationRun(Base):
    __tablename__ = "evaluation_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    evaluation_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    evaluation_type: Mapped[str] = mapped_column(String(48))
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    baseline_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    policy_version: Mapped[str] = mapped_column(String(80))
    source_class: Mapped[str] = mapped_column(String(32), default="RAAM_OBSERVED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
