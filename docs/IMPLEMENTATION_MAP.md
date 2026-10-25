# Whitepaper-to-Code Implementation Map

This map tracks the supplied 25-page RAAM Track 4 Spare-Parts Control Whitepaper. The system premise is one closed control loop: physical observation → state estimation → demand/lead-time posterior → constrained optimization → human-approved action → immutable event → updated state.

| Whitepaper content | Project implementation | Status / qualification |
|---|---|---|
| pp. 1–2: physical state, transaction state, decision state; four coupled layers | Overview and state-first domain model; frontend module navigation | UI and reference architecture implemented |
| pp. 3–4: empirical evidence, provenance and cross-industry caveats | `source_class` on parts, snapshots, observations, demand, lead times, cases and runs; Evaluation page; `SYNTHETIC_DEMO` sandbox | Provenance controls implemented; no external benchmark model data is bundled |
| pp. 5–6: master data, event graph, immutable event, physical and ledger states, Bayesian filter | SQLAlchemy entities; append-only `InventoryEvent`; SHA-256 previous-event chain; `fold_ledger`; particle filter | Reference implementation; production requires database permissions/WORM storage, audit retention and calibrated likelihoods |
| pp. 6–7: IRI unit/value, signed bias; inspection value under time/eligibility constraints | IRI/value-bias evaluation helpers; audit knapsack selection service | Reference math implemented; API evaluation currently exposes forecast metrics, not every aggregate report |
| pp. 8–9: intermittent/lumpy demand, occurrence and size, lifecycle pooling, model-class selection by rolling origin and decision loss | `classify_demand`, Croston SBA, TSB, empirical rolling-origin selector; forecast API | Transparent baselines implemented. Negative binomial, GBM, stacked ensembles and lifecycle pooling need validated model adapters and trained history |
| pp. 10–11: empirical supplier lead-time distribution, lead-time demand, criticality-linked service level, chance constraints, CVaR and storage constraints | Empirical bootstrap + quantile API; budget/capacity candidate optimizer and CVaR; storage assignment helpers | Reference algorithms implemented. Network-scale MILP and model calibration are not production-complete |
| pp. 12–13: decomposition, Lagrangian capacity/budget prices, transfer column generation and feasibility-gated learned policy | Transfer matching reference; spatial assignment solver; optimizer returns explicit feasibility/approval fields | Exact/greedy reference only. Lagrangian solver, column generation and learned policy adapters are extension points |
| pp. 14–16: allowed process state machine, missing graph edges, non-accusatory reconciliation, vision IDs/count posterior/fusion | Conformance API; case priority; observations API; physical filter API; `VisionWorkbench.tsx`; `POST /api/v1/vision/analyze`; provider normalizer in `services/vision.py` | Upload/preview, synthetic-overlay watermark, HTTP provider adapter and response validation implemented. A trained detector/OCR/barcode model and secured evidence store are not bundled; configure `VISION_PROVIDER_URL` to connect one |
| pp. 17–18: space graph, placement cost, location assignment, state-bound digital twin, empirical counterfactuals | Spatial assignment service; `WarehouseTwin.tsx` with Three.js, OrbitControls, selectable bins, state/variance/confidence overlays; scenario API refuses to invent deltas without empirical trajectories | 3D interaction is implemented; coordinates are a labeled schematic until real spatial records are integrated. Scenario output intentionally withheld without sourced trajectories |
| pp. 19–20: end-to-end loop, human overrides, forecast/state/policy evaluation, historical replay and external validity | control run API, immutable event model, approval status, evaluation functions and Evaluation page | Authenticated approval endpoint and full historical replay job are deployment work remaining |
| pp. 21–22: failure modes and safeguards; learned-policy feasibility fallback; synthesis | safeguards in UI, `services/` and prompt; explicit source classes and no-intent wording | Operational monitoring, model drift alerts and live control-loop orchestration remain integration work |
| pp. 23–25: references and close | source-grounded design prompt and this mapping | The PDF's cited published numbers are not copied into UI KPIs or presented as this application's results |

## Main backend routes

- `GET /api/v1/health`, `GET /api/v1/overview`
- `GET /api/v1/parts`, `GET /api/v1/locations`, `GET /api/v1/inventory/state`
- `GET /api/v1/events`, `POST /api/v1/events`, `GET /api/v1/events/integrity`
- `GET /api/v1/observations`, `POST /api/v1/observations`, `POST /api/v1/vision/analyze`
- `GET /api/v1/reconciliation/cases`, `POST /api/v1/reconciliation/cases`
- `POST /api/v1/physical-state/filter`
- `POST /api/v1/forecast/demand`, `POST /api/v1/forecast/lead-time-demand`, `POST /api/v1/evaluations/forecast`
- `POST /api/v1/control/run`, `GET /api/v1/control/runs`, `POST /api/v1/audits/plan`
- `POST /api/v1/process-conformance/check`, `POST /api/v1/spatial/assign`, `POST /api/v1/transfers/plan`
- `POST /api/v1/scenarios/run`

Interactive OpenAPI documentation is available at `http://localhost:8000/docs` after startup.

## Production gaps that must not be hidden

1. Authentication, role-based authorization, signed decision approval and actor identity are not implemented.
2. No live RAAM ERP/WMS/DMS/job-card/invoice adapter is bundled. Source schemas, ID mapping, replay and conflict policies must be agreed with the actual systems.
3. The vision layer has an upload-and-inference adapter, validation and observation persistence UI but does not bundle a trained camera/OCR/counting model or evidence object store. Configure an approved provider and durable private evidence storage.
4. Croston/TSB and empirical resampling are transparent baselines. Negative binomial, GBM, stacking, lifecycle pooling, censoring model and calibration/monitoring require historical datasets and validation.
5. The replenishment controller is an auditable finite-candidate reference policy. The whitepaper's full network-level MILP, Lagrangian updates, column generation, learned policy, and constraint certification are not yet a production optimizer.
6. The Three.js twin is interactive and tied to the supplied part records, but the starter layout uses schematic positions. Production must load surveyed spatial coordinates and render from the same state projection and event keys.
7. Scenario cost deltas are intentionally withheld without empirical demand/lead-time/cost trajectories; no counterfactual saving is invented.
8. Production rollout needs migrations, immutable backup/archive, secrets management, integration tests, observability, alerting, data retention, access-controlled image storage, and disaster recovery.

The app can run locally as a functional reference starter. It is not represented as a deployed or fully calibrated production ERP.

## Added high-impact interaction layer

- **Three.js facility twin:** `frontend/src/WarehouseTwin.tsx` renders a 3D rack/bin layout and allows orbit, zoom, reset, selection and three semantic overlays. Populated bins expose their linked state and source label. The layout is explicitly schematic until spatial coordinates are sourced.
- **Computer-vision workbench:** `frontend/src/VisionWorkbench.tsx` supports file drop/upload, preview, local demo boxes marked `SYNTHETIC OVERLAY`, connected inference, posterior/candidate review and explicit save. Demo output is never persisted.
- **Provider adapter:** `backend/app/services/vision.py` validates image signatures and model response bounds; `POST /api/v1/vision/analyze` forwards to `VISION_PROVIDER_URL` with timeout and optional bearer key and returns 503 when no provider is configured. A provider must return a durable `evidence_uri` before the UI can save an observation.
- **Design authority:** Taste Skill v2, `design-taste-frontend`, from <https://github.com/Leonxlnx/taste-skill>. Project-specific art direction and acceptance criteria are embedded in `docs/DESIGN_SYSTEM.md` and `docs/BUILD_PROMPT.md`.
