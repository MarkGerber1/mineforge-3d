#!/bin/sh
# Canonical HTTPS ingress: Cloudflare Named Tunnel only.
#
# Forbidden as canonical (auditor Pass 2 / Pass 3):
#   *.trycloudflare.com, wrangler --temporary workers.dev, ephemeral previews.
#
# If CLOUDFLARE_TUNNEL_TOKEN is set, run the named tunnel. The public hostname
# is CANONICAL_FULLSTACK_URL (owner-provided, DNS-routed in a claimed account).
# Without a token this script exits 0: workspace preview only.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
STATE_DIR="$ROOT/.grok"
STATE="$STATE_DIR/canonical-runtime.json"
LOG="$STATE_DIR/canonical-tunnel.log"
CFD="${CLOUDFLARED_BIN:-/root/.npm/_npx/8a26fc3a61fe4212/node_modules/cloudflared/bin/cloudflared}"

mkdir -p "$STATE_DIR"

token="${CLOUDFLARE_TUNNEL_TOKEN:-}"
url="${CANONICAL_FULLSTACK_URL:-}"

sha="$(git -C "$ROOT" rev-parse HEAD)"
if [ -z "$token" ]; then
  printf '%s\n' "{\"url\":\"\",\"kind\":\"none\",\"sha\":\"$sha\",\"reason\":\"no-named-tunnel-token\"}" >"$STATE"
  echo "canonical-tunnel: no CLOUDFLARE_TUNNEL_TOKEN; workspace preview only" | tee -a "$LOG"
  exit 0
fi

python3 - "$CFD" "$token" "$url" "$STATE" "$LOG" "$sha" <<'PY'
import json, os, subprocess, sys, time, urllib.request
cfd, token, url, state_path, log_path, sha = sys.argv[1:7]
log = open(log_path, "a", encoding="utf-8")

def say(msg):
    log.write(msg + "\n"); log.flush()
    print(msg, flush=True)

def pid_cmd(pid):
    try:
        return open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode("latin1", "ignore")
    except Exception:
        return ""

def is_named_cf(cmd: str) -> bool:
    parts = cmd.split()
    if not parts:
        return False
    exe = parts[0]
    if not (exe == "cloudflared" or exe.endswith("/cloudflared")):
        return False
    return "tunnel" in parts and "run" in parts

alive = False
for name in os.listdir("/proc"):
    if name.isdigit() and is_named_cf(pid_cmd(int(name))):
        alive = True
        break
if not alive:
    env = os.environ.copy()
    subprocess.Popen(
        [cfd, "tunnel", "run", "--token", token],
        stdout=log, stderr=log, start_new_session=True, env=env,
    )
    say("started named cloudflare tunnel")
else:
    say("named cloudflare tunnel already running")

rec = {
    "url": url,
    "kind": "cloudflare-named-tunnel",
    "sha": sha,
    "updatedAt": time.time(),
}
json.dump(rec, open(state_path, "w"), indent=2)
if url:
    say(f"CANONICAL_FULLSTACK_URL={url}")
    ok = False
    for _ in range(20):
        try:
            req = urllib.request.Request(url.rstrip("/") + "/api/runtime", method="GET")
            with urllib.request.urlopen(req, timeout=8) as r:
                body = r.read().decode("utf-8", "replace")
                ct = r.headers.get("content-type", "")
                if r.status == 200 and "json" in ct and '"mode"' in body:
                    ok = True
                    break
        except Exception:
            pass
        time.sleep(1)
    if not ok:
        say("named tunnel started; canonical URL not healthy yet")
        sys.exit(1)
sys.exit(0)
PY
