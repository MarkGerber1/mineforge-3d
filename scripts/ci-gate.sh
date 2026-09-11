#!/usr/bin/env bash
# Mandatory Batch 1 security + production gate. Any failure is a non-zero exit.
# Platform scripts/*.test.mjs that require workspace-only .grok/skills are not
# part of this gate (they fail on a clean GitHub checkout).
set -euo pipefail
cd "$(dirname "$0")/.."
SHA="$(git rev-parse HEAD)"
echo "CANDIDATE_SHA=$SHA"
echo "== typecheck =="
npm run typecheck
echo "== engineering oracle =="
npm run test:oracle
echo "== authorization + runtime client =="
npm run test:security
echo "== Application Edit isolation A-J =="
npm run test:isolation
echo "== secret scan =="
npm run scan:secrets
echo "== production build =="
npm run build
echo "== secret scan (built assets) =="
npm run scan:secrets
echo "GATE PASS CANDIDATE_SHA=$SHA"
