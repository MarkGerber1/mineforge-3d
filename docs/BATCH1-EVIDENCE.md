# MINEFORGE 3D — Repair Batch 1 Correction Pass 3 evidence

**BATCH STATUS:** BLOCKED_BY_EXTERNAL_CREDENTIAL

This file is the evidence package. It does not contain secrets.

A git commit cannot contain its own hash. Authoritative identity of this
candidate is `git rev-parse HEAD` on `repair/batch-1` / `origin/main` after
the protected merge, and the `CANDIDATE_SHA=` / `GATE PASS CANDIDATE_SHA=`
lines printed by `scripts/ci-gate.sh` on that same commit.

Pass 2 freeze (accepted mechanisms): `ff41fb9ecbac006232f2bdf4510e49c6005a973f`

## Identity

| Field | Value |
| --- | --- |
| Branch | `repair/batch-1` |
| Previous freeze | `ff41fb9ecbac006232f2bdf4510e49c6005a973f` |
| GitHub | https://github.com/MarkGerber1/mineforge-3d |
| Canonical full-stack URL | **unset** — no claimed Named Tunnel token |
| Static Pages (Option B) | https://markgerber1.github.io/mineforge-3d/ |

## Task 1 — durable production host

**BLOCKED_BY_EXTERNAL_CREDENTIAL**

Tried and rejected as canonical:

- Cloudflare Quick Tunnel (`*.trycloudflare.com`) — ephemeral hostname
- `wrangler deploy --temporary` `*.workers.dev` — temporary account, bot challenge, ~60 min lifetime
- grok.me slugs — 404, app not published
- Vercel CLI — no credentials; `*-xai-org.vercel.app` SSO-gated
- GitHub Pages — Option B static only

No `CLOUDFLARE_TUNNEL_TOKEN`, no `cert.pem`, no Vercel token, no claimed CF account.

Ingress script now starts a Named Tunnel **only** when the token is present.
It no longer deploys a temporary Worker or Quick Tunnel as public identity.

**Owner action (one):** provide a Cloudflare Named Tunnel token
(`CLOUDFLARE_TUNNEL_TOKEN`) and the persistent public hostname it serves
(`CANONICAL_FULLSTACK_URL`, DNS-routed in a claimed Cloudflare account).
Not a Quick Tunnel. Not a temporary `workers.dev` account.

## Tasks 2–3 (Pass 2, accepted, not reworked)

Rate-limit identity: CF-Connecting-IP in Cloudflare mode. XFF rotation does
not reset the bucket. Invalid IP → bounded `unknown`. Grok provider is not
called after threshold.

Application Edit preview: real SSR/build or fail-closed. `fixtureAppHtml`
removed. evidence.html is not the preview. PROMOTE requires matching SHAs.

## Task 4 — Application Edit production policy

This process: persistent filesystem + git + worktrees + child processes.
`APP_EDIT_ENABLED=true` (workspace, `GROK_PROJECT_ID` unset). Gates remain.

Serverless / grok.me: `GROK_PROJECT_ID` set → flag stays off. UI:
“Application Edit unavailable on this deployment — APP EDIT DISABLED.”

## Task 5 — rate-limit topology

`PRODUCTION_INSTANCE_MODEL=single-instance` (also on `/api/runtime` as
`instanceModel`). One Node process, one Named Tunnel hop. In-memory limiter
is the matching store. No second instance to give a client a fresh budget.

## Task 6 — protected main release

See PR created in this pass. Merge without bypass. Required check `gate`.

## Forbidden as canonical (still)

`*.trycloudflare.com`, temporary `workers.dev`, localhost, Codespaces,
workspace-only preview, SSO, anti-bot challenge pages.

## STOP

Do not start Batch 2. Independent Acceptance Retest of Batch 1 is still required.
