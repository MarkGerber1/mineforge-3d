# Canonical production runtime

MINEFORGE 3D has **one architecture** and **two public surfaces**.

## Full-stack server runtime (canonical for Grok AI + Application Edit)

`CANONICAL_FULLSTACK_URL=https://mineforge3d.continuous-impatiens.workers.dev`

Browser → named Cloudflare Worker (`mineforge3d`) → unpublished origin hop →
live Grok Build full-stack process → `/api/*` and server functions → xAI
(`XAI_API_KEY`, server-only) and isolated git jobs (owner session required).

The public hostname is **not** `*.trycloudflare.com`. It is a requested
Worker name on `workers.dev`. Restart of the application and of the origin hop
redeploys the same Worker name; the hostname does not change.

This Worker is currently backed by a **Cloudflare temporary (claim) account**.
Unclaimed temporary accounts expire (about 60 minutes) and `workers.dev` may
present a bot-management challenge. A claimed Cloudflare account / named
Tunnel / grok.me publish remains the durable production path.

`GET /api/runtime` (when the Worker is not challenging) →

```
{ "mode": "server", "ai": true|false, "available": true|false,
  "appEditEnabled": true|false, "role": "...", "sha": "<git sha>", "buildId": "..." }
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
| `RATE_LIMIT_TRUST` | `cloudflare` \| `vercel` \| `test` \| `local` \| `auto`. Production behind Cloudflare must set `cloudflare`. |
| `MF_DEPLOY_SHA` | Exact deployed git SHA exposed on `/api/runtime`. |

Privileged operations (deny by default, owner session required):

create-branch, write-source, commit, rollback, create-job, promote, reject, inspect/read source.

Standard CAD users do not authenticate. They use Project / CAD / Engineering / 2D / 3D / IndexedDB.

Rate limits (server-side, in-memory, fail-closed): Grok 20/60s, login 8/60s, App Edit mutations 30/60s.
Behind Cloudflare, identity is **CF-Connecting-IP** (validated IPv4/IPv6). First
`X-Forwarded-For` is never the key. Invalid/missing identity uses a single bounded
`unknown` bucket.

Application Edit preview is **real build + started SSR + health, or fail-closed**.
There is no synthetic `fixtureAppHtml` production fallback. `evidence.html` is
not the runnable preview. `PROMOTE` requires `previewCommitSha === jobCommitSha`.

## Static CAD surface (GitHub Pages) — Option B

URL: https://markgerber1.github.io/mineforge-3d/

No server. `GET /api/runtime` is not JSON (static host fallback). The client enters **STATIC MODE**:

- AI OFFLINE — no fake Grok answers
- Application Edit is not presented as available
- CAD, Engineering Core, REQUESTED/SAFE, 2D, 3D, local persistence still work

GitHub Pages is mounted at `/mineforge-3d/`. The client resolves that basepath at runtime.
Asset URLs in the Pages snapshot are rewritten to `/mineforge-3d/…`.

**Do not treat GitHub Pages as the Grok / full-stack host.**

## Rule

If the server path is missing, the UI must say so. It must not simulate Grok success.
