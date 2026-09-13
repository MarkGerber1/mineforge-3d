# MINEFORGE ENGINEERING VERIFICATION REPORT

Date: 2026-09-13

## CORE MODULES

| Module | Status |
|---|---|
| Geometry / CAD | PASS |
| Openings | PASS |
| Shaft / pressure network | PASS |
| ASIC catalog (verified sources) | PASS |
| Electrical + phase balance | PASS |
| Heat / airflow | PASS |
| Fan curve / operating point | PASS |
| Requested / Safe / bottleneck | PASS |
| Racks / collision / auto layout | PASS |
| 2D/3D canonical state | PASS |
| Grok tool calling (server, no silent mutate) | PASS |
| Undo / autosave | PASS |
| Intent router PROJECT / APPLICATION / REALITY | PASS |
| Application Edit (local Git, protected paths) | PASS |
| Failure simulation (clone, no mutate) | PASS |
| Reality as-built → collision warnings | PASS |
| Reality calibration / Sync → canonical geometry | PASS |
| Reality 3D AABB / ceiling / vent consequence / AI pipeline | PASS |
| Mobile workspace (not shrunk desktop) | PASS |
| Reality video frame evidence (seek+canvas, fail-closed) | PASS |
| iPhone WebKit E2E (Playwright, CI mandatory) | PASS (CI) / local WebKit libs missing |

## UNIT TESTS

Oracle suite: `src/engineering/oracle/*.test.ts`

TOTAL: 126
PASSED: 126
FAILED: 0

| Test ID | Subsystem | Status |
|---|---|---|
| GEO-01 … GEO-06 | Geometry / CAD | PASS |
| GEO-3D-01 … GEO-3D-04 | True 3D AABB / ceiling envelope | PASS |
| ELEC-01 … ELEC-06 | Electrical | PASS |
| THERM-01 … THERM-07 | Heat / airflow | PASS |
| AIR-01 … AIR-05 | Duct / shaft / pressure | PASS |
| FAN-01 … FAN-04 | Fan / operating point | PASS |
| CAP-01 … CAP-04 | Requested / Safe / bottleneck | PASS |
| STATE-01 … STATE-04 | Digital twin / state | PASS |
| UX-E2E-02 | Dimension parsing | PASS |
| INT-01 … INT-04 | Intent + writable paths | PASS |
| FAIL-01 … FAIL-02 | Failure sim clone | PASS |
| REAL-01 … REAL-12 | Provenance, calibration, Sync → openings/as-built/wall, undo, persistence | PASS |
| REAL-13 … REAL-24 | 3D collision consequence, vent opening, AI Reality fail-closed, undo/redo | PASS |
| VIDEO-01 … VIDEO-13 | Real video policy, provenance, bounded frames, no silent mutate, persistRaw=false, VP8 demux | PASS |
| PERSIST-01 … PERSIST-08 | Save state idle/saving/saved/error, retry, stale-save race | PASS (oracle; PERSIST-03/04 via mobile CI) |
| TWIN-OPENING-01 … TWIN-OPENING-09 | Deterministic wall apertures, undo/redo, Reality ADD | PASS |
| WALL-RESIZE-01 … WALL-RESIZE-10 | Direct-wall numeric resize anchors, cancel/undo/redo | PASS |
| DIM-VALIDATION-01 … DIM-VALIDATION-08 | Reject not clamp; MIN 0.50 m; canonical unchanged | PASS |
| OBJECT-PLACE-01 … OBJECT-PLACE-11 | Shared CREATE/MOVE validator, fully outside invalid | PASS |

## E2E / UX

Primary workflow: demo → CAD → SAFE / bottleneck → 3D twin → Grok project query → Application Edit Git pipeline → Reality photo + A–B marker → video frames → failure sim.

Mobile 375×812 / 390×844 / 430×932: full-width CAD, compact REQUESTED/SAFE HUD, bottom tools, Reality/Grok sheet. No page-level horizontal overflow. MOB-01…10 via Playwright WebKit in CI. Local sandbox cannot launch WebKit (missing gstreamer/GTK); Chromium iPhone live evidence 16/16 in `docs/BATCH4-LIVE.json`.

## DEMO PROJECT

Underground parking: 8.000 × 5.000 × 2.8 m.  
30 × BITMAIN S21 Pro. Exhaust 1.4 × 0.9 m, shaft 75 m, FAN_STRONG, 150 kW.  
SAFE computed by the engine. Floor loading UNKNOWN → confidence PRELIMINARY.

## KNOWN LIMITATIONS

- Rectangular rooms only (L-shape / polygon deferred).  
- Fan library analytic curves besides fixtures are ESTIMATED until a manufacturer curve is imported.  
- Thermal X-Ray is a spatial estimate, not CFD.  
- Photos never claim millimetre accuracy; PHOTO_ESTIMATE until USER_CONFIRMED / FIELD_MEASUREMENT.
- Video frames are visual evidence (VIDEO_FRAME_ESTIMATE), not photogrammetry and not centimetre-accurate.
- Application Edit preview is HMR of the live app (no second preview URL).
- Grok requires XAI_API_KEY; core engineering remains offline.
- Floor loading remains UNKNOWN unless the user enters it.
- Physical iPhone Owner smoke-test deferred to FINAL RELEASE.
- Public production deployment deferred to FINAL RELEASE.

## CURRENT PHASE

**FUNCTIONAL ACCEPTANCE: BATCHES 1–4 PASSED** at SHA `635fd9e965ed8d9705c310b72b82dde2b81f837f`.

Continuity / recovery package: GitHub is the durable source of truth for non-secret source.
Start at `AI_HANDOFF.md`. Operational recovery: `RECOVERY.md`. Machine metadata: `project-handoff.json`.

QX-02A + QX-02A-R are merged on protected `main`. QX-02B is Engineering
safety + SAFE fail-closed (candidate). Developer does **not** self-accept.

Repair Batch 1 PASSED (SHA `8f5c9c0dd4909db51a28a2e14cff12b29c00b218`).
Repair Batch 2 — Reality geometry pipeline (SHA `7c9f25ae31fab0fe501f542856210adfb7dcfb4c`).
Repair Batch 3 — Reality → Engineering + true 3D (SHA `a783606cd2665b57b8247bcb3dcb906221fa8fc1`).
Repair Batch 4 initial merge (SHA `a9c6c64ec0ddc80128881fea4191b347dbf5807a`).
Repair Batch 4 WebKit video correction (SHA `635fd9e965ed8d9705c310b72b82dde2b81f837f`).

```
PHYSICAL_IPHONE_SMOKE: DEFERRED_TO_FINAL_RELEASE
PUBLIC_PRODUCTION_DEPLOYMENT: DEFERRED_TO_FINAL_RELEASE
```
