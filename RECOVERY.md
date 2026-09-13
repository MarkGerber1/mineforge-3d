# RECOVERY — MINEFORGE 3D

Operational manual for a clean machine. Product status: [PROJECT_STATE.md](PROJECT_STATE.md). Next AI: [AI_HANDOFF.md](AI_HANDOFF.md).

## Repository

```
https://github.com/MarkGerber1/mineforge-3d
```

```bash
git clone https://github.com/MarkGerber1/mineforge-3d.git
cd mineforge-3d
git checkout main
git rev-parse HEAD
```

Compare HEAD to `acceptedFunctionalBaselineSha` in [project-handoff.json](project-handoff.json) (or a later accepted merge SHA recorded there after this continuity package).

Protected `main` requires status check **`gate`**. `enforce_admins: true`. Never `--admin`, never force-push.

## Prerequisites

| Tool | Version used in CI / lockfile |
|---|---|
| Node.js | **22** (GitHub Actions `node-version: "22"`). `package.json` `engines.node` = `>=22` |
| npm | npm 10 bundled with Node 22. Install with `npm ci --legacy-peer-deps` |
| Playwright | `^1.62.0` (lockfile). CI WebKit reported **26.6** |
| OS for WebKit E2E | Ubuntu with `npx playwright install --with-deps webkit` (gstreamer, GTK, etc.) |
| Git | 2.x with ability to create worktrees (App Edit isolation tests) |

A Linux sandbox **without** those WebKit system libraries cannot launch Playwright WebKit. That is expected. CI must still install deps and **fail** if WebKit cannot start.

## Fresh recovery (copy/paste)

```bash
git clone https://github.com/MarkGerber1/mineforge-3d.git
cd mineforge-3d
git checkout main
cp .env.example .env
# leave secrets empty for CAD-only; or fill XAI_API_KEY / APP_EDIT_* locally — never commit .env

npm ci --legacy-peer-deps
npm run recovery:verify
npm run typecheck
npm test
npm run build
```

Development server (full-stack Vite, all interfaces, port 8080):

```bash
npm run dev
```

Production-style local preview after `npm run build`:

```bash
npm run preview
```

Playwright WebKit (optional locally; **required** in CI):

```bash
npx playwright install --with-deps webkit
export WEBKIT_GST_DMABUF_SINK_DISABLED=1
export WEBKIT_GST_DMABUF_SINK_FORCED_FALLBACK_CAPS_FORMAT=RGBA
export LIBGL_ALWAYS_SOFTWARE=1
export GST_GL_DISABLED=1
npm run test:mobile
```

Full required gate (what GitHub runs):

```bash
npm run test:gate
```

Successful gate prints `GATE PASS CANDIDATE_SHA=<40-char sha>` and exits 0.

## Environment variables

Names and placeholders: [.env.example](.env.example). **Never commit secret values.**

| Name | Purpose | Required | Scope | Format | Without it | Local fallback |
|---|---|---|---|---|---|---|
| `XAI_API_KEY` | xAI Grok (`https://api.x.ai/v1/chat/completions`, model `grok-4.5`) | no | server | secret string | AI OFFLINE | CAD/Engineering/Reality work |
| `APP_EDIT_ENABLED` | Privileged mutation routes | no | server | `true`/`1`/`on` | App Edit 403 | leave false |
| `APP_EDIT_OWNER_SECRET` | Owner passphrase | if App Edit on | server | secret | cannot authorize owner | tests inject fakes |
| `APP_EDIT_USER_SECRET` | Standard-user passphrase | no | server | secret | no user role | tests inject |
| `APP_EDIT_SESSION_SECRET` | HMAC for `mf_priv` cookie | if App Edit on | server | secret | derived from owner secret if unset | tests inject |
| `APP_EDIT_ROOT` | Job filesystem root | no | server | path | `process.cwd()` | default |
| `MF_PREVIEW_HEALTH_MS` | Isolated preview health timeout | no | server | integer ms | code default | — |
| `MF_DEPLOY_SHA` | SHA on `/api/runtime` | no | server | git sha | `git rev-parse HEAD` | — |
| `MF_BUILD_ID` | Build id on runtime | no | server | string | equals deploy SHA | — |
| `RATE_LIMIT_TRUST` | Client IP trust mode | no | server | `local`/`cloudflare`/… | `local` | local |
| `PRODUCTION_INSTANCE_MODEL` | Runtime advertisement | no | server | `single-instance` | single-instance | — |
| `GROK_PROJECT_ID` | Platform deployed-app id | no | server | string | workspace preview | unset locally |
| `GROK_GATE_ORIGIN` | Auth gate origin | no | server | URL | unused (auth OFF) | — |
| `VITE_AUTH_ENABLED` | Client auth flag | no | client | `"false"`/`"true"` | `.grok/app-env.json` is `"false"` | keep false |
| `VITE_PUBLIC_HOSTNAME` | PWA hostname | no | client | hostname | empty | — |
| `DATABASE_URL` | Postgres | no | server | URL | unused (DB OFF) | — |
| `PLAYWRIGHT_BASE_URL` | E2E target | no | test | URL | `http://127.0.0.1:8080` | default |
| `MF_LIVE_URL` | Live evidence script | no | test | URL | `http://127.0.0.1:8080` | default |
| `WEBKIT_GST_DMABUF_SINK_DISABLED` | WebKit video canvas | CI | test | `1` | possible black frames | set in CI |
| `WEBKIT_GST_DMABUF_SINK_FORCED_FALLBACK_CAPS_FORMAT` | RGBA software samples | CI | test | `RGBA` | — | CI |
| `LIBGL_ALWAYS_SOFTWARE` | Force software GL | CI | test | `1` | — | CI |
| `GST_GL_DISABLED` | Disable GST GL | CI | test | `1` | — | CI |
| `CLOUDFLARE_TUNNEL_TOKEN` | Named Tunnel | **deferred** | server | token | no public host | **do not set** |
| `CANONICAL_FULLSTACK_URL` | Public HTTPS origin | **deferred** | server | URL | unset | **do not set** |

Client-visible keys must be `VITE_*` and must **never** hold secrets. `scripts/with-app-env.mjs` merges `.grok/app-env.json` (currently `VITE_AUTH_ENABLED=false`).

## AI provider

- Provider: **xAI**. Server function `grokEngineer` → `executeGrokEngineer` → `POST https://api.x.ai/v1/chat/completions` with `Authorization: Bearer $XAI_API_KEY`, model `grok-4.5`, tools (`propose_patch`, `propose_finding`, `propose_app_edit`, …).
- Secret is **server-only**. Secret scan fails if it appears in client bundles.
- Without the key: `/api/runtime` reports `ai: false`; UI **AI OFFLINE**.
- Still works offline: 2D, 3D, REQUESTED/SAFE, Reality photo, local video frame extract, Undo/Redo, IndexedDB save.
- AI never writes canonical geometry. Owner ADD / APPLY only.

## Persistence

See [ARCHITECTURE.md](ARCHITECTURE.md#persistence).

Reset local state: in the browser, delete IndexedDB database `mineforge` (DevTools → Application → IndexedDB). That removes projects and stored JPEGs. Raw video is never stored.

## Tests

| Command | What |
|---|---|
| `npm run recovery:verify` | Files, env **names**, typecheck, oracle, security, secret scan |
| `npm test` | scripts + auth helpers + oracle + security + isolation |
| `npm run test:oracle` | Engineering Core (`src/engineering/oracle/*.test.ts`) |
| `npm run test:security` | privilege / runtime / ratelimit |
| `npm run test:isolation` | App Edit isolated jobs |
| `npm run test:mobile` | Playwright WebKit iPhone E2E |
| `npm run scan:secrets` | No secret **values** in client surfaces |
| `npm run test:gate` | Full required CI gate |

Oracle success ends with `# fail 0` and a `# pass N` line (accepted Batch 4 correction: **87** oracle tests). `npm test` is hundreds of tests, all fail=0. Gate success: `GATE PASS CANDIDATE_SHA=…`.

`recovery:verify` does **not** run Playwright. Browser E2E belongs in `test:gate`.

Optional: `RECOVERY_VERIFY_BUILD=1 npm run recovery:verify` also runs `npm run build`.

## Build

```bash
npm run build
```

Runs Vite production build via `scripts/with-app-env.mjs`, then `npm run db:migrate` (no-op-safe while DATABASE_URL is unset). Output: `.vercel/output/static` (TanStack Start / Nitro).

Static GitHub Pages snapshot (CAD only, not full-stack): `scripts/deploy-gh-pages.sh` after a build. That is **STATIC DEMO**, not production.

## Troubleshooting (proven)

**WebKit cannot launch locally.** Missing `libgstreamer-1.0.so.0`, GTK, flite, etc. Install with `npx playwright install --with-deps webkit` on Ubuntu, or rely on CI. Do not skip `test:mobile` in the gate.

**WebKit decodes metadata but frames are black.** GStreamer DMABuf overlay. Set the four `WEBKIT_GST_*` / `LIBGL_*` / `GST_GL_*` variables from `.env.example`. Extractor plays the video on-screen, then WebCodecs VP8. Positive test must still see distinct JPEG hashes.

**H.264 vs VP8.** Linux WebKit is reliable for the checked-in VP8 WebM fixture (`tests/fixtures/video/frames-rgb.webm`). MP4 H.264 may `maybe` canPlay and still fail decode — that is fail-closed, not a skip of the VP8 proof.

**AI OFFLINE in the UI.** Missing `XAI_API_KEY` or static host. Expected. Product remains usable.

**App Edit 403.** Flag off, or no owner session, or serverless `GROK_PROJECT_ID`. Expected.

**`npm ci` peer errors.** Always `npm ci --legacy-peer-deps` (CI does).

**Dimension tap in WebKit.** CAD dimensions are HTML 44px hit targets, not SVG-only text.

## Disaster recovery

| Loss | Recover from GitHub? |
|---|---|
| Grok / chat session | Yes — clone, install, run. Session chat is not source of truth |
| Codespace / local disk | Yes — `git clone` + `.env.example`. Re-enter secrets |
| Working branch local only | Yes if it was **pushed**. Unpushed commits are gone |
| `.env` | **No** — recreate from `.env.example`; paste new secrets |
| `XAI_API_KEY` | **No** — issue a new key at xAI; GitHub must never contain it |
| Owner App Edit passphrase | **No** — choose a new one; not in git |
| IndexedDB farm on a browser | **No** — local only. Export is the in-app project JSON if the Owner saved/exported |
| Negative PRs #1–#5 | Leave open |

GitHub restores **all non-secret source-controlled state**. It cannot restore secret values, tunnel tokens, or a user’s browser IndexedDB.

## Future release / tag procedure (do not run yet)

Public production and physical iPhone smoke are still deferred. Do **not** tag `v1.0` or `production`.

When Owner authorizes a non-production continuity marker:

```bash
git checkout main
git pull --ff-only
git tag -a functional-b1-b4-accepted -m "Functional Batches 1-4 accepted at 635fd9e"
git push origin functional-b1-b4-accepted
```

Only if repository policy allows tags. Never label it production.

Later final release (out of scope here): independent acceptance + physical iPhone smoke + server-capable public host, then a clearly named production tag.
