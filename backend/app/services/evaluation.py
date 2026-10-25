from __future__ import annotations
import math
from statistics import mean


def _pair(actual: list[float], predicted: list[float]) -> tuple[list[float], list[float]]:
    if len(actual) != len(predicted) or not actual:
        raise ValueError("actual and predicted must be non-empty and have equal length")
    return [float(x) for x in actual], [float(x) for x in predicted]


def forecast_metrics(actual: list[float], predicted: list[float], *, training_series: list[float] | None = None,
                     quantile_tau: float = 0.5, lower: list[float] | None = None,
                     upper: list[float] | None = None, coverage_target: float = 0.9) -> dict:
    y, p = _pair(actual, predicted)
    errors = [a - f for a, f in zip(y, p)]
    result = {"n": len(y), "mae": mean(abs(e) for e in errors),
              "rmse": math.sqrt(mean(e * e for e in errors)),
              "mean_error": mean(errors)}
    if training_series and len(training_series) > 1:
        scale = mean(abs(float(training_series[i]) - float(training_series[i - 1])) for i in range(1, len(training_series)))
        result["mase"] = result["mae"] / scale if scale else None
    else:
        result["mase"] = None
    tau = min(1.0, max(0.0, quantile_tau))
    result["pinball_loss"] = mean(max(tau * e, (tau - 1) * e) for e in errors)
    if lower is not None or upper is not None:
        if lower is None or upper is None or len(lower) != len(y) or len(upper) != len(y):
            raise ValueError("lower and upper interval arrays must both match actual length")
        pairs = list(zip(y, [float(v) for v in lower], [float(v) for v in upper]))
        result["interval_coverage"] = mean(1.0 if lo <= a <= hi else 0.0 for a, lo, hi in pairs)
        result["interval_width"] = mean(max(0.0, hi - lo) for _, lo, hi in pairs)
        result["coverage_target"] = coverage_target
    return result


def inventory_integrity_metrics(physical: list[float], ledger: list[float], unit_values: list[float]) -> dict:
    if not physical or len(physical) != len(ledger) or len(physical) != len(unit_values):
        raise ValueError("physical, ledger and unit_values must be non-empty arrays of equal length")
    i = [abs(float(x) - float(r)) / max(1.0, float(x), float(r)) for x, r in zip(physical, ledger)]
    p_value = sum(float(v) * float(x) for v, x in zip(unit_values, physical))
    r_value = sum(float(v) * float(r) for v, r in zip(unit_values, ledger))
    denom = max(1.0, r_value)
    return {"unit_iri_mean": mean(i), "value_iri": abs(p_value - r_value) / denom,
            "signed_value_bias": p_value - r_value, "physical_value": p_value, "ledger_value": r_value,
            "n": len(physical)}


def audit_precision_recall(predicted_positive: list[bool], actual_positive: list[bool]) -> dict:
    if not predicted_positive or len(predicted_positive) != len(actual_positive):
        raise ValueError("audit labels must be non-empty and equal length")
    tp = sum(p and a for p, a in zip(predicted_positive, actual_positive))
    fp = sum(p and not a for p, a in zip(predicted_positive, actual_positive))
    fn = sum((not p) and a for p, a in zip(predicted_positive, actual_positive))
    return {"true_positive": tp, "false_positive": fp, "false_negative": fn,
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None}


def policy_delta(baseline_costs: list[float], proposed_costs: list[float],
                 baseline_service: list[float] | None = None, proposed_service: list[float] | None = None) -> dict:
    if not baseline_costs or len(baseline_costs) != len(proposed_costs):
        raise ValueError("baseline/proposed costs must be non-empty and paired on the same trajectories")
    out = {"baseline_mean_cost": mean(baseline_costs), "proposed_mean_cost": mean(proposed_costs),
           "delta_cost": mean(b - p for b, p in zip(baseline_costs, proposed_costs)),
           "relative_cost_reduction": (mean(baseline_costs) - mean(proposed_costs)) / mean(baseline_costs) if mean(baseline_costs) else None,
           "trajectory_count": len(baseline_costs)}
    if baseline_service is not None or proposed_service is not None:
        if baseline_service is None or proposed_service is None or len(baseline_service) != len(baseline_costs) or len(proposed_service) != len(baseline_costs):
            raise ValueError("service vectors must both be present and paired with cost trajectories")
        out["delta_service"] = mean(float(p) - float(b) for b, p in zip(baseline_service, proposed_service))
    return out
