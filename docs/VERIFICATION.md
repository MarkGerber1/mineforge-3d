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
| QX-03R photo↔canonical sync / atomic APPLY / 3D drag | READY FOR INDEPENDENT QUALITY RETEST |
| QX-03R2 wall registration / fail-closed APPLY / locked delete / canvas 3D | READY FOR INDEPENDENT QUALITY RETEST (not independently accepted) |
| QX-03R3 fail-closed absolute photo position / complete lock / 3D cancel | READY FOR INDEPENDENT QUALITY RETEST (not independently accepted) |
| QX-03R4 Canonical→Photo no invented nx / typed lock identity | READY FOR INDEPENDENT QUALITY RETEST (not independently accepted) |
| QX-02B-R12 service envelope + imported ASIC trust | READY FOR QX-02B INDEPENDENT RETEST (not independently accepted) |

## UNIT TESTS

Oracle suite: `src/engineering/oracle/*.test.ts`

TOTAL: 592
PASSED: 592
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
| PHOTO-01 … PHOTO-08 / WALL-REASSIGN-01 … 03 / INT-QX03 | Photo overlay drafts, APPLY linkage, wall reassignment, view sync, intent | QX-03 |
| WALL-RESIZE-01 … WALL-RESIZE-10 | Direct-wall numeric resize anchors, cancel/undo/redo | PASS |
| DIM-VALIDATION-01 … DIM-VALIDATION-08 | Reject not clamp; MIN 0.50 m; canonical unchanged | PASS |
| OBJECT-PLACE-01 … OBJECT-PLACE-11 | Shared CREATE/MOVE validator, fully outside invalid | PASS |
| R11-01 … R11-09 | Unregistered photo cannot invent absolute wall offset | PASS (oracle) |
| R14-01 … R14-07 | DEFAULT elevation is not absolute provenance | PASS (oracle) |
| R12-01 … R12-08 | Generic locked delete across fans / asBuilt / mixed | PASS (oracle) |
| R13 Twin3D code | commitDrag ≠ cancelDrag; pointercancel is not onUp | PASS (oracle) |

## E2E / UX

Primary workflow: demo → CAD → SAFE / bottleneck → 3D twin → Grok project query → Application Edit Git pipeline → Reality photo + A–B marker → video frames → failure sim.

Mobile 375×812 / 390×844 / 430×932: full-width CAD, compact REQUESTED/SAFE HUD, bottom tools, Reality/Grok sheet. No page-level horizontal overflow. MOB-01…10 via Playwright WebKit in CI. Local sandbox cannot launch WebKit (missing gstreamer/GTK); Chromium iPhone live evidence 16/16 in `docs/BATCH4-LIVE.json`.

## DEMO PROJECT

Underground parking: 8.000 × 5.000 × 2.8 m.  
30 × BITMAIN S21 Pro. Exhaust 1.4 × 0.9 m, shaft 75 m, FAN_STRONG, 150 kW.  
SAFE computed by the engine. Floor loading UNKNOWN → confidence PRELIMINARY.
When the Owner declares floor known, a finite net payload (Pa) is required
and FLOOR participates in SAFE.

## KNOWN LIMITATIONS

- Rectangular rooms only (L-shape / polygon deferred).  
- Fan library analytic curves besides fixtures are ESTIMATED until a manufacturer curve is imported.  
- Thermal X-Ray is a spatial estimate, not CFD.  
- Photos never claim millimetre accuracy; PHOTO_ESTIMATE until USER_CONFIRMED / FIELD_MEASUREMENT.
- Video frames are visual evidence (VIDEO_FRAME_ESTIMATE), not photogrammetry and not centimetre-accurate.
- Application Edit preview is HMR of the live app (no second preview URL).
- Grok requires XAI_API_KEY; core engineering remains offline.
- Floor loading remains UNKNOWN unless the Owner enters a finite net payload
  (`maxFloorLoadPa`, OPTION A). Known floor without a limit is rejected.
  Incompatible ASIC supply voltage is CRITICAL, not a Project reject.
- Physical iPhone Owner smoke-test deferred to FINAL RELEASE.
- Public production deployment deferred to FINAL RELEASE.

## CURRENT PHASE

**FUNCTIONAL ACCEPTANCE: BATCHES 1–4 PASSED** at SHA `635fd9e965ed8d9705c310b72b82dde2b81f837f`.

Continuity / recovery package: GitHub is the durable source of truth for non-secret source.
Start at `AI_HANDOFF.md`. Operational recovery: `RECOVERY.md`. Machine metadata: `project-handoff.json`.

QX-02A + QX-02A-R + QX-02B + QX-02B-R + QX-02B-R5 + QX-02B-R6/R7 are
merged on protected `main` (R6/R7 at `c4f23f0`).
QX-02B-R8/R11 is frequency + trust + phase topology + inventory (candidate).
Developer does **not** self-accept.

## QX-02B-R6/R7 oracle (merged `c4f23f0`)

| Test ID | Subsystem | Status |
|---|---|---|
| ASIC-REL-01 … ASIC-REL-07 | ASIC spec relations (`design ≥ typical`) | PASS (oracle) |
| R6-C | malformed design power cannot inflate electrical SAFE | PASS (oracle) |
| VOLT-01 … VOLT-10 | supply voltage compatibility CRITICAL | PASS (oracle) |
| FLOOR-REL-01 … FLOOR-REL-04 | known floor requires finite payload > 0 Pa | PASS (oracle) |
| FLOOR-SAFE-01 … FLOOR-SAFE-12 | FLOOR slot, monotonicity, packing, HUD | PASS (oracle) |

Floor model: OPTION A `NET_EQUIPMENT_PAYLOAD`. `maxFloorLoadPa` is Owner-entered
net equipment payload pressure (Pa) AFTER permanent structure and rack dead
load. Documented fixture: `STANDARD_NET_FLOOR_PAYLOAD_PA = 10_000` (10 kPa).
Engineering does not invent rack self-weight. Screening:
`Σ floor(limitPa × A_rack / (m_asic × g))` on demonstrated rack footprints
(placed usable racks, or `feasibleSpacePacking` if the room is empty).
Blocked racks contribute 0.

Floor OPTION A is the Owner-approved PHASE 1 contract introduced during
QX-02B-R6/R7 (PR #20). Calculation is unchanged in R8/R11.

## QX-02B-R8/R11 oracle (candidate)

| Test ID | Subsystem | Status |
|---|---|---|
| FREQ-01 … FREQ-10 | ASIC supply frequency compatibility | PASS (oracle) |
| TRUST-01 … TRUST-10 | ASIC provenance vs VERIFIED | PASS (oracle) |
| PHASE-01 … PHASE-12 | 1-phase / 3-phase topology + current provenance | PASS (oracle) |
| INV-01 … INV-14 | placed ≤ requested; demand defense-in-depth | PASS (oracle) |
| ADV-ELEC-01 … ADV-ELEC-08 | combined frequency/trust/phase/inventory | PASS (oracle) |

Catalog (source-proven only; no invented 50–60 / 1-phase):

| Model | V | Hz | phases | currentA | trust |
|---|---|---|---|---|---|
| S21 Pro | 220–277 | 50–60 | 1 | 20 nameplate | OFFICIAL_VERIFIED |
| S21 | 220–277 | 47–63 | 1 | 20 nameplate | OFFICIAL_VERIFIED |
| T21 | 380–415 | 50–60 | 3 | 12 nameplate | OFFICIAL_VERIFIED |
| M60S | 200–277 | UNKNOWN | UNKNOWN | absent | VERIFIED_SECONDARY |
| TEST_ASIC_A | 230–230 | 50–60 synthetic | 1 | 15.260869565 | TEST_FIXTURE |

VERIFIED fixtures use `officialTestAsicA()` (TEST_ASIC_A numbers +
`OFFICIAL_VERIFIED`) and rebuild auto-layout so placed === requested.
Catalog TEST_ASIC_A remains TEST_FIXTURE.

`electrical.voltageV` is the voltage at the selected ASIC terminals
(1-phase = single-phase input; 3-phase = line-to-line). Owner-facing
current prefers manufacturer `currentA`; I=P/U (1-phase) and
I=P/(√3×U_LL) (3-phase screening, PF not modeled) stay labelled
calculated traces.

Repair Batch 1 PASSED (SHA `8f5c9c0dd4909db51a28a2e14cff12b29c00b218`).
Repair Batch 2 — Reality geometry pipeline (SHA `7c9f25ae31fab0fe501f542856210adfb7dcfb4c`).
Repair Batch 3 — Reality → Engineering + true 3D (SHA `a783606cd2665b57b8247bcb3dcb906221fa8fc1`).
Repair Batch 4 initial merge (SHA `a9c6c64ec0ddc80128881fea4191b347dbf5807a`).
Repair Batch 4 WebKit video correction (SHA `635fd9e965ed8d9705c310b72b82dde2b81f837f`).

```
PHYSICAL_IPHONE_SMOKE: DEFERRED_TO_FINAL_RELEASE
PUBLIC_PRODUCTION_DEPLOYMENT: DEFERRED_TO_FINAL_RELEASE
```
