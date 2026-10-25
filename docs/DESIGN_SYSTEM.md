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
