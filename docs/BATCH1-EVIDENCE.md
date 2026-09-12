# MINEFORGE 3D — Repair Batch 1 evidence

**BATCH STATUS:** PASSED UNDER OWNER REVISED RELEASE POLICY

Owner decision 2026-09-13: durable public production host is **deferred** to
FINAL DEPLOYMENT / PUBLIC RELEASE after functional Batches 1–4. This is not a
defect. Production deployment is out of the Batch 1 acceptance gate.

Do not create tunnels. Do not request Cloudflare credentials. Do not treat a
temporary hostname as production.

## Identity

| Field | Value |
| --- | --- |
| Accepted candidate SHA | `8f5c9c0dd4909db51a28a2e14cff12b29c00b218` |
| GitHub | https://github.com/MarkGerber1/mineforge-3d |
| PR | https://github.com/MarkGerber1/mineforge-3d/pull/6 MERGED without bypass |
| CI | https://github.com/MarkGerber1/mineforge-3d/actions/runs/34609759826 GATE PASS 346/346 |
| main protection | required check `gate`, `enforce_admins: true` |
| origin/main at close | `8f5c9c0dd4909db51a28a2e14cff12b29c00b218` |
| PUBLIC PRODUCTION DEPLOYMENT | **DEFERRED TO FINAL RELEASE** |

## Revised Batch 1 gate — verified

### Security

Privileged mutations server-protected. Standard user cannot mutate source.
Forged roles ignored. Feature flag. Secret isolation. Rate limiting.
Trusted proxy identity: CF-Connecting-IP (Pass 2, accepted, not reworked).

### Safe Application Edit

Developer/owner capability. Server-side owner authorization, isolated
branch/worktree, typecheck, tests, build, real preview, fail-closed,
exact SHA promotion, rollback. `fixtureAppHtml` removed (Pass 2).
On a future public serverless host: `APP_EDIT_ENABLED=false` with honest UI
is allowed.

This workspace process: `APP_EDIT_ENABLED=true` (git worktrees exist).

### CI

Complete suite + Engineering Oracle + security + isolation + build + secret
scan. Protected main. Required check `gate`. Negative PRs #1–#5 remain open
and unused (negative CI evidence).

### Runtime architecture

Full-stack runtime proven in the development/runtime environment:

`GET /api/runtime` → `{mode:server, ai:true, appEditEnabled:true, sha:8f5c9c0…, instanceModel:single-instance}`

Persistent public hostname is **not** required for Batch 1 under the revised policy.

## Pass 2 mechanisms (accepted, not reopened)

- Rate-limit identity: CF-Connecting-IP; XFF does not reset the bucket.
- Application Edit preview: real SSR/build or fail-closed.

## STOP (Batch 1)

Batch 1 is closed under the owner revised release policy. Independent
acceptance retest of Batch 1 may still be performed. Functional work
continues in Repair Batch 2 (Reality geometry pipeline).
