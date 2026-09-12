# Repair Batch 4 — iPhone Mobile E2E + Real Video Evidence

Starting main SHA: `a783606cd2665b57b8247bcb3dcb906221fa8fc1`

Public production host: DEFERRED TO FINAL RELEASE. No tunnels, no domains.

PHYSICAL_IPHONE_SMOKE: DEFERRED_TO_FINAL_RELEASE (owner policy, not a Batch 4 defect).

## Mobile workspace

Not a shrunk desktop. iPhone-sized layout:

- CAD viewport + compact REQUESTED/SAFE HUD + 44px toolbar + bottom sheet
- Undo and Redo visible (`size-11`)
- Reality, Grok, Inspector/SAFE, App tabs in the sheet (closed / half / full)
- Safe-area insets on shell, toolbar, sheet
- `viewport-fit=cover` + `visualViewport` keyboard offset `--mf-kbd`
- Landscape keeps the toolbar (no longer `display:none`)
- Desktop Inspector / Grok / Reality are not mounted below 768px (no duplicate panels)

Touch:

- 2D: 44×44 dimension hit targets; dim label edits the displayed length
- 3D: OrbitControls + ceiling toggle `min-h-11`
- Photo annotator: pointer A–B, pinch zoom, 44px kind chips

## Video pipeline

Browser decode only. Extension never claims support (`canPlayType`).

```
File → object URL → <video> metadata → seek → canvas JPEG → Reality photo-like evidence
```

| Limit | Value |
|---|---|
| max input | 24 MB |
| sample | start, 25%, 50%, 75%, end (≤ 6 frames) |
| stored edge | 960 px JPEG |
| AI frames | 3 stills + timestamps, never the video file |
| raw persist | always `persistRaw: false` |

Provenance: `VIDEO_FRAME_ESTIMATE`. Extraction is **not** `FIELD_MEASUREMENT`. A–B with a typed length uses the existing Batch 2 calibration (`FIELD_MEASUREMENT` scale). ADD TO MODEL is the only canonical mutation.

Fail-closed: `VIDEO_UNSUPPORTED` / `VIDEO_DECODE_FAILED` / `VIDEO_TOO_LARGE` / `VIDEO_ZERO_DURATION` / `VIDEO_CANCELLED`. No synthetic frames. Object URLs always revoked (`window.__MF_VIDEO__.liveObjectUrlCount`).

Fixtures: `tests/fixtures/video/frames-rgb.mp4` (4.00 s, 320×180, H.264, 5 fps), `.webm` VP8 fallback, `corrupt.mp4`.

## Live evidence (Chromium iPhone viewports)

Local sandbox cannot launch Playwright WebKit (missing libgstreamer / GTK / flite). CI installs `npx playwright install --with-deps webkit` and **fails** if WebKit cannot start. No `|| true`, no `continue-on-error`.

Supplementary live run (Chromium, iPhone-sized, hasTouch): **16/16 PASS**. See `docs/BATCH4-LIVE.json`.

| Profile | Result |
|---|---|
| 375×812 | overflow `scrollWidth=375`; 2D; Reality sheet; Grok sheet; Undo ≥ 40px |
| 390×844 | dim 8.000 → 7.51; Undo 8; Redo 7.51; photo A–B + PENDING door + ADD; SAFE 36 |
| 430×932 | 3D + ceiling hide; compare Проект/Факт/Δ; video; AI OFFLINE; no overflow |

Video fixture `frames-rgb.mp4`:

- MIME `video/mp4` (browser-reported)
- duration 4000 ms
- 5 frames at 0 / 1000 / 2000 / 3000 / 4000 ms
- 320×180 JPEG stills, `kind=video-frame`, `sourceVideoId` set
- `persistRaw=false`; live object URLs after extract = 0
- openings unchanged until ADD
- corrupt fixture → `VIDEO_DECODE_FAILED`, geometry unchanged

## Tests

Oracle VIDEO-01…12 + persistence + PHOTO EXIF helper.

Playwright WebKit MOB-01…10 + video ingest + orientation + console cleanliness (`npm run test:mobile`).

## CI

`.github/workflows/batch1-gate.yml` installs Playwright WebKit with OS deps, then `scripts/ci-gate.sh` (typecheck, `npm test`, WebKit install, `test:mobile`, secrets, build).

Artifact `batch4-webkit-video-evidence` uploads `test-results/batch4-webkit-video.json` (`if: always()`). A failed positive decode still fails the gate.

## Correction pass — WebKit positive decode

Starting SHA: `a9c6c64ec0ddc80128881fea4191b347dbf5807a`

Known-good fixture: `tests/fixtures/video/frames-rgb.webm` (VP8, 4.00 s, 320×180, all-intra, 4 colour scenes).

The WebKit E2E **must** reach `READY` with ≥2 real JPEG stills whose hashes differ. `VIDEO_UNSUPPORTED` / `VIDEO_DECODE_FAILED` for this fixture is a **FAIL**. Corrupt `corrupt.mp4` remains a separate negative test.

## Deferred

- PHYSICAL_IPHONE_SMOKE: DEFERRED_TO_FINAL_RELEASE
- PUBLIC_PRODUCTION_DEPLOYMENT: DEFERRED_TO_FINAL_RELEASE
