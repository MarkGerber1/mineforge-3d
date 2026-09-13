#!/usr/bin/env bash
# Mandatory Batch 1 security + production gate. Any failure is a non-zero exit.
# Runs the full repository test suite (`npm test`) — no skips, no || true.
set -euo pipefail
cd "$(dirname "$0")/.."
SHA="$(git rev-parse HEAD)"
echo "CANDIDATE_SHA=$SHA"
echo "== typecheck =="
npm run typecheck
echo "== full test suite =="
npm test
echo "== playwright webkit =="
npx playwright install --with-deps webkit
echo "== mobile webkit e2e =="
# WebKitGTK DMABuf/GL overlays paint <video> as black onto 2D canvas in GH runners.
# Force CPU-side samples so play-through / WebCodecs can produce real stills.
export WEBKIT_GST_DMABUF_SINK_DISABLED="${WEBKIT_GST_DMABUF_SINK_DISABLED:-1}"
export WEBKIT_GST_DMABUF_SINK_FORCED_FALLBACK_CAPS_FORMAT="${WEBKIT_GST_DMABUF_SINK_FORCED_FALLBACK_CAPS_FORMAT:-RGBA}"
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
export GST_GL_DISABLED="${GST_GL_DISABLED:-1}"
npm run test:mobile
echo "== secret scan =="
npm run scan:secrets
echo "== production build =="
npm run build
echo "== secret scan (built assets) =="
npm run scan:secrets
echo "GATE PASS CANDIDATE_SHA=$SHA"
