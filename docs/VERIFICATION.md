# MINEFORGE ENGINEERING VERIFICATION REPORT

Date: 2026-09-11

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
| Mobile workspace (not shrunk desktop) | PASS |

## UNIT TESTS

Oracle suite: `src/engineering/oracle/*.test.ts`

TOTAL: 55  
PASSED: 55  
FAILED: 0

| Test ID | Subsystem | Status |
|---|---|---|
| GEO-01 … GEO-06 | Geometry / CAD | PASS |
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

## E2E / UX

Primary workflow: demo → CAD → SAFE / bottleneck → 3D twin → Grok project query → Application Edit Git pipeline → Reality photo + A–B marker → failure sim.

Mobile 390×844: full-width CAD, compact REQUESTED/SAFE HUD, bottom tools, AI sheet. No page-level horizontal overflow.

## DEMO PROJECT

Underground parking: 8.000 × 5.000 × 2.8 m.  
30 × BITMAIN S21 Pro. Exhaust 1.4 × 0.9 m, shaft 75 m, FAN_STRONG, 150 kW.  
SAFE computed by the engine. Floor loading UNKNOWN → confidence PRELIMINARY.

## KNOWN LIMITATIONS

- Rectangular rooms only (L-shape / polygon deferred).  
- Fan library analytic curves besides fixtures are ESTIMATED until a manufacturer curve is imported.  
- Thermal X-Ray is a spatial estimate, not CFD.  
- Photos never claim millimetre accuracy; PHOTO_ESTIMATE until USER_CONFIRMED / FIELD_MEASUREMENT.  
- Application Edit preview is HMR of the live app (no second preview URL).  
- Grok requires XAI_API_KEY; core engineering remains offline.  
- Floor loading remains UNKNOWN unless the user enters it.

## CURRENT PHASE

Repair Batch 1 PASSED under owner revised release policy (SHA `8f5c9c0`).
Repair Batch 2 — Reality geometry pipeline (calibration → findings → canonical state).
PUBLIC PRODUCTION DEPLOYMENT deferred to FINAL RELEASE.
