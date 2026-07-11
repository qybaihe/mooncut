#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/mooncut"
ENV_DIR="/etc/mooncut"
SOURCE_ENV="/tmp/mooncut-subtitle-source.env"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 1
fi
if [[ ! -f "${SOURCE_ENV}" ]]; then
  echo "Missing ${SOURCE_ENV}" >&2
  exit 1
fi
timestamp_model="${ROOT}/models/faster-whisper-tiny"
if [[ ! -f "${timestamp_model}/model.bin" ]]; then
  timestamp_model="${ROOT}/models/faster-whisper-small"
fi
if [[ ! -f "${timestamp_model}/model.bin" ]]; then
  echo "Missing offline Faster Whisper timestamp model under ${ROOT}/models" >&2
  exit 1
fi

trap 'rm -f "${SOURCE_ENV}"' EXIT
read_env_value() {
  sed -n "s/^$1=//p" "${SOURCE_ENV}" | tail -n 1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

mimo_key="$(read_env_value MIMO_API_KEY)"
if [[ -z "${mimo_key}" ]]; then
  echo "MIMO_API_KEY is required" >&2
  exit 1
fi
deepgram_key="$(read_env_value DEEPGRAM_API_KEY)"

install -d -m 0750 "${ENV_DIR}" "${ROOT}/hybrid-subtitle-service/data"
chown -R ubuntu:ubuntu "${ROOT}/hybrid-subtitle-service"
subtitle_key=""
if [[ -f "${ENV_DIR}/subtitle.env" ]]; then
  subtitle_key="$(sed -n 's/^SERVICE_API_KEY=//p' "${ENV_DIR}/subtitle.env" | tail -n 1)"
fi
if [[ -z "${subtitle_key}" ]]; then
  subtitle_key="subtitle_$(openssl rand -hex 32)"
fi

cat > "${ENV_DIR}/subtitle.env" <<EOF
MIMO_API_KEY=${mimo_key}
DEEPGRAM_API_KEY=${deepgram_key}
SERVICE_API_KEY=${subtitle_key}
MAX_UPLOAD_MB=1024
CHUNK_SECONDS=45
CHUNK_OVERLAP_SECONDS=0.8
PROVIDER_TIMEOUT_SECONDS=180
PROVIDER_MAX_RETRIES=3
CHUNK_CONCURRENCY=1
JOB_CONCURRENCY=1
MIMO_BASE_URL=https://api.xiaomimimo.com/v1/chat/completions
MIMO_MODEL=mimo-v2.5-asr
DEEPGRAM_BASE_URL=https://api.deepgram.com/v1/listen
DEEPGRAM_MODEL=nova-3
DEEPGRAM_MIP_OPT_OUT=false
TIMESTAMP_PROVIDER=faster-whisper
FASTER_WHISPER_MODEL=${timestamp_model}
FASTER_WHISPER_DEVICE=cpu
FASTER_WHISPER_COMPUTE_TYPE=int8
DATA_DIR=${ROOT}/hybrid-subtitle-service/data
HTTP_PROXY=http://127.0.0.1:7897
HTTPS_PROXY=http://127.0.0.1:7897
NO_PROXY=127.0.0.1,localhost
EOF
chmod 0600 "${ENV_DIR}/subtitle.env"

unset HTTP_PROXY HTTPS_PROXY NO_PROXY
python3 -m venv "${ROOT}/hybrid-subtitle-service/.venv"
"${ROOT}/hybrid-subtitle-service/.venv/bin/pip" install --upgrade pip wheel
"${ROOT}/hybrid-subtitle-service/.venv/bin/pip" install "${ROOT}/hybrid-subtitle-service"

cat > /etc/systemd/system/mooncut-subtitles.service <<EOF
[Unit]
Description=MoonCut hybrid subtitle API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=${ROOT}/hybrid-subtitle-service
EnvironmentFile=${ENV_DIR}/subtitle.env
Environment=PATH=${ROOT}/hybrid-subtitle-service/.venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${ROOT}/hybrid-subtitle-service/.venv/bin/uvicorn hybrid_subtitle.app:app --host 127.0.0.1 --port 8765 --workers 1
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${ROOT}/hybrid-subtitle-service/data
TasksMax=256

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now mooncut-subtitles.service

for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:8765/healthz > /tmp/mooncut-subtitle-health.json; then
    break
  fi
  sleep 1
done
python3 - <<'PY'
import json
health = json.load(open("/tmp/mooncut-subtitle-health.json"))
if health.get("status") != "ok" or health.get("providers_configured") is not True:
    raise SystemExit(f"subtitle service is not ready: {health}")
PY
rm -f /tmp/mooncut-subtitle-health.json

sed -i "s|^MOONCUT_SUBTITLE_API_URL=.*|MOONCUT_SUBTITLE_API_URL=http://127.0.0.1:8765|" "${ENV_DIR}/mooncut.env"
sed -i "s|^MOONCUT_SUBTITLE_API_KEY=.*|MOONCUT_SUBTITLE_API_KEY=${subtitle_key}|" "${ENV_DIR}/mooncut.env"
if ! grep -q '^MOONCUT_ALLOW_KNOWN_SUBTITLE_FIXTURES=' "${ENV_DIR}/mooncut.env"; then
  echo 'MOONCUT_ALLOW_KNOWN_SUBTITLE_FIXTURES=false' >> "${ENV_DIR}/mooncut.env"
fi
if ! grep -q '^MOONCUT_REQUIRE_SUBTITLE_SERVICE=' "${ENV_DIR}/mooncut.env"; then
  echo 'MOONCUT_REQUIRE_SUBTITLE_SERVICE=true' >> "${ENV_DIR}/mooncut.env"
fi
if ! grep -q '^MOONCUT_SUBTITLE_JOB_TIMEOUT_MS=' "${ENV_DIR}/mooncut.env"; then
  cat >> "${ENV_DIR}/mooncut.env" <<'EOF'
MOONCUT_SUBTITLE_JOB_TIMEOUT_MS=2700000
MOONCUT_SUBTITLE_POLL_INTERVAL_MS=2000
EOF
fi
if ! grep -q '^MOONCUT_RENDER_TIMEOUT_MS=' "${ENV_DIR}/mooncut.env"; then
  echo 'MOONCUT_RENDER_TIMEOUT_MS=7200000' >> "${ENV_DIR}/mooncut.env"
fi
if ! grep -q '^MOONCUT_RENDER_WIDTH=' "${ENV_DIR}/mooncut.env"; then
  cat >> "${ENV_DIR}/mooncut.env" <<'EOF'
MOONCUT_RENDER_WIDTH=1280
MOONCUT_RENDER_HEIGHT=720
MOONCUT_RENDER_FPS=24
EOF
fi
if ! grep -q '^MOONCUT_AGENT_EXECUTION_MODE=' "${ENV_DIR}/mooncut.env"; then
  echo 'MOONCUT_AGENT_EXECUTION_MODE=reliable' >> "${ENV_DIR}/mooncut.env"
fi
systemctl restart mooncut-agent

echo "Hybrid subtitle service is ready on 127.0.0.1:8765"
