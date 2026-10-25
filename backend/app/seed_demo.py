"""Explicitly create synthetic sandbox records for development. Never run in production."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from sqlalchemy import select
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.models.entities import Part, Supplier, StorageLocation, StorageBin, DemandObservation, SupplierLeadTime, InventorySnapshot


def uuidstr() -> str:
    from uuid import uuid4
    return uuid4().hex[:10]

if not settings.demo_mode:
    raise SystemExit("Refusing to seed demo records because DEMO_MODE is false.")

Base.metadata.create_all(bind=engine)
now = datetime.now(timezone.utc)
with SessionLocal() as db:
    if db.scalar(select(Part.id).limit(1)):
        raise SystemExit("Database already contains parts; refusing to mix demo data with operational records.")
    suppliers = [Supplier(code="DEMO-SUP-01", name="Demo Supplier North"), Supplier(code="DEMO-SUP-02", name="Demo Supplier West")]
    db.add_all(suppliers); db.flush()
    location = StorageLocation(code="DEMO-SITE-MUM", name="Demonstration Service Centre", site_code="DEMO-MUM", capacity_volume=Decimal("12.50"))
    db.add(location); db.flush()
    bins = [StorageBin(code=f"DEMO-BIN-{i:02d}", location_id=location.id, capacity_volume=Decimal("1.50"), x_coord=i % 3, y_coord=i // 3, z_coord=0) for i in range(1, 7)]
    db.add_all(bins); db.flush()
    definitions = [
        ("DEMO-BRK-014", "Front brake pad kit", "Urban SUV", 1840, 0.08, 0.94, "active", suppliers[0].id),
        ("DEMO-FLT-027", "Oil filter cartridge", "Diesel utility", 320, 0.03, 0.66, "active", suppliers[1].id),
        ("DEMO-SEN-103", "Crankshaft position sensor", "Passenger", 2650, 0.02, 0.91, "active", suppliers[0].id),
        ("DEMO-BLT-009", "Accessory drive belt", "Urban SUV", 960, 0.04, 0.52, "active", suppliers[1].id),
        ("DEMO-CLP-061", "Retainer clip set", "Cross-platform", 85, 0.01, 0.28, "active", suppliers[1].id),
        ("DEMO-PMP-044", "Coolant circulation pump", "Diesel utility", 4280, 0.14, 0.87, "active", suppliers[0].id),
    ]
    parts = []
    for sku, name, family, cost, volume, criticality, stage, supplier_id in definitions:
        part = Part(sku=sku, name=name, vehicle_family=family, unit_cost=Decimal(cost), unit_volume=Decimal(str(volume)),
                    criticality=criticality, lifecycle_stage=stage, supplier_id=supplier_id, source_class="SYNTHETIC_DEMO")
        db.add(part); parts.append(part)
    db.flush()
    # Low-variance sample records are marked SYNTHETIC_DEMO and should never be displayed as RAAM results.
    snapshot_data = [(18, 14.6, 0.82), (64, 62.3, 0.96), (7, 4.2, 0.69), (23, 22.5, 0.98), (110, 102.1, 0.73), (4, 3.4, 0.91)]
    for idx, part in enumerate(parts):
        ledger_qty, physical_mean, confidence = snapshot_data[idx]
        db.add(InventorySnapshot(part_id=part.id, bin_id=bins[idx].id, as_of=now, ledger_quantity=ledger_qty,
            physical_mean=physical_mean, physical_variance=1.8 if confidence < 0.8 else 0.7,
            posterior={"type": "synthetic_demo", "credible_interval_90": [max(0, int(physical_mean - 2)), int(physical_mean + 2)]},
            confidence=confidence, source_class="SYNTHETIC_DEMO"))
    series = {parts[0].id: [0, 1, 0, 2, 0, 0, 1, 0, 3, 0, 1, 0],
              parts[1].id: [8, 9, 7, 10, 9, 8, 11, 7, 8, 10, 9, 8],
              parts[2].id: [0, 0, 1, 0, 0, 0, 2, 0, 0, 1, 0, 0],
              parts[3].id: [1, 2, 0, 1, 1, 3, 0, 1, 2, 1, 0, 2],
              parts[4].id: [16, 18, 14, 20, 17, 19, 21, 16, 15, 22, 18, 19],
              parts[5].id: [0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0]}
    for part_id, values in series.items():
        for offset, quantity in enumerate(values):
            db.add(DemandObservation(part_id=part_id, period_start=now - timedelta(days=(11-offset)*30),
                                     quantity=quantity, source_class="SYNTHETIC_DEMO"))
    for supplier in suppliers:
        for day in [5, 6, 7, 7, 8, 10, 12, 6, 9, 15, 8, 7]:
            db.add(SupplierLeadTime(supplier_id=supplier.id, purchase_order_id=f"DEMO-PO-{uuidstr()}",
                confirmed_at=now - timedelta(days=day + 20), received_at=now - timedelta(days=20),
                lead_time_days=day, regime="demo-normal", source_class="SYNTHETIC_DEMO"))
    db.commit()
print("Seeded synthetic demo records. Every record is tagged SYNTHETIC_DEMO.")

