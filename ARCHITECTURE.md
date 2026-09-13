# ARCHITECTURE — MINEFORGE 3D

Read [AI_HANDOFF.md](AI_HANDOFF.md) first. Status: [PROJECT_STATE.md](PROJECT_STATE.md).

## Data flow

```
Owner / UI
    ↓  (commands, CAD, Reality, Grok messages)
canonical Project State          (Zustand + Zod schema v1)
    ↓  calculateAll()
Deterministic Engineering Core   (SAFE, kW, m³/h, warnings)
    ├─→ 2D CAD                   (same x/y/openings/racks)
    ├─→ 3D Digital Twin          (same + z / ceiling)
    ├─→ Inspector HUD            (REQUESTED / SAFE)
    ├─→ Reality findings         (PENDING until ADD)
    ├─→ AI                       (quotes Core; proposes only)
    └─→ persistence              (IndexedDB; JPEG media; no raw video)
```

## Module boundaries (key files)

| Layer | Files |
|---|---|
| Types / Project | `src/engineering/types.ts`, `src/project/schema.ts`, `src/project/factory.ts` |
| Live store | `src/project/store.ts` (`window.__MF_STORE__` for E2E) |
| Persistence | `src/project/persistence.ts`, `src/reality/media.ts` (IDB `mineforge`) |
| Engineering Core | `src/engineering/pipeline.ts` (`calculateAll`), `geometry.ts`, `electrical.ts`, `thermal.ts`, `airflow.ts`, `pressure.ts`, `fans.ts`, `capacity.ts`, `racks.ts`, `aabb3.ts`, `units.ts`, `constants.ts` |
| Catalogs | `src/equipment/asic-catalog.ts`, `src/equipment/fan-catalog.ts` |
| Reality geometry | `src/engineering/reality.ts` (`calibrateFromKnownDistance`, `parseAiFinding`, `applyFinding`, `attachVideoFrames`) |
| Video | `src/reality/video-policy.ts`, `src/reality/video.ts`, `src/reality/webm.ts` |
| 2D | `src/components/cad/Cad2D.tsx` |
| 3D | `src/components/twin/Twin3D.tsx` |
| Mobile chrome | `src/components/app/AppShell.tsx`, `MobileHud.tsx`, `MobileToolbar.tsx`, `BottomSheet.tsx` |
| Reality UI | `src/components/reality/RealityPanel.tsx`, `PhotoAnnotator.tsx` |
| AI | `src/ai/intent.ts`, `grok.ts` (server fn), `grok-engine.server.ts`, `critic.ts`, `failure.ts` |
| App Edit | `privilege.server.ts`, `jobs.server.ts`, `http.server.ts`, `paths.ts`, `appedit.ts` |
| Oracle | `src/engineering/oracle/*.test.ts` |
| WebKit E2E | `src/e2e/mobile.webkit.test.ts` |
| Gate | `scripts/ci-gate.sh`, `.github/workflows/batch1-gate.yml` |

## Engineering boundary

`calculateAll(project, catalogs)` is the only place SAFE / electrical / thermal / fan operating point are produced.

- SI units throughout.
- Heat: `Q = P / (ρ Cp ΔT)`.
- Current: `I = P / U` at 230 V (typical vs design).
- Duct/shaft: Darcy-Weisbach + K; quadratic fan operating point.
- SAFE = `min()` of **known** constraints. Unknown floor load → confidence PRELIMINARY, not a fabricated kPa.
- `Aabb3`: collision only if X **and** Y **and** Z overlap.

AI tools may read the result summary and **propose_patch** / **propose_finding**. They cannot write Project.

## Reality boundary

```
evidence (photo JPEG or video-frame JPEG)
  → Owner A–B / annotation  (isotropic m/px if a length is typed)
  → RealityFinding status=PENDING  (incomplete geometry stays incomplete)
  → Owner ADD TO MODEL
  → applyFinding() mutates canonical Project
  → calculateAll()
```

Provenance: `PHOTO_ESTIMATE` | `VIDEO_FRAME_ESTIMATE` | `FIELD_MEASUREMENT` | `USER_CONFIRMED` | …

`parseAiFinding` is fail-closed: finite numbers only, no `x \|\| 1` invention. Missing fields → `incomplete`; ADD refuses.

## Video boundary

```
File
  → canPlayType (not file extension)
  → object URL + visible <video> play-through
  → canvas / ImageBitmap / VideoFrame JPEG (≤960 px, ≤6 frames)
  → seek retry if needed
  → WebM VP8 demux + WebCodecs if the element presents no pixels
  → Reality photos kind=video-frame + sourceVideoId + timestampMs
  → persistRaw: false  (raw bytes discarded)
```

Extraction is **not** `FIELD_MEASUREMENT`. Linux WebKitGTK DMABuf can yield a black canvas; CI disables that sink. Positive fixture must produce distinct real hashes.

Grok receives **selected JPEG stills + timestamps**, never the video file.

## App Edit boundary

Developer/owner capability on a **git worktree process**.

1. `APP_EDIT_ENABLED` must be true **and** an **owner** session (`mf_priv` HMAC cookie) must exist.
2. Writable paths: `src/components/**`, `src/styles.css`, plus a short AI registry list. **Protected:** `src/engineering/**`, `src/equipment/**`, project schema/factory.
3. Isolated branch/worktree → typecheck / tests / build → real SSR preview or **fail-closed**.
4. PROMOTE copies an exact SHA; mismatch refuses. Rollback to stable SHA.

Standard-user passphrase cannot mutate source. Forged roles ignored.

On serverless production (`isServerlessProduction`: `GROK_PROJECT_ID` **or** `VERCEL=1`/`true`): Application Edit is **forced off** even if the flag is true. UI must show APP EDIT DISABLED. Process-local rate-limit Map is **not** global protection. Public Grok AI is **fail-closed** unless a shared limiter exists (none is implemented). Rate-limit identity on Vercel is `x-real-ip` / `x-vercel-forwarded-for`; Cloudflare headers are not trusted unless `RATE_LIMIT_TRUST=cloudflare`.

## Deployment boundary

Three identities, do not conflate:

| Identity | What it can do |
|---|---|
| **SOURCE** | GitHub protected `main` + required `gate` |
| **PUBLIC LIVE** | Provider-owned HTTPS (`*.grok.me` / Vercel): `/api/runtime` JSON, App Edit honestly off, Grok **fail-closed** until a shared limiter exists. Empty until Owner publishes. |
| **STATIC DEMO** | GitHub Pages CAD snapshot. `GET /api/runtime` is not JSON → client **STATIC MODE**. |

Workspace preview is not PUBLIC LIVE. Tunnels are not PUBLIC LIVE.

See `docs/CANONICAL-RUNTIME.md` and `docs/FINAL-01.md`.

## Persistence

IndexedDB database `mineforge`:

- `projects` — canonical `Project` JSON (schemaVersion 1)
- `meta` — last project id
- `media` — JPEG data URLs for photos and extracted video frames

**Not** persisted: raw video (`persistRaw: false`), object URLs, Zustand-only UI (sheet, Grok transcript, videoJob). Reloading restores the farm; it does not restore the chat.
