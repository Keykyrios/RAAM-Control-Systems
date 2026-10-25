# Master Implementation Prompt: RAAM Integrated Spare-Parts Control ERP

> Use this as the single source-of-truth prompt when asking a coding agent to implement, continue or audit this project. Do not abbreviate it to “make a nice inventory dashboard.” Read the supplied `RAAM_Track4_SpareParts_Control_Whitepaper(1).pdf`, this prompt, `docs/DESIGN_SYSTEM.md`, and `docs/IMPLEMENTATION_MAP.md` before coding.

## Role and result expected

Act as a senior ERP architect, inventory-control researcher, full-stack engineer, data-platform engineer, and UI implementation specialist. Build a professional, auditable spare-parts control system for automotive/service-centre operations based on the RAAM Track 4 whitepaper. Produce a coherent runnable repository, working interactions, typed APIs, tested domain services, a clear data model and deployment instructions. Do not ship a static dashboard mock and call it an ERP. Do not invent production data or represent uncalibrated algorithms as validated.

The system must keep **physical state**, **transaction state**, **forecast state**, and **decision/policy state** synchronized through one event graph and closed loop. Inventory is a partially observed stochastic state-estimation problem before it is a reorder-point calculation.

## Authority and boundaries

1. Product requirements and terminology come from the attached RAAM whitepaper. Preserve its distinction between observed facts, mathematical assumptions, published evidence, synthetic preview values and Raam-specific observed records.
2. **Use Taste Skill v2 as the only design methodology.** Read and follow `https://github.com/Leonxlnx/taste-skill` and its `design-taste-frontend` skill instructions. Follow its rules on deliberate typography, a coherent palette, responsive CSS Grid, interactive states, component isolation, performance, no generic AI visual patterns and final visual quality checks. Do not bring in another design framework or generic UI kit as an independent design authority. Libraries are fine as implementation tools, but customize them to the design scheme below.
3. The provided PDF's burgundy/off-white/red visual language is product branding and subject reference. It does not override Taste's engineering principles. No other design principle may be mixed in.
4. Never silently fill gaps in RAAM data. If the database lacks stock snapshots, demand history, supplier lead times, cost inputs, service policy or audit labels, return a visible “baseline required / data not available” state. Never infer missing data and quietly treat the guess as observed.
5. No automatic purchase order, transfer, stock adjustment or physical-state collapse without a documented, authorized decision path. No anomaly score implies bad intent.

## Application stack and repository shape

Keep the repository maintainable and straightforward to run:

- Frontend: React 18, TypeScript, Vite, Three.js (`three` + `@types/three`, currently pinned to compatible 0.186.x ranges), `@phosphor-icons/react`, Recharts, responsive handwritten CSS. Keep all displayed controls functional. Use strict TypeScript.
- Backend: Python 3.12+, FastAPI, Pydantic v2, SQLAlchemy 2, PostgreSQL for deployment and SQLite for simple local development, `numpy` only where useful. Use explicit API contracts and service modules.
- Tests: pytest for domain math, state/event semantics, hard constraints and route smoke tests; frontend production build and manual/automated interaction checks.
- Local orchestration: Dockerfiles, `docker-compose.yml`, `.env.example`, clear README.
- Structure domain math in services, persistence models in models, routes in API, and UI design tokens in one CSS source. Do not create a 2,000-line route/component file for the whole product if reasonable component and domain boundaries exist.
- Use production migrations (e.g. Alembic) rather than schema auto-creation outside development. Do not commit secrets or working production credentials.

## Non-negotiable functional requirements

### A. Canonical state and lineage

For every part/location maintain a structured representation of:

`S_t = { p(X_t | H_t), p(D_{t:t+H} | H_t), p(L_t | H_t), G_t }`

where `X` is physical stock, `D` future demand, `L` lead time and `G` the event graph. Historical information `H_t` includes observation, event and audit evidence. Do not replace this object with one ERP quantity.

Physical stock `X_{i,b,t}` and recorded ledger stock `R_{i,b,t}` are distinct. Represent:

- physical-stock transitions using observed demand/issues/returns/transfers, verified adjustments and unobservable loss;
- ledger transitions using posted transaction events;
- source, destination, part, bin, user/actor, job, vehicle, invoice/document, dock, event type, quantity, occurred timestamp, recorded timestamp and stable event ID;
- corrections as new compensating events referencing the event being corrected. Never edit or delete event history;
- append-only event hashing/chain verification and idempotency support to avoid duplicated posting;
- a replay/fold that can reconstruct a ledger state from opening snapshots and subsequent events;
- graph edges `part ↔ bin ↔ user ↔ job ↔ vehicle ↔ invoice` and required downstream relations.

Every action should be traceable to its evidence and source classification. Support receipt, QC, put-away, issue, job completion, billing, returns, vendor returns, transfers, scrap, verified adjustments, purchase order confirmation/receipt, camera/barcode/OCR observations and audits. A transfer updates both source and destination; do not represent it as a one-sided delta.

### B. Physical inventory state estimation

Implement a discrete Bayesian filtering/particle-filter service, retaining possible count states, unobserved-loss state and normalized weights. Support:

- prior prediction based on posted movement and configurable loss transition;
- observation likelihood from an estimated count/vision observation and configurable uncertainty;
- a verified physical audit that sharply collapses the relevant posterior;
- posterior mean, variance and credible range;
- multiple candidate identifiers and confidence/provenance in observations;
- versioned/calibrated model assumptions, input observations and output posterior;
- a null/unknown state when evidence is missing.

Observation `O_t` can include camera image reference, decoded barcode, OCR, visual descriptor/open-vocabulary candidate, count distribution, occupancy and manual audit. For a bin, occupancy is occupied volume divided by usable volume. If object occlusion makes counting ambiguous, store a posterior distribution, not a false integer. A vision model is only an evidence provider; it must not make purchasing decisions.

Keep the unit-level and value-level integrity metrics, plus signed value bias:

- `IRI_unit_i = |X_i − R_i| / max(1, X_i, R_i)`
- `IRI_value = |Σ_i v_i X_i − Σ_i v_i R_i| / max(1, Σ_i v_i R_i)`
- `Bias = Σ_i v_i (X_i − R_i)`

Never hide a persistent under- or over-recording direction inside absolute error.

### C. Intermittent demand and lifecycle effects

Model occurrence and positive size separately:

- `O_{i,t} ~ Bernoulli(p_{i,t})`;
- `Y_{i,t} | O_{i,t}=1 ~ NegBin(r_i, θ_{i,t})`;
- `D_{i,t} = O_{i,t} Y_{i,t}`.

The occurrence features must be available before the forecast origin. Include prior demand, intervals between positive demands, zero-run duration, recent demand windows, lifecycle stage and vehicle mix; model stockout-censored demand rather than interpreting every zero issue as no demand.

Implement a model adapter interface and baseline model family:

- Croston/SBA;
- TSB;
- Negative binomial occurrence/size model;
- gradient boosting (GBM) adapter;
- stacked ensemble adapter.

Select per-SKU/demand-class method using time-ordered rolling-origin validation. Use an asymmetric decision loss with a larger under-forecast penalty for critical parts; do not random-shuffle time series. Support lifecycle-specific parameter pooling for sparse/cold-start parts. Baselines may run without ML packages, but unsupported/untrained model adapters must explicitly declare that they are unavailable, not report invented validation results.

Report `RMSE`, `MAE`, `MASE`, quantile pinball loss, prediction-interval coverage, interval width and business cost loss. MAPE is not the primary metric on intermittent series. Model selection should consider inventory consequences, not forecast error alone.

### D. Empirical lead-time uncertainty

Build lead-time histories from purchase-order confirmation and receipt timestamps, keyed by supplier/part/route and, where data support it, historical regime. Retain the empirical distribution unless diagnostics justify a parametric approximation. Implement empirical quantiles and bootstrap lead-time-demand scenarios:

`Z_i = Σ_{τ=1}^{L} D_{i,t+τ}`

and reorder threshold `s_i(α_i) = Q_{Z_i}(α_i)`.

Criticality must be derived from measurable consequences, not a universal service probability: vehicle/job unavailability exposure `U_i`, repair-delay consequence `T_i`, actual substitutability `S_i`, shortage economic consequence `B_i`, combined as `Γ_i = η₁U_i + η₂T_i + η₃S_i + η₄B_i`. The service target `α_i = g(Γ_i)` must be an explicit, configurable organization policy and its parameters require calibration.

### E. Replenishment and constraints

Implement an auditable reference optimizer and a clean adapter for a scale-up solver. Minimize expected holding, order, transfer, expedite and shortage cost plus a CVaR tail-risk penalty. Preserve chance constraints/service targets using empirical lead-time-demand scenarios. Respect:

- budget;
- storage volume and discrete bin/shelf occupancy;
- feasible ordering quantities/MOQs/order constraints when supplied;
- transfer-flow capacity and network balance;
- service constraints tied to measured criticality;
- supplier/route constraints where supplied;
- inspection time budgets;
- risk/CVaR policy.

Candidate action quantities must pass a deterministic feasibility check before approval. If a learned proposal is infeasible, fall back to the feasible reference policy. Never label a heuristic as a solved global MILP. Add a documented solver interface to implement decomposition, Lagrangian shadow prices for capacity/budget and transfer column generation at large scale.

### F. Audit/inspection decisions

Choose inspections jointly with replenishment. Model inspection eligibility, travel/technician minutes, direct inspection cost and expected post-audit reduction in decision cost. Implement a time-budgeted selection objective such as maximizing `Σ z_i E[Δ C_i^inspection | H_t]` subject to `Σ z_i τ_i ≤ T_audit` and eligibility. Include value of information/net benefit. A low confidence score alone must not force an audit when the economic benefit is negative. Record selected tasks, assignee, due time, result count, duration, cost and resulting posterior update.

### G. Process conformance and reconciliation queue

Explicitly define allowed process states and transitions:

`RECEIVE → QC → PUT_AWAY → ISSUE → JOB → BILL`

with explicitly modeled alternate transitions:

- `ISSUE → RETURN`;
- `RECEIVE → VENDOR_RETURN`;
- `PUT_AWAY → TRANSFER`;
- `ISSUE → SCRAP`;
- any other approved transition required by the real source system must be a versioned config change.

Detect invalid transitions and missing required graph edges. A missing edge is a reconciliation problem, not a conclusion about intent. Rank each unresolved case using `P(U_g=1 | H_t) × Exposure(g)`. Preserve evidence graph, quantities, source IDs, owner, status, resolution, actor and timestamps. Cases must be resolvable only with explicit evidence/disposition.

### H. Spatial inventory and digital twin

Represent spatial structure as `G_space = (V,E)` with parts, bins, bays and suppliers; edges include contains, adjacent, supplies, transfers-to and serves. Maintain per-location stock, pick distance, capacity, criticality and misplacement probability.

Location assignment minimizes measured pick cost plus misplacement penalty plus audit-access cost, subject to exactly one location per assigned SKU and capacity. Optimize placement and picker routing together when appropriate. Transfer recommendations must satisfy network-flow constraints and be proposals until approved.

The digital twin is a **state renderer**, not a decorative warehouse. The starter must include a working Three.js component (`frontend/src/WarehouseTwin.tsx`) with orbit/zoom/reset, selectable bins, arrow-key selection, and inventory/variance/confidence overlays. Every rendered production object binds to `(part, bin, location, t)` and exposes physical posterior, ledger state, demand risk, lead-time risk, active policy and last event. It must use the same projection as the API/ledger. Clearly label coordinates schematic while surveyed coordinates are unavailable.

Counterfactuals use empirical historical distributions: supplier lead-time stress resamples recorded delay regimes; demand stress resamples historical demand conditioned on observed vehicle mix/month/service load. Compare old/new policies on the same sampled trajectories and report cost/service/shortage/expedite deltas. If those empirical trajectories do not exist, withhold results and explain why. Do not invent an arbitrary savings percentage.

### I. Closed-loop workflow and human control

Use this control sequence:

1. Ingest observation/event/audit/receipt/issue/return.
2. Update event-sourced ledger and event graph.
3. Update physical stock posterior from event and observation evidence.
4. Re-estimate demand and supplier lead-time distributions.
5. Solve the constrained replenishment/transfer/inspection decisions.
6. Return a proposed action with evidence, objective value, constraints, model versions and uncertainty.
7. Require human approval (or an explicitly configured delegated authority) before operational write-back.
8. Write the approved movement/PO/transfer/audit as a new immutable event with actor/time/part/location/document lineage.
9. Update state projections and monitor outcomes/model drift.

A human override must create a durable record `{reason, user, timestamp, originalAction, newAction}`. Keep original and revised outcomes for future calibration. Do not hide or overwrite the original recommendation.

### J. Evaluation and external validity

Support historical replay of policy `π: S_t → A_t` on identical historical trajectories for every compared policy. Record:

- forecasting metrics and probabilistic calibration/coverage;
- unit and value inventory record inaccuracy, signed bias, audit precision/recall;
- value of inspection = cost before − cost after − inspection cost;
- total policy cost, service, shortage, IRI and expedite deltas.

Establish an observed baseline before setting targets. Label every numerical result as one of: `RAAM_OBSERVED`, `AUTOMOTIVE_PUBLISHED`, `CROSS_INDUSTRY_PUBLISHED`, `PUBLIC_BENCHMARK`, or `SYNTHETIC_DEMO`. Never promote published research claims to RAAM outcomes. The whitepaper's literature values are architecture evidence only unless the product explicitly builds a cited research panel with attribution.

### K. Failure modes and safeguards

Every failure mode must have detection, explanation, action/owner, evidence and safe fallback:

- vision uncertainty/occlusion → posterior over count and identifier, not hard classification;
- sparse demand → pooling and model-class selection;
- stockout censoring → censoring state in demand model;
- record inaccuracy → Bayesian filtering and targeted inspection;
- supplier drift → time-indexed empirical lead-time model and refresh;
- capacity coupling → joint constraints/shadow prices;
- transfer cascade → network-flow constraints;
- human override → immutable override and post-decision comparison;
- model drift → rolling-origin re-estimation and interval-coverage monitoring;
- optimizer infeasibility → deterministic feasibility check and feasible fallback;
- missing transaction graph edge → reconciliation case with evidence, never accusation;
- stale or missing data → block recommendation or mark baseline required.

## Full frontend scope

Build these navigable modules and real user paths:

1. **Overview / Control dashboard:** current data provenance banner; KPIs whose data is query-backed; physical-vs-ledger trend; control loop status; exception queue ranked by economic exposure; recent event lineage; action shortcuts.
2. **Inventory register:** part/SKU, vehicle family, supplier, unit value/volume, bin/location, ledger quantity, physical posterior mean/range/confidence, state discrepancy, demand class, lead time and provenance; search/filter/export; detail drawer; missing baseline state.
3. **Reconciliation:** open/resolved/all; case priority, physical/transaction evidence path, expected/observed quantities, posterior unresolved probability, economic exposure, ownership, assign/inspect/resolve actions and recorded resolution.
4. **Movement ledger:** immutable event stream, event ID/time/type/quantity/source/destination/actor/job/vehicle/invoice, hash-chain integrity check, process conformance result and filters; explicit correction events.
5. **Vision observations:** deliver a functional upload/preview workbench (`frontend/src/VisionWorkbench.tsx`), provider adapter, explicit synthetic preview mode, OCR/barcode/object candidates, bounding-box overlays anchored to the uploaded image, confidence, occupancy, count posterior, model version, evidence URI, plus real part and bin selectors loaded from the connected registries. Add `POST /api/v1/vision/analyze` and secure provider settings. Invalidate prior model output if the selected part/bin changes. Do not fabricate recognized results or persist demo overlays.
6. **Demand & lead time:** series inspection, demand-class classification, rolling-origin model comparison, forecast distribution/calibration, observed lead-time empirical quantiles and demand-over-lead-time distribution. Explain why a selected model wins in cost terms.
7. **Replenishment:** forecast distribution, target service/criticality, inventory posterior, order/transfer/expedite/shortage trade-off, budget/capacity constraints, CVaR, infeasible candidate diagnostics, proposed actions, approval and override lifecycle.
8. **Inspection plan:** eligible audits and value of information, minutes/route budget, expected net benefit, assignment/result entry, physical count updating state.
9. **Spatial twin:** locations, bins, occupancy/capacity, stock uncertainty, transfer links, pick distance, audit accessibility and misplaced-part penalty. Visually encode actual state and its provenance.
10. **Scenario lab:** historical supplier regime / demand mix resampling; compare policy cost, service, shortage, expedite and working capital on paired trajectories; if inputs missing, show a result gate rather than sample KPIs.
11. **Evaluation & evidence:** metric groups, baseline ID, policy/model version, source class, dates, paired historical replay, methods and external-validity statement.
12. **Settings & integration:** source interfaces, source mappings, refresh/health, model/constraint policy, approvals, feature flags, retention and environment state. Clearly identify controls that are not implemented yet.

Global app chrome includes persistent product mark, site/location switcher, grouped navigation, search with Ctrl/Cmd+K, backend connection state, refresh, notifications, profile/role, page breadcrumb and footer state-language (`physical ↔ event ↔ forecast ↔ policy`). Provide a responsive mobile experience, not merely a desktop view scaled down.

## Single design scheme, required in code and in this prompt

The same detailed tokens and rules live in `docs/DESIGN_SYSTEM.md`. Implement them exactly unless there is a documented accessibility or functionality reason to adjust:

### Dials

- `DESIGN_VARIANCE = 6`
- `MOTION_INTENSITY = 4`
- `VISUAL_DENSITY = 7`

### Palette

- canvas `#F5F3F0`
- surface `#FFFEFD`
- secondary surface `#FAF8F6`
- primary text `#211C1B`
- secondary text `#59514F`
- muted text `#8B827F`
- border `#E7E1DD`
- strong border `#D8CFCA`
- brand shell `#351319`
- deep burgundy `#4B191F`
- sole accent `#B21E2B`
- accent hover `#971A25`
- success `#36735A`
- warning `#9A651D`
- critical `#A51D2A`
- success background `#EAF4ED`
- warning background `#F8F0DF`
- critical background `#F8E9EA`

All neutrals are warm and consistent. No pure black, purple, neon gradient, blue AI glow, gradient headline, emojis or external stock-photo wallpaper. Palette semantic rules matter more than increasing color variety.

### Taste Skill v2 anti-slop locks

- Choose one page theme per view and provide light/dark theme parity for production, with contrast and hierarchy preserved. Never switch page theme halfway through a screen.
- Lock the color system to warm neutral + the single red accent; lock the shape system to the specified 8px corner language with documented exceptions only.
- Do not use AI-purple/mesh gradients, decorative status dots, three equal feature cards by default, emoji UI, faux terminals, fake dashboards made from `div` grids, or borders on every list row purely for decoration.
- Avoid em dashes/en dashes in interface microcopy; use punctuation that stays quiet and direct.
- Do not add `window.addEventListener('scroll')` for visual effects. Use IntersectionObserver, CSS scroll-driven animation, Motion or GSAP when genuinely needed.
- Before shipping, audit an existing screen first, preserve the interaction model, and run the skill's pre-flight checklist. Do not introduce a second visual framework as competing design authority.

### Typography

- Geist UI sans plus Geist Mono for numeric/evidence columns. Never use Inter or serif in software UI.
- Page heading 25–32px at 600–650 weight, tracking around `-0.04em`, not an oversized marketing hero.
- Section headers 14–16px at 600–650.
- Body and descriptive copy 11–12px, with accessible contrast and 1.5–1.7 line height.
- Dense table content generally 9–11px, never make critical controls illegible.
- Numeric values/event IDs/percentages use monospaced tabular numerals.

### App frame and layout

- 250px burgundy sidebar on wide screens; compact 68px rail between tablet/desktop; narrow but operable icon rail on mobile.
- Warm off-white app background; off-white working surfaces; sticky 60px topbar; max content width 1440px.
- Main padding 31px desktop / 22px tablet / 14px mobile.
- Overview: asymmetric analytics `~1.3fr / 1fr`; four metrics in one unified strip; lower exception/event panels. Avoid the generic three-equal-card row.
- Operational pages prioritize semantic tables, filters, drawer details and explicit state, not decorative dashboard tiles.
- Use CSS Grid rather than fragile flex percentage arithmetic. Collapse to one column below 768px. Horizontal table overflow is contained inside the table region.
- Main panels have a warm 1px border and 8px radius. Shadows are rare and reserved for drawers/modals. No decorative hairline grid or grain/noise overlays.

### Interaction and motion

- Short transform/opacity transitions only, around 160–240ms with a refined ease-out or spring. Never animate `top`, `left`, `width` or `height`.
- Reduced-motion users receive reduced/no movement. No looping animation on inventory values, policy recommendations or table order; no auto-sorting a row while it is being inspected.
- Every button/control has a complete action. All filters affect displayed content. Loading shows dimension-matched skeletons, errors appear inline and retain input, empty states describe the real next step, successful action produces concise feedback.
- Labels are above form inputs; validation belongs below the input. Keyboard focus is visible; modal/drawer close controls are available; Escape closes ephemeral overlays.
- Use `@phosphor-icons/react`, consistent weights, no emojis.
- Charts require series/units, axis labels where useful, time horizon, provenance and source caveats.
- Use red only for primary action/selection/important discrepancy, semantic yellow/amber for review, green only for confirmed success. Text accompanies color.

### Fixed component contracts

- Persistent `SYNTHETIC_DEMO` banner when demo records are shown. Demo and production data cannot mix in a single unlabeled calculation.
- Backend connected with no baseline means “No baseline” / “Awaiting data”, not a fake chart or guessed KPI.
- Part detail drawer shows ledger stock and physical posterior separately.
- Replenishment shows “proposal / approval required” and constraint diagnostics. It cannot create a PO from the preview UI.
- Reconciliation copy says “unexplained process path / reconcile evidence”, never implies intentional misconduct.
- Scenario pages do not present a cost saving unless it comes from empirical paired trajectories.
- Spatial twin objects are keyed to actual `part/bin/location/time` state. A schematic must be labeled illustrative.

### Visual signature / wow layer (mandatory, not optional polish)

Deliver the operationally useful high-impact experience below. Do not substitute static mockups or buzzword labels for interaction:

1. **Three.js 3D warehouse digital twin**: a dedicated React component using `three` and `@types/three`, `OrbitControls`, perspective camera, resize observer, bounded pixel ratio, proper WebGL resource disposal and a fallback if WebGL is unavailable. Render racks and bins. Selecting a populated bin opens the bound inventory record in an inspector. Include three overlays: inventory state, ledger variance and vision confidence; reset-camera; text legend; keyboard/responsive fallback; a schematic-location disclaimer until surveyed coordinates are sourced. Every populated object must bind to `(part, bin, location, timestamp)` and the same state projection as the ERP.
2. **Computer-vision evidence workbench**: upload/drag-drop JPEG, PNG or WebP, 10 MB client/server limits, preview, overlay boxes, model response state, candidate identifiers, OCR/barcode outputs, count distribution, occupancy, confidence and model version. Synthetic preview overlays must show `SYNTHETIC DEMO / NOT MODEL OUTPUT` and must never be saved, trained on, sent to the physical filter or mixed with operational values.
3. **Real provider integration contract**: add `POST /api/v1/vision/analyze` using multipart `image` plus optional `part_id` and `bin_id`, and configuration `VISION_PROVIDER_URL`, optional `VISION_PROVIDER_API_KEY`, `VISION_MAX_IMAGE_BYTES`. Validate MIME and image signatures, timeout, provider error responses and normalized output. If no provider is set, return visible HTTP 503, never fabricated “AI detections”. Provider output includes `observed_quantity` or null, `occupancy_ratio`, `identifier_candidates`, `count_distribution`, `detections`, `confidence`, `model_version`, and a durable access-controlled `evidence_uri`. Bounding-box coordinates are normalized percentages `[x, y, width, height]`. Validate all probabilities, counts, bounding boxes and array sizes.
4. **Human review / evidence persistence**: display results and let the user explicitly save a reviewed model response with `POST /api/v1/observations`. Saving evidence must not change stock or auto-reorder. The provider must return an evidence URI from secure storage; public image URLs are forbidden by default.
5. **Wow with integrity**: combine “3D digital twin”, “multimodal evidence fusion”, “Bayesian state estimation”, “explainable AI”, “event-sourced audit trail”, “intermittent-demand intelligence”, “empirical lead-time risk” and “counterfactual scenario lab” only as concrete working capabilities. Never claim autonomy, real-time, edge inference or predictive maintenance unless those functions are deployed and validated. Every advanced feature is labeled `IMPLEMENTED`, `DEMO ONLY`, or `INTEGRATION REQUIRED` in developer docs / feature-state UI.
6. **Visual polish guardrails**: no neon sci-fi HUD, AI-purple gradients, gratuitous parallax, rotating warehouse, animated count changes or fake live telemetry. Keep the Taste Skill v2 art direction and the design scheme below. Motion is constrained, state transitions remain truthful, reduced-motion is respected, and the canvas must not block the ordinary inventory table path.

## Required data entities and relationships

At minimum include these normalized entities, with indexes, uniqueness rules, source classes and timestamps:

- Part, vehicle family/catalog, supplier, substitute/compatibility relationship;
- Site, storage location, bin/shelf/position and spatial coordinate/capacity;
- Inventory snapshot with ledger quantity, physical posterior distribution/mean/variance, confidence, as-of time, source and evidence IDs;
- Immutable inventory event with canonical payload hash, previous hash, event ID, idempotency key and optional corrects-event ID;
- Physical observation and evidence reference, sensor type, candidate identifiers, count/occupancy posterior, confidence and model version;
- Time-bucketed demand observations with source availability/stockout-censoring context, vehicle mix and service load;
- Supplier lead-time observation from confirmed timestamp to receipt timestamp, route/regime/source;
- Reconciliation case, required/observed graph edges, probability/exposure/priority, assignee/status/evidence/resolution;
- Audit task with expected value of information, inspection time/cost, assignment, actual count and completion;
- Forecast experiment, forecast distribution, time split/rolling origin, model version, metrics and decision loss;
- Control run with immutable inputs/hash, model versions, constraints, candidates, objective components, CVaR, diagnostics and approval status;
- Approved action/order/transfer, human override with reason/user/time/original and revised action;
- Policy evaluation with baseline ID, paired trajectory IDs, cost/service/shortage/IRI/expedite deltas and source class;
- Scenario definition/results with sampled empirical regime IDs and same-path comparison;
- User, role, permission, approval/signature and audit access record for production.

Keep foreign keys, data validation, idempotency, database transaction boundaries and explicit units. For all records, define timestamps/time zone, quantity sign convention, currency/unit, location identity and retention policy. Avoid using unvalidated free text as the sole key for SKU, bin, job or supplier.

## API and engineering requirements

Provide versioned JSON REST endpoints with typed request/response schemas. At minimum:

- health, overview, parts/master data, locations/bins, current inventory-state projection;
- append event, list events, replay/integrity verification and compensating corrections;
- ingest observation, inspect posterior, multipart vision inference (`POST /api/v1/vision/analyze`), reconcile case list/create/assign/resolve;
- forecast demand, compare candidate models, forecast lead-time demand, evaluate rolling-origin forecasts;
- control run, list policy runs, submit approval, record override, post approved action;
- plan audits, submit audit result and update posterior;
- process-conformance validation, event-graph path lookup;
- storage/bin assignment, lateral-transfer candidate generation;
- run historical policy replay, start scenario, retrieve paired evaluation report;
- integrate source systems through adapters/webhooks/jobs, with durable retries and idempotency.

Endpoints must validate identifiers, ranges, quantities, state transitions, time periods and input array lengths. Return actionable error messages. No production-sensitive endpoints without authentication and role checks. Ensure errors do not leak secrets or internal stack traces. Log correlation/request IDs without placing sensitive data in log content.

## Demo, provenance and safety

- The demo seed is an explicit developer action and can only run when `DEMO_MODE=true` and the database has no part records. Tag every generated row `SYNTHETIC_DEMO`.
- Never seed fake rows automatically at app startup.
- Synthetic data may exercise charts, filters and controls but is never used as operational KPI or model training input.
- Preserve the provenance class on joined/aggregated outputs. If mixed, report `MIXED` or split by class rather than silently merging.
- Published research values need citation and class label. Do not claim the architecture achieved them.
- No automatic accusation, employee ranking or misconduct inference from anomalies. Focus on unresolved state, exposure and evidence path.
- No uncontrolled access to camera images, driver/customer data, credentials or personally identifying context. Production design requires least-privilege access, audit access logs, retention controls and encryption.

## Testing and definition of done

1. Unit tests for particle posterior behavior, audit collapse, ledger fold, event hash linkage, idempotency, allowed transitions/missing edges, intermittent demand, rolling-origin model selection, empirical lead-time bootstrap, cost loss, quantiles/CVaR, capacity/budget feasibility, audit knapsack, transfer flow/stock balance, spatial capacity assignment and evaluation metrics.
2. API tests for invalid payloads, missing IDs, accepted events, immutable correction, provenance retention, connected-empty state, forecast and control routes, approval guard and no scenario result without sufficient empirical inputs.
3. Frontend production build passes with strict TypeScript. No dead controls, hidden broken action, or knowingly fake “success” notification.
4. Manual route walk-through: overview → open part → reconciliation → audit plan → forecast → replenishment → approval boundary → ledger event → state updates → evaluation.
5. Visual inspection at around 1440px, 1024px, 768px and 390px. Fix clipping, horizontal page scroll, inaccessible labels, chart readability and panel overflow.
6. Review loading/empty/error/success states, keyboard navigation, focus rings, modal close, reduced motion and contrast.
7. Exercise 3D bin select, orbit/zoom/reset, all three overlays, WebGL fallback, CV upload validation, provider-not-configured and provider-error states, bounding-box normalization and explicit observation save. Demo overlays must never be persisted.
8. Every dashboard figure traces to a backend query/calculation or persistent synthetic demo marker. Empty data must be rendered as empty, not guessed.
9. Docker/local instructions work from a clean checkout. Include `.env.example`, database startup, migration/seed steps and separate production hardening checklist.
10. Provide implementation map tying each whitepaper requirement to source path, endpoint, UI and test. Explicitly list any not-yet-implemented model adapter or production control.

## Expected final delivery from the coding agent

Deliver (1) the full source tree, (2) clear run/test commands, (3) the master prompt and complete design scheme in-repository, (4) API contract and data model documentation, (5) tests, (6) a whitepaper-to-code traceability map and (7) an honest production-gap list. Prefer a complete, clear reference implementation over a visually polished half-product. Never claim that an external data connection, trained vision model, production-grade optimizer, approval security or live ERP integration exists unless it is actually implemented and tested.

---

## Appendix A: Complete standalone design scheme (normative, embedded in full)

This appendix reproduces the project UI design scheme in full so this prompt remains self-contained when copied without the repository's separate design file. Treat these rules as mandatory. The only design methodology is Taste Skill v2 from `Leonxlnx/taste-skill`; the RAAM whitepaper contributes visual brand cues only. If another part of this prompt restates a token or visual rule, this complete appendix is the canonical exact scheme.

# RAAM Spare-Parts Control: UI Design System

## Design authority

**The sole design methodology is Taste Skill, from `Leonxlnx/taste-skill`:** <https://github.com/Leonxlnx/taste-skill>. The visual character also draws its *brand cues* from the supplied RAAM whitepaper cover and end page: off-white paper, near-black/burgundy fields, restrained red emphasis, precise technical typography, and a physical-control motif. The whitepaper is product/brand reference, not a second design framework.

Design must not drift into stock SaaS-template styling. Apply the skill's typography discipline, one accent, responsive grid logic, low ornamental noise, clear interaction states, deliberate motion, and performance guardrails. The application is data-dense, so choose legibility and stable operational reading over decorative animation.

## Design dials for this ERP

Taste Skill v2 uses brief inference rather than a universal fixed visual recipe. The following are this RAAM control-room application's explicit project dials, derived from the operational use case, not upstream defaults:

- `DESIGN_VARIANCE = 6`: purposeful hierarchy and asymmetry in overview composition, conventional geometry for tables, forms, and controls.
- `MOTION_INTENSITY = 4`: short, spring-like or ease-out transitions and small arrival/feedback motion. No motion may imply a stock count changed before new evidence arrives.
- `VISUAL_DENSITY = 7`: dense enough to operate large tables; below the skill's 8–10 cockpit mode so type remains comfortably readable and grouping is not reduced to hairlines.

Do not set every metric in a card. Boxes exist to communicate hierarchy or to group a real interaction. Table rules and separators are permitted where they organize actual data.

## Color tokens

Use one coherent warm-neutral family and one red accent. Never mix cool blue-gray and warm-gray neutrals. Do not use pure black, purple/blue AI gradients, neon glows, or decorative gradient text.

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#F5F3F0` | Application canvas, warm off-white |
| `--surface` | `#FFFEFD` | Working surfaces and tables |
| `--surface-soft` | `#FAF8F6` | Secondary surface, table header |
| `--ink` | `#211C1B` | Primary text, off-black |
| `--ink-soft` | `#59514F` | Secondary text |
| `--muted` | `#8B827F` | Labels and metadata |
| `--border` | `#E7E1DD` | Actual surface/table boundaries |
| `--border-strong` | `#D8CFCA` | Inputs and stronger structure |
| `--brand` | `#351319` | RAAM burgundy shell / navigation |
| `--brand-2` | `#4B191F` | Deep burgundy secondary treatment |
| `--accent` | `#B21E2B` | Sole accent: primary actions, selection, key exceptions |
| `--accent-dark` | `#971A25` | Primary-button hover |
| `--success` | `#36735A` | Confirmed valid state only |
| `--warning` | `#9A651D` | Needs review, constrained recommendation |
| `--danger` | `#A51D2A` | Critical or integrity issue |
| `--success-soft` | `#EAF4ED` | Low-key success background |
| `--warning-soft` | `#F8F0DF` | Low-key warning background |
| `--danger-soft` | `#F8E9EA` | Low-key critical background |

Color is semantic. Never use green to decorate a panel or red just to make a section vivid. A discrepancy score is not evidence of intent.

## Taste Skill v2 locks and anti-slop checks

- Select one theme per view. Production must have light/dark mode parity with accessible contrast and identical state hierarchy; never flip themes inside a page.
- Keep the warm-neutral palette and single red accent locked. Keep the 8px corner system consistent. No AI-purple/mesh gradients, ornamental neon, emoji UI, or decorative status dots that do not encode actual state.
- Avoid three equal feature cards by default, fake terminal/dashboard components built from generic `div` rows, and top/bottom borders on every list row when not conveying real structure.
- Avoid em dashes/en dashes in interface microcopy. Do not add scroll listeners for decorative effects; use the skill's recommended animation primitives only when motion serves comprehension.
- Do not use another design framework as a competing design authority. Before changing an existing screen, audit it first and preserve the interaction model; complete the Taste Skill v2 pre-flight before release.

## Typography

- Interface font: **Geist**. Optional numeric companion: **Geist Mono**.
- Exactly one UI sans family plus its mono companion. No serif for dashboard/software UI; no Inter.
- Page title: 25–32px, 600–650 weight, negative tracking around `-0.04em`, line-height near 1.08.
- Section title: 14–16px, 600–650 weight.
- Body: 11–12px for the dense operating application, 1.5–1.7 line-height for explanatory text.
- Table content: 9–11px where dense, while interactive labels remain clear and meet accessible contrast/target sizing. Never make long descriptions or important state only 8px.
- Quantities, money, event IDs, probabilities and scenario results use Geist Mono. Use tabular numerals for columns.
- Labels are functional, not decorative all-caps microcopy. Eyebrow labels are short and reserved for section taxonomy.

## Layout and spacing

- Desktop shell: dark fixed/scrollable left navigation, light sticky top bar, flexible work area.
- Main content maximum width: 1440px. Desktop page padding: 31–40px. Tablet: 22px. Mobile: 14–16px.
- Use CSS Grid for multi-column compositions, not brittle percentage-width flex calculations. Grid columns must collapse to one column under 768px.
- Prefer an asymmetrical main/secondary split for analytic areas (`1.3fr / 1fr` or similarly purposeful) rather than making every area a row of three equal cards.
- Use a four-column KPI strip with a single shared border and useful separators, not four disconnected floating cards.
- Operational lists and tables have content-aligned rows, actual column labels, stable order, and explicit provenance. Do not animate sorting or reorder rows behind a user's cursor.
- Sidebar is 250px on wide desktop, compact icon rail around 68px on intermediate widths, and remains usable on narrow screens. On mobile, prevent horizontal page scroll; data tables may scroll within their own bounded container.
- Every table must show an empty-state design, responsive overflow strategy, loading skeleton, and an inline error state.

## Surface, edge and elevation

- Main panels use a subtle `1px` warm border and 8px corner radius.
- Elevated shadows are rare and communicate overlays/drawers only; tint them warm to the background hue.
- Avoid excessive rounded 2.5rem containers, default bento-card layouts, hover glow, mesh gradients, texture overlays and floating decorative pills.
- Use borders to distinguish genuine controls, data regions, and state groups. No hairline grids as decoration.
- Burgundy is the system shell. Red is a precise action/exception accent. Keep most content surfaces off-white.

## Product navigation and information architecture

Navigation order:

1. **Operations:** Overview, Inventory, Reconciliation, Movement ledger.
2. **Sensing:** Vision observations.
3. **Planning:** Demand & lead time, Replenishment, Inspection plan.
4. **Facility:** Spatial twin.
5. **Analysis:** Scenarios, Evaluation.
6. **System:** Settings.

The persistent page header contains a breadcrumb, global search, refresh/connection state and notification entry. Search supports keyboard shortcut `Ctrl/Cmd+K`, part/SKU, event, job, location and exception text. Active navigation is obvious without being loud.

## Component rules

- **KPI strip:** only show metrics that can be traced to an actual query or explicitly labelled synthetic demo sample. If the necessary data has not been ingested, show “—” or “Baseline required,” not a fabricated zero or a guessed result.
- **Tables:** use semantic `<table>` markup, descriptive column headers, tabular numbers, visible row hover/focus states, scoped filters, row detail drawers, empty/loading/error states, and per-record source class. Never imply a synthetic record is an operational one.
- **Status labels:** short, semantic tags with text and (when useful) a small dot. Do not communicate solely with color.
- **Forms:** visible label above each control; helper text where the data contract needs explanation; validation directly below the field; required errors explained in plain language. All controls keyboard-operable.
- **Buttons:** primary red only for the primary action in a local context. Secondary buttons use a warm border. Quiet actions are unboxed text actions. Every control has a working action or is disabled with a reason.
- **Loading:** use skeletons that match their target layout, not an isolated generic spinner. A spinner is acceptable inside an action currently saving.
- **Empty states:** explain the missing source or next data step. Do not fill an empty operational database with fake values.
- **Errors:** inline, actionable, retain entered values, and do not silently discard forms.
- **Drawers/modals:** use restrained elevation, clear close actions, focus-visible controls and explicit confirmation for irreversible business actions.
- **Charts:** no chart is a decorative decoration. Include unit, time basis, series labels, provenance, adequate axes and an explanatory caption. Never present synthetic charts without a persistent source marker.
- **Motion:** transform/opacity only, short ease-out/spring response, no animating `top/left/width/height`. Avoid perpetual loops on live inventory and never automatically re-sort operational tables. Honor `prefers-reduced-motion`.
- **Icons:** `@phosphor-icons/react`, consistent regular weight for inactive controls and fill only for an intentionally active navigation icon. No emoji in UI, code, text or alt attributes.
- **Responsive behavior:** at less than 768px collapse complex layouts to one column, stack actions, retain full labels, isolate table overflow, and don't hide a critical state solely for lack of width.

## Interaction semantics / safety

- Physical counts are uncertain observations. Display posterior mean, interval/confidence and latest evidence; never quietly collapse a posterior to an integer.
- Ledger state and physical state are distinct values. A mismatch is not silently “fixed”; create a reconciliation path.
- Every proposed order, transfer, or inspection is visibly a proposal until an authorized person approves it.
- A visual recognition model never makes a purchasing decision.
- Human overrides preserve original action, revised action, reason, actor and timestamp.
- Process exceptions are “unexplained movement / reconciliation required,” never an accusation about intent.
- No result may combine `SYNTHETIC_DEMO`, external research and `RAAM_OBSERVED` in one unlabeled KPI.

## Product signature: “wow” features with operational purpose

The visual signature is a **physical-control digital twin**: a restrained burgundy control-room shell, warm off-white surfaces, a precise red action accent, a live-feeling but non-deceptive 3D facility model, and a computer-vision evidence workbench. The high-impact moments must feel engineered and useful, never like a concept-car microsite.

### 1. Interactive Three.js warehouse twin

- Use Three.js (`three` plus `@types/three`) in a dedicated `WarehouseTwin.tsx` component, isolated from ERP table/forms code. Use `OrbitControls`, a controlled perspective camera, a ResizeObserver, capped pixel ratio, proper renderer/material/geometry disposal, and an accessible WebGL-unavailable fallback.
- Render rack structure and bins in a 3D facility scene. Every populated bin mesh must bind to a stable inventory record; clicking selects that record and shows the same ledger quantity, physical posterior mean, confidence, criticality, status and source class as the register.
- Provide operational overlays for **inventory state**, **ledger variance**, and **vision confidence**. Color encoding is semantic and accompanied by a text legend. Selecting a risk bin is an inspection action, not a hidden write or stock mutation.
- Include reset-camera, orbit, zoom, visible selected-object details, empty-baseline handling, keyboard arrow-key selection and focus affordances, and a responsive fallback to the inventory register.
- Never claim measured facility coordinates exist if they do not. In that case label the scene as a schematic layout and display the production key `(part, bin, location, timestamp)` binding contract. Actual positions come from persisted spatial data.
- Keep motion purposeful and sparse: no perpetual flashy rotations, pulsing alarm carpets, giant neon outlines, or animations that imply inventory values changed before a new event/evidence was accepted. Honor `prefers-reduced-motion` and use rendering/performance safeguards.

### 2. Computer-vision evidence workbench

- Provide image upload/drag-drop and preview for JPEG, PNG and WebP; enforce a 10 MB limit client-side and server-side; show actionable type/size/provider errors without discarding a previously valid image. Keep model bounding boxes anchored to the actual rendered image bounds.
- The preview can display **clearly labeled synthetic demo boxes** for design review, but these can never be saved, mixed into operational metrics, treated as model output, or passed to the physical filter.
- Provide target selectors for a database-backed part and storage bin from connected registries. Connected inference must call `POST /api/v1/vision/analyze` with multipart image plus optional selected part/bin context. Changing a target invalidates the previous model result to prevent evidence being assigned to a different object. Configure the approved provider through `VISION_PROVIDER_URL` and optional `VISION_PROVIDER_API_KEY`. If no provider is configured, return a visible HTTP 503 rather than inventing detections.
- Define the provider output contract: `observed_quantity` (or null), `occupancy_ratio`, `identifier_candidates`, `count_distribution`, `detections`, `confidence`, `model_version`, and a durable access-controlled `evidence_uri`. Detection boxes use percentage coordinates `[x, y, width, height]`, each from 0–100.
- Display object/part candidate ranking, OCR/barcode-derived identifiers when present, confidence, count posterior, occupancy, bounding boxes and model version. Never collapse an uncertain count to a certain integer; preserve a count distribution and credible range when provided.
- A user explicitly saves a reviewed provider result as an observation through `POST /api/v1/observations`. This records evidence only. It never changes the ledger, directly changes physical stock, decides a reorder, or places an order.
- Original images must be stored by an approved access-controlled object-store/provider, never exposed via public URL by default. Production must add authenticated access, retention, deletion/hold policy, encrypted transport/storage and audit logs for viewing/downloading evidence.

### 3. Wow-factor narrative, without buzzword theater

Use these concepts as real product behavior and visible feature labels only where supported by implementation: **3D digital twin**, **computer vision**, **multimodal evidence fusion**, **Bayesian state estimation**, **explainable AI**, **event-sourced audit trail**, **intermittent-demand intelligence**, **empirical lead-time risk**, and **counterfactual scenario lab**. Avoid unsupported claims such as “autonomous AI”, “real-time” when the feed is not real-time, “edge AI” without an edge deployment, or “predictive maintenance” when the system is only forecasting spare-part demand. Distinguish implemented, demo-only and future/integration-required capabilities.

## Quality gate before release

- Read and apply Taste Skill v2 from <https://github.com/Leonxlnx/taste-skill> before changing the UI. The UI scheme below is the concrete project output of that single design authority.
- Open the app at desktop, tablet and mobile widths; capture screenshots and fix visible issues.
- Check type scale, one-accent consistency, alignment, whitespace, responsive collapse and readable data density.
- Test every button, filter, modal, drawer, select and keyboard route.
- Test loading, empty, error and success states.
- Verify `prefers-reduced-motion`, keyboard focus and color contrast.
- Confirm no fake Raam operational values, no emoji, no purple/blue gradient, no generic three-equal-card row, and no perpetual animation that changes operational data order.
- Run frontend production build, backend test suite and API smoke tests.
