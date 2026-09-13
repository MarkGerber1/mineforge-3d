# MINEFORGE 3D

Инженерный CAD / цифровой двойник ASIC-фермы: 2D план, 1:1 3D twin, вентиляция, электрика, **REQUESTED / SAFE**, Reality (фото и кадры видео), Grok.

**Engineering Core is the only source of numbers. AI never replaces it.**

| | |
|---|---|
| Repository | https://github.com/MarkGerber1/mineforge-3d |
| Functional acceptance | Batches **1–4 PASSED** |
| Baseline SHA | `635fd9e965ed8d9705c310b72b82dde2b81f837f` |
| Required CI | `gate` on protected `main` |
| Next AI | **[AI_HANDOFF.md](AI_HANDOFF.md)** (read first) |

## Continue this project

1. [AI_HANDOFF.md](AI_HANDOFF.md) — what not to do, how to start
2. [PROJECT_STATE.md](PROJECT_STATE.md) — accepted capabilities and limits
3. [ARCHITECTURE.md](ARCHITECTURE.md) — module boundaries
4. [RECOVERY.md](RECOVERY.md) — clone → install → test → run
5. [project-handoff.json](project-handoff.json) — machine-readable metadata
6. `.env.example` — environment **names** only

```bash
git clone https://github.com/MarkGerber1/mineforge-3d.git
cd mineforge-3d
npm ci --legacy-peer-deps
npm run recovery:verify
npm run dev
```

CAD, Twin, Reality and SAFE work without an API key. Grok needs `XAI_API_KEY` (server-only).

## Public surfaces

- Source: https://github.com/MarkGerber1/mineforge-3d
- Static CAD demo (not full production): https://markgerber1.github.io/mineforge-3d/
- Server-capable production (`/api/runtime`, Grok): **not published yet** — Owner Publish in Grok Build or Vercel.

```
PHYSICAL_IPHONE_SMOKE: WAITING_FOR_OWNER
PUBLIC_PRODUCTION_DEPLOYMENT: BLOCKED_OWNER_PUBLISH
```

Do not configure tunnels or custom domains unless the Owner changes that policy.

## Batch evidence

`docs/BATCH1-EVIDENCE.md` · `docs/BATCH2.md` · `docs/BATCH3.md` · `docs/BATCH4.md` · `docs/VERIFICATION.md`
