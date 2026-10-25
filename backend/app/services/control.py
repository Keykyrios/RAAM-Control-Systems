from __future__ import annotations
from dataclasses import dataclass
import math
from app.services.demand import quantile


@dataclass(frozen=True)
class ReplenishmentInput:
    sku: str
    physical_mean: float
    lead_time_demand_scenarios: list[int]
    service_level: float
    unit_cost: float
    unit_volume: float
    holding_cost_per_unit: float
    shortage_cost_per_unit: float
    expedite_cost_per_unit: float
    current_order_qty: int = 0
    criticality: float = 0.5


@dataclass(frozen=True)
class ReplenishmentDecision:
    sku: str
    recommended_order_qty: int
    service_level: float
    projected_service_level: float
    expected_shortage_units: float
    expected_holding_units: float
    expected_cost: float
    cvar_tail_cost: float
    constraint_limited: bool
    explanation: str


def empirical_cvar(costs: list[float], gamma: float = 0.95) -> float:
    if not costs:
        return 0.0
    threshold = quantile(costs, gamma)
    tail = [c for c in costs if c >= threshold]
    return sum(tail) / len(tail) if tail else threshold


def recommend_replenishment(inp: ReplenishmentInput, *, budget_remaining: float,
                            capacity_volume_remaining: float, risk_weight: float = 0.25,
                            cvar_gamma: float = 0.95, max_order_qty: int = 10000) -> ReplenishmentDecision:
    """Small-SKU empirical optimizer with explicit service, budget, capacity and tail-risk checks.

    For network-scale optimization, replace the candidate loop with MILP/decomposition and column generation;
    retain this routine as a transparent reference policy and feasible fallback.
    """
    if not inp.lead_time_demand_scenarios:
        raise ValueError("replenishment requires empirical lead-time-demand scenarios")
    if inp.unit_cost < 0 or inp.unit_volume < 0:
        raise ValueError("unit cost and unit volume cannot be negative")
    target = int(math.ceil(quantile(inp.lead_time_demand_scenarios, inp.service_level)))
    shortage_before = [max(0, d - inp.physical_mean) for d in inp.lead_time_demand_scenarios]
    candidates: list[tuple[float, int, float, float, float]] = []
    for q in range(0, max_order_qty + 1):
        if q * inp.unit_cost > max(0.0, budget_remaining) + 1e-9:
            break
        if q * inp.unit_volume > max(0.0, capacity_volume_remaining) + 1e-9:
            break
        ending = [inp.physical_mean + q - d for d in inp.lead_time_demand_scenarios]
        service = sum(1 for x in ending if x >= 0) / len(ending)
        shortage = sum(max(0.0, -x) for x in ending) / len(ending)
        holding = sum(max(0.0, x) for x in ending) / len(ending)
        scenario_costs = [max(0, -x) * inp.shortage_cost_per_unit + max(0, x) * inp.holding_cost_per_unit for x in ending]
        expected_cost = sum(scenario_costs) / len(scenario_costs) + q * inp.unit_cost
        cvar = empirical_cvar(scenario_costs, cvar_gamma)
        objective = expected_cost + risk_weight * cvar
        # The service constraint is prioritized, then the economic objective breaks ties.
        candidates.append((objective, q, service, shortage, holding))
    if not candidates:
        # No feasible order quantity, including zero, should be impossible with non-negative constraints,
        # but keep the behavior fail-safe if constraints were supplied incorrectly.
        return ReplenishmentDecision(inp.sku, 0, inp.service_level, 0.0, sum(shortage_before) / len(shortage_before),
                                     0.0, math.inf, math.inf, True,
                                     "No feasible candidate; manual planner review required.")
    feasible_service = [candidate for candidate in candidates if candidate[2] + 1e-9 >= inp.service_level]
    chosen = min(feasible_service, key=lambda c: c[0]) if feasible_service else min(candidates, key=lambda c: (1 - c[2], c[0]))
    _, q, projected, shortage, holding = chosen
    costs = [max(0, -(inp.physical_mean + q - d)) * inp.shortage_cost_per_unit +
             max(0, inp.physical_mean + q - d) * inp.holding_cost_per_unit
             for d in inp.lead_time_demand_scenarios]
    cvar = empirical_cvar(costs, cvar_gamma)
    capped = q < target
    reason = (f"Order {q} unit(s) against empirical lead-time-demand quantile {target}. "
              f"Projected service is {projected:.1%}; target is {inp.service_level:.1%}. "
              "Budget and storage capacity are included in candidate feasibility.")
    if capped:
        reason += " Constraints limit the order below the service quantile; planner approval is required."
    return ReplenishmentDecision(inp.sku, q, inp.service_level, projected, shortage, holding,
                                 sum(costs) / len(costs) + q * inp.unit_cost, cvar, capped, reason)


def choose_inspections(candidates: list[dict], *, available_minutes: int, eligible_only: bool = True) -> dict:
    """0/1 knapsack audit selection by expected net value of information per time budget."""
    items = []
    for item in candidates:
        if eligible_only and not item.get("eligible", True):
            continue
        minutes = max(1, int(item["minutes"]))
        benefit = float(item.get("expected_cost_reduction", 0)) - float(item.get("inspection_cost", 0))
        if benefit > 0 and minutes <= available_minutes:
            items.append({**item, "minutes": minutes, "net_benefit": benefit})
    # dp[t] = (value, chosen indexes)
    dp: list[tuple[float, list[int]]] = [(0.0, []) for _ in range(available_minutes + 1)]
    for index, item in enumerate(items):
        for t in range(available_minutes, item["minutes"] - 1, -1):
            prev_val, prev_items = dp[t - item["minutes"]]
            score = prev_val + item["net_benefit"]
            if score > dp[t][0]:
                dp[t] = (score, prev_items + [index])
    best_value, chosen_idxs = max(dp, key=lambda pair: pair[0])
    chosen = [items[i] for i in chosen_idxs]
    return {"selected": chosen, "expected_net_value": best_value,
            "minutes_used": sum(item["minutes"] for item in chosen),
            "minutes_available": available_minutes}
