#!/usr/bin/env bash
# Option B: static CAD snapshot for GitHub Pages at /mineforge-3d/.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
SRC=".vercel/output/static"
if [ ! -d "$SRC/assets" ]; then
  echo "missing $SRC/assets — run npm run build first" >&2
  exit 1
fi
# Capture SSR HTML from production preview if available.
HTML_URL="${PAGES_HTML_URL:-http://127.0.0.1:8081/}"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
cp -a "$SRC/." "$TMP/"
if curl -sf --max-time 8 "$HTML_URL" -o "$TMP/index.raw.html"; then
  mv "$TMP/index.raw.html" "$TMP/index.html"
else
  echo "warn: could not fetch SSR HTML from $HTML_URL" >&2
  # Minimal shell so Pages is not an empty directory.
  printf '%s\n' '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>MINEFORGE 3D</title></head><body></body></html>' >"$TMP/index.html"
fi
python3 - "$TMP" <<'PY'
import re, sys
from pathlib import Path
root = Path(sys.argv[1])
prefix = "/mineforge-3d"

def rewrite_html(text: str) -> str:
    text = re.sub(r'(href|src)="/(assets|__grok|favicon)([^"]*)"', rf'\1="{prefix}/\2\3"', text)
    text = text.replace('href="/og.jpg"', f'href="{prefix}/og.jpg"')
    return text

def rewrite_js(text: str) -> str:
    text = text.replace("return`/`+e", f"return`{prefix}/`+e")
    text = text.replace("return '/' + e", f"return '{prefix}/' + e")
    # TanStack Start hydration overwrites getRouter() basepath with empty.
    text = text.replace("basepath:``", "basepath:`/mineforge-3d`")
    text = text.replace('basepath:""', 'basepath:"/mineforge-3d"')
    text = text.replace("e.update({basepath:``})", "e.update({basepath:`/mineforge-3d`})")
    text = text.replace('e.update({basepath:""})', 'e.update({basepath:"/mineforge-3d"})')
    text = text.replace("href:`/favicon.svg`", f"href:`{prefix}/favicon.svg`")
    text = text.replace("href:`/__grok/", f"href:`{prefix}/__grok/")
    text = text.replace("href:`/assets/", f"href:`{prefix}/assets/")
    return text

for p in root.rglob("*"):
    if not p.is_file():
        continue
    if p.suffix in {".html", ".js", ".css", ".webmanifest"}:
        orig = p.read_text(encoding="utf-8", errors="replace")
        next_ = rewrite_html(orig) if p.suffix == ".html" else rewrite_js(orig) if p.suffix == ".js" else orig
        if p.suffix == ".html":
            next_ = rewrite_html(next_)
        if next_ != orig:
            p.write_text(next_, encoding="utf-8")

idx = root / "index.html"
if idx.exists():
    (root / "404.html").write_text(idx.read_text(encoding="utf-8"), encoding="utf-8")
print("rewritten", root)
PY
# Publish
git fetch origin gh-pages --depth 1 || true
WORK="$ROOT/.grok/gh-pages-work"
rm -rf "$WORK"
mkdir -p "$WORK"
if git rev-parse --verify origin/gh-pages >/dev/null 2>&1; then
  git worktree add "$WORK" origin/gh-pages
else
  git worktree add --detach "$WORK"
  git -C "$WORK" checkout --orphan gh-pages
fi
find "$WORK" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -a "$TMP/." "$WORK/"
# no Jekyll
touch "$WORK/.nojekyll"
git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "gh-pages: no changes"
else
  git -C "$WORK" -c user.email=mineforge@local -c user.name=MINEFORGE commit -m "deploy: static CAD Option B (Batch 1)"
  git -C "$WORK" push origin HEAD:gh-pages --force
fi
git worktree remove --force "$WORK" || true
echo "PAGES_DEPLOYED"
