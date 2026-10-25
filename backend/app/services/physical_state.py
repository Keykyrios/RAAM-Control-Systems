from __future__ import annotations
from dataclasses import dataclass
import math
import random


@dataclass(frozen=True)
class Particle:
    quantity: int
    unobserved_loss: int
    weight: float


@dataclass(frozen=True)
class PosteriorSummary:
    mean: float
    variance: float
    lower_credible: int
    upper_credible: int
    probability_below_zero: float
    particles: tuple[Particle, ...]


def _normal_likelihood(observed: float, expected: float, sigma: float) -> float:
    sigma = max(float(sigma), 0.25)
    z = (observed - expected) / sigma
    return math.exp(-0.5 * z * z) / (sigma * math.sqrt(2 * math.pi))


def update_physical_posterior(*, prior_particles: list[Particle], ledger_delta: int = 0,
                              observed_count: int | None = None, observation_sigma: float = 1.0,
                              loss_probability: float = 0.01, loss_max_units: int = 2,
                              audit_count: int | None = None, seed: int | None = None) -> PosteriorSummary:
    """A compact discrete particle filter for countable stock; no false hard count under uncertainty.

    Real production deployments should calibrate transition and observation likelihoods using labeled Raam
    scans/audits. This routine deliberately exposes its assumptions instead of claiming a trained vision model.
    """
    if not prior_particles:
        raise ValueError("at least one prior particle is required")
    rng = random.Random(seed)
    candidates: list[tuple[int, int, float]] = []
    for p in prior_particles:
        transition_loss = 0
        if loss_max_units > 0 and rng.random() < max(0.0, min(loss_probability, 1.0)):
            transition_loss = rng.randint(1, loss_max_units)
        q = max(0, p.quantity + ledger_delta - transition_loss)
        loss = max(0, p.unobserved_loss + transition_loss)
        likelihood = max(p.weight, 1e-15)
        if audit_count is not None:
            likelihood *= 1e6 if q == audit_count else 1e-9
        elif observed_count is not None:
            likelihood *= _normal_likelihood(observed_count, q, observation_sigma)
        candidates.append((q, loss, likelihood))

    weight_sum = sum(item[2] for item in candidates) or 1.0
    normalized = [(q, loss, w / weight_sum) for q, loss, w in candidates]
    # Systematic resampling makes the finite particle representation stable and easy to inspect.
    n = len(normalized)
    cumulative: list[float] = []
    total = 0.0
    for _, _, w in normalized:
        total += w
        cumulative.append(total)
    start = rng.random() / n
    resampled: list[Particle] = []
    cursor = 0
    for j in range(n):
        point = start + j / n
        while cursor < n - 1 and cumulative[cursor] < point:
            cursor += 1
        q, loss, _ = normalized[cursor]
        resampled.append(Particle(q, loss, 1 / n))

    quantities = sorted(p.quantity for p in resampled)
    mean = sum(p.quantity * p.weight for p in resampled)
    variance = sum(p.weight * (p.quantity - mean) ** 2 for p in resampled)
    lower_idx = max(0, int(0.05 * (n - 1)))
    upper_idx = min(n - 1, int(0.95 * (n - 1)))
    return PosteriorSummary(mean, variance, quantities[lower_idx], quantities[upper_idx], 0.0, tuple(resampled))


def summarize_posterior(particles: list[tuple[int, float]]) -> dict:
    """Validate and summarize externally supplied weighted discrete states."""
    if not particles:
        raise ValueError("posterior particles cannot be empty")
    weights = [max(0.0, float(w)) for _, w in particles]
    denom = sum(weights)
    if denom <= 0:
        weights = [1 / len(particles)] * len(particles)
    else:
        weights = [w / denom for w in weights]
    mean = sum(int(q) * w for (q, _), w in zip(particles, weights))
    var = sum(w * (int(q) - mean) ** 2 for (q, _), w in zip(particles, weights))
    return {"mean": mean, "variance": var, "lower_credible": min(q for q, _ in particles),
            "upper_credible": max(q for q, _ in particles)}
