# AI HANDOFF — MINEFORGE 3D

**READ THIS FILE FIRST IF YOU ARE A NEW AI/DEVELOPER CONTINUING MINEFORGE 3D.**

Then read [PROJECT_STATE.md](PROJECT_STATE.md), [ARCHITECTURE.md](ARCHITECTURE.md), [RECOVERY.md](RECOVERY.md), and [project-handoff.json](project-handoff.json).

## Identity

| | |
|---|---|
| Product | MINEFORGE 3D |
| Repository | https://github.com/MarkGerber1/mineforge-3d |
| Default branch | `main` (protected; required check **`gate`**; `enforce_admins: true`) |
| Accepted functional baseline | `635fd9e965ed8d9705c310b72b82dde2b81f837f` (Batches 1–4 PASSED). Immutable. Live HEAD = `git rev-parse origin/main`. |
| Language of product UI | Russian |
| Persistence | Browser IndexedDB (`mineforge`), not GitHub |

Machine-readable copy: [project-handoff.json](project-handoff.json).

## What NOT to do

- Do **not** rebuild the product from scratch.
- Do **not** replace Deterministic Engineering Core with LLM numbers.
- Do **not** let AI call `applyFinding` or mutate canonical geometry silently.
- Do **not** bypass PENDING confirmation (`ADD TO MODEL`).
- Do **not** bypass protected `main`.
- Do **not** use `gh pr merge --admin`, force-push, or disable required CI.
- Do **not** skip tests with `|| true` / `continue-on-error`.
- Do **not** invent passing test evidence.
- Do **not** start Cloudflare / domains / tunnels unless Owner **explicitly** changes policy.
- Do **not** treat GitHub Pages as the full-stack production environment.
- Do **not** persist raw video.
- Do **not** claim centimetre accuracy from a photo or video frame.
- Do **not** merge disposable negative PRs #1–#5 (they exist to prove the gate fails closed).
- Do **not** commit `.env`, `.project_id`, or secret values.
- Do **not** self-declare a major repair batch **PASSED**. Report `READY FOR INDEPENDENT RETEST`.

## Current project status

**FUNCTIONAL ACCEPTANCE: BATCHES 1–4 PASSED** at SHA `635fd9e`.

| Batch | What was accepted |
|---|---|
| 1 | Security, App Edit isolation, fail-closed CI, public host **deferred** |
| 2 | Reality photo A–B calibration → PENDING → ADD → canonical Project |
| 3 | True 3D AABB, ceiling envelope, Reality → Engineering / SAFE, AI fail-closed |
| 4 | iPhone-sized mobile workspace + **real WebKit VP8 decode** → frames → Reality → Undo |

Owner operates the CAD product. GitHub/CI/runtime internals stay off the product HUD.

## What remains (FINAL-01)

- `PHYSICAL_IPHONE_SMOKE: WAITING_FOR_OWNER` — Owner Safari against the public URL. Playwright WebKit is not this field.
- `PUBLIC_PRODUCTION_DEPLOYMENT: BLOCKED_OWNER_PUBLISH` — need a provider-owned HTTPS host with `/api/runtime` JSON. GitHub Pages is static demo only. Tunnels forbidden.

Serverless production policy (`isServerlessProduction` = `GROK_PROJECT_ID` **or** `VERCEL=1`/`true`): App Edit forced off; public Grok AI fail-closed without a shared limiter (OPTION B). Process-local Map is single-instance only.

Owner action required to mint the public URL: **Publish** in Grok Build (`*.grok.me`) or authorize Vercel at the exact accepted `main` SHA. Then send the URL. Independent Quality Department retests production policy first.

Do not reopen MFQ-001…MFQ-006 unless a real regression appears.

QX-03R3 (in progress, not independently accepted): unregistered photos
cannot invent absolute wall position; DEFAULT overlay elevation cannot
become canonical z; lock policy is generic across every ID-addressable
canonical collection; 3D cancel (pointercancel / touchcancel / Escape /
lostpointercapture) rolls back and is not commit. Photogrammetry is not
implemented. Do not declare FINAL PASSED.

QX-03R2 (in progress, not independently accepted): A–B is scale only;
PhotoWallRegistration is the wall-plane mapping (cropped / reversed /
interior anchors). Scale-only photos cannot invent wall offset.
Opening APPLY is fail-closed (no silent clamp). Locked delete is honest
across Photo / 2D / 3D / AI. 3D canvas pointer E2E is separate from
store-automated 3D tests. Photogrammetry is not implemented. Do not
declare FINAL PASSED.

QX-03R (in progress, not independently accepted): one photo coordinate frame;
calibrated visual resize writes meters; linked overlays are views of canonical
objects (`reconcileLinkedReality`); APPLY ALL is atomic; linked delete is
explicit (detach vs delete from model); 3D drag rack/fan + along-wall opening
+ rotate 90°. Photogrammetry is not implemented. Do not declare FINAL PASSED.


QX-02A repairs wall-drag origin (West/South), preview/canonical isolation,
shared rack-transform validation, auto-layout target semantics, validated
`applyPatch`, and fan spatial integrity. Do not mix `live()` (visual, may
include failure overlay or drag preview) into canonical writes — use
`project` / `canonical()`. QX-02A-R: duplicate rack ids must be unique;
`resolveWallDragTarget` prefers nearest geometry over SVG hit-rect z-order;
HistoryEntry stores Measure A/B with the project snapshot.

QX-02B: SAFE fail-closed. Collision / wall / door / as-built / ceiling /
service-aisle racks are not usable capacity. Intake is a required ventilation
input. Invalid openings cannot satisfy exhaust/intake. HUD is VERIFIED /
PRELIMINARY / INCOMPLETE / CRITICAL / OVER_CAPACITY — green only when
verified. Power, height, and rack asicCount mutations fail closed. Dirty-filter
Pa is applied once.

QX-02B-R: one canonical numeric domain validator on every ingress (APPLY,
commit, load, import). VERIFIED Physical Space is demonstrably feasible
packing, not a body-only cell. Facing aisle requires intake faces to look at
each other in space. Every safety-relevant CRITICAL warning blocks VERIFIED.

QX-02B-R5: the same `validateCanonicalProjectDomains` now covers every
SAFETY_DRIVING / SAFETY_GEOMETRY numeric (ΔT, reserve, auxiliary/lighting/
network W, vent losses, fan count, service clearances, rack shelf geometry,
imported ASIC primitives). Inventory: `src/engineering/numeric-inventory.ts`.

QX-02B-R6/R7: ASIC spec relations (`designPowerW >= typicalPowerW`) and
supply-voltage compatibility (CRITICAL, maxByElectrical=0, Project still
canonical). Floor loading OPTION A: `maxFloorLoadPa` is net equipment payload
after dead load; FLOOR is a real SAFE slot; known floor requires a finite
limit > 0. Owner-approved PHASE 1 contract introduced during QX-02B-R6/R7
(PR #20). Merged on `main` (`c4f23f0`).

QX-02B-R8/R11: frequency compatibility (known range vs `frequencyHz`;
unknown range → PRELIMINARY, mismatch → CRITICAL `asic-frequency-mismatch`,
`maxByElectrical = 0`). ASIC trust: only `OFFICIAL_VERIFIED` and
`VERIFIED_SECONDARY` may reach VERIFIED; `TEST_FIXTURE` / `USER_ENTERED` /
`AI_FOUND_UNVERIFIED` / `ESTIMATED` stay PRELIMINARY. Grok cannot mint
official trust on imported specs. Phase topology: `inputPhases` 1|3 from
source; 1-phase uses `distributePhases()`, 3-phase loads all lines equally;
unknown topology is not VERIFIED. Inventory: `placedAsicCount ≤ requestedCount`
canonical; `engineeringDemandCount = max(requested, placed)` for electrical
and thermal. Floor OPTION A calculation is not reopened.

Do not start QX-02C. Do not reopen QX-01 / QX-02A / QX-02B / FINAL-SEC.

QX-03: Owner Editor + interactive photo workspace (PHASE 1 calibrated 2D
overlay, not photogrammetry). Persistent AI in 2D/3D/Photo, mobile and
desktop. Photo overlays ↔ canonical via `linkedObjectId` after APPLY TO
MODEL. Wall reassignment for openings. 3D is an editor. Same validators.
Draft overlays do not change SAFE.

Evidence: [docs/FINAL-01.md](docs/FINAL-01.md).

## How to start work

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git fetch origin
git rev-parse origin/main
# live HEAD is dynamic. Immutable baseline is acceptedFunctionalBaselineSha
# (635fd9e = independently accepted Batches 1–4). Do NOT trust a static currentCandidateSha.
gh run list --branch main --limit 5
npm ci --legacy-peer-deps
npm run recovery:verify
```

Then:

1. Read this file + PROJECT_STATE.md.
2. Create a **narrow** branch from current `origin/main`.
3. Change only what the task requires.
4. Open a PR to protected `main`.
5. Wait for required check **`gate`**.
6. Merge **without** `--admin`.
7. Confirm a **separate** post-merge CI run on the merge SHA.

Full install / env / tests: [RECOVERY.md](RECOVERY.md).

## Acceptance authority

Implementation AI may report **READY FOR INDEPENDENT RETEST**.

Independent Acceptance Auditor (or Owner) declares major batches PASSED.

## Owner interaction

Speak in product terms (Проект, SAFE, Reality, AI OFFLINE). Do not ask the Owner to operate Git, ports, or CI during normal product use.

## Proven Linux/WebKit note

Linux Playwright WebKitGTK can report video metadata while `canvas.drawImage(<video>)` stays black (GStreamer DMABuf overlay). Extraction plays the element on-screen, retries seek+canvas, then demuxes VP8 WebM via WebCodecs. CI sets `WEBKIT_GST_DMABUF_SINK_DISABLED=1`. Positive fixture **must** reach READY with distinct JPEG hashes — fail-closed is not a pass for `frames-rgb.webm`.
