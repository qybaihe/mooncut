#!/usr/bin/env bash
set -euo pipefail

SERVER="${MOONCUT_DEPLOY_SERVER:-42.194.219.172}"
USER="${MOONCUT_DEPLOY_USER:-ubuntu}"
KEY="${MOONCUT_DEPLOY_KEY:-/Users/baihe/Downloads/baihe.pem}"
WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="${MOONCUT_EXTENSION_SOURCE:-${WORKSPACE}/remotion-studio/extensions/remotion-community}"
DESTINATION="/opt/mooncut/remotion-studio/extensions/remotion-community"

if [[ ! -f "${SOURCE}/remocn/registry/remocn/animated-bar-chart/index.tsx" ]]; then
  echo "Missing local Remocn source under ${SOURCE}" >&2
  exit 1
fi

ssh -i "${KEY}" -o BatchMode=yes "${USER}@${SERVER}" "mkdir -p ${DESTINATION}"
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'public/' \
  --exclude '*.mp4' \
  --exclude '*.mov' \
  -e "ssh -i ${KEY} -o BatchMode=yes" \
  "${SOURCE}/" "${USER}@${SERVER}:${DESTINATION}/"
ssh -i "${KEY}" -o BatchMode=yes "${USER}@${SERVER}" "sudo systemctl restart mooncut-agent"

echo "Remotion community extension sources synchronized to ${SERVER}:${DESTINATION}"
