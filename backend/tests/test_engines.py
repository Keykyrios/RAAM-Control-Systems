import pytest
from app.services.demand import classify_demand, croston_sba, tsb, rolling_origin_select, bootstrap_lead_time_demand
from app.services.control import ReplenishmentInput, recommend_replenishment, choose_inspections
from app.services.conformance import check_state_chain, rank_reconciliation_cases
from app.services.physical_state import Particle, update_physical_posterior
from app.services.evaluation import forecast_metrics, inventory_integrity_metrics, policy_delta
from app.services.spatial import assign_storage_locations, plan_lateral_transfers
from app.services.ledger import fold_ledger


def test_classify_intermitent_demand_and_baselines():
    profile = classify_demand([0, 0, 1, 0, 0, 4, 0, 0, 1, 0])
    assert profile.demand_class in {"intermittent", "lumpy"}
    assert croston_sba([0, 0, 1, 0, 0, 2]) >= 0
    assert tsb([0, 0, 1, 0, 0, 2]) >= 0
    assert rolling_origin_select([0, 1, 0, 2, 0, 0, 1, 0])["origins"] >= 0


def test_empirical_lead_time_demand_requires_observed_lead_times():
    with pytest.raises(ValueError):
        bootstrap_lead_time_demand([0, 1, 0, 2], [])
    result = bootstrap_lead_time_demand([0, 1, 0, 2], [1, 2, 3], scenarios=50, seed=11)
    assert len(result) == 50
    assert all(x >= 0 for x in result)


def test_replenishment_stays_inside_budget_and_storage_constraints():
    inp = ReplenishmentInput(sku="BRAKE-X", physical_mean=2,
        lead_time_demand_scenarios=[0, 1, 2, 3, 5, 8, 10], service_level=.9,
        unit_cost=100, unit_volume=.2, holding_cost_per_unit=1, shortage_cost_per_unit=30,
        expedite_cost_per_unit=5, criticality=.95)
    result = recommend_replenishment(inp, budget_remaining=350, capacity_volume_remaining=.6)
    assert result.recommended_order_qty <= 3
    assert result.expected_cost >= 0
    assert result.constraint_limited is True


def test_inspection_knapsack_obeys_time_budget():
    result = choose_inspections([
        {"sku": "A", "minutes": 10, "expected_cost_reduction": 100, "inspection_cost": 10},
        {"sku": "B", "minutes": 20, "expected_cost_reduction": 300, "inspection_cost": 10},
        {"sku": "C", "minutes": 5, "expected_cost_reduction": 5, "inspection_cost": 20},
    ], available_minutes=20)
    assert result["minutes_used"] <= 20
    assert {x["sku"] for x in result["selected"]} == {"B"}


def test_physical_filter_audit_collapses_uncertainty():
    prior = [Particle(q, 0, 1 / 5) for q in range(3, 8)]
    posterior = update_physical_posterior(prior_particles=prior, audit_count=5, seed=2)
    assert posterior.mean == pytest.approx(5)
    assert posterior.variance == pytest.approx(0)


def test_conformance_and_case_priority_do_not_assign_intent():
    result = check_state_chain(["RECEIVE", "QC", "PUT_AWAY", "ISSUE", "BILL"])
    assert not result["conforming"]
    ranked = rank_reconciliation_cases([
        {"posterior_unresolved_probability": .9, "economic_exposure": 100},
        {"posterior_unresolved_probability": .4, "economic_exposure": 400},
    ])
    assert ranked[0]["priority_score"] == 160
    assert "not a conclusion" in result["interpretation"].lower()


def test_evaluation_metrics_keep_zero_demand_well_defined():
    metrics = forecast_metrics([0, 0, 2, 1], [0, 1, 1, 2], training_series=[0, 1, 0, 1, 0])
    assert metrics["mae"] >= 0
    assert metrics["rmse"] >= 0
    iri = inventory_integrity_metrics([3, 2], [4, 2], [10, 5])
    assert iri["unit_iri_mean"] > 0
    assert "signed_value_bias" in iri
    delta = policy_delta([10, 20], [8, 18])
    assert delta["delta_cost"] == 2


def test_spatial_assignment_respects_discrete_capacity_and_transfer_is_proposal():
    assignment = assign_storage_locations(
        parts=[{"part_id": "P1", "volume": .6, "misplacement_penalty": 10, "candidate_costs": [
            {"bin_id": "A", "pick_cost": 1, "misplacement_probability": .1},
            {"bin_id": "B", "pick_cost": 2, "misplacement_probability": 0}]}],
        bins=[{"bin_id": "A", "capacity_volume": .5}, {"bin_id": "B", "capacity_volume": 1.0}],
    )
    assert assignment["feasible"] is True
    assert assignment["assignment"]["P1"] == "B"
    plan = plan_lateral_transfers([
        {"location_id": "L1", "on_hand": 10, "target_stock": 4, "criticality": .4, "transfer_cost": 1},
        {"location_id": "L2", "on_hand": 1, "target_stock": 5, "criticality": .9, "transfer_cost": 2},
    ])
    assert plan["proposed_transfers"][0]["quantity"] == 4
    assert plan["proposed_transfers"][0]["status"] == "PROPOSED_NOT_POSTED"


def test_ledger_fold_applies_snapshot_anchor_and_atomic_transfer():
    from types import SimpleNamespace
    from datetime import datetime, timezone, timedelta
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    t1 = t0 + timedelta(days=1)
    t2 = t0 + timedelta(days=2)
    opening = {(1, "BIN-A"): 10}
    snapshot_times = {(1, "BIN-A"): t0}
    events = [
        SimpleNamespace(id=1, occurred_at=t1, part_id=1, event_type="ISSUE", quantity=2, source_location="BIN-A", destination_location=None),
        SimpleNamespace(id=2, occurred_at=t2, part_id=1, event_type="TRANSFER", quantity=3, source_location="BIN-A", destination_location="BIN-B"),
    ]
    state = fold_ledger(events, opening, snapshot_times)
    assert state[(1, "BIN-A")] == 5
    assert state[(1, "BIN-B")] == 3


def test_event_hash_chain_and_idempotent_posting():
    from decimal import Decimal
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import sessionmaker
    from app.core.database import Base
    from app.models.entities import InventoryEvent, Part
    from app.services.ledger import append_event, verify_hash_chain

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    with Session() as db:
        part = Part(sku="TEST-SPARE-01", name="Test spare", unit_cost=Decimal("10.00"),
                    unit_volume=Decimal("0.01"), criticality=0.5, lifecycle_stage="active",
                    source_class="SYNTHETIC_DEMO")
        db.add(part)
        db.commit()
        first = append_event(db, part_id=part.id, event_type="RECEIPT", quantity=5,
                             actor_id="test-actor", destination_location="BIN-A",
                             source_class="SYNTHETIC_DEMO", idempotency_key="test-key-1")
        duplicate = append_event(db, part_id=part.id, event_type="RECEIPT", quantity=5,
                                 actor_id="test-actor", destination_location="BIN-A",
                                 source_class="SYNTHETIC_DEMO", idempotency_key="test-key-1")
        second = append_event(db, part_id=part.id, event_type="ISSUE", quantity=2,
                              actor_id="test-actor", source_location="BIN-A",
                              source_class="SYNTHETIC_DEMO", idempotency_key="test-key-2")
        events = list(db.scalars(select(InventoryEvent).order_by(InventoryEvent.id)))
        valid, error = verify_hash_chain(events)
        assert duplicate.event_id == first.event_id
        assert len(events) == 2
        assert second.previous_hash == first.event_hash
        assert valid is True
        assert error is None
    engine.dispose()
