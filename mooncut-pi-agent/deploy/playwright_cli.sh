#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
needs_config=false
for argument in "$@"; do
  if [[ "${argument}" == "open" || "${argument}" == "attach" ]]; then
    needs_config=true
    break
  fi
done

if [[ "${needs_config}" == "true" ]]; then
  exec npx --yes --package @playwright/cli playwright-cli \
    --config "${SCRIPT_DIR}/playwright-cli.config.json" "$@"
fi
exec npx --yes --package @playwright/cli playwright-cli "$@"
