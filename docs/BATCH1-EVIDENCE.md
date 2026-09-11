# MINEFORGE 3D — Repair Batch 1 Correction Pass 2 evidence

**BATCH STATUS:** NOT READY FOR INDEPENDENT RETEST

Tasks 2 and 3 are implemented and tested. Task 1 replaced `*.trycloudflare.com`
as the *named* public hostname, but the replacement is a Cloudflare **temporary**
`workers.dev` Worker (`mineforge3d.continuous-impatiens.workers.dev`) that:

- is not `*.trycloudflare.com`;
- reuses the same hostname across process restart;
- served Grok e2e (room 9.37×6.21×3.14, S21 Pro, 27 / 127 kW then 24 / 113 kW)
  from a real browser before the post-restart bot-management challenge;
- after origin-hop restart + Worker redeploy, Playwright and curl received
  Cloudflare 403 “security verification”;
- unclaimed temporary accounts expire in ~60 minutes.

That is **not** a durable production identity. Do not treat this pass as Batch 1
PASSED. Independent retest of Task 1 should reject until a claimed named
Cloudflare Tunnel, grok.me publish, or other persistent HTTPS host is in place.

This file does not contain secrets.

A git commit cannot contain its own hash. Authoritative identity of this
candidate is `git rev-parse HEAD` on `repair/batch-1` and the
`CANDIDATE_SHA=` / `GATE PASS CANDIDATE_SHA=` lines printed by
`scripts/ci-gate.sh` on that same commit.

## Identity

| Field | Value |
| --- | --- |
| Branch | `repair/batch-1` |
| Base / previous Pass 1 SHA | `4bb5265650a66c1d4c0aa1f0da0911edba3cbbb0` |
| GitHub | https://github.com/MarkGerber1/mineforge-3d |
| Named full-stack hostname | https://mineforge3d.continuous-impatiens.workers.dev |
| Deployment type | Cloudflare Worker reverse-proxy (requested name `mineforge3d`) in front of the live full-stack process |
| Static Pages (Option B) | https://markgerber1.github.io/mineforge-3d/ |

## Task 1 — stable canonical full-stack runtime

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 hostname not trycloudflare | PASS (name) | `https://mineforge3d.continuous-impatiens.workers.dev` |
| AC-2 restart durability | PARTIAL | Same hostname after killing the app + origin hop and running `startup.sh`. After redeploy, that hostname returned **403** (CF bot management). Unpublished origin hop still served `/api/runtime` JSON. |
| AC-3 GET /api/runtime | PASS then FAIL | Before restart, Playwright: HTTP 200 JSON `mode=server` `sha=4bb5265…` `ai=true`. After restart: 403 challenge on the Worker. |
| AC-4 current Project State | PASS (pre-restart) | Inspector 9.37 × 6.21 × 3.14, S21 Pro, requested 27, 127 kW. Grok: «9.37 × 6.21 × 3.14», `bitmain-s21-pro`, 27, **127 000 W**. |
| AC-5 stale-state | PASS (pre-restart) | Power 127→113 kW, count 27→24, no reload. Grok: **113 000 W**, `requestedCount` **24**. |
| AC-6 AI outage | PASS (process) | Provider key unset, restart. `/api/runtime` `{ai:false,available:false}`. UI **AI OFFLINE**. CAD Ширина committed to **7.77**. Key restored; `{ai:true}`. |
| AC-7 deployed SHA | PASS | `/api/runtime` includes `sha` and `buildId` from git HEAD / `MF_DEPLOY_SHA`. |

GitHub Pages remains Option B static.

## Task 2 — trusted client identity for rate limiting

Implementation: [`src/ai/ratelimit.server.ts`](../src/ai/ratelimit.server.ts)

Algorithm:

- `RATE_LIMIT_TRUST=cloudflare|vercel|test|local|auto` (unknown value → `local`).
- **cloudflare:** `CF-Connecting-IP` only, `node:net.isIP`, max 45 chars. `X-Forwarded-For` and `X-Real-IP` ignored.
- **vercel:** `x-real-ip` then `x-vercel-forwarded-for`. First XFF ignored.
- **test:** `x-mf-test-ip` only.
- **local / auto:** ignore all client-supplied proxy headers → `local`. Auto does **not** trust spoofable CF headers.
- Invalid/missing → bounded `unknown` bucket. Oversized keys fail-closed. Same policy for Grok, login, mutation.

| AC | Result |
| --- | --- |
| AC-1 CF-Connecting-IP beats XFF | PASS |
| AC-2 XFF rotation, one bucket, then 429 | PASS |
| AC-3 two CF IPs isolated | PASS |
| AC-4 spoofed X-Real-IP ignored | PASS |
| AC-5 invalid IP → `unknown`, not attacker string | PASS |
| AC-6 Grok threshold does not call xAI | PASS (`getGrokProviderCalls()===0`) |
| AC-7 login, rotating XFF, 429 | PASS |
| AC-8 mutation, rotating XFF, 429 | PASS |
| AC-9 window expiry | PASS |

Tests: [`src/ai/ratelimit.test.ts`](../src/ai/ratelimit.test.ts) (existing allow/deny/login/mutate/Grok tests retained and updated off first-XFF).

## Task 3 — real preview fail-closed

`fixtureAppHtml` is **removed** from [`src/ai/jobs.server.ts`](../src/ai/jobs.server.ts). Production path is `materializePreview`:

1. write `evidence.html` (not preview);
2. require build artifacts with `assets`;
3. require `.vercel/output/functions/__server.func/index.mjs` + `srvx`;
4. start job-ssr and health-check;
5. only then `status=preview` and `previewUrl=/__preview/<id>/`.

Missing artifact / missing SSR / startup fail / health fail → `status=failed`, `previewUrl=undefined`, PROMOTE blocked.

Isolation fixture build emits real `.vercel/output/static` + SSR `fetch` handler.

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 normal job | PASS | TEST C/E status `preview`, HTML `data-mf-preview="app"` + `MINEFORGE`, `previewCommitSha === jobCommitSha` |
| AC-2 missing artifact | PASS | job `missart` rematerialize `missing-build-artifact`, no `preview/app/index.html`, PROMOTE denied |
| AC-3 missing SSR | PASS | job `nossr` `missing-ssr-entry`, PROMOTE denied |
| AC-4 startup failure | PASS | job `boomssr` crashing SSR entry → `preview-runtime-failed`, PROMOTE denied |
| AC-5 commit mismatch | PASS | tampered `previewCommitSha`, PROMOTE denied, stable SHA unchanged |
| AC-6 evidence ≠ preview | PASS | `evidence.html` 200, no `data-mf-preview="app"`; `previewUrl` is `/__preview/<id>/` |

Compile-fail / REJECT / PROMOTE / ROLLBACK regression: TEST D, F, G/H, I still pass.

## Task 4 — freeze

See `git rev-parse HEAD` after this commit. Full gate: `bash scripts/ci-gate.sh` (typecheck, **full `npm test`**, secrets, build, secrets). GitHub workflow `batch1-gate.yml` job `gate` on `repair/batch-1` and `main`.

Main protection must remain: required check `gate`, `enforce_admins` true. Negative PRs #1–#5 stay open / unmerged.

## Known remaining issues inside Batch 1

1. **Task 1 is not a durable production runtime.** Named hostname is a Cloudflare temporary Worker. Unclaimed lifetime ~60 minutes. Post-restart bot-management 403. Origin hop is still a Quick Tunnel (unpublished, not canonical).
2. grok.me is not published (project id exists; Publish is a Grok UI action). Vercel `*-xai-org.vercel.app` is SSO-gated.
3. Named Cloudflare Tunnel (`cert.pem` / `TUNNEL_TOKEN`) is not available in this workspace.
4. Rate limiter is in-memory (single instance). Multi-instance needs a shared store.
5. Application Edit requires the live full-stack process with git worktrees. A serverless-only host must disable App Edit honestly.
6. Temporary Worker claim URL is credential-equivalent and is **not** stored in this public evidence file.

STOP. Do not start Batch 2 (Reality Sync, photo calibration, As-Built, collision/ceiling, mobile, video).
