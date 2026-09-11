#!/bin/sh
set -eu
cd /workspace
# Privileged Application Edit is deny-by-default. Workspace preview may enable
# the capability flag; mutating endpoints still require an owner session.
if [ -z "${GROK_PROJECT_ID:-}" ]; then
  export APP_EDIT_ENABLED="${APP_EDIT_ENABLED:-true}"
fi
node scripts/preview.mjs stop || true
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
