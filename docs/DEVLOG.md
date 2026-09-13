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
