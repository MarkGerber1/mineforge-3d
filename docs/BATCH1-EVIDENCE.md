# MINEFORGE 3D — Repair Batch 1 Correction Pass 1 evidence

**BATCH STATUS:** READY FOR INDEPENDENT RETEST

This file is the evidence package. It does not contain secrets.

A git commit cannot contain its own hash. Authoritative identity of this
candidate is `git rev-parse HEAD` on `repair/batch-1` and the
`CANDIDATE_SHA=` / `GATE PASS CANDIDATE_SHA=` lines printed by
`scripts/ci-gate.sh` on that same commit.

Last non-docs source change: `aebf27357de848d6bc8beca21cba29ddcdb50342`

## Identity

| Field | Value |
| --- | --- |
| Branch | `repair/batch-1` |
| Base / previous Batch 1 SHA | `f870dbdcdfefeb739876dd456acd07b468c9c2c0` (`main` before this pass) |
| Last source change | `aebf27357de848d6bc8beca21cba29ddcdb50342` |
| Worktree | product repository root |
| GitHub | https://github.com/MarkGerber1/mineforge-3d |
| Canonical full-stack URL | https://samuel-developments-floyd-native.trycloudflare.com |
| Static Pages (Option B) | https://markgerber1.github.io/mineforge-3d/ |
| Green gate (source freeze) | https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577266486 |

## Task 1 — real isolated Application preview

Preview UI is the job worktree build (`preview/app` from `.vercel/output/static` or dist), optionally captured via job-ssr (`npx srvx`). Route: `/__preview/<jobId>/`. Evidence HTML is separate and is not the preview. `PROMOTE` requires `previewCommitSha === jobCommitSha`. Failed gates call `clearPreviewApp`.

Live jobs executed against stable `1709393c15730925ddb123b7c4623113afdd76ff` (ancestor of this candidate). After PROMOTE/ROLLBACK, stable was restored to that SHA. Subsequent candidate commits are docs/CI-portable fixtures only; GrokPanel on stable still has no collapse.

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 job + branch + worktree | PASS | job `cpass-col2` branch `ai-edit/cpass-col2` worktree `.grok/jobs/cpass-col2`. Request: «Сделай AI-панель сворачиваемой.» Stable SHA unchanged at `1709393`. |
| AC-2 preview loads MINEFORGE | PASS | `/__preview/cpass-col2/` served built app (`data-mf-preview` / full MINEFORGE), not a status page. job-ssr pid 4531. |
| AC-3 collapse works in preview | PASS | Playwright: СВЕРНУТЬ → РАЗВЕРНУТЬ → СВЕРНУТЬ. `data-mf-id="grok-collapse"` present in preview. |
| AC-4 stable unchanged | PASS | stable collapse count 0 before PROMOTE. |
| AC-5 SHA binding | PASS | PREVIEW.json `jobCommitSha === previewCommitSha === 6226fa2d878427924cdafc5c90597a9bdad42e56`. artifactDir `.grok/jobs/cpass-col2/preview/app`. |
| AC-6 compile-breaking | PASS | job `cpass-brk2` status `failed`, typecheck exit 2, no `preview/app`, PROMOTE blocked. jobCommit `0d91b2fbe4b71f5b079afee90b4617a6488226e6`. |
| AC-7 REJECT | PASS | `cpass-col2` status `rejected`. Stable remained `1709393`. |
| AC-8 second job + PROMOTE | PASS | job `cpass-col3` commit `a16bf36be25fefbca711bca982fee306411ab799`, previewCommitSha equal, preview URL `/__preview/cpass-col3/`, job-ssr pid 4884. PROMOTE ff-only to that SHA. |
| AC-9 ROLLBACK | PASS | ROLLBACK restored `1709393`. Collapse absent on stable. |

Isolation regression: `npm run test:isolation` 7/7 (TEST A–J) on GitHub gate run 34577266486.

## Task 2 — concrete canonical full-stack URL

`CANONICAL_FULLSTACK_URL=https://samuel-developments-floyd-native.trycloudflare.com`

Independently reachable HTTPS. Not GitHub Pages. Not localhost. trycloudflare has no uptime SLA.

Deployed source at probe time: workspace HEAD `aebf27357de848d6bc8beca21cba29ddcdb50342`.

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 GET /api/runtime | PASS | HTTP 200 `application/json` `{"mode":"server","ai":true,"available":true,"appEditEnabled":true,"role":"anonymous"}` |
| AC-2 room 9.2 × 6.4 × 3.1 | PASS | Inspector fields Ширина/Глубина/Высота потолка. Grok: «ширина — 9.2 м, глубина — 6.4 м, высота — 3.1 м» from PROJECT JSON. |
| AC-3 ASIC + count | PASS | Bitmain S21 Pro (`bitmain-s21-pro`), requested 30. |
| AC-4 power 135000 W | PASS | Inspector «Мощность, kW» = 135. Grok: `availablePowerW` **135 000 W**. |
| AC-5 change power no reload | PASS | 135 → 110 kW. Grok: `availablePowerW = 110000`. SAFE 32 → 26. |
| AC-6 network | PASS | `POST /_serverFn/…grokEngineer…` HTTP 200 `application/json` (4 calls). |
| AC-7 xAI unavailable | PASS | Temporarily unset `XAI_API_KEY`, restart. `GET /api/runtime` `{ai:false,available:false}`. Panel: **AI OFFLINE**. CAD still: SAFE visible, Ширина committed to 7.7. Then key restored; runtime `ai:true`. |

GitHub Pages remains Option B static. Do not treat it as the Grok host.

## Task 3 — full mandatory test suite

`package.json` `test` runs: `scripts/**/*.test.mjs` + app-data/auth + `test:oracle` + `test:security` + `test:isolation`.

`scripts/ci-gate.sh`: typecheck, **full `npm test`**, scan:secrets, build, scan:secrets. No skip, no `.only`, no `|| true`.

OPTION B: `scripts/fixtures/og-skill/SKILL.md` is a committed copy of the og skill so brand-check prose pins run on a clean GitHub checkout. Expected values unchanged.

GitHub clean checkout on `aebf273`:

https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577266486

```
CANDIDATE_SHA=aebf27357de848d6bc8beca21cba29ddcdb50342
scripts:  195 pass / 0 fail
app-data: 55 pass / 0 fail
oracle:   45 pass / 0 fail
security: 29 pass / 0 fail
isolation: 7 pass / 0 fail
TOTAL:    331 pass / 0 fail
GATE PASS
```

Negative proofs that the suite is actually enforced:

| Break | PR | SHA | Run | Result |
| --- | --- | --- | --- | --- |
| scripts test | [#2](https://github.com/MarkGerber1/mineforge-3d/pull/2) | `37c962da2e3057b1ca1d5726362f76e7ea3608e6` | [34577665813](https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577665813) | FAIL `not ok 30 - NEG-2 intentional failure` |
| auth / authorizeMutation | [#3](https://github.com/MarkGerber1/mineforge-3d/pull/3) | `0573ae7bf3e357ea6531bf401b2cf970ff917f83` | [34577443554](https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577443554) | FAIL `AC-5 standard user is 403` |
| engineering oracle | [#5](https://github.com/MarkGerber1/mineforge-3d/pull/5) | `06ab7e85a66859eeb6dac37d836fe9c212763930` | [34577664764](https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577664764) | FAIL `not ok 46 - NEG-oracle intentional failure` |

Restore = this candidate. Full suite PASS on run 34577266486.

## Task 4 — stable/main protection

Active:

1. Classic branch protection on `main`: `protected: true`, `enforce_admins: true`, required check **`gate`** (GitHub Actions app_id 15368), `allow_force_pushes: false`, `allow_deletions: false`.
2. Repository ruleset `batch1-main-gate` id **22889271**, enforcement **active**, `bypass_actors: []`, `current_user_can_bypass: never`. Rules: `deletion`, `non_fast_forward`, `required_status_checks` context `gate` integration_id 15368, strict.

API:

- Branch: `GET /repos/MarkGerber1/mineforge-3d/branches/main` → `protected: true`
- Protection: `GET /repos/MarkGerber1/mineforge-3d/branches/main/protection`
- Ruleset: `GET /repos/MarkGerber1/mineforge-3d/rulesets/22889271`

Blocked red candidate:

```
gh pr merge 1 --merge
X Pull request MarkGerber1/mineforge-3d#1 is not mergeable: the base branch policy prohibits the merge.
```

PR #1–#5 `mergeStateStatus: BLOCKED` with required check `gate` FAILURE.

GitHub CLI still prints that `--admin` exists. That flag was **not** used. Ruleset reports `current_user_can_bypass: never`. Classic `enforce_admins: true`.

## Task 5 — real GitHub negative CI runs

None of these were merged.

| ID | Branch | SHA | Mutation | Run | Conclusion | Failing step |
| --- | --- | --- | --- | --- | --- | --- |
| NEG-1 | `repair/neg-1-typecheck` | `4d7a55b5da7a43f95115e62bc25e40b5fc41b157` | `src/ai/runtime-client.ts` string assigned to number | [34577438123](https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577438123) / [PR #1](https://github.com/MarkGerber1/mineforge-3d/pull/1) | FAIL | typecheck TS2322 |
| NEG-2 | `repair/neg-2-test` | `37c962da2e3057b1ca1d5726362f76e7ea3608e6` | `assert.equal(1, 0)` in `scripts/brand-check.test.mjs` | [34577665813](https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577665813) / [PR #2](https://github.com/MarkGerber1/mineforge-3d/pull/2) | FAIL | `NEG-2 intentional failure` |
| NEG-3 | `repair/neg-3-auth-bypass` | `0573ae7bf3e357ea6531bf401b2cf970ff917f83` | `authorizeMutation` returns ok without owner | [34577443554](https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577443554) / [PR #3](https://github.com/MarkGerber1/mineforge-3d/pull/3) | FAIL | security AC-5 403 |
| NEG-4 | `repair/neg-4-runtime` | `08082000997ce1b462765753a75375a3d772702e` | `/api/runtime` returns HTML 500 | [34577445773](https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577445773) / [PR #4](https://github.com/MarkGerber1/mineforge-3d/pull/4) | FAIL | `GET /api/runtime JSON` smoke |
| NEG-oracle | `repair/neg-oracle` | `06ab7e85a66859eeb6dac37d836fe9c212763930` | oracle `assert.equal(1, 0)` | [34577664764](https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577664764) / [PR #5](https://github.com/MarkGerber1/mineforge-3d/pull/5) | FAIL | `NEG-oracle intentional failure` |
| NEG-5 restore | `repair/batch-1` | `aebf27357de848d6bc8beca21cba29ddcdb50342` | no negative mutation | [34577266486](https://github.com/MarkGerber1/mineforge-3d/actions/runs/34577266486) | PASS | full gate |

## Task 6 — server-side rate limiting

| Item | Value |
| --- | --- |
| Implementation | `src/ai/ratelimit.server.ts` in-memory IP+route buckets, fail-closed empty key |
| Engine | `src/ai/grok-engine.server.ts` — limit **before** xAI `fetch` |
| HTTP | `src/ai/http.server.ts` login + privileged mutations |
| Thresholds | grok 20/60s, login 8/60s, mutate 30/60s |
| Tests | `src/ai/ratelimit.test.ts` (part of `npm run test:security`, 29 pass) |
| AC-3 | denied Grok does not increment provider counter / does not call xAI |
| HTTP 429 | login spam and mutation spam return 429 + Retry-After |

Single-instance memory limiter. Multi-instance production needs a shared store — documented in CANONICAL-RUNTIME.md.

## Final build

GitHub gate on `aebf273` ran `npm run build` inside `scripts/ci-gate.sh` after the full suite. `GATE PASS CANDIDATE_SHA=aebf27357de848d6bc8beca21cba29ddcdb50342`.

## Known remaining issues inside Batch 1

1. Canonical full-stack URL is a Cloudflare **quick tunnel** (`*.trycloudflare.com`). No uptime SLA; URL can change if the tunnel process restarts. There is no published `*.grok.me` hostname.
2. Rate limiter is process-local memory. Correct for this single-instance runtime; not durable across multiple instances.
3. GitHub CLI still advertises `gh pr merge --admin`. That flag was not used. Ruleset `current_user_can_bypass: never` + classic `enforce_admins: true`.
4. Isolated preview job-ssr uses a per-job port inside the workspace and is exposed as `/__preview/<jobId>/` on the canonical origin. Compile-fail jobs have no preview app.
5. CAD auth remains OFF (product requirement). Application Edit uses HMAC `mf_priv`, not Better Auth.
6. Reality Sync / photo centimetre accuracy / collision model / mobile Batch 2 work is out of scope and was not done.

## Stop

Correction Pass 1 stops here. Do not start Batch 2. Independent Acceptance Auditor decides PASS/FAIL.
