#!/usr/bin/env bash
# Exposes the local API through a free Cloudflare quick tunnel so the GitHub Pages
# front end can use it. The URL changes every run.
#
#   npm run tunnel                # start tunnel, write api-config.js
#   npm run tunnel -- --publish   # ...and commit + push api-config.js so Pages picks it up
#
# The tunnel stays up while this script runs (Ctrl-C to stop). Start the server first: npm start
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${SPEND_TRACK_ENV_FILE:-$HOME/.config/spend_track/.env}"
PORT="${PORT:-$( (grep -E "^PORT=" "$ENV_FILE" 2>/dev/null || echo "PORT=3000") | head -1 | cut -d= -f2 | tr -d "'\"")}"
PUBLISH=n; [[ "${1:-}" == "--publish" ]] && PUBLISH=y

command -v cloudflared >/dev/null || { echo "cloudflared is not installed: brew install cloudflared" >&2; exit 1; }
curl -fsS -o /dev/null "http://localhost:$PORT/" || { echo "Nothing on http://localhost:$PORT. Run npm start first." >&2; exit 1; }

LOG="$(mktemp -t spend_track_tunnel)"
cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$LOG" 2>&1 &
CF_PID=$!
trap 'kill $CF_PID 2>/dev/null; rm -f "$LOG"' EXIT

URL=""
for _ in $(seq 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [[ -n "$URL" ]] && break
  kill -0 $CF_PID 2>/dev/null || { cat "$LOG" >&2; exit 1; }
  sleep 0.5
done
[[ -n "$URL" ]] || { echo "Timed out waiting for the tunnel URL." >&2; cat "$LOG" >&2; exit 1; }

cat > api-config.js <<JS
// Where the GitHub Pages copy of the site finds the API. Written by scripts/tunnel.sh.
// Empty = browser-only mode. Ignored when the page is served by the Node server itself.
window.SPEND_TRACK_API = '$URL';
JS
echo "Tunnel: $URL -> http://localhost:$PORT"

if [[ $PUBLISH == y ]]; then
  if git diff --quiet -- api-config.js; then echo "api-config.js unchanged"
  else
    git commit -q -m "Point GitHub Pages at API tunnel" -- api-config.js
    git push -q && echo "Pushed. GitHub Pages will use the tunnel within a few minutes."
  fi
fi

echo "Tunnel is up; press Ctrl-C to stop."
wait $CF_PID
