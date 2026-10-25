from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator

SourceClass = Literal["RAAM_OBSERVED", "SYNTHETIC_DEMO", "PUBLISHED_AUTOMOTIVE", "CROSS_INDUSTRY_PUBLISHED", "PUBLIC_BENCHMARK", "SYNTHETIC_SCENARIO"]
CaptureMode = Literal["LIVE_CAMERA", "SNAPSHOT", "UPLOAD", "AUDIT"]


class EventCreate(BaseModel):
    part_id: int
    event_type: str
    quantity: int = Field(ge=0)
    actor_id: str = Field(min_length=1, max_length=120)
    source_location: str | None = None
    destination_location: str | None = None
    job_id: str | None = None
    vehicle_id: str | None = None
    document_id: str | None = None
    dock: str | None = None
    occurred_at: datetime | None = None
    idempotency_key: str | None = None
    corrects_event_id: str | None = None
    metadata: dict = Field(default_factory=dict)
    source_class: SourceClass | None = None


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    event_id: str
    part_id: int
    event_type: str
    quantity: int
    actor_id: str
    source_location: str | None
    destination_location: str | None
    job_id: str | None
    vehicle_id: str | None
    document_id: str | None
    occurred_at: datetime
    previous_hash: str | None
    event_hash: str
    corrects_event_id: str | None
    source_class: str


class ObservationCreate(BaseModel):
    part_id: int | None = None
    bin_id: int | None = None
    sensor_type: str = Field(pattern="^(CAMERA|BARCODE|OCR|MANUAL_COUNT|AUDIT)$")
    observed_quantity: int | None = Field(default=None, ge=0)
    occupancy_ratio: float | None = Field(default=None, ge=0, le=1)
    identifier_candidates: list[dict] = Field(default_factory=list, max_length=100)
    count_distribution: list[dict] = Field(default_factory=list, max_length=200)
    detections: list[dict] = Field(default_factory=list, max_length=500)
    confidence: float = Field(ge=0, le=1)
    evidence_uri: str | None = Field(default=None, max_length=2000)
    capture_mode: CaptureMode | None = None
    device_id: str | None = Field(default=None, max_length=200)
    camera_label: str | None = Field(default=None, max_length=200)
    captured_at: datetime | None = None
    frame_sequence: int | None = Field(default=None, ge=0)
    inference_latency_ms: float | None = Field(default=None, ge=0, le=600_000)
    model_version: str | None = Field(default=None, max_length=160)
    provider_request_id: str | None = Field(default=None, max_length=120)
    metadata: dict = Field(default_factory=dict)
    source_class: SourceClass | None = None

    @field_validator("evidence_uri")
    @classmethod
    def evidence_uri_must_be_durable(cls, value: str | None) -> str | None:
        if value is None:
            return None
        scheme = value.split(":", 1)[0].lower()
        if scheme not in {"evidence", "s3", "gs", "az", "azure"}:
            raise ValueError("evidence_uri must use durable, access-controlled evidence://, s3://, gs:// or az:// storage.")
        return value

    @model_validator(mode="after")
    def camera_evidence_contract(self) -> "ObservationCreate":
        if self.sensor_type == "CAMERA" and not self.evidence_uri:
            raise ValueError("Camera observations require a durable evidence_uri before they can be reviewed and saved.")
        if self.capture_mode == "LIVE_CAMERA" and not self.device_id:
            raise ValueError("Live-camera observations require the originating camera device_id.")
        if self.count_distribution:
            total = sum(float(point.get("probability", 0)) for point in self.count_distribution if isinstance(point, dict))
            if not 0.97 <= total <= 1.03:
                raise ValueError("count_distribution probabilities must sum to approximately 1.0.")
        return self


class ReconciliationAssign(BaseModel):
    assigned_to: str = Field(min_length=1, max_length=120)
    actor_id: str = Field(min_length=1, max_length=120)


class ReconciliationResolve(BaseModel):
    resolution: str = Field(min_length=8, max_length=4000)
    actor_id: str = Field(min_length=1, max_length=120)
    evidence: list[dict] = Field(default_factory=list, max_length=50)


class ReconciliationCreate(BaseModel):
    part_id: int | None = None
    event_id: str | None = None
    case_type: str
    expected_quantity: int | None = None
    observed_quantity: int | None = None
    posterior_unresolved_probability: float = Field(ge=0, le=1)
    economic_exposure: float = Field(ge=0)
    evidence_path: list[dict] = Field(default_factory=list)
    source_class: SourceClass | None = None


class ControlPartInput(BaseModel):
    sku: str
    physical_mean: float = Field(ge=0)
    lead_time_demand_scenarios: list[int] = Field(min_length=1)
    service_level: float = Field(gt=0, lt=1)
    unit_cost: float = Field(ge=0)
    unit_volume: float = Field(ge=0)
    holding_cost_per_unit: float = Field(ge=0)
    shortage_cost_per_unit: float = Field(ge=0)
    expedite_cost_per_unit: float = Field(ge=0, default=0)
    current_order_qty: int = Field(default=0, ge=0)
    criticality: float = Field(default=0.5, ge=0, le=1)


class ControlRunRequest(BaseModel):
    requested_by: str = Field(min_length=1, max_length=120)
    parts: list[ControlPartInput] = Field(min_length=1)
    budget_remaining: float = Field(ge=0)
    capacity_volume_remaining: float = Field(ge=0)
    risk_weight: float = Field(default=0.25, ge=0)
    cvar_gamma: float = Field(default=0.95, gt=0, lt=1)
    require_human_approval: bool = True


class AuditCandidate(BaseModel):
    sku: str
    minutes: int = Field(gt=0)
    expected_cost_reduction: float = Field(ge=0)
    inspection_cost: float = Field(ge=0)
    eligible: bool = True
    rationale: str = ""


class AuditPlanRequest(BaseModel):
    available_minutes: int = Field(ge=0)
    candidates: list[AuditCandidate]


class ScenarioRunRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    demand_multiplier: float = Field(gt=0, le=10)
    lead_time_multiplier: float = Field(gt=0, le=10)
    policy_name: str = "current"
    source_class: str = "SYNTHETIC_SCENARIO"

class ParticleInput(BaseModel):
    quantity: int = Field(ge=0)
    unobserved_loss: int = Field(default=0, ge=0)
    weight: float = Field(gt=0)


class PhysicalFilterRequest(BaseModel):
    prior_particles: list[ParticleInput] = Field(min_length=1)
    ledger_delta: int = 0
    observed_count: int | None = Field(default=None, ge=0)
    observation_sigma: float = Field(default=1.0, gt=0)
    loss_probability: float = Field(default=0.01, ge=0, le=1)
    loss_max_units: int = Field(default=2, ge=0)
    audit_count: int | None = Field(default=None, ge=0)
    seed: int | None = None
    source_class: SourceClass | None = None


class DemandForecastRequest(BaseModel):
    sku: str
    demand_history: list[int] = Field(min_length=1)
    under_forecast_penalty: float = Field(default=3.0, ge=0)
    over_forecast_penalty: float = Field(default=1.0, ge=0)
    minimum_train_periods: int = Field(default=6, ge=2)
    source_class: SourceClass | None = None


class LeadTimeDemandRequest(BaseModel):
    sku: str
    demand_history: list[int] = Field(min_length=1)
    observed_lead_time_days: list[float] = Field(min_length=1)
    scenarios: int = Field(default=2000, ge=50, le=100000)
    periods_per_day: float = Field(default=1.0, gt=0)
    service_quantile: float = Field(default=0.9, gt=0, lt=1)
    seed: int | None = None
    source_class: SourceClass | None = None


class StateChainRequest(BaseModel):
    states: list[str] = Field(min_length=1)


class SpatialPartInput(BaseModel):
    part_id: str
    volume: float = Field(ge=0)
    misplacement_penalty: float = Field(default=0, ge=0)
    candidate_costs: list[dict] = Field(min_length=1)


class SpatialBinInput(BaseModel):
    bin_id: str
    capacity_volume: float = Field(ge=0)


class SpatialAssignmentRequest(BaseModel):
    parts: list[SpatialPartInput] = Field(min_length=1)
    bins: list[SpatialBinInput] = Field(min_length=1)


class TransferLocationInput(BaseModel):
    location_id: str
    on_hand: int = Field(ge=0)
    target_stock: int = Field(ge=0)
    criticality: float = Field(default=0.5, ge=0, le=1)
    transfer_cost: float = Field(default=0, ge=0)
    part_id: str | None = None


class TransferPlanRequest(BaseModel):
    locations: list[TransferLocationInput] = Field(min_length=2)
    transfer_capacity: int | None = Field(default=None, ge=0)


class ForecastEvaluationRequest(BaseModel):
    actual: list[float] = Field(min_length=1)
    predicted: list[float] = Field(min_length=1)
    training_series: list[float] | None = None
    quantile_tau: float = Field(default=0.5, ge=0, le=1)
    lower: list[float] | None = None
    upper: list[float] | None = None
    coverage_target: float = Field(default=0.9, gt=0, lt=1)
