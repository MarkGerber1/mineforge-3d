# Canonical production runtime

MINEFORGE 3D has **one product architecture** and **three distinct identities**.
Do not conflate them.

| Identity | What it is | Server `/api/*` | App Edit |
|---|---|---|---|
| SOURCE | GitHub `main` + required CI `gate` | n/a | n/a |
| PUBLIC LIVE | provider-owned HTTPS (Grok Build `*.grok.me` / Vercel) | required | **off** (honest unavailable) |
| WORKSPACE PREVIEW | persistent git worktree process | yes | allowed when flag + owner session |
| GitHub Pages | static CAD demo | no (HTML fallback) | STATIC MODE |

Tunnels (Quick Tunnel, `workers.dev`, ad-hoc `cloudflared`) are **not** production.
Custom domain is **not** required.

## Public full-stack production (FINAL-01)

Simplest compatible host: **Grok Build Publish → `*.grok.me`** (Vercel-backed
serverless). Alternative: Owner-connected Vercel on
`MarkGerber1/mineforge-3d` at an exact Git SHA.

The public URL is **not** stored as a permanent “current HEAD” field. Record it
in release evidence when a real hostname exists. Until Owner publishes:

`PUBLIC_PRODUCTION_URL=` *(empty)*

`GET /api/runtime` on a real server:

```
{ "mode": "server", "ai": true|false, "available": true|false,
  "appEditEnabled": false, "role": "anonymous", "sha": "<git sha>",
  "buildId": "...", "instanceModel": "multi-instance" }
```

`sha` / `buildId` come from `MF_DEPLOY_SHA`, `VERCEL_GIT_COMMIT_SHA`, or
`GITHUB_SHA`.

Environment (server-only, never `VITE_`):

| Variable | Role |
| --- | --- |
| `XAI_API_KEY` | xAI. Absence ⇒ AI OFFLINE. Never sent to the browser. |
| `APP_EDIT_ENABLED` | Workspace preview flag. Ignored (forced off) when `GROK_PROJECT_ID` is set. |
| `APP_EDIT_OWNER_SECRET` | Owner passphrase. Compared server-side only. |
| `APP_EDIT_USER_SECRET` | Standard-user passphrase (tests / reduced role). |
| `APP_EDIT_SESSION_SECRET` | HMAC key for the httpOnly `mf_priv` cookie. |
| `RATE_LIMIT_TRUST` | `vercel` on grok.me/Vercel; `local` in workspace; `cloudflare` only behind a claimed Named Tunnel. `auto` + `VERCEL=1` → vercel. `auto` never trusts spoofable CF headers. |
| `MF_DEPLOY_SHA` | Exact deployed git SHA exposed on `/api/runtime`. |
| `GROK_PROJECT_ID` | Set by Grok Build / Vercel publish. Presence ⇒ App Edit off, instanceModel multi-instance. |
| `VERCEL` | Platform `1` on Vercel. Selects vercel rate-limit identity. |
| `PRODUCTION_INSTANCE_MODEL` | Explicit override. Default multi-instance on serverless, single-instance on the worktree process. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Named Tunnel token. **Deferred / unused.** Absence is correct. |
| `CANONICAL_FULLSTACK_URL` | Optional recorded public origin. Empty until Owner publishes. |

### Application Edit policy

Workspace preview is a **persistent git worktree process** (filesystem, git,
child processes, isolated preview). `APP_EDIT_ENABLED=true` is valid **there**.
Authorization / isolation gates from Batch 1 remain required.

On grok.me / Vercel / any host with `GROK_PROJECT_ID`: App Edit is **forced
off** even if `APP_EDIT_ENABLED=true`. UI copy: Application Edit unavailable /
APP EDIT DISABLED. A secure disabled capability is acceptable. A fake working
button is not.

### Rate-limit topology

Serverless is **multi-instance**. Process-local memory buckets are a best-effort
per-instance limiter, not a shared store. Client identity on Vercel is
`x-real-ip` then `x-vercel-forwarded-for` (validated IPv4/IPv6). First
`X-Forwarded-For` is never the key. Cloudflare `CF-Connecting-IP` is used
**only** when `RATE_LIMIT_TRUST=cloudflare` (Named Tunnel). Presence of CF
headers on a non-Cloudflare host is spoofable and is ignored.

Rate limits: Grok 20/60s, login 8/60s, App Edit mutations 30/60s.

Workspace preview: `PRODUCTION_INSTANCE_MODEL=single-instance`,
`RATE_LIMIT_TRUST=local`.

## Static CAD surface (GitHub Pages) — demo only

URL: https://markgerber1.github.io/mineforge-3d/

No server. `GET /api/runtime` is not JSON (static host fallback). The client
enters **STATIC MODE**:

- AI OFFLINE — no fake Grok answers
- Application Edit is not presented as available
- CAD, Engineering Core, REQUESTED/SAFE, 2D, 3D, local persistence still work

**Do not treat GitHub Pages as the Grok / full-stack host.**

## Rule

If the server path is missing, the UI must say so. It must not simulate Grok success.
If App Edit cannot run isolated worktrees, it must say so. It must not fake an editor.
