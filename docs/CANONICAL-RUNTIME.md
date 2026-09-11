# Canonical production runtime

MINEFORGE 3D has **one architecture** and **two public surfaces**.

## Full-stack server runtime (canonical for Grok AI + Application Edit)

Browser → frontend → server functions / `/api/*` → xAI (`XAI_API_KEY`, server-only)
and isolated git jobs (owner session required).

This is the Grok Build live preview. There is no claimed `*.grok.me` URL unless
a later publish actually creates one. Health:

`GET /api/runtime` → `{ "mode": "server", "ai": true|false, "appEditEnabled": true|false, "role": ... }`

Isolated Application Edit preview (not HMR): `GET /__preview/<jobId>/`

Environment (server-only, never `VITE_`):

| Variable | Role |
| --- | --- |
| `XAI_API_KEY` | xAI. Absence ⇒ AI OFFLINE. Never sent to the browser. |
| `APP_EDIT_ENABLED` | Production feature flag. Unset/false ⇒ every privileged mutation is 403. |
| `APP_EDIT_OWNER_SECRET` | Owner passphrase. Compared server-side only. |
| `APP_EDIT_USER_SECRET` | Standard-user passphrase (tests / reduced role). |
| `APP_EDIT_SESSION_SECRET` | HMAC key for the httpOnly `mf_priv` cookie. |

Privileged operations (deny by default, owner session required):

create-branch, write-source, commit, rollback, create-job, promote, reject, inspect/read source.

Standard CAD users do not authenticate. They use Project / CAD / Engineering / 2D / 3D / IndexedDB.

## Static CAD surface (GitHub Pages) — Option B

URL: https://markgerber1.github.io/mineforge-3d/

No server. `GET /api/runtime` is not JSON (static host fallback). The client enters **STATIC MODE**:

- AI OFFLINE — no fake Grok answers
- Application Edit is not presented as available
- CAD, Engineering Core, REQUESTED/SAFE, 2D, 3D, local persistence still work

GitHub Pages is mounted at `/mineforge-3d/`. The client resolves that basepath at runtime.
Asset URLs in the Pages snapshot are rewritten to `/mineforge-3d/…`.

## Rule

If the server path is missing, the UI must say so. It must not simulate Grok success.
