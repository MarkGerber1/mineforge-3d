#!/bin/sh
# Canonical HTTPS ingress.
#
# Public identity is a named Cloudflare Worker on workers.dev
# (https://mineforge3d.<account>.workers.dev). That hostname is requested
# (--name mineforge3d) and reused across restarts.
#
# The Worker reverse-proxies to an unpublished origin hop (Cloudflare Quick
# Tunnel to the live full-stack process). The Quick Tunnel hostname is NEVER
# the canonical URL.
#
# Named Cloudflare Tunnel credentials (cert.pem / TUNNEL_TOKEN) take
# precedence when present.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
STATE_DIR="$ROOT/.grok"
STATE="$STATE_DIR/canonical-runtime.json"
LOG="$STATE_DIR/canonical-tunnel.log"
WORKER_DIR="$STATE_DIR/canonical-worker"
CFD="${CLOUDFLARED_BIN:-/root/.npm/_npx/8a26fc3a61fe4212/node_modules/cloudflared/bin/cloudflared}"
WORKER_NAME="${CANONICAL_WORKER_NAME:-mineforge3d}"
LOCAL_PORT="${CANONICAL_LOCAL_PORT:-8080}"

mkdir -p "$STATE_DIR" "$WORKER_DIR"

python3 - "$ROOT" "$STATE" "$LOG" "$WORKER_DIR" "$CFD" "$WORKER_NAME" "$LOCAL_PORT" <<'PY'
import json, os, re, subprocess, sys, time, urllib.request, shutil
root, state_path, log_path, worker_dir, cfd, worker_name, port = sys.argv[1:8]
log = open(log_path, "a", encoding="utf-8")

def say(msg):
    log.write(msg + "\n"); log.flush()
    print(msg, flush=True)

def pid_cmd(pid):
    try:
        return open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode("latin1", "ignore")
    except Exception:
        return ""

def is_cloudflared(cmd: str) -> bool:
    parts = cmd.split()
    if not parts:
        return False
    exe = parts[0]
    return exe == "cloudflared" or exe.endswith("/cloudflared")

def running_cf():
    for name in os.listdir("/proc"):
        if name.isdigit() and is_cloudflared(pid_cmd(int(name))):
            return int(name)
    return None

def http_json(url, timeout=8):
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", "replace")
            return r.status, body, r.headers.get("content-type", "")
    except Exception as e:
        return 0, str(e), ""

def write_state(url, kind, origin):
    sha = subprocess.check_output(["git", "-C", root, "rev-parse", "HEAD"], text=True).strip()
    rec = {"url": url, "kind": kind, "originHop": origin, "sha": sha, "updatedAt": time.time()}
    json.dump(rec, open(state_path, "w"), indent=2)
    say(f"CANONICAL_FULLSTACK_URL={url}")

saved = {}
if os.path.isfile(state_path):
    try:
        saved = json.load(open(state_path))
    except Exception:
        saved = {}

canonical = str(saved.get("url") or "")
if canonical.endswith("trycloudflare.com") or "trycloudflare.com" in canonical:
    canonical = ""

# Restore wrangler temp account so the workers.dev hostname is reused.
src_toml = os.path.expanduser("~/.config/.wrangler/wrangler-temporary-account.toml")
bak_toml = os.path.join(os.path.dirname(state_path), "wrangler-temporary-account.toml")
os.makedirs(os.path.dirname(src_toml), exist_ok=True)
if os.path.isfile(bak_toml) and not os.path.isfile(src_toml):
    shutil.copy2(bak_toml, src_toml)
    say("restored wrangler temporary account")

# Start unpublished origin hop (quick tunnel) unless a named CF tunnel token exists.
origin = str(saved.get("originHop") or "")
token = os.environ.get("CLOUDFLARE_TUNNEL_TOKEN", "").strip()
if token:
    if not running_cf():
        subprocess.Popen([cfd, "tunnel", "run", "--token", token], stdout=log, stderr=log, start_new_session=True)
        say("started named cloudflare tunnel from token")
    origin = os.environ.get("CANONICAL_CF_ORIGIN", origin)
else:
    if origin:
        code, body, ct = http_json(origin.rstrip("/") + "/api/runtime")
        if code != 200 or "json" not in ct:
            origin = ""
    if not origin:
        # kill stale quick tunnels so we own one hop
        for name in os.listdir("/proc"):
            if not name.isdigit():
                continue
            cmd = pid_cmd(int(name))
            if is_cloudflared(cmd):
                try:
                    os.kill(int(name), 15)
                except Exception:
                    pass
        time.sleep(0.4)
        qlog_path = os.path.join(os.path.dirname(state_path), "origin-hop.log")
        qlog = open(qlog_path, "w")
        subprocess.Popen(
            [cfd, "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
            stdout=qlog, stderr=subprocess.STDOUT, start_new_session=True,
        )
        origin = ""
        for _ in range(40):
            time.sleep(0.4)
            try:
                txt = open(qlog_path, encoding="utf-8", errors="replace").read()
            except Exception:
                txt = ""
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", txt)
            if m:
                origin = m.group(0)
                code, body, ct = http_json(origin + "/api/runtime")
                if code == 200 and "json" in ct:
                    break
        if not origin:
            say("origin hop failed to start")
            sys.exit(1)
        say(f"origin hop ready (unpublished)")

# Deploy/update the named Worker proxy. Hostname is requested and reused.
worker_js_src = os.path.join(root, "scripts/canonical-worker/worker.js")
shutil.copy2(worker_js_src, os.path.join(worker_dir, "worker.js"))
toml = f'''name = "{worker_name}"
main = "worker.js"
compatibility_date = "2026-09-01"
workers_dev = true

[vars]
ORIGIN = "{origin}"
'''
open(os.path.join(worker_dir, "wrangler.toml"), "w").write(toml)
proc = subprocess.run(
    ["npx", "--yes", "wrangler", "deploy", "--temporary", "--name", worker_name],
    cwd=worker_dir, text=True, capture_output=True, timeout=120,
)
out = (proc.stdout or "") + "\n" + (proc.stderr or "")
log.write(out + "\n"); log.flush()
if os.path.isfile(src_toml):
    shutil.copy2(src_toml, bak_toml)
m = re.search(r"https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev", out)
if not m:
    say("worker deploy did not print workers.dev URL")
    say(out[-1500:])
    sys.exit(1)
url = m.group(0)
# health on canonical
ok = False
for _ in range(15):
    code, body, ct = http_json(url + "/api/runtime")
    if code == 200 and "json" in ct and '"mode"' in body:
        ok = True
        break
    time.sleep(0.6)
if not ok:
    say(f"canonical worker deployed but /api/runtime not JSON yet: {code} {body[:200]}")
    # still record — origin may still be warming
write_state(url, "cloudflare-worker-proxy", origin)
if not ok:
    sys.exit(1)
sys.exit(0)
PY
