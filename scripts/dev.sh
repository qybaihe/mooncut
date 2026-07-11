#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  kill "${AGENT_PID:-}" "${WEB_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd "$ROOT/mooncut-pi-agent" && npm run serve) &
AGENT_PID=$!
(cd "$ROOT/mooncut-web" && npm run dev -- --host 127.0.0.1) &
WEB_PID=$!

echo "MoonCut Agent: http://127.0.0.1:4317"
echo "MoonCut Web:   http://127.0.0.1:5173"
wait
