#!/usr/bin/env bash
# Mandatory Batch 1 security + production gate. Any failure is a non-zero exit.
set -euo pipefail
cd "$(dirname "$0")/.."
SHA="$(git rev-parse HEAD)"
echo "CANDIDATE_SHA=$SHA"
echo "== typecheck =="
npm run typecheck
echo "== unit + oracle + authorization + isolation =="
npm test
echo "== secret scan =="
npm run scan:secrets
echo "== production build =="
npm run build
echo "== secret scan (built assets) =="
npm run scan:secrets
echo "GATE PASS CANDIDATE_SHA=$SHA"
