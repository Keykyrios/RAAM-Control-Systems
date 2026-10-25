from __future__ import annotations
import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.entities import InventoryEvent

# All quantities are positive magnitudes; event type controls the ledger sign.
INBOUND = {"RECEIPT", "RETURN", "TRANSFER_IN", "ADJUSTMENT_IN", "REVERSAL_IN"}
OUTBOUND = {"ISSUE", "SCRAP", "VENDOR_RETURN", "TRANSFER_OUT", "ADJUSTMENT_OUT", "REVERSAL_OUT"}
VALID_TYPES = INBOUND | OUTBOUND | {"TRANSFER", "QC_PASS", "PUT_AWAY", "JOB_POSTED", "INVOICE_POSTED"}


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def append_event(db: Session, *, part_id: int, event_type: str, quantity: int, actor_id: str,
                 source_location: str | None = None, destination_location: str | None = None,
                 job_id: str | None = None, vehicle_id: str | None = None,
                 document_id: str | None = None, dock: str | None = None,
                 occurred_at: datetime | None = None, idempotency_key: str | None = None,
                 corrects_event_id: str | None = None, source_class: str = "RAAM_OBSERVED",
                 metadata: dict | None = None) -> InventoryEvent:
    kind = event_type.upper()
    if kind not in VALID_TYPES:
        raise ValueError(f"Unsupported event type: {kind}")
    if quantity < 0:
        raise ValueError("quantity must be a non-negative magnitude")
    if idempotency_key:
        prior = db.scalar(select(InventoryEvent).where(InventoryEvent.idempotency_key == idempotency_key))
        if prior:
            return prior

    previous = db.scalar(select(InventoryEvent).order_by(InventoryEvent.id.desc()).limit(1))
    occurred = occurred_at or datetime.now(timezone.utc)
    event_id = str(uuid4())
    payload = {
        "event_id": event_id, "part_id": part_id, "event_type": kind, "quantity": quantity,
        "source_location": source_location, "destination_location": destination_location,
        "actor_id": actor_id, "job_id": job_id, "vehicle_id": vehicle_id,
        "document_id": document_id, "dock": dock, "occurred_at": occurred.isoformat(),
        "previous_hash": previous.event_hash if previous else None,
        "corrects_event_id": corrects_event_id, "source_class": source_class,
        "metadata": metadata or {},
    }
    digest = hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()
    event = InventoryEvent(
        event_id=event_id, part_id=part_id, event_type=kind, quantity=quantity,
        source_location=source_location, destination_location=destination_location,
        actor_id=actor_id, job_id=job_id, vehicle_id=vehicle_id, document_id=document_id,
        dock=dock, occurred_at=occurred, idempotency_key=idempotency_key,
        previous_hash=previous.event_hash if previous else None, event_hash=digest,
        corrects_event_id=corrects_event_id, source_class=source_class, metadata_json=metadata or {},
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def verify_hash_chain(events: list[InventoryEvent]) -> tuple[bool, str | None]:
    """Verify stored chain linkage and integrity. Events must be ordered by append ID."""
    previous_hash: str | None = None
    for event in events:
        if event.previous_hash != previous_hash:
            return False, f"Chain link mismatch at event {event.event_id}"
        occurred = event.occurred_at
        if occurred.tzinfo is None:
            occurred = occurred.replace(tzinfo=timezone.utc)
        payload = {
            "event_id": event.event_id, "part_id": event.part_id, "event_type": event.event_type,
            "quantity": event.quantity, "source_location": event.source_location,
            "destination_location": event.destination_location, "actor_id": event.actor_id,
            "job_id": event.job_id, "vehicle_id": event.vehicle_id, "document_id": event.document_id,
            "dock": event.dock, "occurred_at": occurred.isoformat(),
            "previous_hash": event.previous_hash, "corrects_event_id": event.corrects_event_id,
            "source_class": event.source_class, "metadata": event.metadata_json or {},
        }
        actual = hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()
        if actual != event.event_hash:
            return False, f"Digest mismatch at event {event.event_id}"
        previous_hash = event.event_hash
    return True, None


def ledger_delta(event_type: str, quantity: int) -> int:
    """State-machine helper; transfers are two paired events to preserve location balances."""
    kind = event_type.upper()
    if kind in INBOUND:
        return quantity
    if kind in OUTBOUND:
        return -quantity
    return 0


def fold_ledger(events: list[InventoryEvent], opening_balances: dict[tuple[int, str], int] | None = None,
                snapshot_times: dict[tuple[int, str], datetime] | None = None) -> dict[tuple[int, str], int]:
    """Replay event deltas over location balances, optionally anchored by physical inventory snapshots.

    Locations are stable bin codes. A transfer is atomic in the event graph and changes both ends.
    Opening balances are treated as the state through their corresponding snapshot timestamp.
    """
    balances = dict(opening_balances or {})
    times = snapshot_times or {}
    inbound = {"RECEIPT", "RETURN", "TRANSFER_IN", "ADJUSTMENT_IN", "REVERSAL_IN"}
    outbound = {"ISSUE", "SCRAP", "VENDOR_RETURN", "TRANSFER_OUT", "ADJUSTMENT_OUT", "REVERSAL_OUT"}
    for event in sorted(events, key=lambda e: (e.occurred_at, e.id or 0)):
        occurred = event.occurred_at
        if occurred.tzinfo is None:
            occurred = occurred.replace(tzinfo=timezone.utc)
        source = event.source_location or "__UNLOCATED__"
        destination = event.destination_location or "__UNLOCATED__"
        kind = event.event_type.upper()
        if kind == "TRANSFER":
            if event.source_location and occurred > times.get((event.part_id, source), datetime.min.replace(tzinfo=timezone.utc)):
                key = (event.part_id, source); balances[key] = balances.get(key, 0) - event.quantity
            if event.destination_location and occurred > times.get((event.part_id, destination), datetime.min.replace(tzinfo=timezone.utc)):
                key = (event.part_id, destination); balances[key] = balances.get(key, 0) + event.quantity
        elif kind in inbound:
            if occurred > times.get((event.part_id, destination), datetime.min.replace(tzinfo=timezone.utc)):
                key = (event.part_id, destination); balances[key] = balances.get(key, 0) + event.quantity
        elif kind in outbound:
            if occurred > times.get((event.part_id, source), datetime.min.replace(tzinfo=timezone.utc)):
                key = (event.part_id, source); balances[key] = balances.get(key, 0) - event.quantity
    return balances
