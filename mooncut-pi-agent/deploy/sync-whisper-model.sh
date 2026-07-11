#!/usr/bin/env bash
set -euo pipefail

SERVER="${MOONCUT_DEPLOY_SERVER:-42.194.219.172}"
USER="${MOONCUT_DEPLOY_USER:-ubuntu}"
KEY="${MOONCUT_DEPLOY_KEY:-/Users/baihe/Downloads/baihe.pem}"
MODEL_CACHE="${MOONCUT_WHISPER_LOCAL_CACHE:-${HOME}/.cache/huggingface/hub/models--Systran--faster-whisper-small}"
REMOTE_MODEL="/opt/mooncut/models/faster-whisper-small"

if [[ ! -f "${MODEL_CACHE}/refs/main" ]]; then
  echo "Missing local Faster Whisper model cache: ${MODEL_CACHE}" >&2
  exit 1
fi

revision="$(cat "${MODEL_CACHE}/refs/main")"
snapshot="${MODEL_CACHE}/snapshots/${revision}"
if [[ ! -f "${snapshot}/model.bin" ]]; then
  echo "Incomplete Faster Whisper snapshot: ${snapshot}" >&2
  exit 1
fi

ssh -i "${KEY}" -o BatchMode=yes "${USER}@${SERVER}" \
  "sudo install -d -m 0755 -o ${USER} -g ${USER} ${REMOTE_MODEL}"
rsync -aL --partial --progress \
  -e "ssh -i ${KEY} -o BatchMode=yes" \
  "${snapshot}/" "${USER}@${SERVER}:${REMOTE_MODEL}/"
ssh -i "${KEY}" -o BatchMode=yes "${USER}@${SERVER}" \
  "sudo sed -i 's|^MOONCUT_WHISPER_MODEL=.*|MOONCUT_WHISPER_MODEL=${REMOTE_MODEL}|' /etc/mooncut/mooncut.env && sudo systemctl restart mooncut-agent"

echo "Faster Whisper model installed at ${SERVER}:${REMOTE_MODEL}"
