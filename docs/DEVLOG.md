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
