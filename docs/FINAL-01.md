# FINAL-01 — source freeze and production policy

Machine-readable companion: [final-01.json](final-01.json).

Live HEAD is **Git-dynamic**. Do not treat any SHA in this file as “current
HEAD” after later merges. Resolve:

```
git fetch origin
git rev-parse origin/main
```

## Identities (do not conflate)

| Identity | Evidence |
|---|---|
| SOURCE / CI | GitHub `MarkGerber1/mineforge-3d` protected `main`, required check `gate` |
| PUBLIC LIVE | provider-owned HTTPS with `/api/runtime` JSON — **empty until Owner publishes** |
| PHYSICAL IPHONE | Owner Safari against PUBLIC LIVE — **WAITING_FOR_OWNER** |

GitHub Pages `https://markgerber1.github.io/mineforge-3d/` is a **static CAD
demo**. `/api/runtime` is not JSON. It is not PUBLIC LIVE.

Workspace preview is not PUBLIC LIVE.

Tunnels are not PUBLIC LIVE.

## Starting freeze

- Required FINAL-01 starting `origin/main`: `fb471f5a09d3a0143c58d3362e8e0b982796ba49`
- FINAL-01R starting `origin/main`: `37eef679e4b027abda37c0a494613130d23eabe1`
- Accepted functional baseline (immutable): `635fd9e965ed8d9705c310b72b82dde2b81f837f`

This package does **not** reopen MFQ-001…MFQ-006. Public deploy is **not**
performed. Physical iPhone is **not** started.

## Production policy

Shared predicate `isServerlessProduction(env)` is true when `GROK_PROJECT_ID`
is non-empty **or** `VERCEL` is `1`/`true`.

### FINAL-SEC-001 Application Edit

On serverless production App Edit is **forced off** even if
`APP_EDIT_ENABLED=true` (including `VERCEL=1` with empty `GROK_PROJECT_ID`).
Login and mutations return `403 APP_EDIT_DISABLED`. Grok system contract:
`APP EDIT DISABLED`. No git-worktree job may start.

Workspace preview (no serverless marker) keeps the existing owner-session
git-worktree contract.

### FINAL-SEC-002 Public AI — OPTION B fail-closed

Process-local `Map` rate limiting is **single-instance only**. It is **not**
global protection across serverless instances. No shared durable limiter is
implemented.

Capability formula: runtime type + `XAI_API_KEY` + limiter kind.

| Runtime | Key | Limiter | Public AI |
|---|---|---|---|
| single-instance workspace | present | `local-process` | available |
| serverless / multi-instance | present | `none` (no shared store) | **unavailable** |
| any | absent | any | unavailable |

`GET /api/runtime` reports actual usable capability (`ai`/`available` false
when AI is not safe to expose). `rateLimitProtection` is `local-process` or
`none` — never advertised as `shared`.

CAD and Engineering Core remain fully operational when AI is OFFLINE.

## Public production

URL: *(none recorded — Owner Publish required)*

Acceptable: Grok Build `*.grok.me` or Vercel at the exact accepted `main` SHA.

Not acceptable: GitHub Pages, Quick Tunnels, `workers.dev`, workspace preview.

## Physical iPhone

`WAITING_FOR_OWNER`. Playwright WebKit is not this field.

## Security (source-side)

- `XAI_API_KEY` is server-only (never `VITE_`)
- `npm run scan:secrets` is part of required `gate`
- App Edit mutations stay 403 when disabled
- Rate-limit trust does not assume Cloudflare unless that proxy is actually configured

## Implementation AI status

Implementation AI does **not** declare FINAL PASSED.

Public black-box acceptance and physical iPhone belong to the Independent
Quality Department and the Owner after a real public URL exists.
