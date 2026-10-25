from __future__ import annotations
from collections import defaultdict
from typing import Iterable

# Transitions are intentionally explicit: deviations create reconciliation work, not allegations.
ALLOWED_TRANSITIONS: set[tuple[str, str]] = {
    ("RECEIVE", "QC"), ("QC", "PUT_AWAY"), ("PUT_AWAY", "ISSUE"),
    ("ISSUE", "JOB"), ("JOB", "BILL"), ("ISSUE", "RETURN"),
    ("RECEIVE", "VENDOR_RETURN"), ("PUT_AWAY", "TRANSFER"), ("ISSUE", "SCRAP"),
    ("TRANSFER", "PUT_AWAY"), ("RETURN", "QC"), ("QC", "VENDOR_RETURN"),
}
REQUIRED_EDGES = {"ISSUE": {"JOB"}, "JOB": {"BILL"}, "RECEIVE": {"QC"}, "QC": {"PUT_AWAY"}}


def check_state_chain(states: list[str]) -> dict:
    transitions = list(zip(states, states[1:]))
    invalid = [{"from": a, "to": b, "index": i} for i, (a, b) in enumerate(transitions)
               if (a.upper(), b.upper()) not in ALLOWED_TRANSITIONS]
    missing = []
    observed = {b.upper() for _, b in transitions}
    for state in states:
        for expected in REQUIRED_EDGES.get(state.upper(), set()):
            if expected not in observed:
                missing.append({"from": state.upper(), "required_next": expected})
    return {"conforming": not invalid and not missing, "invalid_transitions": invalid,
            "missing_edges": missing, "interpretation": "Unexplained process path; this is not a conclusion about intent. Reconcile the evidence path."}


def rank_reconciliation_cases(cases: Iterable[dict]) -> list[dict]:
    ranked = []
    for case in cases:
        probability = min(1.0, max(0.0, float(case.get("posterior_unresolved_probability", 0))))
        exposure = max(0.0, float(case.get("economic_exposure", 0)))
        ranked.append({**case, "priority_score": probability * exposure})
    return sorted(ranked, key=lambda c: c["priority_score"], reverse=True)
