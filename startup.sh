#!/bin/sh
set -eu
cd /workspace
# Privileged Application Edit is deny-by-default. Workspace preview may enable
# the capability flag; mutating endpoints still require an owner session.
# Serverless / grok.me / Vercel set GROK_PROJECT_ID → App Edit stays off.
if [ -z "${GROK_PROJECT_ID:-}" ]; then
  export APP_EDIT_ENABLED="${APP_EDIT_ENABLED:-true}"
fi
export MF_DEPLOY_SHA="${MF_DEPLOY_SHA:-$(git rev-parse HEAD)}"
export MF_BUILD_ID="${MF_BUILD_ID:-$MF_DEPLOY_SHA}"
export PRODUCTION_INSTANCE_MODEL="${PRODUCTION_INSTANCE_MODEL:-single-instance}"
# Named Cloudflare Tunnel is the only trusted reverse-proxy identity.
if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  export RATE_LIMIT_TRUST="${RATE_LIMIT_TRUST:-cloudflare}"
else
  export RATE_LIMIT_TRUST="${RATE_LIMIT_TRUST:-local}"
fi

node scripts/preview.mjs stop || true
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  npm run dev >>/tmp/app-startup.log 2>&1 &
  i=0
  while [ "$i" -lt 40 ]; do
    if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
      break
    fi
    i=$((i + 1))
    sleep 0.25
  done
fi
sh scripts/canonical-tunnel.sh >>/tmp/canonical-tunnel-boot.log 2>&1 &
