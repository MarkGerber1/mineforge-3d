# PROJECT STATE — MINEFORGE 3D

Canonical status for humans and AI agents. Start with [AI_HANDOFF.md](AI_HANDOFF.md). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Recovery: [RECOVERY.md](RECOVERY.md).

## Product purpose

MINEFORGE 3D is an **engineering CAD / digital-twin** for a PHASE 1 ASIC mining facility (room, openings, racks, ventilation, electrical, heat). The operator designs in 2D, inspects a 1:1 3D twin, attaches Reality evidence (photo / video frames), and reads **REQUESTED / SAFE** from a deterministic engine — not from a chat model.

## Source of truth

**Deterministic Engineering Core is the only source of engineering numbers.**

AI must never invent airflow, pressure, SAFE COUNT, or electrical results. AI may **propose**; the Owner confirms; Engineering Core recalculates.

Canonical state is `Project` (`src/engineering/types.ts`). 2D and 3D consume the same object. Zustand store (`src/project/store.ts`) is the live owner of that object plus undo history.

## Current accepted state

**FUNCTIONAL ACCEPTANCE: BATCHES 1–4 PASSED**

Accepted baseline SHA (until a later accepted merge supersedes it):

`635fd9e965ed8d9705c310b72b82dde2b81f837f`

Required CI check: **`gate`**. Protected `main`, `enforce_admins: true`.

Product auth / shared database: **OFF** (`.grok/app-env.json` `VITE_AUTH_ENABLED=false`). Persistence is local IndexedDB.

## Accepted capabilities

| Area | What exists |
|---|---|
| Project State | schemaVersion 1, Zod parse, undo/redo, autosave |
| 2D CAD | SVG plan, snap, wall/opening/rack tools, 44px dimension edit |
| 3D Digital Twin | Three.js / R3F 1:1 twin, ceiling plane at `room.heightM` |
| Engineering Core | SI units; Q=P/(ρCpΔT); I=P/U; Darcy-Weisbach; SAFE = min of known constraints |
| REQUESTED / SAFE | HUD; bottlenecks; PRELIMINARY when floor load unknown |
| Reality photo | import, EXIF-aware size, A–B known-distance scale (m/px, not photogrammetry) |
| PENDING → ADD | findings stay PENDING until Owner ADD TO MODEL |
| As-built | 3D AABB vs racks; Z-separation is not a collision |
| Reality → Engineering | confirmed openings/as-built feed pipeline; SAFE only if that constraint binds |
| AI scopes | PROJECT / APPLICATION / REALITY via `routeIntent` |
| App Edit | owner session, isolated git job, fail-closed preview, exact SHA promote; UI paths only |
| Persistence | IndexedDB `mineforge` (projects + JPEG media). Raw video **not** stored |
| Mobile | separate shell (CAD + HUD + toolbar + sheet), not a shrunk desktop |
| Playwright WebKit | CI-mandatory iPhone profiles 375×812 / 390×844 / 430×932 |
| Video | real browser decode → bounded JPEG stills → `VIDEO_FRAME_ESTIMATE` |
| AI OFFLINE | explicit; CAD / Reality / extract / Engineering / Undo remain |

Demo seed: underground parking 8.000 × 5.000 × 2.8 m, 30 × BITMAIN S21 Pro, exhaust 1.4 × 0.9 m, FAN_STRONG, 150 kW.

## Known limitations

- Rectangular rooms only (L-shape / polygon deferred).
- Fan curves besides fixtures are ESTIMATED until a manufacturer curve is imported.
- Thermal X-Ray is a spatial estimate, not CFD.
- Photos / video frames never claim millimetre or centimetre field accuracy.
- Video is **not** photogrammetry.
- Real iOS Safari keyboard and physical device chrome are not proven (Playwright WebKit only).
- Floor loading UNKNOWN unless the Owner enters it → SAFE confidence PRELIMINARY.
- Application Edit is a **developer/owner** capability on a git worktree process, not a public multi-tenant editor. Serverless (`GROK_PROJECT_ID` **or** `VERCEL=1`/`true`) forces it **off**.
- Static GitHub Pages cannot run `/api/*`, Grok, or App Edit.
- No public server-capable hostname is recorded until Owner publishes.

## Deferred final-release tasks

```
PHYSICAL_IPHONE_SMOKE: WAITING_FOR_OWNER
PUBLIC_PRODUCTION_DEPLOYMENT: BLOCKED_OWNER_PUBLISH
```

FINAL-01 source freeze started at `fb471f5a09d3a0143c58d3362e8e0b982796ba49`.
Live HEAD is `git rev-parse origin/main`. Public server-capable URL is empty
until Owner publishes Grok Build (`*.grok.me`) or Vercel. GitHub Pages is a
static demo only. Playwright WebKit is not physical iPhone.

Evidence: `docs/FINAL-01.md`, `docs/final-01.json`, `docs/CANONICAL-RUNTIME.md`.

## Important historical SHAs

| Milestone | SHA |
|---|---|
| Batch 1 accepted | `8f5c9c0dd4909db51a28a2e14cff12b29c00b218` |
| Batch 2 accepted | `7c9f25ae31fab0fe501f542856210adfb7dcfb4c` |
| Batch 3 accepted main | `a783606cd2665b57b8247bcb3dcb906221fa8fc1` |
| Batch 4 initial merge (PR #9) | `a9c6c64ec0ddc80128881fea4191b347dbf5807a` |
| Batch 4 final accepted correction (PR #10) | `635fd9e965ed8d9705c310b72b82dde2b81f837f` |

Evidence: `docs/BATCH1-EVIDENCE.md`, `docs/BATCH2.md`, `docs/BATCH3.md`, `docs/BATCH4.md`, `docs/VERIFICATION.md`.

Negative PRs #1–#5 stay **open** (disposable gate-failure proofs). Do not merge them.
