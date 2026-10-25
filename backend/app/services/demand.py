from __future__ import annotations
from dataclasses import dataclass
import math
import random
from statistics import mean, variance


@dataclass(frozen=True)
class DemandProfile:
    demand_class: str
    zero_fraction: float
    positive_cv_squared: float
    mean_per_period: float


def classify_demand(series: list[int]) -> DemandProfile:
    if not series:
        return DemandProfile("insufficient_history", 1.0, 0.0, 0.0)
    values = [max(0, int(x)) for x in series]
    positive = [x for x in values if x > 0]
    zero_fraction = sum(1 for x in values if x == 0) / len(values)
    cv2 = variance(positive) / (mean(positive) ** 2) if len(positive) > 1 and mean(positive) else 0.0
    if len(values) < 6:
        cls = "insufficient_history"
    elif zero_fraction >= 0.5 and cv2 > 0.49:
        cls = "lumpy"
    elif zero_fraction >= 0.5:
        cls = "intermittent"
    elif cv2 > 0.49:
        cls = "erratic"
    else:
        cls = "smooth"
    return DemandProfile(cls, zero_fraction, cv2, sum(values) / len(values))


def croston_sba(series: list[int], alpha: float = 0.1) -> float:
    """Syntetos-Boylan-adjusted Croston estimate. Uses positive sizes / intervals."""
    positives = [(i, x) for i, x in enumerate(series) if x > 0]
    if not positives:
        return 0.0
    z = float(positives[0][1])
    interval = float(positives[0][0] + 1)
    last = positives[0][0]
    for index, amount in positives[1:]:
        z = alpha * amount + (1 - alpha) * z
        interval = alpha * (index - last) + (1 - alpha) * interval
        last = index
    return max(0.0, (1 - alpha / 2) * z / max(interval, 1e-6))


def tsb(series: list[int], alpha_probability: float = 0.1, alpha_size: float = 0.1) -> float:
    """Teunter-Syntetos-Babai: separate occurrence probability and positive demand size."""
    if not series:
        return 0.0
    positives = [int(x) for x in series if x > 0]
    p = 1.0 if series[0] > 0 else 0.0
    size = float(positives[0]) if positives else 0.0
    for value in series:
        p = alpha_probability * int(value > 0) + (1 - alpha_probability) * p
        if value > 0:
            size = alpha_size * value + (1 - alpha_size) * size
    return max(0.0, p * size)


def _decision_loss(actual: int, predicted: float, under_penalty: float, over_penalty: float) -> float:
    return under_penalty * max(0.0, actual - predicted) + over_penalty * max(0.0, predicted - actual)


def rolling_origin_select(series: list[int], *, under_penalty: float = 3.0,
                          over_penalty: float = 1.0, min_train: int = 6) -> dict:
    """Select among transparent baseline methods using time-ordered origins, never a random shuffle."""
    values = [max(0, int(v)) for v in series]
    if not values:
        return {"selected_model": "pooled_mean", "forecast_per_period": 0.0, "scores": {}, "origins": 0}
    scorers = {"croston_sba": croston_sba, "tsb": tsb, "pooled_mean": lambda xs: sum(xs) / len(xs) if xs else 0.0}
    scores: dict[str, list[float]] = {name: [] for name in scorers}
    for origin in range(min_train, len(values)):
        train, actual = values[:origin], values[origin]
        for name, fn in scorers.items():
            pred = fn(train)
            scores[name].append(_decision_loss(actual, pred, under_penalty, over_penalty))
    average_scores = {name: sum(costs) / len(costs) for name, costs in scores.items() if costs}
    if average_scores:
        selected = min(average_scores, key=average_scores.get)
    else:
        selected = "pooled_mean"
    forecast = scorers[selected](values)
    return {"selected_model": selected, "forecast_per_period": forecast,
            "scores": average_scores, "origins": max(0, len(values) - min_train)}


def bootstrap_lead_time_demand(demand_history: list[int], lead_time_days: list[float], *,
                               scenarios: int = 2000, periods_per_day: float = 1.0,
                               seed: int | None = None) -> list[int]:
    """Empirical bootstrap that retains observed lead-time and demand shapes."""
    if not demand_history:
        return [0] * scenarios
    if not lead_time_days:
        raise ValueError("lead_time_days must be populated from observed supplier history")
    rng = random.Random(seed)
    history = [max(0, int(x)) for x in demand_history]
    leads = [max(0.0, float(x)) for x in lead_time_days]
    out: list[int] = []
    for _ in range(scenarios):
        duration = max(0, math.ceil(rng.choice(leads) * periods_per_day))
        out.append(sum(rng.choice(history) for _ in range(duration)))
    return out


def quantile(values: list[float] | list[int], alpha: float) -> float:
    if not values:
        raise ValueError("quantile requires an empirical sample")
    ordered = sorted(values)
    a = min(1.0, max(0.0, alpha))
    idx = int(math.ceil(a * len(ordered)) - 1)
    return float(ordered[max(0, min(len(ordered) - 1, idx))])
