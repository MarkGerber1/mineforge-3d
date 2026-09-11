# MINEFORGE 3D — Repair Batch 1 evidence

**BATCH STATUS:** READY FOR INDEPENDENT RETEST

This file is the evidence package. It does not contain secrets.

## Identity

| Field | Value |
| --- | --- |
| Branch | `repair/batch-1` (fast-forwarded to `main`) |
| Stable/base SHA | `9e22bbd706d479be41b2dd79433cd697f40d2a71` |
| Candidate SHA | `cb342ef8c9938993a94950504469a1f1ed55e864` |
| Worktree | `/workspace` |
| Canonical server runtime | Grok Build live preview (full-stack). Health: `GET /api/runtime` → `{ "mode": "server" }` |
| Public static CAD | https://markgerber1.github.io/mineforge-3d/ (Option B — no server, AI OFFLINE) |
| Source | https://github.com/MarkGerber1/mineforge-3d |

`CANDIDATE_SHA` = this commit on `repair/batch-1` / `main`.

## Architecture (Task 1–3)

Deny-by-default HMAC session cookie `mf_priv` (httpOnly, SameSite=Lax). Client `role` / `userId` / `isOwner` / headers are ignored. Feature flag `APP_EDIT_ENABLED` must be `true`/`1`/`on`. Privileged mutations: create-branch, write, commit, rollback, create-job, promote, reject. Audit JSONL `.grok/app-edit-audit.jsonl` (gitignored). Isolated jobs: `git worktree` + branch `ai-edit/<job-id>`, gates `npm run typecheck`, `npm run test:oracle` (or `npm test`), `npm run build` inside the worktree. Preview at `/__preview/<jobId>/` on the same origin (not HMR). PROMOTE is ff-only of the exact `jobCommitSha`. REJECT deletes the worktree/branch. ROLLBACK uses `promote-log.json` previous SHA.

CAD auth remains OFF. Application Edit uses a dedicated gate, not Better Auth.

Secrets (`XAI_API_KEY`, `APP_EDIT_*`) are server env only. Never `VITE_`.

## Changed files

`package.json`, `startup.sh`, `vite.config.ts`, `src/router.tsx`, `src/project/store.ts`, `src/ai/appedit.ts`, `src/ai/grok.ts`, `src/ai/privilege.server.ts`, `src/ai/audit.server.ts`, `src/ai/http.server.ts`, `src/ai/jobs.server.ts`, `src/ai/runtime-client.ts`, `src/ai/basepath.ts`, `src/ai/privilege.test.ts`, `src/ai/jobs.test.ts`, `src/ai/runtime-client.test.ts`, `src/components/app/AppEditPanel.tsx`, `src/components/app/GrokPanel.tsx`, `src/components/app/TopBar.tsx`, `scripts/app-edit-http-plugin.mjs`, `scripts/ci-gate.sh`, `scripts/scan-client-secrets.mjs`, `server/middleware/app-edit-http.ts`, `.github/workflows/batch1-gate.yml`, `docs/CANONICAL-RUNTIME.md`, `docs/BATCH1-EVIDENCE.md`

## Task 1 — authorization

Commands: `npm run test:security` → **21/21 pass**.

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 anonymous create-branch | 401, no branch | unit HTTP + live `POST /api/app-edit/create-branch` → 401 |
| AC-2 anonymous write | 401, file unchanged | unit + live 401 |
| AC-3 anonymous commit | 401 | unit + live 401 |
| AC-4 anonymous rollback | 401, HEAD unchanged | unit + live 401, SHA `9e22bbd…` |
| AC-5 standard user | 403 | live login with user passphrase (client sent `role=owner`) → session `role=user`, create-branch 403 |
| AC-6 owner | 200 | live login (client sent `role=user`) → `role=owner`; job `gatepass1` 200 |
| AC-7 spoof | 401 | live body `role=owner,isOwner,isAdmin` without cookie → 401 |
| AC-8 flag off | 403 | unit flag-off; live production preview `/api/runtime` `appEditEnabled:false`; `POST /api/app-edit/create-branch` 403 |
| AC-9 bundle secrets | PASS | `npm run scan:secrets` — 28 files, no secret values |
| AC-10 automated AC-1–8 | PASS | `src/ai/privilege.test.ts` |

Regression: anonymous CAD on server runtime, no owner role required. Playwright: room 8×5×2.8, S21 Pro ×30, SAFE 36 / requested 30.

## Task 2 — canonical runtime

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 dims | PASS | Grok: width 8 m, depth 5 m, height 2.8 m from PROJECT JSON |
| AC-2 ASIC | PASS | Grok: Bitmain S21 Pro, `fleet.asicId = "bitmain-s21-pro"`, 30 шт. |
| AC-3 power | PASS | Grok: `availablePowerW` **150000** (150 kW) |
| AC-4 updated state | PASS | UI power → 120000; Grok: `availablePowerW` = **120000**; SAFE 29 |
| AC-5 network | PASS | `GET /api/runtime` 200 `application/json`; `POST /_serverFn/…grokEngineer…` 200 `application/json` |
| AC-6 AI OFFLINE | PASS (static) | Pages `/api/runtime` 404 `text/html`; client bundle contains `STATIC MODE` / `AI OFFLINE`; no fake Grok |
| AC-7 Pages Option B | PASS with note | Pages is static CAD. Hydration requires `/mineforge-3d` basepath rewrite (this commit). CAD SSR HTML is MINEFORGE, not a second backend. |
| AC-8 no XAI in bundle | PASS | `scan:secrets` + no `xai-` patterns in `.vercel/output/static/assets` |

Prompts/responses captured in `qa-evidence/batch1-grok-e2e.json` (gitignored; summary above).

## Task 3 — isolated pipeline

Automated `npm run test:isolation` → **7/7 pass** (~20 s).

| Test | Result | Evidence |
| --- | --- | --- |
| A/B isolation | PASS | job `collapse` worktree `/tmp/mf-job-…/.grok/jobs/collapse` stable `e87f93a…` jobCommit `1db97f3…` status `preview` |
| C/E gates + preview | PASS | job `valid1` typecheck/tests/build **exit 0**; preview `/__preview/valid1/` |
| D compile fail | PASS | job `broken1` typecheck exit **2**; promote blocked; stable unchanged |
| F REJECT | PASS | job `rej1` after_reject SHA = before |
| G/H PROMOTE | PASS | before `e87f93a…` previewed `52d2874…` after **same as previewed** |
| I ROLLBACK | PASS | rolled back to `e87f93a…` |
| J unauthorized | PASS | standard user HTTP job 403 |

Live HTTP on the product repo (stable stayed `9e22bbd…`):

| Job | Status | Gates | Preview | Promote | Reject | Stable |
| --- | --- | --- | --- | --- | --- | --- |
| `gatepass1` `ai-edit/gatepass1` | preview | typecheck 0, test:oracle 0, build 0 | `/__preview/gatepass1/` HTTP 200 | not applied | 200 | unchanged |
| `brokengate` `ai-edit/brokengate` | failed | typecheck **2**, tests 0, build 0 | none | **403** | 200 | unchanged |

Live PROMOTE was **not** applied to `mineforge-3d` HEAD so the candidate SHA stays this Batch 1 commit. TEST G/H/I executed on an isolated git fixture with the same handlers (`promoteJobHandler` ff-only of the previewed commit, then rollback).

Commands inside worktree: `npm run typecheck`, `npm run test:oracle`, `npm run build`.

## Task 4 — CI gate

Workflow: `.github/workflows/batch1-gate.yml`  
Script: `scripts/ci-gate.sh` (prints `CANDIDATE_SHA`, no `|| true` on mandatory steps)

Mandatory: `npm ci --legacy-peer-deps`, `npm run typecheck`, `npm test` (oracle + security + isolation), `npm run scan:secrets`, `npm run build`, rescan.

Local controlled negatives (then restored):

| AC | Mutation | Exit | Restored |
| --- | --- | --- | --- |
| AC-2 | TS error in `basepath.ts` | typecheck **2** | typecheck 0 |
| AC-3 | `assert.equal(1,2)` | test:security **1** | 0 |
| AC-4 | authorizeMutation bypass | test:security **1** | 0 |
| AC-5 | `/api/runtime` returns 404 | test:security **1** | 0 |
| AC-6 | broken compile | typecheck **2** | 0 |
| AC-9 | restore | security 0 + typecheck 0 | yes |

GitHub Actions run URL is attached after push of this SHA (workflow `batch1-gate` on `repair/batch-1` and `main`).

Build: `npm run build` exit 0. Assets `index-BND6aJi4.js`, `routes-C74B509G.js`, `Twin3D-BcobAhcS.js`.

## Known remaining issues (inside this batch)

1. Live PROMOTE of the product repository was skipped; isolation fixture covers G/H/I. Auditor may repeat PROMOTE+ROLLBACK on a throwaway clone.
2. GitHub Pages is Option B static CAD. It is not a Grok AI host. No `*.grok.me` URL is claimed.
3. Isolated preview is `/__preview/<jobId>/` on the same origin (diff + gate status), not a second HMR server.
4. Production `vite preview` still has a server (`/api/runtime` JSON) with `appEditEnabled: false` unless the flag is set. GitHub Pages has no server.
5. Engineering Core, Reality Sync, photo calibration, collisions, mobile parity are **out of this batch**.

## STOP

Do not start Repair Batch 2 until independent retest of Batch 1.
