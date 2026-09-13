# PHASE 1 development log

## GATE A — Geometry
Room metrics, wall resize, opening validation, snap/numeric parse. Tests GEO-01…06 PASS.

## GATE UX-A
SVG CAD: pan/zoom, wall drag, live dimension badge, inline mm/cm/m input.

## GATE B — ASIC + electrical
Catalog + TEST_ASIC_A. Typical/design, 3-phase, reserve. ELEC-01…06 PASS.

## GATE C — Heat + airflow
Q = P/(ρ Cp ΔT), equipment airflow max. THERM-01…07 PASS.

## GATE D — Pressure + fan
Darcy-Weisbach + K, quadratic operating point, free-air trap, parallel, dirty filter. AIR/FAN PASS.

## GATE E — Requested/Safe
min() of known constraints, multi-bottleneck, migration. CAP-01…04 PASS.

## GATE F — Racks
TEST_RACK_A 24 ASIC, AABB collisions, auto hot/cold aisle heuristic.

## GATE UX-B / G
2D/3D same Project state. Split view. 3D 1:1 twin.

## GATE H
Grok server-side tool calling. Propose/apply/undo. Offline fallback.

## GATE I
Demo underground parking end-to-end in browser.

## GATE UX-FINAL
Auto-fit CAD, opening width grips, collision reject on drop, REQUESTED/SAFE HUD, mobile inspector sheet, X-Ray layers, command bar → Grok, pressure-loss table.

## INTEGRATION — AI-native
- Local Git on `main`; Application Edit only via `ai-edit/*` and writable UI paths.
- Unified Grok: intent router PROJECT / APPLICATION / REALITY.
- Visual UI pick (`data-mf-id`).
- Mobile shell: CAD viewport + compact HUD + toolbar + bottom sheet. Not a shrunk desktop.
- Reality Sync: photos, A–B markers, provenance, as-built → Engineering Core collisions.
- Challenge-my-design critic + failure simulation (preview clone).
- INT / FAIL / REAL oracle tests.

## REPAIR BATCH 1

Closed under owner revised release policy at SHA `8f5c9c0dd4909db51a28a2e14cff12b29c00b218`.
Public production hostname deferred to FINAL DEPLOYMENT. Not a defect.

## REPAIR BATCH 2 — Reality geometry pipeline

Known-distance A–B calibration (m/px) in Engineering Core. Annotations produce
PENDING findings; ADD TO MODEL writes openings / as-built / wall length into
canonical Project State. 2D and 3D consume the same boxes. Undo/persistence
unchanged. REAL-01…12.

## REPAIR BATCH 3 — Reality → Engineering + true 3D

`Aabb3` XYZ collision (plan overlap + Z-separation is not a hit). Ceiling is a
real envelope at `room.heightM`; Twin3D draws that plane (hide is visual-only).
Confirmed as-built / exhaust openings feed Engineering Core: blocked rack
capacity, ventilation network, SAFE when that constraint is the bottleneck.
AI Reality uses `parseAiFinding` — same PENDING → ADD pipeline, fail-closed
incomplete geometry, no invented coordinates. GEO-3D-01…04, REAL-13…24.
Oracle 71/71. Public host still deferred.

## REPAIR BATCH 4 — iPhone mobile E2E + real video evidence

Mobile is a separate workspace (CAD + HUD + 44px toolbar + sheet), not a
shrunk desktop. Undo/Redo visible. Safe-area + keyboard offset. Playwright
WebKit iPhone profiles 375×812 / 390×844 / 430×932 are a mandatory CI gate
(fail-closed if WebKit cannot install or launch).

Video: real `<video>` + seek + canvas JPEG stills. `canPlayType`, not
extension. Bounded 5-sample / 6-frame cap. `VIDEO_FRAME_ESTIMATE`. Raw video
is never persisted. Grok receives selected stills + timestamps, not a video
file. Fail-closed VIDEO_* codes. Object URLs revoked. Same Reality PENDING →
ADD pipeline; video cannot mutate engineering before confirmation.

Oracle 85/85 (VIDEO-01…12). Physical iPhone and public host remain deferred.
No Batch 5 in this drop.

## REPAIR BATCH 4 CORRECTION — WebKit positive video proof

Known-good fixture is VP8 WebM. Playwright WebKit CI must actually decode it
and produce distinct JPEG stills. Fail-closed corrupt video stays a separate
test. Evidence JSON is a CI artifact. Chromium iPhone viewport is not a
substitute for this proof.

Linux WebKitGTK often yields black canvases from a paused/off-screen `<video>`.
Extraction now play-through-samples a visible element, then falls back to
WebCodecs VP8 on the same genuine bitstream. DMABuf is disabled in the gate
so decoded samples stay CPU-readable. Still no synthetic frames.

Oracle **87** tests pass (`# tests 87` / 85 suites), including VIDEO-13 VP8 demux.

## CONTINUITY / RECOVERY PACKAGE

GitHub is the durable source of truth for non-secret source. Read
`AI_HANDOFF.md` first. Recovery: `RECOVERY.md`. Machine metadata:
`project-handoff.json`. Functional Batches 1–4 remain accepted at
`635fd9e965ed8d9705c310b72b82dde2b81f837f`. This package does not add product
features and does not start public deployment or physical iPhone smoke.

## QX-01 — OWNER EXPERIENCE & PRODUCT QUALITY REPAIR

Starting SHA `300f1846886528aed771ff88a9d193bd607070ea` (continuity package on
protected main). Branch `repair/qx-01-owner-experience`.

- MFQ-001: persist state `idle|saving|saved|error`, generation-guarded
  concurrent saves, always-visible Russian status, Retry.
- MFQ-002: deterministic wall segmentation around DOOR/INTAKE/EXHAUST/
  SHAFT_CONNECTION so the Digital Twin has real apertures, not filled boxes.
- MFQ-003: dimension control beside a wall edits THAT wall (east/west/north/
  south) with explicit fixed/moving Russian contract and live preview.
- MFQ-004: numeric room resize validates against MIN_ROOM_DIM_M / MAX_ROOM_DIM_M
  before commit; reject, do not clamp; Russian reason stays in the editor.
- MFQ-005: shared CREATE/MOVE rack validator; fully-outside is invalid;
  door-swing and rack-rack overlap rejected the same way.
- MFQ-006: handoff live HEAD is Git-dynamic (`git fetch origin` +
  `git rev-parse origin/main`). No static `currentCandidateSha`.
  `recovery:verify` checks baseline exists and HEAD is a descendant.

Does not change Engineering Core formulas, Reality ADD confirmation, App Edit
security, or video pipeline. Does not start Final Product Acceptance, physical
iPhone, public deploy, tunnels, or domains.

## FINAL-01 — production policy + public-release freeze

Starting SHA `fb471f5a09d3a0143c58d3362e8e0b982796ba49` (QX-01 on protected
main). Branch `release/final-01-production-policy`.

- Freeze verified: `origin/main` was `fb471f5`; baseline `635fd9e` is an ancestor.
- Post-merge CI on freeze SHA: run `34736024732` success.
- Serverless (`GROK_PROJECT_ID`): Application Edit forced off; snapshot
  `instanceModel=multi-instance`; `RATE_LIMIT_TRUST=auto` + `VERCEL=1` uses
  Vercel identity, never spoofable CF / first XFF.
- Workspace preview (no `GROK_PROJECT_ID`) keeps the existing owner-session
  git-worktree App Edit contract.
- GitHub Pages remains static CAD demo. Tunnels are not production.
- Public server-capable URL is empty until Owner publishes Grok Build
  (`*.grok.me`) or Vercel. Physical iPhone is WAITING_FOR_OWNER.
- Evidence: `docs/FINAL-01.md`, `docs/final-01.json`. Does not declare FINAL
  PASSED. Does not reopen MFQ-001…006.
- CI follow-up: QX invalid-dim WebKit click uses the same visible/retry path as
  `editWallDim` (375×812 east label miss). Product reject semantics unchanged.

## FINAL-01R — serverless production safety

Starting SHA `37eef679e4b027abda37c0a494613130d23eabe1`. Branch
`repair/final-01r-serverless-safety`.

- FINAL-SEC-001: shared `isServerlessProduction` (`GROK_PROJECT_ID` **or**
  `VERCEL=1`/`true`). App Edit fail-closed on Vercel-only (empty project id).
- FINAL-SEC-002 OPTION B: no shared limiter implemented. Multi-instance public
  Grok AI fail-closed before xAI call even if `XAI_API_KEY` is set. Runtime
  `ai`/`available` report usable capability. `rateLimitProtection` is never
  advertised as shared. Workspace single-instance + key keeps existing Grok.
- CAD / Engineering Core unchanged. No publish, no tunnels, no iPhone.
- Does not reopen MFQ-001…006. Does not declare FINAL PASSED.

## QX-02A — GEOMETRY + CANONICAL MUTATION INTEGRITY

Starting SHA `1bd8473c41507f2ea231e9d4bf3225beca164d7c`. Branch
`repair/qx-02a-geometry-integrity`.

- Wall drag is event-count invariant from an immutable pointer-down context.
  West/South rebase origin; opposite wall stays fixed in world, screen, and
  Engineering. Cancel/Escape restores camera and leaves canonical unchanged.
- Canonical mutations start from `project`, never `preview ?? project`.
  Failure simulation is a visual overlay and cannot leak into SAVE/UNDO.
- West/South resize translates racks, fans, openings, as-built, PENDING
  findings, and measure points. Photo markers stay photo-space.
- `validateOpening` requires the opening to lie on the assigned wall AABB.
- Align / center / distribute / rotate / duplicate / auto-layout share
  `validateRacksConfiguration` and fail closed.
- Auto-layout target=0 generates no racks; a rack never exceeds capacity.
- `applyPatchValidated` uses the same opening/room/rack validators. Exhaust
  widen uses wall length − offset, not an unrelated room dimension.
- A fan outside the room is not treated as a valid operating fan.

CI correction (WebKit): wall hit-test is nearest-wall, not first-match, so a
pointer on the west wall near the north end is still West. Drag state lives
in a ref so pointermove/up and Escape are not racing React. WebKit tests
grab mid-wall world points and move exactly 1 m in pointer space.

Public deploy and physical iPhone were not performed. Does not declare
FINAL PASSED. Does not reopen MFQ-001…006 or FINAL-SEC-001/002.

## QX-02A-R — residual identity / corner / measure history

Starting SHA `b4241e985b78e98cb9902687f54aec83de763e99`. Branch
`repair/qx-02a-r-residual-integrity`.

- Duplicate rack ids are unique (`uniqueRackId`). Duplicate-id configurations
  fail closed in `validateRacksConfiguration`.
- Wall drag uses nearest geometric wall first. Overlapping SVG hit-rects
  cannot override West vs North at a corner.
- HistoryEntry stores Measure A/B. Undo/Redo restores project and measure
  together so West/South origin rebase cannot leave stale points.

Does not start QX-02B. Does not publish. Does not declare FINAL PASSED.

## QX-02B — ENGINEERING SAFETY + SAFE FAIL-CLOSED + NUMERIC INTEGRITY

Starting SHA `39ea17b241d1d556656d3bdec1245352d844ca32`. Branch
`repair/qx-02b-engineering-safety`.

- MF-SWEEP-004: overlap / wall / door / as-built / ceiling racks are blocked
  from usableCapacity (both members of a rack-rack collision).
- MF-SWEEP-005: front/rear service envelopes and facing min-aisle; exact
  boundary accepted (`>=`); legacy invalid data is not VERIFIED SAFE.
- MF-SWEEP-006: rectangular packing upper bound (0°/90°); zero if the rack
  footprint cannot fit; never exceeds the body grid.
- MF-SWEEP-007/008: valid usable intake and exhaust (geometry + min area
  0.05 m²). Invalid openings cannot satisfy availability. BLOCKER → INCOMPLETE.
- MF-SWEEP-009: HUD `data-mf-safety` / `data-mf-verified`; green only when
  VERIFIED. CRITICAL / INCOMPLETE / PRELIMINARY / OVER_CAPACITY are explicit.
- MF-SWEEP-011/019/020: `setPower` / `setRoomHeight` / `setRackAsicCount`
  fail closed. 80 kW → 80000 W. Height 0.50…50.00 m. asicCount integer,
  0…per-rack, fractions rejected.
- MF-SWEEP-016: dirty-filter extraPa added once at the network (pressure
  trace and fan extraFixedPa share the same penalty).

Does not start QX-02C. Does not publish. Does not declare FINAL PASSED.
Does not reopen QX-01 / QX-02A / FINAL-SEC.

## QX-02B-R — CANONICAL SAFETY INGRESS + FEASIBLE SPACE + AISLE + CRITICAL

Starting SHA `b47dea66db96559461b11ed90338409f0f8d6e8e`. Branch
`repair/qx-02b-r-safety-integrity`.

- R1: `validateCanonicalProjectDomains` is the single numeric boundary for
  room W/D/H, known electrical watts, requestedCount, rack asicCount
  (including per-rack cap when ASIC is resolvable). APPLY / patch / commit /
  load / import / persist share it. 9 MW +25% is capped at 10 MW or omitted.
- R2: Physical Space / empty-room rack fallback use `feasibleSpacePacking`.
  Every counted rack has a realizable body + service envelope; metamorphic
  analyzeRacks on the predicted arrangement does not collapse to 0.
- R3: `facingAisleGapM` requires opposing airflow, perpendicular overlap, and
  spatial order of intake faces. Looking-away pairs are not a facing aisle.
- R4: every Engineering CRITICAL warning sets `hasCriticalConflict`. Typical
  policy cannot hide design-load fail. Fan duty FAIL / fan outside / no fan
  cannot coexist with VERIFIED.

Does not start QX-02C. Does not publish. Does not declare FINAL PASSED.



