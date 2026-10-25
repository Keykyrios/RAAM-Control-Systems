from __future__ import annotations
from itertools import product


def assign_storage_locations(parts: list[dict], bins: list[dict]) -> dict:
    """Exact assignment for small candidate sets; capacity constraints are respected.

    Each part has candidate_costs [{bin_id, pick_cost, misplacement_probability, audit_cost}].
    For large facilities, use a MIP or decomposition solver while preserving this objective and constraints.
    """
    if not parts or not bins:
        raise ValueError("parts and bins must be non-empty")
    bin_by_id = {str(b["bin_id"]): b for b in bins}
    normalized = []
    for part in parts:
        candidates = []
        volume = max(0.0, float(part["volume"]))
        for candidate in part.get("candidate_costs", []):
            bid = str(candidate["bin_id"])
            if bid not in bin_by_id:
                continue
            cost = float(candidate.get("pick_cost", 0)) + float(candidate.get("misplacement_probability", 0)) * float(part.get("misplacement_penalty", 0)) + float(candidate.get("audit_cost", 0))
            candidates.append((bid, cost, volume))
        if not candidates:
            raise ValueError(f"part {part.get('part_id')} has no feasible bin candidates")
        normalized.append((str(part["part_id"]), candidates))
    # Branch-and-bound preserves exactness for small instances and fails explicitly at a safe size.
    candidate_product = 1
    for _, options in normalized:
        candidate_product *= len(options)
    if candidate_product > 2_000_000:
        raise ValueError("candidate assignment too large for exact reference solver; use MIP/decomposition backend")
    capacities = {bid: max(0.0, float(b.get("capacity_volume", 0))) for bid, b in bin_by_id.items()}
    best_cost = float("inf"); best: dict[str, str] | None = None
    for selection in product(*(opts for _, opts in normalized)):
        used: dict[str, float] = {}
        total_cost = 0.0
        assignment: dict[str, str] = {}
        feasible = True
        for (part_id, _), (bin_id, cost, volume) in zip(normalized, selection):
            used[bin_id] = used.get(bin_id, 0.0) + volume
            if used[bin_id] > capacities[bin_id] + 1e-9:
                feasible = False; break
            total_cost += cost; assignment[part_id] = bin_id
        if feasible and total_cost < best_cost:
            best_cost = total_cost; best = assignment
    if best is None:
        return {"feasible": False, "assignment": {}, "objective_cost": None,
                "reason": "No assignment satisfies all discrete bin-capacity constraints."}
    return {"feasible": True, "assignment": best, "objective_cost": best_cost,
            "reason": "Minimum-cost assignment among enumerated feasible candidates.", "solver": "exact-reference"}


def plan_lateral_transfers(locations: list[dict], *, transfer_capacity: int | None = None) -> dict:
    """Transparent surplus-to-deficit matching baseline for lateral transfer candidates."""
    surplus = [{**x, "remaining": max(0, int(x.get("on_hand", 0)) - int(x.get("target_stock", 0)))} for x in locations]
    deficit = [{**x, "remaining": max(0, int(x.get("target_stock", 0)) - int(x.get("on_hand", 0)))} for x in locations]
    sources = [x for x in surplus if x["remaining"] > 0]
    destinations = [x for x in deficit if x["remaining"] > 0]
    candidates = []
    cap = float("inf") if transfer_capacity is None else max(0, transfer_capacity)
    for dest in sorted(destinations, key=lambda x: (-x["criticality"], x["location_id"])):
        for src in sorted(sources, key=lambda x: (x.get("transfer_cost", 0), x["location_id"])):
            if dest["remaining"] <= 0 or cap <= 0 or src["remaining"] <= 0 or src["location_id"] == dest["location_id"]:
                continue
            q = min(src["remaining"], dest["remaining"], int(cap) if cap != float("inf") else src["remaining"])
            if q <= 0: continue
            cost = q * (float(src.get("transfer_cost", 0)) + float(dest.get("transfer_cost", 0)))
            candidates.append({"part_id": src.get("part_id"), "from_location": src["location_id"],
                               "to_location": dest["location_id"], "quantity": q, "estimated_transfer_cost": cost,
                               "criticality": dest["criticality"], "status": "PROPOSED_NOT_POSTED"})
            src["remaining"] -= q; dest["remaining"] -= q; cap -= q
    return {"proposed_transfers": candidates, "remaining_surplus": sum(x["remaining"] for x in sources),
            "remaining_deficit": sum(x["remaining"] for x in destinations),
            "note": "Reference greedy matcher only. Validate network-flow feasibility and cost before approval."}
