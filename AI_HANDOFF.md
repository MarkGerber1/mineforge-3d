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

QX-02A repairs wall-drag origin (West/South), preview/canonical isolation,
shared rack-transform validation, auto-layout target semantics, validated
`applyPatch`, and fan spatial integrity. Do not mix `live()` (visual, may
include failure overlay or drag preview) into canonical writes — use
`project` / `canonical()`. QX-02A-R: duplicate rack ids must be unique;
`resolveWallDragTarget` prefers nearest geometry over SVG hit-rect z-order;
HistoryEntry stores Measure A/B with the project snapshot.

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
