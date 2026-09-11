# Canonical production runtime

MINEFORGE 3D has **one architecture** and **two public surfaces**.

## Full-stack server runtime (canonical for Grok AI + Application Edit)

**Correction Pass 3:** there is **no accepted durable public hostname** in this
workspace. A Cloudflare temporary `workers.dev` account and Quick Tunnels were
rejected as canonical. Named Tunnel credentials (`CLOUDFLARE_TUNNEL_TOKEN`)
are not present.

`CANONICAL_FULLSTACK_URL=` *(unset until a claimed Cloudflare Named Tunnel
token + DNS hostname are provided)*

When the token is present, `scripts/canonical-tunnel.sh` runs
`cloudflared tunnel run --token …` and the owner-supplied
`CANONICAL_FULLSTACK_URL` is the persistent HTTPS identity.

Browser → named Cloudflare Tunnel (claimed account, DNS route) →
single full-stack process → `/api/*` and server functions → xAI
(`XAI_API_KEY`, server-only) and isolated git jobs (owner session required).

`GET /api/runtime` →

```
{ "mode": "server", "ai": true|false, "available": true|false,
  "appEditEnabled": true|false, "role": "...", "sha": "<git sha>",
  "buildId": "...", "instanceModel": "single-instance" }
```

`sha` / `buildId` come from `MF_DEPLOY_SHA` (startup) or `git rev-parse HEAD`.

Isolated Application Edit preview (not HMR): `GET /__preview/<jobId>/`

Environment (server-only, never `VITE_`):

| Variable | Role |
| --- | --- |
| `XAI_API_KEY` | xAI. Absence ⇒ AI OFFLINE. Never sent to the browser. |
| `APP_EDIT_ENABLED` | Production feature flag. Unset/false ⇒ every privileged mutation is 403. |
| `APP_EDIT_OWNER_SECRET` | Owner passphrase. Compared server-side only. |
| `APP_EDIT_USER_SECRET` | Standard-user passphrase (tests / reduced role). |
| `APP_EDIT_SESSION_SECRET` | HMAC key for the httpOnly `mf_priv` cookie. |
| `RATE_LIMIT_TRUST` | `cloudflare` when Named Tunnel is in front; otherwise `local`. |
| `MF_DEPLOY_SHA` | Exact deployed git SHA exposed on `/api/runtime`. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Named Tunnel token. Absence ⇒ no public canonical URL. |
| `CANONICAL_FULLSTACK_URL` | Persistent public HTTPS origin served by that tunnel. |
| `PRODUCTION_INSTANCE_MODEL` | `single-instance` on this process. |

### Application Edit policy (this architecture)

This runtime is a **persistent git worktree process** (filesystem, git,
child processes, isolated preview). `APP_EDIT_ENABLED=true` is valid here.
Authorization / isolation gates from Batch 1 remain required.

If the same commit is published to grok.me / Vercel / other serverless:
`GROK_PROJECT_ID` is set, App Edit stays **off**, and the UI must say
Application Edit is unavailable on that deployment.

### Rate-limit topology

`PRODUCTION_INSTANCE_MODEL=single-instance`. One Node process serves the
canonical origin behind one Named Tunnel. Process-local memory buckets are
sufficient: a request cannot land on a second independent limiter process
because there is no autoscaling fleet. Multi-instance / serverless would
require a shared store; that is not this architecture.

Rate limits: Grok 20/60s, login 8/60s, App Edit mutations 30/60s.
Behind Cloudflare, identity is **CF-Connecting-IP** (validated IPv4/IPv6).
First `X-Forwarded-For` is never the key.

Application Edit preview is **real build + started SSR + health, or fail-closed**.

## Static CAD surface (GitHub Pages) — Option B

URL: https://markgerber1.github.io/mineforge-3d/

No server. `GET /api/runtime` is not JSON (static host fallback). The client enters **STATIC MODE**:

- AI OFFLINE — no fake Grok answers
- Application Edit is not presented as available
- CAD, Engineering Core, REQUESTED/SAFE, 2D, 3D, local persistence still work

**Do not treat GitHub Pages as the Grok / full-stack host.**

## Rule

If the server path is missing, the UI must say so. It must not simulate Grok success.
