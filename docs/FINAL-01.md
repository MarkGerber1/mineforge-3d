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

- Required starting `origin/main`: `fb471f5a09d3a0143c58d3362e8e0b982796ba49`
- Post-merge CI on that SHA: https://github.com/MarkGerber1/mineforge-3d/actions/runs/34736024732 (`success`)
- Accepted functional baseline (immutable): `635fd9e965ed8d9705c310b72b82dde2b81f837f`

This package does **not** reopen MFQ-001…MFQ-006.

## Production policy in this package

Serverless / Grok Build (`GROK_PROJECT_ID` set):

- Application Edit **forced off** (even if `APP_EDIT_ENABLED=true`)
- `instanceModel=multi-instance` unless explicitly overridden
- `RATE_LIMIT_TRUST=auto` + `VERCEL=1` → vercel identity (`x-real-ip` /
  `x-vercel-forwarded-for`). Spoofable CF / first XFF are not keys.

Workspace preview (no `GROK_PROJECT_ID`): App Edit remains the existing
owner-session git-worktree contract.

## Public production

URL: *(none recorded — Owner Publish required)*

Acceptable: Grok Build `*.grok.me` or Vercel at the exact accepted `main` SHA.

Not acceptable: GitHub Pages, Quick Tunnels, `workers.dev`, workspace preview.

## Physical iPhone

`WAITING_FOR_OWNER`. Playwright WebKit is not this field.

Exact Owner checklist is returned only after a verified public HTTPS URL exists.

## Security (source-side)

- `XAI_API_KEY` is server-only (never `VITE_`)
- `npm run scan:secrets` is part of required `gate`
- App Edit mutations stay 403 when disabled
- Rate-limit trust does not assume Cloudflare unless that proxy is actually configured

## Implementation AI status

Implementation AI does **not** declare FINAL PASSED.

Public black-box acceptance and physical iPhone belong to the Independent
Quality Department and the Owner after a real public URL exists.
