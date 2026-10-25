# RAAM Integrated Spare-Parts Control

A full-stack reference implementation of the RAAM Track 4 *Spare-Parts Control System* whitepaper. It demonstrates a state-first inventory architecture in which physical stock uncertainty, the transaction ledger, intermittent demand, supplier lead times, inventory policy and process lineage are related but never silently collapsed into one quantity.

**Status:** runnable engineering starter, not a production-deployed or calibrated ERP. See [`docs/IMPLEMENTATION_MAP.md`](docs/IMPLEMENTATION_MAP.md) for the covered paper sections and known gaps. The complete copy/paste build prompt, including the entire visual design scheme and wow-layer requirements, is [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md). The visual contract is [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md). The provider protocol is [`docs/VISION_PROVIDER_CONTRACT.md`](docs/VISION_PROVIDER_CONTRACT.md).

## What is included

- React + TypeScript + Vite operations UI, with a Three.js state-bound facility twin, computer-vision workbench, custom Taste Skill-driven CSS, Phosphor icons and a persistent synthetic-data warning in fallback/demo mode.
- FastAPI + Pydantic + SQLAlchemy API with SQLite local development and PostgreSQL deployment configuration.
- Separate ledger and physical-state snapshot models, immutable events with a SHA-256 append-chain, idempotency keys and ledger replay.
- A discrete particle-filter reference service for physical stock uncertainty; a verified audit can collapse the reference posterior.
- Croston/SBA and TSB intermittent-demand baselines, demand-class classification and time-ordered rolling-origin selection.
- Empirical supplier lead-time bootstrap, finite-candidate replenishment with budget/capacity feasibility checks and CVaR-style tail penalty, audit time-budget selection, spatial placement, transfer proposals, process-conformance checks, and evaluation helpers.
- Synthetic sample seed script that refuses to run when demo mode is off or parts already exist.
- Configurable computer-vision provider adapter (`POST /api/v1/vision/analyze`) with file-type/signature validation, 10 MB limit, timeouts, normalized model-output contract and explicit no-provider `503` behavior. The starter does not bundle or pretend to include a trained model.
- API contract via FastAPI's OpenAPI docs and unit tests for core algorithms and the CV provider contract.

## Quick start: local development

Requirements: Python 3.12+ recommended, Node.js 20+, npm.

### 1. Start the backend

```bash
cd backend
python -m venv .venv
# macOS/Linux
source .venv/bin/activate
# Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
cp ../.env.example .env
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend creates the development schema on startup. OpenAPI documentation is available at `http://localhost:8000/docs`, and health status at `http://localhost:8000/api/v1/health`.

The default database is a local SQLite file in `backend/`. An empty database is intentionally empty: it will not be silently seeded with fictitious operations.

### 2. Optional: add clearly labelled synthetic records

Stop the API, then from `backend/` run:

```bash
DEMO_MODE=true python -m app.seed_demo
```

PowerShell:

```powershell
$env:DEMO_MODE = "true"
python -m app.seed_demo
```

The seed script refuses to run when `DEMO_MODE=false` and refuses to mix demo seed rows into a database that already contains a part. Seed rows carry `source_class=SYNTHETIC_DEMO`. Start the backend again afterwards. Use a disposable local database only.

### 3. Start the frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`. Set `VITE_API_BASE_URL` if the API runs at a different URL. Without a reachable API, the UI falls back to a synthetic preview and shows a permanent provenance banner. A connected but empty database shows “baseline required” states instead of invented live quantities.

The Spatial twin contains an interactive Three.js scene: orbit, zoom, reset, bin selection, and inventory-state / ledger-variance / vision-confidence overlays. It uses a schematic shelf layout until surveyed coordinates are connected. The Vision observations page supports local image preview, a clearly watermarked synthetic overlay, part/bin association from connected registries, and connected inference against an approved provider. Changing the target clears old inference results, and only a provider result with durable evidence provenance can be saved. The synthetic overlay cannot be saved as an operational observation.

To enable real inference, set `VISION_PROVIDER_URL` to an approved multipart HTTP inference endpoint and optionally set `VISION_PROVIDER_API_KEY`. The provider accepts `image`, `part_id`, and `bin_id` form fields and must return `confidence`, `observed_quantity` (or null), optional `occupancy_ratio`, `identifier_candidates`, `count_distribution`, `detections`, `model_version`, and `evidence_uri`. Each detection uses normalized percentage coordinates `[x, y, width, height]`. The returned `evidence_uri` must point to durable, access-controlled image evidence. Without the provider URL, inference intentionally returns HTTP 503.

### 4. Run backend tests

```bash
cd backend
python -m pip install -r requirements.txt
python -m pytest -q
python -m compileall -q app tests
```

## Docker Compose

Docker orchestration includes PostgreSQL, the FastAPI service and the Vite-built frontend. Set a non-default `SECRET_KEY` and review all environment values before using this beyond a local sandbox.

```bash
cp .env.example .env
# Change SECRET_KEY and DATABASE credentials for your environment.
docker compose up --build
```

- UI: `http://localhost:5173`
- API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

The compose setup is for local integration testing, not a hardened production deployment. It does not include production identity, access control, TLS termination, migrations, monitoring or backup/archive policy.

## API map

Base prefix: `/api/v1`

| Route | Purpose |
|---|---|
| `GET /health`, `GET /overview` | Service health and sourced counts |
| `GET /parts`, `GET /locations`, `GET /inventory/state` | Master data and baseline state projection |
| `GET /events`, `POST /events`, `GET /events/integrity` | Append-only event stream, event write and hash-chain verification |
| `GET /observations`, `POST /observations` | Vision/barcode/OCR/manual evidence records |
| `POST /vision/analyze` | Upload an image to the configured computer-vision provider; explicit 503 when no provider is configured |
| `GET /reconciliation/cases`, `POST /reconciliation/cases` | Reconciliation queue data |
| `POST /physical-state/filter` | Posterior update for physical inventory |
| `POST /forecast/demand` | Intermittent-demand baseline forecast/model-class selection |
| `POST /forecast/lead-time-demand` | Bootstrap lead-time-demand scenarios and service quantile |
| `POST /control/run`, `GET /control/runs` | Reference optimizer, feasibility checks and proposal records |
| `POST /audits/plan` | Select audits under inspection-time budget |
| `POST /process-conformance/check` | Validate event state-machine paths |
| `POST /spatial/assign`, `POST /transfers/plan` | Storage assignment and lateral-transfer proposals |
| `POST /evaluations/forecast` | Forecast metrics and interval diagnostics |
| `POST /scenarios/run` | Scenario result gate, refusing to fabricate counterfactual benefits without empirical trajectories |

Schemas and exact request/response formats are available in OpenAPI after the server starts.

## Whitepaper-derived product rules

1. **Physical quantity is uncertain.** Never equate a ledger number to the physical truth by default.
2. **Events are appended, not rewritten.** Corrections should be compensating events that point back to the original.
3. **Vision supplies evidence.** It is not a reorder decision maker.
4. **Recommendations are proposals.** Approval and posting need authorized identity, validation and auditable event linkage before operational adoption.
5. **Forecasting uses time order.** Do not randomly shuffle sparse demand histories; include business cost as well as forecast error.
6. **Lead-time uncertainty stays empirical** unless diagnostics support a parametric approximation.
7. **Audits are decisions** constrained by time, eligibility and expected value, not just calendar frequency.
8. **A movement anomaly is not an accusation.** It produces a reconciliation case with evidence and an unresolved-state probability.
9. **Do not invent business savings.** Scenario outputs require observed, paired trajectories and explicit source classification.
10. **Source classes remain visible.** `RAAM_OBSERVED`, published evidence, public benchmark and `SYNTHETIC_DEMO` must not be merged into one unlabeled KPI.

## Current production gaps

This code does **not** include live RAAM integrations, an evaluated camera/OCR model, complete RBAC/authentication, a signed approval endpoint, Alembic migrations, WORM event archive, the paper's full-scale MILP/Lagrangian/column-generation optimizer, validated Negative Binomial/GBM/stacking adapters, a state-bound 3D twin, full historical replay orchestration or production observability. The reference algorithms, front-end placeholders and extension points are described in `docs/IMPLEMENTATION_MAP.md` and the master prompt. Do not use it to trigger purchase orders or change production inventory without that work and operational validation.

## Design source

The implementation's only design methodology is Taste Skill v2 (`design-taste-frontend`): <https://github.com/Leonxlnx/taste-skill>. See `docs/DESIGN_SYSTEM.md` for the exact tokens and acceptance checklist, reproduced in full in `docs/BUILD_PROMPT.md` so the prompt is self-contained.
